'use strict';

const { rateLimit } = require('express-rate-limit');

const MESSAGE = { error: 'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.' };

function createRateLimiters(limits) {
    const build = (name, extra = {}) => rateLimit({
        windowMs: limits[name].windowMs,
        limit: limits[name].max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: MESSAGE,
        ...extra
    });
    return {
        login: build('login', { skipSuccessfulRequests: true }),
        register: build('register'),
        join: build('join'),
        rejoin: build('rejoin'),
        teams: build('teams'),
        upload: build('upload')
    };
}

module.exports = { createRateLimiters };
