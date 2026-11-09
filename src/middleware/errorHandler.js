'use strict';

const multer = require('multer');
const { ApiError } = require('../lib/errors');

const BODY_PARSER_ERRORS = {
    'entity.parse.failed': [400, 'Ungültige Anfrage.'],
    'entity.too.large': [413, 'Die Anfrage ist zu groß.'],
    'encoding.unsupported': [415, 'Ungültige Anfrage.'],
    'charset.unsupported': [415, 'Ungültige Anfrage.'],
    'request.aborted': [400, 'Ungültige Anfrage.']
};

function multerStatus(err) {
    if (err.code === 'LIMIT_FILE_SIZE') return [413, 'Die Datei ist zu groß (höchstens 5 MB).'];
    return [400, 'Der Upload ist ungültig.'];
}

/** Antwortet immer mit JSON und nie mit einem Stacktrace. */
function createErrorHandler(logger) {
    return function errorHandler(err, req, res, next) {
        if (res.headersSent) return next(err);
        if (err instanceof ApiError) {
            const body = { error: err.message };
            if (err.code) body.code = err.code;
            if (err.details) body.details = err.details;
            return res.status(err.status).json(body);
        }
        if (err instanceof multer.MulterError) {
            const [status, message] = multerStatus(err);
            return res.status(status).json({ error: message });
        }
        const known = err && BODY_PARSER_ERRORS[err.type];
        if (known) return res.status(known[0]).json({ error: known[1] });
        // Fehler des Clients aus Express und seinen Parsern (kaputte URL, kaputtes gzip):
        // kein Eintrag im Fehlerlog, den ein anonymer Client fluten koennte.
        const status = err && (err.status || err.statusCode);
        if (Number.isInteger(status) && status >= 400 && status < 500) {
            return res.status(status).json({ error: 'Ungültige Anfrage.' });
        }
        logger.error(`Fehler bei ${req.method} ${req.path}`, err);
        return res.status(500).json({ error: 'Interner Serverfehler' });
    };
}

function apiNotFound(req, res) {
    res.status(404).json({ error: 'Nicht gefunden' });
}

module.exports = { createErrorHandler, apiNotFound };
