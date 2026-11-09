'use strict';

const crypto = require('crypto');
const TaskTypes = require('../../public/js/shared/task-types.js');
const GameRules = require('../../public/js/shared/game-rules.js');
const { parseJson } = require('./json');
const { badRequest, conflict, forbidden, notFound } = require('./errors');

const MAIN = GameRules.MAIN_WORLD;
const nowIso = () => new Date().toISOString();
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function fromRow(row) {
    return {
        sessionId: row.session_id,
        worldCount: row.world_count,
        portals: parseJson(row.portals, []),
        sets: parseJson(row.sets, {}),
        phase: row.phase,
        world: row.world,
        mainPos: row.main_pos,
        worldPos: row.world_pos,
        round: row.round,
        remainingSteps: row.remaining_steps,
        lastResult: parseJson(row.last_result),
        pending: parseJson(row.pending),
        donePortals: parseJson(row.done_portals, []),
        rev: row.rev
    };
}

async function loadBoard(q, sessionId) {
    const row = await q.get('SELECT * FROM board_states WHERE session_id = ?', [sessionId]);
    return row ? fromRow(row) : null;
}

/** Jede Aenderung am Spielstand erhoeht rev; ein Doppel-Tipp kommt danach als STALE_STATE an. */
async function saveBoard(q, board) {
    board.rev += 1;
    await q.run(
        `UPDATE board_states SET phase = ?, world = ?, main_pos = ?, world_pos = ?, round = ?, remaining_steps = ?,
            last_result = ?, pending = ?, done_portals = ?, rev = ?, updated_at = ? WHERE session_id = ?`,
        [
            board.phase, board.world, board.mainPos, board.worldPos, board.round, board.remainingSteps,
            board.lastResult ? JSON.stringify(board.lastResult) : null,
            board.pending ? JSON.stringify(board.pending) : null,
            JSON.stringify(board.donePortals), board.rev, nowIso(), board.sessionId
        ]
    );
}

function currentSetKey(board) {
    return board.world || MAIN;
}

function currentSet(board) {
    return board.sets[currentSetKey(board)];
}

const cardKey = (round, index) => `${round}-${index}`;

function shuffled(list) {
    const order = list.slice();
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

// --- Neue Session --------------------------------------------------------------

function invalidConfig(message) {
    return badRequest(message, { code: 'INVALID_BOARD_CONFIG' });
}

/** Prueft den Aufbau: Weltenzahl, Portale und je ein Kartenset fuer das Hauptbrett und jede Welt. */
function checkConfig(config) {
    const { worldCount, portals, sets } = config;
    const fields = GameRules.portalFields(worldCount);
    if (fields.length === 0 || portals.length !== fields.length) {
        throw invalidConfig('Die Anzahl der Portale passt nicht zur Anzahl der Welten.');
    }
    if (new Set(portals).size !== portals.length) throw invalidConfig('Jede Welt darf nur einem Portal zugeordnet sein.');
    if (portals.some((world) => !GameRules.WORLD_KEYS.includes(world))) throw invalidConfig('Unbekannte Welt ausgewählt.');
    const needed = [MAIN, ...portals];
    const missing = needed.find((world) => !hasOwn(sets, world));
    if (missing) throw invalidConfig(`Bitte wähle ein Kartenset für „${GameRules.worldName(missing)}“.`);
    return { fields, needed };
}

/** Laedt die Kartensets und friert sie als Snapshot ein. Spaetere Aenderungen wirken nicht mehr. */
async function snapshotSets(tx, teacherId, config, needed) {
    const snapshots = {};
    for (const world of needed) {
        const row = await tx.get('SELECT * FROM blueprints WHERE id = ? AND teacher_id = ?', [config.sets[world], teacherId]);
        const name = GameRules.worldName(world);
        if (!row) throw notFound(`Das Kartenset für „${name}“ wurde nicht gefunden.`);
        const content = parseJson(row.content, {});
        if (content.templateType !== 'world' || content.world !== world) {
            throw badRequest(`„${row.title}“ ist kein Kartenset für „${name}“.`, { code: 'WORLD_MISMATCH' });
        }
        const details = TaskTypes.validateContent(content);
        if (details.length > 0) throw badRequest(`Das Kartenset „${row.title}“ enthält Fehler.`, { code: 'INVALID_BLUEPRINT', details });
        snapshots[world] = { blueprintId: row.id, title: row.title, world, tasks: content.tasks };
    }
    return snapshots;
}

/** Legt den Spielstand an; die Session gibt es in diesem Moment schon. */
async function createBoardState(tx, sessionId, config, fields, sets) {
    const portals = fields.map((field, index) => ({ field, world: config.portals[index] }));
    await tx.run(
        `INSERT INTO board_states (session_id, world_count, portals, sets, phase, updated_at)
         VALUES (?, ?, ?, ?, 'lobby', ?)`,
        [sessionId, config.worldCount, JSON.stringify(portals), JSON.stringify(sets), nowIso()]
    );
}

// --- Ablauf --------------------------------------------------------------------

function startNextRound(board) {
    board.round += 1;
    board.phase = 'round';
    board.remainingSteps = 0;
    board.pending = null;
}

/** Klassen-Ergebnis der Runde: Unfertige Gruppen zaehlen als nicht richtig. */
async function evaluateRound(tx, board) {
    const { total } = await tx.get('SELECT COUNT(*) AS total FROM teams WHERE session_id = ?', [board.sessionId]);
    const { correct } = await tx.get(
        "SELECT COUNT(*) AS correct FROM board_cards WHERE session_id = ? AND round = ? AND status = 'finished' AND correct = 1",
        [board.sessionId, board.round]
    );
    board.lastResult = GameRules.roundResult(correct, total);
    board.phase = 'result';
}

/** Runde vorbei, sobald jede aktuelle Gruppe fertig ist? Ohne Gruppen bleibt sie offen. */
async function closeRoundIfComplete(tx, board) {
    if (board.phase !== 'round') return false;
    const { total } = await tx.get('SELECT COUNT(*) AS total FROM teams WHERE session_id = ?', [board.sessionId]);
    if (total === 0) return false;
    const { done } = await tx.get(
        "SELECT COUNT(*) AS done FROM board_cards WHERE session_id = ? AND round = ? AND status <> 'working'",
        [board.sessionId, board.round]
    );
    if (done < total) return false;
    await evaluateRound(tx, board);
    return true;
}

/** Nach dem Loeschen eines Teams oder einem Neustart des Spiels. */
async function recheckRound(tx, sessionId) {
    const board = await loadBoard(tx, sessionId);
    if (!board || !await closeRoundIfComplete(tx, board)) return false;
    await saveBoard(tx, board);
    return true;
}

/** Erster Spielstart oeffnet Runde 1; ein spaeterer Start macht einfach weiter. */
async function begin(tx, sessionId) {
    const board = await loadBoard(tx, sessionId);
    if (!board) return;
    if (board.phase === 'lobby') {
        startNextRound(board);
        await saveBoard(tx, board);
        return;
    }
    if (await closeRoundIfComplete(tx, board)) await saveBoard(tx, board);
}

function moveFigure(board) {
    const inWorld = board.world !== null;
    const steps = board.phase === 'result' ? board.lastResult.steps : board.remainingSteps;
    const open = inWorld ? [] : board.portals.filter((portal) => !board.donePortals.includes(portal.field));
    const plan = GameRules.planMove({
        pos: inWorld ? board.worldPos : board.mainPos,
        steps,
        stops: { portals: open.map((portal) => portal.field) }
    });

    if (inWorld) board.worldPos = plan.to;
    else board.mainPos = plan.to;
    board.remainingSteps = plan.remaining;
    board.pending = null;

    if (plan.stoppedAt === 'monster') {
        board.phase = 'monster';
        board.pending = { kind: 'monster', field: plan.to, index: GameRules.monsterIndex(plan.to) };
    } else if (plan.stoppedAt === 'portal') {
        board.phase = 'portal';
        board.pending = { kind: 'portal', field: plan.to, world: open.find((portal) => portal.field === plan.to).world };
    } else if (plan.stoppedAt === 'end' && inWorld) {
        board.phase = 'worldDone';
        board.pending = { kind: 'worldDone', field: board.mainPos, world: board.world };
    } else if (plan.stoppedAt === 'end') {
        board.phase = 'finished';
    } else {
        startNextRound(board);
    }
}

function confirmStep(board) {
    if (board.phase === 'monster') {
        board.pending = null;
        if (board.remainingSteps > 0) board.phase = 'continue';
        else startNextRound(board);
    } else if (board.phase === 'portal') {
        board.world = board.pending.world;
        board.worldPos = GameRules.ARRIVAL_FIELD;
        startNextRound(board);
    } else {
        if (!board.donePortals.includes(board.mainPos)) board.donePortals.push(board.mainPos);
        board.world = null;
        board.worldPos = GameRules.ARRIVAL_FIELD;
        startNextRound(board);
    }
}

const ACTION_PHASES = {
    move: ['result', 'continue'],
    confirm: ['monster', 'portal', 'worldDone'],
    forceEvaluate: ['round']
};

/**
 * Eine Aktion der Lehrkraft. Alles in einer Transaktion: Rechte, rev, Phase, Aenderung.
 * Der Besitzer wird hier geprueft, nicht beim Aufrufer.
 */
function applyAction(db, teacherId, { sessionId, action, rev }) {
    return db.transaction(async (tx) => {
        const session = await tx.get('SELECT * FROM sessions WHERE id = ? AND teacher_id = ?', [sessionId, teacherId]);
        if (!session) throw forbidden();
        if (session.game_mode !== 'board') throw conflict('Diese Session spielt kein Brettspiel.', { code: 'NOT_BOARD' });
        if (session.status !== 'active') throw conflict('Die Session ist beendet.', { code: 'SESSION_CLOSED' });
        if (session.game_status !== 'running') throw conflict('Das Spiel läuft gerade nicht.', { code: 'NOT_RUNNING' });
        const board = await loadBoard(tx, sessionId);
        if (board.rev !== rev) throw conflict('Der Spielstand hat sich geändert. Bitte versuche es noch einmal.', { code: 'STALE_STATE' });
        if (!ACTION_PHASES[action].includes(board.phase)) throw conflict('Das geht in dieser Spielphase nicht.', { code: 'INVALID_ACTION' });

        if (action === 'forceEvaluate') {
            const { total } = await tx.get('SELECT COUNT(*) AS total FROM teams WHERE session_id = ?', [sessionId]);
            if (total === 0) throw conflict('Es ist noch keine Gruppe dabei.', { code: 'NO_TEAMS' });
            await evaluateRound(tx, board);
        } else if (action === 'move') {
            moveFigure(board);
        } else {
            confirmStep(board);
        }
        await saveBoard(tx, board);
    });
}

// --- Karten --------------------------------------------------------------------

function requireRound(board) {
    if (board.phase !== 'round') throw conflict('Gerade läuft keine Karten-Runde.', { code: 'NOT_IN_ROUND' });
}

async function loadTeamRoundCard(q, board, teamId) {
    return q.get('SELECT * FROM board_cards WHERE session_id = ? AND round = ? AND team_id = ?', [board.sessionId, board.round, teamId]);
}

/**
 * Sicht fuer Teams: Loesungen entfernt. Was der Renderer zum Spielen braucht
 * (Lueckentext-Woerter, Chat-Knoten), bleibt; siehe docs/API.md.
 */
function studentTask(task, key) {
    const { code, correct, ...view } = JSON.parse(JSON.stringify(task));
    if (task.type === 'chat') {
        Object.values(view.nodes).forEach((node) => { delete node.success; });
    } else if (task.type === 'scroller') {
        view.posts = view.posts.map(({ isBad, ...post }) => post);
    } else if (task.type === 'bucket') {
        view.items = view.items.map(({ target, ...item }) => item);
    } else if (task.type === 'ranking') {
        view.items = shuffled(view.items);
    } else if (task.type === 'pairs') {
        // Beide Seiten getrennt gemischt: Die Zeilen sagen nichts mehr ueber die Zuordnung.
        const rights = shuffled(view.pairs.map((pair) => pair.right));
        view.pairs = shuffled(view.pairs.map((pair) => pair.left)).map((left, index) => ({ left, right: rights[index] }));
    }
    return { ...view, key };
}

/** Karten-Daten nur fuer das eigene Team. Fertige Karten verraten nichts mehr, auch nicht richtig oder falsch. */
function cardView(board, row) {
    if (!row) return null;
    const key = cardKey(row.round, row.card_index);
    const set = board.sets[row.set_key];
    return {
        taskKey: key,
        round: row.round,
        status: row.status,
        type: row.task_type,
        title: row.task_title,
        openedAt: row.opened_at,
        finishedAt: row.finished_at,
        task: row.status === 'working' && set ? studentTask(set.tasks[row.card_index], key) : null
    };
}

/** Oeffnet die Karte fuer die Runde oder nimmt die eigene offene Karte wieder auf. */
function openCard(db, session, team, code) {
    return db.transaction(async (tx) => {
        const board = await loadBoard(tx, session.id);
        requireRound(board);
        const wanted = code.toLowerCase();
        const own = await loadTeamRoundCard(tx, board, team.id);
        if (own) {
            if (own.code.toLowerCase() !== wanted) throw conflict('Ihr habt in dieser Runde schon eine Karte.', { code: 'CARD_ALREADY_OPEN' });
            if (own.status !== 'working') throw conflict('Diese Karte habt ihr schon abgeschlossen.', { code: 'ALREADY_FINISHED' });
            return { card: cardView(board, own), created: false };
        }
        const setKey = currentSetKey(board);
        const index = currentSet(board).tasks.findIndex((task) => task.type !== 'monster' && String(task.code).toLowerCase() === wanted);
        if (index === -1) throw notFound('Diese Karte gehört nicht zum aktuellen Kartenset.', { code: 'UNKNOWN_CODE' });
        const taken = await tx.get('SELECT id FROM board_cards WHERE session_id = ? AND round = ? AND card_index = ?', [session.id, board.round, index]);
        if (taken) throw conflict('Diese Karte hat schon eine andere Gruppe genommen.', { code: 'CARD_TAKEN' });

        const task = currentSet(board).tasks[index];
        const result = await tx.run(
            `INSERT INTO board_cards (session_id, round, team_id, set_key, card_index, code, task_type, task_title, status, opened_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)`,
            [session.id, board.round, team.id, setKey, index, task.code, task.type, TaskTypes.taskTitle(task), nowIso()]
        );
        const row = await tx.get('SELECT * FROM board_cards WHERE id = ?', [result.lastID]);
        return { card: cardView(board, row), created: true };
    });
}

/** Offene Karte dieses Teams zu taskKey oder Fehler. Innerhalb oder ausserhalb einer Transaktion. */
async function requireWorkingCard(q, session, team, taskKey) {
    const board = await loadBoard(q, session.id);
    requireRound(board);
    const row = await loadTeamRoundCard(q, board, team.id);
    if (!row) throw conflict('Ihr habt noch keine Karte geöffnet.', { code: 'NO_CARD' });
    if (cardKey(row.round, row.card_index) !== taskKey) throw notFound('Das ist nicht eure aktuelle Karte.', { code: 'UNKNOWN_TASK' });
    if (row.status !== 'working') throw conflict('Diese Karte habt ihr schon abgeschlossen.', { code: 'ALREADY_FINISHED' });
    const task = board.sets[row.set_key].tasks[row.card_index];
    return { board, row, task, found: { task: { ...task, key: taskKey }, index: row.card_index, title: row.task_title } };
}

/** Bewertet die Antwort. "correct" vom Client gibt es nicht; es zaehlt nur TaskTypes.judge. */
function submitCard(db, session, team, { taskKey, status, answer, answerJson }) {
    return db.transaction(async (tx) => {
        const { board, row, task } = await requireWorkingCard(tx, session, team, taskKey);
        if (status === 'completed' && (task.type === 'photo' || task.type === 'statement')) {
            const submitted = await tx.get('SELECT id FROM submissions WHERE team_id = ? AND task_key = ?', [team.id, taskKey]);
            if (!submitted) throw conflict('Bitte sendet zuerst eure Einsendung ab.', { code: 'SUBMISSION_MISSING' });
        }
        const correct = status === 'completed' && TaskTypes.judge(task, answer);
        const finalStatus = status === 'completed' ? 'finished' : 'skipped';
        const now = nowIso();
        await tx.run(
            'UPDATE board_cards SET status = ?, answer = ?, correct = ?, finished_at = ? WHERE id = ?',
            [finalStatus, answerJson, correct ? 1 : 0, now, row.id]
        );
        if (await closeRoundIfComplete(tx, board)) await saveBoard(tx, board);
        return { card: cardView(board, { ...row, status: finalStatus, finished_at: now }) };
    });
}

// --- Darstellung ---------------------------------------------------------------

function pendingView(board, kartensetTitle) {
    const { pending } = board;
    if (!pending) return null;
    if (pending.kind === 'monster') {
        const world = currentSetKey(board);
        return {
            kind: 'monster',
            field: pending.field,
            index: pending.index,
            label: GameRules.monsterLabel(world, pending.index),
            world,
            worldName: GameRules.worldName(world),
            monsterImage: GameRules.WORLDS[world].monsterImage
        };
    }
    if (pending.kind === 'portal') {
        return {
            kind: 'portal',
            field: pending.field,
            world: pending.world,
            worldName: GameRules.worldName(pending.world),
            kartenset: board.sets[pending.world].title,
            message: GameRules.portalMessage(pending.world, board.sets[pending.world].title)
        };
    }
    return {
        kind: 'worldDone',
        field: pending.field,
        world: pending.world,
        worldName: GameRules.worldName(pending.world),
        kartenset: kartensetTitle,
        message: GameRules.worldDoneMessage(pending.world, pending.field)
    };
}

function phaseMessage(board, pending) {
    if (board.phase === 'continue') return GameRules.continueMessage(board.remainingSteps);
    if (board.phase === 'finished') return GameRules.VICTORY_MESSAGE;
    return pending && pending.message ? pending.message : null;
}

async function publicState(q, session, board) {
    const { total } = await q.get('SELECT COUNT(*) AS total FROM teams WHERE session_id = ?', [session.id]);
    const { done } = await q.get(
        "SELECT COUNT(*) AS done FROM board_cards WHERE session_id = ? AND round = ? AND status <> 'working'",
        [session.id, board.round]
    );
    const set = currentSet(board);
    const worldKey = currentSetKey(board);
    const pending = pendingView(board, set.title);
    return {
        sessionId: session.id,
        gameMode: 'board',
        gameStatus: session.game_status,
        rev: board.rev,
        phase: board.phase,
        world: board.world,
        worldKey,
        worldName: GameRules.worldName(worldKey),
        kartenset: set.title,
        mainPos: board.mainPos,
        worldPos: board.worldPos,
        round: board.round,
        remainingSteps: board.remainingSteps,
        lastResult: board.lastResult,
        pending,
        message: phaseMessage(board, pending),
        donePortals: board.donePortals,
        worldCount: board.worldCount,
        portals: board.portals.map((portal) => ({
            field: portal.field,
            world: portal.world,
            worldName: GameRules.worldName(portal.world),
            kartenset: board.sets[portal.world].title,
            done: board.donePortals.includes(portal.field)
        })),
        groupProgress: { total, finished: board.phase === 'lobby' ? 0 : Math.min(done, total) }
    };
}

function serializeGroup(row) {
    if (row.card_id === null) {
        return { teamId: row.team_id, name: row.name, color: row.color, status: 'none', skipped: false, card: null, correct: null, answer: null, openedAt: null, finishedAt: null };
    }
    const finished = row.status !== 'working';
    return {
        teamId: row.team_id,
        name: row.name,
        color: row.color,
        status: finished ? 'finished' : 'working',
        skipped: row.status === 'skipped',
        card: { taskKey: cardKey(row.round, row.card_index), code: row.code, type: row.task_type, title: row.task_title, index: row.card_index },
        correct: finished ? row.correct === 1 : null,
        answer: finished ? parseJson(row.answer) : null,
        openedAt: row.opened_at,
        finishedAt: row.finished_at
    };
}

async function teacherGroups(q, sessionId, round) {
    const rows = await q.all(
        `SELECT t.id AS team_id, t.name, t.color, c.id AS card_id, c.round, c.card_index, c.code, c.task_type, c.task_title,
                c.status, c.answer, c.correct, c.opened_at, c.finished_at
         FROM teams t
         LEFT JOIN board_cards c ON c.team_id = t.id AND c.round = ?
         WHERE t.session_id = ?
         ORDER BY t.id ASC`,
        [round, sessionId]
    );
    return rows.map(serializeGroup);
}

function monsterTaskOf(board) {
    const { pending } = board;
    if (!pending || pending.kind !== 'monster') return null;
    return currentSet(board).tasks.filter((task) => task.type === 'monster')[pending.index] || null;
}

/** Lehrkraft-Sicht; die Kartensets (zum Drucken) nur bei Abruf des Vollstandes. */
async function teacherState(q, session, board, { withSets = false } = {}) {
    const base = await publicState(q, session, board);
    return {
        ...base,
        groups: await teacherGroups(q, session.id, board.round),
        monsterTask: monsterTaskOf(board),
        cardCount: currentSet(board).tasks.filter((task) => task.type !== 'monster').length,
        ...(withSets ? { sets: board.sets } : {})
    };
}

async function buildTeacherBoard(q, session) {
    const board = await loadBoard(q, session.id);
    return board ? teacherState(q, session, board, { withSets: true }) : null;
}

/** Stand fuer ein Team samt eigener Karte; nur waehrend einer Runde gibt es eine. */
async function buildTeamBoard(q, session, team) {
    const board = await loadBoard(q, session.id);
    if (!board) return { board: null, card: null };
    const row = board.phase === 'round' ? await loadTeamRoundCard(q, board, team.id) : null;
    return { board: await publicState(q, session, board), card: cardView(board, row) };
}

/** Verlauf fuer die Lehrkraft: alle gespielten Karten je Runde, auch nach dem Schliessen. null ohne Brettspiel. */
async function buildBoardHistory(q, session) {
    const board = await loadBoard(q, session.id);
    if (!board) return null;
    const rows = await q.all(
        `SELECT c.*, t.name AS team_name, t.color AS team_color
         FROM board_cards c JOIN teams t ON t.id = c.team_id
         WHERE c.session_id = ?
         ORDER BY c.round ASC, t.id ASC`,
        [session.id]
    );
    const rounds = new Map();
    rows.forEach((row) => {
        if (!rounds.has(row.round)) {
            const set = board.sets[row.set_key];
            rounds.set(row.round, { round: row.round, world: row.set_key, worldName: GameRules.worldName(row.set_key), kartenset: set ? set.title : '', cards: [] });
        }
        const set = board.sets[row.set_key];
        rounds.get(row.round).cards.push({
            teamId: row.team_id,
            teamName: row.team_name,
            teamColor: row.team_color,
            code: row.code,
            type: row.task_type,
            title: row.task_title,
            status: row.status,
            correct: row.status === 'working' ? null : row.correct === 1,
            answer: parseJson(row.answer),
            task: set ? set.tasks[row.card_index] : null
        });
    });
    return { board: await publicState(q, session, board), rounds: [...rounds.values()] };
}

/** Sendet den Stand an Lehrkraft (mit Gruppen) und Teams (nur Klassen-Stand). */
async function publish(ctx, sessionId) {
    const { db, notifier } = ctx;
    const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session || session.game_mode !== 'board') return null;
    const board = await loadBoard(db, sessionId);
    if (!board) return null;
    const pub = await publicState(db, session, board);
    const teacher = await teacherState(db, session, board);
    notifier.boardState(sessionId, teacher, pub);
    return teacher;
}

module.exports = {
    checkConfig,
    snapshotSets,
    createBoardState,
    begin,
    recheckRound,
    applyAction,
    openCard,
    requireWorkingCard,
    submitCard,
    studentTask,
    buildTeacherBoard,
    buildTeamBoard,
    buildBoardHistory,
    publish
};
