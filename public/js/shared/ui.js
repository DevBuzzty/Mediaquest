/*
 * ui.js: Hinweis- und Bestätigungs-Dialoge. Ersetzt die nativen alert()/confirm().
 *
 *   import { alert, confirm, dismissAll } from '/js/shared/ui.js';
 *
 *   await alert('Gespeichert.');
 *   await alert('Das Foto konnte nicht gesendet werden.', { title: 'Fehler', icon: '⚠️' });
 *   if (await confirm('Team wirklich löschen?', { okLabel: 'Löschen', danger: true })) { ... }
 *
 * alert(text, { title, icon, okLabel })  Promise ohne Wert, nach "Verstanden"
 * confirm(text, { title, icon, okLabel, cancelLabel, danger })  Promise<boolean>
 *   danger: roter OK-Knopf, der Fokus startet auf "Abbrechen". Escape bedeutet Abbrechen.
 * dismissAll()  schließt den offenen und alle wartenden Dialoge, etwa beim Phasenwechsel.
 *   alert löst dann auf, confirm mit false. So hängt nie ein Promise.
 *
 * Dialoge laufen nacheinander: Jeder hat sein eigenes DOM-Element, das beim Schließen sofort
 * entfernt wird, es gibt keinen Timer. Ein direkt folgender oder gleichzeitiger Aufruf geht
 * daher nie verloren. Klicks in den ersten 250 ms eines Dialogs zählen nicht, damit ein Doppeltipp
 * nicht auch den nächsten schließt. Der Import überdeckt die nativen Funktionen im Modul: Ohne Import
 * würde still der native Dialog erscheinen. Text wird als Textknoten eingesetzt, Zeilenumbrüche bleiben.
 */

import { h } from './dom.js';

const CLICK_GUARD_MS = 250;
const BUTTON_BASE = 'w-full min-h-[3rem] font-bold py-3 px-6 rounded-xl transition-colors active:scale-95';
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-blue-600 hover:bg-blue-500 text-white shadow-lg`;
const BUTTON_DANGER = `${BUTTON_BASE} bg-red-600 hover:bg-red-500 text-white shadow-lg`;
const BUTTON_CANCEL = `${BUTTON_BASE} bg-slate-700 hover:bg-slate-600 text-slate-300`;

const queue = [];
let current = null;
let focusBefore = null;
let dialogCounter = 0;

function openDialog(entry) {
    dialogCounter += 1;
    const titleId = `wr-dialog-title-${dialogCounter}`;
    const textId = `wr-dialog-text-${dialogCounter}`;
    const openedAt = performance.now();

    const answer = (value) => () => {
        if (performance.now() - openedAt < CLICK_GUARD_MS) return;
        close(value);
    };

    const okButton = h('button', {
        type: 'button',
        class: entry.danger ? BUTTON_DANGER : BUTTON_PRIMARY,
        onClick: answer(entry.okValue)
    }, entry.okLabel);
    const cancelButton = entry.cancelLabel
        ? h('button', { type: 'button', class: BUTTON_CANCEL, onClick: answer(entry.cancelValue) }, entry.cancelLabel)
        : null;
    const buttons = cancelButton ? [okButton, cancelButton] : [okButton];

    const root = h('div', {
        class: 'print:hidden fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80'
    }, h('div', {
        role: 'alertdialog',
        'aria-modal': true,
        'aria-labelledby': titleId,
        'aria-describedby': textId,
        class: 'motion-safe:animate-wr-modal-in bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full max-h-[calc(100vh-2rem)] overflow-y-auto p-8'
    },
    h('div', {
        'aria-hidden': true,
        class: 'w-16 h-16 rounded-full bg-blue-600/20 flex items-center justify-center mx-auto mb-6 text-3xl'
    }, entry.icon),
    h('h3', { id: titleId, class: 'text-2xl font-bold text-center text-white mb-4' }, entry.title),
    h('p', { id: textId, class: 'text-slate-400 text-center mb-8 leading-relaxed whitespace-pre-line break-words' }, entry.text),
    h('div', { class: 'flex flex-col gap-3' }, buttons)));

    function onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(entry.cancelValue);
        } else if (event.key === 'Tab') {
            event.preventDefault();
            const position = buttons.indexOf(document.activeElement);
            const step = event.shiftKey ? buttons.length - 1 : 1;
            buttons[position === -1 ? 0 : (position + step) % buttons.length].focus();
        } else if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
            // Gehaltene Taste darf nicht auch alle folgenden Dialoge bestätigen.
            event.preventDefault();
        }
    }

    function close(value) {
        if (current !== dialog) return;
        current = null;
        document.removeEventListener('keydown', onKeyDown, true);
        root.remove();
        entry.resolve(value);
        showNext();
    }

    const dialog = { close, cancelValue: entry.cancelValue };
    current = dialog;
    document.addEventListener('keydown', onKeyDown, true);
    document.body.append(root);
    (entry.danger && cancelButton ? cancelButton : okButton).focus();
}

function showNext() {
    if (current) return;
    const next = queue.shift();
    if (next) {
        if (!focusBefore) focusBefore = document.activeElement;
        openDialog(next);
    } else if (focusBefore) {
        const target = focusBefore;
        focusBefore = null;
        if (target.isConnected && typeof target.focus === 'function') target.focus();
    }
}

function enqueue(entry) {
    return new Promise((resolve) => {
        queue.push({ ...entry, resolve });
        showNext();
    });
}

export function alert(text, { title = 'Hinweis', icon = 'ℹ️', okLabel = 'Verstanden' } = {}) {
    return enqueue({ text, title, icon, okLabel, okValue: undefined, cancelValue: undefined });
}

export function confirm(text, {
    title = 'Bist du sicher?', icon = '❓', okLabel = 'Bestätigen', cancelLabel = 'Abbrechen', danger = false
} = {}) {
    return enqueue({ text, title, icon, okLabel, cancelLabel, danger, okValue: true, cancelValue: false });
}

export function dismissAll() {
    queue.splice(0).forEach((entry) => entry.resolve(entry.cancelValue));
    if (current) current.close(current.cancelValue);
}
