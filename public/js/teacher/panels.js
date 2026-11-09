/*
 * panels.js: Überlagerte Fenster (Details, Ergebnisse, Passwort). Jedes Fenster ist ein eigenes
 * DOM-Element und wird beim Schließen entfernt, es gibt keinen geteilten Zustand.
 */
import { api, errorMessage } from '../shared/api.js';
import { h, mount, setHidden } from '../shared/dom.js';
import { alert } from '../shared/ui.js';
import { answersList, submissionCard } from './components.js';
import { historyCardView, historySummary } from './board-format.js';
import { passwordChangeError, teamView } from './format.js';

let closeCurrent = null;

/** Öffnet ein Fenster. Ein bereits offenes wird geschlossen. */
export function openPanel(title, ...content) {
    if (closeCurrent) closeCurrent();
    const focusBefore = document.activeElement;
    const titleEl = h('h3', { class: 'text-2xl font-bold break-words min-w-0' }, title);
    const body = h('div', { class: 'space-y-4' }, content);
    const closeButton = h('button', {
        type: 'button',
        class: 'bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded shrink-0',
        onClick: close
    }, 'Schließen');
    const overlay = h('div', {
        class: 'fixed inset-0 bg-black/75 flex items-start justify-center overflow-y-auto z-50 p-4',
        onClick: (event) => { if (event.target === overlay) close(); }
    }, h('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-label': title,
        class: 'bg-slate-800 p-6 md:p-8 rounded-2xl border border-slate-700 max-w-3xl w-full my-8'
    },
    h('div', { class: 'flex justify-between items-start gap-4 mb-6' }, titleEl, closeButton),
    body));

    function onKeyDown(event) {
        if (event.key === 'Escape') close();
    }

    function close() {
        if (closeCurrent !== close) return;
        closeCurrent = null;
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        if (focusBefore && focusBefore.isConnected && typeof focusBefore.focus === 'function') focusBefore.focus();
    }

    closeCurrent = close;
    document.addEventListener('keydown', onKeyDown);
    document.body.append(overlay);
    closeButton.focus();
    return { close, body };
}

const placeholder = (text) => h('p', { class: 'text-slate-400' }, text);

function teamResultCard(team, blueprint) {
    const view = teamView(team, blueprint, false);
    return h('section', {
        class: 'p-3 bg-slate-700 rounded-lg border-l-4 space-y-2 min-w-0',
        style: { borderLeftColor: view.color }
    },
    h('h4', { class: 'font-bold break-words' }, view.name),
    h('p', { class: 'text-xs text-slate-400' },
        `Team-Code: ${view.teamCode} | Größe: ${view.groupSize} | ${view.progressText}${view.finished ? ' | Fertig' : ''}`),
    answersList(view));
}

function resultsContent(teams, submissions, blueprint) {
    return [
        h('h4', { class: 'text-lg font-bold' }, 'Antworten der Teams'),
        teams.length === 0
            ? placeholder('Keine Teams gefunden.')
            : h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, teams.map((team) => teamResultCard(team, blueprint))),
        h('h4', { class: 'text-lg font-bold' }, 'Einsendungen'),
        submissions.length === 0
            ? placeholder('Keine Einsendungen vorhanden.')
            : h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [...submissions].reverse().map(submissionCard))
    ];
}

function historyCard(card) {
    const view = historyCardView(card);
    return h('article', {
        class: 'p-3 bg-slate-700 rounded-lg border-l-4 space-y-2 min-w-0',
        style: { borderLeftColor: card.teamColor }
    },
    h('div', { class: 'flex flex-wrap items-center justify-between gap-2' },
        h('h6', { class: 'font-bold break-words min-w-0' }, card.teamName),
        h('span', {
            class: ['px-2 py-0.5 rounded-full text-xs font-black uppercase text-white', view.verdict ? (view.correct ? 'bg-green-700' : 'bg-red-700') : 'bg-slate-600']
        }, view.verdict || view.statusText)),
    h('p', { class: 'text-sm font-bold text-slate-200 break-words' }, card.title,
        h('span', { class: 'ml-2 font-mono text-xs text-blue-300' }, card.code)),
    view.note ? h('p', { class: 'text-xs text-amber-300' }, view.note) : null,
    view.image
        ? h('a', { href: view.image, target: '_blank', rel: 'noopener' },
            h('img', { src: view.image, alt: `Foto von ${card.teamName}`, loading: 'lazy', class: 'w-full h-32 object-cover rounded' }))
        : null,
    view.lines.map((line) => h('p', { class: 'text-sm text-slate-300 break-words whitespace-pre-line' }, line)));
}

function historyRound(entry) {
    const right = entry.cards.filter((card) => card.correct === true).length;
    return h('section', { class: 'space-y-2', dataset: { historyRound: entry.round } },
        h('h5', { class: 'font-bold break-words' }, `Runde ${entry.round}: ${entry.worldName}`),
        h('p', { class: 'text-sm text-slate-300' }, `${right} von ${entry.cards.length} ${entry.cards.length === 1 ? 'Karte' : 'Karten'} richtig`),
        h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-3' }, entry.cards.map(historyCard)));
}

/** Details einer Brett-Session: Spielende und alle Karten je Runde. */
function boardHistoryContent({ board, rounds }, submissions) {
    return [
        h('div', { class: 'bg-slate-700 rounded-lg p-4 space-y-1', dataset: { boardHistory: board.phase } },
            historySummary(board).map((line) => h('p', { class: 'break-words' }, line))),
        h('h4', { class: 'text-lg font-bold' }, 'Runden'),
        rounds.length === 0 ? placeholder('In dieser Session wurde keine Karte gespielt.') : h('div', { class: 'space-y-5' }, rounds.map(historyRound)),
        h('h4', { class: 'text-lg font-bold' }, 'Einsendungen'),
        submissions.length === 0
            ? placeholder('Keine Einsendungen vorhanden.')
            : h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [...submissions].reverse().map(submissionCard))
    ];
}

/** Abschluss-Ergebnisse der aktiven Session aus dem aktuellen Stand. */
export function showResultsPanel({ teams, submissions, session }) {
    openPanel('Abschluss-Ergebnisse (alle Teams)', resultsContent(teams, submissions, session.blueprint));
}

/** Details einer beendeten Session, frisch vom Server. */
export async function showHistoryDetails(session, onError) {
    const panel = openPanel(`Session ${session.code}`, placeholder('Lade Details...'));
    try {
        if (session.game_mode === 'board') {
            const [history, { submissions }] = await Promise.all([
                api.get(`/api/sessions/${session.id}/board-history`),
                api.get(`/api/sessions/${session.id}/submissions`)
            ]);
            mount(panel.body, boardHistoryContent(history, submissions));
            return;
        }
        const [{ teams }, { submissions }] = await Promise.all([
            api.get(`/api/sessions/${session.id}/teams`),
            api.get(`/api/sessions/${session.id}/submissions`)
        ]);
        mount(panel.body, resultsContent(teams, submissions, session.blueprint));
    } catch (err) {
        panel.close();
        await onError(err);
    }
}

function passwordField(id, label, autocomplete) {
    const input = h('input', {
        id,
        type: 'password',
        required: true,
        autocomplete,
        class: 'w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white'
    });
    return {
        input,
        row: h('div', null, h('label', { for: id, class: 'block text-sm font-medium text-slate-400 mb-1' }, label), input)
    };
}

/** Formular "Passwort ändern". */
export function showChangePasswordPanel() {
    const current = passwordField('currentPassword', 'Aktuelles Passwort oder Login-Code', 'current-password');
    const next = passwordField('newPassword', 'Neues Passwort (mindestens 8 Zeichen)', 'new-password');
    const repeat = passwordField('repeatPassword', 'Neues Passwort wiederholen', 'new-password');
    const errorBox = h('div', { role: 'alert', class: 'text-red-400 text-sm hidden' });
    const submit = h('button', {
        type: 'submit',
        class: 'w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg transition-colors'
    }, 'Passwort speichern');

    function showError(text) {
        errorBox.textContent = text;
        setHidden(errorBox, false);
    }

    const form = h('form', {
        class: 'space-y-4',
        onSubmit: async (event) => {
            event.preventDefault();
            if (submit.disabled) return;
            setHidden(errorBox, true);
            const values = { current: current.input.value, next: next.input.value, repeat: repeat.input.value };
            const problem = passwordChangeError(values);
            if (problem) {
                showError(problem);
                return;
            }
            submit.disabled = true;
            try {
                await api.post('/api/change-password', { currentPassword: values.current, newPassword: values.next });
                panel.close();
                await alert('Dein Passwort wurde geändert. Andere Anmeldungen wurden beendet.', { title: 'Gespeichert', icon: '✅' });
            } catch (err) {
                if (err.status === 401) {
                    window.location.href = '/login.html';
                    return;
                }
                showError(errorMessage(err));
                submit.disabled = false;
            }
        }
    }, current.row, next.row, repeat.row, errorBox, submit);

    const panel = openPanel('Passwort ändern', form);
    current.input.focus();
}
