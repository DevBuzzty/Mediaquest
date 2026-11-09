/*
 * chat-editor.js: Dialog-Baum als Formular statt als rohes JSON. Ungültige Strukturen können so
 * nur inhaltlich entstehen (fehlender Text, kein Ziel) und werden sofort sichtbar gemeldet.
 */

import { h, mount, setHidden } from '../shared/dom.js';
import { ADD_BUTTON_CLASS, HINT_CLASS, LABEL_CLASS, ROW_BOX_CLASS, fillSelect, rowList, selectInput, textArea, textInput } from './fields.js';
import { addChatNode, removeChatNode, renameChatNode } from './store.js';

export function chatEditor(form) {
    const { task } = form;
    const limits = globalThis.TaskTypes.limits;
    const nodesEl = h('div', { class: 'space-y-3' });
    const errorBox = h('ul', { class: 'hidden text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl p-3 space-y-1', role: 'status' });
    const renameError = h('p', { class: 'hidden text-sm text-red-300', role: 'alert' });
    let nextSelects = [];

    function nextChoices() {
        return [{ value: '', label: 'Ziel wählen …' }, ...Object.keys(task.nodes).map((id) => ({ value: id, label: id }))];
    }

    function refreshNextSelects() {
        nextSelects.forEach(({ select, option }) => fillSelect(select, nextChoices(), option.next));
    }

    function refreshErrors() {
        const errors = globalThis.TaskTypes.validate(task).filter((message) => message.startsWith('Chat:'));
        mount(errorBox, errors.map((message) => h('li', null, message)));
        setHidden(errorBox, errors.length === 0);
    }

    function chatChanged() {
        refreshErrors();
        form.changed();
    }

    function renderOption(option, index) {
        const select = selectInput({
            options: nextChoices(),
            value: option.next,
            ariaLabel: `Nächster Knoten für Antwort ${index + 1}`,
            onValue: (value) => {
                option.next = value;
                chatChanged();
            }
        });
        nextSelects.push({ select, option });
        return h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-2' },
            textInput({
                value: option.label,
                placeholder: 'Antwort',
                ariaLabel: `Text von Antwort ${index + 1}`,
                maxLength: limits.shortText,
                onValue: (value) => {
                    option.label = value;
                    chatChanged();
                }
            }),
            select);
    }

    function renderNode(id) {
        const node = task.nodes[id];
        let currentId = id;
        const idInput = h('input', {
            type: 'text',
            class: 'w-40 max-w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-bold text-blue-300 disabled:opacity-60',
            value: id,
            disabled: id === 'start',
            maxlength: 40,
            'aria-label': 'Name des Knotens',
            onChange: (event) => {
                const error = renameChatNode(task, currentId, event.target.value);
                renameError.textContent = error || '';
                setHidden(renameError, !error);
                if (error) {
                    event.target.value = currentId;
                    return;
                }
                currentId = event.target.value.trim();
                event.target.value = currentId;
                refreshNextSelects();
                chatChanged();
            }
        });

        const successInput = h('input', {
            type: 'checkbox',
            class: 'w-5 h-5',
            onChange: (event) => {
                if (event.target.checked) node.success = true;
                else delete node.success;
                chatChanged();
            }
        });
        const successRow = h('label', { class: 'flex items-center gap-2 text-sm font-bold text-slate-400 min-h-[2.75rem]' },
            successInput,
            'Dieses Ende zählt als Erfolg');

        /** Nur ein Knoten ohne Antworten kann ein Ende sein, und der Start zählt nie: Davor gäbe es nichts zu entscheiden. */
        function refreshSuccess() {
            const canSucceed = node.options.length === 0 && id !== 'start';
            if (!canSucceed) delete node.success;
            successInput.checked = node.success === true;
            setHidden(successRow, !canSucceed);
        }
        refreshSuccess();

        const answers = rowList({
            form,
            label: 'Antworten',
            getItems: () => node.options,
            createItem: () => ({ label: '', next: '' }),
            renderRow: renderOption,
            addLabel: '+ Antwort',
            max: limits.chatOptions,
            // Die Zeilen wurden neu gebaut: entfernte Selects nicht weiter aktualisieren.
            onStructure: () => {
                nextSelects = nextSelects.filter(({ select }) => select.isConnected);
                refreshSuccess();
                refreshErrors();
            }
        });

        return h('div', { class: ROW_BOX_CLASS },
            h('div', { class: 'flex justify-between items-center gap-2' },
                idInput,
                id === 'start' ? h('span', { class: HINT_CLASS }, 'Hier beginnt der Chat') : h('button', {
                    type: 'button',
                    class: 'text-sm text-red-400 font-bold min-h-[2.75rem] px-2',
                    onClick: () => {
                        removeChatNode(task, currentId);
                        render();
                        chatChanged();
                    }
                }, 'Knoten löschen')),
            textArea({
                value: node.text,
                placeholder: 'Nachricht des Chat-Partners',
                ariaLabel: 'Nachricht des Chat-Partners',
                maxLength: limits.longText,
                rows: 2,
                onValue: (value) => {
                    node.text = value;
                    chatChanged();
                }
            }),
            answers.el,
            h('p', { class: HINT_CLASS }, 'Ein Knoten ohne Antworten beendet den Chat. Im Kartenset muss mindestens ein Ende als Erfolg markiert sein.'),
            successRow);
    }

    const addNodeButton = h('button', {
        type: 'button',
        class: ADD_BUTTON_CLASS,
        onClick: () => {
            addChatNode(task);
            render();
            chatChanged();
        }
    }, '+ Knoten');

    function render() {
        nextSelects = [];
        mount(nodesEl, Object.keys(task.nodes).map(renderNode));
        addNodeButton.disabled = Object.keys(task.nodes).length >= limits.chatNodes;
    }

    render();
    refreshErrors();

    return h('div', { class: 'space-y-3' },
        h('span', { class: LABEL_CLASS }, 'Dialog'),
        nodesEl,
        renameError,
        errorBox,
        addNodeButton);
}
