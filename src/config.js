'use strict';

const crypto = require('crypto');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WEAK_SECRETS = new Set(['weltenretter-secret', 'changeme', 'change-me', 'secret', 'password']);
const MIN_SECRET_LENGTH = 32;

class ConfigError extends Error {}

function isTrue(value) {
    return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function isFalse(value) {
    return typeof value === 'string' && ['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function flag(value, fallback) {
    if (isTrue(value)) return true;
    if (isFalse(value)) return false;
    return fallback;
}

function toInt(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function isStrongSecret(secret) {
    return typeof secret === 'string'
        && secret.length >= MIN_SECRET_LENGTH
        && !WEAK_SECRETS.has(secret.toLowerCase())
        && new Set(secret).size >= 10;
}

// Im Betrieb Hop-Anzahl hinter dem Reverse-Proxy; 'true' waere fuer
// express-rate-limit zu freizuegig (faelschbares X-Forwarded-For).
function parseTrustProxy(value, isProduction) {
    if (value === undefined || value === '') return isProduction ? 1 : false;
    if (isFalse(value)) return false;
    if (isTrue(value)) return 1;
    const hops = Number.parseInt(value, 10);
    return Number.isNaN(hops) ? value : hops;
}

function resolveFromRoot(value, fallback) {
    if (!value) return fallback;
    return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

/**
 * Baut die Konfiguration aus Umgebungsvariablen. Alle Pfade sind absolut und
 * haengen nicht vom Arbeitsverzeichnis ab.
 * @param {object} env meist process.env
 * @param {object} overrides ersetzt einzelne Werte (z. B. rateLimits in Tests)
 */
function loadConfig(env = process.env, overrides = {}) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const isTest = nodeEnv === 'test';

    let sessionSecret = env.SESSION_SECRET;
    if (isProduction && !isStrongSecret(sessionSecret)) {
        throw new ConfigError(
            `SESSION_SECRET fehlt oder ist zu schwach: im Betrieb sind mindestens ${MIN_SECRET_LENGTH} zufällige Zeichen nötig.`
        );
    }
    if (!sessionSecret) {
        // Nur ausserhalb des Betriebs: stabil je Installation, damit Sessions
        // einen Neustart ueberleben, aber kein fester Wert im Quelltext.
        sessionSecret = crypto.createHash('sha256').update(`dev-session:${ROOT_DIR}`).digest('hex');
    }

    const dataDir = resolveFromRoot(env.DATA_DIR, path.join(ROOT_DIR, 'data'));

    const hugeLimit = { windowMs: 60000, max: 100000 };
    const rateLimits = isTest
        ? { login: hugeLimit, register: hugeLimit, join: hugeLimit, rejoin: hugeLimit, teams: hugeLimit, upload: hugeLimit }
        : {
            // Eine ganze Klasse teilt sich oft eine IP, daher grosszuegig bei
            // join/teams und streng bei den Passwort-Routen.
            login: { windowMs: 15 * 60000, max: 30 },
            register: { windowMs: 60 * 60000, max: 10 },
            join: { windowMs: 15 * 60000, max: 300 },
            rejoin: { windowMs: 15 * 60000, max: 100 },
            teams: { windowMs: 15 * 60000, max: 100 },
            upload: { windowMs: 15 * 60000, max: 300 }
        };

    return {
        nodeEnv,
        isProduction,
        isTest,
        rootDir: ROOT_DIR,
        publicDir: path.join(ROOT_DIR, 'public'),
        dataDir,
        dbPath: path.join(dataDir, 'database.sqlite'),
        uploadsDir: path.join(dataDir, 'uploads'),
        port: toInt(env.PORT, 3000),
        host: env.HOST || undefined,
        sessionSecret,
        sessionMaxAgeMs: toInt(env.SESSION_MAX_AGE_HOURS, 12) * 3600000,
        trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
        secureCookies: flag(env.COOKIE_SECURE, isProduction),
        allowRegistration: flag(env.ALLOW_REGISTRATION, !isProduction),
        seedDemo: flag(env.SEED_DEMO, !isProduction),
        bcryptRounds: toInt(env.BCRYPT_ROUNDS, isTest ? 4 : 12),
        logLevel: env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
        // 0 schaltet die automatische Loeschung abgeschlossener Sessions ab.
        retentionDays: toInt(env.SESSION_RETENTION_DAYS, isProduction ? 90 : 0),
        maxUploadBytes: 5 * 1024 * 1024,
        maxAudioBytes: 15 * 1024 * 1024,
        maxUploadsPerTeam: 50,
        maxUploadsPerTeacher: 300,
        socketMaxMessageBytes: 64 * 1024,
        socketEventWindowMs: 10000,
        socketEventMax: isTest ? 100000 : 200,
        smtp: {
            host: env.SMTP_HOST || null,
            port: toInt(env.SMTP_PORT, 587),
            secure: flag(env.SMTP_SECURE, false),
            user: env.SMTP_USER || null,
            pass: env.SMTP_PASS || null,
            from: env.SMTP_FROM || env.SMTP_USER || null
        },
        rateLimits,
        ...overrides
    };
}

module.exports = { loadConfig, ConfigError, isStrongSecret, ROOT_DIR };
