'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const TaskTypes = require('../public/js/shared/task-types.js');
const { containsBadWords } = require('../src/lib/filter');
const { loadConfig, ConfigError, isStrongSecret, ROOT_DIR } = require('../src/config');
const { randomCode } = require('../src/lib/codes');
const { detectImageType } = require('../src/lib/uploads');
const { EXAMPLE_BLUEPRINTS } = require('../src/seed');
const { openDatabase } = require('../src/db');

test('Wortfilter erkennt Umlaute und ß, ohne harmlose Wörter zu treffen', () => {
    for (const text of ['Scheiße', 'scheisse', 'SCHEIẞE', 'so eine scheiße!', 'Miststück', 'miststueck', 'H1tler', 'Du Idioten', 'Arschloch', 'fuck']) {
        assert.equal(containsBadWords(text), true, text);
    }
    for (const text of ['Fußball', 'Straße', 'Müller', 'Barsch', 'Spaß', 'Rakete', '']) {
        assert.equal(containsBadWords(text), false, text);
    }
    for (const value of [undefined, null, 5, {}, []]) {
        assert.equal(containsBadWords(value), false);
    }
});

test('task-types kennt alle 18 Typen mit Label, Kategorie, Icon und Startdaten', () => {
    assert.deepEqual(TaskTypes.types.slice().sort(), [
        'binary', 'bucket', 'chat', 'choice', 'cloze', 'countdown', 'detector', 'hotspot', 'monster', 'mood',
        'pairs', 'password', 'photo', 'profile', 'ranking', 'scroller', 'select', 'statement'
    ]);
    for (const def of TaskTypes.list) {
        assert.ok(def.label && def.category && def.icon, def.type);
        assert.ok(typeof def.defaultData() === 'object');
        assert.equal(TaskTypes.createTask(def.type).type, def.type);
        assert.ok(Array.isArray(def.validate(TaskTypes.createTask(def.type))));
    }
});

test('task-types: Startdaten werden je Aufgabe neu erzeugt', () => {
    const first = TaskTypes.createTask('choice');
    first.options.push('x');
    assert.equal(TaskTypes.createTask('choice').options.length, 3);
});

test('task-types läuft als klassisches Browser-Skript und liefert window.TaskTypes', () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/shared/task-types.js'), 'utf8');
    const window = {};
    vm.runInNewContext(source, { window, globalThis: { crypto: globalThis.crypto } });
    assert.equal(window.TaskTypes.types.length, 18);
    assert.equal(window.TaskTypes.validate({ type: 'statement' }).length, 0);
    assert.ok(window.TaskTypes.validate({ type: 'choice', options: [] }).length > 0);
});

test('alle Beispiel-Spielrunden sind gültig', () => {
    assert.equal(EXAMPLE_BLUEPRINTS.length, 3);
    for (const example of EXAMPLE_BLUEPRINTS) {
        assert.deepEqual(TaskTypes.validateContent({ templateType: example.templateType, tasks: example.tasks }), [], example.title);
    }
});

test('task-types: ungültige Eingaben brechen nie, sondern liefern Fehler', () => {
    for (const task of [null, undefined, 1, 'x', [], {}, { type: 'proto' }, { type: '__proto__' }, { type: 'constructor' }]) {
        assert.ok(TaskTypes.validate(task).length > 0, JSON.stringify(task));
    }
    for (const type of TaskTypes.types) {
        for (const junk of [
            { options: 1, nodes: 1, posts: 1, zones: 1, items: 1, buckets: 1, pairs: 1, rules: 1, fields: 1, customFields: 1, fakes: 1, text: 1, duration: 'x', image: 1 },
            { options: [null], nodes: { start: null }, posts: [null], zones: [null], items: [null], buckets: [null], pairs: [null], rules: [null], fields: [null], customFields: [null], fakes: [null], text: '[]', image: 'http://x/y.png' }
        ]) {
            assert.ok(Array.isArray(TaskTypes.validate({ type, question: 1, ...junk })));
        }
    }
    assert.equal(TaskTypes.validate({ type: 'chat', nodes: { start: { text: 'a', options: [{ label: 'b', next: 'constructor' }] } } }).length, 1);
});

test('task-types: Soft-Locks werden erkannt, gültige Inhalte akzeptiert', () => {
    const invalid = [
        { type: 'choice', options: ['Nur eine'] },
        { type: 'select', options: ['', 'b'] },
        { type: 'chat', nodes: { end: { text: 'x', options: [] } } },
        { type: 'chat', nodes: { start: { text: 'x', options: [{ label: 'a', next: 'loop' }] }, loop: { text: 'y', options: [{ label: 'b', next: 'start' }] } } },
        { type: 'scroller', posts: [] },
        { type: 'detector', image: '' },
        { type: 'detector', image: 'javascript:alert(1)' },
        { type: 'hotspot', image: '/img/a.svg', zones: [{ x: 90, y: 10, w: 20, h: 20 }] },
        { type: 'bucket', buckets: ['a', 'b'], items: [{ text: 'x', target: 2 }] },
        { type: 'bucket', buckets: ['a'], items: [{ text: 'x', target: 0 }] },
        { type: 'ranking', items: ['a'] },
        { type: 'pairs', pairs: [{ left: 'a', right: 'b' }, { left: 'a', right: 'c' }] },
        { type: 'cloze', text: 'Lücke [] leer' },
        { type: 'countdown', duration: 0 },
        { type: 'password', rules: ['Mind. 500 Zeichen'] },
        { type: 'profile', fields: [], customFields: [] }
    ];
    for (const task of invalid) assert.ok(TaskTypes.validate(task).length > 0, JSON.stringify(task));

    const valid = [
        { type: 'binary' },
        { type: 'choice', options: ['a', 'b'] },
        { type: 'chat', nodes: { start: { text: 'x', options: [{ label: 'a', next: 'start' }, { label: 'b', next: 'end' }] }, end: { text: 'y', options: [] } } },
        { type: 'hotspot', image: '/uploads/' + 'a'.repeat(32) + '.jpg', zones: [{ x: 1, y: 1, w: 5, h: 5 }] },
        { type: 'bucket', buckets: ['a', 'b'], items: [{ text: 'x', target: 1 }] },
        { type: 'pairs', pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }] },
        { type: 'cloze', text: 'Das [ist] ein [Test]', fakes: ['war'] },
        { type: 'countdown', duration: 30 },
        { type: 'password' }
    ];
    for (const task of valid) assert.deepEqual(TaskTypes.validate(task), [], JSON.stringify(task));
});

test('task-types: Passwort-Regeln und Lückentext-Zerlegung', () => {
    const rules = ['Mind. 8 Zeichen', 'Mindestens eine Zahl', 'Ein Großbuchstabe', 'Ein Sonderzeichen', 'Lustig sein'];
    assert.equal(TaskTypes.evaluatePasswordRules(rules, 'kurz').accepted, false);
    const good = TaskTypes.evaluatePasswordRules(rules, 'Passwort1!');
    assert.equal(good.accepted, true);
    assert.equal(good.rules[4].checkable, false);
    assert.equal(TaskTypes.evaluatePasswordRules(undefined, '1234567').accepted, false);
    assert.equal(TaskTypes.evaluatePasswordRules(undefined, '12345678').accepted, true);

    const parsed = TaskTypes.parseCloze('Ein [Wort] und [noch eins].');
    assert.deepEqual(parsed.gaps, ['Wort', 'noch eins']);
    assert.deepEqual(parsed.parts[1], { gap: 0 });
});

test('task-types: Leere Regel-Liste heißt keine Regeln, nicht Standardregel', () => {
    assert.deepEqual(TaskTypes.validate({ type: 'password', rules: [] }), []);
    const none = TaskTypes.evaluatePasswordRules([], 'a');
    assert.deepEqual(none.rules, []);
    assert.equal(none.accepted, true);
    assert.equal(TaskTypes.evaluatePasswordRules([], '').accepted, false);
});

test('task-types: Profil-Felder mit gleicher Beschriftung werden abgelehnt', () => {
    const duplicates = [
        { fields: ['name'], customFields: ['Name'] },
        { fields: ['e-mail'], customFields: [' e-mail '] },
        { fields: [], customFields: ['Hobby', 'hobby'] },
        { fields: ['ort', 'ort'], customFields: [] }
    ];
    for (const task of duplicates) {
        assert.ok(TaskTypes.validate({ type: 'profile', ...task }).some((message) => /doppelt/.test(message)), JSON.stringify(task));
    }
    assert.deepEqual(TaskTypes.validate({ type: 'profile', fields: ['name', 'ort'], customFields: ['Hobby', '__proto__'] }), []);
});

test('Editor: Die Frage bleibt bei jedem Typwechsel erhalten', async () => {
    globalThis.TaskTypes = TaskTypes;
    const { changeTaskType, typeChangeLosesData } = await import('../public/js/editor/store.js');
    for (const from of TaskTypes.types) {
        for (const to of TaskTypes.types) {
            const task = { ...TaskTypes.createTask(from), question: 'Station 2' };
            assert.equal(typeChangeLosesData(task, to), false, `${from} -> ${to}`);
            assert.equal(changeTaskType(task, to).question, 'Station 2', `${from} -> ${to}`);
        }
    }
});

test('task-types: Verbote und Höchstgrenzen in Passwort-Regeln gelten richtig herum', () => {
    const accepted = (rule, value) => TaskTypes.evaluatePasswordRules([rule], value).accepted;
    const cases = [
        ['Keine Sonderzeichen', 'abcdefgh', 'abc!'],
        ['Ohne Sonderzeichen', 'abcdefgh', 'abc!'],
        ['Sonderzeichen sind nicht erlaubt', 'abcdefgh', 'abc!'],
        ['Keine Zahlen', 'abcdefgh', 'abc1'],
        ['Keine Großbuchstaben', 'abc', 'aBc'],
        ['Keine Kleinbuchstaben', 'ABC', 'aBC'],
        ['Keine Leerzeichen', 'abc', 'a c'],
        ['Maximal 8 Zeichen', 'abc', 'abcdefghi'],
        ['Max. 8 Zeichen', 'abcdefgh', 'abcdefghi'],
        ['Höchstens 8 Zeichen', 'abc', 'abcdefghi'],
        ['Nicht mehr als 8 Zeichen', 'abc', 'abcdefghi'],
        ['Weniger als 8 Zeichen', 'abcdefg', 'abcdefgh'],
        ['Mehr als 8 Zeichen', 'abcdefghi', 'abcdefgh'],
        ['Genau 3 Zeichen', 'abc', 'abcd'],
        ['8 bis 12 Zeichen', 'abcdefghi', 'abc'],
        ['Mindestens 2 Zahlen', 'a12', 'a1']
    ];
    for (const [rule, good, bad] of cases) {
        assert.equal(accepted(rule, good), true, `${rule}: ${good}`);
        assert.equal(accepted(rule, bad), false, `${rule}: ${bad}`);
        assert.equal(TaskTypes.evaluatePasswordRules([rule], good).rules[0].checkable, true, rule);
        assert.deepEqual(TaskTypes.validate({ type: 'password', rules: [rule] }), [], rule);
    }
});

test('task-types: mehrdeutige Passwort-Regeln blockieren nie', () => {
    for (const rule of ['Keine Zahl am Anfang', 'Höchstens 2 Zahlen', 'Nur Zahlen', 'Eine Zahl oder ein Sonderzeichen', 'Keine 3 Zeichen', 'Mind. 2 Zeichen, max. 4 Zeichen']) {
        const result = TaskTypes.evaluatePasswordRules([rule], '1a!Bcdefghijk');
        assert.equal(result.rules[0].checkable, false, rule);
        assert.equal(result.accepted, true, rule);
    }
});

test('task-types: widersprüchliche Passwort-Regeln werden abgelehnt', () => {
    for (const rules of [
        ['Mind. 8 Zeichen', 'Maximal 4 Zeichen'],
        ['Maximal 0 Zeichen'],
        ['Eine Zahl', 'Keine Zahlen'],
        ['Mindestens 3 Zahlen', 'Eine Sonderzeichen', 'Maximal 3 Zeichen'],
        ['Keine Zahlen', 'Keine Sonderzeichen', 'Keine Großbuchstaben', 'Keine Kleinbuchstaben']
    ]) {
        assert.ok(TaskTypes.validate({ type: 'password', rules }).length > 0, rules.join(', '));
    }
    assert.deepEqual(TaskTypes.validate({ type: 'password', rules: ['Mind. 4 Zeichen', 'Maximal 8 Zeichen', 'Keine Zahlen', 'Ein Sonderzeichen'] }), []);
});

test('task-types: Chat-Knoten mit reservierten Namen blockieren die Prüfung nicht', () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/shared/task-types.js'), 'utf8');
    const graphs = [
        '{"start":{"text":"a","options":[{"label":"b","next":"__proto__"}]},"__proto__":{"text":"c","options":[{"label":"d","next":"__proto__"}]}}',
        '{"start":{"text":"a","options":[{"label":"b","next":"__proto__"}]},"__proto__":{"text":"c","options":[{"label":"d","next":"end"}]},"end":{"text":"e","options":[]}}',
        '{"start":{"text":"a","options":[{"label":"b","next":"constructor"}]},"constructor":{"text":"c","options":[]}}',
        '{"start":{"text":"a","options":[{"label":"b","next":"prototype"}]},"prototype":{"text":"c","options":[]}}'
    ];
    for (const graph of graphs) {
        // vm mit timeout: Eine Endlosschleife liesse sonst den ganzen Testlauf haengen.
        const script = `${source}\nwindow.TaskTypes.validate({ type: 'chat', nodes: JSON.parse(${JSON.stringify(graph)}) });`;
        const errors = vm.runInNewContext(script, { window: {}, globalThis: {} }, { timeout: 2000 });
        assert.equal(errors.length, 1, graph);
        assert.match(errors[0], /^Chat: Der Knoten-Name/);
    }
});

test('task-types: Knoten und Stations-Codes wie Object.prototype-Namen funktionieren', () => {
    const nodes = { start: { text: 'a', options: [{ label: 'b', next: 'toString' }] }, toString: { text: 'c', options: [{ label: 'd', next: 'valueOf' }] }, valueOf: { text: 'e', options: [] } };
    assert.deepEqual(TaskTypes.validate({ type: 'chat', nodes }), []);
    const looping = { start: { text: 'a', options: [{ label: 'b', next: 'toString' }] }, toString: { text: 'c', options: [{ label: 'd', next: 'start' }] } };
    assert.equal(TaskTypes.validate({ type: 'chat', nodes: looping }).length, 2);
    const station = (code) => ({ type: 'statement', code });
    assert.deepEqual(TaskTypes.validateContent({ templateType: 'qr', tasks: [station('constructor'), station('__proto__'), station('valueOf')] }), []);
    assert.equal(TaskTypes.validateContent({ templateType: 'qr', tasks: [station('constructor'), station('CONSTRUCTOR')] }).length, 1);
});

test('Schüler-Ablauf: Ohne Team bleiben weder Station noch ausstehendes Ergebnis', async () => {
    const { forgetTeamProgress, reconcile } = await import('../public/js/student/flow.js');
    const key = '1-0';
    const S = {
        team: { teamId: 1 },
        station: { key, task: { key } },
        pending: { taskKey: key, status: 'completed', answer: { text: 'alt' } },
        showResults: true
    };
    forgetTeamProgress(S);
    assert.deepEqual(S, { team: null, station: null, pending: null, showResults: false });

    S.team = {
        phase: 'running',
        blueprint: { templateType: 'qr', tasks: [{ key }] },
        progress: { tasks: [{ key, status: 'pending' }] }
    };
    reconcile(S);
    assert.equal(S.station, null);
    assert.equal(S.pending, null);
});

test('task-types: sanitizeTask entfernt Fremdfelder und bewahrt Sonderzeichen', () => {
    const clean = TaskTypes.sanitizeTask({ type: 'choice', question: 'Sag "hi"', options: ["it's"], zones: [1], id: { bad: 1 } });
    assert.deepEqual(clean, { type: 'choice', question: 'Sag "hi"', options: ["it's"] });
});

test('Konfiguration: Betrieb verweigert schwache Secrets', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), ConfigError);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'weltenretter-secret' }), ConfigError);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64) }), ConfigError);
    assert.equal(isStrongSecret('kurz'), false);

    const prod = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a-very-long-secret-value-0123456789-abcdefgh' });
    assert.equal(prod.secureCookies, true);
    assert.equal(prod.trustProxy, 1);
    assert.equal(prod.seedDemo, false);
    assert.equal(prod.allowRegistration, false);
});

test('Konfiguration: Pfade sind absolut und unabhängig vom Arbeitsverzeichnis', () => {
    const config = loadConfig({ DATA_DIR: 'relativ/daten' });
    assert.equal(config.dataDir, path.join(ROOT_DIR, 'relativ', 'daten'));
    assert.ok(path.isAbsolute(config.dbPath));
    assert.ok(path.isAbsolute(config.uploadsDir));
    assert.equal(loadConfig({}).dataDir, path.join(ROOT_DIR, 'data'));
    assert.equal(loadConfig({ TRUST_PROXY: 'true' }).trustProxy, 1);
    assert.equal(loadConfig({ COOKIE_SECURE: 'false', NODE_ENV: 'production', SESSION_SECRET: 'a-very-long-secret-value-0123456789-abcdefgh' }).secureCookies, false);
});

test('Codes stammen aus dem Alphabet und sind 6 Zeichen lang', () => {
    for (let i = 0; i < 200; i += 1) assert.match(randomCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test('Bilderkennung über Magic Bytes', () => {
    assert.equal(detectImageType(Buffer.from('nicht ein Bild')), null);
    assert.equal(detectImageType(undefined), null);
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff])), null);
});

test('Migrationen sind wiederholbar und transaktional', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-db-'));
    const file = path.join(dir, 'a.sqlite');
    try {
        const first = openDatabase(file);
        await first.ready;
        await first.close();
        const second = openDatabase(file);
        await second.ready;
        assert.equal((await second.get('PRAGMA user_version')).user_version, 3);
        await assert.rejects(second.transaction(async (tx) => {
            await tx.run("INSERT INTO teachers (username, password, created_at) VALUES ('x', 'y', 'z')");
            throw new Error('Abbruch');
        }), /Abbruch/);
        assert.equal((await second.get('SELECT COUNT(*) AS c FROM teachers')).c, 0);
        await second.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

test('add_teacher liest das Passwort von stdin, nicht aus den Argumenten', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-script-'));
    const script = path.join(ROOT_DIR, 'scripts', 'add_teacher.js');
    const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: dir };
    try {
        const ok = spawnSync(process.execPath, [script, 'lehrkraft'], { input: 'ein-gutes-passwort\n', env, encoding: 'utf8' });
        assert.equal(ok.status, 0, ok.stderr);
        const dup = spawnSync(process.execPath, [script, 'lehrkraft'], { input: 'ein-gutes-passwort\n', env, encoding: 'utf8' });
        assert.equal(dup.status, 1);
        assert.match(dup.stderr, /existiert bereits/);
        const argvStyle = spawnSync(process.execPath, [script, 'lehrkraft2', 'passwort-als-argument'], { input: '', env, encoding: 'utf8' });
        assert.equal(argvStyle.status, 1);
        const shortPw = spawnSync(process.execPath, [script, 'lehrkraft3'], { input: 'kurz\n', env, encoding: 'utf8' });
        assert.equal(shortPw.status, 1);

        const db = openDatabase(path.join(dir, 'database.sqlite'));
        await db.ready;
        assert.equal((await db.get('SELECT COUNT(*) AS c FROM teachers')).c, 1);
        assert.equal((await db.get('SELECT COUNT(*) AS c FROM blueprints')).c, 9);
        await db.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
