'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, emit, nextEvent, collect, sleep, expectAlive, NORMAL_CONTENT, QR_CONTENT, PNG, PASSWORD } = require('./helpers');

const CLIENT_EVENTS = ['joinLobby', 'joinSessionRoom', 'reportTaskStart', 'openStation', 'reportTaskResult', 'finishStations', 'studentSubmission', 'showResults'];
const TEACHER_ONLY = ['teamCreated', 'teamTaskUpdate', 'teamTaskResult', 'teamFinished', 'newSubmission'];

let h;
before(async () => { h = await createHarness(); });
after(async () => { await h.stop(); });

async function runningGame(options) {
    const opened = await h.openSession(options);
    const team = await h.team(opened.code);
    await opened.teacher.post('/api/sessions/active/start');
    const teamSocket = await h.teamSocket(team, opened.sessionId);
    const teacherSocket = await opened.teacher.socket();
    const ack = await emit(teacherSocket, 'joinSessionRoom', { sessionId: opened.sessionId });
    assert.equal(ack.ok, true);
    return { ...opened, team, teamSocket, teacherSocket, teacherAck: ack };
}

test('fehlende und kaputte Nutzdaten bringen den Prozess nicht zum Absturz', async () => {
    const { teamSocket, teacherSocket } = await runningGame();
    const anonymous = await h.client().socket();
    const bad = [undefined, null, 1, 'text', [], { sessionId: 'x' }, { taskKey: 5 }, { sessionId: { $gt: 0 } }];
    for (const event of CLIENT_EVENTS) {
        for (const payload of bad) {
            for (const socket of [teamSocket, teacherSocket, anonymous]) {
                socket.emit(event, payload);
                const ack = await emit(socket, event, payload);
                assert.equal(typeof ack.ok, 'boolean');
            }
        }
        // Ohne Payload und ohne Ack-Funktion
        anonymous.emit(event);
        teamSocket.emit(event);
    }
    await sleep(100);
    await expectAlive(h, assert);
});

test('anonyme Sockets dürfen keinem Raum beitreten und nichts auslösen', async () => {
    const game = await runningGame();
    const socket = await h.client().socket();
    const seen = collect(socket, [...TEACHER_ONLY, 'displayResults']);

    assert.equal((await emit(socket, 'joinSessionRoom', { sessionId: game.sessionId })).ok, false);
    assert.equal((await emit(socket, 'joinLobby')).ok, false);
    assert.equal((await emit(socket, 'showResults', { sessionId: game.sessionId })).ok, false);
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: '1-0' })).ok, false);
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' })).ok, false);
    assert.equal((await emit(socket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'x' })).ok, false);
    assert.equal((await emit(socket, 'openStation', { code: 'AAA111' })).ok, false);
    assert.equal((await emit(socket, 'finishStations')).ok, false);

    await emit(game.teamSocket, 'reportTaskStart', { taskKey: '1-0' });
    await sleep(50);
    assert.deepEqual(seen, []);
});

test('joinSessionRoom: nur die eigene Lehrkraft oder Teams dieser Session', async () => {
    const owner = await h.openSession();
    const other = await h.openSession();
    const team = await h.team(owner.code);
    const foreignTeam = await h.team(other.code);

    const ownerSocket = await owner.teacher.socket();
    const foreignTeacherSocket = await other.teacher.socket();
    const foreignTeamSocket = await foreignTeam.socket();
    const teamSocket = await team.socket();

    assert.equal((await emit(ownerSocket, 'joinSessionRoom', { sessionId: owner.sessionId })).role, 'teacher');
    assert.equal((await emit(teamSocket, 'joinSessionRoom', { sessionId: owner.sessionId })).role, 'team');
    assert.equal((await emit(foreignTeacherSocket, 'joinSessionRoom', { sessionId: owner.sessionId })).ok, false);
    assert.equal((await emit(foreignTeamSocket, 'joinSessionRoom', { sessionId: owner.sessionId })).ok, false);
});

test('Teamdaten erreichen nur die Lehrkraft, nicht andere Teams', async () => {
    const game = await runningGame();
    const other = await h.team(game.code, { color: '#ef4444' });
    const otherSocket = await h.teamSocket(other, game.sessionId);
    const seen = collect(otherSocket, TEACHER_ONLY);
    const teacherUpdate = nextEvent(game.teacherSocket, 'teamTaskUpdate');

    await emit(game.teamSocket, 'reportTaskStart', { taskKey: '1-0' });
    const update = await teacherUpdate;
    await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'Mein Tipp' });
    await sleep(50);

    assert.deepEqual(seen, []);
    assert.equal(update.teamId, game.team.state.teamId);
    assert.equal(update.taskTitle, 'Frage A');
    assert.equal(update.status, 'started');
});

test('gefälschte teamId und sessionId in Nutzdaten werden ignoriert', async () => {
    const game = await runningGame();
    const victim = await h.team(game.code, { color: '#ef4444' });
    await emit(game.teamSocket, 'reportTaskResult', {
        taskKey: '1-0', status: 'completed', answer: { index: 0 }, teamId: victim.state.teamId, sessionId: 999
    });
    const rows = await h.db.all('SELECT team_id, session_id FROM task_results WHERE session_id = ?', [game.sessionId]);
    assert.deepEqual(rows, [{ team_id: game.team.state.teamId, session_id: game.sessionId }]);
});

test('showResults: nur die Lehrkraft der Session', async () => {
    const game = await runningGame();
    const stranger = await h.openSession();
    const strangerSocket = await stranger.teacher.socket();
    const seen = collect(game.teamSocket, ['displayResults']);

    assert.equal((await emit(game.teamSocket, 'showResults', { sessionId: game.sessionId })).ok, false);
    assert.equal((await emit(strangerSocket, 'showResults', { sessionId: game.sessionId })).ok, false);
    await sleep(30);
    assert.deepEqual(seen, []);
    assert.equal((await h.db.get('SELECT results_enabled AS r FROM sessions WHERE id = ?', [game.sessionId])).r, 0);

    const display = nextEvent(game.teamSocket, 'displayResults');
    assert.equal((await emit(game.teacherSocket, 'showResults', { sessionId: game.sessionId })).ok, true);
    assert.deepEqual(await display, { sessionId: game.sessionId });
});

test('Ergebnisse: Aufzeichnung ohne Bewertung, idempotent, Fertig-Status live', async () => {
    const game = await runningGame();
    const teamId = game.team.state.teamId;

    const updates = [];
    game.teacherSocket.on('teamTaskResult', (payload) => updates.push(payload));
    const finished = nextEvent(game.teacherSocket, 'teamFinished');

    const first = await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: { index: 1, label: 'Zwei' } });
    assert.equal(first.ok, true);
    assert.equal(first.progress.completed, 1);
    assert.equal(first.progress.currentIndex, 1);

    const repeat = await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'skipped', answer: { index: 0 } });
    assert.equal(repeat.alreadyCompleted, true, 'doppelte Meldung ändert nichts');

    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-1', status: 'completed', answer: { text: 'Tipp' } });
    const last = await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-2', status: 'skipped' });
    assert.equal(last.progress.finished, true);

    const event = await finished;
    assert.equal(event.teamId, teamId);
    assert.equal(event.explicit, false);
    await sleep(20);
    assert.equal(updates.length, 3);
    assert.deepEqual(updates[0].result.answer, { index: 1, label: 'Zwei' });
    assert.equal(updates[0].team.team_code, game.team.state.teamCode);

    const row = await h.db.get('SELECT status, answer FROM task_results WHERE team_id = ? AND task_key = ?', [teamId, '1-0']);
    assert.equal(row.status, 'completed');
    assert.deepEqual(JSON.parse(row.answer), { index: 1, label: 'Zwei' });
    const columns = await h.db.all("SELECT name FROM pragma_table_info('task_results')");
    assert.ok(!columns.some(({ name }) => /score|points|correct/i.test(name)));

    const after = (await game.teacher.get('/api/sessions/active')).body;
    const team = after.teams.find((entry) => entry.id === teamId);
    assert.equal(team.progress.finished, true);
    assert.equal(team.results.length, 3);
    assert.equal(team.team_code, game.team.state.teamCode);
    assert.equal((await game.team.get('/api/team/me')).body.phase, 'finished');
});

test('Aufgaben fremder Runden und unbekannte Keys werden abgelehnt', async () => {
    const game = await runningGame();
    assert.equal((await emit(game.teamSocket, 'reportTaskStart', { taskKey: '1-99' })).code, 'UNKNOWN_TASK');
    assert.equal((await emit(game.teamSocket, 'reportTaskResult', { taskKey: '9-0', status: 'completed' })).code, 'UNKNOWN_TASK');
    assert.equal((await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'done' })).code, 'INVALID_INPUT');
    const big = 'x'.repeat(20000);
    assert.equal((await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: { text: big } })).code, 'ANSWER_TOO_LARGE');
});

test('Passwort-Aufgaben speichern nie den eingegebenen Wert', async () => {
    const game = await runningGame({ content: { templateType: 'normal', tasks: [{ type: 'password', question: 'P', rules: ['Mind. 8 Zeichen'] }] } });
    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: { password: 'geheim1234', length: 10, rulesMet: [true] } });
    const row = await h.db.get('SELECT answer FROM task_results WHERE team_id = ?', [game.team.state.teamId]);
    assert.deepEqual(JSON.parse(row.answer), { length: 10, rulesMet: [true] });
});

test('Einsendungen tragen Teamdaten, Filter und Längenlimit greifen', async () => {
    const game = await runningGame();
    const live = nextEvent(game.teacherSocket, 'newSubmission');
    const ok = await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'Mein Tipp' });
    assert.equal(ok.ok, true);
    const payload = await live;
    assert.equal(payload.team_name, game.team.state.name);
    assert.equal(payload.team_color, game.team.state.color);
    assert.equal(payload.team_code, game.team.state.teamCode);
    assert.equal(payload.content, 'Mein Tipp');
    assert.equal(payload.task_title, 'Dein Tipp?');

    assert.equal((await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'Das ist Scheiße!' })).code, 'BAD_WORDS');
    assert.equal((await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'x'.repeat(2001) })).code, 'INVALID_INPUT');
    assert.equal((await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-0', type: 'statement', content: 'falscher Typ' })).code, 'WRONG_TYPE');

    // Lieferung nach Reload deckt sich mit dem Live-Ereignis
    const reloaded = (await game.teacher.get(`/api/sessions/${game.sessionId}/submissions`)).body.submissions;
    assert.deepEqual(reloaded, [payload]);
});

test('zu große Socket-Nachrichten trennen die Verbindung, der Server lebt weiter', async () => {
    const game = await runningGame();
    const disconnected = nextEvent(game.teamSocket, 'disconnect');
    game.teamSocket.emit('studentSubmission', { taskKey: '1-1', type: 'statement', content: 'y'.repeat(200 * 1024) });
    await disconnected;
    await expectAlive(h, assert);
});

test('Fotos: nur eigene Uploads, keine beliebigen URLs', async () => {
    const game = await runningGame();
    for (const content of ['javascript:alert(1)', 'https://evil.example/x.png', '/uploads/nicht-da.png', `/uploads/${'a'.repeat(32)}.png`]) {
        assert.equal((await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-2', type: 'photo', content })).code, 'INVALID_PHOTO', content);
    }
    const uploaded = await game.team.upload('/api/upload?purpose=submission', PNG);
    const other = await h.team(game.code, { color: '#ef4444' });
    const otherSocket = await h.teamSocket(other, game.sessionId);
    assert.equal((await emit(otherSocket, 'studentSubmission', { taskKey: '1-2', type: 'photo', content: uploaded.body.url })).code, 'INVALID_PHOTO');
    assert.equal((await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-2', type: 'photo', content: uploaded.body.url })).ok, true);
});

test('QR-Stationen: Abbruch zählt nicht, erledigte sind markiert, explizites Ende', async () => {
    const game = await runningGame({ content: QR_CONTENT });
    const socket = game.teamSocket;

    assert.equal((await emit(socket, 'openStation', { code: 'FALSCH' })).code, 'UNKNOWN_CODE');

    const opened = await emit(socket, 'openStation', { code: ' aaa111 ' });
    assert.equal(opened.ok, true);
    assert.equal(opened.taskKey, '1-0');
    assert.equal(opened.task.question, 'Station A');
    assert.equal(opened.task.code, undefined);

    const cancelled = await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'skipped' });
    assert.equal(cancelled.progress.tasks[0].status, 'skipped');
    assert.equal(cancelled.progress.finished, false);

    await emit(socket, 'openStation', { code: 'AAA111' });
    const done = await emit(socket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: { index: 0 } });
    assert.equal(done.progress.tasks[0].status, 'completed');
    assert.equal(done.progress.tasks[1].status, 'pending');
    assert.equal((await emit(socket, 'openStation', { code: 'AAA111' })).code, 'ALREADY_COMPLETED');

    const state = (await game.team.get('/api/team/me')).body;
    assert.equal(state.progress.completed, 1);

    const finished = nextEvent(game.teacherSocket, 'teamFinished');
    const end = await emit(socket, 'finishStations');
    assert.equal(end.progress.finished, true);
    assert.equal((await finished).explicit, true);
    assert.equal((await emit(socket, 'openStation', { code: 'BBB222' })).code, 'ALREADY_FINISHED');
});

test('QR-Stationen: alle erledigt bedeutet fertig', async () => {
    const game = await runningGame({ content: QR_CONTENT });
    const finished = nextEvent(game.teacherSocket, 'teamFinished');
    await emit(game.teamSocket, 'openStation', { code: 'AAA111' });
    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' });
    await emit(game.teamSocket, 'openStation', { code: 'BBB222' });
    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-1', status: 'completed' });
    assert.equal((await finished).explicit, false);
});

test('finishStations gibt es nur im QR-Modus', async () => {
    const game = await runningGame({ content: NORMAL_CONTENT });
    assert.equal((await emit(game.teamSocket, 'finishStations')).code, 'NOT_QR');
    assert.equal((await emit(game.teamSocket, 'openStation', { code: 'AAA111' })).code, 'NOT_QR');
});

test('Reconnect: joinSessionRoom liefert denselben Stand wie ein Reload', async () => {
    const game = await runningGame();
    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed', answer: { index: 1 } });

    const reconnected = await game.teacher.socket();
    const ack = await emit(reconnected, 'joinSessionRoom', { sessionId: game.sessionId });
    const reload = (await game.teacher.get('/api/sessions/active')).body;
    assert.deepEqual(ack.state, reload);
    assert.equal(ack.state.teams[0].progress.completed, 1);

    const teamSocket2 = await game.team.socket();
    const teamAck = await emit(teamSocket2, 'joinSessionRoom', { sessionId: game.sessionId });
    assert.deepEqual(teamAck.state, (({ role, ...rest }) => rest)((await game.team.get('/api/team/me')).body));
});

test('Team, das einem laufenden Spiel beitritt, ist live vollständig', async () => {
    const game = await runningGame();
    const live = nextEvent(game.teacherSocket, 'teamCreated');
    const late = await h.team(game.code, { color: '#f97316' });
    const payload = await live;
    assert.equal(payload.gameStatus, 'running');
    assert.equal(payload.team.team_code, late.state.teamCode);
    assert.equal(payload.team.progress.total, 3);
    assert.equal(late.state.phase, 'running');
    assert.equal(late.state.blueprint.tasks.length, 3);
});

test('Neuer Spielstart beginnt von vorn, alte Ergebnisse bleiben', async () => {
    const game = await runningGame();
    await emit(game.teamSocket, 'reportTaskResult', { taskKey: '1-0', status: 'completed' });
    await game.teacher.post('/api/sessions/active/end');
    const started = nextEvent(game.teamSocket, 'gameStarted');
    await game.teacher.post('/api/sessions/active/start');
    const payload = await started;
    assert.equal(payload.blueprint.tasks[0].key, '2-0');
    const state = (await game.team.get('/api/team/me')).body;
    assert.equal(state.progress.completed, 0);
    assert.equal(state.progress.currentIndex, 0);
    const { results } = (await game.teacher.get(`/api/sessions/${game.sessionId}/results`)).body;
    assert.equal(results.length, 1);
});

test('Abmeldung trennt den Socket der Lehrkraft', async () => {
    const opened = await h.openSession();
    const socket = await opened.teacher.socket();
    await emit(socket, 'joinSessionRoom', { sessionId: opened.sessionId });
    const disconnected = nextEvent(socket, 'disconnect');
    await opened.teacher.post('/api/logout');
    await disconnected;
    const fresh = await opened.teacher.socket();
    assert.equal((await emit(fresh, 'joinSessionRoom', { sessionId: opened.sessionId })).ok, false);
});

test('Geschlossene Session: Teams können nichts mehr melden', async () => {
    const game = await runningGame();
    await game.teacher.post('/api/sessions/close');
    assert.equal((await emit(game.teamSocket, 'reportTaskStart', { taskKey: '1-0' })).code, 'SESSION_CLOSED');
    assert.equal((await emit(game.teamSocket, 'studentSubmission', { taskKey: '1-1', type: 'statement', content: 'x' })).code, 'SESSION_CLOSED');
    assert.equal((await emit(game.teamSocket, 'joinSessionRoom', { sessionId: game.sessionId })).code, 'SESSION_CLOSED');
});

test('sessionOpened erreicht jeden Tab der Lehrkraft ohne Raumbeitritt, aber niemanden sonst', async () => {
    const teacher = await h.teacher();
    const blueprint = await h.createBlueprint(teacher);
    const otherTab = h.client();
    assert.equal((await otherTab.post('/api/login', { username: teacher.username, password: PASSWORD })).status, 200);

    const dashboard = await teacher.socket();
    const foreign = await (await h.teacher()).socket();
    const anonymous = await h.client().socket();
    const unrelated = collect(foreign, ['sessionOpened']);
    const seenAnonymous = collect(anonymous, ['sessionOpened']);

    const opened = nextEvent(dashboard, 'sessionOpened');
    const created = await otherTab.post('/api/sessions', { blueprintId: blueprint.id, maxTeams: 3 });
    assert.equal(created.status, 201);
    assert.deepEqual(await opened, { sessionId: created.body.sessionId });

    assert.equal((await otherTab.post('/api/sessions/close')).status, 200);
    const reopened = nextEvent(dashboard, 'sessionOpened');
    assert.equal((await otherTab.post('/api/sessions/' + created.body.sessionId + '/reopen')).status, 200);
    assert.deepEqual(await reopened, { sessionId: created.body.sessionId });

    await sleep(50);
    assert.deepEqual(unrelated, []);
    assert.deepEqual(seenAnonymous, []);
});
