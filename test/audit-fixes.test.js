'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3');
const TaskTypes = require('../public/js/shared/task-types.js');
const { ROOT_DIR } = require('../src/config');
const { openDatabase } = require('../src/db');
const { EXAMPLE_BLUEPRINTS } = require('../src/seed');
const { createHarness } = require('./helpers');

const SCRIPT = path.join(ROOT_DIR, 'scripts', 'add_teacher.js');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PASSWORD = 'ein-gutes-passwort';

const OLD_STARTER_NODES = {
    start: { text: 'Gibst du mir dein Passwort für gratis Coins?', options: [{ label: 'Klar!', next: 'bad' }, { label: 'Nein!', next: 'good' }] },
    bad: { text: 'Account gehackt!', options: [] },
    good: { text: 'Sicher geblieben!', options: [] }
};
const chatContent = (nodes) => JSON.stringify({
    tasks: [{ type: 'chat', partner: 'ZockerPro', description: 'Reagiere.', nodes }],
    templateType: 'normal'
});

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function addTeacher(name, dir) {
    return spawnSync(process.execPath, [SCRIPT, name], {
        input: `${PASSWORD}\n`,
        env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dir },
        encoding: 'utf8'
    });
}

/** Baut eine Datenbank auf dem Stand von Migration 001 nach. */
async function databaseAtVersion1(file, setup) {
    const db = openDatabase(file);
    await db.ready;
    await db.exec('PRAGMA user_version = 1');
    await db.exec('DROP TABLE board_cards; DROP TABLE board_states;');
    await db.exec('ALTER TABLE sessions DROP COLUMN game_mode');
    await setup(db);
    await db.close();
}

test('add_teacher speichert den Namen wie beim Login gekürzt, das Konto kann sich anmelden', async () => {
    const dir = tempDir('weltenretter-name-');
    try {
        for (const name of ['anna ', ' bob']) {
            const result = addTeacher(name, dir);
            assert.equal(result.status, 0, result.stderr);
        }
        const harness = await createHarness({ env: { DATA_DIR: dir } });
        try {
            const rows = await harness.db.all('SELECT username FROM teachers ORDER BY username');
            assert.deepEqual(rows.map((row) => row.username), ['anna', 'bob']);
            for (const username of ['anna', 'anna ', ' bob']) {
                const login = await harness.client().post('/api/login', { username, password: PASSWORD });
                assert.equal(login.status, 200, username);
            }
        } finally {
            await harness.stop();
        }
    } finally {
        removeDir(dir);
    }
});

test('add_teacher lehnt Namen ab, mit denen niemand sich anmelden könnte', async () => {
    const dir = tempDir('weltenretter-name-');
    try {
        for (const name of ['   ', 'x'.repeat(255)]) {
            const result = addTeacher(name, dir);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /1 bis 254 Zeichen/);
        }
        const longest = addTeacher('y'.repeat(254), dir);
        assert.equal(longest.status, 0, longest.stderr);
        const db = openDatabase(path.join(dir, 'database.sqlite'));
        await db.ready;
        assert.equal((await db.get('SELECT COUNT(*) AS c FROM teachers')).c, 1);
        await db.close();
    } finally {
        removeDir(dir);
    }
});

test('Registrierung aus: Kein Formular, und der Client erfährt es', async () => {
    const closed = await createHarness({ env: { ALLOW_REGISTRATION: 'false' } });
    const open = await createHarness({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
        assert.deepEqual((await closed.client().get('/api/config')).body, { allowRegistration: false });
        assert.deepEqual((await open.client().get('/api/config')).body, { allowRegistration: true });

        const page = (harness) => fetch(`${harness.base}/register.html`, { redirect: 'manual' });
        const redirected = await page(closed);
        assert.equal(redirected.status, 302);
        assert.equal(redirected.headers.get('location'), '/login.html');
        assert.equal((await page(open)).status, 200);
    } finally {
        await closed.stop();
        await open.stop();
    }
});

test('Der Link zur Registrierung ist versteckt, bis der Server ihn erlaubt', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8');
    const link = html.match(/<a [^>]*id="registerLink"[^>]*>/);
    assert.ok(link, 'Link fehlt');
    assert.match(link[0], /class="hidden /);
});

test('Favicon: jede Seite verlinkt die eigene SVG-Datei', async () => {
    const pages = fs.readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'));
    assert.ok(pages.length >= 6);
    for (const name of pages) {
        assert.match(fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8'), /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/, name);
    }
    const harness = await createHarness();
    try {
        const response = await fetch(`${harness.base}/favicon.svg`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
        assert.doesNotMatch(await response.text(), /<script|on\w+=|style=/i);
    } finally {
        await harness.stop();
    }
});

test('Starter-Runde: Die Knotennamen des Chats verraten die Antwort nicht', () => {
    const starter = EXAMPLE_BLUEPRINTS.find((example) => example.title === 'Weltenretter Starter-Runde');
    const chat = starter.tasks.find((task) => task.type === 'chat');
    assert.deepEqual(Object.keys(chat.nodes), ['start', 'ende1', 'ende2']);
    assert.deepEqual(chat.nodes.start.options.map((option) => option.next), ['ende1', 'ende2']);
    assert.deepEqual(TaskTypes.validate(chat), []);
});

test('Migration 003 benennt nur unveränderte Beispiel-Chats um', async () => {
    const dir = tempDir('weltenretter-migrate-');
    const file = path.join(dir, 'database.sqlite');
    const edited = { ...OLD_STARTER_NODES, bad: { text: 'Selbst geschrieben', options: [] } };
    try {
        let pristineId;
        let editedId;
        await databaseAtVersion1(file, async (db) => {
            const teacher = await db.run("INSERT INTO teachers (username, password, created_at) VALUES ('alt', 'x', 'y')");
            const insert = (title, content) => db.run("INSERT INTO blueprints (teacher_id, title, game_type, content, created_at) VALUES (?, ?, 'template', ?, 'y')", [teacher.lastID, title, content]);
            pristineId = (await insert('Weltenretter Starter-Runde', chatContent(OLD_STARTER_NODES))).lastID;
            editedId = (await insert('Eigene Runde', chatContent(edited))).lastID;
        });

        const db = openDatabase(file);
        await db.ready;
        assert.equal((await db.get('PRAGMA user_version')).user_version, 3);
        const nodesOf = async (id) => JSON.parse((await db.get('SELECT content FROM blueprints WHERE id = ?', [id])).content).tasks[0].nodes;

        const pristine = await nodesOf(pristineId);
        assert.deepEqual(Object.keys(pristine), ['start', 'ende1', 'ende2']);
        assert.deepEqual(pristine.start.options, [{ label: 'Klar!', next: 'ende1' }, { label: 'Nein!', next: 'ende2' }]);
        assert.equal(pristine.ende1.text, 'Account gehackt!');
        assert.equal(pristine.ende2.text, 'Sicher geblieben!');
        assert.deepEqual(await nodesOf(editedId), edited);
        await db.close();
    } finally {
        removeDir(dir);
    }
});

test('Migration 002 ist eingefroren und hängt nicht am Seed', () => {
    const probe = `
        const path = require('path');
        require(path.join(process.argv[1], 'src/db/migrations/002_board.js'));
        console.log(Object.keys(require.cache).filter((file) => /seed/i.test(path.basename(file))).length);
    `;
    const loaded = spawnSync(process.execPath, ['-e', probe, ROOT_DIR], { encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout.trim(), '0');

    // Wer diese Daten ändert, ändert, was noch nicht migrierte Installationen bekommen.
    const frozen = require('../src/db/migrations/002_board.kartensets.json');
    assert.equal(frozen.length, 6);
    const digest = crypto.createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
    assert.equal(digest, '7016c4919016e6c08f1e43535eef3b5824fac14809f6ba39237b128aa881d00e');
});

test('Datenbank ohne Migrationsstand: klare Meldung, die Daten bleiben unverändert', async () => {
    const dir = tempDir('weltenretter-legacy-');
    const file = path.join(dir, 'database.sqlite');
    const raw = (run) => new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(file);
        run(connection, (err, value) => connection.close(() => (err ? reject(err) : resolve(value))));
    });
    try {
        await raw((connection, done) => connection.exec('CREATE TABLE teachers (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);', done));

        const db = openDatabase(file);
        await assert.rejects(db.ready, /alten Version ohne Migrationsstand/);
        await db.close().catch(() => {});

        const tables = await raw((connection, done) => connection.all("SELECT name FROM sqlite_master WHERE type = 'table'", done));
        assert.deepEqual(tables.map((row) => row.name), ['teachers']);
        const version = await raw((connection, done) => connection.get('PRAGMA user_version', done));
        assert.equal(version.user_version, 0);
    } finally {
        removeDir(dir);
    }
});

test('Code-Sperre der Kamera: bis der Code eine Weile nicht mehr im Bild war', async () => {
    const { createCodeHold } = await import('../public/js/student/scanner.js');
    let clock = 0;
    const holds = createCodeHold({ releaseMs: 2000, unseenMs: 4000, now: () => clock });
    const advance = (ms) => { clock += ms; };

    assert.equal(holds.blocks('A'), false, 'nicht gesperrt');

    // Wird der Code weiter gesehen, hält die Sperre beliebig lange.
    holds.hold('A');
    for (let i = 0; i < 20; i++) {
        advance(1000);
        assert.equal(holds.blocks('a '), true, 'Gross-/Kleinschreibung und Leerzeichen zählen nicht');
    }

    // Ein anderer Code läuft sofort durch und löst die Sperre nicht auf.
    assert.equal(holds.blocks('B'), false);
    advance(100);
    assert.equal(holds.blocks('A'), true);

    // Einzelne Fehllesungen reichen nicht.
    holds.miss();
    advance(1500);
    holds.miss();
    assert.equal(holds.blocks('A'), true);

    // Zwei Sekunden ohne Treffer geben ihn frei.
    holds.miss();
    advance(2000);
    holds.miss();
    assert.equal(holds.blocks('A'), false);

    // Zeit ohne ausgewertete Bilder zählt nicht, und nach dem Kamerastart gibt es mehr Geduld.
    holds.hold('C');
    advance(60000);
    holds.miss();
    advance(3000);
    holds.miss();
    assert.equal(holds.blocks('C'), true, 'noch nicht freigegeben');

    holds.hold('D');
    holds.miss();
    advance(4000);
    holds.miss();
    assert.equal(holds.blocks('D'), false, 'nie gesehen: nach 4 s frei');

    holds.hold('E');
    holds.clear();
    assert.equal(holds.blocks('E'), false);
});
