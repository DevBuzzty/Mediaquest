'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { collectOrphanUploads } = require('../src/lib/sessions');
const { containsBadWords } = require('../src/lib/filter');
const { socketSchemas, parse } = require('../src/lib/schemas');
const { createHarness, emit, nextEvent, collect, sleep, expectAlive, PASSWORD, QR_CONTENT, PNG } = require('./helpers');

function recordingLogger() {
    const errors = [];
    const silent = () => {};
    return { errors, error: (message, detail) => errors.push({ message, detail }), warn: silent, info: silent, debug: silent };
}

const logger = recordingLogger();
let h;
before(async () => { h = await createHarness({ logger }); });
after(async () => { await h.stop(); });

async function runningGame(options) {
    const opened = await h.openSession(options);
    const team = await h.team(opened.code);
    await opened.teacher.post('/api/sessions/active/start');
    const teamSocket = await h.teamSocket(team, opened.sessionId);
    const teacherSocket = await opened.teacher.socket();
    await emit(teacherSocket, 'joinSessionRoom', { sessionId: opened.sessionId });
    return { ...opened, team, teamSocket, teacherSocket };
}

const nested = (depth, leaf = 1) => '['.repeat(depth) + leaf + ']'.repeat(depth);

// --- Ergebnis-Ansicht fuer Teams -------------------------------------------------

test('Ergebnisse: Teams bekommen keine Team-Codes und IDs anderer Teams', async () => {
    const game = await runningGame();
    const other = await h.team(game.code, { color: '#ef4444' });
    await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'Mein Tipp' });
    await emit(game.teacherSocket, 'showResults', { sessionId: game.sessionId });

    const response = await other.get(`/api/sessions/${game.sessionId}/results`);
    assert.equal(response.status, 200);
    assert.equal(response.text.includes(game.team.state.teamCode), false);
    assert.deepEqual(Object.keys(response.body.submissions[0]).sort(), ['content', 'created_at', 'task_title', 'team_color', 'team_name', 'type']);
    assert.equal(response.body.submissions[0].content, 'Mein Tipp');

    const asTeacher = await game.teacher.get(`/api/sessions/${game.sessionId}/results`);
    assert.equal(asTeacher.body.submissions[0].team_code, game.team.state.teamCode);
});

// --- Stationen und Ende ----------------------------------------------------------

test('Station: ohne openStation werden Start, Ergebnis und Einsendung abgelehnt', async () => {
    const game = await runningGame({ content: QR_CONTENT });
    const socket = game.teamSocket;
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'STATION_NOT_OPEN');
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' })).code, 'STATION_NOT_OPEN');
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'skipped' })).code, 'STATION_NOT_OPEN');
    assert.equal((await emit(socket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'x' })).code, 'STATION_NOT_OPEN');
    const { count } = await h.db.get('SELECT COUNT(*) AS count FROM task_results WHERE team_id = ?', [game.team.state.teamId]);
    assert.equal(count, 0);
    const submissions = await h.db.get('SELECT COUNT(*) AS count FROM submissions WHERE team_id = ?', [game.team.state.teamId]);
    assert.equal(submissions.count, 0);

    assert.equal((await emit(socket, 'openStation', { code: 'BBB222' })).ok, true);
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-1' })).ok, true);
    assert.equal((await emit(socket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'x' })).ok, true);
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-1', status: 'completed' })).ok, true);
});

test('Station: nach dem Abbruch braucht es den Code erneut', async () => {
    const game = await runningGame({ content: QR_CONTENT });
    const socket = game.teamSocket;
    await emit(socket, 'openStation', { code: 'AAA111' });
    await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'skipped' });
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'STATION_NOT_OPEN');
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' })).code, 'STATION_NOT_OPEN');
    assert.equal((await emit(socket, 'openStation', { code: 'AAA111' })).ok, true);
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' })).ok, true);
});

test('Nach finishStations ändert sich der Stand des Teams nicht mehr', async () => {
    const game = await runningGame({ content: QR_CONTENT });
    const socket = game.teamSocket;
    await emit(socket, 'openStation', { code: 'AAA111' });
    await emit(socket, 'openStation', { code: 'BBB222' });
    assert.equal((await emit(socket, 'finishStations')).progress.completed, 0);

    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'ALREADY_FINISHED');
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' })).code, 'ALREADY_FINISHED');
    assert.equal((await emit(socket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'spät' })).code, 'ALREADY_FINISHED');

    const state = (await game.team.get('/api/team/me')).body;
    assert.equal(state.progress.completed, 0);
    assert.equal(state.phase, 'finished');
});

test('Normalmodus: Fertig mit übersprungenen Aufgaben bleibt fertig', async () => {
    const game = await runningGame();
    const socket = game.teamSocket;
    for (const taskKey of ['1-0', '1-1', '1-2']) {
        await emit(socket, 'reportTaskResult', { taskKey, status: 'skipped' });
    }
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'ALREADY_FINISHED');
    const { progress } = (await game.team.get('/api/team/me')).body;
    assert.equal(progress.finished, true);
    assert.equal(progress.skipped, 3);
    assert.equal(progress.currentIndex, null);
});

test('Normalmodus: Start macht eine übersprungene Aufgabe nicht wieder offen', async () => {
    const game = await runningGame();
    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'skipped' });
    const started = await emit(game.teamSocket, 'reportTaskStart', { taskKey: '1-0' });
    assert.equal(started.ok, true);
    assert.equal(started.progress.tasks[0].status, 'skipped');
    assert.equal(started.progress.currentIndex, 1);
});

// --- Sockets ohne HTTP-Session ----------------------------------------------------

test('Neue Anmeldung im selben Browser trennt die Sockets der alten Anmeldung', async () => {
    const opened = await h.openSession();
    const second = await h.createTeacherRow();
    const socket = await opened.teacher.socket();
    await emit(socket, 'joinSessionRoom', { sessionId: opened.sessionId });
    const seen = collect(socket, ['teamCreated']);
    const disconnected = nextEvent(socket, 'disconnect');

    assert.equal((await opened.teacher.post('/api/login', { username: second.username, password: PASSWORD })).status, 200);
    await disconnected;
    await h.team(opened.code);
    await sleep(30);
    assert.deepEqual(seen, []);
});

test('Abgelaufene HTTP-Session: Prune trennt den Socket', async () => {
    const opened = await h.openSession();
    const socket = await opened.teacher.socket();
    await emit(socket, 'joinSessionRoom', { sessionId: opened.sessionId });
    const seen = collect(socket, ['teamCreated']);
    const disconnected = nextEvent(socket, 'disconnect');

    const rows = await h.db.all("SELECT sid FROM http_sessions WHERE json_extract(sess, '$.teacherId') = ?", [opened.teacher.teacherId]);
    assert.equal(rows.length, 1);
    await h.db.run('UPDATE http_sessions SET expires = 1 WHERE sid = ?', [rows[0].sid]);
    assert.deepEqual(await h.store.prune(), [rows[0].sid]);

    await disconnected;
    await h.team(opened.code);
    await sleep(30);
    assert.deepEqual(seen, []);
});

test('Teamwechsel im selben Browser: Sockets verlassen die Räume des alten Teams', async () => {
    const first = await h.openSession();
    const team = await h.team(first.code);
    const other = await h.openSession();
    const otherTeam = await h.team(other.code, { color: '#ef4444' });
    const socket = await h.teamSocket(team, first.sessionId);
    const seen = collect(socket, ['teamDeleted', 'gameStarted']);

    assert.equal((await team.post('/api/rejoin', { teamCode: otherTeam.state.teamCode })).status, 200);
    await first.teacher.post('/api/sessions/active/start');
    await sleep(30);
    assert.deepEqual(seen, []);
});

// --- Uploads ------------------------------------------------------------------------

test('Chat-Knoten __proto__ wird abgelehnt und blockiert den Server nicht', async () => {
    const teacher = await h.teacher();
    const body = `{"title":"X","content":{"templateType":"normal","tasks":[{"type":"chat","nodes":{
        "start":{"text":"a","options":[{"label":"b","next":"__proto__"}]},
        "__proto__":{"text":"c","options":[{"label":"d","next":"__proto__"}]}}}]}}`;
    const response = await teacher.post('/api/blueprints', body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_BLUEPRINT');
    assert.match(response.body.details[0].message, /__proto__/);
    await expectAlive(h, assert);
});

test('Widersprüchliche Passwort-Regeln werden beim Speichern abgelehnt', async () => {
    const teacher = await h.teacher();
    const response = await teacher.post('/api/blueprints', {
        title: 'X',
        content: { templateType: 'normal', tasks: [{ type: 'password', rules: ['Mind. 8 Zeichen', 'Maximal 4 Zeichen'] }] }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_BLUEPRINT');
});

test('Profil mit doppelter Feld-Beschriftung wird abgelehnt, leere Passwort-Regeln sind erlaubt', async () => {
    const teacher = await h.teacher();
    const post = (task) => teacher.post('/api/blueprints', { title: 'X', content: { templateType: 'normal', tasks: [task] } });
    const duplicate = await post({ type: 'profile', fields: ['name'], customFields: ['Name'] });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.code, 'INVALID_BLUEPRINT');
    assert.match(duplicate.body.details[0].message, /doppelt/);

    const noRules = await post({ type: 'password', rules: [] });
    assert.equal(noRules.status, 201);
    assert.deepEqual(noRules.body.blueprint.content.tasks[0].rules, []);
});

test('Upload-Limit hält auch bei parallelen Anfragen, ohne Dateien zu hinterlassen', async () => {
    const limited = await createHarness({ overrides: { maxUploadsPerTeam: 3 } });
    try {
        const { code } = await limited.openSession();
        const team = await limited.team(code);
        const responses = await Promise.all(Array.from({ length: 12 }, () => team.upload('/api/upload', PNG)));
        assert.equal(responses.filter((r) => r.status === 201).length, 3);
        assert.equal(responses.filter((r) => r.status === 409 && r.body.code === 'UPLOAD_LIMIT').length, 9);
        assert.equal(fs.readdirSync(limited.config.uploadsDir).length, 3);
        const { count } = await limited.db.get('SELECT COUNT(*) AS count FROM uploads');
        assert.equal(count, 3);
    } finally {
        await limited.stop();
    }
});

test('Lehrkräfte haben ein eigenes Upload-Limit, auch bei parallelen Anfragen', async () => {
    const limited = await createHarness({ overrides: { maxUploadsPerTeacher: 2 } });
    try {
        const teacher = await limited.teacher();
        const responses = await Promise.all(Array.from({ length: 6 }, () => teacher.upload('/api/upload', PNG)));
        assert.equal(responses.filter((r) => r.status === 201).length, 2);
        assert.equal((await teacher.upload('/api/upload', PNG)).body.code, 'UPLOAD_LIMIT');
        assert.equal(fs.readdirSync(limited.config.uploadsDir).length, 2);
        const other = await limited.teacher();
        assert.equal((await other.upload('/api/upload', PNG)).status, 201);
    } finally {
        await limited.stop();
    }
});

test('Verwaiste Lehrkraft-Bilder werden gelöscht, genutzte und neue bleiben', async () => {
    const teacher = await h.teacher();
    const uploadOne = async () => (await teacher.upload('/api/upload', PNG)).body.url;
    const [orphan, inBlueprint, inSnapshot, fresh] = [await uploadOne(), await uploadOne(), await uploadOne(), await uploadOne()];
    const task = (image) => ({ type: 'hotspot', question: 'Q', image, zones: [{ x: 10, y: 10, w: 20, h: 20 }] });
    const created = await h.createBlueprint(teacher, { templateType: 'normal', tasks: [task(inBlueprint)] });
    const forSession = await h.createBlueprint(teacher, { templateType: 'normal', tasks: [task(inSnapshot)] });
    await teacher.post('/api/sessions', { blueprintId: forSession.id, maxTeams: 2 });
    await teacher.delete(`/api/blueprints/${forSession.id}`);

    const name = (url) => path.basename(url);
    const old = '2020-01-01T00:00:00.000Z';
    for (const url of [orphan, inBlueprint, inSnapshot]) {
        await h.db.run('UPDATE uploads SET created_at = ? WHERE filename = ?', [old, name(url)]);
    }

    assert.equal(await collectOrphanUploads({ db: h.db, config: h.config, logger: h.logger }), 1);
    const onDisk = (url) => fs.existsSync(path.join(h.config.uploadsDir, name(url)));
    assert.equal(onDisk(orphan), false);
    assert.equal(onDisk(inBlueprint), true);
    assert.equal(onDisk(inSnapshot), true);
    assert.equal(onDisk(fresh), true);
    assert.equal((await teacher.get(inBlueprint)).status, 200);
    assert.ok(created.id);
});

test('Foto ersetzen löscht keine Datei, die eine andere Einsendung noch nutzt', async () => {
    const content = { templateType: 'normal', tasks: [{ type: 'photo', question: 'A' }, { type: 'photo', question: 'B' }] };
    const game = await runningGame({ content });
    const first = (await game.team.upload('/api/upload?purpose=submission', PNG)).body.url;
    const second = (await game.team.upload('/api/upload?purpose=submission', PNG)).body.url;
    await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-0', type: 'photo', content: first });
    await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'photo', content: first });

    await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-0', type: 'photo', content: second });
    assert.equal((await game.team.get(first)).status, 200, 'Aufgabe B nutzt die Datei noch');

    await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'photo', content: second });
    assert.equal((await game.team.get(first)).status, 404, 'jetzt nutzt sie niemand mehr');
    assert.equal(fs.existsSync(path.join(h.config.uploadsDir, path.basename(first))), false);
    assert.equal((await game.team.get(second)).status, 200);
});

test('DATA_DIR in einem versteckten Ordner: Bilder werden ausgeliefert', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-dot-'));
    const hidden = await createHarness({ env: { DATA_DIR: path.join(base, '.local', 'weltenretter') } });
    try {
        const teacher = await hidden.teacher();
        const { body } = await teacher.upload('/api/upload', PNG);
        const response = await teacher.request('GET', body.url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/png');
    } finally {
        await hidden.stop();
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

// --- Fehlerantworten ------------------------------------------------------------------

test('Kaputte Anfragen ergeben 4xx ohne Eintrag im Fehlerlog', async () => {
    const teacher = await h.teacher();
    const anonymous = h.client();
    logger.errors.length = 0;

    const raw = (url, init) => fetch(h.base + url, { ...init, headers: { cookie: teacher.cookie, ...init.headers } });
    const boundary = 'grenze';
    const cases = [
        ['Upload-Pfad', await anonymous.get('/uploads/%E0%A4%A')],
        ['Spielrunde-Pfad', await teacher.patch('/api/blueprints/%E0%A4%A', {})],
        ['gzip', await teacher.request('POST', '/api/login', 'kein gzip', { 'content-encoding': 'gzip' })],
        ['ohne Boundary', await raw('/api/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'x' })],
        ['abgeschnitten', await raw('/api/upload', {
            method: 'POST',
            headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
            body: `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc`
        })],
        ['tief verschachtelt', await teacher.post('/api/blueprints', `{"title":"X","content":{"tasks":[{"type":"statement","question":${nested(200000)}}]}}`)]
    ];
    for (const [name, response] of cases) {
        assert.equal(response.status, 400, name);
        const body = typeof response.json === 'function' ? await response.json() : response.body;
        assert.equal(typeof body.error, 'string', name);
        assert.doesNotMatch(body.error, /[Ii]nvalid|Unexpected|Boundary|decode|Maximum/, name);
    }
    assert.deepEqual(logger.errors, []);
});

test('Abgebrochener Upload ergibt keinen Eintrag im Fehlerlog', async () => {
    const teacher = await h.teacher();
    logger.errors.length = 0;
    const { port } = h.server.address();
    await new Promise((resolve, reject) => {
        const connection = net.connect(port, '127.0.0.1', () => {
            connection.write([
                'POST /api/upload HTTP/1.1', 'Host: 127.0.0.1', `Cookie: ${teacher.cookie}`,
                'Content-Type: multipart/form-data; boundary=grenze', 'Content-Length: 100000', '', '',
                '--grenze\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc'
            ].join('\r\n'), () => setTimeout(() => { connection.destroy(); resolve(); }, 50));
        });
        connection.on('error', reject);
    });
    await sleep(100);
    assert.deepEqual(logger.errors, []);
    await expectAlive(h, assert);
});

test('Tief verschachtelte Antwort ist ein Eingabefehler', async () => {
    const deep = (depth) => {
        let value = 1;
        for (let i = 0; i < depth; i += 1) value = [value];
        return value;
    };
    const game = await runningGame();
    logger.errors.length = 0;
    // Viel tiefer kommt der socket.io-Client selbst nicht; das Schema pruft daher zusaetzlich direkt.
    const ack = await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: deep(100) });
    assert.equal(ack.code, 'INVALID_INPUT');
    assert.deepEqual(logger.errors, []);
    assert.equal((await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: deep(10) })).ok, true);

    assert.throws(() => parse(socketSchemas.taskResult, { taskKey: '1-0', status: 'completed', answer: deep(200000) }), (err) => err.code === 'INVALID_INPUT');
});

test('Falscher Body-Typ ergibt deutsche Meldungen auf allen Routen', async () => {
    const teacher = await h.teacher();
    const blueprint = await h.createBlueprint(teacher);
    const joined = h.client();
    const { code } = await h.openSession();
    await joined.post('/api/join', { code });
    for (const [client, method, url] of [
        [h.client(), 'POST', '/api/login'],
        [h.client(), 'POST', '/api/register'],
        [h.client(), 'POST', '/api/join'],
        [h.client(), 'POST', '/api/rejoin'],
        [joined, 'POST', '/api/teams'],
        [teacher, 'POST', '/api/change-password'],
        [teacher, 'POST', '/api/blueprints'],
        [teacher, 'PATCH', `/api/blueprints/${blueprint.id}`],
        [teacher, 'POST', '/api/sessions'],
        [teacher, 'PATCH', '/api/sessions/active/limit'],
        [teacher, 'PATCH', '/api/sessions/active/mode']
    ]) {
        const response = await client.request(method, url, '[]');
        assert.equal(response.status, 400, url);
        assert.doesNotMatch(response.body.error, /Invalid|expected|received/, url);
    }
});

// --- Unsichtbare Zeichen ---------------------------------------------------------------

test('Teamname: unsichtbare Zeichen zählen nicht', async () => {
    const { code } = await h.openSession({ maxTeams: 10 });
    const client = h.client();
    await client.post('/api/join', { code });
    for (const name of ['​', '​‍﻿', ' ­ ', 'ㅤ', '!!!']) {
        const response = await client.post('/api/teams', { name, color: '#3b82f6', groupSize: 1 });
        assert.equal(response.status, 400, JSON.stringify(name));
    }
    assert.equal((await client.post('/api/teams', { name: 'Sch​eiße', color: '#3b82f6', groupSize: 1 })).status, 400);
    const created = await client.post('/api/teams', { name: 'Te​am 7', color: '#3b82f6', groupSize: 1 });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Team 7');
});

test('Filter erkennt Wörter trotz unsichtbarer Zeichen', () => {
    assert.equal(containsBadWords('sch​eisse'), true);
    assert.equal(containsBadWords('f­uck'), true);
    assert.equal(containsBadWords('Forscher​team'), false);
});
