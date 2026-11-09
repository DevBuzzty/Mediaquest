'use strict';

const { studentBlueprint, teacherBlueprint } = require('../lib/gameState');

const rooms = {
    teacher: (sessionId) => `session:${sessionId}:teacher`,
    teams: (sessionId) => `session:${sessionId}:teams`,
    lobby: (sessionId) => `session:${sessionId}:lobby`,
    teacherHome: (teacherId) => `teacher:${teacherId}`,
    team: (teamId) => `team:${teamId}`,
    httpSession: (sid) => `http:${sid}`
};

/**
 * Alle Live-Nachrichten des Servers. Daten von Teams (Fortschritt, Einsendungen)
 * gehen ausschliesslich in den Lehrkraft-Raum.
 */
function createNotifier(io) {
    const sessionRooms = (sessionId) => [rooms.teacher(sessionId), rooms.teams(sessionId), rooms.lobby(sessionId)];
    const toTeacher = (sessionId, event, payload) => io.to(rooms.teacher(sessionId)).emit(event, payload);

    function broadcastBlueprint(event, session) {
        const base = { sessionId: session.id, gameStatus: session.game_status, gameMode: session.game_mode };
        io.to(rooms.teacher(session.id)).emit(event, { ...base, blueprint: teacherBlueprint(session) });
        io.to(rooms.teams(session.id)).emit(event, { ...base, blueprint: studentBlueprint(session) });
        io.to(rooms.lobby(session.id)).emit(event, base);
    }

    return {
        rooms,

        gameStarted(session) {
            broadcastBlueprint('gameStarted', session);
        },
        gameModeUpdated(session) {
            broadcastBlueprint('gameModeUpdated', session);
        },
        gameEnded(sessionId) {
            io.to(sessionRooms(sessionId)).emit('gameEnded', { sessionId });
        },
        /** Für alle Tabs der Lehrkraft, auch solche, die noch in keinem Session-Raum sind. */
        sessionOpened(teacherId, sessionId) {
            io.to(rooms.teacherHome(teacherId)).emit('sessionOpened', { sessionId });
        },
        sessionClosed(sessionId) {
            const all = sessionRooms(sessionId);
            io.to(all).emit('sessionClosed', { sessionId });
            io.in(all).socketsLeave(all);
        },
        displayResults(sessionId) {
            io.to([rooms.teacher(sessionId), rooms.teams(sessionId)]).emit('displayResults', { sessionId });
        },
        teamLimitUpdated(sessionId, maxTeams) {
            io.to([rooms.teacher(sessionId), rooms.lobby(sessionId)]).emit('teamLimitUpdated', { sessionId, maxTeams });
        },
        teamCreated(session, team) {
            toTeacher(session.id, 'teamCreated', { sessionId: session.id, gameStatus: session.game_status, team });
        },
        colorPicked(sessionId, color) {
            io.to(sessionRooms(sessionId)).emit('colorPicked', { sessionId, color });
        },
        teamDeleted(team) {
            const teamRoom = rooms.team(team.id);
            const payload = { sessionId: team.session_id, teamId: team.id };
            io.to([rooms.teacher(team.session_id), teamRoom]).emit('teamDeleted', payload);
            io.in(teamRoom).socketsLeave([rooms.teams(team.session_id), teamRoom]);
            io.to(sessionRooms(team.session_id)).emit('colorFreed', { sessionId: team.session_id, color: team.color });
        },
        teamTaskUpdate(sessionId, payload) {
            toTeacher(sessionId, 'teamTaskUpdate', { sessionId, ...payload });
        },
        teamTaskResult(sessionId, payload) {
            toTeacher(sessionId, 'teamTaskResult', { sessionId, ...payload });
        },
        teamFinished(sessionId, payload) {
            toTeacher(sessionId, 'teamFinished', { sessionId, ...payload });
        },
        newSubmission(sessionId, submission) {
            toTeacher(sessionId, 'newSubmission', submission);
        },
        /** Lehrkraft bekommt die Einzelstaende der Gruppen, Teams nur den Klassen-Stand. */
        boardState(sessionId, teacher, publicState) {
            toTeacher(sessionId, 'boardState', teacher);
            io.to(rooms.teams(sessionId)).emit('boardState', publicState);
        },
        boardCard(teamId, payload) {
            io.to(rooms.team(teamId)).emit('boardCard', payload);
        },
        monsterConfirmed(teamId, payload) {
            io.to(rooms.team(teamId)).emit('monsterConfirmed', payload);
        },
        disconnectHttpSession(sid) {
            io.in(rooms.httpSession(sid)).disconnectSockets(true);
        },
        /** Ein Browser wechselt das Team; ein Lehrkraft-Tab desselben Browsers bleibt verbunden. */
        leaveTeamRooms(sid, team) {
            io.in(rooms.httpSession(sid)).socketsLeave([rooms.team(team.id), rooms.teams(team.session_id)]);
        }
    };
}

module.exports = { createNotifier, rooms };
