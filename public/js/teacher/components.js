/*
 * components.js: DOM-Bausteine des Dashboards. Nutzerdaten gehen nur als Textknoten über h().
 */
import { h } from '../shared/dom.js';
import { formatDate, safeUploadUrl, teamView } from './format.js';

const TaskTypes = globalThis.TaskTypes;

const STEP_CLASSES = {
    pending: 'bg-slate-800 text-slate-500 border-slate-600',
    started: 'bg-blue-700 text-white border-blue-400',
    completed: 'bg-green-700 text-white border-green-400',
    skipped: 'bg-amber-700 text-white border-amber-400'
};

const SUBMISSION_LABELS = { photo: 'Foto', statement: 'Statement' };

function answerEntry(answer) {
    return h('li', { class: 'bg-slate-800 rounded-lg p-3 space-y-1' },
        h('div', { class: 'flex justify-between gap-2 items-start' },
            h('span', { class: 'text-xs font-bold text-slate-200 break-words min-w-0' }, `${answer.typeIcon} ${answer.title}`),
            h('span', { class: 'text-[10px] uppercase font-black text-slate-400 shrink-0' }, answer.status)),
        answer.image
            ? h('a', { href: answer.image, target: '_blank', rel: 'noopener' },
                h('img', { src: answer.image, alt: 'Foto des Teams', loading: 'lazy', class: 'w-full h-32 object-cover rounded' }))
            : null,
        answer.lines.map((line) => h('p', { class: 'text-sm text-slate-300 break-words whitespace-pre-line' }, line)));
}

/** Liste aller begonnenen Aufgaben eines Teams mit dem, was es geantwortet hat. */
export function answersList(view) {
    if (view.answers.length === 0) return h('p', { class: 'text-xs text-slate-400 italic' }, 'Noch keine Antworten.');
    return h('ul', { class: 'space-y-2' }, view.answers.map(answerEntry));
}

function statusBlock(view) {
    if (view.status.kind === 'finished') {
        return h('p', { class: 'text-sm font-bold text-green-400' }, `✓ ${view.status.heading}: ${view.status.detail}`);
    }
    if (view.status.kind === 'active') {
        return h('div', { class: 'flex flex-col' },
            h('span', { class: 'text-[10px] uppercase font-black text-blue-400' }, view.status.heading),
            h('span', { class: 'text-xs font-bold text-white break-words' }, view.status.detail));
    }
    return h('p', { class: 'text-xs text-slate-400 italic' }, view.status.detail);
}

function progressBlock(view) {
    return h('div', { class: 'space-y-2' },
        h('p', { class: 'text-xs text-slate-300' }, view.progressText),
        h('div', { class: 'h-2 bg-slate-800 rounded-full overflow-hidden' },
            h('div', {
                class: ['h-full rounded-full', view.finished ? 'bg-green-500' : 'bg-blue-500'],
                style: { width: `${view.percent}%` }
            })),
        h('div', { class: 'flex flex-wrap gap-1' }, view.steps.map((step) => h('span', {
            class: ['w-7 h-7 rounded-md border text-[11px] font-black flex items-center justify-center', STEP_CLASSES[step.status] || STEP_CLASSES.pending],
            title: step.label,
            'aria-label': step.label
        }, step.mark || step.number))));
}

/** Eine Monster-Aufgabe stoppt das Team, bis die Lehrkraft hier bestätigt. */
function monsterBlock(view, { readAloud, onConfirmMonster, isConfirming }) {
    const { monster } = view;
    const task = monster.task || {};
    return h('div', { class: 'bg-slate-800 rounded-xl p-3 space-y-3 border border-amber-500', dataset: { monsterFor: view.id } },
        h('p', { class: 'text-[10px] uppercase font-black text-amber-400' }, '👾 Monster-Aufgabe: Team wartet auf dich'),
        h('div', { class: 'flex gap-3 items-start' },
            task.image
                ? h('img', { src: task.image, alt: '', class: 'block h-20 w-auto max-w-[8rem] shrink-0 rounded-2xl object-contain' })
                : null,
            h('div', { class: 'min-w-0 space-y-1' },
                h('p', { class: 'font-bold break-words whitespace-pre-line' }, task.question || monster.title),
                task.description ? h('p', { class: 'text-sm text-slate-300 break-words whitespace-pre-line' }, task.description) : null)),
        task.audio
            ? readAloud.button(`classic-${view.id}-${monster.key}`, task.audio, 'min-h-[3rem] w-full rounded-xl px-4 py-2 font-bold bg-slate-700 hover:bg-slate-600')
            : null,
        h('button', {
            type: 'button',
            class: 'w-full min-h-[3.5rem] rounded-xl px-4 py-2 font-black bg-green-600 hover:bg-green-500 disabled:opacity-50',
            disabled: isConfirming(view.id, monster.key),
            dataset: { focusKey: `monster-${view.id}`, confirmMonster: view.id },
            onClick: () => onConfirmMonster(view.id, monster.key)
        }, 'Monster bewältigt'));
}

/** Audio-Schlüssel der offenen Monster-Aufgabe eines Teams oder null. */
export function monsterAudioKey(team, blueprint, running) {
    const view = teamView(team, blueprint, running);
    return view.monster ? `classic-${view.id}-${view.monster.key}` : null;
}

/**
 * Team-Karte für Lobby und laufendes Spiel.
 * @param {{ team, blueprint, running, expanded, onToggle, onDelete, monsterActions }} options
 *   monsterActions: { readAloud, onConfirmMonster(teamId, taskKey), isConfirming(teamId, taskKey) }
 */
export function teamCard({ team, blueprint, running, expanded, onToggle, onDelete, monsterActions }) {
    const view = teamView(team, blueprint, running);
    const showProgress = running || view.hasActivity;
    return h('article', {
        class: ['bg-slate-700 border-l-4 p-4 rounded-r-lg shadow space-y-3 min-w-0', view.finished && 'ring-1 ring-green-500'],
        style: { borderLeftColor: view.color },
        dataset: { teamId: view.id }
    },
    h('div', { class: 'flex items-start justify-between gap-3' },
        h('div', { class: 'flex items-center gap-3 min-w-0' },
            h('div', {
                'aria-hidden': true,
                class: 'w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white font-black',
                style: { backgroundColor: view.color }
            }, view.initial),
            h('div', { class: 'min-w-0' },
                h('h4', { class: 'font-bold text-lg break-words' }, view.name),
                h('p', { class: 'text-xs text-slate-400' },
                    'Team-Code: ',
                    h('span', { class: 'text-white font-mono font-bold' }, view.teamCode),
                    ` | Größe: ${view.groupSize}`))),
        h('button', {
            type: 'button',
            class: 'shrink-0 text-xs text-slate-400 hover:text-red-400 underline',
            'aria-label': `Team ${view.name} löschen`,
            dataset: { focusKey: `delete-${view.id}` },
            onClick: () => onDelete(team)
        }, 'Löschen')),
    showProgress ? statusBlock(view) : null,
    view.monster ? monsterBlock(view, monsterActions) : null,
    showProgress ? progressBlock(view) : null,
    showProgress
        ? h('div', null,
            h('button', {
                type: 'button',
                class: 'text-xs font-bold text-blue-400 hover:text-blue-300',
                'aria-expanded': expanded,
                dataset: { focusKey: `answers-${view.id}` },
                onClick: () => onToggle(team.id)
            }, expanded ? 'Antworten ausblenden' : `Antworten anzeigen (${view.answers.length})`),
            expanded ? h('div', { class: 'mt-2' }, answersList(view)) : null)
        : null);
}

/** Übersicht der Aufgaben oder Stationen der laufenden Spielrunde. */
export function taskOverview(blueprint) {
    const tasks = blueprint && Array.isArray(blueprint.tasks) ? blueprint.tasks : [];
    if (tasks.length === 0) return h('p', { class: 'text-xs text-slate-400 italic' }, 'Keine Aufgaben vorhanden.');
    const isQr = blueprint.templateType === 'qr';
    return tasks.map((task, index) => h('div', { class: 'bg-slate-800 p-3 rounded-xl border border-slate-700 flex flex-col gap-1' },
        h('div', { class: 'flex justify-between items-center' },
            h('span', { class: 'text-[10px] font-black text-slate-400 uppercase' }, `${isQr ? 'Station' : 'Aufgabe'} ${index + 1}`),
            isQr ? h('span', { class: 'text-[10px] bg-slate-700 px-2 py-0.5 rounded text-blue-400 font-mono' }, task.code || '---') : null),
        h('div', { class: 'flex items-center gap-2 min-w-0' },
            h('span', { class: 'text-lg', 'aria-hidden': true }, (TaskTypes.get(task.type) || {}).icon || '🎮'),
            h('span', { class: 'text-xs font-bold text-slate-300 break-words min-w-0' }, TaskTypes.taskTitle(task)))));
}

/** Karte einer Einsendung (Foto oder Statement). */
export function submissionCard(submission) {
    const photo = submission.type === 'photo' ? safeUploadUrl(submission.content) : null;
    let body;
    if (submission.type !== 'photo') {
        body = h('p', { class: 'text-sm italic text-slate-300 break-words whitespace-pre-line' }, `„${submission.content}“`);
    } else if (photo) {
        body = h('a', { href: photo, target: '_blank', rel: 'noopener' },
            h('img', { src: photo, alt: `Foto von ${submission.team_name}`, loading: 'lazy', class: 'w-full h-32 object-cover rounded' }));
    } else {
        body = h('p', { class: 'text-xs text-slate-400 italic' }, 'Das Foto ist nicht verfügbar.');
    }
    return h('article', {
        class: 'bg-slate-700 p-3 rounded-lg border-l-4 shadow-lg flex flex-col gap-2 min-w-0',
        style: { borderLeftColor: submission.team_color },
        dataset: { submissionId: submission.id }
    },
    h('p', { class: 'text-[10px] font-bold uppercase text-slate-400 break-words' },
        `${submission.team_name} (${submission.team_code}) - ${SUBMISSION_LABELS[submission.type] || submission.type}`),
    h('p', { class: 'text-xs font-bold text-slate-200 break-words' }, submission.task_title),
    body,
    h('p', { class: 'text-[10px] text-slate-500' }, formatDate(submission.created_at)));
}

/**
 * Erhält Karten über Neuaufbauten, damit Bilder nicht flackern und neu laden.
 * Neueste Einsendung zuerst.
 */
export function createSubmissionList() {
    const cache = new Map();
    return function cardsFor(submissions) {
        const seen = new Set();
        const cards = [...submissions].reverse().map((submission) => {
            const signature = `${submission.content}|${submission.created_at}`;
            seen.add(submission.id);
            let entry = cache.get(submission.id);
            if (!entry || entry.signature !== signature) {
                entry = { signature, el: submissionCard(submission) };
                cache.set(submission.id, entry);
            }
            return entry.el;
        });
        [...cache.keys()].filter((id) => !seen.has(id)).forEach((id) => cache.delete(id));
        return cards;
    };
}
