'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { io: connectSocket } = require('socket.io-client');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/lib/logger');

const TIMEOUT_MS = 3000;
const PASSWORD = 'passwort123';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 3), Buffer.from('WEBP'), Buffer.alloc(32, 3)]);

const SCROLLER_POSTS = Array.from({ length: 10 }, (_, i) => ({ user: `U${i}`, text: `Post ${i}`, isBad: i % 2 === 0 }));

const NORMAL_CONTENT = {
    templateType: 'normal',
    tasks: [
        { type: 'choice', question: 'Frage A', options: ['Eins', 'Zwei'] },
        { type: 'statement', question: 'Dein Tipp?' },
        { type: 'photo', question: 'Foto bitte' }
    ]
};

const QR_CONTENT = {
    templateType: 'qr',
    tasks: [
        { type: 'choice', question: 'Station A', code: 'AAA111', options: ['Eins', 'Zwei'] },
        { type: 'statement', question: 'Station B', code: 'BBB222' }
    ]
};

let counter = 0;
const unique = (prefix) => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

/** Haelt die Cookie-Identitaet eines Browsers und spricht HTTP und Socket.io. */
class Client {
    constructor(base) {
        this.base = base;
        this.cookie = '';
        this.sockets = [];
    }

    capture(response) {
        const cookies = response.headers.getSetCookie();
        for (const cookie of cookies) {
            const pair = cookie.split(';')[0];
            if (pair.startsWith('wr.sid=')) this.cookie = cookie.includes('Expires=Thu, 01 Jan 1970') ? '' : pair;
        }
    }

    async request(method, url, body, headers = {}) {
        const init = { method, headers: { ...headers } };
        if (this.cookie) init.headers.cookie = this.cookie;
        if (body !== undefined) {
            if (body instanceof FormData) {
                init.body = body;
            } else {
                init.body = typeof body === 'string' ? body : JSON.stringify(body);
                init.headers['content-type'] = 'application/json';
            }
        }
        const response = await fetch(this.base + url, init);
        this.capture(response);
        const text = await response.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
        return { status: response.status, body: json, text, headers: response.headers };
    }

    get(url) { return this.request('GET', url); }
    post(url, body) { return this.request('POST', url, body); }
    patch(url, body) { return this.request('PATCH', url, body); }
    delete(url) { return this.request('DELETE', url); }

    upload(url, buffer, filename = 'bild.png', mime = 'image/png', field = 'image') {
        const form = new FormData();
        form.append(field, new Blob([buffer], { type: mime }), filename);
        return this.request('POST', url, form);
    }

    socket() {
        return new Promise((resolve, reject) => {
            const socket = connectSocket(this.base, {
                transports: ['websocket'],
                forceNew: true,
                reconnection: false,
                extraHeaders: this.cookie ? { cookie: this.cookie } : {}
            });
            this.sockets.push(socket);
            socket.once('connect', () => resolve(socket));
            socket.once('connect_error', reject);
        });
    }

    closeSockets() {
        this.sockets.forEach((socket) => socket.disconnect());
        this.sockets = [];
    }
}

/** Ack-Aufruf mit Timeout; bei fehlendem payload wird auch keiner gesendet. */
function emit(socket, event, ...payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Kein Ack für ${event}`)), TIMEOUT_MS);
        socket.emit(event, ...payload, (ack) => {
            clearTimeout(timer);
            resolve(ack);
        });
    });
}

function nextEvent(socket, event, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Ereignis ${event} kam nicht`));
        }, timeout);
        function handler(payload) {
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        }
        socket.on(event, handler);
    });
}

/** Sammelt Ereignisse fuer spaetere "kam nicht an"-Pruefungen. */
function collect(socket, events) {
    const seen = [];
    events.forEach((event) => socket.on(event, (payload) => seen.push({ event, payload })));
    return seen;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createHarness({ env = {}, overrides = {}, logger, mailer } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-test-'));
    const config = loadConfig({ NODE_ENV: 'test', SEED_DEMO: 'false', DATA_DIR: dataDir, ...env }, overrides);
    const instance = createApp({ config, logger: logger || createLogger('silent'), mailer });
    await instance.ready;
    await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const clients = [];

    const harness = {
        ...instance,
        base,
        dataDir,
        client() {
            const client = new Client(base);
            clients.push(client);
            return client;
        },
        async createTeacherRow(username = unique('lehrer')) {
            const hash = await bcrypt.hash(PASSWORD, config.bcryptRounds);
            const result = await instance.db.run('INSERT INTO teachers (username, password, created_at) VALUES (?, ?, ?)', [username, hash, new Date().toISOString()]);
            return { id: result.lastID, username };
        },
        async teacher() {
            const row = await harness.createTeacherRow();
            const client = harness.client();
            const login = await client.post('/api/login', { username: row.username, password: PASSWORD });
            if (login.status !== 200) throw new Error('Login im Test fehlgeschlagen');
            client.teacherId = row.id;
            client.username = row.username;
            return client;
        },
        async createBlueprint(teacher, content = NORMAL_CONTENT, title = 'Testrunde') {
            const created = await teacher.post('/api/blueprints', { title, content });
            if (created.status !== 201) throw new Error(`Spielrunde abgelehnt: ${created.text}`);
            return created.body.blueprint;
        },
        /** Lehrkraft mit Spielrunde und offener Session. */
        async openSession({ content = NORMAL_CONTENT, maxTeams = 5 } = {}) {
            const teacher = await harness.teacher();
            const blueprint = await harness.createBlueprint(teacher, content);
            const created = await teacher.post('/api/sessions', { blueprintId: blueprint.id, maxTeams });
            if (created.status !== 201) throw new Error(`Session abgelehnt: ${created.text}`);
            return { teacher, blueprint, code: created.body.code, sessionId: created.body.sessionId };
        },
        /** Client, der mit dem Session-Code beigetreten ist und ein Team gegruendet hat. */
        async team(code, { name = unique('Team'), color = '#3b82f6', groupSize = 3 } = {}) {
            const client = harness.client();
            const joined = await client.post('/api/join', { code });
            if (joined.status !== 200) throw new Error(`Join abgelehnt: ${joined.text}`);
            const created = await client.post('/api/teams', { name, color, groupSize });
            if (created.status !== 201) throw new Error(`Team abgelehnt: ${created.text}`);
            client.state = created.body;
            return client;
        },
        async teamSocket(team, sessionId) {
            const socket = await team.socket();
            const ack = await emit(socket, 'joinSessionRoom', { sessionId });
            if (!ack.ok) throw new Error(`joinSessionRoom abgelehnt: ${ack.error}`);
            return socket;
        },
        async stop() {
            clients.forEach((client) => client.closeSockets());
            await instance.close();
            fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    };
    return harness;
}

/** Laeuft der Prozess noch? Antwort auf /healthz. */
async function expectAlive(harness, assert) {
    const health = await fetch(`${harness.base}/healthz`);
    assert.equal(health.status, 200);
}

module.exports = {
    createHarness, emit, nextEvent, collect, sleep, expectAlive, unique,
    PASSWORD, PNG, JPEG, WEBP, NORMAL_CONTENT, QR_CONTENT, SCROLLER_POSTS
};
