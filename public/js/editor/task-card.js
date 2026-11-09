/* task-card.js: Karte einer Aufgabe. Eingaben zeichnen die Karte nie neu, nur ein Typwechsel. */

import { h, mount, setHidden } from '../shared/dom.js';
import { renderTaskForm } from './task-forms.js';
import { stopAudioPlayback } from './audio-field.js';

function typeOption(definition) {
    return h('option', { value: definition.type }, `${definition.icon} ${definition.label}`);
}

/** Angeboten wird nur EDITOR_TYPES. Ein ausgeblendeter Typ erscheint nur, solange die Aufgabe ihn hat. */
function fillTypeSelect(select, task, excludedTypes) {
    const TT = globalThis.TaskTypes;
    const offered = TT.editorList().filter((definition) => !excludedTypes.includes(definition.type));
    const current = TT.get(task.type);
    mount(select, offered.map(typeOption), offered.includes(current) ? null : h('optgroup', { label: 'Ausgeblendeter Typ' }, typeOption(current)));
    select.value = task.type;
}

function stationBadge(task, codeLabel) {
    const canvas = h('canvas', { class: 'bg-white p-1 rounded-lg', 'aria-hidden': true });
    if (window.QRCode) {
        window.QRCode.toCanvas(canvas, task.code, { width: 56, margin: 0, errorCorrectionLevel: 'H' }, (err) => {
            if (err) setHidden(canvas, true);
        });
    } else {
        setHidden(canvas, true);
    }
    return h('div', { class: 'flex items-center gap-3' },
        h('div', { class: 'bg-slate-800 px-3 py-1 rounded-xl border border-slate-700' },
            h('span', { class: 'text-xs uppercase font-bold text-slate-500 block' }, codeLabel),
            h('span', { class: 'font-black text-blue-300 tracking-widest' }, task.code)),
        canvas);
}

/**
 * Kopf einer Monster-Aufgabe im Kartenset: Ihr Platz ist fest, Typ wechseln und Entfernen gibt es nicht.
 * slot: { field, label }
 */
function slotHeader(slot) {
    return h('header', { class: 'flex flex-wrap items-center gap-3 pb-4 border-b border-slate-800' },
        h('span', { class: 'shrink-0 px-3 h-10 rounded-full bg-purple-600 flex items-center justify-center font-black text-sm' }, `Feld ${slot.field}`),
        h('span', { class: 'font-black text-purple-300' }, `👾 ${slot.label}`));
}

/**
 * actions: { changed(task), isCurrent(task), typeChange(task, select, rerender), remove(task), select(task) }
 * codeLabel: Beschriftung des Codes, ohne Angabe hat die Aufgabe keinen Code.
 * slot: fester Platz einer Monster-Aufgabe, siehe slotHeader.
 * excludedTypes: Typen, die hier nicht angeboten werden.
 * Liefert { el, setErrors(messages), setSelected(bool) }.
 */
export function createTaskCard({ task, number, codeLabel = null, slot = null, excludedTypes = [], actions }) {
    const body = h('div', { class: 'space-y-4' });
    const errorList = h('ul', { class: 'hidden text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl p-3 space-y-1', role: 'status' });
    const form = { task, changed: () => actions.changed(task), isCurrent: () => actions.isCurrent(task) };

    const typeSelect = h('select', {
        class: 'min-w-0 bg-slate-800 rounded-xl px-4 py-2 min-h-[2.75rem] font-bold text-blue-300 outline-none focus:ring-2 focus:ring-blue-500',
        'aria-label': 'Typ der Aufgabe',
        onChange: () => actions.typeChange(task, typeSelect, renderBody)
    });

    function renderBody() {
        stopAudioPlayback();
        fillTypeSelect(typeSelect, task, excludedTypes);
        mount(body, renderTaskForm(form));
    }

    const el = h('article', {
        class: 'bg-slate-900/80 p-4 sm:p-6 rounded-2xl border-2 border-slate-700 space-y-4',
        onFocusin: () => actions.select(task),
        onPointerDown: () => actions.select(task)
    },
    slot ? slotHeader(slot) : h('header', { class: 'flex flex-wrap justify-between items-center gap-3 pb-4 border-b border-slate-800' },
        h('div', { class: 'flex items-center gap-3 min-w-0' },
            h('span', { class: 'shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-black text-sm' }, number),
            typeSelect),
        codeLabel ? stationBadge(task, codeLabel) : null,
        h('button', {
            type: 'button',
            class: 'shrink-0 w-11 h-11 rounded-xl bg-slate-800 text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-lg',
            'aria-label': `Aufgabe ${number} entfernen`,
            title: 'Aufgabe entfernen',
            onClick: () => actions.remove(task)
        }, '🗑️')),
    errorList,
    body);

    renderBody();

    return {
        el,
        setErrors(messages) {
            mount(errorList, messages.map((message) => h('li', null, message)));
            setHidden(errorList, messages.length === 0);
            el.classList.toggle('border-red-500/60', messages.length > 0);
        },
        setSelected(selected) {
            el.classList.toggle('ring-2', selected);
            el.classList.toggle('ring-blue-500', selected);
        }
    };
}
