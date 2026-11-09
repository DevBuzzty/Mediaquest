/*
 * main.js: Schüler-Client. Beitritt, Team, Wiederaufnahme, Lobby, Aufgaben, Stationen, Ergebnisse.
 *
 * Ein Zustand S, eine Funktion sync(): Sie leitet aus S die sichtbare Seite ab und startet oder
 * beendet Aufgabe und Kamera. Der Server ist die Quelle der Wahrheit: Nach jedem connect und jedem
 * Spiel-Ereignis wird der Stand per joinSessionRoom neu geladen. Eine laufende Aufgabe bleibt dabei
 * erhalten, solange ihr Key derselbe ist, Eingaben gehen also bei einem Reconnect nicht verloren.
 * Im Brettspiel kommen boardState und boardCard dazu, die Anzeige dazu liegt in board.js.
 */

import { h, mount, clear, setHidden, byId } from '../shared/dom.js';
import { api, ApiError, errorMessage } from '../shared/api.js';
import { connectSocket } from '../shared/socket.js';
import { alert, confirm, dismissAll } from '../shared/ui.js';
import { mountGame } from './games/index.js';
import { createScanner } from './scanner.js';
import { applyPageTheme, renderBoardPanel, renderBoardPhase, worldTheme } from './board.js';
import {
    NETWORK_CODES, RESYNC_CODES, applyBoardState, applyProgress, baseView, blueprintTask, boardDialogKey, computeView, currentTask, fitAnswer,
    forgetTeamProgress, isBoard, isPausedOnCard, isQr, isValidCode, normalizeCode, parseGroupSize, reconcile, sequencePosition, stationRows
} from './flow.js';

const SCREENS = ['loading', 'join', 'rejoin', 'createTeam', 'lobby', 'qr', 'task', 'board', 'finished', 'results', 'ended'];
const BOARD_PAUSED_NOTICE = 'Das Spiel ist unterbrochen. Gleich geht es an derselben Stelle weiter.';
const TOAST_MS = 2500;
const RESYNC_RETRY_MS = 2000;
const MAX_AUTO_RETRIES = 3;
const STATUS_LABELS = {
    completed: 'Geschafft',
    started: 'Begonnen',
    skipped: 'Abgebrochen',
    pending: 'Offen'
};

const S = {
    loading: true,
    entry: 'join',       // join | rejoin | createTeam
    joined: null,        // Antwort von /api/join, solange kein Team besteht
    team: null,          // TeamState
    station: null,       // { key, task }: offene Station
    pending: null,       // { taskKey, status, answer, sending, error }: noch nicht bestätigtes Ergebnis
    showResults: false,
    ended: null,         // { icon, title, text }
    selectedColor: null,
    lobbyNotice: '',
    cameraWanted: false
};

let mounted = null;          // { key, handle }
let startSentFor = null;
let scanRound = null;        // Runde, zu der Fehlertext und Code-Feld des Scanners gehören
let syncSeq = 0;
let stationBusy = false;
let creatingTeam = false;
let toastTimer = null;
let resyncTimer = null;
let conn;

// --- Hilfen ------------------------------------------------------------------

function showError(id, text) {
    const el = byId(id);
    el.textContent = text || '';
    setHidden(el, !text);
}

function toast(text) {
    byId('toastText').textContent = text;
    setHidden(byId('toast'), false);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setHidden(byId('toast'), true), TOAST_MS);
}

function sessionMatches(data) {
    const current = S.team ? S.team.sessionId : (S.joined ? S.joined.sessionId : null);
    return Boolean(data) && data.sessionId === current;
}

function endWith(ended) {
    dismissAll();
    S.ended = ended;
    S.joined = null;
    forgetTeamProgress(S);
    if (conn) conn.disconnect();
    sync();
}

function bindIdentity() {
    // Der Socket liest die Identität beim Aufbau; nach Join oder Rejoin neu verbinden.
    if (conn.connected) conn.reconnect();
    else conn.connect();
}

// --- Ansicht -----------------------------------------------------------------

function renderTeamBar() {
    const team = S.team;
    setHidden(byId('teamBar'), !team);
    if (!team) return;
    byId('teamDot').style.backgroundColor = team.color;
    byId('teamBarName').textContent = team.name;
    byId('teamBarCode').textContent = team.teamCode;
    setHidden(byId('resultsBtn'), !team.resultsEnabled || computeView(S).screen === 'results');
}

function renderColorPicker() {
    const joined = S.joined;
    if (!joined) return;
    const taken = joined.takenColors || [];
    // Während des eigenen Anlegens ist colorPicked die eigene Farbe; Konflikte meldet der Server.
    if (S.selectedColor && taken.includes(S.selectedColor) && !creatingTeam) {
        S.selectedColor = null;
        showError('createTeamError', 'Diese Farbe wurde gerade vergeben. Bitte wähle eine andere.');
    }
    mount(byId('colorPicker'), (joined.colors || []).map((color, index) => {
        const isTaken = taken.includes(color);
        return h('button', {
            type: 'button',
            disabled: isTaken,
            'aria-label': `Farbe ${index + 1}${isTaken ? ', schon vergeben' : ''}`,
            'aria-pressed': S.selectedColor === color,
            class: ['w-full aspect-square rounded-full border-4 transition-all', isTaken ? 'opacity-20 cursor-not-allowed grayscale' : 'cursor-pointer shadow-lg'],
            style: { backgroundColor: color, borderColor: S.selectedColor === color ? 'white' : 'transparent' },
            dataset: { color },
            onClick: () => {
                S.selectedColor = color;
                showError('createTeamError', '');
                renderColorPicker();
            }
        });
    }));
}

function renderCreateTeam() {
    renderColorPicker();
    const notice = byId('createTeamNotice');
    const running = S.joined && S.joined.gameStatus === 'running';
    notice.textContent = running ? 'Das Spiel läuft schon. Sobald euer Team steht, geht es direkt los.' : '';
    setHidden(notice, !running);
}

function renderLobby() {
    const team = S.team;
    mount(byId('teamSummary'),
        h('div', { class: 'flex items-center gap-4 justify-center' },
            h('div', { class: 'w-6 h-6 rounded-full shrink-0', style: { backgroundColor: team.color } }),
            h('span', { class: 'text-xl font-bold break-words min-w-0' }, team.name)),
        h('p', { class: 'text-slate-300 mt-2' }, 'Team-Code: ', h('span', { class: 'text-white font-mono font-bold' }, team.teamCode)),
        h('p', { class: 'text-slate-300' }, `Mitglieder: ${team.groupSize}`));
    const paused = isBoard(team) && team.board && team.board.phase !== 'lobby';
    byId('lobbyNotice').textContent = paused ? BOARD_PAUSED_NOTICE : (S.lobbyNotice || 'Wartet, bis eure Lehrkraft das Spiel startet.');
}

function renderFinished() {
    byId('finishedText').textContent = isQr(S.team) ? 'Ihr habt eure Stationen beendet.' : 'Ihr habt alle Aufgaben dieser Spielrunde gelöst!';
}

function renderStations() {
    const rows = stationRows(S.team);
    const done = rows.filter((row) => row.done).length;
    byId('stationCount').textContent = `${done} von ${rows.length} geschafft`;
    mount(byId('stationList'), rows.map((row) => h('li', {
        class: ['flex items-center gap-3 p-3 rounded-xl border', row.done ? 'bg-green-900/20 border-green-700' : 'bg-slate-700/40 border-slate-600'],
        dataset: { station: row.key, status: row.status }
    },
    h('span', { class: 'shrink-0', 'aria-hidden': true }, row.done ? '✅' : '⬜'),
    h('span', { class: 'flex-1 min-w-0 font-bold text-sm text-slate-200 break-words' }, `${row.number}. ${row.title}`),
    row.resumable
        ? h('button', { type: 'button', class: 'shrink-0 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg', onClick: () => resumeStation(row.key) }, 'Weitermachen')
        : h('span', { class: 'shrink-0 text-xs text-slate-400' }, STATUS_LABELS[row.status] || ''))));
}

/** Scanner-Seite: Stationen im QR-Modus, eine einzelne Karte im Brettspiel. */
function renderScanScreen() {
    const team = S.team;
    const board = isBoard(team);
    byId('qrTitle').textContent = board ? 'Karte scannen' : 'Nächste Station';
    setHidden(byId('qrHint'), !board);
    setHidden(byId('stationSection'), board);
    setHidden(byId('finishStationsBtn'), board);
    if (!board) {
        renderStations();
        return;
    }
    if (team.board.round !== scanRound) {
        // Ein Fehler aus der letzten Runde gilt nicht mehr.
        scanRound = team.board.round;
        showError('qrError', '');
        byId('manualCodeInput').value = '';
    }
    const { finished, total } = team.board.groupProgress;
    byId('qrHint').textContent = `Scannt den QR-Code auf eurer Karte oder gebt den Code ein. ${finished} von ${total} Gruppen fertig.`;
}

function renderBoardViews(screen) {
    const team = S.team;
    const board = isBoard(team) && team.board ? team.board : null;
    const themed = board && (screen === 'board' || screen === 'qr' || screen === 'task');
    applyPageTheme(themed ? worldTheme(board.worldKey) : null, screen === 'board');
    const showPanel = themed && screen !== 'task';
    setHidden(byId('boardPanel'), !showPanel);
    if (showPanel) renderBoardPanel(byId('boardPanel'), team);
    if (themed && screen === 'board') renderBoardPhase(byId('boardPhase'), team);
}

function headerButton(label, onClick) {
    return h('button', {
        type: 'button',
        class: 'min-h-[2.75rem] px-2 text-xs font-black text-slate-400 uppercase hover:text-white transition-colors',
        onClick
    }, label);
}

function headerTag(text) {
    return h('div', { class: 'bg-blue-600/20 text-blue-300 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-500/30' }, text);
}

function renderTaskHeader() {
    const team = S.team;
    if (isBoard(team)) {
        mount(byId('taskHeader'), h('div', { class: 'flex justify-between items-center gap-3' },
            headerTag('Eure Karte'),
            headerButton('Überspringen', skipBoardCard)));
        return;
    }
    if (isQr(team)) {
        const row = stationRows(team).find((candidate) => S.station && candidate.key === S.station.key);
        const monster = Boolean(S.station) && S.station.task.type === 'monster';
        mount(byId('taskHeader'), h('div', { class: 'flex justify-between items-center gap-3' },
            headerTag(row ? `Station ${row.number}` : 'Station'),
            monster ? null : headerButton('Abbrechen', cancelStation)));
        return;
    }
    const position = sequencePosition(team);
    mount(byId('taskHeader'), h('div', { class: 'space-y-1' },
        h('div', { class: 'flex justify-between text-[10px] font-black text-slate-400 uppercase' },
            h('span', null, `Aufgabe ${position.number} von ${position.total}`),
            h('span', null, `${position.percent}%`)),
        h('div', { class: 'w-full h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700' },
            h('div', { class: 'h-full bg-blue-500 transition-all duration-500', style: { width: `${position.percent}%` } }))));
}

function renderTaskStatus() {
    const box = byId('taskStatus');
    const pending = S.pending;
    if (!pending) {
        clear(box);
        setHidden(box, true);
        return;
    }
    setHidden(box, false);
    if (!pending.error) {
        mount(box, h('p', { class: 'text-sm font-bold text-slate-300' }, 'Wird gespeichert...'));
        return;
    }
    mount(box,
        h('p', { class: 'text-sm font-bold text-red-400', role: 'alert' }, pending.error.message),
        h('button', {
            type: 'button',
            class: 'w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl',
            onClick: () => sendPending()
        }, 'Erneut senden'),
        pending.error.canSkip && pending.status !== 'skipped' ? h('button', {
            type: 'button',
            class: 'w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl',
            onClick: () => {
                S.pending = { taskKey: pending.taskKey, status: 'skipped', attempts: 0 };
                sendPending();
            }
        }, 'Überspringen') : null);
}

function renderEnded() {
    byId('endedIcon').textContent = S.ended.icon;
    byId('endedTitle').textContent = S.ended.title;
    byId('endedText').textContent = S.ended.text;
}

function unmountGame() {
    if (!mounted) return;
    mounted.handle.cleanup();
    mounted = null;
    startSentFor = null;
}

function mountCurrent(task) {
    const key = task.key;
    const handle = mountGame(byId('taskMount'), task, {
        onComplete: ({ status, answer }) => {
            if (!mounted || mounted.key !== key) return;
            S.pending = { taskKey: key, status, answer, attempts: 0 };
            sendPending();
        },
        uploadPhoto: (blob) => api.uploadImage(blob, { purpose: 'submission', filename: 'foto.jpg' }),
        submit: (type, content) => conn.emit('studentSubmission', { taskKey: key, type, content }),
        neutralFeedback: isBoard(S.team)
    });
    mounted = { key, handle };
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    reportStart();
}

function syncGame() {
    // Bei geöffneten Ergebnissen bleibt die laufende Aufgabe im Hintergrund erhalten.
    const desired = baseView(S).screen === 'task' ? currentTask(S) : null;
    if (mounted && !desired && isPausedOnCard(S.team, mounted.key)) {
        // Unterbrechung: Halb Getipptes bleibt, nur das Vorlesen endet.
        mounted.handle.stopReading();
        return;
    }
    if (mounted && (!desired || desired.key !== mounted.key)) unmountGame();
    if (desired && !mounted) mountCurrent(desired);
}

function syncCamera(screen) {
    const wanted = screen === 'qr';
    if (wanted === S.cameraWanted) return;
    S.cameraWanted = wanted;
    if (wanted) {
        setHidden(byId('cameraStatus'), true);
        scanner.start();
    } else {
        scanner.stop();
    }
}

function sync() {
    const { screen } = computeView(S);
    SCREENS.forEach((name) => setHidden(byId(`screen-${name}`), name !== screen));
    renderTeamBar();
    syncGame();
    syncCamera(screen);
    renderBoardViews(screen);
    if (screen === 'createTeam') renderCreateTeam();
    else if (screen === 'lobby') renderLobby();
    else if (screen === 'finished') renderFinished();
    else if (screen === 'qr') renderScanScreen();
    else if (screen === 'ended') renderEnded();
    else if (screen === 'task') {
        renderTaskHeader();
        renderTaskStatus();
    }
}

// --- Server-Stand ------------------------------------------------------------

/** Führt eine Änderung am Brettspiel-Stand aus und schließt Dialoge, die dadurch hinfällig sind. */
function changeBoard(change) {
    const before = boardDialogKey(S.team);
    change();
    if (before !== null && boardDialogKey(S.team) !== before) dismissAll();
}

function applyTeamState(state) {
    changeBoard(() => {
        S.team = state;
        S.joined = null;
        S.entry = 'join';
        S.loading = false;
        showError('createTeamError', '');
        if (state.phase !== 'lobby') S.lobbyNotice = '';
        reconcile(S);
    });
    sync();
}

function applyJoined(joined) {
    forgetTeamProgress(S);
    showError('createTeamError', '');
    S.joined = {
        sessionId: joined.sessionId,
        maxTeams: joined.maxTeams,
        gameStatus: joined.gameStatus,
        takenColors: joined.takenColors || [],
        colors: joined.colors || (S.joined ? S.joined.colors : [])
    };
    // Wer gerade seinen Team-Code eintippt, wird nicht aus dem Formular geholt.
    if (S.entry !== 'rejoin') S.entry = 'createTeam';
    S.loading = false;
    sync();
}

/** Der Server hat den Raum abgelehnt: Team gelöscht oder Session vorbei, während das Gerät weg war. */
async function recoverIdentity(err) {
    if (err && NETWORK_CODES.has(err.code)) return;
    let me;
    try {
        me = await api.get('/api/team/me');
    } catch (requestError) {
        console.warn(requestError);
        return;
    }
    const hadTeam = Boolean(S.team);
    if (me.role === 'team') {
        applyTeamState(me);
        scheduleResync();
    } else if (me.role === 'joined') {
        unmountGame();
        applyJoined(me);
        scheduleResync();
        if (hadTeam) await alert('Euer Team gibt es nicht mehr. Ihr könnt ein neues Team erstellen.', { title: 'Team entfernt', icon: '🚪' });
    } else if (hadTeam || S.joined) {
        endWith({ icon: '🚪', title: 'Session beendet', text: 'Diese Session ist nicht mehr aktiv.' });
    }
}

async function resync() {
    const seq = ++syncSeq;
    if (!conn.connected) return;
    try {
        if (S.team) {
            const ack = await conn.emit('joinSessionRoom', { sessionId: S.team.sessionId, as: 'team' });
            if (seq !== syncSeq) return;
            applyTeamState(ack.state);
            if (S.pending && !S.pending.sending) sendPending();
            reportStart();
        } else if (S.joined) {
            const ack = await conn.emit('joinLobby');
            if (seq !== syncSeq) return;
            S.joined = { ...S.joined, ...ack.state };
            sync();
        }
    } catch (err) {
        if (seq !== syncSeq) return;
        // Ohne Ack ist unklar, ob der Socket im Raum ist; ein neues connect kommt dann nicht von selbst.
        if (err.code === 'TIMEOUT') scheduleResync();
        else await recoverIdentity(err);
    }
}

function scheduleResync() {
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
        resyncTimer = null;
        resync();
    }, RESYNC_RETRY_MS);
}

async function reportStart() {
    // Im Brettspiel gilt eine Karte mit boardOpenCard als begonnen.
    if (isBoard(S.team)) return;
    if (!mounted || startSentFor === mounted.key || !conn || !conn.connected) return;
    const key = mounted.key;
    startSentFor = key;
    try {
        await conn.emit('reportTaskStart', { taskKey: key });
    } catch (err) {
        if (startSentFor === key) startSentFor = null;
        if (RESYNC_CODES.has(err.code)) resync();
    }
}

async function sendPending() {
    const pending = S.pending;
    if (!pending || pending.sending) return;
    pending.sending = true;
    pending.error = null;
    renderTaskStatus();

    const board = isBoard(S.team);
    try {
        const ack = await conn.emit(board ? 'boardSubmitCard' : 'reportTaskResult', {
            taskKey: pending.taskKey,
            status: pending.status,
            answer: fitAnswer(pending.answer)
        });
        if (S.pending !== pending) return;
        S.pending = null;
        if (board) {
            S.team.card = ack.card;
            reconcile(S);
            sync();
            return;
        }
        const wasStation = S.station && S.station.key === pending.taskKey;
        if (wasStation) leaveStation();
        applyProgress(S, ack.progress);
        if (wasStation) toast(pending.status === 'completed' ? 'Station abgeschlossen!' : 'Station abgebrochen.');
        else if (pending.status === 'completed') toast('Antwort gespeichert');
        sync();
    } catch (err) {
        pending.sending = false;
        if (S.pending !== pending) return;
        // Paket ging bei einem Verbindungsabbruch verloren: Der Server verarbeitet Wiederholungen idempotent.
        if (NETWORK_CODES.has(err.code) && conn.connected && pending.attempts < MAX_AUTO_RETRIES) {
            pending.attempts += 1;
            sendPending();
            return;
        }
        if (RESYNC_CODES.has(err.code)) {
            // Die Aufgabe gehört nicht mehr zum Stand des Servers: frisch aufbauen.
            S.pending = null;
            unmountGame();
            sync();
            resync();
            return;
        }
        const offline = NETWORK_CODES.has(err.code);
        pending.error = {
            message: offline ? 'Keine Verbindung. Eure Antwort wird gesendet, sobald ihr wieder online seid.' : errorMessage(err),
            canSkip: !offline
        };
        renderTaskStatus();
    }
}

// --- Stationen ---------------------------------------------------------------

// Welcher Code hat welche Station geöffnet? Der Server schickt den Code nicht mit.
const stationCodes = new Map();

const scanner = createScanner({
    elementId: 'qr-reader',
    onCode: (text) => openStation(text),
    onStatus: (status, message) => {
        setHidden(byId('cameraStatus'), status !== 'failed');
        // Ohne Kamera wäre das Bild nur eine schwarze Fläche vor dem Code-Feld.
        setHidden(byId('qr-reader'), status === 'failed');
        byId('cameraStatusText').textContent = message || '';
    }
});

/** Die Station ist zu Ende. Liegt ihr Code noch vor der Kamera, darf er sie nicht gleich wieder öffnen. */
function leaveStation() {
    const code = S.station ? stationCodes.get(S.station.key) : undefined;
    if (code) scanner.hold(code);
    S.station = null;
}

/** Scanner und Code-Feld: öffnet je nach Spielart eine Station oder die Karte der Runde. */
async function openStation(rawCode) {
    const code = String(rawCode || '').trim();
    if (!code) {
        showError('qrError', 'Bitte gib einen Code ein.');
        return;
    }
    if (stationBusy || S.station) return;
    stationBusy = true;
    byId('manualCodeBtn').disabled = true;
    showError('qrError', '');
    try {
        if (isBoard(S.team)) {
            const ack = await conn.emit('boardOpenCard', { code });
            S.team.card = ack.card;
        } else {
            const ack = await conn.emit('openStation', { code });
            applyProgress(S, ack.progress);
            S.station = { key: ack.taskKey, task: ack.task };
            stationCodes.set(ack.taskKey, code);
        }
        byId('manualCodeInput').value = '';
        reconcile(S);
        sync();
    } catch (err) {
        // Ein abgelehnter Code bleibt abgelehnt, solange er im Bild liegt. Ohne Netz darf die Kamera es wieder versuchen.
        if (!NETWORK_CODES.has(err.code)) scanner.hold(code);
        if (RESYNC_CODES.has(err.code)) resync();
        else showError('qrError', err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
        stationBusy = false;
        byId('manualCodeBtn').disabled = false;
    }
}

/** Nur Stationen, die das Team schon gescannt hat, lassen sich ohne Code fortsetzen. */
function resumeStation(key) {
    const task = blueprintTask(S.team, key);
    if (!task || S.station) return;
    S.station = { key, task };
    sync();
}

function cancelStation() {
    if (!S.station || S.pending || !mounted) return;
    mounted.handle.lock();
    S.pending = { taskKey: S.station.key, status: 'skipped', attempts: 0 };
    sendPending();
}

async function skipBoardCard() {
    if (S.pending || !mounted) return;
    const key = mounted.key;
    const sure = await confirm('Die Karte zählt dann in dieser Runde als nicht richtig.', { title: 'Karte überspringen?', okLabel: 'Überspringen', danger: true });
    if (!sure || S.pending || !mounted || mounted.key !== key) return;
    mounted.handle.lock();
    S.pending = { taskKey: key, status: 'skipped', attempts: 0 };
    sendPending();
}

async function finishStations() {
    const rows = stationRows(S.team);
    const open = rows.filter((row) => !row.done).length;
    const text = open > 0
        ? `${open} ${open === 1 ? 'Station ist' : 'Stationen sind'} noch offen. Danach könnt ihr keine Station mehr spielen.`
        : 'Danach könnt ihr keine Station mehr spielen.';
    if (!await confirm(text, { title: 'Stationen beenden?', okLabel: 'Beenden', danger: true })) return;
    try {
        const ack = await conn.emit('finishStations');
        applyProgress(S, ack.progress);
        sync();
    } catch (err) {
        if (RESYNC_CODES.has(err.code)) resync();
        else await alert(errorMessage(err), { title: 'Fehler', icon: '⚠️' });
    }
}

// --- Ergebnisse --------------------------------------------------------------

function resultCard(submission) {
    const safePhoto = submission.type === 'photo' && typeof submission.content === 'string' && submission.content.startsWith('/uploads/');
    return h('div', {
        class: 'bg-slate-800 p-5 rounded-[2rem] border-l-8 border-slate-600 text-left shadow-2xl',
        style: { borderLeftColor: submission.team_color }
    },
    h('div', { class: 'flex justify-between items-center gap-3 mb-3' },
        h('p', { class: 'text-[10px] font-black text-slate-400 uppercase tracking-widest break-words min-w-0' }, submission.team_name),
        h('span', { class: 'text-[10px] bg-slate-900 px-2 py-0.5 rounded-full text-slate-400 shrink-0' }, submission.type === 'photo' ? 'Foto' : 'Freitext')),
    safePhoto
        ? h('img', { src: submission.content, alt: `Foto von ${submission.team_name}`, class: 'w-full h-48 object-cover rounded-2xl' })
        : h('p', { class: 'text-lg font-bold text-slate-200 italic leading-snug break-words' }, `„${submission.content}“`));
}

async function loadResults() {
    const list = byId('resultsList');
    mount(list, h('p', { class: 'text-slate-400 text-center' }, 'Lade Ergebnisse...'));
    try {
        const { submissions } = await api.get(`/api/sessions/${S.team.sessionId}/results`);
        if (submissions.length === 0) {
            mount(list, h('p', { class: 'text-slate-400 italic text-center' }, 'Noch keine Einsendungen vorhanden.'));
            return;
        }
        mount(list, submissions.map(resultCard));
    } catch (err) {
        mount(list,
            h('p', { class: 'text-red-400 font-bold text-center', role: 'alert' }, errorMessage(err)),
            h('button', { type: 'button', class: 'w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl', onClick: loadResults }, 'Erneut versuchen'));
    }
}

function openResults() {
    if (!S.team) return;
    S.showResults = true;
    sync();
    loadResults();
}

// --- Socket-Ereignisse -------------------------------------------------------

function onGameChanged(data, { closeResults, notice, message }) {
    if (!sessionMatches(data)) return;
    if (S.joined && !S.team) {
        S.joined.gameStatus = data.gameStatus || S.joined.gameStatus;
        sync();
        return;
    }
    if (!S.team) return;
    dismissAll();
    if (closeResults) S.showResults = false;
    S.lobbyNotice = notice || '';
    if (message) toast(message);
    resync();
}

function registerSocketEvents() {
    conn.on('gameStarted', (data) => onGameChanged(data, { closeResults: true }));
    conn.on('gameModeUpdated', (data) => onGameChanged(data, { closeResults: true, message: 'Neue Spielrunde!' }));
    conn.on('gameEnded', (data) => {
        if (S.joined && sessionMatches(data)) S.joined.gameStatus = 'waiting';
        onGameChanged(data, { notice: 'Das Spiel wurde von der Lehrkraft beendet. Wartet auf einen neuen Start.' });
    });
    conn.on('sessionClosed', (data) => {
        if (!sessionMatches(data)) return;
        endWith({ icon: '🚪', title: 'Session beendet', text: 'Die Session wurde von der Lehrkraft geschlossen.' });
    });
    conn.on('teamDeleted', (data) => {
        if (!S.team || !data || data.teamId !== S.team.teamId) return;
        endWith({ icon: '🚪', title: 'Team entfernt', text: 'Euer Team wurde von der Lehrkraft entfernt.' });
    });
    conn.on('displayResults', (data) => {
        if (!S.team || !sessionMatches(data)) return;
        S.team.resultsEnabled = true;
        const screen = computeView(S).screen;
        if (screen === 'results') loadResults();
        else if (screen === 'lobby' || screen === 'finished') openResults();
        else {
            // Mitten in einer Aufgabe wird nichts weggenommen.
            toast('Die Ergebnisse sind da. Ihr findet sie oben unter „Ergebnisse“.');
            renderTeamBar();
        }
    });
    conn.on('boardState', (board) => {
        if (!S.team || !sessionMatches(board)) return;
        changeBoard(() => applyBoardState(S, board));
        sync();
    });
    conn.on('boardCard', (data) => {
        if (!S.team || !sessionMatches(data)) return;
        changeBoard(() => {
            S.team.card = data.card;
            reconcile(S);
        });
        sync();
    });
    conn.on('monsterConfirmed', (data) => {
        if (!S.team || !sessionMatches(data)) return;
        if (S.station && S.station.key === data.taskKey) leaveStation();
        applyProgress(S, data.progress);
        toast('Weiter geht es!');
        sync();
    });
    conn.on('colorPicked', (data) => {
        if (!S.joined || !sessionMatches(data) || S.joined.takenColors.includes(data.color)) return;
        S.joined.takenColors = [...S.joined.takenColors, data.color];
        sync();
    });
    conn.on('colorFreed', (data) => {
        if (!S.joined || !sessionMatches(data)) return;
        S.joined.takenColors = S.joined.takenColors.filter((color) => color !== data.color);
        sync();
    });
    conn.on('teamLimitUpdated', (data) => {
        if (S.joined && sessionMatches(data)) S.joined.maxTeams = data.maxTeams;
    });
}

function onConnectionStatus(status) {
    const banner = byId('connBanner');
    const lost = status === 'reconnecting' || status === 'disconnected';
    const relevant = Boolean(S.team || S.joined);
    setHidden(banner, !(lost && relevant));
    byId('connBannerText').textContent = status === 'disconnected' ? 'Die Verbindung wurde getrennt.' : 'Verbindung unterbrochen. Wird wiederhergestellt...';
    setHidden(byId('connRetryBtn'), status !== 'disconnected');
}

// --- Formulare ---------------------------------------------------------------

async function withBusyButton(buttonId, action) {
    const button = byId(buttonId);
    if (button.disabled) return;
    button.disabled = true;
    try {
        await action();
    } finally {
        button.disabled = false;
    }
}

function bindForms() {
    const showRejoin = () => {
        S.entry = 'rejoin';
        sync();
    };
    byId('showRejoinBtn').addEventListener('click', showRejoin);
    byId('createTeamRejoinBtn').addEventListener('click', showRejoin);
    byId('showJoinBtn').addEventListener('click', () => {
        S.entry = S.joined ? 'createTeam' : 'join';
        sync();
    });
    byId('createTeamBackBtn').addEventListener('click', () => {
        S.joined = null;
        S.selectedColor = null;
        S.entry = 'join';
        showError('createTeamError', '');
        sync();
    });

    byId('joinForm').addEventListener('submit', (event) => {
        event.preventDefault();
        withBusyButton('joinBtn', async () => {
            const code = normalizeCode(byId('sessionCodeInput').value);
            if (!isValidCode(code)) {
                showError('joinError', 'Bitte gib einen gültigen Session-Code ein.');
                return;
            }
            showError('joinError', '');
            try {
                const data = await api.post('/api/join', { code });
                if (data.team) applyTeamState(data.team);
                else applyJoined(data);
                bindIdentity();
            } catch (err) {
                showError('joinError', errorMessage(err));
            }
        });
    });

    byId('rejoinForm').addEventListener('submit', (event) => {
        event.preventDefault();
        withBusyButton('rejoinBtn', async () => {
            const teamCode = normalizeCode(byId('teamCodeInput').value);
            if (!isValidCode(teamCode)) {
                showError('rejoinError', 'Bitte gib einen gültigen Team-Code ein.');
                return;
            }
            showError('rejoinError', '');
            try {
                applyTeamState(await api.post('/api/rejoin', { teamCode }));
                bindIdentity();
            } catch (err) {
                showError('rejoinError', errorMessage(err));
            }
        });
    });

    byId('createTeamForm').addEventListener('submit', (event) => {
        event.preventDefault();
        withBusyButton('createTeamBtn', createTeam);
    });

    byId('manualCodeForm').addEventListener('submit', (event) => {
        event.preventDefault();
        openStation(byId('manualCodeInput').value);
    });

    byId('finishStationsBtn').addEventListener('click', finishStations);
    byId('cameraRetryBtn').addEventListener('click', async () => {
        setHidden(byId('cameraStatus'), true);
        await scanner.stop();
        if (S.cameraWanted) scanner.start();
    });
    byId('resultsBtn').addEventListener('click', openResults);
    byId('resultsBackBtn').addEventListener('click', () => {
        S.showResults = false;
        sync();
    });
    byId('restartBtn').addEventListener('click', () => window.location.assign('/student.html'));
    byId('connRetryBtn').addEventListener('click', () => conn.connect());
}

async function createTeam() {
    const name = byId('teamNameInput').value.trim();
    const groupSize = parseGroupSize(byId('groupSizeInput').value);
    if (!name || !S.selectedColor) {
        showError('createTeamError', 'Bitte Name und Farbe wählen!');
        return;
    }
    if (groupSize === null) {
        showError('createTeamError', 'Die Gruppengröße muss zwischen 1 und 10 liegen.');
        return;
    }
    showError('createTeamError', '');
    creatingTeam = true;
    try {
        const state = await api.post('/api/teams', { name, color: S.selectedColor, groupSize });
        S.selectedColor = null;
        applyTeamState(state);
        // Selbe Session-ID: kein neuer Socket nötig, nur der Raum wechselt.
        if (conn.connected) resync();
        else conn.connect();
    } catch (err) {
        await handleCreateTeamError(err);
    } finally {
        creatingTeam = false;
    }
}

async function handleCreateTeamError(err) {
    if (err.code === 'ALREADY_IN_TEAM') {
        await recoverIdentity(err);
        return;
    }
    if (err.status === 403) {
        S.joined = null;
        S.entry = 'join';
        sync();
        showError('joinError', errorMessage(err));
        return;
    }
    if (err.code === 'COLOR_TAKEN' && S.joined && S.selectedColor) {
        S.joined.takenColors = [...new Set([...S.joined.takenColors, S.selectedColor])];
        S.selectedColor = null;
        renderColorPicker();
    }
    showError('createTeamError', errorMessage(err));
}

// --- Start -------------------------------------------------------------------

async function boot() {
    bindForms();
    conn = connectSocket({
        autoConnect: false,
        onConnect: () => resync(),
        onStatus: onConnectionStatus,
        onError: (err) => console.warn(err)
    });
    registerSocketEvents();

    // Wiederherstellung nach einem Neuladen aus dem Session-Cookie.
    try {
        const me = await api.get('/api/team/me');
        if (me.role === 'team') applyTeamState(me);
        else if (me.role === 'joined') applyJoined(me);
        else {
            S.loading = false;
            sync();
        }
        if (me.role !== 'none') conn.connect();
    } catch (err) {
        S.loading = false;
        sync();
        showError('joinError', errorMessage(err));
    }
}

boot().catch((err) => {
    console.error(err);
    const screen = document.getElementById('screen-loading');
    if (screen) screen.textContent = 'Die Seite konnte nicht gestartet werden. Bitte lade sie neu.';
});
