/*
 * main.js: Steuerung des Lehrkräfte-Dashboards.
 *
 * Ablauf: Der Stand liegt im Store (store.js). sync() holt ihn vom Server, betritt den Socket-Raum
 * und übernimmt den Ack; das passiert beim Laden, bei jedem connect und nach jeder Aktion.
 * Live-Ereignisse gehen durch denselben Store. render() zeichnet immer aus dem Store.
 */
import { api, errorMessage } from '../shared/api.js';
import { byId, clear, h, mount, setHidden } from '../shared/dom.js';
import { connectSocket } from '../shared/socket.js';
import { alert, confirm, dismissAll } from '../shared/ui.js';
import { createReadAloud } from './audio.js';
import { boardQrSections, unfinishedGroups } from './board-format.js';
import { createBoardSetup } from './board-setup.js';
import { createBoardView } from './board-view.js';
import { createSubmissionList, monsterAudioKey, taskOverview, teamCard } from './components.js';
import {
    blueprintOptionLabel, blueprintTaskCount, formatDate, isKartenset, parseTeamLimit, sessionStatusLabel
} from './format.js';
import { showChangePasswordPanel, showHistoryDetails, showResultsPanel } from './panels.js';
import { blueprintSheet, createQrSheet } from './qr-sheet.js';
import { createLiveStore, GAME_WIDE_EVENTS, isUnknownTeamEvent, LIVE_EVENTS } from './store.js';

const NOTICE_MS = 5000;

const els = {
    username: byId('teacherUsername'),
    banner: byId('connectionBanner'),
    notice: byId('noticeBar'),
    loading: byId('loadingHint'),
    active: byId('activeSessionContainer'),
    none: byId('noActiveSessionContainer'),
    phaseBadge: byId('phaseBadge'),
    blueprintTitle: byId('sessionBlueprintTitle'),
    code: byId('sessionCodeDisplay'),
    limitForm: byId('limitForm'),
    limitInput: byId('updateMaxTeams'),
    limitBtn: byId('updateLimitBtn'),
    teamCount: byId('teamCountDisplay'),
    classicPanel: byId('classicPanel'),
    boardPanel: byId('boardPanel'),
    runningHeadline: byId('runningHeadline'),
    resultsHint: byId('resultsEnabledHint'),
    teamList: byId('teamList'),
    overviewHeading: byId('overviewHeading'),
    overview: byId('templateOverviewList'),
    showQrBtn: byId('showQrBtn'),
    switchForm: byId('switchForm'),
    switchSelect: byId('switchBlueprintSelect'),
    switchBtn: byId('switchBlueprintBtn'),
    startGameBtn: byId('startGameBtn'),
    endGameBtn: byId('endGameBtn'),
    showResultsBtn: byId('showResultsBtn'),
    closeBtn: byId('closeSessionBtn'),
    submissionsBox: byId('submissionsContainer'),
    submissions: byId('submissionsList'),
    createForm: byId('createSessionForm'),
    modeBoard: byId('modeBoard'),
    modeClassic: byId('modeClassic'),
    classicSetup: byId('classicSetup'),
    boardSetup: byId('boardSetup'),
    maxTeams: byId('maxTeams'),
    blueprintSelect: byId('blueprintSelect'),
    templateInfo: byId('selectedTemplateInfo'),
    createBtn: byId('startSessionBtn'),
    history: byId('historyTableBody'),
    logoutBtn: byId('logoutBtn'),
    changePasswordBtn: byId('changePasswordBtn')
};

const expandedTeams = new Set();
const confirmingMonsters = new Set();
const submissionCards = createSubmissionList();
const qrSheet = createQrSheet({
    sheet: byId('qrSheet'),
    title: byId('qrSheetTitle'),
    grid: byId('qrSheetGrid'),
    printBtn: byId('qrPrintBtn'),
    closeBtn: byId('qrCloseBtn')
});

const boardSetup = createBoardSetup(els.boardSetup);
const readAloud = createReadAloud({ onError: showNotice });
const boardView = createBoardView({
    root: els.boardPanel,
    readAloud,
    onAction: runBoardAction,
    onShowQr: () => openQrSheet(),
    onDeleteTeam: deleteTeam
});

let blueprints = [];
let conn = null;
let loaded = false;
let shownSessionId = null;
let shownLimit = null;
let renderQueued = false;
let loggingOut = false;
let ownSessionChange = false;
let noticeTimer = null;
let syncRunning = null;
let syncAgain = false;
let forceDialogOpen = false;

const store = createLiveStore({ onChange: scheduleRender });

// --- Hilfen ----------------------------------------------------------------

function redirectToLogin() {
    window.location.href = '/login.html';
}

async function reportError(err) {
    if (err && err.status === 401) {
        redirectToLogin();
        return;
    }
    await alert(errorMessage(err), { title: 'Fehler', icon: '⚠️' });
}

function showNotice(text) {
    els.notice.textContent = text;
    setHidden(els.notice, false);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => setHidden(els.notice, true), NOTICE_MS);
}

/** Führt eine Nutzer-Aktion aus: gegen Doppelklick gesichert, Fehler werden angezeigt. */
async function runAction(button, action) {
    if (button && button.disabled) return;
    if (button) button.disabled = true;
    try {
        await action();
    } catch (err) {
        await reportError(err);
    } finally {
        if (button) button.disabled = false;
    }
}

/** Aktionen, nach denen sich die aktive Session ändert: keine "wurde beendet"-Meldung für die eigene. */
async function changingSession(action) {
    ownSessionChange = true;
    try {
        await action();
    } finally {
        ownSessionChange = false;
    }
}

function selectedBlueprint(select) {
    return blueprints.find((blueprint) => String(blueprint.id) === select.value) || null;
}

// --- Abgleich mit dem Server ------------------------------------------------

async function fetchServerState() {
    const active = await api.get('/api/sessions/active');
    if (!active.active || !conn || !conn.connected) return active;
    try {
        const ack = await conn.emit('joinSessionRoom', { sessionId: active.session.id, as: 'teacher' });
        return ack.state;
    } catch (err) {
        if (err.code === 'SESSION_CLOSED') return api.get('/api/sessions/active');
        // Ohne Socket gilt der HTTP-Stand; beim nächsten connect folgt ein neuer Abgleich.
        if (err.code === 'DISCONNECTED' || err.code === 'TIMEOUT') return active;
        throw err;
    }
}

async function syncOnce() {
    store.begin();
    let committed = false;
    try {
        const next = await fetchServerState();
        loaded = true;
        store.commit(next);
        committed = true;
    } finally {
        if (!committed) store.rollback();
    }
}

/** Mehrere gleichzeitige Anstöße laufen zu einem Durchgang plus höchstens einem weiteren zusammen. */
function sync() {
    if (syncRunning) {
        syncAgain = true;
        return syncRunning;
    }
    syncRunning = (async () => {
        try {
            do {
                syncAgain = false;
                await syncOnce();
            } while (syncAgain);
        } finally {
            syncRunning = null;
        }
    })();
    return syncRunning;
}

function reportSyncError(err) {
    if (err && err.status === 401) redirectToLogin();
    else showNotice(errorMessage(err, 'Der aktuelle Stand konnte nicht geladen werden.'));
}

function syncInBackground() {
    sync().catch(reportSyncError);
}

async function afterSessionClosed() {
    const wasOwnChange = ownSessionChange;
    try {
        await sync();
        await loadHistory();
        if (!store.state.session && !wasOwnChange) showNotice('Die Session wurde beendet.');
    } catch (err) {
        reportSyncError(err);
    }
}

function handleLiveEvent(event, payload) {
    const shownId = store.state.session ? store.state.session.id : null;
    const closesShown = event === 'sessionClosed' && Boolean(payload) && payload.sessionId === shownId;
    store.dispatch(event, payload);
    if (closesShown) afterSessionClosed();
    else if (GAME_WIDE_EVENTS.has(event) || isUnknownTeamEvent(store.state, event, payload)) syncInBackground();
}

async function handleSocketStatus(status) {
    setHidden(els.banner, status === 'connected' || status === 'connecting');
    if (status !== 'disconnected' || loggingOut) return;
    // Der Server trennt nur bei beendeter Anmeldung; bleibt sie gültig, einfach neu verbinden.
    try {
        const me = await api.get('/api/me');
        if (me.loggedIn) conn.connect();
        else redirectToLogin();
    } catch (err) {
        reportSyncError(err);
    }
}

// --- Zeichnen ---------------------------------------------------------------

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
        renderQueued = false;
        render();
    });
}

/** Ersetzt den Inhalt und stellt den Tastaturfokus wieder her. */
function mountKeepingFocus(parent, ...children) {
    const active = document.activeElement;
    const key = active && parent.contains(active) ? active.dataset.focusKey : null;
    mount(parent, ...children);
    if (key) {
        const next = parent.querySelector(`[data-focus-key="${key}"]`);
        if (next) next.focus();
    }
}

function monsterKey(teamId, taskKey) {
    return `${teamId}:${taskKey}`;
}

const monsterActions = {
    readAloud,
    onConfirmMonster: (teamId, taskKey) => confirmMonster(teamId, taskKey),
    isConfirming: (teamId, taskKey) => confirmingMonsters.has(monsterKey(teamId, taskKey))
};

function toggleTeam(teamId) {
    if (expandedTeams.has(teamId)) expandedTeams.delete(teamId);
    else expandedTeams.add(teamId);
    scheduleRender();
}

function renderTeams(state, running) {
    const { teams, session } = state;
    [...expandedTeams].filter((id) => !teams.some((team) => team.id === id)).forEach((id) => expandedTeams.delete(id));
    els.teamCount.textContent = `${teams.length} von ${session.max_teams} Teams`;
    if (teams.length === 0) {
        mount(els.teamList, h('p', { class: 'text-slate-400 italic' }, 'Noch keine Teams beigetreten.'));
        return;
    }
    mountKeepingFocus(els.teamList, teams.map((team) => teamCard({
        team,
        blueprint: session.blueprint,
        running,
        expanded: expandedTeams.has(team.id),
        onToggle: toggleTeam,
        onDelete: deleteTeam,
        monsterActions
    })));
}

function isBoardSession(state) {
    return Boolean(state.session && state.session.game_mode === 'board' && state.board);
}

/** Inhalt des QR-Bogens der aktiven Session; null, wenn sie keine Codes hat. */
function currentQrSheet(state) {
    if (!isBoardSession(state)) return state.session ? blueprintSheet(state.session.blueprint) : null;
    return { title: 'QR-Karten aller Kartensets', sections: boardQrSections(state.board) };
}

function openQrSheet() {
    const content = currentQrSheet(store.state);
    if (content) qrSheet.open(content);
}

function renderClassic(state, running) {
    const blueprint = state.session.blueprint;
    els.overviewHeading.textContent = blueprint && blueprint.templateType === 'qr' ? 'Stationen' : 'Aufgaben';
    mount(els.overview, taskOverview(blueprint));
    renderTeams(state, running);
    return state.teams.map((team) => monsterAudioKey(team, blueprint, running));
}

function renderBoard(state) {
    const { board, session, teams } = state;
    els.teamCount.textContent = `${teams.length} von ${session.max_teams} Teams`;
    // Hat sich die Runde von selbst geschlossen, ist die Frage zum Auswerten hinfällig.
    if (forceDialogOpen && board.phase !== 'round') dismissAll();
    return [boardView.render({ board, session, teams })];
}

function renderSession(state) {
    const { session, submissions } = state;
    const running = session.game_status === 'running';
    const blueprint = session.blueprint;
    const isBoard = isBoardSession(state);
    const isQr = !isBoard && Boolean(blueprint && blueprint.templateType === 'qr');

    const victory = isBoard && state.board.phase === 'finished';
    els.phaseBadge.textContent = victory ? 'Spiel zu Ende' : running ? 'Spiel läuft' : 'Lobby';
    if (isBoard) {
        els.blueprintTitle.textContent = `Brettspiel mit ${state.board.worldCount} ${state.board.worldCount === 1 ? 'Welt' : 'Welten'}`;
    } else {
        els.blueprintTitle.textContent = blueprint && blueprint.title ? blueprint.title : 'Keine Spielrunde';
    }
    els.code.textContent = session.code;
    setHidden(els.classicPanel, isBoard);
    setHidden(els.boardPanel, !isBoard);
    setHidden(els.runningHeadline, !running || isBoard);
    setHidden(els.resultsHint, !session.results_enabled || isBoard);
    setHidden(els.startGameBtn, running || isBoard);
    setHidden(els.endGameBtn, !running || victory);
    els.endGameBtn.textContent = isBoard ? 'Spiel unterbrechen' : 'Spiel beenden';
    setHidden(els.showResultsBtn, !running || isBoard);
    setHidden(els.showQrBtn, !isQr);

    // Eine laufende Eingabe im Limit-Feld nicht überschreiben.
    const limitChanged = session.id !== shownSessionId || session.max_teams !== shownLimit;
    if (limitChanged && document.activeElement !== els.limitInput) {
        els.limitInput.value = String(session.max_teams);
        shownSessionId = session.id;
        shownLimit = session.max_teams;
    }

    const audioKeys = isBoard ? renderBoard(state) : renderClassic(state, running);
    readAloud.keepOnly(new Set(audioKeys.filter(Boolean)));

    setHidden(els.submissionsBox, submissions.length === 0);
    mount(els.submissions, submissionCards(submissions));
    qrSheet.sync(currentQrSheet(state));
}

function render() {
    const state = store.state;
    setHidden(els.loading, loaded);
    setHidden(els.active, !loaded || !state.session);
    setHidden(els.none, !loaded || Boolean(state.session));
    if (state.session) {
        renderSession(state);
    } else {
        clear(els.teamList);
        clear(els.submissions);
        qrSheet.close();
        readAloud.stop();
    }
}

const classicBlueprints = () => blueprints.filter((blueprint) => !isKartenset(blueprint));

function fillBlueprintSelect(select, placeholder) {
    const previous = select.value;
    const choices = classicBlueprints();
    mount(select,
        h('option', { value: '' }, placeholder),
        choices.map((blueprint) => h('option', { value: String(blueprint.id) }, blueprintOptionLabel(blueprint))));
    if (choices.some((blueprint) => String(blueprint.id) === previous)) select.value = previous;
}

function renderCreateMode() {
    const isBoard = els.modeBoard.checked;
    setHidden(els.boardSetup, !isBoard);
    setHidden(els.classicSetup, isBoard);
    renderTemplateInfo();
}

function renderTemplateInfo() {
    const blueprint = els.modeClassic.checked ? selectedBlueprint(els.blueprintSelect) : null;
    setHidden(els.templateInfo, !blueprint);
    if (!blueprint) return;
    const count = blueprintTaskCount(blueprint);
    els.templateInfo.textContent = `Diese Spielrunde enthält ${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}.`;
}

async function loadBlueprints() {
    const data = await api.get('/api/blueprints');
    blueprints = data.blueprints;
    boardSetup.setBlueprints(blueprints);
    fillBlueprintSelect(els.blueprintSelect, classicBlueprints().length ? 'Spielrunde wählen...' : 'Noch keine Spielrunde vorhanden');
    fillBlueprintSelect(els.switchSelect, 'Spielrunde wählen...');
    renderTemplateInfo();
}

function historyRow(session) {
    const actionClass = 'hover:underline disabled:opacity-50';
    const reopenBtn = h('button', { type: 'button', class: `text-green-400 ${actionClass}`, onClick: () => runAction(reopenBtn, () => reopenSession(session)) }, 'Fortsetzen');
    const deleteBtn = h('button', { type: 'button', class: `text-red-400 ${actionClass}`, onClick: () => runAction(deleteBtn, () => deleteClosedSession(session)) }, 'Löschen');
    return h('tr', { class: 'border-b border-slate-700' },
        h('td', { class: 'p-4 text-sm whitespace-nowrap' }, formatDate(session.created_at)),
        h('td', { class: 'p-4 font-mono font-bold' }, session.code),
        h('td', { class: 'p-4 text-sm break-words' }, session.blueprint ? session.blueprint.title : ''),
        h('td', { class: 'p-4' }, session.max_teams),
        h('td', { class: 'p-4' }, h('span', { class: 'bg-slate-600 px-2 py-1 rounded text-xs' }, sessionStatusLabel(session.status))),
        h('td', { class: 'p-4' }, h('div', { class: 'flex gap-4' },
            h('button', { type: 'button', class: `text-blue-400 ${actionClass}`, onClick: () => showHistoryDetails(session, reportError) }, 'Details'),
            reopenBtn,
            deleteBtn)));
}

async function loadHistory() {
    const { sessions } = await api.get('/api/sessions/history');
    if (sessions.length === 0) {
        mount(els.history, h('tr', null, h('td', { colspan: 6, class: 'p-4 text-slate-400 italic' }, 'Noch keine beendeten Sessions.')));
        return;
    }
    mount(els.history, sessions.map(historyRow));
}

// --- Aktionen ---------------------------------------------------------------

async function createSession() {
    const limit = parseTeamLimit(els.maxTeams.value);
    if (limit.error) {
        await alert(limit.error, { title: 'Team-Limit', icon: '⚠️' });
        return;
    }
    let body;
    if (els.modeBoard.checked) {
        const setup = boardSetup.collect();
        if (setup.error) {
            await alert(setup.error, { title: 'Brettspiel', icon: '⚠️' });
            return;
        }
        body = { gameMode: 'board', maxTeams: limit.value, board: setup.value };
    } else {
        const blueprint = selectedBlueprint(els.blueprintSelect);
        if (!blueprint) {
            await alert('Bitte wähle eine Spielrunde aus.', { title: 'Fehlende Auswahl', icon: '⚠️' });
            return;
        }
        body = { blueprintId: blueprint.id, maxTeams: limit.value };
    }
    await changingSession(async () => {
        await api.post('/api/sessions', body);
        await sync();
        await loadHistory();
    });
}

async function updateLimit() {
    const limit = parseTeamLimit(els.limitInput.value, store.state.teams.length);
    if (limit.error) {
        await alert(limit.error, { title: 'Team-Limit', icon: '⚠️' });
        return;
    }
    await api.patch('/api/sessions/active/limit', { maxTeams: limit.value });
    els.limitInput.blur();
    await sync();
    showNotice(`Team-Limit ist jetzt ${limit.value}.`);
}

async function closeSession() {
    if (!await confirm('Session wirklich schließen?', { okLabel: 'Schließen', danger: true })) return;
    await changingSession(async () => {
        await api.post('/api/sessions/close');
        await sync();
        await loadHistory();
    });
}

async function startGame() {
    await api.post('/api/sessions/active/start');
    await sync();
}

async function endGame() {
    const paused = isBoardSession(store.state);
    const question = paused
        ? 'Spiel unterbrechen? Der Spielstand bleibt erhalten und die Gruppen warten, bis du es fortsetzt.'
        : 'Spiel beenden? Die Teams warten dann auf einen neuen Start.';
    if (!await confirm(question, { okLabel: paused ? 'Unterbrechen' : 'Spiel beenden', danger: true })) return;
    await api.post('/api/sessions/active/end');
    await sync();
}

async function confirmForceEvaluate() {
    const open = unfinishedGroups(store.state.board).map((group) => `• ${group.name}`);
    const question = `Diese Gruppen sind noch nicht fertig und zählen als nicht richtig:\n${open.join('\n')}`;
    forceDialogOpen = true;
    try {
        return await confirm(question, { title: 'Runde jetzt auswerten?', okLabel: 'Jetzt auswerten' });
    } finally {
        forceDialogOpen = false;
    }
}

/** Eine Aktion auf dem Spielstand. rev ist der Stand, den die Lehrkraft beim Tippen gesehen hat. */
async function runBoardAction(action, rev) {
    if (action.kind === 'start') {
        await runAction(null, startGame);
        return;
    }
    if (action.kind === 'forceEvaluate' && !await confirmForceEvaluate()) return;
    try {
        const ack = await conn.emit('boardAction', { sessionId: store.state.session.id, action: action.kind, rev });
        store.dispatch('boardState', ack.board);
    } catch (err) {
        // Bei STALE_STATE hat sich der Stand schon geändert: still nachziehen, die Lehrkraft entscheidet neu.
        if (err.code !== 'STALE_STATE') await reportError(err);
        syncInBackground();
    }
}

async function confirmMonster(teamId, taskKey) {
    const key = monsterKey(teamId, taskKey);
    if (confirmingMonsters.has(key)) return;
    confirmingMonsters.add(key);
    scheduleRender();
    try {
        await conn.emit('confirmMonster', { sessionId: store.state.session.id, teamId, taskKey });
    } catch (err) {
        await reportError(err);
        syncInBackground();
    } finally {
        confirmingMonsters.delete(key);
        scheduleRender();
    }
}

async function switchBlueprint() {
    const blueprint = selectedBlueprint(els.switchSelect);
    if (!blueprint) {
        await alert('Bitte wähle eine Spielrunde aus.', { title: 'Fehlende Auswahl', icon: '⚠️' });
        return;
    }
    const question = `Zu "${blueprint.title}" wechseln? Alle Teams beginnen dann von vorn.`;
    if (!await confirm(question, { okLabel: 'Wechseln' })) return;
    await api.patch('/api/sessions/active/mode', { blueprintId: blueprint.id });
    els.switchSelect.value = '';
    await sync();
}

async function showResults() {
    const { session } = store.state;
    if (!session) return;
    await conn.emit('showResults', { sessionId: session.id });
    showResultsPanel(store.state);
}

async function deleteTeam(team) {
    const question = `Team "${team.name}" wirklich löschen? Antworten und Fotos des Teams werden mitgelöscht.`;
    if (!await confirm(question, { okLabel: 'Löschen', danger: true })) return;
    await runAction(null, async () => {
        await api.delete(`/api/teams/${team.id}`);
        await sync();
    });
}

async function reopenSession(session) {
    if (!await confirm('Diese Session wieder eröffnen? Eine eventuell aktive Session wird dabei geschlossen.', { okLabel: 'Fortsetzen' })) return;
    await changingSession(async () => {
        await api.post(`/api/sessions/${session.id}/reopen`);
        await sync();
        await loadHistory();
    });
}

async function deleteClosedSession(session) {
    const question = `Session ${session.code} endgültig löschen? Alle Teams, Antworten und Fotos dieser Session werden entfernt. Das kann nicht rückgängig gemacht werden.`;
    if (!await confirm(question, { okLabel: 'Endgültig löschen', danger: true })) return;
    await api.delete(`/api/sessions/${session.id}`);
    await loadHistory();
}

async function logout() {
    loggingOut = true;
    try {
        await api.post('/api/logout');
    } catch (err) {
        loggingOut = false;
        throw err;
    }
    if (conn) conn.disconnect();
    redirectToLogin();
}

function bindForm(form, button, action) {
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        runAction(button, action);
    });
}

function bindButton(button, action) {
    button.addEventListener('click', () => runAction(button, action));
}

function bindEvents() {
    bindForm(els.createForm, els.createBtn, createSession);
    bindForm(els.limitForm, els.limitBtn, updateLimit);
    bindForm(els.switchForm, els.switchBtn, switchBlueprint);
    bindButton(els.closeBtn, closeSession);
    bindButton(els.startGameBtn, startGame);
    bindButton(els.endGameBtn, endGame);
    bindButton(els.showResultsBtn, showResults);
    bindButton(els.logoutBtn, logout);
    els.changePasswordBtn.addEventListener('click', showChangePasswordPanel);
    els.showQrBtn.addEventListener('click', openQrSheet);
    els.blueprintSelect.addEventListener('change', renderTemplateInfo);
    els.modeBoard.addEventListener('change', renderCreateMode);
    els.modeClassic.addEventListener('change', renderCreateMode);
    // Spielrunden können in einem anderen Tab bearbeitet worden sein.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') loadBlueprints().catch(reportSyncError);
    });
}

function openSocket() {
    conn = connectSocket({
        onConnect: () => sync(),
        onStatus: handleSocketStatus,
        onError: reportSyncError
    });
    LIVE_EVENTS.forEach((event) => conn.on(event, (payload) => handleLiveEvent(event, payload)));
    // In einem anderen Tab gestartet oder fortgesetzt; eine fortgesetzte Session verlässt auch den Verlauf.
    conn.on('sessionOpened', () => {
        syncInBackground();
        loadHistory().catch(reportSyncError);
    });
}

async function init() {
    bindEvents();
    renderCreateMode();
    try {
        const me = await api.get('/api/me');
        if (!me.loggedIn) {
            redirectToLogin();
            return;
        }
        els.username.textContent = me.username;
        await loadBlueprints();
        await sync();
        await loadHistory();
        openSocket();
    } catch (err) {
        await reportError(err);
    }
}

init();
