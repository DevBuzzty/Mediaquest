'use strict';

const { z } = require('zod');
const { badRequest } = require('./errors');
const { stripInvisible } = require('./filter');

const TEAM_COLORS = [
    '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316',
    '#a855f7', '#ec4899', '#6366f1', '#8b5cf6', '#14b8a6'
];

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const MIN_NEW_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72;
const MAX_JSON_DEPTH = 32;

/** Iterativ, weil JSON.stringify bei extrem tiefer Verschachtelung den Stack sprengt. */
function isWithinDepth(value) {
    if (value === null || typeof value !== 'object') return true;
    const stack = [[value, 1]];
    while (stack.length > 0) {
        const [node, depth] = stack.pop();
        if (depth > MAX_JSON_DEPTH) return false;
        for (const child of Object.values(node)) {
            if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
        }
    }
    return true;
}

const text = (message, min, max) => z.string({ error: message }).trim()
    .min(min, { error: message })
    .max(max, { error: message });

const code = (message) => z.string({ error: message }).trim().toUpperCase()
    .regex(/^[A-Z0-9]{4,12}$/, { error: message });

const newPassword = z.string({ error: 'Das neue Passwort ist ungültig.' })
    .min(MIN_NEW_PASSWORD, { error: `Das neue Passwort braucht mindestens ${MIN_NEW_PASSWORD} Zeichen.` })
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES, {
        error: `Das neue Passwort darf höchstens ${MAX_PASSWORD_BYTES} Bytes lang sein.`
    });

const maxTeams = z.number({ error: 'Das Team-Limit muss zwischen 1 und 10 liegen.' })
    .int({ error: 'Das Team-Limit muss zwischen 1 und 10 liegen.' })
    .min(1, { error: 'Das Team-Limit muss zwischen 1 und 10 liegen.' })
    .max(10, { error: 'Das Team-Limit muss zwischen 1 und 10 liegen.' });

const positiveId = (message) => z.number({ error: message }).int({ error: message }).positive({ error: message });

// Der Editor liefert IDs aus <select>-Werten teils als Text.
const looseId = (message) => z.union([
    positiveId(message),
    z.string().regex(/^[1-9]\d{0,14}$/, { error: message }).transform(Number)
], { error: message });

const WORLD_KEY_ERROR = 'Unbekannte Welt ausgewählt.';
const worldKey = z.string({ error: WORLD_KEY_ERROR }).max(32, { error: WORLD_KEY_ERROR });

const schemas = {
    idParam: z.object({
        id: z.string({ error: 'Ungültige ID.' }).regex(/^[1-9]\d{0,14}$/, { error: 'Ungültige ID.' }).transform(Number)
    }, { error: 'Ungültige ID.' }),

    register: z.object({
        email: z.email({ error: 'Ungültige E-Mail-Adresse' }).max(254, { error: 'Ungültige E-Mail-Adresse' }).toLowerCase()
    }, { error: 'Ungültige E-Mail-Adresse' }),
    login: z.object({
        username: text('Ungültige Anmeldedaten', 1, 254),
        password: z.string({ error: 'Ungültige Anmeldedaten' }).min(1, { error: 'Ungültige Anmeldedaten' }).max(200, { error: 'Ungültige Anmeldedaten' })
    }, { error: 'Ungültige Anmeldedaten' }),
    changePassword: z.object({
        currentPassword: z.string({ error: 'Das aktuelle Passwort fehlt.' }).min(1, { error: 'Das aktuelle Passwort fehlt.' }).max(200, { error: 'Das aktuelle Passwort ist falsch.' }),
        newPassword
    }, { error: 'Das aktuelle Passwort fehlt.' }),

    // Der Aufgaben-Inhalt wird danach von TaskTypes geprueft.
    blueprint: z.object({
        title: text('Bitte gib einen Namen für die Spielrunde ein (höchstens 120 Zeichen).', 1, 120),
        content: z.unknown().refine(isWithinDepth, { error: 'Die Spielrunde ist zu tief verschachtelt.' })
    }, { error: 'Bitte gib einen Namen für die Spielrunde ein (höchstens 120 Zeichen).' }),

    createSession: z.object({
        blueprintId: looseId('Bitte wähle eine Spielrunde aus.'),
        maxTeams: maxTeams.default(5)
    }, { error: 'Bitte wähle eine Spielrunde aus.' }),
    createBoardSession: z.object({
        gameMode: z.literal('board', { error: 'Ungültiger Spielmodus.' }),
        maxTeams: maxTeams.default(5),
        board: z.object({
            worldCount: z.number({ error: 'Bitte wähle 1 bis 5 Welten.' }).int({ error: 'Bitte wähle 1 bis 5 Welten.' })
                .min(1, { error: 'Bitte wähle 1 bis 5 Welten.' }).max(5, { error: 'Bitte wähle 1 bis 5 Welten.' }),
            portals: z.array(worldKey, { error: 'Bitte ordne die Welten den Portalen zu.' })
                .min(1, { error: 'Bitte ordne die Welten den Portalen zu.' }).max(5, { error: 'Bitte ordne die Welten den Portalen zu.' }),
            sets: z.record(z.string().max(32), looseId('Bitte wähle für jede Welt ein Kartenset aus.'), { error: 'Bitte wähle für jede Welt ein Kartenset aus.' })
        }, { error: 'Bitte richte das Brettspiel vollständig ein.' })
    }, { error: 'Bitte richte das Brettspiel vollständig ein.' }),
    teamLimit: z.object({ maxTeams }, { error: 'Das Team-Limit muss zwischen 1 und 10 liegen.' }),
    switchBlueprint: z.object({ blueprintId: looseId('Bitte wähle eine Spielrunde aus.') }, { error: 'Bitte wähle eine Spielrunde aus.' }),

    join: z.object({ code: code('Ungültiger Session-Code.') }, { error: 'Ungültiger Session-Code.' }),
    rejoin: z.object({ teamCode: code('Ungültiger Team-Code.') }, { error: 'Ungültiger Team-Code.' }),
    createTeam: z.object({
        // Unsichtbare Zeichen zuerst entfernen, sonst waere ein Name aus U+200B "nicht leer".
        name: z.string({ error: 'Bitte gib einen Teamnamen ein (höchstens 30 Zeichen).' })
            .transform(stripInvisible)
            .pipe(text('Bitte gib einen Teamnamen ein (höchstens 30 Zeichen).', 1, 30)
                .regex(NO_CONTROL_CHARS, { error: 'Der Teamname enthält ungültige Zeichen.' })
                .regex(/[\p{L}\p{N}]/u, { error: 'Der Teamname braucht mindestens einen Buchstaben oder eine Ziffer.' })),
        color: z.enum(TEAM_COLORS, { error: 'Bitte wähle eine gültige Farbe.' }),
        groupSize: z.number({ error: 'Die Teamgröße muss zwischen 1 und 10 liegen.' })
            .int({ error: 'Die Teamgröße muss zwischen 1 und 10 liegen.' })
            .min(1, { error: 'Die Teamgröße muss zwischen 1 und 10 liegen.' })
            .max(10, { error: 'Maximale Teamgröße ist 10 Personen.' })
            .default(1)
    }, { error: 'Bitte gib einen Teamnamen ein (höchstens 30 Zeichen).' }),

    uploadQuery: z.object({
        purpose: z.enum(['blueprint', 'submission'], { error: 'Ungültiger Upload-Zweck.' }).optional()
    }, { error: 'Ungültiger Upload-Zweck.' }),
    uploadFilename: z.object({
        filename: z.string({ error: 'Nicht gefunden' }).regex(/^[a-f0-9]{32}\.(?:jpg|png|webp|mp3|m4a|ogg|wav)$/, { error: 'Nicht gefunden' })
    }, { error: 'Nicht gefunden' })
};

const taskKey = z.string({ error: 'Ungültige Aufgabe.' }).regex(/^\d{1,9}-\d{1,4}$/, { error: 'Ungültige Aufgabe.' });

const socketSchemas = {
    none: z.unknown(),
    joinSessionRoom: z.object({
        sessionId: positiveId('Ungültige Session.'),
        as: z.enum(['teacher', 'team'], { error: 'Ungültige Rolle.' }).optional()
    }, { error: 'Ungültige Session.' }),
    taskStart: z.object({ taskKey }, { error: 'Ungültige Aufgabe.' }),
    taskResult: z.object({
        taskKey,
        status: z.enum(['completed', 'skipped'], { error: 'Ungültiger Status.' }),
        answer: z.unknown().optional().refine(isWithinDepth, { error: 'Die Antwort ist zu tief verschachtelt.' })
    }, { error: 'Ungültige Aufgabe.' }),
    openStation: z.object({
        code: z.string({ error: 'Ungültiger Code.' }).trim().min(1, { error: 'Ungültiger Code.' }).max(64, { error: 'Ungültiger Code.' })
    }, { error: 'Ungültiger Code.' }),
    submission: z.object({
        taskKey,
        type: z.enum(['photo', 'statement'], { error: 'Ungültige Einsendung.' }),
        content: z.string({ error: 'Die Einsendung ist leer.' }).trim()
            .min(1, { error: 'Die Einsendung ist leer.' })
            .max(2000, { error: 'Der Text ist zu lang (höchstens 2000 Zeichen).' })
    }, { error: 'Ungültige Einsendung.' }),
    showResults: z.object({ sessionId: positiveId('Ungültige Session.') }, { error: 'Ungültige Session.' }),
    confirmMonster: z.object({
        sessionId: positiveId('Ungültige Session.'),
        teamId: positiveId('Ungültiges Team.'),
        taskKey
    }, { error: 'Ungültige Aufgabe.' }),
    boardOpenCard: z.object({
        code: z.string({ error: 'Ungültiger Code.' }).trim().min(1, { error: 'Ungültiger Code.' }).max(64, { error: 'Ungültiger Code.' })
    }, { error: 'Ungültiger Code.' }),
    boardSubmitCard: z.object({
        taskKey,
        status: z.enum(['completed', 'skipped'], { error: 'Ungültiger Status.' }),
        answer: z.unknown().optional().refine(isWithinDepth, { error: 'Die Antwort ist zu tief verschachtelt.' })
    }, { error: 'Ungültige Karte.' }),
    boardAction: z.object({
        sessionId: positiveId('Ungültige Session.'),
        action: z.enum(['move', 'confirm', 'forceEvaluate'], { error: 'Unbekannte Aktion.' }),
        rev: z.number({ error: 'Ungültiger Spielstand.' }).int({ error: 'Ungültiger Spielstand.' }).nonnegative({ error: 'Ungültiger Spielstand.' })
    }, { error: 'Ungültige Aktion.' })
};

/** Prueft data gegen schema und wirft bei Fehlern einen 400 mit deutscher Meldung. */
function parse(schema, data) {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    const first = result.error.issues[0];
    throw badRequest(first && first.message ? first.message : 'Ungültige Eingabe.', { code: 'INVALID_INPUT' });
}

module.exports = { schemas, socketSchemas, parse, TEAM_COLORS };
