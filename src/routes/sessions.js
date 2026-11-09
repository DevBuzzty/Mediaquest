'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireTeacher } = require('../middleware/auth');
const { schemas, parse } = require('../lib/schemas');
const { conflict, forbidden, notFound } = require('../lib/errors');
const state = require('../lib/gameState');
const sessions = require('../lib/sessions');
const board = require('../lib/board');

function createSessionsRouter(ctx) {
    const { db, notifier } = ctx;
    const router = express.Router();

    const teacherId = (req) => req.session.teacherId;

    async function requireOwned(req) {
        const { id } = parse(schemas.idParam, req.params);
        const session = await sessions.getOwnedSession(db, id, teacherId(req));
        if (!session) throw forbidden();
        return session;
    }

    function respondOpened(req, res, { session, closedSessionId }) {
        if (closedSessionId) notifier.sessionClosed(closedSessionId);
        notifier.sessionOpened(teacherId(req), session.id);
        res.status(201).json({ success: true, code: session.code, sessionId: session.id });
    }

    router.post('/', requireTeacher, asyncHandler(async (req, res) => {
        if (req.body && req.body.gameMode === 'board') {
            const input = parse(schemas.createBoardSession, req.body);
            return respondOpened(req, res, await sessions.createBoardSession(db, teacherId(req), input.board, input.maxTeams));
        }
        const { blueprintId, maxTeams } = parse(schemas.createSession, req.body);
        const blueprint = await sessions.getOwnedBlueprint(db, blueprintId, teacherId(req));
        if (!blueprint) throw notFound('Spielrunde nicht gefunden');
        return respondOpened(req, res, await sessions.createSession(db, teacherId(req), blueprint, maxTeams));
    }));

    router.get('/active', requireTeacher, asyncHandler(async (req, res) => {
        const session = await sessions.getActiveSession(db, teacherId(req));
        if (!session) return res.json({ active: false });
        return res.json(await state.buildTeacherState(db, session));
    }));

    router.post('/close', requireTeacher, asyncHandler(async (req, res) => {
        const closedSessionId = await sessions.closeSession(db, teacherId(req));
        if (closedSessionId) notifier.sessionClosed(closedSessionId);
        res.json({ success: true });
    }));

    router.get('/history', requireTeacher, asyncHandler(async (req, res) => {
        const rows = await db.all(
            "SELECT * FROM sessions WHERE teacher_id = ? AND status = 'closed' ORDER BY created_at DESC, id DESC",
            [teacherId(req)]
        );
        res.json({ sessions: rows.map(state.serializeTeacherSession) });
    }));

    router.patch('/active/limit', requireTeacher, asyncHandler(async (req, res) => {
        const { maxTeams } = parse(schemas.teamLimit, req.body);
        const sessionId = await sessions.updateTeamLimit(db, teacherId(req), maxTeams);
        notifier.teamLimitUpdated(sessionId, maxTeams);
        res.json({ success: true, maxTeams });
    }));

    router.post('/active/start', requireTeacher, asyncHandler(async (req, res) => {
        const { session, alreadyRunning } = await sessions.startGame(db, teacherId(req));
        if (!alreadyRunning) {
            notifier.gameStarted(session);
            await board.publish(ctx, session.id);
        }
        res.json({ success: true, alreadyRunning, blueprint: state.teacherBlueprint(session) });
    }));

    router.patch('/active/mode', requireTeacher, asyncHandler(async (req, res) => {
        const { blueprintId } = parse(schemas.switchBlueprint, req.body);
        const session = await sessions.switchBlueprint(db, teacherId(req), blueprintId);
        notifier.gameModeUpdated(session);
        res.json({ success: true, blueprint: state.teacherBlueprint(session) });
    }));

    router.post('/active/end', requireTeacher, asyncHandler(async (req, res) => {
        const session = await sessions.endGame(db, teacherId(req));
        notifier.gameEnded(session.id);
        await board.publish(ctx, session.id);
        res.json({ success: true });
    }));

    router.post('/:id/reopen', requireTeacher, asyncHandler(async (req, res) => {
        const { id } = parse(schemas.idParam, req.params);
        const { session, closedSessionId } = await sessions.reopenSession(db, teacherId(req), id);
        if (closedSessionId) notifier.sessionClosed(closedSessionId);
        notifier.sessionOpened(teacherId(req), session.id);
        res.json({ success: true, sessionId: session.id, code: session.code });
    }));

    router.get('/:id/teams', requireTeacher, asyncHandler(async (req, res) => {
        const session = await requireOwned(req);
        const { teams } = await state.buildTeacherState(db, session);
        res.json({ teams });
    }));

    router.get('/:id/submissions', requireTeacher, asyncHandler(async (req, res) => {
        const session = await requireOwned(req);
        res.json({ submissions: await state.loadSubmissions(db, session.id) });
    }));

    router.get('/:id/board-history', requireTeacher, asyncHandler(async (req, res) => {
        const session = await requireOwned(req);
        const history = await board.buildBoardHistory(db, session);
        if (!history) throw conflict('Diese Session spielt kein Brettspiel.', { code: 'NOT_BOARD' });
        res.json(history);
    }));

    // Lehrkraft: jederzeit. Team dieser Session: erst, nachdem die Lehrkraft freigegeben hat.
    router.get('/:id/results', asyncHandler(async (req, res) => {
        const { id } = parse(schemas.idParam, req.params);
        const session = await sessions.getSession(db, id);
        if (!session) throw forbidden();
        if (req.session.teacherId && req.session.teacherId === session.teacher_id) {
            const results = await state.loadResultsForSession(db, id);
            return res.json({
                submissions: await state.loadSubmissions(db, id),
                results: results.map((row) => ({ team_id: row.team_id, ...state.serializeResult(row) }))
            });
        }
        const team = req.session.teamId
            ? await db.get('SELECT id FROM teams WHERE id = ? AND session_id = ?', [req.session.teamId, id])
            : null;
        if (!team || !session.results_enabled) throw forbidden();
        return res.json({ submissions: await state.loadPublicSubmissions(db, id) });
    }));

    router.delete('/:id', requireTeacher, asyncHandler(async (req, res) => {
        const { id } = parse(schemas.idParam, req.params);
        await sessions.deleteClosedSession(ctx, teacherId(req), id);
        res.json({ success: true });
    }));

    return router;
}

module.exports = { createSessionsRouter };
