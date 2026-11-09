'use strict';

const { unauthorized } = require('../lib/errors');

function requireTeacher(req, res, next) {
    if (req.session && req.session.teacherId) return next();
    return next(unauthorized());
}

module.exports = { requireTeacher };
