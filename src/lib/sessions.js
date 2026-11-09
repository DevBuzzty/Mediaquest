'use strict';

const TaskTypes = require('../../public/js/shared/task-types.js');
const { badRequest, conflict, notFound } = require('./errors');
const { withUniqueCode } = require('./codes');
const { parseJson } = require('./gameState');
const { removeUploads } = require('./uploads');
const board = require('./board');

const ORPHAN_UPLOAD_GRACE_MS = 24 * 3600000;

const nowIso = () => new Date().toISOString();

/**
 * Bereinigt und prueft den Inhalt einer Spielrunde.
 * Wirft 400 mit details: [{taskIndex, message}], wenn Aufgaben einen Soft-Lock erzeugen wuerden.
 */
function normalizeBlueprintContent(raw) {
    const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
    const templateType = source.templateType === undefined ? 'normal' : source.templateType;
    const tasks = Array.isArray(source.tasks) ? source.tasks.map(TaskTypes.sanitizeTask) : source.tasks;
    if (templateType === 'qr' && Array.isArray(tasks)) TaskTypes.ensureStationCodes(tasks);
    if (templateType === 'world' && Array.isArray(tasks)) prepareKartenset(tasks);
    const content = { templateType, tasks };
    if (templateType === 'world') content.world = source.world;
    const details = TaskTypes.validateContent(content);
    if (details.length > 0) {
        throw badRequest('Die Spielrunde enthält Fehler.', { code: 'INVALID_BLUEPRINT', details });
    }
    return content;
}

/** Karten brauchen Codes wie QR-Stationen; Monster-Aufgaben haben nie einen und sind so nicht scanbar. */
function prepareKartenset(tasks) {
    const isObject = (task) => typeof task === 'object' && task !== null;
    tasks.filter((task) => isObject(task) && task.type === 'monster').forEach((task) => { delete task.code; });
    TaskTypes.ensureStationCodes(tasks.filter((task) => isObject(task) && task.type !== 'monster'));
}

function buildSnapshot(blueprint) {
    const content = parseJson(blueprint.content, { templateType: 'normal', tasks: [] });
    return JSON.stringify({ title: blueprint.title, templateType: content.templateType, tasks: content.tasks });
}

function getOwnedBlueprint(q, blueprintId, teacherId) {
    return q.get('SELECT * FROM blueprints WHERE id = ? AND teacher_id = ?', [blueprintId, teacherId]);
}

function getActiveSession(q, teacherId) {
    return q.get("SELECT * FROM sessions WHERE teacher_id = ? AND status = 'active'", [teacherId]);
}

async function requireActiveSession(q, teacherId) {
    const session = await getActiveSession(q, teacherId);
    if (!session) throw notFound('Keine aktive Session gefunden');
    return session;
}

function getSession(q, id) {
    return q.get('SELECT * FROM sessions WHERE id = ?', [id]);
}

function getOwnedSession(q, id, teacherId) {
    return q.get('SELECT * FROM sessions WHERE id = ? AND teacher_id = ?', [id, teacherId]);
}

async function closeActiveIfAny(tx, teacherId, exceptId) {
    const active = await getActiveSession(tx, teacherId);
    if (!active || active.id === exceptId) return null;
    await tx.run(
        "UPDATE sessions SET status = 'closed', game_status = 'waiting', closed_at = ? WHERE id = ?",
        [nowIso(), active.id]
    );
    return active.id;
}

function requirePlainBlueprint(blueprint) {
    if (parseJson(blueprint.content, {}).templateType === 'world') {
        throw badRequest('Ein Kartenset lässt sich nur im Brettspiel verwenden.', { code: 'WRONG_TEMPLATE' });
    }
}

const BOARD_SNAPSHOT = JSON.stringify({ title: 'Brettspiel', templateType: 'board', tasks: [] });

/** Brettspiel-Session: Snapshots aller Kartensets entstehen in derselben Transaktion. */
async function createBoardSession(db, teacherId, config, maxTeams) {
    const { fields, needed } = board.checkConfig(config);
    return withUniqueCode((code) => db.transaction(async (tx) => {
        const sets = await board.snapshotSets(tx, teacherId, config, needed);
        const closedSessionId = await closeActiveIfAny(tx, teacherId);
        const result = await tx.run(
            `INSERT INTO sessions (teacher_id, code, blueprint_id, snapshot, max_teams, created_at, game_mode)
             VALUES (?, ?, ?, ?, ?, ?, 'board')`,
            [teacherId, code, sets.haupt.blueprintId, BOARD_SNAPSHOT, maxTeams, nowIso()]
        );
        await board.createBoardState(tx, result.lastID, config, fields, sets);
        return { session: await getSession(tx, result.lastID), closedSessionId };
    }), 'sessions.code');
}

/** Legt eine Session an; eine bereits aktive wird dabei geschlossen. */
async function createSession(db, teacherId, blueprint, maxTeams) {
    requirePlainBlueprint(blueprint);
    return withUniqueCode((code) => db.transaction(async (tx) => {
        const closedSessionId = await closeActiveIfAny(tx, teacherId);
        const result = await tx.run(
            `INSERT INTO sessions (teacher_id, code, blueprint_id, snapshot, max_teams, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [teacherId, code, blueprint.id, buildSnapshot(blueprint), maxTeams, nowIso()]
        );
        return { session: await getSession(tx, result.lastID), closedSessionId };
    }), 'sessions.code');
}

async function closeSession(db, teacherId) {
    return db.transaction((tx) => closeActiveIfAny(tx, teacherId));
}

/** Oeffnet eine eigene, geschlossene Session wieder. Erst danach wird die aktive geschlossen. */
async function reopenSession(db, teacherId, sessionId) {
    return db.transaction(async (tx) => {
        const target = await getOwnedSession(tx, sessionId, teacherId);
        if (!target) throw notFound('Session nicht gefunden');
        if (target.status === 'active') return { session: target, closedSessionId: null };
        const closedSessionId = await closeActiveIfAny(tx, teacherId, sessionId);
        await tx.run(
            "UPDATE sessions SET status = 'active', game_status = 'waiting', closed_at = NULL WHERE id = ?",
            [sessionId]
        );
        return { session: await getSession(tx, sessionId), closedSessionId };
    });
}

// Neue Revision: neue Task-Keys, alle Teams beginnen von vorn, alte Ergebnisse bleiben erhalten.
async function startNewRun(tx, sessionId) {
    await tx.run('UPDATE teams SET finished_at = NULL WHERE session_id = ?', [sessionId]);
    await tx.run('UPDATE sessions SET snapshot_rev = snapshot_rev + 1, results_enabled = 0 WHERE id = ?', [sessionId]);
}

async function startGame(db, teacherId) {
    return db.transaction(async (tx) => {
        const active = await requireActiveSession(tx, teacherId);
        if (active.game_status === 'running') return { session: active, alreadyRunning: true };
        await startNewRun(tx, active.id);
        await tx.run("UPDATE sessions SET game_status = 'running' WHERE id = ?", [active.id]);
        if (active.game_mode === 'board') await board.begin(tx, active.id);
        return { session: await getSession(tx, active.id), alreadyRunning: false };
    });
}

async function endGame(db, teacherId) {
    return db.transaction(async (tx) => {
        const active = await requireActiveSession(tx, teacherId);
        await tx.run("UPDATE sessions SET game_status = 'waiting' WHERE id = ?", [active.id]);
        return getSession(tx, active.id);
    });
}

/** Tauscht die Spielrunde einer laufenden Session gegen einen neuen Snapshot aus. */
async function switchBlueprint(db, teacherId, blueprintId) {
    return db.transaction(async (tx) => {
        const active = await requireActiveSession(tx, teacherId);
        if (active.game_mode === 'board') throw conflict('Beim Brettspiel lässt sich die Spielrunde nicht wechseln.', { code: 'BOARD_SESSION' });
        const blueprint = await getOwnedBlueprint(tx, blueprintId, teacherId);
        if (!blueprint) throw notFound('Spielrunde nicht gefunden');
        requirePlainBlueprint(blueprint);
        await startNewRun(tx, active.id);
        await tx.run('UPDATE sessions SET blueprint_id = ?, snapshot = ? WHERE id = ?', [blueprint.id, buildSnapshot(blueprint), active.id]);
        return getSession(tx, active.id);
    });
}

async function updateTeamLimit(db, teacherId, maxTeams) {
    return db.transaction(async (tx) => {
        const active = await requireActiveSession(tx, teacherId);
        const { count } = await tx.get('SELECT COUNT(*) AS count FROM teams WHERE session_id = ?', [active.id]);
        if (maxTeams < count) throw badRequest('Das Limit kann nicht kleiner als die aktuelle Teamanzahl sein.');
        await tx.run('UPDATE sessions SET max_teams = ? WHERE id = ?', [maxTeams, active.id]);
        return active.id;
    });
}

async function createTeam(db, sessionId, { name, color, groupSize }) {
    return withUniqueCode((code) => db.transaction(async (tx) => {
        const session = await tx.get("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [sessionId]);
        if (!session) throw notFound('Session nicht gefunden');
        const { count } = await tx.get('SELECT COUNT(*) AS count FROM teams WHERE session_id = ?', [sessionId]);
        if (count >= session.max_teams) throw conflict(`Maximale Teamanzahl erreicht (max. ${session.max_teams}).`, { code: 'TEAM_LIMIT' });
        const taken = await tx.get('SELECT id FROM teams WHERE session_id = ? AND color = ?', [sessionId, color]);
        if (taken) throw conflict('Diese Farbe ist bereits vergeben.', { code: 'COLOR_TAKEN' });
        const result = await tx.run(
            'INSERT INTO teams (session_id, name, color, group_size, team_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [sessionId, name, color, groupSize, code, nowIso()]
        );
        return { session, team: await tx.get('SELECT * FROM teams WHERE id = ?', [result.lastID]) };
    }), 'teams.team_code');
}

/** Entfernt ein Team samt Ergebnissen, Einsendungen und Dateien. */
async function deleteTeam(ctx, teacherId, teamId) {
    const { team, filenames } = await ctx.db.transaction(async (tx) => {
        const found = await tx.get(
            'SELECT t.* FROM teams t JOIN sessions s ON t.session_id = s.id WHERE t.id = ? AND s.teacher_id = ?',
            [teamId, teacherId]
        );
        if (!found) throw notFound('Team nicht gefunden');
        const files = await tx.all('SELECT filename FROM uploads WHERE team_id = ?', [teamId]);
        await tx.run('DELETE FROM teams WHERE id = ?', [teamId]);
        // Die gelöschte Gruppe könnte die letzte gewesen sein, auf die die Runde noch gewartet hat.
        const running = await tx.get("SELECT id FROM sessions WHERE id = ? AND game_status = 'running'", [found.session_id]);
        if (running) await board.recheckRound(tx, found.session_id);
        return { team: found, filenames: files.map((row) => row.filename) };
    });
    await removeUploads(ctx.config.uploadsDir, filenames, ctx.logger);
    return team;
}

async function removeSessionWithData(ctx, tx, sessionId) {
    const files = await tx.all('SELECT filename FROM uploads WHERE session_id = ?', [sessionId]);
    await tx.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return files.map((row) => row.filename);
}

/** Loescht eine abgeschlossene Session mit allen Daten und Fotos. */
async function deleteClosedSession(ctx, teacherId, sessionId) {
    const filenames = await ctx.db.transaction(async (tx) => {
        const session = await getOwnedSession(tx, sessionId, teacherId);
        if (!session) throw notFound('Session nicht gefunden');
        if (session.status !== 'closed') throw conflict('Nur geschlossene Sessions können gelöscht werden.');
        return removeSessionWithData(ctx, tx, sessionId);
    });
    await removeUploads(ctx.config.uploadsDir, filenames, ctx.logger);
}

/** Entfernt abgeschlossene Sessions, die aelter als die Aufbewahrungsfrist sind. */
async function purgeExpiredSessions(ctx) {
    const { retentionDays } = ctx.config;
    if (!retentionDays || retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const { filenames, count } = await ctx.db.transaction(async (tx) => {
        const expired = await tx.all("SELECT id FROM sessions WHERE status = 'closed' AND closed_at < ?", [cutoff]);
        const collected = [];
        for (const { id } of expired) {
            collected.push(...await removeSessionWithData(ctx, tx, id));
        }
        return { filenames: collected, count: expired.length };
    });
    await removeUploads(ctx.config.uploadsDir, filenames, ctx.logger);
    return count;
}

/**
 * Loescht Lehrkraft-Bilder, die weder eine Spielrunde noch ein Session-Snapshot nutzt.
 * Die Karenzzeit schuetzt Bilder, die im Editor hochgeladen, aber noch nicht gespeichert sind.
 */
async function collectOrphanUploads(ctx) {
    const cutoff = new Date(Date.now() - ORPHAN_UPLOAD_GRACE_MS).toISOString();
    const filenames = await ctx.db.transaction(async (tx) => {
        const orphans = await tx.all(
            `SELECT u.filename FROM uploads u
             WHERE u.kind = 'blueprint' AND u.created_at < ?
               AND NOT EXISTS (SELECT 1 FROM blueprints b WHERE instr(b.content, u.filename) > 0)
               AND NOT EXISTS (SELECT 1 FROM sessions s WHERE instr(s.snapshot, u.filename) > 0)
               AND NOT EXISTS (SELECT 1 FROM board_states bs WHERE instr(bs.sets, u.filename) > 0)`,
            [cutoff]
        );
        for (const { filename } of orphans) {
            await tx.run('DELETE FROM uploads WHERE filename = ?', [filename]);
        }
        return orphans.map((row) => row.filename);
    });
    await removeUploads(ctx.config.uploadsDir, filenames, ctx.logger);
    return filenames.length;
}

module.exports = {
    nowIso,
    collectOrphanUploads,
    normalizeBlueprintContent,
    getOwnedBlueprint,
    getActiveSession,
    getSession,
    getOwnedSession,
    createSession,
    createBoardSession,
    closeSession,
    reopenSession,
    startGame,
    endGame,
    switchBlueprint,
    updateTeamLimit,
    createTeam,
    deleteTeam,
    deleteClosedSession,
    purgeExpiredSessions
};
