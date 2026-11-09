'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHarness, emit, collect, sleep, expectAlive, PNG } = require('./helpers');
const { TEAM_COLORS } = require('../src/lib/schemas');

let h;
before(async () => { h = await createHarness(); });
after(async () => { await h.stop(); });

const CARD_COUNT = 12;

function kartenset(world, prefix) {
    const tasks = [];
    for (let i = 1; i <= CARD_COUNT; i += 1) {
        tasks.push({ type: 'choice', question: `${prefix} Karte ${i}`, options: ['richtig', 'falsch'], correct: 0, code: `${prefix}-${i}` });
    }
    tasks.push({ type: 'monster', question: `${prefix} Monster A` }, { type: 'monster', question: `${prefix} Monster B` }, { type: 'monster', question: `${prefix} Monster C` });
    return { templateType: 'world', world, tasks };
}

/** Lehrkraft mit Kartensets, offener Brett-Session und Lehrkraft-Socket. */
async function board({ worldCount = 1, portals = ['news'], teams = 1, maxTeams = 10, content = kartenset, start = true, teacher: givenTeacher } = {}) {
    const teacher = givenTeacher || await h.teacher();
    const sets = {};
    for (const world of ['haupt', ...portals]) {
        const created = await h.createBlueprint(teacher, content(world, world.toUpperCase()), `Set ${world}`);
        sets[world] = created.id;
    }
    const opened = await teacher.post('/api/sessions', { gameMode: 'board', maxTeams, board: { worldCount, portals, sets } });
    assert.equal(opened.status, 201, opened.text);
    const { code, sessionId } = opened.body;
    const teacherSocket = await teacher.socket();
    const joined = await emit(teacherSocket, 'joinSessionRoom', { sessionId });
    assert.ok(joined.ok, joined.error);

    const env = { teacher, teacherSocket, code, sessionId, sets, groups: [] };
    for (let i = 0; i < teams; i += 1) await addGroup(env, i);
    if (start) assert.equal((await teacher.post('/api/sessions/active/start')).status, 200);
    return env;
}

async function addGroup(env, index) {
    const client = await h.team(env.code, { color: TEAM_COLORS[index] });
    const socket = await client.socket();
    const joined = await emit(socket, 'joinSessionRoom', { sessionId: env.sessionId, as: 'team' });
    assert.ok(joined.ok, joined.error);
    const group = { client, socket, joined };
    env.groups.push(group);
    return group;
}

const stateOf = async (env) => (await env.teacher.get('/api/sessions/active')).body.board;

async function act(env, action, rev) {
    const current = rev === undefined ? (await stateOf(env)).rev : rev;
    return emit(env.teacherSocket, 'boardAction', { sessionId: env.sessionId, action, rev: current });
}

async function ok(env, action) {
    const ack = await act(env, action);
    assert.ok(ack.ok, `${action}: ${ack.error} (${ack.code})`);
    return ack.board;
}

async function open(group, code) {
    return emit(group.socket, 'boardOpenCard', { code });
}

async function solve(group, code, right) {
    const opened = await open(group, code);
    assert.ok(opened.ok, `${code}: ${opened.error}`);
    const ack = await emit(group.socket, 'boardSubmitCard', {
        taskKey: opened.card.taskKey,
        status: 'completed',
        answer: { index: right ? 0 : 1, label: 'x' }
    });
    assert.ok(ack.ok, ack.error);
    return opened.card;
}

/** Spielt die Runde: jede Gruppe nimmt eine eigene Karte; correct gibt an, wie viele richtig sind. */
async function playRound(env, prefix, correct) {
    let number = 1;
    for (const [index, group] of env.groups.entries()) {
        await solve(group, `${prefix}-${number}`, index < correct);
        number += 1;
    }
}

const prefixOf = (state) => (state.world || 'haupt').toUpperCase();

test('Brett-Session: Aufbau wird geprüft', async () => {
    const teacher = await h.teacher();
    const other = await h.teacher();
    const haupt = await h.createBlueprint(teacher, kartenset('haupt', 'H'));
    const news = await h.createBlueprint(teacher, kartenset('news', 'N'));
    const ki = await h.createBlueprint(teacher, kartenset('ki', 'K'));
    const foreign = await h.createBlueprint(other, kartenset('news', 'F'));
    const plain = await h.createBlueprint(teacher);
    const post = (board) => teacher.post('/api/sessions', { gameMode: 'board', board });
    const sets = { haupt: haupt.id, news: news.id };

    assert.equal((await post({ worldCount: 2, portals: ['news'], sets })).status, 400); // zu wenig Portale
    assert.equal((await post({ worldCount: 2, portals: ['news', 'news'], sets })).status, 400); // doppelt
    assert.equal((await post({ worldCount: 1, portals: ['haupt'], sets: { haupt: haupt.id } })).status, 400); // haupt ist kein Portal
    assert.equal((await post({ worldCount: 1, portals: ['nix'], sets })).status, 400);
    assert.equal((await post({ worldCount: 1, portals: ['ki'], sets: { haupt: haupt.id } })).status, 400); // Set fehlt
    assert.equal((await post({ worldCount: 6, portals: ['news'], sets })).status, 400);
    assert.equal((await post({ worldCount: 1, portals: ['news'], sets: { haupt: haupt.id, news: foreign.id } })).status, 404);
    const mismatch = await post({ worldCount: 1, portals: ['news'], sets: { haupt: haupt.id, news: ki.id } });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.code, 'WORLD_MISMATCH');
    assert.equal((await post({ worldCount: 1, portals: ['news'], sets: { haupt: plain.id, news: news.id } })).status, 400);
    for (const junk of [null, 1, {}, { worldCount: '1', portals: [], sets: {} }, { worldCount: 1, portals: 'news', sets: 1 }]) {
        assert.equal((await teacher.post('/api/sessions', { gameMode: 'board', board: junk })).status, 400);
    }
    const hostile = '{"gameMode":"board","board":{"worldCount":1,"portals":["news"],"sets":{"__proto__":1,"constructor":2}}}';
    assert.equal((await teacher.request('POST', '/api/sessions', hostile)).status, 400);
    assert.equal((await post({ worldCount: 1, portals: ['news'], sets })).status, 201);
    await expectAlive(h, assert);
});

test('Kartenset: Kaputter Chat ergibt 400 statt 500, auch beim Ändern', async () => {
    const teacher = await h.teacher();
    const withChat = (nodes) => {
        const content = kartenset('news', 'N');
        content.tasks.unshift({ type: 'chat', question: 'C', code: 'CHAT-1', nodes });
        return content;
    };
    const saved = await h.createBlueprint(teacher, kartenset('news', 'N'));
    for (const nodes of [{ start: { text: 'a' } }, { start: null }, { start: { text: 'a', options: 'x' } }, { start: { text: 'a', options: [null] } }]) {
        const created = await teacher.post('/api/blueprints', { title: 'x', content: withChat(nodes) });
        assert.equal(created.status, 400, created.text);
        assert.equal(created.body.code, 'INVALID_BLUEPRINT');
        assert.ok(created.body.details.some((detail) => detail.taskIndex === 0));
        const patched = await teacher.patch(`/api/blueprints/${saved.id}`, { title: 'x', content: withChat(nodes) });
        assert.equal(patched.status, 400, patched.text);
    }
    await expectAlive(h, assert);
});

test('Paare finden: Teams bekommen keine Zuordnung, gewertet wird die Zuordnung der Gruppe', async () => {
    const pairs = Array.from({ length: 6 }, (_, i) => ({ left: `L${i}`, right: `R${i}` }));
    const content = (world, prefix) => {
        const set = kartenset(world, prefix);
        set.tasks.unshift({ type: 'pairs', question: 'P', code: `${prefix}-P1`, pairs }, { type: 'pairs', question: 'P2', code: `${prefix}-P2`, pairs }, { type: 'pairs', question: 'P3', code: `${prefix}-P3`, pairs });
        return set;
    };
    const env = await board({ teams: 3, content });
    const cards = [];
    for (const [index, group] of env.groups.entries()) {
        const opened = await open(group, `HAUPT-P${index + 1}`);
        assert.ok(opened.ok, opened.error);
        assert.deepEqual(opened.card.task.pairs.map((pair) => pair.left).sort(), pairs.map((pair) => pair.left));
        assert.deepEqual(opened.card.task.pairs.map((pair) => pair.right).sort(), pairs.map((pair) => pair.right));
        cards.push(opened.card);
    }
    const shifted = pairs.map((pair, i) => ({ left: pair.left, right: pairs[(i + 1) % pairs.length].right }));
    const answers = [{ matched: pairs.length }, { assignments: shifted }, { assignments: pairs }];
    for (const [index, group] of env.groups.entries()) {
        const ack = await emit(group.socket, 'boardSubmitCard', { taskKey: cards[index].taskKey, status: 'completed', answer: answers[index] });
        assert.ok(ack.ok, ack.error);
    }
    const state = await stateOf(env);
    assert.deepEqual(state.groups.map((group) => group.correct), [false, false, true]);
    assert.deepEqual(state.lastResult, { correct: 1, total: 3, percent: 33, steps: 1 });
    await expectAlive(h, assert);
});

test('Verlauf: Nach dem Schließen zeigt die Lehrkraft alle Runden einer Brett-Session', async () => {
    const env = await board({ teams: 2 });
    await solve(env.groups[0], 'HAUPT-1', true);
    await solve(env.groups[1], 'HAUPT-2', false);
    await ok(env, 'move');
    assert.equal((await stateOf(env)).round, 2);
    const opened = await open(env.groups[0], 'HAUPT-3');
    assert.ok(opened.ok, opened.error);
    await emit(env.groups[0].socket, 'boardSubmitCard', { taskKey: opened.card.taskKey, status: 'skipped' });
    await ok(env, 'forceEvaluate');
    assert.equal((await env.teacher.post('/api/sessions/close')).status, 200);

    const response = await env.teacher.get(`/api/sessions/${env.sessionId}/board-history`);
    assert.equal(response.status, 200, response.text);
    const { board: final, rounds } = response.body;
    assert.equal(final.round, 2);
    assert.equal(final.phase, 'result');
    assert.deepEqual(rounds.map((entry) => [entry.round, entry.world, entry.cards.length]), [[1, 'haupt', 2], [2, 'haupt', 1]]);
    const [first, second] = rounds[0].cards;
    assert.equal(first.code, 'HAUPT-1');
    assert.equal(first.status, 'finished');
    assert.equal(first.correct, true);
    assert.deepEqual(first.answer, { index: 0, label: 'x' });
    assert.deepEqual(first.task.options, ['richtig', 'falsch']);
    assert.ok(first.teamName);
    assert.equal(second.correct, false);
    assert.equal(rounds[1].cards[0].status, 'skipped');
    assert.equal(rounds[1].cards[0].correct, false);

    const stranger = await h.teacher();
    assert.equal((await stranger.get(`/api/sessions/${env.sessionId}/board-history`)).status, 403);
    assert.notEqual((await env.groups[0].client.get(`/api/sessions/${env.sessionId}/board-history`)).status, 200);

    const classic = await h.createBlueprint(env.teacher);
    const session = await env.teacher.post('/api/sessions', { blueprintId: classic.id });
    const refused = await env.teacher.get(`/api/sessions/${session.body.sessionId}/board-history`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'NOT_BOARD');
});

test('Kartenset kann nicht als einzelne Spielrunde gestartet werden', async () => {
    const teacher = await h.teacher();
    const set = await h.createBlueprint(teacher, kartenset('news', 'N'));
    const response = await teacher.post('/api/sessions', { blueprintId: set.id });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'WRONG_TEMPLATE');
});

test('Kartenset: Server speichert Welt, ergänzt Codes und entfernt Monster-Codes', async () => {
    const teacher = await h.teacher();
    const content = kartenset('daten', 'D');
    delete content.tasks[0].code;
    content.tasks.find((task) => task.type === 'monster').code = 'BOESE1';
    content.tasks[1].correct = 0;
    const saved = await h.createBlueprint(teacher, content);
    assert.equal(saved.content.world, 'daten');
    assert.equal(saved.content.templateType, 'world');
    assert.match(saved.content.tasks[0].code, /^\d{6}$/);
    assert.equal(saved.content.tasks.find((task) => task.type === 'monster').code, undefined);

    const missing = kartenset('daten', 'D');
    delete missing.tasks[2].correct;
    const refused = await teacher.post('/api/blueprints', { title: 'x', content: missing });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'INVALID_BLUEPRINT');
    assert.ok(refused.body.details.some((detail) => detail.taskIndex === 2 && /richtige/.test(detail.message)));
});

test('Spielstart: Runde 1, Lobby davor, boardState für Lehrkraft und Teams', async () => {
    const env = await board({ start: false, teams: 1 });
    assert.equal((await stateOf(env)).phase, 'lobby');
    assert.equal(env.groups[0].joined.state.gameMode, 'board');
    const teacherEvents = collect(env.teacherSocket, ['boardState', 'gameStarted']);
    const teamEvents = collect(env.groups[0].socket, ['boardState', 'gameStarted']);
    await env.teacher.post('/api/sessions/active/start');
    await sleep(50);
    const state = await stateOf(env);
    assert.equal(state.phase, 'round');
    assert.equal(state.round, 1);
    assert.equal(state.mainPos, 1);
    assert.equal(state.world, null);
    assert.equal(teacherEvents.find((event) => event.event === 'boardState').payload.phase, 'round');
    const teamBoard = teamEvents.find((event) => event.event === 'boardState').payload;
    assert.equal(teamBoard.phase, 'round');
    assert.equal(teamBoard.monsterTask, undefined);
    assert.equal(teamBoard.groups, undefined);
    assert.equal(teamBoard.groupProgress.total, 1);
    assert.deepEqual(teamBoard.portals.map((portal) => portal.field), [13]);
});

test('Ergebnis: Schritte je Anteil richtiger Gruppen, Lehrkraft sieht die Einzelergebnisse', async () => {
    for (const [teams, correct, steps, percent] of [[6, 6, 4, 100], [6, 5, 4, 83], [6, 4, 2, 67], [6, 3, 1, 50], [6, 0, 1, 0], [5, 4, 2, 80], [5, 3, 1, 60]]) {
        const env = await board({ teams });
        await playRound(env, 'HAUPT', correct);
        const state = await stateOf(env);
        assert.equal(state.phase, 'result', `${correct}/${teams}`);
        assert.deepEqual(state.lastResult, { correct, total: teams, percent, steps });
        assert.equal(state.groups.filter((group) => group.correct === true).length, correct);
        assert.ok(state.groups.every((group) => group.status === 'finished' && group.answer && typeof group.answer.index === 'number'));
        env.teacherSocket.disconnect();
        env.groups.forEach((group) => group.socket.disconnect());
    }
});

test('Figur: Monster, Restschritte, Portal, Welt und Rückkehr', async () => {
    const env = await board({ teams: 1 });
    const seen = [];
    let state = await stateOf(env);
    const start = state.mainPos;
    assert.equal(start, 1);

    await playRound(env, 'HAUPT', 1); // 4 Schritte
    state = await ok(env, 'move');
    assert.equal(state.phase, 'round');
    assert.equal(state.mainPos, 5);
    assert.equal(state.round, 2);

    await playRound(env, 'HAUPT', 1); // von 5: 6, 7, 8 und 1 Rest
    state = await ok(env, 'move');
    assert.equal(state.phase, 'monster');
    assert.equal(state.mainPos, 8);
    assert.equal(state.remainingSteps, 1);
    assert.equal(state.monsterTask.question, 'HAUPT Monster A');
    assert.equal(state.pending.label, 'Monster 1');
    assert.equal(state.pending.field, 8);

    state = await ok(env, 'confirm');
    assert.equal(state.phase, 'continue');
    assert.equal(state.remainingSteps, 1);
    assert.equal(state.message, 'Du darfst noch 1 Schritt gehen.');

    state = await ok(env, 'move');
    assert.equal(state.phase, 'round');
    assert.equal(state.mainPos, 9);
    assert.equal(state.round, 3);

    await playRound(env, 'HAUPT', 1); // von 9: 13 Portal, genau getroffen
    state = await ok(env, 'move');
    assert.equal(state.phase, 'portal');
    assert.equal(state.mainPos, 13);
    assert.equal(state.remainingSteps, 0);
    assert.equal(state.pending.world, 'news');
    assert.equal(state.pending.kartenset, 'Set news');
    assert.match(state.message, /News Arena/);
    assert.match(state.message, /Set news/);

    state = await ok(env, 'confirm');
    assert.equal(state.phase, 'round');
    assert.equal(state.world, 'news');
    assert.equal(state.worldPos, 1);
    assert.equal(state.remainingSteps, 0);
    assert.equal(state.round, 4);

    // Die Welt wird mit ihrem Kartenset gespielt; das Set des Hauptbretts gilt nicht mehr.
    assert.equal((await open(env.groups[0], 'HAUPT-1')).code, 'UNKNOWN_CODE');

    // Durch die Welt: 1 -> 5 -> 8 (Monster) -> 9 -> 13 -> 16 (Monster) -> 17 -> 21 -> 24 (Monster) -> 25 Ende
    for (const [expected, phase] of [[5, 'round'], [8, 'monster'], [9, 'round'], [13, 'round'], [16, 'monster'], [17, 'round'], [21, 'round'], [24, 'monster'], [25, 'worldDone']]) {
        if (state.phase === 'round') {
            await playRound(env, prefixOf(state), 1);
            state = await ok(env, 'move');
        } else if (state.phase === 'monster') {
            state = await ok(env, 'confirm');
            assert.equal(state.phase, 'continue');
            state = await ok(env, 'move');
        }
        assert.equal(state.worldPos, expected);
        assert.equal(state.phase, phase);
        seen.push(expected);
    }
    assert.match(state.message, /News Arena/);
    assert.match(state.message, /Feld 13/);

    state = await ok(env, 'confirm');
    assert.equal(state.phase, 'round');
    assert.equal(state.world, null);
    assert.equal(state.mainPos, 13);
    assert.deepEqual(state.donePortals, [13]);
    assert.ok(state.portals.find((portal) => portal.field === 13).done);

    // Rückkehr löst das Portal nicht erneut aus.
    await playRound(env, 'HAUPT', 1); // von 13: 14, 15, 16 Monster, 1 Rest
    state = await ok(env, 'move');
    assert.equal(state.phase, 'monster');
    assert.equal(state.mainPos, 16);
    assert.equal(state.monsterTask.question, 'HAUPT Monster B');

    state = await ok(env, 'confirm');
    state = await ok(env, 'move'); // 17
    assert.equal(state.mainPos, 17);
    await playRound(env, 'HAUPT', 1); // 21
    state = await ok(env, 'move');
    assert.equal(state.mainPos, 21);
    await playRound(env, 'HAUPT', 1); // 24 Endboss, 1 Rest
    state = await ok(env, 'move');
    assert.equal(state.phase, 'monster');
    assert.equal(state.pending.label, 'Endboss');
    assert.equal(state.monsterTask.question, 'HAUPT Monster C');
    state = await ok(env, 'confirm');
    assert.equal(state.phase, 'continue');
    state = await ok(env, 'move');
    assert.equal(state.phase, 'finished');
    assert.equal(state.mainPos, 25);
    assert.match(state.message, /Geschafft/);

    // Abschluss: Nichts geht mehr.
    assert.equal((await act(env, 'move')).code, 'INVALID_ACTION');
    assert.equal((await act(env, 'confirm')).code, 'INVALID_ACTION');
    assert.equal((await open(env.groups[0], 'HAUPT-2')).code, 'NOT_IN_ROUND');
});

test('Portal: Restschritte verfallen, ein überschrittenes Portal stoppt trotzdem', async () => {
    const env = await board({ worldCount: 2, portals: ['news', 'ki'], teams: 1 });
    await playRound(env, 'HAUPT', 1);
    let state = await ok(env, 'move'); // 1 -> 5
    assert.equal(state.mainPos, 5);
    await playRound(env, 'HAUPT', 1);
    state = await ok(env, 'move'); // 4 Schritte, aber Portal auf 6
    assert.equal(state.mainPos, 6);
    assert.equal(state.phase, 'portal');
    assert.equal(state.remainingSteps, 0);
    state = await ok(env, 'confirm');
    assert.equal(state.world, 'news');
});

test('Veraltete rev, Doppel-Tipp und Schutz vor falschen Aktionen', async () => {
    const env = await board({ teams: 1 });
    let state = await stateOf(env);
    assert.equal((await act(env, 'forceEvaluate', state.rev + 5)).code, 'STALE_STATE');
    assert.equal((await act(env, 'move', state.rev)).code, 'INVALID_ACTION'); // Runde läuft noch

    await playRound(env, 'HAUPT', 1);
    state = await stateOf(env);
    assert.equal(state.phase, 'result');
    const staleRev = state.rev;
    const [one, two] = await Promise.all([act(env, 'move', staleRev), act(env, 'move', staleRev)]);
    assert.equal([one, two].filter((ack) => ack.ok).length, 1, 'Nur ein Tipp bewegt die Figur');
    assert.equal([one, two].filter((ack) => ack.code === 'STALE_STATE').length, 1);
    assert.equal((await stateOf(env)).mainPos, 5);
    for (const payload of [{ sessionId: env.sessionId, action: 'hack', rev: 1 }, { sessionId: env.sessionId, action: 'move', rev: 'x' }, { sessionId: 'a', action: 'move', rev: 1 }, null, 'x']) {
        assert.equal((await emit(env.teacherSocket, 'boardAction', payload)).code, 'INVALID_INPUT');
    }
    await expectAlive(h, assert);
});

test('Doppelt bestätigtes Monster zählt einmal', async () => {
    const env = await board({ teams: 1 });
    await playRound(env, 'HAUPT', 1);
    await ok(env, 'move'); // 5
    await playRound(env, 'HAUPT', 1);
    await ok(env, 'move'); // 8 Monster
    const state = await stateOf(env);
    const [a, b] = await Promise.all([act(env, 'confirm', state.rev), act(env, 'confirm', state.rev)]);
    assert.equal([a, b].filter((ack) => ack.ok).length, 1);
    assert.equal((await stateOf(env)).phase, 'continue');
});

test('Nur die eigene Lehrkraft darf steuern', async () => {
    const env = await board({ teams: 1 });
    const stranger = await h.teacher();
    const strangerSocket = await stranger.socket();
    const payload = { sessionId: env.sessionId, action: 'forceEvaluate', rev: (await stateOf(env)).rev };
    assert.equal((await emit(strangerSocket, 'boardAction', payload)).ok, false);
    assert.equal((await emit(env.groups[0].socket, 'boardAction', payload)).ok, false);
    const anon = await h.client().socket();
    assert.equal((await emit(anon, 'boardAction', payload)).ok, false);
    assert.equal((await stateOf(env)).phase, 'round');
});

test('Karten: vergebene, doppelte, fremde und Monster-Codes', async () => {
    const env = await board({ teams: 2 });
    const [first, second] = env.groups;
    const opened = await open(first, 'haupt-1'); // Groß-/Kleinschreibung egal
    assert.ok(opened.ok);
    assert.equal(opened.card.status, 'working');
    assert.equal(opened.card.task.question, 'HAUPT Karte 1');

    assert.equal((await open(second, 'HAUPT-1')).code, 'CARD_TAKEN');
    assert.equal((await open(first, 'HAUPT-2')).code, 'CARD_ALREADY_OPEN');
    assert.equal((await open(second, 'NEWS-1')).code, 'UNKNOWN_CODE');
    assert.equal((await open(second, 'undefined')).code, 'UNKNOWN_CODE');
    for (const junk of [null, 1, {}, { code: '' }, { code: 1 }, { code: 'x'.repeat(100) }]) {
        assert.equal((await emit(second.socket, 'boardOpenCard', junk)).code, 'INVALID_INPUT');
    }

    // Reload: dieselbe Karte erneut.
    const again = await open(first, 'HAUPT-1');
    assert.ok(again.ok);
    assert.equal(again.card.taskKey, opened.card.taskKey);

    const key = opened.card.taskKey;
    assert.equal((await emit(first.socket, 'boardSubmitCard', { taskKey: '1-99', status: 'completed', answer: {} })).code, 'UNKNOWN_TASK');
    assert.equal((await emit(second.socket, 'boardSubmitCard', { taskKey: key, status: 'completed', answer: {} })).code, 'NO_CARD');
    assert.ok((await emit(first.socket, 'boardSubmitCard', { taskKey: key, status: 'completed', answer: { index: 0, correct: true } })).ok);
    const late = await emit(first.socket, 'boardSubmitCard', { taskKey: key, status: 'completed', answer: { index: 1 } });
    assert.equal(late.code, 'ALREADY_FINISHED');
    assert.equal((await open(first, 'HAUPT-1')).code, 'ALREADY_FINISHED');
    assert.equal((await stateOf(env)).groups[0].correct, true, 'Eine späte Antwort ändert nichts');

    await solve(second, 'HAUPT-2', true);
    await ok(env, 'move'); // nächste Runde
    assert.ok((await open(first, 'HAUPT-1')).ok, 'Karten dürfen in späteren Runden wieder genommen werden');
});

test('Teams erfahren das Ergebnis ihrer Karte nicht', async () => {
    const env = await board({ teams: 2 });
    const [first, second] = env.groups;
    const opened = await open(first, 'HAUPT-1');
    assert.ok(!('correct' in opened.card.task));
    const ack = await emit(first.socket, 'boardSubmitCard', { taskKey: opened.card.taskKey, status: 'completed', answer: { index: 0 } });
    assert.equal(JSON.stringify(ack).includes('correct'), false);

    const reloaded = await first.client.get('/api/team/me');
    assert.equal(reloaded.body.card.status, 'finished');
    assert.equal(reloaded.body.card.task, null);
    assert.equal(JSON.stringify(reloaded.body).includes('"correct"'), false);
    await solve(second, 'HAUPT-2', false);
    const state = await first.client.get('/api/team/me');
    assert.deepEqual(state.body.board.lastResult, { correct: 1, total: 2, percent: 50, steps: 1 });
    assert.equal(JSON.stringify(state.body).includes('groups":['), false);
});

test('Lösungen werden nicht an Teams gesendet', async () => {
    const content = (world, prefix) => ({
        templateType: 'world',
        world,
        tasks: [
            { type: 'binary', code: `${prefix}-A`, correct: 'left' },
            { type: 'select', code: `${prefix}-B`, options: ['a', 'b'], correct: [1] },
            { type: 'bucket', code: `${prefix}-C`, buckets: ['1', '2'], items: [{ text: 'x', target: 0 }] },
            { type: 'scroller', code: `${prefix}-D`, posts: Array.from({ length: 10 }, (_, i) => ({ user: `u${i}`, text: `t${i}`, isBad: i === 3 })) },
            { type: 'chat', code: `${prefix}-E`, nodes: { start: { text: 'x', options: [{ label: 'a', next: 'end' }] }, end: { text: 'y', options: [], success: true } } },
            { type: 'monster', question: 'M1' }, { type: 'monster', question: 'M2' }, { type: 'monster', question: 'M3' }
        ]
    });
    const env = await board({ teams: 5, content });
    const strip = [['HAUPT-A', (t) => t.correct], ['HAUPT-B', (t) => t.correct], ['HAUPT-C', (t) => t.items[0].target], ['HAUPT-D', (t) => t.posts[3].isBad], ['HAUPT-E', (t) => t.nodes.end.success]];
    for (const [index, [code, read]] of strip.entries()) {
        const opened = await open(env.groups[index], code);
        assert.ok(opened.ok, opened.error);
        assert.equal(read(opened.card.task), undefined, code);
        assert.equal(opened.card.task.code, undefined);
    }
    const teacherView = await stateOf(env);
    assert.equal(teacherView.sets.haupt.tasks[0].correct, 'left');
    assert.ok(!('sets' in (await env.groups[0].client.get('/api/team/me')).body.board));
    await expectAlive(h, assert);
});

test('Bewertung ist serverseitig, kaputte Antworten zählen falsch', async () => {
    const env = await board({ teams: 3 });
    const junk = [null, { index: '0' }, { index: [0] }, { correct: true }];
    for (const [index, group] of env.groups.entries()) {
        const opened = await open(group, `HAUPT-${index + 1}`);
        const ack = await emit(group.socket, 'boardSubmitCard', { taskKey: opened.card.taskKey, status: 'completed', answer: junk[index] });
        assert.ok(ack.ok, ack.error);
    }
    assert.deepEqual((await stateOf(env)).lastResult, { correct: 0, total: 3, percent: 0, steps: 1 });
    await expectAlive(h, assert);
});

test('Übersprungene Karte ist nicht richtig', async () => {
    const env = await board({ teams: 1 });
    const opened = await open(env.groups[0], 'HAUPT-1');
    assert.ok((await emit(env.groups[0].socket, 'boardSubmitCard', { taskKey: opened.card.taskKey, status: 'skipped', answer: { index: 0 } })).ok);
    const state = await stateOf(env);
    assert.equal(state.phase, 'result');
    assert.equal(state.lastResult.correct, 0);
    assert.equal(state.groups[0].skipped, true);
    assert.equal(state.groups[0].correct, false);
});

test('Freitext und Foto zählen erst mit Einsendung als richtig', async () => {
    const content = (world, prefix) => ({
        templateType: 'world',
        world,
        tasks: [
            { type: 'statement', question: 'Dein Tipp', code: `${prefix}-T` },
            { type: 'photo', question: 'Foto', code: `${prefix}-P` },
            { type: 'monster', question: 'M1' }, { type: 'monster', question: 'M2' }, { type: 'monster', question: 'M3' }
        ]
    });
    const env = await board({ teams: 2, content });
    const [text, photo] = env.groups;
    const textCard = await open(text, 'HAUPT-T');
    const photoCard = await open(photo, 'HAUPT-P');

    assert.equal((await emit(text.socket, 'boardSubmitCard', { taskKey: textCard.card.taskKey, status: 'completed', answer: { text: 'Hallo' } })).code, 'SUBMISSION_MISSING');
    assert.equal((await emit(text.socket, 'studentSubmission', { taskKey: textCard.card.taskKey, type: 'photo', content: '/uploads/x.jpg' })).code, 'WRONG_TYPE');
    assert.equal((await emit(text.socket, 'studentSubmission', { taskKey: textCard.card.taskKey, type: 'statement', content: 'Arschloch' })).code, 'BAD_WORDS');
    const events = collect(env.teacherSocket, ['newSubmission']);
    assert.ok((await emit(text.socket, 'studentSubmission', { taskKey: textCard.card.taskKey, type: 'statement', content: 'Nett bleiben' })).ok);
    assert.ok((await emit(text.socket, 'boardSubmitCard', { taskKey: textCard.card.taskKey, status: 'completed', answer: { text: 'Nett bleiben' } })).ok);

    const uploaded = await photo.client.upload('/api/upload?purpose=submission', PNG);
    assert.equal(uploaded.status, 201);
    assert.ok((await emit(photo.socket, 'studentSubmission', { taskKey: photoCard.card.taskKey, type: 'photo', content: uploaded.body.url })).ok);
    assert.ok((await emit(photo.socket, 'boardSubmitCard', { taskKey: photoCard.card.taskKey, status: 'completed', answer: { url: uploaded.body.url } })).ok);

    await sleep(30);
    assert.equal(events.length, 2);
    assert.deepEqual((await stateOf(env)).lastResult, { correct: 2, total: 2, percent: 100, steps: 4 });
});

test('Vorzeitig auswerten: Unfertige zählen nicht, ohne Gruppen abgelehnt', async () => {
    const env = await board({ teams: 0 });
    assert.equal((await act(env, 'forceEvaluate')).code, 'NO_TEAMS');
    await addGroup(env, 0);
    await addGroup(env, 1);
    await addGroup(env, 2);
    await solve(env.groups[0], 'HAUPT-1', true);
    await open(env.groups[1], 'HAUPT-2');
    const state = await ok(env, 'forceEvaluate');
    assert.equal(state.phase, 'result');
    assert.deepEqual(state.lastResult, { correct: 1, total: 3, percent: 33, steps: 1 });
    assert.deepEqual(state.groups.map((group) => group.status), ['finished', 'working', 'none']);
    // Nach der Auswertung nimmt der Server nichts mehr an.
    const late = await open(env.groups[2], 'HAUPT-3');
    assert.equal(late.code, 'NOT_IN_ROUND');
});

test('Gruppe löschen und beitreten während der Runde', async () => {
    const env = await board({ teams: 2 });
    const [first, second] = env.groups;
    await solve(first, 'HAUPT-1', true);
    assert.equal((await stateOf(env)).phase, 'round');

    // Die fehlende Gruppe wird gelöscht: Runde ist vorbei.
    const secondId = second.client.state.teamId;
    assert.equal((await env.teacher.delete(`/api/teams/${secondId}`)).status, 200);
    let state = await stateOf(env);
    assert.equal(state.phase, 'result');
    assert.equal(state.lastResult.total, 1);
    assert.equal(state.lastResult.correct, 1);

    // Nächste Runde: Eine neu dazukommende Gruppe zählt mit.
    await ok(env, 'move');
    await solve(first, 'HAUPT-1', true);
    state = await stateOf(env);
    assert.equal(state.phase, 'result', 'mit einer Gruppe ist die Runde vorbei');

    const env2 = await board({ teams: 1 });
    await open(env2.groups[0], 'HAUPT-1');
    const later = await addGroup(env2, 1);
    await solve(env2.groups[0], 'HAUPT-1', true);
    assert.equal((await stateOf(env2)).phase, 'round', 'die neue Gruppe wird erwartet');
    await solve(later, 'HAUPT-2', true);
    assert.deepEqual((await stateOf(env2)).lastResult, { correct: 2, total: 2, percent: 100, steps: 4 });
});

test('Fremde Session und Team: Keine Karten aus falschem Kontext', async () => {
    const env = await board({ teams: 1 });
    const stranger = h.client();
    const socket = await stranger.socket();
    assert.equal((await emit(socket, 'boardOpenCard', { code: 'HAUPT-1' })).ok, false);

    const classic = await h.openSession();
    const team = await h.team(classic.code);
    const teamSocket = await h.teamSocket(team, classic.sessionId);
    await classic.teacher.post('/api/sessions/active/start');
    assert.equal((await emit(teamSocket, 'boardOpenCard', { code: 'x' })).code, 'NOT_BOARD');
    assert.equal((await emit(classic.teacher.sockets[0] || await classic.teacher.socket(), 'boardAction', { sessionId: classic.sessionId, action: 'move', rev: 0 })).code, 'NOT_BOARD');
    assert.equal((await emit(env.groups[0].socket, 'reportTaskStart', { taskKey: '1-0' })).code, 'UNKNOWN_TASK');
    await expectAlive(h, assert);
});

test('Brett-Session: kein Wechsel der Spielrunde, Live-Ereignisse je Raum', async () => {
    const env = await board({ teams: 1 });
    const plain = await h.createBlueprint(env.teacher);
    const switched = await env.teacher.patch('/api/sessions/active/mode', { blueprintId: plain.id });
    assert.equal(switched.status, 409);
    assert.equal(switched.body.code, 'BOARD_SESSION');

    const other = await env.teacher.post('/api/sessions/active/end');
    assert.equal(other.status, 200);
    assert.equal((await act(env, 'forceEvaluate')).code, 'NOT_RUNNING');
    assert.equal((await open(env.groups[0], 'HAUPT-1')).code, 'NOT_RUNNING');
    await env.teacher.post('/api/sessions/active/start');
    const state = await stateOf(env);
    assert.equal(state.round, 1, 'Ein erneuter Start macht weiter statt von vorn');
});

test('Einmal angelegte Sets sind Snapshots: Spätere Änderungen wirken nicht', async () => {
    const env = await board({ teams: 1 });
    const changed = kartenset('haupt', 'NEU');
    assert.equal((await env.teacher.patch(`/api/blueprints/${env.sets.haupt}`, { title: 'Geändert', content: changed })).status, 200);
    assert.equal((await env.teacher.delete(`/api/blueprints/${env.sets.news}`)).status, 200);
    assert.ok((await open(env.groups[0], 'HAUPT-1')).ok);
    assert.equal((await open(env.groups[0], 'NEU-1')).code, 'CARD_ALREADY_OPEN');
    const state = await stateOf(env);
    assert.equal(state.sets.haupt.title, 'Set haupt');
    assert.ok(state.sets.news);
});

test('Reconnect: Stand und Karte werden wiederhergestellt', async () => {
    const env = await board({ teams: 2 });
    const [first] = env.groups;
    const opened = await open(first, 'HAUPT-5');
    first.socket.disconnect();
    env.teacherSocket.disconnect();

    const socket = await first.client.socket();
    const ack = await emit(socket, 'joinSessionRoom', { sessionId: env.sessionId, as: 'team' });
    assert.ok(ack.ok);
    assert.equal(ack.state.card.taskKey, opened.card.taskKey);
    assert.equal(ack.state.card.status, 'working');
    assert.equal(ack.state.card.task.question, 'HAUPT Karte 5');
    assert.equal(ack.state.board.round, 1);
    assert.equal(ack.state.board.phase, 'round');

    const teacherSocket = await env.teacher.socket();
    const teacherAck = await emit(teacherSocket, 'joinSessionRoom', { sessionId: env.sessionId });
    assert.equal(teacherAck.state.board.groups[0].status, 'working');
    assert.equal(teacherAck.state.board.groups[0].card.code, 'HAUPT-5');
    assert.ok(teacherAck.state.board.sets.news);
});

test('Neustart: Spielstand bleibt in der Datenbank', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-restart-'));
    const first = await createHarness({ env: { DATA_DIR: dataDir } });
    let second;
    try {
        const teacher = await first.teacher();
        const haupt = await first.createBlueprint(teacher, kartenset('haupt', 'HAUPT'));
        const news = await first.createBlueprint(teacher, kartenset('news', 'NEWS'));
        const opened = await teacher.post('/api/sessions', { gameMode: 'board', board: { worldCount: 1, portals: ['news'], sets: { haupt: haupt.id, news: news.id } } });
        const { code, sessionId } = opened.body;
        const group = await first.team(code);
        await teacher.post('/api/sessions/active/start');
        const socket = await first.teamSocket(group, sessionId);
        const card = await emit(socket, 'boardOpenCard', { code: 'HAUPT-3' });
        assert.ok(card.ok);
        const before = (await teacher.get('/api/sessions/active')).body.board;
        await first.close();

        second = await createHarness({ env: { DATA_DIR: dataDir } });
        teacher.base = second.base;
        group.base = second.base;
        const after = (await teacher.get('/api/sessions/active')).body.board;
        assert.equal(after.rev, before.rev);
        assert.equal(after.phase, 'round');
        assert.equal(after.groups[0].card.code, 'HAUPT-3');

        const teamSocket = await group.socket();
        const ack = await emit(teamSocket, 'joinSessionRoom', { sessionId, as: 'team' });
        assert.equal(ack.state.card.status, 'working');
        const submit = await emit(teamSocket, 'boardSubmitCard', { taskKey: ack.state.card.taskKey, status: 'completed', answer: { index: 0 } });
        assert.ok(submit.ok, submit.error);
        const teacherSocket = await teacher.socket();
        await emit(teacherSocket, 'joinSessionRoom', { sessionId });
        const result = (await teacher.get('/api/sessions/active')).body.board;
        assert.equal(result.phase, 'result');
        const move = await emit(teacherSocket, 'boardAction', { sessionId, action: 'move', rev: result.rev });
        assert.ok(move.ok, move.error);
        assert.equal(move.board.mainPos, 5);
        teamSocket.disconnect();
        teacherSocket.disconnect();
    } finally {
        await first.close();
        if (second) await second.close();
        await sleep(100);
        for (const dir of [dataDir, first.dataDir, second && second.dataDir]) {
            if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }
});

test('Backfill: Migration ergänzt Kartensets für bestehende Konten genau einmal', async () => {
    const { openDatabase } = require('../src/db');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-migrate-'));
    const file = path.join(dir, 'database.sqlite');
    try {
        const db = openDatabase(file);
        await db.ready;
        await db.exec('PRAGMA user_version = 1');
        await db.exec('DROP TABLE board_cards; DROP TABLE board_states;');
        // Stand von Migration 001 nachbilden.
        await db.exec('ALTER TABLE sessions DROP COLUMN game_mode');
        await db.run("INSERT INTO teachers (username, password, created_at) VALUES ('alt', 'x', 'y')");
        await db.close();

        const migrated = openDatabase(file);
        await migrated.ready;
        assert.equal((await migrated.get('SELECT COUNT(*) AS c FROM blueprints')).c, 6);
        assert.equal((await migrated.get('PRAGMA user_version')).user_version, 3);
        await migrated.close();

        const again = openDatabase(file);
        await again.ready;
        assert.equal((await again.get('SELECT COUNT(*) AS c FROM blueprints')).c, 6);
        await again.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('Neue Lehrkraft: bekommt Kartensets; eine Brett-Session lässt sich damit starten', async () => {
    const withDemo = await createHarness({ env: { SEED_DEMO: 'true' } });
    try {
        const teacher = withDemo.client();
        const login = await teacher.post('/api/login', { username: 'admin', password: 'admin' });
        assert.equal(login.status, 200);
        const { blueprints } = (await teacher.get('/api/blueprints')).body;
        const ofWorld = (world) => blueprints.find((row) => row.content.world === world).id;
        const created = await teacher.post('/api/sessions', { gameMode: 'board', board: { worldCount: 2, portals: ['news', 'strand'], sets: { haupt: ofWorld('haupt'), news: ofWorld('news'), strand: ofWorld('strand') } } });
        assert.equal(created.status, 201, created.text);
        const team = await withDemo.team(created.body.code);
        await teacher.post('/api/sessions/active/start');
        const socket = await withDemo.teamSocket(team, created.body.sessionId);
        const card = await emit(socket, 'boardOpenCard', { code: 'HAUPT-01' });
        assert.ok(card.ok, card.error);
        assert.equal((await emit(socket, 'boardOpenCard', { code: 'HAUPT-02' })).code, 'CARD_ALREADY_OPEN');
        socket.disconnect();
    } finally {
        await withDemo.stop();
    }
});

// --- Einzelne Spielrunde mit Monster-Aufgabe ----------------------------------------

const CLASSIC_MONSTER = {
    templateType: 'normal',
    tasks: [
        { type: 'choice', question: 'Erst das', options: ['a', 'b'] },
        { type: 'monster', question: 'Halt, Monster!' },
        { type: 'statement', question: 'Danach' }
    ]
};

test('Einzelne Spielrunde: Monster stoppt das Team bis zur Bestätigung', async () => {
    const owner = await h.openSession({ content: CLASSIC_MONSTER });
    const team = await h.team(owner.code);
    const teamId = team.state.teamId;
    const teacherSocket = await owner.teacher.socket();
    await emit(teacherSocket, 'joinSessionRoom', { sessionId: owner.sessionId });
    const start = await owner.teacher.post('/api/sessions/active/start');
    const [first, monster, last] = start.body.blueprint.tasks;
    const socket = await h.teamSocket(team, owner.sessionId);

    assert.ok((await emit(socket, 'reportTaskResult', { taskKey: first.key, status: 'completed', answer: { index: 0 } })).ok);
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: monster.key })).ok, true);

    // Das Team kommt nicht vorbei und kann das Monster nicht selbst abhaken.
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: monster.key, status: 'completed' })).code, 'MONSTER_PENDING');
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: monster.key, status: 'skipped' })).code, 'MONSTER_PENDING');
    assert.equal((await emit(socket, 'reportTaskStart', { taskKey: last.key })).code, 'MONSTER_PENDING');
    assert.equal((await emit(socket, 'reportTaskResult', { taskKey: last.key, status: 'completed' })).code, 'MONSTER_PENDING');

    const stranger = await h.teacher();
    const strangerSocket = await stranger.socket();
    const confirm = { sessionId: owner.sessionId, teamId, taskKey: monster.key };
    assert.equal((await emit(strangerSocket, 'confirmMonster', confirm)).ok, false);
    assert.equal((await emit(socket, 'confirmMonster', confirm)).ok, false);
    assert.equal((await emit(teacherSocket, 'confirmMonster', { ...confirm, taskKey: first.key })).code, 'NOT_MONSTER');

    const released = collect(socket, ['monsterConfirmed']);
    const results = collect(teacherSocket, ['teamTaskResult']);
    const ack = await emit(teacherSocket, 'confirmMonster', confirm);
    assert.ok(ack.ok, ack.error);
    assert.equal(ack.alreadyCompleted, false);
    assert.equal((await emit(teacherSocket, 'confirmMonster', confirm)).alreadyCompleted, true);
    await sleep(40);
    assert.equal(released.length, 1);
    assert.equal(released[0].payload.taskKey, monster.key);
    assert.equal(results.length, 1);
    assert.equal(results[0].payload.result.status, 'completed');

    assert.ok((await emit(socket, 'reportTaskResult', { taskKey: last.key, status: 'completed', answer: {} })).ok);
});

test('Einzelne Spielrunde: Monster als QR-Karte, und der Abschluss bleibt gesperrt', async () => {
    const content = {
        templateType: 'qr',
        tasks: [
            { type: 'choice', question: 'Station', code: 'AAA111', options: ['a', 'b'] },
            { type: 'monster', question: 'Monster-Station', code: 'MON222' }
        ]
    };
    const owner = await h.openSession({ content });
    const team = await h.team(owner.code);
    const teacherSocket = await owner.teacher.socket();
    await emit(teacherSocket, 'joinSessionRoom', { sessionId: owner.sessionId });
    const started = await owner.teacher.post('/api/sessions/active/start');
    const [station, monster] = started.body.blueprint.tasks;
    const socket = await h.teamSocket(team, owner.sessionId);

    const confirm = { sessionId: owner.sessionId, teamId: team.state.teamId, taskKey: monster.key };
    assert.equal((await emit(teacherSocket, 'confirmMonster', confirm)).code, 'MONSTER_NOT_REACHED');

    assert.ok((await emit(socket, 'openStation', { code: 'MON222' })).ok);
    assert.equal((await emit(socket, 'openStation', { code: 'AAA111' })).code, 'MONSTER_PENDING');
    assert.equal((await emit(socket, 'finishStations')).code, 'MONSTER_PENDING');

    assert.ok((await emit(teacherSocket, 'confirmMonster', confirm)).ok);
    assert.ok((await emit(socket, 'openStation', { code: 'AAA111' })).ok);
    const finished = await emit(socket, 'reportTaskResult', { taskKey: station.key, status: 'completed', answer: {} });
    assert.ok(finished.ok, finished.error);
    assert.equal(finished.progress.finished, true);
});

test('Einzelne Spielrunde: Bestätigung setzt die letzte Aufgabe auf fertig', async () => {
    const content = { templateType: 'normal', tasks: [{ type: 'monster', question: 'Nur Monster' }] };
    const owner = await h.openSession({ content });
    const team = await h.team(owner.code);
    const teacherSocket = await owner.teacher.socket();
    await emit(teacherSocket, 'joinSessionRoom', { sessionId: owner.sessionId });
    const started = await owner.teacher.post('/api/sessions/active/start');
    const events = collect(teacherSocket, ['teamFinished']);
    const ack = await emit(teacherSocket, 'confirmMonster', { sessionId: owner.sessionId, teamId: team.state.teamId, taskKey: started.body.blueprint.tasks[0].key });
    assert.ok(ack.ok, ack.error);
    assert.equal(ack.progress.finished, true);
    await sleep(40);
    assert.equal(events.length, 1);
});
