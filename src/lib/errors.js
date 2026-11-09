'use strict';

/** Fehler mit Status und deutscher Meldung, die der Client sehen darf. */
class ApiError extends Error {
    constructor(status, message, { code, details } = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const badRequest = (message, extra) => new ApiError(400, message, extra);
const unauthorized = (message = 'Nicht autorisiert') => new ApiError(401, message);
const forbidden = (message = 'Zugriff verweigert', extra) => new ApiError(403, message, extra);
const notFound = (message = 'Nicht gefunden', extra) => new ApiError(404, message, extra);
const conflict = (message, extra) => new ApiError(409, message, extra);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict };
