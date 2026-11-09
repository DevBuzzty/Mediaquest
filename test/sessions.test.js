'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHarness, emit, nextEvent, expectAlive, NORMAL_CONTENT, QR_CONTENT, SCROLLER_POSTS, PNG } = require('./helpers');

let h;
before(async () => { h = await createHarness(); });
after(async () => { await h.stop(); });

test('Teamgröße: nur ganze Zahlen von 1 bis 10', async () => {
    const { code } = await h.openSession();
    const client = h.client();
    await client.post('/api/join', { code });
    for (const groupSize of ['<img src=x onerror=alert(1)>', 0, -1, 11, 2.5, '3', null, {}]) {
        const response = await client.post('/api/teams', { name: 'Team', color: '#3b82f6', groupSize });
        assert.equal(response.status, 400, `groupSize ${JSON.stringify(groupSize)}`);
    }
    await expectAlive(h, assert);
    const created = await client.post('/api/teams', { name: 'Team', color: '#3b82f6', groupSize: 10 });
    assert.equal(created.status, 201);
    assert.equal(created.body.groupSize, 10);
});

test('Teamerstellung braucht den vorherigen Join mit Session-Code', async () => {
    const { sessionId } = await h.openSession();
    const client = h.client();
    const response = await client.post('/api/teams', { sessionId, name: 'Fremd', color: '#3b82f6', groupSize: 1 });
    assert.equal(response.status, 403);
});

test('Teamname: Filter greift auch bei Umlauten und ß, ungültige Farbe wird abgelehnt', async () => {
    const { code } = await h.openSession();
    const client = h.client();
    await client.post('/api/join', { code });
    for (const name of ['Scheiße', 'SCHEISSE', 'miststück', 'Sch31sse']) {
        const response = await client.post('/api/teams', { name, color: '#3b82f6', groupSize: 1 });
        assert.equal(response.status, 400, name);
    }
    assert.equal((await client.post('/api/teams', { name: 'Fußballer', color: 'red', groupSize: 1 })).status, 400);
    assert.equal((await client.post('/api/teams', { name: 'Fußballer', color: '#3b82f6', groupSize: 1 })).status, 201);
});

test('Team-Limit: auch bei gleichzeitigen Anfragen nie überschritten', async () => {
    const { code, sessionId } = await h.openSession({ maxTeams: 2 });
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316'];
    const clients = colors.map(() => h.client());
    await Promise.all(clients.map((client) => client.post('/api/join', { code })));
    const responses = await Promise.all(clients.map((client, i) => client.post('/api/teams', { name: `T${i}`, color: colors[i], groupSize: 1 })));
    assert.equal(responses.filter((response) => response.status === 201).length, 2);
    assert.equal(responses.filter((response) => response.status === 409).length, 3);
    const { count } = await h.db.get('SELECT COUNT(*) AS count FROM teams WHERE session_id = ?', [sessionId]);
    assert.equal(count, 2);
});

test('Farbe: bei gleichzeitigen Anfragen genau einmal vergeben', async () => {
    const { code, sessionId } = await h.openSession({ maxTeams: 10 });
    const clients = Array.from({ length: 4 }, () => h.client());
    await Promise.all(clients.map((client) => client.post('/api/join', { code })));
    const responses = await Promise.all(clients.map((client, i) => client.post('/api/teams', { name: `T${i}`, color: '#a855f7', groupSize: 1 })));
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.ok(responses.filter((response) => response.status !== 201).every((response) => response.body.code === 'COLOR_TAKEN'));
    const { count } = await h.db.get('SELECT COUNT(*) AS count FROM teams WHERE session_id = ?', [sessionId]);
    assert.equal(count, 1);
    await assert.rejects(
        h.db.run("INSERT INTO teams (session_id, name, color, team_code, created_at) VALUES (?, 'x', '#a855f7', 'ZZZZZZ', 'now')", [sessionId]),
        /UNIQUE/
    );
});

test('Team-Limit ändern: ungültige Werte werden abgelehnt', async () => {
    const { teacher, code } = await h.openSession({ maxTeams: 5 });
    await h.team(code, { color: '#ef4444' });
    await h.team(code, { color: '#22c55e' });
    for (const maxTeams of [null, 0, -1, 11, 'x', 2.5, undefined]) {
        assert.equal((await teacher.patch('/api/sessions/active/limit', { maxTeams })).status, 400, String(maxTeams));
    }
    assert.equal((await teacher.patch('/api/sessions/active/limit', { maxTeams: 1 })).status, 400);
    assert.equal((await teacher.patch('/api/sessions/active/limit', { maxTeams: 2 })).status, 200);
    assert.equal((await teacher.post('/api/sessions', { blueprintId: 1, maxTeams: 'viele' })).status, 400);
});

test('Spielrunde-Snapshot überlebt das Löschen und Bearbeiten der Vorlage', async () => {
    const { teacher, blueprint, code, sessionId } = await h.openSession();
    const team = await h.team(code);
    assert.equal(team.state.blueprint, null, 'vor dem Start keine Inhalte');

    await teacher.patch(`/api/blueprints/${blueprint.id}`, { title: 'Neu', content: { templateType: 'normal', tasks: [{ type: 'statement', question: 'Nur eine' }] } });
    assert.equal((await teacher.delete(`/api/blueprints/${blueprint.id}`)).status, 200);

    assert.equal((await teacher.post('/api/sessions/active/start')).status, 200);
    const active = (await teacher.get('/api/sessions/active')).body;
    assert.equal(active.session.blueprint.tasks.length, 3);
    assert.equal(active.session.blueprint.title, 'Testrunde');
    assert.equal(active.session.blueprint_id, null);

    const state = (await team.get('/api/team/me')).body;
    assert.equal(state.blueprint.tasks.length, 3);
    assert.equal(state.sessionId, sessionId);
});

test('Session beenden und neu anlegen benachrichtigt betroffene Clients', async () => {
    const { teacher, blueprint, code, sessionId } = await h.openSession();
    const team = await h.team(code);
    const socket = await h.teamSocket(team, sessionId);
    const closed = nextEvent(socket, 'sessionClosed');
    const created = await teacher.post('/api/sessions', { blueprintId: blueprint.id, maxTeams: 3 });
    assert.equal(created.status, 201);
    assert.deepEqual(await closed, { sessionId });
    const row = await h.db.get('SELECT status, game_status FROM sessions WHERE id = ?', [sessionId]);
    assert.deepEqual(row, { status: 'closed', game_status: 'waiting' });
    assert.equal((await team.get('/api/team/me')).body.role, 'none');
});

test('Reopen prüft den Besitz, bevor etwas geschlossen wird', async () => {
    const owner = await h.openSession();
    const stranger = await h.openSession();
    await owner.teacher.post('/api/sessions/close');
    const before = await h.db.get('SELECT status FROM sessions WHERE id = ?', [stranger.sessionId]);
    assert.equal(before.status, 'active');

    const denied = await stranger.teacher.post(`/api/sessions/${owner.sessionId}/reopen`);
    assert.equal(denied.status, 404);
    const after = await h.db.get('SELECT status FROM sessions WHERE id = ?', [stranger.sessionId]);
    assert.equal(after.status, 'active');
    const untouched = await h.db.get('SELECT status FROM sessions WHERE id = ?', [owner.sessionId]);
    assert.equal(untouched.status, 'closed');

    const ok = await owner.teacher.post(`/api/sessions/${owner.sessionId}/reopen`);
    assert.equal(ok.status, 200);
    const row = await h.db.get('SELECT status, game_status FROM sessions WHERE id = ?', [owner.sessionId]);
    assert.deepEqual(row, { status: 'active', game_status: 'waiting' });
});

test('Eine Lehrkraft hat nie zwei aktive Sessions', async () => {
    const { teacher, blueprint } = await h.openSession();
    await Promise.all(Array.from({ length: 5 }, () => teacher.post('/api/sessions', { blueprintId: blueprint.id, maxTeams: 2 })));
    const { count } = await h.db.get("SELECT COUNT(*) AS count FROM sessions WHERE teacher_id = ? AND status = 'active'", [teacher.teacherId]);
    assert.equal(count, 1);
});

test('Wiederaufnahme: Cookie und Team-Code liefern Team, Phase und Fortschritt', async () => {
    const { teacher, code, sessionId } = await h.openSession();
    const team = await h.team(code);
    await teacher.post('/api/sessions/active/start');
    const socket = await h.teamSocket(team, sessionId);
    const firstKey = `${1}-0`;
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: firstKey, status: 'completed', answer: { index: 1 } })).ok, true);

    const fromCookie = (await team.get('/api/team/me')).body;
    assert.equal(fromCookie.role, 'team');
    assert.equal(fromCookie.phase, 'running');
    assert.equal(fromCookie.progress.completed, 1);
    assert.equal(fromCookie.progress.currentIndex, 1);
    assert.equal(fromCookie.teamCode, team.state.teamCode);

    const device = h.client();
    assert.equal((await device.post('/api/rejoin', { teamCode: 'NOPE99' })).status, 404);
    const rejoined = await device.post('/api/rejoin', { teamCode: team.state.teamCode.toLowerCase() });
    assert.equal(rejoined.status, 200);
    assert.equal(rejoined.body.teamId, team.state.teamId);
    assert.equal(rejoined.body.progress.currentTaskKey, '1-1');
    assert.equal(rejoined.body.blueprint.tasks[0].question, 'Frage A');

    await teacher.post('/api/sessions/close');
    assert.equal((await device.post('/api/rejoin', { teamCode: team.state.teamCode })).status, 404);
});

test('Ein Gerät kann nicht mehrere Teams anlegen', async () => {
    const { code } = await h.openSession({ maxTeams: 5 });
    const team = await h.team(code);
    const second = await team.post('/api/teams', { name: 'Noch eins', color: '#22c55e', groupSize: 1 });
    assert.equal(second.status, 409);
});

test('Ergebnisse für Teams erst nach Freigabe, nur für Teams dieser Session', async () => {
    const owner = await h.openSession();
    const other = await h.openSession();
    const team = await h.team(owner.code);
    const stranger = await h.team(other.code);
    await owner.teacher.post('/api/sessions/active/start');

    assert.equal((await team.get(`/api/sessions/${owner.sessionId}/results`)).status, 403);
    assert.equal((await h.client().get(`/api/sessions/${owner.sessionId}/results`)).status, 403);

    const teacherSocket = await owner.teacher.socket();
    await emit(teacherSocket, 'joinSessionRoom', { sessionId: owner.sessionId });
    assert.equal((await emit(teacherSocket, 'showResults', { sessionId: owner.sessionId })).ok, true);

    const allowed = await team.get(`/api/sessions/${owner.sessionId}/results`);
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body.submissions, []);
    assert.equal(allowed.body.results, undefined, 'Teams sehen keine Antworten anderer Teams');
    assert.equal((await stranger.get(`/api/sessions/${owner.sessionId}/results`)).status, 403);
    assert.ok(Array.isArray((await owner.teacher.get(`/api/sessions/${owner.sessionId}/results`)).body.results));
});

test('Geschlossene Session löschen entfernt alle Daten samt Fotos', async () => {
    const { teacher, code, sessionId } = await h.openSession();
    const team = await h.team(code);
    await teacher.post('/api/sessions/active/start');
    const uploaded = await team.upload('/api/upload?purpose=submission', PNG);
    assert.equal(uploaded.status, 201);
    const file = path.join(h.config.uploadsDir, path.basename(uploaded.body.url));
    assert.ok(fs.existsSync(file));
    const socket = await h.teamSocket(team, sessionId);
    assert.equal((await emit(socket, 'studentSubmission', { taskKey: '1-2', type: 'photo', content: uploaded.body.url })).ok, true);

    assert.equal((await teacher.delete(`/api/sessions/${sessionId}`)).status, 409, 'aktive Session bleibt');
    const foreign = await h.teacher();
    await teacher.post('/api/sessions/close');
    assert.equal((await foreign.delete(`/api/sessions/${sessionId}`)).status, 404);
    assert.equal((await teacher.delete(`/api/sessions/${sessionId}`)).status, 200);

    assert.equal(fs.existsSync(file), false);
    for (const table of ['sessions', 'teams', 'submissions', 'uploads', 'task_results']) {
        const column = table === 'sessions' ? 'id' : 'session_id';
        const { count } = await h.db.get(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`, [sessionId]);
        assert.equal(count, 0, table);
    }
});

test('Team löschen entfernt Einsendungen und Dateien und benachrichtigt das Team', async () => {
    const { teacher, code, sessionId } = await h.openSession();
    const team = await h.team(code, { color: '#22c55e' });
    await teacher.post('/api/sessions/active/start');
    const uploaded = await team.upload('/api/upload?purpose=submission', PNG);
    const file = path.join(h.config.uploadsDir, path.basename(uploaded.body.url));
    const socket = await h.teamSocket(team, sessionId);
    await emit(socket, 'studentSubmission', { taskKey: '1-2', type: 'photo', content: uploaded.body.url });

    const teacherSocket = await teacher.socket();
    await emit(teacherSocket, 'joinSessionRoom', { sessionId });
    const deletedForTeam = nextEvent(socket, 'teamDeleted');
    const freed = nextEvent(teacherSocket, 'colorFreed');

    const stranger = await h.teacher();
    assert.equal((await stranger.delete(`/api/teams/${team.state.teamId}`)).status, 404);
    assert.equal((await teacher.delete(`/api/teams/${team.state.teamId}`)).status, 200);

    assert.equal((await deletedForTeam).teamId, team.state.teamId);
    assert.equal((await freed).color, '#22c55e');
    assert.equal(fs.existsSync(file), false);
    const { count } = await h.db.get('SELECT COUNT(*) AS count FROM submissions WHERE team_id = ?', [team.state.teamId]);
    assert.equal(count, 0);
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).ok, false);
});

test('Live-Wechsel der Spielrunde: nur eigene, kein null, neuer Snapshot', async () => {
    const { teacher, code, sessionId } = await h.openSession();
    const stranger = await h.teacher();
    const foreign = await h.createBlueprint(stranger);
    const next = await h.createBlueprint(teacher, { templateType: 'normal', tasks: [{ type: 'statement', question: 'Neue Runde' }] }, 'Runde 2');
    const team = await h.team(code);
    await teacher.post('/api/sessions/active/start');
    const socket = await h.teamSocket(team, sessionId);

    assert.equal((await teacher.patch('/api/sessions/active/mode', { blueprintId: null })).status, 400);
    assert.equal((await teacher.patch('/api/sessions/active/mode', { blueprintId: foreign.id })).status, 404);

    const update = nextEvent(socket, 'gameModeUpdated');
    assert.equal((await teacher.patch('/api/sessions/active/mode', { blueprintId: next.id })).status, 200);
    const payload = await update;
    assert.equal(payload.blueprint.title, 'Runde 2');
    assert.equal(payload.blueprint.tasks[0].key, '2-0');

    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'UNKNOWN_TASK');
    const state = (await teacher.get('/api/sessions/active')).body;
    assert.equal(state.session.blueprint.title, 'Runde 2');
});

test('IDOR: fremde Spielrunden sind unerreichbar', async () => {
    const owner = await h.teacher();
    const attacker = await h.teacher();
    const blueprint = await h.createBlueprint(owner);

    assert.equal((await attacker.patch(`/api/blueprints/${blueprint.id}`, { title: 'X', content: NORMAL_CONTENT })).status, 404);
    assert.equal((await attacker.delete(`/api/blueprints/${blueprint.id}`)).status, 404);
    assert.equal((await attacker.post('/api/sessions', { blueprintId: blueprint.id, maxTeams: 2 })).status, 404);
    const list = await attacker.get('/api/blueprints');
    assert.ok(!list.body.blueprints.some((entry) => entry.id === blueprint.id));
    const row = await h.db.get('SELECT title FROM blueprints WHERE id = ?', [blueprint.id]);
    assert.equal(row.title, 'Testrunde');

    assert.equal((await h.client().get('/api/blueprints')).status, 401);
    assert.equal((await owner.delete('/api/blueprints/abc')).status, 400);
});

test('Spielrunden mit Soft-Lock werden abgelehnt, mit Angabe der Aufgabe', async () => {
    const teacher = await h.teacher();
    const check = async (tasks, templateType = 'normal') => {
        const response = await teacher.post('/api/blueprints', { title: 'X', content: { templateType, tasks } });
        return response;
    };
    const invalid = await check([{ type: 'statement' }, { type: 'choice', options: [] }]);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_BLUEPRINT');
    assert.equal(invalid.body.details[0].taskIndex, 1);

    for (const task of [
        { type: 'nope' },
        { type: 'hotspot', image: '/img/beispiel-phishing.svg', zones: [] },
        { type: 'bucket', buckets: ['A', 'B'], items: [] },
        { type: 'chat', nodes: 'kaputt' },
        { type: 'chat', nodes: { start: { text: 'a', options: [{ label: 'x', next: 'fehlt' }] } } },
        { type: 'chat', nodes: { start: { text: 'a', options: [{ label: 'x', next: 'start' }] } } },
        { type: 'scroller', posts: SCROLLER_POSTS.slice(0, 9) },
        { type: 'cloze', text: 'kein Platz' },
        { type: 'ranking', items: [] },
        { type: 'pairs', pairs: [] }
    ]) {
        assert.equal((await check([task])).status, 400, JSON.stringify(task));
    }
    assert.equal((await check('kaputt')).status, 400);
    assert.equal((await check([])).status, 400);
    assert.equal((await teacher.post('/api/blueprints', { title: 7, content: NORMAL_CONTENT })).status, 400);

    // Doppelte Stations-Codes sind verboten, fehlende werden erzeugt.
    assert.equal((await check([{ type: 'statement', code: 'ABC123' }, { type: 'statement', code: 'abc123' }], 'qr')).status, 400);
    const filled = await check([{ type: 'statement' }, { type: 'statement' }], 'qr');
    assert.equal(filled.status, 201);
    assert.match(filled.body.blueprint.content.tasks[0].code, /^\d{6}$/);
});

test('Inhalte aus falschem Typ werden beim Speichern entfernt', async () => {
    const teacher = await h.teacher();
    const created = await h.createBlueprint(teacher, {
        templateType: 'normal',
        tasks: [{ type: 'statement', question: 'Frage mit "Anführung" und Apostroph\'s', options: ['alt'], posts: [], nodes: {} }]
    });
    const task = created.content.tasks[0];
    assert.equal(task.question, 'Frage mit "Anführung" und Apostroph\'s');
    assert.equal(task.options, undefined);
    assert.equal(task.nodes, undefined);
});

test('QR-Vorlagen: Codes erreichen die Lehrkraft, aber nicht die Teams', async () => {
    const { teacher, code } = await h.openSession({ content: QR_CONTENT });
    const team = await h.team(code);
    const started = await teacher.post('/api/sessions/active/start');
    assert.equal(started.body.blueprint.tasks[0].code, 'AAA111');
    const state = (await team.get('/api/team/me')).body;
    assert.equal(state.blueprint.tasks[0].code, undefined);
    assert.equal(state.blueprint.templateType, 'qr');
});

test('Nicht angemeldete Clients erreichen keine Lehrkraft-Routen', async () => {
    const client = h.client();
    for (const [method, url] of [
        ['GET', '/api/sessions/active'], ['POST', '/api/sessions/close'], ['GET', '/api/sessions/history'],
        ['POST', '/api/sessions/active/start'], ['POST', '/api/sessions/active/end'], ['DELETE', '/api/teams/1'],
        ['DELETE', '/api/sessions/1'], ['POST', '/api/sessions/1/reopen'], ['GET', '/api/sessions/1/teams']
    ]) {
        assert.equal((await client.request(method, url)).status, 401, url);
    }
    assert.equal((await client.get('/api/gibt-es-nicht')).status, 404);
});

test('Ereignisse im Lobby-Raum: Farben und Spielstart ohne Inhalte', async () => {
    const { teacher, code, sessionId } = await h.openSession();
    const joiner = h.client();
    await joiner.post('/api/join', { code });
    const socket = await joiner.socket();
    const lobby = await emit(socket, 'joinLobby');
    assert.equal(lobby.ok, true);
    assert.deepEqual(lobby.state.takenColors, []);

    const picked = nextEvent(socket, 'colorPicked');
    const team = await h.team(code, { color: '#ec4899' });
    assert.deepEqual(await picked, { sessionId, color: '#ec4899' });

    const started = nextEvent(socket, 'gameStarted');
    await teacher.post('/api/sessions/active/start');
    const payload = await started;
    assert.equal(payload.blueprint, undefined, 'die Lobby bekommt keine Aufgaben');
    assert.equal(payload.gameStatus, 'running');

    const freed = nextEvent(socket, 'colorFreed');
    await teacher.delete(`/api/teams/${team.state.teamId}`);
    assert.equal((await freed).color, '#ec4899');
});

test('Teamlimit-Änderung und Spielende erreichen die Clients', async () => {
    const { teacher, code, sessionId } = await h.openSession();
    const team = await h.team(code);
    const joiner = h.client();
    await joiner.post('/api/join', { code });
    const lobbySocket = await joiner.socket();
    await emit(lobbySocket, 'joinLobby');
    const socket = await h.teamSocket(team, sessionId);
    await teacher.post('/api/sessions/active/start');

    const limit = nextEvent(lobbySocket, 'teamLimitUpdated');
    await teacher.patch('/api/sessions/active/limit', { maxTeams: 7 });
    assert.equal((await limit).maxTeams, 7);

    const ended = nextEvent(socket, 'gameEnded');
    await teacher.post('/api/sessions/active/end');
    assert.deepEqual(await ended, { sessionId });
    assert.equal((await team.get('/api/team/me')).body.phase, 'lobby');
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'NOT_RUNNING');
});

test('Automatische Löschung abgelaufener Sessions', async () => {
    const { purgeExpiredSessions } = require('../src/lib/sessions');
    const { teacher, sessionId } = await h.openSession();
    await teacher.post('/api/sessions/close');
    await h.db.run("UPDATE sessions SET closed_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [sessionId]);

    assert.equal(await purgeExpiredSessions({ config: { retentionDays: 0 }, db: h.db, logger: h.logger }), 0);
    const purged = await purgeExpiredSessions({ config: { retentionDays: 30, uploadsDir: h.config.uploadsDir }, db: h.db, logger: h.logger });
    assert.ok(purged >= 1);
    assert.equal(await h.db.get('SELECT id FROM sessions WHERE id = ?', [sessionId]), undefined);
});

test('Datenbank: Migrationen und Fremdschlüssel sind aktiv', async () => {
    assert.equal((await h.db.get('PRAGMA user_version')).user_version, 3);
    assert.equal((await h.db.get('PRAGMA foreign_keys')).foreign_keys, 1);
});

test('Demo-Konten nur außerhalb des Betriebs oder mit SEED_DEMO', async () => {
    const withDemo = await createHarness({ env: { SEED_DEMO: 'true' } });
    try {
        const { count } = await withDemo.db.get("SELECT COUNT(*) AS count FROM teachers WHERE username IN ('admin', 'test')");
        assert.equal(count, 2);
        const blueprints = await withDemo.db.get('SELECT COUNT(*) AS count FROM blueprints');
        assert.equal(blueprints.count, 18); // je Konto 3 Spielrunden und 6 Kartensets
    } finally {
        await withDemo.stop();
    }
    const production = await createHarness({
        env: { NODE_ENV: 'production', SESSION_SECRET: 'a-very-long-secret-value-0123456789-abcdefgh', COOKIE_SECURE: 'false', TRUST_PROXY: 'false', SEED_DEMO: undefined, SESSION_RETENTION_DAYS: '0' }
    });
    try {
        const { count } = await production.db.get('SELECT COUNT(*) AS count FROM teachers');
        assert.equal(count, 0);
    } finally {
        await production.stop();
    }
});
