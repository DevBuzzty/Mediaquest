/*
 * store.js: Stand des Dashboards, ohne DOM.
 *
 * Grundsatz: Der Stand nach einem Live-Ereignis muss dem Stand nach einem Reload entsprechen.
 * reduce() bildet deshalb die Serverlogik aus docs/API.md nach, createLiveStore() puffert
 * Ereignisse, die während eines Abgleichs eintreffen, und spielt sie danach in Reihenfolge ein.
 */

const TaskTypes = globalThis.TaskTypes;

export const EMPTY_STATE = Object.freeze({ session: null, teams: Object.freeze([]), submissions: Object.freeze([]), board: null });

/** Ereignisse, die den ganzen Durchlauf betreffen: danach gleicht das Dashboard mit dem Server ab. */
export const GAME_WIDE_EVENTS = new Set(['gameStarted', 'gameModeUpdated', 'gameEnded']);

export const LIVE_EVENTS = [
    'gameStarted', 'gameModeUpdated', 'gameEnded', 'sessionClosed', 'displayResults', 'teamLimitUpdated',
    'teamCreated', 'teamDeleted', 'teamTaskUpdate', 'teamTaskResult', 'teamFinished', 'newSubmission', 'boardState'
];

const TEAM_EVENTS = new Set(['teamTaskUpdate', 'teamTaskResult', 'teamFinished']);

/** TeacherState oder { active: false } vom Server in den Dashboard-Stand übernehmen. */
export function fromServer(payload) {
    if (!payload || !payload.session || payload.active === false) return EMPTY_STATE;
    return {
        session: payload.session,
        teams: Array.isArray(payload.teams) ? payload.teams : [],
        submissions: Array.isArray(payload.submissions) ? payload.submissions : [],
        board: payload.board || null
    };
}

/**
 * Das Ereignis bringt den ganzen Spielstand mit, nur die Kartensets stehen allein im Abgleich.
 * Eine ältere rev (etwa ein gepuffertes Ereignis nach einem Abgleich) darf nichts zurückdrehen.
 */
function applyBoardState(state, payload) {
    if (state.board && payload.rev < state.board.rev) return state;
    return {
        ...state,
        session: { ...state.session, game_status: payload.gameStatus || state.session.game_status },
        board: { ...state.board, ...payload }
    };
}

function emptyProgress(blueprint) {
    const list = blueprint && Array.isArray(blueprint.tasks) ? blueprint.tasks : [];
    const first = blueprint && blueprint.templateType !== 'qr' && list.length > 0 ? list[0] : null;
    return {
        total: list.length,
        completed: 0,
        skipped: 0,
        currentIndex: first ? 0 : null,
        currentTaskKey: first ? first.key : null,
        finished: false,
        finishedAt: null,
        tasks: list.map((task, index) => ({
            key: task.key,
            index,
            type: task.type,
            title: TaskTypes.taskTitle(task),
            status: 'pending',
            completedAt: null
        }))
    };
}

function replaceTeam(state, teamId, change) {
    return { ...state, teams: state.teams.map((team) => (team.id === teamId ? { ...team, ...change(team) } : team)) };
}

function upsertResult(results, entry) {
    const list = Array.isArray(results) ? results : [];
    const known = list.some((row) => row.task_key === entry.task_key);
    return known
        ? list.map((row) => (row.task_key === entry.task_key ? { ...row, ...entry } : row))
        : [...list, entry];
}

function startedEntry(payload) {
    return {
        task_key: payload.taskKey,
        task_index: payload.taskIndex,
        task_type: payload.taskType,
        task_title: payload.taskTitle,
        status: 'started',
        completed_at: null
    };
}

function compareSubmissions(a, b) {
    return String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id;
}

function upsertById(list, entry) {
    return list.some((row) => row.id === entry.id)
        ? list.map((row) => (row.id === entry.id ? entry : row))
        : [...list, entry];
}

function resetRun(state, payload) {
    const blueprint = payload.blueprint || state.session.blueprint;
    return {
        ...state,
        session: {
            ...state.session,
            game_status: payload.gameStatus || state.session.game_status,
            blueprint,
            blueprint_id: blueprint && blueprint.id !== undefined ? blueprint.id : state.session.blueprint_id,
            results_enabled: false
        },
        teams: state.teams.map((team) => ({
            ...team,
            finished_at: null,
            results: [],
            progress: emptyProgress(blueprint)
        }))
    };
}

const payloadSessionId = (payload) => (payload.sessionId !== undefined ? payload.sessionId : payload.session_id);

const REDUCERS = {
    gameStarted: resetRun,
    gameModeUpdated: resetRun,
    gameEnded: (state) => ({ ...state, session: { ...state.session, game_status: 'waiting' } }),
    sessionClosed: () => EMPTY_STATE,
    displayResults: (state) => ({ ...state, session: { ...state.session, results_enabled: true } }),
    teamLimitUpdated: (state, payload) => ({ ...state, session: { ...state.session, max_teams: payload.maxTeams } }),
    teamCreated: (state, payload) => (payload.team
        ? { ...state, teams: upsertById(state.teams, payload.team).sort((a, b) => a.id - b.id) }
        : state),
    teamDeleted: (state, payload) => ({
        ...state,
        teams: state.teams.filter((team) => team.id !== payload.teamId),
        submissions: state.submissions.filter((submission) => submission.team_id !== payload.teamId),
        board: state.board
            ? { ...state.board, groups: state.board.groups.filter((group) => group.teamId !== payload.teamId) }
            : null
    }),
    teamTaskUpdate: (state, payload) => replaceTeam(state, payload.teamId, (team) => ({
        progress: payload.progress,
        results: upsertResult(team.results, startedEntry(payload))
    })),
    teamTaskResult: (state, payload) => replaceTeam(state, payload.teamId, (team) => ({
        progress: payload.progress,
        results: payload.result ? upsertResult(team.results, payload.result) : team.results
    })),
    teamFinished: (state, payload) => replaceTeam(state, payload.teamId, () => ({
        progress: payload.progress,
        finished_at: payload.finishedAt
    })),
    newSubmission: (state, payload) => ({
        ...state,
        submissions: upsertById(state.submissions, payload).sort(compareSubmissions)
    }),
    boardState: applyBoardState
};

/** Wendet ein Live-Ereignis an. Unbekannte Ereignisse und fremde Sessions ändern nichts. */
export function reduce(state, event, payload) {
    if (!payload || typeof payload !== 'object' || !state.session) return state;
    if (payloadSessionId(payload) !== state.session.id) return state;
    const reducer = Object.prototype.hasOwnProperty.call(REDUCERS, event) ? REDUCERS[event] : null;
    return reducer ? reducer(state, payload) : state;
}

/** Meldet ein Fortschritts-Ereignis ein Team, das das Dashboard nicht kennt? Dann fehlt Stand. */
export function isUnknownTeamEvent(state, event, payload) {
    return TEAM_EVENTS.has(event)
        && Boolean(state.session && payload && payloadSessionId(payload) === state.session.id)
        && !state.teams.some((team) => team.id === payload.teamId);
}

/**
 * Hält den Stand und puffert Ereignisse während eines Abgleichs.
 * begin() vor der Anfrage, danach commit(serverStand) oder rollback().
 * Ein Ereignis, das schon im Serverstand steckt, ändert beim Nachspielen nichts Falsches,
 * weil jedes Ereignis den vollständigen Fortschritt seines Teams mitbringt.
 */
export function createLiveStore({ onChange = () => {} } = {}) {
    let state = EMPTY_STATE;
    let buffer = null;

    function replay(events) {
        events.forEach(([event, payload]) => {
            state = reduce(state, event, payload);
        });
    }

    return {
        get state() { return state; },
        get syncing() { return buffer !== null; },
        begin() {
            if (buffer === null) buffer = [];
        },
        commit(serverPayload) {
            const events = buffer || [];
            buffer = null;
            state = fromServer(serverPayload);
            replay(events);
            onChange();
        },
        rollback() {
            const events = buffer || [];
            buffer = null;
            replay(events);
            onChange();
        },
        dispatch(event, payload) {
            if (buffer !== null) {
                buffer.push([event, payload]);
                return;
            }
            state = reduce(state, event, payload);
            onChange();
        }
    };
}
