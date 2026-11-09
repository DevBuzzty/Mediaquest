'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const TaskTypes = require('../public/js/shared/task-types.js');
const { studentTask } = require('../src/lib/board');
const { WORLD_KARTENSETS } = require('../src/seed');

const POSTS = Array.from({ length: 10 }, (_, i) => ({ user: `U${i}`, text: `Post ${i}`, isBad: i < 2 }));
const CHAT = {
    type: 'chat',
    nodes: {
        start: { text: 'Hi', options: [{ label: 'Gut', next: 'mitte' }, { label: 'Falsch', next: 'schlecht' }] },
        mitte: { text: 'Und?', options: [{ label: 'Weiter', next: 'erfolg' }] },
        erfolg: { text: 'Super', options: [], success: true },
        schlecht: { text: 'Oh', options: [] }
    }
};

const TASKS = {
    binary: { type: 'binary', correct: 'left' },
    choice: { type: 'choice', options: ['a', 'b', 'c'], correct: 1 },
    select: { type: 'select', options: ['a', 'b', 'c'], correct: [0, 2] },
    bucket: { type: 'bucket', buckets: ['A', 'B'], items: [{ text: 'x', target: 0 }, { text: 'y', target: 1 }] },
    ranking: { type: 'ranking', items: ['eins', 'zwei', 'drei'] },
    pairs: { type: 'pairs', pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }] },
    cloze: { type: 'cloze', text: 'Das [ist] ein [Test]', fakes: ['war'] },
    chat: CHAT,
    scroller: { type: 'scroller', posts: POSTS },
    photo: { type: 'photo' },
    statement: { type: 'statement' },
    monster: { type: 'monster', question: 'Hallo' }
};

test('Sichtbare Typen: genau die 12 aus dem Spielkonzept', () => {
    assert.deepEqual(TaskTypes.EDITOR_TYPES, ['binary', 'choice', 'select', 'bucket', 'ranking', 'pairs', 'cloze', 'chat', 'scroller', 'photo', 'statement', 'monster']);
    assert.deepEqual(TaskTypes.editorList().map((def) => def.label), [
        'Binary Swipe', 'Multiple Choice', 'Multiple Select', 'Bucket Drop', 'Ranking', 'Paare finden',
        'Lückentext', 'Chatsimulator', 'Feed-Scroller', 'Foto Upload', 'Freitextfeld', 'Monster-Aufgaben'
    ]);
    assert.ok(TaskTypes.EDITOR_TYPES.every((type) => TaskTypes.get(type)));
});

test('Ausgeblendete Typen bleiben gültig, speicherbar und laufen ihre Regeln', () => {
    const hidden = TaskTypes.types.filter((type) => !TaskTypes.EDITOR_TYPES.includes(type));
    assert.deepEqual(hidden.sort(), ['countdown', 'detector', 'hotspot', 'mood', 'password', 'profile']);
    for (const task of [{ type: 'mood' }, { type: 'countdown', duration: 30 }, { type: 'password' }, { type: 'profile', fields: ['name'] }]) {
        assert.deepEqual(TaskTypes.validate(task), []);
        assert.deepEqual(TaskTypes.sanitizeTask(task).type, task.type);
    }
    assert.deepEqual(TaskTypes.validateContent({ templateType: 'normal', tasks: [{ type: 'mood' }] }), []);
});

test('Monster-Aufgabe: Text ist Pflicht, Bild und Audio sind optional', () => {
    assert.ok(TaskTypes.validate({ type: 'monster' }).length > 0);
    assert.deepEqual(TaskTypes.validate({ type: 'monster', question: 'Tu etwas' }), []);
    assert.deepEqual(TaskTypes.validate({ type: 'monster', question: 'x', image: '/img/beispiel-phishing.svg', audio: `/uploads/${'a'.repeat(32)}.mp3` }), []);
    assert.ok(TaskTypes.validate({ type: 'monster', question: 'x', image: 'http://boese/x.png' }).length > 0);
});

test('Audio-Feld gilt für jeden Typ und nur für Uploads', () => {
    const url = `/uploads/${'a'.repeat(32)}.m4a`;
    for (const type of TaskTypes.types) {
        assert.equal(TaskTypes.sanitizeTask({ type, audio: url }).audio, url, type);
    }
    for (const audio of ['http://x/y.mp3', `/uploads/${'a'.repeat(32)}.exe`, '/img/x.mp3', 5, {}]) {
        assert.ok(TaskTypes.validate({ type: 'statement', audio }).length > 0, String(audio));
    }
    assert.deepEqual(TaskTypes.validate({ type: 'statement', audio: '' }), []);
    assert.deepEqual(TaskTypes.validate({ type: 'statement', audio: null }), []);
});

test('Bewertung: jeder Typ erkennt richtige und falsche Antworten', () => {
    const cases = [
        ['binary', { choice: 'left' }, { choice: 'right' }],
        ['choice', { index: 1, label: 'b' }, { index: 0, label: 'a' }],
        ['select', { indices: [2, 0] }, { indices: [0] }],
        ['select', { indices: [0, 2] }, { indices: [0, 1, 2] }],
        ['bucket', { placements: [{ item: 'x', bucket: 'A' }, { item: 'y', bucket: 'B' }] }, { placements: [{ item: 'x', bucket: 'B' }, { item: 'y', bucket: 'B' }] }],
        ['bucket', { placements: [{ item: 'y', bucket: 'B' }, { item: 'x', bucket: 'A' }] }, { placements: [{ item: 'x', bucket: 'A' }] }],
        ['ranking', { order: ['eins', 'zwei', 'drei'] }, { order: ['zwei', 'eins', 'drei'] }],
        ['pairs', { assignments: [{ left: 'c', right: 'd' }, { left: 'a', right: 'b' }] }, { assignments: [{ left: 'a', right: 'd' }, { left: 'c', right: 'b' }] }],
        ['cloze', { gaps: ['ist', 'Test'] }, { gaps: ['war', 'Test'] }],
        ['cloze', { gaps: [' ist ', 'Test'] }, { gaps: ['ist'] }],
        ['chat', { path: [{ node: 'start', choice: 'Gut' }, { node: 'mitte', choice: 'Weiter' }] }, { path: [{ node: 'start', choice: 'Falsch' }] }],
        ['scroller', { marked: [1, 0] }, { marked: [0, 1, 2] }],
        ['scroller', { marked: [0, 1] }, { marked: [0] }],
        ['photo', { url: '/uploads/x.jpg' }, { url: '' }],
        ['statement', { text: 'Ein Satz' }, { text: '   ' }],
        ['monster', { confirmed: true }, { confirmed: false }]
    ];
    for (const [type, right, wrong] of cases) {
        assert.equal(TaskTypes.judge(TASKS[type], right), true, `${type} richtig`);
        assert.equal(TaskTypes.judge(TASKS[type], wrong), false, `${type} falsch`);
    }
});

test('Bewertung: ein unterwegs abgebrochener Chat zählt nicht', () => {
    assert.equal(TaskTypes.judge(CHAT, { path: [{ node: 'start', choice: 'Gut' }] }), false);
    assert.equal(TaskTypes.judge(CHAT, { path: [{ node: 'mitte', choice: 'Weiter' }] }), false);
    assert.equal(TaskTypes.judge(CHAT, { path: [] }), false);
    assert.equal(TaskTypes.judge(CHAT, { path: [{ node: 'start', choice: 'Gut' }, { node: 'mitte', choice: 'Nix' }] }), false);
});

test('Bewertung: kaputte Antworten werfen nie und sind falsch', () => {
    const junk = [
        undefined, null, 1, 'x', true, [], {},
        { choice: null, index: 'x', indices: 'x', placements: 'x', order: 1, matched: '2', gaps: {}, path: 'x', marked: 1, url: 1, text: 1, confirmed: 'ja' },
        { choice: {}, index: [], indices: [null, {}], placements: [null], order: [null], matched: NaN, gaps: [null, 1], path: [null], marked: [null, 'a'], url: {}, text: {} },
        { indices: [1.5, 2.5], marked: [Infinity], placements: [{ item: {}, bucket: [] }], path: [{ node: '__proto__', choice: 'x' }], assignments: 'x' },
        { assignments: [null, 1] },
        { assignments: [{ left: 1, right: {} }, { left: null, right: [] }] },
        { path: [{ node: 'constructor', choice: 'x' }, null] }
    ];
    for (const task of Object.values(TASKS)) {
        for (const answer of junk) {
            assert.equal(TaskTypes.judge(task, answer), false, `${task.type}: ${JSON.stringify(answer)}`);
        }
    }
    for (const task of [null, undefined, 1, 'x', [], {}, { type: '__proto__' }, { type: 'choice' }, { type: 'chat', nodes: 1 }, { type: 'cloze', text: 1 }]) {
        assert.equal(TaskTypes.judge(task, { index: 0, path: [{ node: 'start', choice: 'x' }], gaps: ['x'] }), false);
    }
});

test('Paare finden: gewertet wird die Zuordnung, nicht eine vom Client gemeldete Anzahl', () => {
    const task = TASKS.pairs;
    const right = [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }];
    assert.equal(TaskTypes.judge(task, { matched: 2 }), false, 'alte Anzahl reicht nicht');
    assert.equal(TaskTypes.judge(task, { matched: 2, assignments: right.slice(0, 1) }), false, 'unvollständig');
    assert.equal(TaskTypes.judge(task, { assignments: [right[0], right[0]] }), false, 'dasselbe Paar doppelt');
    assert.equal(TaskTypes.judge(task, { assignments: [...right, right[0]] }), false, 'zu viele');
    assert.equal(TaskTypes.judge(task, { assignments: right }), true);
});

test('Bewertung: Duplikate in Antwortlisten sind keine Menge', () => {
    assert.equal(TaskTypes.judge(TASKS.select, { indices: [0, 0, 2] }), false);
    assert.equal(TaskTypes.judge(TASKS.scroller, { marked: [0, 0, 1] }), false);
});

test('Ausgeblendete Typen lassen sich nicht bewerten', () => {
    assert.equal(TaskTypes.judge({ type: 'mood' }, { value: 50 }), false);
    assert.equal(TaskTypes.judge({ type: 'countdown', duration: 5 }, { expired: false }), false);
});

function world(tasks, key = 'news') {
    return { templateType: 'world', world: key, tasks };
}

const monsters = (count = 3) => Array.from({ length: count }, (_, i) => ({ type: 'monster', question: `M${i}` }));

test('Kartenset: Karten ohne Lösung werden je Aufgabe abgelehnt', () => {
    const missing = [
        { type: 'binary', code: 'A-1' },
        { type: 'choice', code: 'A-2', options: ['a', 'b'] },
        { type: 'select', code: 'A-3', options: ['a', 'b'], correct: [] },
        { type: 'chat', code: 'A-4', nodes: { start: { text: 'x', options: [] } } },
        { type: 'scroller', code: 'A-5', posts: POSTS.map(({ user, text }) => ({ user, text })) }
    ];
    for (const task of missing) {
        const details = TaskTypes.validateContent(world([task, ...monsters()]));
        assert.equal(details.length, 1, JSON.stringify(details));
        assert.equal(details[0].taskIndex, 0);
        assert.match(details[0].message, /[äöüÄÖÜß]|Bitte|Chat|Feed/);
    }
    assert.deepEqual(TaskTypes.validateContent(world([{ type: 'binary', code: 'A-1', correct: 'right' }, ...monsters()])), []);
});

test('Kartenset: Ein Chat, dessen Start schon das Erfolgs-Ende ist, wird abgelehnt', () => {
    const task = { type: 'chat', code: 'A-4', nodes: { start: { text: 'x', options: [], success: true } } };
    const details = TaskTypes.validateContent(world([task, ...monsters()]));
    assert.equal(details.length, 1, JSON.stringify(details));
    assert.equal(details[0].taskIndex, 0);
    assert.match(details[0].message, /Chat/);
    assert.equal(TaskTypes.judge(task, { path: [] }), false);
});

test('Kartenset: Kaputte Chat-Knoten werden gemeldet und werfen nie', () => {
    for (const nodes of [{ start: { text: 'a' } }, { start: null }, { start: { text: 'a', options: 'x' } }, { start: { text: 'a', options: [null] } }, 1, null, []]) {
        const task = { type: 'chat', code: 'A-4', nodes };
        const details = TaskTypes.validateContent(world([task, ...monsters()]));
        assert.ok(details.some((entry) => entry.taskIndex === 0), JSON.stringify(nodes));
        assert.doesNotThrow(() => TaskTypes.solutionErrors(task));
    }
});

test('Kartenset: Lösungsprüfung übersteht kaputte Felder jedes Typs', () => {
    const junk = [
        { options: 1, nodes: 1, posts: 1, items: 1, buckets: 1, pairs: 1, text: 1, correct: {}, image: 1 },
        { options: [null], nodes: { start: null }, posts: [null], items: [null], buckets: [null], pairs: [null], text: '[]', correct: [null] },
        { options: null, nodes: null, posts: null, items: null, buckets: null, pairs: null, text: null, correct: 'x' }
    ];
    for (const type of TaskTypes.types) {
        for (const fields of junk) {
            const task = { type, code: 'A-1', ...fields };
            assert.doesNotThrow(() => TaskTypes.solutionErrors(task), `${type}: ${JSON.stringify(fields)}`);
            assert.doesNotThrow(() => TaskTypes.validateContent(world([task, ...monsters()])), `${type}: ${JSON.stringify(fields)}`);
        }
    }
});

test('Kartenset: Aufbau und Codes werden geprüft', () => {
    const card = { type: 'statement', code: 'S-1' };
    assert.ok(TaskTypes.validateContent(world([card, ...monsters(2)])).some((d) => d.taskIndex === null));
    assert.ok(TaskTypes.validateContent(world([card, ...monsters(4)])).some((d) => d.taskIndex === null));
    assert.ok(TaskTypes.validateContent(world(monsters())).some((d) => d.taskIndex === null));
    assert.ok(TaskTypes.validateContent(world([card, ...monsters()], 'quatsch')).some((d) => d.taskIndex === null));
    assert.ok(TaskTypes.validateContent(world([{ type: 'statement', code: 'x' }, ...monsters()])).some((d) => d.taskIndex === 0));
    assert.ok(TaskTypes.validateContent(world([card, { type: 'statement', code: 's-1' }, ...monsters()])).some((d) => d.taskIndex === 1));
    assert.deepEqual(TaskTypes.validateContent(world([card, ...monsters()])), []);
    assert.ok(TaskTypes.validateContent(world([{ type: 'mood', code: 'M-1' }, ...monsters()])).some((d) => d.taskIndex === 0));
});

test('Lösungen: Teams bekommen keine Lösungsfelder', () => {
    const view = (task) => studentTask({ ...task, code: 'X-1' }, '1-0');
    assert.equal(view(TASKS.binary).correct, undefined);
    assert.equal(view(TASKS.choice).correct, undefined);
    assert.equal(view(TASKS.select).correct, undefined);
    assert.equal(view(TASKS.choice).code, undefined);
    assert.equal(view(TASKS.choice).key, '1-0');
    assert.ok(view(TASKS.bucket).items.every((item) => !('target' in item)));
    assert.ok(view(TASKS.scroller).posts.every((post) => !('isBad' in post)));
    assert.ok(Object.values(view(CHAT).nodes).every((node) => !('success' in node)));
    assert.deepEqual(view(TASKS.ranking).items.slice().sort(), ['drei', 'eins', 'zwei']);
    const texts = (pairs, side) => pairs.map((pair) => pair[side]).sort();
    assert.deepEqual(texts(view(TASKS.pairs).pairs, 'left'), ['a', 'c']);
    assert.deepEqual(texts(view(TASKS.pairs).pairs, 'right'), ['b', 'd']);
    const long = { type: 'pairs', pairs: Array.from({ length: 8 }, (_, i) => ({ left: `L${i}`, right: `R${i}` })) };
    const stillPaired = Array.from({ length: 20 }, () => view(long).pairs.every((pair) => pair.right === pair.left.replace('L', 'R')));
    assert.ok(stillPaired.includes(false), 'Die Zuordnung darf nicht mitgeliefert werden');
    assert.equal(view(TASKS.cloze).text, TASKS.cloze.text); // Ausnahme: Der Renderer braucht die Lücken.
    assert.equal(CHAT.nodes.erfolg.success, true, 'Das Original bleibt unverändert');
});

test('Beispiel-Chats verraten die Lösung nicht über ihre Knotennamen', () => {
    const chats = WORLD_KARTENSETS.map((set) => set.tasks.find((task) => task.type === 'chat'));
    assert.equal(chats.length, 6);
    for (const chat of chats) {
        assert.ok(Object.keys(chat.nodes).every((id) => !/gut|schlecht|richtig|falsch|erfolg/i.test(id)), JSON.stringify(Object.keys(chat.nodes)));
    }
    const successIds = chats.map((chat) => Object.keys(chat.nodes).find((id) => chat.nodes[id].success));
    assert.equal(new Set(successIds).size, 2, 'Das Erfolgs-Ende heißt nicht immer gleich');
    const firstIsRight = chats.map((chat) => chat.nodes[chat.nodes.start.options[0].next].success === true);
    assert.ok(firstIsRight.includes(true) && firstIsRight.includes(false), 'Die richtige Antwort steht nicht immer oben');
});

test('Beispiel-Kartensets sind vollständig', () => {
    assert.deepEqual(WORLD_KARTENSETS.map((set) => set.world), ['haupt', 'news', 'dschungel', 'daten', 'ki', 'strand']);
    for (const set of WORLD_KARTENSETS) {
        assert.deepEqual(TaskTypes.validateContent({ templateType: 'world', world: set.world, tasks: set.tasks }), [], set.world);
        const cards = set.tasks.filter((task) => task.type !== 'monster');
        assert.ok(cards.length >= 7, set.world);
        const types = new Set(cards.map((task) => task.type));
        for (const type of TaskTypes.EDITOR_TYPES.filter((entry) => entry !== 'monster')) {
            assert.ok(types.has(type), `${set.world}: ${type}`);
        }
        const mons = set.tasks.filter((task) => task.type === 'monster');
        assert.equal(mons.length, 3);
        assert.ok(mons.every((task) => task.question.startsWith('[Platzhalter]') && !task.code));
        assert.ok(cards.every((task) => /^[A-Z]+-\d{2}$/.test(task.code)));
    }
    assert.match(WORLD_KARTENSETS[0].tasks.filter((task) => task.type === 'monster')[2].question, /Endboss/);
    assert.equal(WORLD_KARTENSETS[1].tasks[0].code, 'NEWS-01');
});
