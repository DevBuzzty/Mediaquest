'use strict';

const TaskTypes = require('../../public/js/shared/task-types.js');
const { parseJson } = require('./json');
const board = require('./board');

const snapshotOf = (session) => parseJson(session.snapshot, { title: '', templateType: 'normal', tasks: [] });

/** Task-Keys enthalten die Revision, damit ein neuer Durchlauf neu beginnt. */
function keyedTasks(session) {
    const rev = session.snapshot_rev;
    return snapshotOf(session).tasks.map((task, index) => ({ ...task, key: `${rev}-${index}` }));
}

/** Lehrkraft-Sicht: enthaelt die Stations-Codes zum Drucken. */
function teacherBlueprint(session) {
    const snapshot = snapshotOf(session);
    return {
        id: session.blueprint_id,
        title: snapshot.title,
        templateType: snapshot.templateType,
        tasks: keyedTasks(session)
    };
}

/** Team-Sicht: ohne Stations-Codes, Stationen oeffnet der Server per openStation. */
function studentBlueprint(session) {
    const snapshot = snapshotOf(session);
    return {
        title: snapshot.title,
        templateType: snapshot.templateType,
        tasks: keyedTasks(session).map(({ code, ...task }) => task)
    };
}

function isQrSession(session) {
    return snapshotOf(session).templateType === 'qr';
}

function findTask(session, taskKey) {
    const task = keyedTasks(session).find((candidate) => candidate.key === taskKey);
    if (!task) return null;
    return { task, index: Number(taskKey.split('-')[1]), title: TaskTypes.taskTitle(task) };
}

function serializeResult(row) {
    return {
        task_key: row.task_key,
        task_index: row.task_index,
        task_type: row.task_type,
        task_title: row.task_title,
        status: row.status,
        answer: parseJson(row.answer),
        started_at: row.started_at,
        completed_at: row.completed_at
    };
}

function isCurrentRev(session, taskKey) {
    return taskKey.startsWith(`${session.snapshot_rev}-`);
}

/**
 * Fortschritt eines Teams im aktuellen Durchlauf.
 * Normalmodus: fertig, wenn jede Aufgabe abgeschlossen oder uebersprungen ist.
 * QR-Modus: fertig, wenn alle Stationen abgeschlossen sind oder das Team explizit beendet hat.
 */
function computeProgress(session, team, resultRows) {
    const byKey = new Map(resultRows.filter((row) => isCurrentRev(session, row.task_key)).map((row) => [row.task_key, row]));
    const tasks = keyedTasks(session).map((task, index) => {
        const row = byKey.get(task.key);
        return {
            key: task.key,
            index,
            type: task.type,
            title: TaskTypes.taskTitle(task),
            status: row ? row.status : 'pending',
            completedAt: row ? row.completed_at : null
        };
    });
    const count = (status) => tasks.filter((task) => task.status === status).length;
    const isDone = (task) => task.status === 'completed' || task.status === 'skipped';
    const current = isQrSession(session) ? null : tasks.find((task) => !isDone(task));
    return {
        total: tasks.length,
        completed: count('completed'),
        skipped: count('skipped'),
        currentIndex: current ? current.index : null,
        currentTaskKey: current ? current.key : null,
        finished: Boolean(team.finished_at),
        finishedAt: team.finished_at || null,
        tasks
    };
}

/** Ist der Durchlauf nach dem letzten Ergebnis vollstaendig? */
function isRunComplete(session, progress) {
    if (progress.total === 0) return false;
    if (isQrSession(session)) return progress.completed === progress.total;
    return progress.completed + progress.skipped === progress.total;
}

function serializeTeacherSession(session) {
    return {
        id: session.id,
        code: session.code,
        status: session.status,
        game_status: session.game_status,
        game_mode: session.game_mode,
        max_teams: session.max_teams,
        blueprint_id: session.blueprint_id,
        results_enabled: Boolean(session.results_enabled),
        created_at: session.created_at,
        closed_at: session.closed_at,
        blueprint: teacherBlueprint(session)
    };
}

function serializeTeamForTeacher(session, team, resultRows) {
    const own = resultRows.filter((row) => row.team_id === team.id);
    return {
        id: team.id,
        name: team.name,
        color: team.color,
        group_size: team.group_size,
        team_code: team.team_code,
        created_at: team.created_at,
        finished_at: team.finished_at,
        progress: computeProgress(session, team, own),
        results: own.filter((row) => isCurrentRev(session, row.task_key)).map(serializeResult)
    };
}

const SUBMISSION_SELECT = `
    SELECT s.id, s.session_id, s.team_id, s.task_key, s.task_title, s.type, s.content, s.created_at,
           t.name AS team_name, t.color AS team_color, t.team_code AS team_code
    FROM submissions s
    JOIN teams t ON t.id = s.team_id`;

function loadSubmissions(q, sessionId) {
    return q.all(`${SUBMISSION_SELECT} WHERE s.session_id = ? ORDER BY s.created_at ASC, s.id ASC`, [sessionId]);
}

/**
 * Sicht fuer Teams nach der Ergebnis-Freigabe. Bewusst ohne team_code: Wer ihn kennt,
 * kann per /api/rejoin das andere Team uebernehmen.
 */
function loadPublicSubmissions(q, sessionId) {
    return q.all(
        `SELECT t.name AS team_name, t.color AS team_color, s.task_title, s.type, s.content, s.created_at
         FROM submissions s
         JOIN teams t ON t.id = s.team_id
         WHERE s.session_id = ?
         ORDER BY s.created_at ASC, s.id ASC`,
        [sessionId]
    );
}

function loadSubmission(q, submissionId) {
    return q.get(`${SUBMISSION_SELECT} WHERE s.id = ?`, [submissionId]);
}

function loadResultsForSession(q, sessionId) {
    return q.all('SELECT * FROM task_results WHERE session_id = ? ORDER BY id ASC', [sessionId]);
}

function loadResultsForTeam(q, teamId) {
    return q.all('SELECT * FROM task_results WHERE team_id = ? ORDER BY id ASC', [teamId]);
}

/** Vollstaendiger Stand fuer das Dashboard: identisch nach Reload und Reconnect. */
async function buildTeacherState(q, session) {
    const teams = await q.all('SELECT * FROM teams WHERE session_id = ? ORDER BY id ASC', [session.id]);
    const results = await loadResultsForSession(q, session.id);
    const submissions = await loadSubmissions(q, session.id);
    return {
        active: session.status === 'active',
        session: serializeTeacherSession(session),
        teams: teams.map((team) => serializeTeamForTeacher(session, team, results)),
        submissions,
        board: await board.buildTeacherBoard(q, session)
    };
}

function phaseOf(session, progress) {
    if (session.game_status !== 'running') return 'lobby';
    return progress.finished ? 'finished' : 'running';
}

/** Vollstaendiger Stand fuer ein Team: Wiederaufnahme nach Reload und Reconnect. */
async function buildTeamState(q, session, team) {
    const results = await loadResultsForTeam(q, team.id);
    const progress = computeProgress(session, team, results);
    const isBoard = session.game_mode === 'board';
    const running = session.game_status === 'running' && !isBoard;
    const boardView = isBoard ? await board.buildTeamBoard(q, session, team) : { board: null, card: null };
    return {
        sessionId: session.id,
        sessionCode: session.code,
        maxTeams: session.max_teams,
        teamId: team.id,
        teamCode: team.team_code,
        name: team.name,
        color: team.color,
        groupSize: team.group_size,
        gameStatus: session.game_status,
        gameMode: session.game_mode,
        phase: phaseOf(session, progress),
        resultsEnabled: Boolean(session.results_enabled),
        blueprint: running ? studentBlueprint(session) : null,
        progress: running ? progress : null,
        board: boardView.board,
        card: boardView.card
    };
}

async function loadTakenColors(q, sessionId) {
    const rows = await q.all('SELECT color FROM teams WHERE session_id = ?', [sessionId]);
    return rows.map((row) => row.color);
}

module.exports = {
    parseJson,
    snapshotOf,
    teacherBlueprint,
    studentBlueprint,
    isQrSession,
    findTask,
    keyedTasks,
    serializeResult,
    computeProgress,
    isRunComplete,
    serializeTeacherSession,
    serializeTeamForTeacher,
    loadSubmissions,
    loadPublicSubmissions,
    loadSubmission,
    loadResultsForSession,
    loadResultsForTeam,
    buildTeacherState,
    buildTeamState,
    loadTakenColors
};
