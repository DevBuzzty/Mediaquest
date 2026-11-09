'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireTeacher } = require('../middleware/auth');
const { schemas, parse } = require('../lib/schemas');
const { ApiError, badRequest, forbidden, unauthorized } = require('../lib/errors');
const { randomLoginCode } = require('../lib/codes');
const { nowIso } = require('../lib/sessions');
const { seedExampleBlueprints } = require('../seed');

// Identische Antwort fuer neue und vorhandene Adressen.
const REGISTER_RESPONSE = {
    success: true,
    message: 'Falls diese Adresse noch nicht registriert ist, wurde ein Login-Code per E-Mail gesendet.'
};

const regenerate = (req) => new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
});

const destroy = (req) => new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
});

function createAuthRouter(ctx) {
    const { config, db, logger, mailer, limiters, notifier, store } = ctx;
    const router = express.Router();

    // Vergleichs-Hash, damit eine Anmeldung mit unbekanntem Namen gleich lange dauert.
    let dummyHash = null;
    const getDummyHash = () => {
        if (!dummyHash) dummyHash = bcrypt.hash(randomLoginCode(), config.bcryptRounds);
        return dummyHash;
    };

    async function deliverLoginCode(teacherId, email, code) {
        if (!config.isProduction && !mailer.enabled) {
            logger.info(`[nur Entwicklung] Login-Code für ${email}: ${code}`);
            return;
        }
        try {
            await mailer.sendLoginCode(email, code);
        } catch (err) {
            logger.warn('Login-Code konnte nicht per E-Mail versendet werden', err.message);
            if (config.isProduction) {
                // Ohne Mail gibt es keinen Weg zum Passwort, also darf ein neuer Versuch moeglich bleiben.
                await db.run('DELETE FROM teachers WHERE id = ?', [teacherId]);
            } else {
                logger.info(`[nur Entwicklung] Login-Code für ${email}: ${code}`);
            }
        }
    }

    // Oeffentlich: Die Login-Seite blendet damit den Link zur Registrierung aus.
    router.get('/config', (req, res) => {
        res.json({ allowRegistration: config.allowRegistration });
    });

    router.post('/register', limiters.register, asyncHandler(async (req, res) => {
        if (!config.allowRegistration) throw forbidden('Die Registrierung ist deaktiviert.');
        const { email } = parse(schemas.register, req.body);
        const code = randomLoginCode();
        const hash = await bcrypt.hash(code, config.bcryptRounds);
        const teacherId = await db.transaction(async (tx) => {
            const result = await tx.run(
                'INSERT INTO teachers (username, password, created_at) VALUES (?, ?, ?) ON CONFLICT(username) DO NOTHING',
                [email, hash, nowIso()]
            );
            if (result.changes === 0) return null;
            await seedExampleBlueprints(tx, result.lastID);
            return result.lastID;
        });
        if (teacherId) {
            // Bewusst nicht abgewartet: die Antwortzeit darf nichts verraten.
            deliverLoginCode(teacherId, email, code).catch((err) => logger.error('Fehler beim Login-Code-Versand', err));
        }
        res.json(REGISTER_RESPONSE);
    }));

    router.post('/login', limiters.login, asyncHandler(async (req, res) => {
        const { username, password } = parse(schemas.login, req.body);
        const teacher = await db.get('SELECT * FROM teachers WHERE username = ?', [username]);
        const match = await bcrypt.compare(password, teacher ? teacher.password : await getDummyHash());
        if (!teacher || !match) throw unauthorized('Ungültige Anmeldedaten');
        const previousSid = req.sessionID;
        await regenerate(req);
        // Sockets der alten Session sonst weiter in den Raeumen der vorherigen Anmeldung.
        notifier.disconnectHttpSession(previousSid);
        req.session.teacherId = teacher.id;
        req.session.username = teacher.username;
        res.json({ success: true, username: teacher.username });
    }));

    router.post('/logout', asyncHandler(async (req, res) => {
        const sid = req.sessionID;
        if (req.session) await destroy(req);
        notifier.disconnectHttpSession(sid);
        res.clearCookie(ctx.sessionCookieName);
        res.json({ success: true });
    }));

    router.get('/me', (req, res) => {
        if (req.session.teacherId) res.json({ loggedIn: true, username: req.session.username });
        else res.json({ loggedIn: false });
    });

    router.post('/change-password', limiters.login, requireTeacher, asyncHandler(async (req, res) => {
        const { currentPassword, newPassword } = parse(schemas.changePassword, req.body);
        const teacher = await db.get('SELECT * FROM teachers WHERE id = ?', [req.session.teacherId]);
        if (!teacher) throw unauthorized();
        if (!await bcrypt.compare(currentPassword, teacher.password)) {
            throw new ApiError(403, 'Das aktuelle Passwort ist falsch.', { code: 'WRONG_PASSWORD' });
        }
        if (currentPassword === newPassword) throw badRequest('Das neue Passwort muss sich vom alten unterscheiden.');
        const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
        await db.run('UPDATE teachers SET password = ? WHERE id = ?', [hash, teacher.id]);
        const endedSessions = await store.destroyOtherTeacherSessions(teacher.id, req.sessionID);
        endedSessions.forEach((sid) => notifier.disconnectHttpSession(sid));
        res.json({ success: true });
    }));

    return router;
}

module.exports = { createAuthRouter };
