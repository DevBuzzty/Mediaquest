'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireTeacher } = require('../middleware/auth');
const { schemas, parse } = require('../lib/schemas');
const { notFound } = require('../lib/errors');
const { parseJson } = require('../lib/gameState');
const { nowIso, normalizeBlueprintContent } = require('../lib/sessions');

function serialize(row) {
    return {
        id: row.id,
        title: row.title,
        game_type: row.game_type,
        content: parseJson(row.content, { templateType: 'normal', tasks: [] }),
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function parseBody(body) {
    const { title, content } = parse(schemas.blueprint, body);
    return { title, content: JSON.stringify(normalizeBlueprintContent(content)) };
}

function createBlueprintsRouter({ db }) {
    const router = express.Router();
    router.use(requireTeacher);

    router.get('/', asyncHandler(async (req, res) => {
        const rows = await db.all('SELECT * FROM blueprints WHERE teacher_id = ? ORDER BY created_at DESC, id DESC', [req.session.teacherId]);
        res.json({ blueprints: rows.map(serialize) });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        const { title, content } = parseBody(req.body);
        const result = await db.run(
            "INSERT INTO blueprints (teacher_id, title, game_type, content, created_at) VALUES (?, ?, 'template', ?, ?)",
            [req.session.teacherId, title, content, nowIso()]
        );
        const row = await db.get('SELECT * FROM blueprints WHERE id = ?', [result.lastID]);
        res.status(201).json({ success: true, blueprint: serialize(row) });
    }));

    router.patch('/:id', asyncHandler(async (req, res) => {
        const { id } = parse(schemas.idParam, req.params);
        const { title, content } = parseBody(req.body);
        const result = await db.run(
            'UPDATE blueprints SET title = ?, content = ?, updated_at = ? WHERE id = ? AND teacher_id = ?',
            [title, content, nowIso(), id, req.session.teacherId]
        );
        if (result.changes === 0) throw notFound('Spielrunde nicht gefunden');
        const row = await db.get('SELECT * FROM blueprints WHERE id = ?', [id]);
        res.json({ success: true, blueprint: serialize(row) });
    }));

    router.delete('/:id', asyncHandler(async (req, res) => {
        const { id } = parse(schemas.idParam, req.params);
        const result = await db.run('DELETE FROM blueprints WHERE id = ? AND teacher_id = ?', [id, req.session.teacherId]);
        if (result.changes === 0) throw notFound('Spielrunde nicht gefunden');
        res.json({ success: true });
    }));

    return router;
}

module.exports = { createBlueprintsRouter };
