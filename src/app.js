'use strict';

const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createLogger } = require('./lib/logger');
const { createMailer } = require('./lib/mailer');
const { collectOrphanUploads, purgeExpiredSessions } = require('./lib/sessions');
const { createErrorHandler, apiNotFound } = require('./middleware/errorHandler');
const { createHelmet } = require('./middleware/security');
const { createRateLimiters } = require('./middleware/rateLimits');
const { SqliteSessionStore } = require('./middleware/sessionStore');
const { createAuthRouter } = require('./routes/auth');
const { createBlueprintsRouter } = require('./routes/blueprints');
const { createHealthRouter } = require('./routes/health');
const { createSessionsRouter } = require('./routes/sessions');
const { createTeamsRouter } = require('./routes/teams');
const { createUploadRouters } = require('./routes/uploads');
const { ensureDemoAccounts } = require('./seed');
const { createNotifier } = require('./sockets/notifier');
const { registerSockets } = require('./sockets');

const SESSION_COOKIE = 'wr.sid';
const JSON_BODY_LIMIT = '1mb';
const RETENTION_INTERVAL_MS = 60 * 60000;
const CLOSE_GRACE_MS = 2000;

/**
 * Baut die Anwendung, ohne zu lauschen.
 *
 * Gibt synchron zurueck; Requests warten intern, bis ready erfuellt ist
 * (Migrationen und Demo-Daten).
 *
 * @param {{config?: object, db?: object, logger?: object, mailer?: object}} [options]
 * @returns {{app, server, io, ready: Promise<void>, close: () => Promise<void>, db, config, logger}}
 */
function createApp({ config: givenConfig, db: givenDb, logger: givenLogger, mailer: givenMailer } = {}) {
    const config = givenConfig || loadConfig();
    const logger = givenLogger || createLogger(config.logLevel);
    const db = givenDb || openDatabase(config.dbPath);
    const ownsDb = !givenDb;
    const mailer = givenMailer || createMailer(config.smtp);

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { maxHttpBufferSize: config.socketMaxMessageBytes });
    app.set('trust proxy', config.trustProxy);

    const store = new SqliteSessionStore({ db, defaultMaxAgeMs: config.sessionMaxAgeMs, logger });
    const sessionMiddleware = session({
        name: SESSION_COOKIE,
        secret: config.sessionSecret,
        store,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.secureCookies,
            maxAge: config.sessionMaxAgeMs
        }
    });

    const notifier = createNotifier(io);
    store.on('expired', (sids) => sids.forEach((sid) => notifier.disconnectHttpSession(sid)));
    const ctx = {
        config,
        db,
        io,
        logger,
        mailer,
        store,
        notifier,
        limiters: createRateLimiters(config.rateLimits),
        sessionCookieName: SESSION_COOKIE
    };

    const ready = (async () => {
        await db.ready;
        if (config.seedDemo) await ensureDemoAccounts(db, config, logger);
        await purgeExpiredSessions(ctx);
        await collectOrphanUploads(ctx);
    })();
    ready.catch((err) => logger.error('Start der Anwendung fehlgeschlagen', err));

    const retentionTimer = setInterval(() => {
        purgeExpiredSessions(ctx).catch((err) => logger.error('Aufbewahrungsfrist: Löschen fehlgeschlagen', err));
        collectOrphanUploads(ctx).catch((err) => logger.error('Verwaiste Bilder konnten nicht gelöscht werden', err));
    }, RETENTION_INTERVAL_MS);
    retentionTimer.unref();

    if (config.isProduction && !mailer.enabled && config.allowRegistration) {
        logger.warn('ALLOW_REGISTRATION ist aktiv, aber SMTP fehlt: Neue Registrierungen können keinen Code erhalten.');
    }

    // --- HTTP -------------------------------------------------------------------
    app.use((req, res, next) => {
        ready.then(() => next(), next);
    });
    app.use(createHelmet(config));
    app.use(createHealthRouter(ctx));

    // Statische Dateien brauchen keine Session und erzeugen so keine Store-Zugriffe.
    const uploads = createUploadRouters(ctx);
    app.use('/uploads', sessionMiddleware, uploads.files);
    // Ohne Registrierung koennte das Formular nur mit einem 403 enden.
    if (!config.allowRegistration) app.get('/register.html', (req, res) => res.redirect('/login.html'));
    app.use(express.static(config.publicDir, { dotfiles: 'ignore' }));

    const api = express.Router();
    api.use(sessionMiddleware);
    api.use(express.json({ limit: JSON_BODY_LIMIT }));
    api.use(createAuthRouter(ctx));
    api.use('/blueprints', createBlueprintsRouter(ctx));
    api.use('/sessions', createSessionsRouter(ctx));
    api.use(createTeamsRouter(ctx));
    api.use(uploads.api);
    api.use(apiNotFound);
    app.use('/api', api);

    app.use((req, res) => {
        res.status(404).type('text/plain').send('Nicht gefunden');
    });
    app.use(createErrorHandler(logger));

    // --- Socket.io --------------------------------------------------------------
    // Nur beim Handshake: Folge-Polls brauchen die Session nicht erneut.
    io.engine.use((req, res, next) => {
        if (req._query && req._query.sid !== undefined) return next();
        return sessionMiddleware(req, res, next);
    });
    io.use((socket, next) => {
        ready.then(() => next(), () => next(new Error('Server nicht bereit')));
    });
    registerSockets(ctx);

    let closing = null;
    function close() {
        if (closing) return closing;
        closing = (async () => {
            clearInterval(retentionTimer);
            store.stop();
            await new Promise((resolve) => {
                const force = setTimeout(() => server.closeAllConnections(), CLOSE_GRACE_MS);
                io.close(() => {
                    clearTimeout(force);
                    resolve();
                });
                server.closeIdleConnections();
            });
            await ready.catch(() => {});
            if (ownsDb) await db.close();
        })();
        return closing;
    }

    return { app, server, io, ready, close, db, config, logger, store };
}

module.exports = { createApp };
