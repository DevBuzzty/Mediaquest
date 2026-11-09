'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function describe(err) {
    if (err instanceof Error) return err.stack || err.message;
    return err;
}

/** Kleiner Konsolen-Logger; level 'silent' schaltet ihn ab. */
function createLogger(level = 'info') {
    const threshold = level === 'silent' ? -1 : (LEVELS[level] ?? LEVELS.info);
    const write = (name, method) => (message, detail) => {
        if (LEVELS[name] > threshold) return;
        const line = `${new Date().toISOString()} [${name}] ${message}`;
        if (detail === undefined) console[method](line);
        else console[method](line, describe(detail));
    };
    return {
        error: write('error', 'error'),
        warn: write('warn', 'warn'),
        info: write('info', 'log'),
        debug: write('debug', 'log')
    };
}

module.exports = { createLogger };
