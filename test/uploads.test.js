'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHarness, PNG, JPEG, WEBP, expectAlive } = require('./helpers');

const tail = (buffer) => Buffer.concat([buffer, Buffer.alloc(32, 5)]);
const AUDIO = {
    mp3Id3: [tail(Buffer.from('ID3\x04\x00\x00\x00', 'latin1')), 'mp3', 'audio/mpeg'],
    mp3Frame: [tail(Buffer.from([0xff, 0xfb, 0x90, 0x64])), 'mp3', 'audio/mpeg'],
    m4a: [tail(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')])), 'm4a', 'audio/mp4'],
    ogg: [tail(Buffer.from('OggS')), 'ogg', 'audio/ogg'],
    wav: [tail(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])), 'wav', 'audio/wav']
};

let h;
before(async () => { h = await createHarness(); });
after(async () => { await h.stop(); });

test('nicht angemeldet: kein Upload', async () => {
    assert.equal((await h.client().upload('/api/upload', PNG)).status, 401);
});

test('Bilder werden an den Bytes erkannt, nicht am Namen', async () => {
    const teacher = await h.teacher();
    for (const [buffer, ext] of [[PNG, 'png'], [JPEG, 'jpg'], [WEBP, 'webp']]) {
        const response = await teacher.upload('/api/upload', buffer, 'beliebig.exe', 'text/html');
        assert.equal(response.status, 201);
        assert.match(response.body.url, new RegExp(`^/uploads/[a-f0-9]{32}\\.${ext}$`));
    }
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    for (const [buffer, name, mime] of [
        [html, 'bild.png', 'image/png'],
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'bild.svg', 'image/svg+xml'],
        [Buffer.from('GIF89a..........'), 'bild.gif', 'image/gif'],
        [Buffer.alloc(0), 'leer.png', 'image/png']
    ]) {
        assert.equal((await teacher.upload('/api/upload', buffer, name, mime)).status, 400, name);
    }
    await expectAlive(h, assert);
});

test('Dateien größer als 5 MB werden abgelehnt', async () => {
    const teacher = await h.teacher();
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const response = await teacher.upload('/api/upload', big);
    assert.equal(response.status, 413);
    assert.equal((await teacher.upload('/api/upload', PNG, 'x.png', 'image/png', 'falschesFeld')).status, 400);
});

test('Uploads liegen außerhalb von public/ mit zufälligem Namen', async () => {
    const teacher = await h.teacher();
    const { body } = await teacher.upload('/api/upload', PNG, '../../boese.png');
    const name = path.basename(body.url);
    assert.ok(fs.existsSync(path.join(h.dataDir, 'uploads', name)));
    assert.ok(!fs.existsSync(path.join(h.config.publicDir, 'uploads', name)));
    assert.match(name, /^[a-f0-9]{32}\.png$/);
});

test('Lehrkraft-Bilder: sichtbar für Lehrkräfte und jedes Team, sonst nicht', async () => {
    const owner = await h.openSession();
    const otherTeacher = await h.teacher();
    const team = await h.team(owner.code);
    const { body } = await owner.teacher.upload('/api/upload', PNG);

    const seen = await owner.teacher.request('GET', body.url);
    assert.equal(seen.status, 200);
    assert.equal(seen.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(seen.headers.get('content-type'), 'image/png');
    assert.equal((await otherTeacher.get(body.url)).status, 200);
    assert.equal((await team.get(body.url)).status, 200);
    assert.equal((await h.client().get(body.url)).status, 403);
});

test('Team-Fotos: nur Lehrkraft der Session und Teams dieser Session', async () => {
    const owner = await h.openSession();
    const other = await h.openSession();
    const team = await h.team(owner.code);
    const sameSession = await h.team(owner.code, { color: '#ef4444' });
    const foreignTeam = await h.team(other.code);

    const { status, body } = await team.upload('/api/upload', PNG);
    assert.equal(status, 201);

    assert.equal((await team.get(body.url)).status, 200);
    assert.equal((await sameSession.get(body.url)).status, 200);
    assert.equal((await owner.teacher.get(body.url)).status, 200);
    assert.equal((await foreignTeam.get(body.url)).status, 403);
    assert.equal((await other.teacher.get(body.url)).status, 403);
    assert.equal((await h.client().get(body.url)).status, 403);
});

test('Lehrkraft kann nicht als Team hochladen, Unbekanntes wird nicht ausgeliefert', async () => {
    const teacher = await h.teacher();
    assert.equal((await teacher.upload('/api/upload?purpose=submission', PNG)).status, 401);
    assert.equal((await teacher.upload('/api/upload?purpose=quatsch', PNG)).status, 400);
    assert.equal((await teacher.get(`/uploads/${'b'.repeat(32)}.png`)).status, 404);
    assert.equal((await teacher.get('/uploads/..%2f..%2fdatabase.sqlite')).status, 404);
    assert.equal((await teacher.get('/uploads/.gitkeep')).status, 404);
});

test('Geschlossene Session: Team kann nicht mehr hochladen', async () => {
    const { teacher, code } = await h.openSession();
    const team = await h.team(code);
    await teacher.post('/api/sessions/close');
    assert.equal((await team.upload('/api/upload', PNG)).status, 401);
});

test('Anzahl der Uploads je Team ist begrenzt', async () => {
    const limited = await createHarness({ overrides: { maxUploadsPerTeam: 2 } });
    try {
        const { code } = await limited.openSession();
        const team = await limited.team(code);
        assert.equal((await team.upload('/api/upload', PNG)).status, 201);
        assert.equal((await team.upload('/api/upload', PNG)).status, 201);
        assert.equal((await team.upload('/api/upload', PNG)).status, 409);
    } finally {
        await limited.stop();
    }
});

test('Audio: Lehrkraft lädt hoch, erkannt an den Bytes', async () => {
    const teacher = await h.teacher();
    for (const [name, [buffer, ext, mime]] of Object.entries(AUDIO)) {
        const response = await teacher.upload('/api/upload/audio', buffer, 'datei.exe', 'text/html', 'audio');
        assert.equal(response.status, 201, name);
        assert.match(response.body.url, new RegExp(`^/uploads/[a-f0-9]{32}\\.${ext}$`));
        const fetched = await teacher.get(response.body.url);
        assert.equal(fetched.status, 200, name);
        assert.equal(fetched.headers.get('content-type'), mime);
        assert.equal(fetched.headers.get('x-content-type-options'), 'nosniff');
    }
    for (const [name, buffer] of [
        ['png', PNG],
        ['jpeg', JPEG],
        ['webp', WEBP],
        ['html', Buffer.from('<html><script>alert(1)</script></html>')],
        ['leer', Buffer.alloc(0)],
        ['kurz', Buffer.from('ID3')],
        ['video', tail(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  ')]))]
    ]) {
        const response = await teacher.upload('/api/upload/audio', buffer, 'datei.mp3', 'audio/mpeg', 'audio');
        assert.equal(response.status, 400, name);
    }
    assert.equal((await teacher.upload('/api/upload/audio', AUDIO.ogg[0], 'x.ogg', 'audio/ogg', 'image')).status, 400);
    await expectAlive(h, assert);
});

test('Audio: höchstens 15 MB', async () => {
    const teacher = await h.teacher();
    const atLimit = Buffer.concat([AUDIO.wav[0].subarray(0, 12), Buffer.alloc(15 * 1024 * 1024 - 12)]);
    assert.equal((await teacher.upload('/api/upload/audio', atLimit, 'a.wav', 'audio/wav', 'audio')).status, 201);
    const tooBig = await teacher.upload('/api/upload/audio', Buffer.concat([atLimit, Buffer.alloc(1)]), 'a.wav', 'audio/wav', 'audio');
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.body.error, /15 MB/);
});

test('Audio: nur Lehrkräfte laden hoch; ausgeliefert wie Spielrunden-Bilder', async () => {
    const owner = await h.openSession();
    const team = await h.team(owner.code);
    assert.equal((await h.client().upload('/api/upload/audio', AUDIO.ogg[0], 'x.ogg', 'audio/ogg', 'audio')).status, 401);
    assert.equal((await team.upload('/api/upload/audio', AUDIO.ogg[0], 'x.ogg', 'audio/ogg', 'audio')).status, 401);

    const { body } = await owner.teacher.upload('/api/upload/audio', AUDIO.ogg[0], 'x.ogg', 'audio/ogg', 'audio');
    assert.equal((await owner.teacher.get(body.url)).status, 200);
    assert.equal((await team.get(body.url)).status, 200);
    assert.equal((await h.client().get(body.url)).status, 403);
});

test('Audio: Aufgaben dürfen nur eigene Audio-Dateien nennen, CSP lässt nur die eigene Origin zu', async () => {
    const teacher = await h.teacher();
    const { body } = await teacher.upload('/api/upload/audio', AUDIO.mp3Id3[0], 'x.mp3', 'audio/mpeg', 'audio');
    const saved = await h.createBlueprint(teacher, { templateType: 'normal', tasks: [{ type: 'statement', question: 'Mit Ton', audio: body.url }] });
    assert.equal(saved.content.tasks[0].audio, body.url);
    const refused = await teacher.post('/api/blueprints', { title: 'x', content: { templateType: 'normal', tasks: [{ type: 'statement', audio: 'https://boese/x.mp3' }] } });
    assert.equal(refused.status, 400);
    const csp = (await teacher.get('/api/me')).headers.get('content-security-policy');
    assert.match(csp, /media-src 'self'(;|$)/);
});
