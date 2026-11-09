'use strict';

const crypto = require('crypto');
const { isUniqueViolation } = require('../db');

// Ohne leicht verwechselbare Zeichen (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const LOGIN_CODE_LENGTH = 10;
const MAX_ATTEMPTS = 8;

function randomCode(length = CODE_LENGTH) {
    let code = '';
    for (let i = 0; i < length; i += 1) {
        code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    return code;
}

const randomLoginCode = () => randomCode(LOGIN_CODE_LENGTH);

/**
 * Ruft attempt(code) mit neuen Codes auf, solange die UNIQUE-Spalte kollidiert.
 */
async function withUniqueCode(attempt, column) {
    let lastError;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        try {
            return await attempt(randomCode());
        } catch (err) {
            if (!isUniqueViolation(err, column)) throw err;
            lastError = err;
        }
    }
    throw lastError;
}

module.exports = { randomCode, randomLoginCode, withUniqueCode };
