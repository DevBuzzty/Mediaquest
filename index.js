'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { loadConfig, ConfigError } = require('./src/config');
const { createApp } = require('./src/app');
const { createLogger } = require('./src/lib/logger');

const SHUTDOWN_TIMEOUT_MS = 10000;

function main() {
    let config;
    try {
        config = loadConfig();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        console.error(`Konfigurationsfehler: ${err.message}`);
        process.exit(1);
    }

    const logger = createLogger(config.logLevel);
    const { server, ready, close } = createApp({ config, logger });

    let shuttingDown = false;
    async function shutdown(reason, exitCode) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`Beende Server (${reason})`);
        // Nur Notbremse: normal endet der Prozess von selbst, sobald alles geschlossen ist.
        setTimeout(() => process.exit(exitCode || 1), SHUTDOWN_TIMEOUT_MS).unref();
        process.exitCode = exitCode;
        try {
            await close();
        } catch (err) {
            logger.error('Fehler beim Beenden', err);
            process.exitCode = 1;
        }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM', 0));
    process.on('SIGINT', () => shutdown('SIGINT', 0));
    process.on('unhandledRejection', (reason) => logger.error('Unbehandelte Promise-Ablehnung', reason));
    process.on('uncaughtException', (err) => {
        logger.error('Unbehandelte Ausnahme', err);
        shutdown('uncaughtException', 1);
    });

    ready.then(
        () => server.listen(config.port, config.host, () => logger.info(`Server läuft auf Port ${config.port}`)),
        () => shutdown('Start fehlgeschlagen', 1)
    );
}

main();
