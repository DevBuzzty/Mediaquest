'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createHarness, expectAlive, unique, PASSWORD } = require('./helpers');

let h;
const mails = [];
const mailer = { enabled: true, sendLoginCode: async (email, code) => { mails.push({ email, code }); } };

before(async () => { h = await createHarness({ mailer }); });
after(async () => { await h.stop(); });

test('nicht-Text-Eingaben werden sauber abgelehnt und der Prozess lebt weiter', async () => {
    const client = h.client();
    for (const body of [{ email: 123 }, { email: null }, { email: ['a@b.de'] }, {}, { email: { includes: 1 } }]) {
        assert.equal((await client.post('/api/register', body)).status, 400);
    }
    for (const body of [{ username: 1, password: 2 }, { username: 'a', password: null }, {}, { username: {}, password: [] }]) {
        assert.equal((await client.post('/api/login', body)).status, 400);
    }
    assert.equal((await client.post('/api/join', { code: 5 })).status, 400);
    assert.equal((await client.post('/api/join', {})).status, 400);
    assert.equal((await client.post('/api/rejoin', { teamCode: 5 })).status, 400);
    assert.equal((await client.post('/api/teams', { name: 5, color: '#3b82f6' })).status, 400);
    await expectAlive(h, assert);
});

test('kaputtes JSON liefert 400 ohne Stacktrace, Formulardaten werden nicht geparst', async () => {
    const client = h.client();
    const broken = await client.post('/api/login', '{kaputt');
    assert.equal(broken.status, 400);
    assert.doesNotMatch(broken.text, /node_modules|at .*\.js/);

    const form = await fetch(`${h.base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'username=admin&password=admin'
    });
    assert.equal(form.status, 400);
});

test('Registrierung überschreibt kein Konto und antwortet identisch', async () => {
    const row = await h.createTeacherRow(`${unique('alt')}@example.org`);
    const before = await h.db.get('SELECT password FROM teachers WHERE id = ?', [row.id]);
    const newAddress = `${unique('neu')}@example.org`;

    const client = h.client();
    const existingResponse = await client.post('/api/register', { email: row.username });
    const newResponse = await client.post('/api/register', { email: newAddress });
    assert.equal(existingResponse.status, 200);
    assert.equal(newResponse.status, 200);
    assert.deepEqual(existingResponse.body, newResponse.body);

    const after = await h.db.get('SELECT password FROM teachers WHERE id = ?', [row.id]);
    assert.equal(after.password, before.password);
    assert.equal((await client.post('/api/login', { username: row.username, password: PASSWORD })).status, 200);
    assert.ok(!mails.some((mail) => mail.email === row.username));
});

test('neue Lehrkräfte bekommen Beispiel-Spielrunden und können sich mit dem Code anmelden', async () => {
    const email = `${unique('frisch')}@Example.org`;
    const client = h.client();
    await client.post('/api/register', { email });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mail = mails.find((entry) => entry.email === email.toLowerCase());
    assert.ok(mail, 'Login-Code wurde versendet');

    const login = await client.post('/api/login', { username: email, password: mail.code });
    assert.equal(login.status, 200);
    const list = await client.get('/api/blueprints');
    // 3 Beispiel-Spielrunden und 6 Kartensets (je Welt eines).
    assert.equal(list.body.blueprints.length, 9);
});

test('Login vergibt eine neue Session-ID, Cookie ist HttpOnly und Lax', async () => {
    const row = await h.createTeacherRow();
    const client = h.client();
    // Vor dem Login eine Session mit Identitaet erzeugen
    const owner = await h.openSession();
    await client.post('/api/join', { code: owner.code });
    const fixated = client.cookie;
    assert.ok(fixated);

    const response = await client.request('POST', '/api/login', { username: row.username, password: PASSWORD });
    assert.notEqual(client.cookie, fixated);
    const header = response.headers.getSetCookie().join(';');
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);

    const stale = h.client();
    stale.cookie = fixated;
    assert.deepEqual((await stale.get('/api/me')).body, { loggedIn: false });
});

test('Sicherheits-Header und CSP sind gesetzt', async () => {
    const response = await h.client().get('/healthz');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('Passwort ändern prüft das alte Passwort und beendet andere Anmeldungen', async () => {
    const teacher = await h.teacher();
    const secondDevice = h.client();
    await secondDevice.post('/api/login', { username: teacher.username, password: PASSWORD });

    const wrong = await teacher.post('/api/change-password', { currentPassword: 'falsch', newPassword: 'ganz-neu-123' });
    assert.equal(wrong.status, 403);
    assert.equal((await teacher.post('/api/change-password', { currentPassword: PASSWORD, newPassword: 'kurz' })).status, 400);
    assert.equal((await teacher.post('/api/change-password', { currentPassword: 1, newPassword: 2 })).status, 400);

    const ok = await teacher.post('/api/change-password', { currentPassword: PASSWORD, newPassword: 'ganz-neu-123' });
    assert.equal(ok.status, 200);
    assert.equal((await teacher.get('/api/me')).body.loggedIn, true);
    assert.equal((await secondDevice.get('/api/me')).body.loggedIn, false);

    const row = await h.db.get('SELECT password FROM teachers WHERE id = ?', [teacher.teacherId]);
    assert.equal(await bcrypt.compare('ganz-neu-123', row.password), true);
    assert.equal((await h.client().post('/api/login', { username: teacher.username, password: PASSWORD })).status, 401);
});

test('Logout beendet die Anmeldung', async () => {
    const teacher = await h.teacher();
    assert.equal((await teacher.post('/api/logout')).status, 200);
    assert.equal((await teacher.get('/api/me')).body.loggedIn, false);
    assert.equal((await teacher.get('/api/blueprints')).status, 401);
});

test('Sessions liegen im SQLite-Store', async () => {
    const teacher = await h.teacher();
    const sid = decodeURIComponent(teacher.cookie.split('=')[1]).slice(2).split('.')[0];
    const row = await h.db.get('SELECT sess FROM http_sessions WHERE sid = ?', [sid]);
    assert.equal(JSON.parse(row.sess).teacherId, teacher.teacherId);
});

test('Registrierung lässt sich abschalten', async () => {
    const closed = await createHarness({ env: { ALLOW_REGISTRATION: 'false' } });
    try {
        const response = await closed.client().post('/api/register', { email: 'x@example.org' });
        assert.equal(response.status, 403);
        const row = await closed.db.get('SELECT COUNT(*) AS count FROM teachers');
        assert.equal(row.count, 0);
    } finally {
        await closed.stop();
    }
});

test('Secure-Cookie hinter dem Reverse-Proxy', async () => {
    const prod = await createHarness({
        env: { NODE_ENV: 'production', SESSION_SECRET: 'a-very-long-secret-value-0123456789-abcdefgh', BCRYPT_ROUNDS: '4', SESSION_RETENTION_DAYS: '0' }
    });
    try {
        const row = await prod.createTeacherRow();
        const login = (headers) => fetch(`${prod.base}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ username: row.username, password: PASSWORD })
        });
        const viaProxy = await login({ 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' });
        assert.equal(viaProxy.status, 200);
        const cookie = viaProxy.headers.getSetCookie().join(';');
        assert.match(cookie, /Secure/);
        assert.match(cookie, /SameSite=Lax/);
        const direct = await login({});
        assert.deepEqual(direct.headers.getSetCookie(), [], 'ohne HTTPS kein Cookie');
    } finally {
        await prod.stop();
    }
});

test('Rate-Limit greift beim Login', async () => {
    const limited = await createHarness({
        overrides: {
            rateLimits: {
                login: { windowMs: 60000, max: 3 },
                register: { windowMs: 60000, max: 3 },
                join: { windowMs: 60000, max: 3 },
                rejoin: { windowMs: 60000, max: 3 },
                teams: { windowMs: 60000, max: 3 },
                upload: { windowMs: 60000, max: 3 }
            }
        }
    });
    try {
        const client = limited.client();
        const attempts = [];
        for (let i = 0; i < 5; i += 1) {
            attempts.push((await client.post('/api/login', { username: 'nobody', password: 'x' })).status);
        }
        assert.deepEqual(attempts, [401, 401, 401, 429, 429]);
        const joins = [];
        for (let i = 0; i < 4; i += 1) joins.push((await client.post('/api/join', { code: 'ABCDEF' })).status);
        assert.deepEqual(joins, [404, 404, 404, 429]);
    } finally {
        await limited.stop();
    }
});

test('Login-Codes erscheinen im Betrieb nie im Log', async () => {
    const lines = [];
    const capture = (message, detail) => lines.push(`${message} ${detail ?? ''}`);
    const logger = { error: capture, warn: capture, info: capture, debug: capture };
    const prod = await createHarness({
        logger,
        env: { NODE_ENV: 'production', SESSION_SECRET: 'a-very-long-secret-value-0123456789-abcdefgh', ALLOW_REGISTRATION: 'true', COOKIE_SECURE: 'false', TRUST_PROXY: 'false', BCRYPT_ROUNDS: '4', SESSION_RETENTION_DAYS: '0' },
        mailer: { enabled: false, sendLoginCode: async () => { throw new Error('kein SMTP'); } }
    });
    try {
        const email = `${unique('prod')}@example.org`;
        assert.equal((await prod.client().post('/api/register', { email })).status, 200);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(!lines.some((line) => line.includes('Login-Code für')), lines.join('\n'));
        // Ohne zustellbaren Code wird das Konto wieder entfernt, ein neuer Versuch bleibt moeglich.
        const row = await prod.db.get('SELECT id FROM teachers WHERE username = ?', [email]);
        assert.equal(row, undefined);
    } finally {
        await prod.stop();
    }
});
