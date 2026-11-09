'use strict';

const { socketSchemas, parse } = require('../lib/schemas');
const { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } = require('../lib/errors');
const { containsBadWords } = require('../lib/filter');
const { filenameFromUrl, removeUploads } = require('../lib/uploads');
const state = require('../lib/gameState');
const board = require('../lib/board');
const { nowIso } = require('../lib/sessions');
const { rooms } = require('./notifier');

const MAX_ANSWER_BYTES = 16 * 1024;

// Identitaet kommt nur aus der Server-Session und wird pro Ereignis neu gelesen.
// Das gilt nur fuer Nachrichten des Clients. Damit ein Socket auch nichts mehr
// empfaengt, trennt notifier.disconnectHttpSession ihn, sobald seine HTTP-Session
// endet (Abmeldung, neue Anmeldung, Passwortwechsel, Ablauf).
async function loadIdentity(socket, store) {
    const sess = await store.load(socket.request.sessionID);
    return {
        teacherId: sess && sess.teacherId ? sess.teacherId : null,
        teamId: sess && sess.teamId ? sess.teamId : null,
        joinedSessionId: sess && sess.joinedSessionId ? sess.joinedSessionId : null
    };
}

function normalizeAnswer(taskType, answer) {
    if (answer === undefined || answer === null) return null;
    let stored = answer;
    if (taskType === 'password') {
        // Kinder tippen hier womoeglich echte Passwoerter: nur die Auswertung speichern.
        const source = typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
        stored = {
            length: Number.isInteger(source.length) ? source.length : null,
            rulesMet: Array.isArray(source.rulesMet) ? source.rulesMet.map(Boolean) : null
        };
    }
    const json = JSON.stringify(stored);
    if (Buffer.byteLength(json, 'utf8') > MAX_ANSWER_BYTES) throw badRequest('Die Antwort ist zu groß.', { code: 'ANSWER_TOO_LARGE' });
    return json;
}

function registerSockets(ctx) {
    const { io, db, store, config, logger, notifier } = ctx;

    /** Brettspiel: nur Teams einer laufenden Brettspiel-Session. */
    async function requireBoardTeam(socket) {
        const context = await requireRunning(socket);
        if (context.session.game_mode !== 'board') throw conflict('Diese Session spielt kein Brettspiel.', { code: 'NOT_BOARD' });
        return context;
    }

    async function requireTeamContext(socket) {
        const { teamId } = await loadIdentity(socket, store);
        if (!teamId) throw unauthorized('Nur für Teams.');
        const team = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);
        if (!team) throw forbidden('Dieses Team gibt es nicht mehr.', { code: 'TEAM_GONE' });
        const session = await db.get("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [team.session_id]);
        if (!session) throw conflict('Die Session ist beendet.', { code: 'SESSION_CLOSED' });
        return { team, session };
    }

    async function requireRunning(socket) {
        const context = await requireTeamContext(socket);
        if (context.session.game_status !== 'running') throw conflict('Das Spiel läuft gerade nicht.', { code: 'NOT_RUNNING' });
        return context;
    }

    function requireTask(session, taskKey) {
        const found = state.findTask(session, taskKey);
        if (!found) throw notFound('Diese Aufgabe gehört nicht zur aktuellen Spielrunde.', { code: 'UNKNOWN_TASK' });
        return found;
    }

    function publicTeam(team) {
        return { id: team.id, name: team.name, color: team.color, team_code: team.team_code };
    }

    async function progressOf(session, teamId) {
        const team = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);
        return state.computeProgress(session, team, await state.loadResultsForTeam(db, teamId));
    }

    function publishFinished(session, team, progress, explicit) {
        notifier.teamFinished(session.id, {
            teamId: team.id,
            team: publicTeam(team),
            finishedAt: progress.finishedAt,
            explicit,
            progress
        });
    }

    /** Nach dem Ende eines Teams (auch per finishStations) aendert sich sein Stand nicht mehr. */
    async function requireNotFinished(q, teamId) {
        const current = await q.get('SELECT finished_at FROM teams WHERE id = ?', [teamId]);
        if (!current) throw forbidden('Dieses Team gibt es nicht mehr.', { code: 'TEAM_GONE' });
        if (current.finished_at) throw conflict('Ihr habt das Spiel bereits beendet.', { code: 'ALREADY_FINISHED' });
    }

    /**
     * Teams kennen die Keys aller Stationen. Der Stations-Code zaehlt nur, wenn
     * der Server sie vorher per openStation geoeffnet hat und sie nicht abgebrochen wurde.
     */
    async function requireOpenStation(q, session, teamId, taskKey, { allowCancelled = false } = {}) {
        if (!state.isQrSession(session)) return;
        const row = await q.get('SELECT status FROM task_results WHERE team_id = ? AND task_key = ?', [teamId, taskKey]);
        if (!row || (row.status === 'skipped' && !allowCancelled)) {
            throw conflict('Diese Station ist nicht geöffnet. Bitte gebt zuerst ihren Code ein.', { code: 'STATION_NOT_OPEN' });
        }
    }

    /**
     * Eine Monster-Aufgabe stoppt das Team, bis die Lehrkraft bestaetigt.
     * targetKey null: Abschluss des Durchlaufs (finishStations).
     */
    async function requireNoOpenMonster(q, session, teamId, targetKey) {
        const monsters = state.keyedTasks(session).filter((task) => task.type === 'monster' && task.key !== targetKey);
        if (monsters.length === 0) return;
        const rows = await q.all('SELECT task_key, status FROM task_results WHERE team_id = ?', [teamId]);
        const statusOf = (key) => (rows.find((row) => row.task_key === key) || {}).status;
        const blocked = state.isQrSession(session)
            ? monsters.some((task) => statusOf(task.key) === 'started')
            : monsters.some((task) => (targetKey === null || Number(task.key.split('-')[1]) < Number(targetKey.split('-')[1])) && statusOf(task.key) !== 'completed');
        if (blocked) throw conflict('Bitte wartet, bis eure Lehrkraft die Monster-Aufgabe bestätigt hat.', { code: 'MONSTER_PENDING' });
    }

    /**
     * started-Eintrag anlegen. Ein abgeschlossener Eintrag wird nie herabgestuft,
     * ein uebersprungener nur beim erneuten Oeffnen einer Station (reopen).
     */
    async function recordStart(session, team, found, { reopen = false } = {}) {
        const now = nowIso();
        const result = await db.transaction(async (tx) => {
            await requireNotFinished(tx, team.id);
            if (!reopen) await requireOpenStation(tx, session, team.id, found.task.key);
            await requireNoOpenMonster(tx, session, team.id, found.task.key);
            return tx.run(
                `INSERT INTO task_results (session_id, team_id, task_key, task_index, task_type, task_title, status, started_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'started', ?, ?)
                 ON CONFLICT(team_id, task_key) DO UPDATE SET status = 'started', completed_at = NULL, updated_at = excluded.updated_at
                 WHERE task_results.status = 'started' OR (? = 1 AND task_results.status = 'skipped')`,
                [session.id, team.id, found.task.key, found.index, found.task.type, found.title, now, now, reopen ? 1 : 0]
            );
        });
        const progress = await progressOf(session, team.id);
        if (result.changes > 0) {
            notifier.teamTaskUpdate(session.id, {
                teamId: team.id,
                team: publicTeam(team),
                taskKey: found.task.key,
                taskIndex: found.index,
                taskType: found.task.type,
                taskTitle: found.title,
                status: 'started',
                progress
            });
        }
        return progress;
    }

    const handlers = {
        async joinLobby({ socket, identity }) {
            if (!identity.joinedSessionId) throw forbidden('Bitte gib zuerst den Session-Code ein.');
            const session = await db.get("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [identity.joinedSessionId]);
            if (!session) throw conflict('Die Session ist beendet.', { code: 'SESSION_CLOSED' });
            moveToRooms(socket, [rooms.lobby(session.id)]);
            return {
                state: {
                    sessionId: session.id,
                    maxTeams: session.max_teams,
                    gameStatus: session.game_status,
                    takenColors: await state.loadTakenColors(db, session.id)
                }
            };
        },

        async joinSessionRoom({ socket, identity, payload }) {
            const session = await db.get('SELECT * FROM sessions WHERE id = ?', [payload.sessionId]);
            const team = identity.teamId ? await db.get('SELECT * FROM teams WHERE id = ?', [identity.teamId]) : null;
            const isOwner = Boolean(session && identity.teacherId && identity.teacherId === session.teacher_id);
            const isTeam = Boolean(session && team && team.session_id === session.id);
            const asTeacher = isOwner && payload.as !== 'team';
            if (!asTeacher && !isTeam) throw forbidden();
            if (session.status !== 'active') throw conflict('Die Session ist beendet.', { code: 'SESSION_CLOSED' });

            if (asTeacher) {
                moveToRooms(socket, [rooms.teacher(session.id)]);
                return { role: 'teacher', state: await state.buildTeacherState(db, session) };
            }
            moveToRooms(socket, [rooms.teams(session.id), rooms.team(team.id)]);
            return { role: 'team', state: await state.buildTeamState(db, session, team) };
        },

        async reportTaskStart({ socket, payload }) {
            const { team, session } = await requireRunning(socket);
            const progress = await recordStart(session, team, requireTask(session, payload.taskKey));
            return { progress };
        },

        async openStation({ socket, payload }) {
            const { team, session } = await requireRunning(socket);
            if (!state.isQrSession(session)) throw conflict('Diese Spielrunde hat keine Stationen.', { code: 'NOT_QR' });
            if (team.finished_at) throw conflict('Ihr habt das Spiel bereits beendet.', { code: 'ALREADY_FINISHED' });
            const wanted = payload.code.toLowerCase();
            const task = state.keyedTasks(session).find((candidate) => String(candidate.code).toLowerCase() === wanted);
            if (!task) throw notFound('Ungültiger Code für diese Spielrunde.', { code: 'UNKNOWN_CODE' });
            const existing = await db.get('SELECT status FROM task_results WHERE team_id = ? AND task_key = ?', [team.id, task.key]);
            if (existing && existing.status === 'completed') {
                throw conflict('Diese Station habt ihr schon abgeschlossen.', { code: 'ALREADY_COMPLETED' });
            }
            const found = requireTask(session, task.key);
            const progress = await recordStart(session, team, found, { reopen: true });
            const { code, ...studentTask } = found.task;
            return { taskKey: found.task.key, task: studentTask, progress };
        },

        async reportTaskResult({ socket, payload }) {
            const { team, session } = await requireRunning(socket);
            const found = requireTask(session, payload.taskKey);
            if (found.task.type === 'monster') throw conflict('Diese Aufgabe bestätigt eure Lehrkraft.', { code: 'MONSTER_PENDING' });
            const answer = normalizeAnswer(found.task.type, payload.answer);
            const now = nowIso();

            const outcome = await db.transaction(async (tx) => {
                await requireNotFinished(tx, team.id);
                await requireOpenStation(tx, session, team.id, found.task.key, { allowCancelled: payload.status === 'skipped' });
                await requireNoOpenMonster(tx, session, team.id, found.task.key);
                const write = await tx.run(
                    `INSERT INTO task_results (session_id, team_id, task_key, task_index, task_type, task_title, status, answer, started_at, completed_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(team_id, task_key) DO UPDATE SET
                        status = excluded.status, answer = excluded.answer,
                        completed_at = excluded.completed_at, updated_at = excluded.updated_at
                     WHERE task_results.status <> 'completed'`,
                    [session.id, team.id, found.task.key, found.index, found.task.type, found.title, payload.status, answer, now, now, now]
                );
                const current = await tx.get('SELECT * FROM teams WHERE id = ?', [team.id]);
                const rows = await tx.all('SELECT * FROM task_results WHERE team_id = ?', [team.id]);
                let progress = state.computeProgress(session, current, rows);
                let justFinished = false;
                if (write.changes > 0 && !current.finished_at && state.isRunComplete(session, progress)) {
                    await tx.run('UPDATE teams SET finished_at = ? WHERE id = ?', [now, team.id]);
                    progress = state.computeProgress(session, { ...current, finished_at: now }, rows);
                    justFinished = true;
                }
                const row = rows.find((candidate) => candidate.task_key === found.task.key);
                return { changed: write.changes > 0, progress, justFinished, row };
            });

            if (outcome.changed) {
                notifier.teamTaskResult(session.id, {
                    teamId: team.id,
                    team: publicTeam(team),
                    result: state.serializeResult(outcome.row),
                    progress: outcome.progress
                });
            }
            if (outcome.justFinished) publishFinished(session, team, outcome.progress, false);
            return { progress: outcome.progress, alreadyCompleted: !outcome.changed };
        },

        async finishStations({ socket }) {
            const { team, session } = await requireRunning(socket);
            if (!state.isQrSession(session)) throw conflict('Diese Spielrunde hat keine Stationen.', { code: 'NOT_QR' });
            await requireNoOpenMonster(db, session, team.id, null);
            const write = await db.run('UPDATE teams SET finished_at = ? WHERE id = ? AND finished_at IS NULL', [nowIso(), team.id]);
            const progress = await progressOf(session, team.id);
            if (write.changes > 0) publishFinished(session, team, progress, true);
            return { progress };
        },

        async studentSubmission({ socket, payload }) {
            const { team, session } = await requireRunning(socket);
            const isBoard = session.game_mode === 'board';
            const found = isBoard
                ? (await board.requireWorkingCard(db, session, team, payload.taskKey)).found
                : requireTask(session, payload.taskKey);
            if (found.task.type !== payload.type) throw badRequest('Diese Einsendung passt nicht zur Aufgabe.', { code: 'WRONG_TYPE' });

            let filename = null;
            if (payload.type === 'statement') {
                if (containsBadWords(payload.content)) throw badRequest('Bitte formuliere deinen Text ohne Schimpfwörter.', { code: 'BAD_WORDS' });
            } else {
                // Nur eigene, zuvor hochgeladene Bilder; sonst koennte beliebige URL beim Lehrer landen.
                filename = filenameFromUrl(payload.content);
                const upload = filename
                    ? await db.get("SELECT filename FROM uploads WHERE filename = ? AND team_id = ? AND kind = 'submission'", [filename, team.id])
                    : null;
                if (!upload) throw badRequest('Das Foto wurde nicht gefunden. Bitte lade es erneut hoch.', { code: 'INVALID_PHOTO' });
            }

            const { submissionId, replacedFile } = await db.transaction(async (tx) => {
                await requireNotFinished(tx, team.id);
                if (isBoard) {
                    await board.requireWorkingCard(tx, session, team, found.task.key);
                } else {
                    await requireOpenStation(tx, session, team.id, found.task.key);
                    await requireNoOpenMonster(tx, session, team.id, found.task.key);
                }
                const previous = await tx.get('SELECT type, content FROM submissions WHERE team_id = ? AND task_key = ?', [team.id, found.task.key]);
                await tx.run(
                    `INSERT INTO submissions (session_id, team_id, task_key, task_title, type, content, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(team_id, task_key) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`,
                    [session.id, team.id, found.task.key, found.title, payload.type, payload.content, nowIso()]
                );
                const stored = await tx.get('SELECT id FROM submissions WHERE team_id = ? AND task_key = ?', [team.id, found.task.key]);
                const oldFile = previous && previous.type === 'photo' ? filenameFromUrl(previous.content) : null;
                // Dieselbe Datei kann auch bei einer anderen Aufgabe des Teams eingereicht sein.
                const stillUsed = oldFile && oldFile !== filename
                    ? await tx.get("SELECT id FROM submissions WHERE team_id = ? AND type = 'photo' AND content = ? LIMIT 1", [team.id, previous.content])
                    : null;
                const replaced = oldFile && oldFile !== filename && !stillUsed ? oldFile : null;
                if (replaced) await tx.run('DELETE FROM uploads WHERE filename = ?', [replaced]);
                return { submissionId: stored.id, replacedFile: replaced };
            });
            if (replacedFile) await removeUploads(config.uploadsDir, [replacedFile], logger);

            const submission = await state.loadSubmission(db, submissionId);
            notifier.newSubmission(session.id, submission);
            return { submission };
        },

        async showResults({ identity, payload }) {
            if (!identity.teacherId) throw forbidden();
            const result = await db.run(
                "UPDATE sessions SET results_enabled = 1 WHERE id = ? AND teacher_id = ? AND status = 'active'",
                [payload.sessionId, identity.teacherId]
            );
            if (result.changes === 0) throw forbidden();
            notifier.displayResults(payload.sessionId);
            return {};
        },

        /** Einzelne Spielrunde: Die Lehrkraft gibt ein Team nach einer Monster-Aufgabe wieder frei. */
        async confirmMonster({ identity, payload }) {
            if (!identity.teacherId) throw forbidden();
            const session = await db.get('SELECT * FROM sessions WHERE id = ? AND teacher_id = ?', [payload.sessionId, identity.teacherId]);
            if (!session) throw forbidden();
            if (session.status !== 'active') throw conflict('Die Session ist beendet.', { code: 'SESSION_CLOSED' });
            if (session.game_status !== 'running') throw conflict('Das Spiel läuft gerade nicht.', { code: 'NOT_RUNNING' });
            if (session.game_mode === 'board') throw conflict('Im Brettspiel bestätigst du Monster über den Spielstand.', { code: 'BOARD_SESSION' });
            const team = await db.get('SELECT * FROM teams WHERE id = ? AND session_id = ?', [payload.teamId, session.id]);
            if (!team) throw notFound('Dieses Team gibt es nicht mehr.', { code: 'TEAM_GONE' });
            const found = requireTask(session, payload.taskKey);
            if (found.task.type !== 'monster') throw conflict('Das ist keine Monster-Aufgabe.', { code: 'NOT_MONSTER' });

            const now = nowIso();
            const outcome = await db.transaction(async (tx) => {
                const current = await tx.get('SELECT * FROM teams WHERE id = ?', [team.id]);
                if (!current) throw notFound('Dieses Team gibt es nicht mehr.', { code: 'TEAM_GONE' });
                const before = await tx.all('SELECT * FROM task_results WHERE team_id = ?', [team.id]);
                let progress = state.computeProgress(session, current, before);
                const existing = before.find((row) => row.task_key === found.task.key);
                if (existing && existing.status === 'completed') return { changed: false, progress };
                if (current.finished_at) throw conflict('Dieses Team ist bereits fertig.', { code: 'ALREADY_FINISHED' });
                const reached = state.isQrSession(session)
                    ? Boolean(existing && existing.status === 'started')
                    : progress.currentTaskKey === found.task.key;
                if (!reached) throw conflict('Dieses Team ist noch nicht bei dieser Monster-Aufgabe.', { code: 'MONSTER_NOT_REACHED' });
                await tx.run(
                    `INSERT INTO task_results (session_id, team_id, task_key, task_index, task_type, task_title, status, answer, started_at, completed_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, 'completed', NULL, ?, ?, ?)
                     ON CONFLICT(team_id, task_key) DO UPDATE SET status = 'completed', completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
                    [session.id, team.id, found.task.key, found.index, found.task.type, found.title, now, now, now]
                );
                const rows = await tx.all('SELECT * FROM task_results WHERE team_id = ?', [team.id]);
                progress = state.computeProgress(session, current, rows);
                let justFinished = false;
                if (state.isRunComplete(session, progress)) {
                    await tx.run('UPDATE teams SET finished_at = ? WHERE id = ?', [now, team.id]);
                    progress = state.computeProgress(session, { ...current, finished_at: now }, rows);
                    justFinished = true;
                }
                return { changed: true, progress, justFinished, row: rows.find((row) => row.task_key === found.task.key) };
            });

            if (outcome.changed) {
                notifier.teamTaskResult(session.id, {
                    teamId: team.id,
                    team: publicTeam(team),
                    result: state.serializeResult(outcome.row),
                    progress: outcome.progress
                });
                notifier.monsterConfirmed(team.id, { sessionId: session.id, taskKey: found.task.key, progress: outcome.progress });
                if (outcome.justFinished) publishFinished(session, team, outcome.progress, false);
            }
            return { progress: outcome.progress, alreadyCompleted: !outcome.changed };
        },

        async boardOpenCard({ socket, payload }) {
            const { team, session } = await requireBoardTeam(socket);
            const { card, created } = await board.openCard(db, session, team, payload.code);
            if (created) await board.publish(ctx, session.id);
            notifier.boardCard(team.id, { sessionId: session.id, card });
            return { card };
        },

        async boardSubmitCard({ socket, payload }) {
            const { team, session } = await requireBoardTeam(socket);
            const answerJson = normalizeAnswer('board', payload.answer);
            const { card } = await board.submitCard(db, session, team, {
                taskKey: payload.taskKey,
                status: payload.status,
                answer: payload.answer,
                answerJson
            });
            await board.publish(ctx, session.id);
            notifier.boardCard(team.id, { sessionId: session.id, card });
            return { card };
        },

        async boardAction({ identity, payload }) {
            if (!identity.teacherId) throw forbidden();
            await board.applyAction(db, identity.teacherId, payload);
            return { board: await board.publish(ctx, payload.sessionId) };
        }
    };

    const eventSchemas = {
        joinLobby: socketSchemas.none,
        joinSessionRoom: socketSchemas.joinSessionRoom,
        reportTaskStart: socketSchemas.taskStart,
        openStation: socketSchemas.openStation,
        reportTaskResult: socketSchemas.taskResult,
        finishStations: socketSchemas.none,
        studentSubmission: socketSchemas.submission,
        showResults: socketSchemas.showResults,
        confirmMonster: socketSchemas.confirmMonster,
        boardOpenCard: socketSchemas.boardOpenCard,
        boardSubmitCard: socketSchemas.boardSubmitCard,
        boardAction: socketSchemas.boardAction
    };

    function moveToRooms(socket, targets) {
        (socket.data.gameRooms || []).filter((room) => !targets.includes(room)).forEach((room) => socket.leave(room));
        targets.forEach((room) => socket.join(room));
        socket.data.gameRooms = targets;
    }

    function allowEvent(socket) {
        const now = Date.now();
        const budget = socket.data.budget;
        if (now - budget.windowStart > config.socketEventWindowMs) {
            budget.windowStart = now;
            budget.count = 0;
        }
        budget.count += 1;
        return budget.count <= config.socketEventMax;
    }

    function guard(socket, event) {
        return async (...args) => {
            const candidate = args[args.length - 1];
            const callback = typeof candidate === 'function' ? args.pop() : null;
            const reply = (body) => {
                if (!callback) return;
                try {
                    callback(body);
                } catch (err) {
                    logger.error(`Ack für ${event} fehlgeschlagen`, err);
                }
            };
            try {
                if (!allowEvent(socket)) throw new ApiError(429, 'Zu viele Nachrichten. Bitte warte kurz.', { code: 'RATE_LIMITED' });
                const payload = parse(eventSchemas[event], args[0]);
                const identity = await loadIdentity(socket, store);
                const result = await handlers[event]({ socket, identity, payload });
                reply({ ok: true, ...result });
            } catch (err) {
                if (err instanceof ApiError) {
                    reply({ ok: false, error: err.message, code: err.code });
                } else {
                    logger.error(`Fehler im Socket-Ereignis ${event}`, err);
                    reply({ ok: false, error: 'Interner Serverfehler', code: 'SERVER_ERROR' });
                }
            }
        };
    }

    io.on('connection', (socket) => {
        socket.data.budget = { windowStart: Date.now(), count: 0 };
        socket.data.gameRooms = [];
        socket.join(rooms.httpSession(socket.request.sessionID));
        // Beim Handshake frisch geladen; endet die Anmeldung, trennt der Notifier den Socket.
        const { teacherId } = socket.request.session || {};
        if (teacherId) socket.join(rooms.teacherHome(teacherId));
        Object.keys(handlers).forEach((event) => socket.on(event, guard(socket, event)));
        socket.on('error', (err) => logger.warn('Socket-Fehler', err && err.message));
    });
}

module.exports = { registerSockets };
