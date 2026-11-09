'use strict';

const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../middleware/asyncHandler');
const { schemas, parse } = require('../lib/schemas');
const { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } = require('../lib/errors');
const { detectAudioType, detectImageType, randomFilename, writeUpload } = require('../lib/uploads');
const { nowIso } = require('../lib/sessions');

function createUploadRouters(ctx) {
    const { config, db, limiters } = ctx;

    const multipart = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 }
    }).single('image');

    // busboy meldet kaputte Formulare und abgebrochene Uebertragungen als einfache Errors.
    const receiver = (req, res, next) => multipart(req, res, (err) => {
        if (err && !(err instanceof multer.MulterError)) return next(badRequest('Der Upload ist ungültig.', { code: 'INVALID_UPLOAD' }));
        return next(err);
    });

    const audioMultipart = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: config.maxAudioBytes, files: 1, fields: 5 }
    }).single('audio');

    const audioReceiver = (req, res, next) => audioMultipart(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'Die Audio-Datei ist zu groß (höchstens 15 MB).'));
        if (err && !(err instanceof multer.MulterError)) return next(badRequest('Der Upload ist ungültig.', { code: 'INVALID_UPLOAD' }));
        return next(err);
    });

    async function requireQuota(q, owner) {
        const isTeam = owner.kind === 'submission';
        const { count } = isTeam
            ? await q.get('SELECT COUNT(*) AS count FROM uploads WHERE team_id = ?', [owner.teamId])
            : await q.get("SELECT COUNT(*) AS count FROM uploads WHERE teacher_id = ? AND kind = 'blueprint'", [owner.teacherId]);
        if (count >= (isTeam ? config.maxUploadsPerTeam : config.maxUploadsPerTeacher)) {
            throw conflict(isTeam ? 'Euer Team hat zu viele Bilder hochgeladen.' : 'Du hast zu viele Bilder hochgeladen.', { code: 'UPLOAD_LIMIT' });
        }
    }

    /** Zaehlt und traegt in einer Transaktion ein, damit parallele Uploads das Limit nicht ueberschreiten. */
    function reserveUpload(owner, filename, type, size) {
        return db.transaction(async (tx) => {
            if (owner.teamId && !await tx.get('SELECT id FROM teams WHERE id = ?', [owner.teamId])) throw unauthorized();
            await requireQuota(tx, owner);
            await tx.run(
                `INSERT INTO uploads (filename, kind, mime, size, teacher_id, session_id, team_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [filename, owner.kind, type.mime, size, owner.teacherId, owner.sessionId, owner.teamId, nowIso()]
            );
        });
    }

    /** Bestimmt den Besitzer, bevor Bytes gelesen werden. */
    const resolveOwner = asyncHandler(async (req, res, next) => {
        const { purpose } = parse(schemas.uploadQuery, req.query);
        const { teacherId, teamId } = req.session;
        const wantsSubmission = purpose === 'submission' || (!purpose && !teacherId);

        if (!wantsSubmission) {
            if (!teacherId) throw unauthorized();
            req.uploadOwner = { kind: 'blueprint', teacherId, sessionId: null, teamId: null };
            await requireQuota(db, req.uploadOwner);
            return next();
        }
        if (!teamId) throw unauthorized();
        const team = await db.get(
            `SELECT t.id, t.session_id FROM teams t
             JOIN sessions s ON s.id = t.session_id
             WHERE t.id = ? AND s.status = 'active'`,
            [teamId]
        );
        if (!team) throw unauthorized();
        req.uploadOwner = { kind: 'submission', teacherId: null, sessionId: team.session_id, teamId: team.id };
        await requireQuota(db, req.uploadOwner); // Vorpruefung, bevor Bytes gelesen werden
        return next();
    });

    /** Audio laedt nur die Lehrkraft fuer ihre Aufgaben hoch; gespeichert und ausgeliefert wie Spielrunden-Bilder. */
    const resolveAudioOwner = asyncHandler(async (req, res, next) => {
        const { teacherId } = req.session;
        if (!teacherId) throw unauthorized();
        req.uploadOwner = { kind: 'blueprint', teacherId, sessionId: null, teamId: null };
        await requireQuota(db, req.uploadOwner);
        return next();
    });

    async function storeUpload(owner, type, file, res) {
        const filename = randomFilename(type.ext);
        await reserveUpload(owner, filename, type, file.size);
        try {
            await writeUpload(config.uploadsDir, filename, file.buffer);
        } catch (err) {
            await db.run('DELETE FROM uploads WHERE filename = ?', [filename]).catch(() => {});
            throw err;
        }
        res.status(201).json({ success: true, url: `/uploads/${filename}` });
    }

    const api = express.Router();
    api.post('/upload/audio', limiters.upload, resolveAudioOwner, audioReceiver, asyncHandler(async (req, res) => {
        if (!req.file) throw badRequest('Keine Datei hochgeladen');
        const type = detectAudioType(req.file.buffer);
        if (!type) throw badRequest('Nur MP3-, M4A-, OGG- oder WAV-Dateien sind erlaubt.', { code: 'INVALID_AUDIO' });
        await storeUpload(req.uploadOwner, type, req.file, res);
    }));
    api.post('/upload', limiters.upload, resolveOwner, receiver, asyncHandler(async (req, res) => {
        if (!req.file) throw badRequest('Keine Datei hochgeladen');
        const type = detectImageType(req.file.buffer);
        if (!type) throw badRequest('Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.', { code: 'INVALID_IMAGE' });
        await storeUpload(req.uploadOwner, type, req.file, res);
    }));

    async function isAuthorised(req, upload) {
        const { teacherId, teamId } = req.session;
        const team = teamId ? await db.get('SELECT id, session_id FROM teams WHERE id = ?', [teamId]) : null;
        if (upload.kind === 'blueprint') return Boolean(teacherId || team);
        if (team && team.session_id === upload.session_id) return true;
        if (!teacherId) return false;
        const owned = await db.get('SELECT id FROM sessions WHERE id = ? AND teacher_id = ?', [upload.session_id, teacherId]);
        return Boolean(owned);
    }

    // Eigener Pfad vor express.static: Fotos liegen in DATA_DIR/uploads und laufen immer durch diese Prüfung.
    const files = express.Router();
    files.get('/:filename', asyncHandler(async (req, res) => {
        const parsed = schemas.uploadFilename.safeParse(req.params);
        if (!parsed.success) throw notFound();
        const { filename } = parsed.data;
        const upload = await db.get('SELECT * FROM uploads WHERE filename = ?', [filename]);
        if (!upload) throw notFound();
        if (!await isAuthorised(req, upload)) throw forbidden();
        res.set({
            'Content-Type': upload.mime,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=3600'
        });
        // Mit root prueft send nur den Dateinamen, nicht die Ordner von DATA_DIR (z. B. ~/.local).
        res.sendFile(filename, { root: config.uploadsDir, dotfiles: 'deny' }, (err) => {
            if (err && !res.headersSent) res.status(404).json({ error: 'Nicht gefunden' });
        });
    }));
    files.use((req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

    return { api, files };
}

module.exports = { createUploadRouters };
