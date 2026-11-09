'use strict';

/** Express 4 faengt abgelehnte Promises nicht ab; das uebernimmt dieser Wrapper. */
const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
