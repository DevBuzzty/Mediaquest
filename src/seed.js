'use strict';

const bcrypt = require('bcrypt');
const { WORLD_KARTENSETS } = require('./seedWorlds');

const EXAMPLE_BLUEPRINTS = [
    {
        title: 'Weltenretter Starter-Runde',
        templateType: 'normal',
        tasks: [
            { type: 'binary', question: 'Wurde dieses Foto manipuliert?', icon: '🖼️', description: 'Wische nach rechts für JA oder nach links für NEIN.' },
            {
                type: 'choice',
                question: 'Woran erkennst du eine seriöse Quelle?',
                options: ['A) Am Design', 'B) Am Impressum', 'C) An vielen Likes'],
                description: 'Wähle die richtige Antwort aus.'
            },
            {
                type: 'chat',
                partner: 'ZockerPro',
                description: 'Reagiere auf die Nachrichten des Chat-Partners.',
                nodes: {
                    start: { text: 'Gibst du mir dein Passwort für gratis Coins?', options: [{ label: 'Klar!', next: 'ende1' }, { label: 'Nein!', next: 'ende2' }] },
                    ende1: { text: 'Account gehackt!', options: [] },
                    ende2: { text: 'Sicher geblieben!', options: [] }
                }
            },
            {
                type: 'scroller',
                description: 'Tippe auf Beiträge, die problematisch sein könnten.',
                posts: [
                    { user: 'Bot1', text: 'Klick hier für Geld!', isBad: true },
                    { user: 'User1', text: 'Hund ist weggelaufen.', isBad: false },
                    { user: 'Bot2', text: 'Gratis Gummibärchenregen!', isBad: true },
                    { user: 'News', text: 'Wetter ist sonnig.', isBad: false },
                    { user: 'Hater', text: 'Du bist so dumm!', isBad: true },
                    { user: 'Friend', text: 'Lust auf Fußball?', isBad: false },
                    { user: 'Bot3', text: 'Deine IP wurde gefunden!', isBad: true },
                    { user: 'Cook', text: 'Neues Rezept online.', isBad: false },
                    { user: 'Scam', text: 'Gewinnspiel: iPhone!', isBad: true },
                    { user: 'Lokal', text: 'Feuerwehr im Einsatz.', isBad: false }
                ]
            },
            {
                type: 'bucket',
                description: 'Ordne die Begriffe dem richtigen Korb zu.',
                buckets: ['Privat', 'Öffentlich'],
                items: [
                    { text: 'Passwort', target: 0 },
                    { text: 'Vorname', target: 1 }
                ]
            }
        ]
    },
    {
        title: 'Social Media Führerschein',
        templateType: 'normal',
        tasks: [
            { type: 'mood', question: 'Wie fühlst du dich bei Hass-Kommentaren?', labelLeft: 'Schlecht', labelRight: 'Egal', description: 'Bewege den Regler auf die passende Position.' },
            { type: 'profile', fields: ['name', 'ort'], customFields: ['Hobby'], description: 'Fülle dein Profil aus, aber sei vorsichtig mit deinen Daten!' },
            { type: 'statement', question: 'Was ist dein Tipp gegen Cybermobbing?', description: 'Schreibe eine kurze Nachricht.' }
        ]
    },
    {
        title: 'QR-Stationenlernen: Sicherheit',
        templateType: 'qr',
        tasks: [
            { type: 'password', question: 'Station 1: Passwort-Tresor', code: '123456', rules: ['Mind. 8 Zeichen', 'Mindestens eine Zahl'], description: 'Erstelle ein sicheres Passwort, das alle Regeln erfüllt.' },
            { type: 'hotspot', question: 'Station 2: Phishing-Falle', code: '654321', description: 'Tippe auf alle Stellen im Bild, die dir verdächtig vorkommen.', image: '/img/beispiel-phishing.svg', zones: [{ x: 15, y: 19, w: 62, h: 9 }, { x: 11, y: 58, w: 40, h: 14 }] },
            { type: 'photo', question: 'Station 3: Beweisfoto', code: '998877', description: 'Mache ein Foto von deinem Team am Stationen-Tisch.' }
        ]
    }
];

/** Legt die Beispiel-Spielrunden an, die jede neue Lehrkraft bekommt. */
async function seedExampleBlueprints(q, teacherId) {
    const now = new Date().toISOString();
    for (const example of EXAMPLE_BLUEPRINTS) {
        await q.run(
            "INSERT INTO blueprints (teacher_id, title, game_type, content, created_at) VALUES (?, ?, 'template', ?, ?)",
            [teacherId, example.title, JSON.stringify({ tasks: example.tasks, templateType: example.templateType }), now]
        );
    }
    for (const set of WORLD_KARTENSETS) {
        await q.run(
            "INSERT INTO blueprints (teacher_id, title, game_type, content, created_at) VALUES (?, ?, 'template', ?, ?)",
            [teacherId, set.title, JSON.stringify({ templateType: 'world', world: set.world, tasks: set.tasks }), now]
        );
    }
}

/** Demo-Konten fuer die Entwicklung. Die Aufrufstelle entscheidet per config.seedDemo. */
async function ensureDemoAccounts(db, config, logger) {
    for (const username of ['test', 'admin']) {
        const existing = await db.get('SELECT id FROM teachers WHERE username = ?', [username]);
        if (existing) continue;
        const hash = await bcrypt.hash(username, config.bcryptRounds);
        await db.transaction(async (tx) => {
            const result = await tx.run('INSERT INTO teachers (username, password, created_at) VALUES (?, ?, ?)', [username, hash, new Date().toISOString()]);
            await seedExampleBlueprints(tx, result.lastID);
        });
        logger.info(`Demo-Konto ${username} angelegt.`);
    }
}

module.exports = { EXAMPLE_BLUEPRINTS, WORLD_KARTENSETS, seedExampleBlueprints, ensureDemoAccounts };
