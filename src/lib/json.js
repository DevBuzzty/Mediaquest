'use strict';

function parseJson(text, fallback = null) {
    if (text === null || text === undefined) return fallback;
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

module.exports = { parseJson };
