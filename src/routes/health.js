'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');

function createHealthRouter({ db, logger }) {
    const router = express.Router();
    router.get('/healthz', asyncHandler(async (req, res) => {
        try {
            await db.get('SELECT 1');
            res.json({ status: 'ok' });
        } catch (err) {
            logger.error('Healthcheck fehlgeschlagen', err);
            res.status(503).json({ status: 'error' });
        }
    }));
    return router;
}

module.exports = { createHealthRouter };
