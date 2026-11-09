'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireTeacher } = require('../middleware/auth');
const { schemas, parse, TEAM_COLORS } = require('../lib/schemas');
const { badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const { containsBadWords } = require('../lib/filter');
const state = require('../lib/gameState');
const sessions = require('../lib/sessions');
const board = require('../lib/board');

function createTeamsRouter(ctx) {
    const { db, limiters, notifier } = ctx;
    const router = express.Router();

    async function activeSessionOfTeam(req) {
        if (!req.session.teamId) return { team: null, session: null };
        const team = await db.get('SELECT * FROM teams WHERE id = ?', [req.session.teamId]);
        if (!team) return { team: null, session: null };
        const session = await db.get("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [team.session_id]);
        return session ? { team, session } : { team: null, session: null };
    }

    function joinPayload(session, takenColors) {
        return {
            sessionId: session.id,
            maxTeams: session.max_teams,
            gameStatus: session.game_status,
            takenColors,
            colors: TEAM_COLORS
        };
    }

    /** Dieser Browser gehoert nicht mehr zu dem Team: Seine Sockets duerfen dort nichts mehr empfangen. */
    function leaveFormerTeam(req, formerTeam) {
        notifier.leaveTeamRooms(req.sessionID, formerTeam);
    }

    router.post('/join', limiters.join, asyncHandler(async (req, res) => {
        const { code } = parse(schemas.join, req.body);
        const session = await db.get("SELECT * FROM sessions WHERE code = ? AND status = 'active'", [code]);
        if (!session) throw notFound('Session nicht gefunden oder abgelaufen');

        const { team } = await activeSessionOfTeam(req);
        if (team && team.session_id !== session.id) {
            delete req.session.teamId;
            leaveFormerTeam(req, team);
        }
        req.session.joinedSessionId = session.id;

        res.json({
            success: true,
            ...joinPayload(session, await state.loadTakenColors(db, session.id)),
            team: team && team.session_id === session.id ? await state.buildTeamState(db, session, team) : null
        });
    }));

    router.post('/rejoin', limiters.rejoin, asyncHandler(async (req, res) => {
        const { teamCode } = parse(schemas.rejoin, req.body);
        const team = await db.get('SELECT * FROM teams WHERE team_code = ?', [teamCode]);
        const session = team ? await db.get("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [team.session_id]) : null;
        if (!session) throw notFound('Team-Code ungültig oder Session beendet.');
        const { team: formerTeam } = await activeSessionOfTeam(req);
        if (formerTeam && formerTeam.id !== team.id) leaveFormerTeam(req, formerTeam);
        req.session.teamId = team.id;
        req.session.joinedSessionId = session.id;
        res.json({ success: true, ...await state.buildTeamState(db, session, team) });
    }));

    // Wiederherstellung beim Seitenaufruf aus dem Session-Cookie.
    router.get('/team/me', asyncHandler(async (req, res) => {
        const { team, session } = await activeSessionOfTeam(req);
        if (team) {
            return res.json({ role: 'team', ...await state.buildTeamState(db, session, team) });
        }
        if (req.session.teamId) delete req.session.teamId;
        if (req.session.joinedSessionId) {
            const joined = await db.get("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [req.session.joinedSessionId]);
            if (joined) {
                return res.json({ role: 'joined', ...joinPayload(joined, await state.loadTakenColors(db, joined.id)) });
            }
            delete req.session.joinedSessionId;
        }
        return res.json({ role: 'none' });
    }));

    router.post('/teams', limiters.teams, asyncHandler(async (req, res) => {
        const input = parse(schemas.createTeam, req.body);
        const sessionId = req.session.joinedSessionId;
        if (!sessionId) throw forbidden('Bitte gib zuerst den Session-Code ein.');
        if (containsBadWords(input.name)) throw badRequest('Unangemessener Teamname');

        const { team: existing } = await activeSessionOfTeam(req);
        if (existing && existing.session_id === sessionId) throw conflict('Du gehörst bereits zu einem Team.', { code: 'ALREADY_IN_TEAM' });

        const { session, team } = await sessions.createTeam(db, sessionId, input);
        req.session.teamId = team.id;

        notifier.teamCreated(session, state.serializeTeamForTeacher(session, team, []));
        notifier.colorPicked(session.id, team.color);
        await board.publish(ctx, session.id);
        res.status(201).json({ success: true, ...await state.buildTeamState(db, session, team) });
    }));

    router.delete('/teams/:id', requireTeacher, asyncHandler(async (req, res) => {
        const { id } = parse(schemas.idParam, req.params);
        const team = await sessions.deleteTeam(ctx, req.session.teacherId, id);
        notifier.teamDeleted(team);
        await board.publish(ctx, team.session_id);
        res.json({ success: true });
    }));

    return router;
}

module.exports = { createTeamsRouter };
