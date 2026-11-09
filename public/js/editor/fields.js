/*
 * fields.js: Formular-Bausteine des Editors. Werte kommen immer als Property oder Textknoten
 * ins DOM, Anführungszeichen und Apostrophe bleiben also erhalten.
 */

import { h, mount } from '../shared/dom.js';

export const LABEL_CLASS = 'block text-xs uppercase font-bold text-slate-400 mb-2 tracking-wide';
export const HINT_CLASS = 'text-xs text-slate-500 mt-1';
export const INPUT_CLASS = 'w-full min-w-0 bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-white placeholder-slate-600';
export const ROW_BOX_CLASS = 'p-3 bg-slate-900/60 rounded-xl border border-slate-700 space-y-2';
export const ADD_BUTTON_CLASS = 'bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-bold text-blue-300 min-h-[2.75rem]';
const REMOVE_BUTTON_CLASS = 'shrink-0 w-11 h-11 rounded-lg bg-slate-800 text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-xl leading-none';

export function field(label, control, hint) {
    return h('label', { class: 'block' },
        h('span', { class: LABEL_CLASS }, label),
        control,
        hint ? h('span', { class: `block ${HINT_CLASS}` }, hint) : null);
}

export function textInput({ value, onValue, placeholder, maxLength, type = 'text', ariaLabel, min, max }) {
    return h('input', {
        type,
        class: INPUT_CLASS,
        value: value === null || value === undefined ? '' : String(value),
        placeholder,
        maxlength: maxLength,
        min,
        max,
        'aria-label': ariaLabel,
        onInput: (event) => onValue(event.target.value)
    });
}

export function textArea({ value, onValue, placeholder, maxLength, ariaLabel, rows = 3 }) {
    return h('textarea', {
        class: INPUT_CLASS,
        rows,
        value: value === null || value === undefined ? '' : String(value),
        placeholder,
        maxlength: maxLength,
        'aria-label': ariaLabel,
        onInput: (event) => onValue(event.target.value)
    });
}

/** Textfeld, das direkt in task[key] schreibt. */
export function boundText(form, key, label, options = {}) {
    const control = textInput({
        ...options,
        value: form.task[key],
        onValue: (value) => {
            form.task[key] = value;
            form.changed();
        }
    });
    return field(label, control, options.hint);
}

export function boundArea(form, key, label, options = {}) {
    const control = textArea({
        ...options,
        value: form.task[key],
        onValue: (value) => {
            form.task[key] = value;
            form.changed();
        }
    });
    return field(label, control, options.hint);
}

/**
 * Liste mit Hinzufügen und Entfernen. getItems liest bei jedem Zugriff das aktuelle Array aus dem
 * Aufgaben-Objekt, es gibt keine zwischengespeicherte Kopie. renderRow bekommt (item, index).
 * Eingaben schreiben sofort in den Zustand, deshalb darf die Liste jederzeit neu gezeichnet werden.
 */
export function rowList({ form, label, hint, getItems, renderRow, createItem, addLabel, max, min = 0, onRemove, onStructure, count }) {
    const list = h('div', { class: 'space-y-2' });
    const counter = count ? h('p', { class: HINT_CLASS, 'aria-live': 'polite' }) : null;

    function structureChanged() {
        render();
        if (onStructure) onStructure();
        form.changed();
    }

    function remove(index) {
        if (onRemove) onRemove(index);
        else getItems().splice(index, 1);
        structureChanged();
    }

    const addButton = h('button', {
        type: 'button',
        class: ADD_BUTTON_CLASS,
        onClick: () => {
            const items = getItems();
            if (max && items.length >= max) return;
            items.push(createItem());
            structureChanged();
            const rows = list.children;
            const input = rows.length ? rows[rows.length - 1].querySelector('input, textarea') : null;
            if (input) input.focus();
        }
    }, addLabel);

    function render() {
        const items = getItems();
        mount(list, items.map((item, index) => h('div', { class: 'flex gap-2 items-start' },
            h('div', { class: 'flex-1 min-w-0' }, renderRow(item, index)),
            items.length > min ? h('button', {
                type: 'button',
                class: REMOVE_BUTTON_CLASS,
                'aria-label': `Eintrag ${index + 1} entfernen`,
                title: 'Entfernen',
                onClick: () => remove(index)
            }, '×') : null)));
        addButton.disabled = Boolean(max) && items.length >= max;
        if (counter) counter.textContent = count(items.length);
    }

    render();
    const el = h('div', { class: 'space-y-2' },
        h('span', { class: LABEL_CLASS }, label),
        hint ? h('p', { class: HINT_CLASS }, hint) : null,
        list,
        counter,
        addButton);
    return { el, refresh: render };
}

/** rowList für eine Liste von Texten in task[key]. */
export function stringRows(form, key, { placeholder, maxLength, onValue, ...options }) {
    const getItems = () => form.task[key];
    return rowList({
        form,
        getItems,
        createItem: () => '',
        renderRow: (item, index) => textInput({
            value: item,
            maxLength,
            placeholder: placeholder ? `${placeholder} ${index + 1}` : undefined,
            ariaLabel: placeholder ? `${placeholder} ${index + 1}` : undefined,
            onValue: (value) => {
                getItems()[index] = value;
                if (onValue) onValue();
                form.changed();
            }
        }),
        ...options
    });
}

/** Baut die Optionen neu, ohne das Element zu ersetzen; Fokus bleibt erhalten. */
export function fillSelect(select, options, value) {
    mount(select, options.map((option) => h('option', { value: option.value }, option.label)));
    select.value = options.some((option) => option.value === value) ? value : '';
}

export function selectInput({ options, value, onValue, ariaLabel }) {
    const select = h('select', {
        class: INPUT_CLASS,
        'aria-label': ariaLabel,
        onChange: (event) => onValue(event.target.value)
    });
    fillSelect(select, options, value);
    return select;
}
