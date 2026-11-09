/*
 * task-forms.js: Formular je Aufgaben-Typ. form = { task, changed(), isCurrent() }.
 * Alle Closures halten das Aufgaben-Objekt selbst, nie einen Index in die Aufgaben-Liste.
 */

import { h } from '../shared/dom.js';
import { ROW_BOX_CLASS, HINT_CLASS, LABEL_CLASS, boundArea, boundText, field, rowList, selectInput, stringRows, textArea, textInput } from './fields.js';
import { chatEditor } from './chat-editor.js';
import { hotspotEditor } from './hotspot-editor.js';
import { imageField } from './image-field.js';
import { audioField } from './audio-field.js';
import { removeBucket, removeOption } from './store.js';

const limits = () => globalThis.TaskTypes.limits;

let answerGroups = 0;

function binaryForm(form) {
    const { task } = form;
    return h('div', { class: 'space-y-4' },
        boundText(form, 'icon', 'Emoji / Icon', { maxLength: 16 }),
        field('Richtige Seite', selectInput({
            options: [
                { value: '', label: 'Seite wählen …' },
                { value: 'left', label: '⬅️ Links' },
                { value: 'right', label: '➡️ Rechts' }
            ],
            value: task.correct || '',
            ariaLabel: 'Richtige Seite',
            onValue: (value) => {
                task.correct = value || null;
                form.changed();
            }
        }), 'Im Kartenset ist das Pflicht, sonst lässt sich die Karte nicht auswerten.'));
}

function optionsForm(form) {
    const { task } = form;
    const multiple = task.type === 'select';
    answerGroups += 1;
    const group = `richtige-antwort-${answerGroups}`;

    const isCorrect = (index) => (multiple ? (task.correct || []).includes(index) : task.correct === index);
    const mark = (index, checked) => {
        if (multiple) {
            const others = (task.correct || []).filter((entry) => entry !== index);
            task.correct = (checked ? [...others, index] : others).sort((a, b) => a - b);
        } else {
            task.correct = index;
        }
        form.changed();
    };

    return rowList({
        form,
        label: 'Antwortmöglichkeiten',
        hint: `Links ${multiple ? 'alle richtigen Antworten' : 'die richtige Antwort'} ankreuzen, im Kartenset ist das Pflicht. Leere Zeilen werden beim Speichern entfernt.`,
        getItems: () => task.options,
        createItem: () => '',
        addLabel: '+ Option',
        max: limits().listItems,
        onRemove: (index) => removeOption(task, index),
        renderRow: (option, index) => h('div', { class: 'flex items-center gap-2' },
            h('label', { class: 'shrink-0 w-11 h-11 flex items-center justify-center', title: 'Richtige Antwort' },
                h('input', {
                    type: multiple ? 'checkbox' : 'radio',
                    name: group,
                    class: 'w-5 h-5',
                    checked: isCorrect(index),
                    'aria-label': `Option ${index + 1} ist richtig`,
                    onChange: (event) => mark(index, event.target.checked)
                })),
            h('div', { class: 'flex-1 min-w-0' }, textInput({
                value: option,
                placeholder: `Option ${index + 1}`,
                ariaLabel: `Option ${index + 1}`,
                maxLength: limits().shortText,
                onValue: (value) => {
                    task.options[index] = value;
                    form.changed();
                }
            })))
    }).el;
}

function scrollerForm(form) {
    const { task } = form;
    return rowList({
        form,
        label: 'Feed-Posts',
        getItems: () => task.posts,
        createItem: () => ({ user: '', text: '', isBad: false }),
        addLabel: '+ Weiteren Post hinzufügen',
        max: limits().listItems,
        count: (n) => `${n} Posts (mindestens ${limits().scrollerMinPosts} erforderlich)`,
        renderRow: (post, index) => h('div', { class: ROW_BOX_CLASS },
            textInput({
                value: post.user,
                placeholder: 'Name',
                ariaLabel: `Name bei Post ${index + 1}`,
                maxLength: limits().shortText,
                onValue: (value) => { post.user = value; form.changed(); }
            }),
            textArea({
                value: post.text,
                placeholder: 'Inhalt des Posts',
                ariaLabel: `Inhalt von Post ${index + 1}`,
                maxLength: limits().longText,
                rows: 2,
                onValue: (value) => { post.text = value; form.changed(); }
            }),
            h('label', { class: 'flex items-center gap-2 text-sm font-bold text-slate-400 min-h-[2.75rem]' },
                h('input', {
                    type: 'checkbox',
                    class: 'w-5 h-5',
                    checked: Boolean(post.isBad),
                    onChange: (event) => { post.isBad = event.target.checked; form.changed(); }
                }),
                'Problematischer Inhalt'))
    }).el;
}

function passwordForm(form) {
    return stringRows(form, 'rules', {
        label: 'Regeln',
        hint: 'Automatisch geprüft werden Angaben wie „Mind. 8 Zeichen“, „Sonderzeichen“, „Großbuchstabe“, „Kleinbuchstabe“ und „Zahl“. Andere Regeln werden nur angezeigt. Ohne Regeln genügt jedes nicht leere Passwort.',
        placeholder: 'Regel',
        maxLength: limits().shortText,
        addLabel: '+ Regel',
        max: limits().passwordRules
    }).el;
}

function profileForm(form) {
    const { task } = form;
    const toggle = (value, checked) => {
        const others = task.fields.filter((entry) => entry !== value);
        task.fields = checked ? [...others, value] : others;
        form.changed();
    };
    return h('div', { class: 'space-y-4' },
        h('div', null,
            h('span', { class: LABEL_CLASS }, 'Standard-Felder'),
            h('div', { class: 'grid grid-cols-2 gap-3 bg-slate-900 p-4 rounded-xl border border-slate-700' },
                globalThis.TaskTypes.PROFILE_FIELDS.map(({ value, label }) => h('label', { class: 'flex items-center gap-3 text-sm font-bold text-slate-300 min-h-[2.75rem]' },
                    h('input', {
                        type: 'checkbox',
                        class: 'w-5 h-5',
                        checked: task.fields.includes(value),
                        onChange: (event) => toggle(value, event.target.checked)
                    }),
                    label)))),
        stringRows(form, 'customFields', {
            label: 'Eigene Felder',
            placeholder: 'Feldname',
            maxLength: limits().shortText,
            addLabel: '+ Eigenes Feld',
            max: limits().listItems
        }).el);
}

function bucketForm(form) {
    const { task } = form;
    const bucketChoices = () => [
        { value: '', label: 'Korb wählen …' },
        ...task.buckets.map((name, index) => ({ value: String(index), label: name.trim() || `Korb ${index + 1}` }))
    ];

    const items = rowList({
        form,
        label: 'Begriffe zum Einsortieren',
        getItems: () => task.items,
        createItem: () => ({ text: '', target: 0 }),
        addLabel: '+ Begriff hinzufügen',
        max: limits().listItems,
        renderRow: (item, index) => h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-2' },
            textInput({
                value: item.text,
                placeholder: 'Begriff',
                ariaLabel: `Begriff ${index + 1}`,
                maxLength: limits().shortText,
                onValue: (value) => { item.text = value; form.changed(); }
            }),
            selectInput({
                options: bucketChoices(),
                value: Number.isInteger(item.target) ? String(item.target) : '',
                ariaLabel: `Richtiger Korb für Begriff ${index + 1}`,
                onValue: (value) => {
                    item.target = value === '' ? null : Number(value);
                    form.changed();
                }
            }))
    });

    const buckets = stringRows(form, 'buckets', {
        label: 'Körbe',
        hint: `${limits().bucketsMin} bis ${limits().bucketsMax} Körbe`,
        placeholder: 'Korb',
        maxLength: limits().shortText,
        addLabel: '+ Korb',
        max: limits().bucketsMax,
        min: limits().bucketsMin,
        onRemove: (index) => removeBucket(task, index),
        onStructure: () => items.refresh(),
        onValue: () => items.refresh()
    });

    return h('div', { class: 'space-y-4' }, buckets.el, items.el);
}

function rankingForm(form) {
    return stringRows(form, 'items', {
        label: 'Elemente',
        hint: 'Trage die Elemente in der richtigen Reihenfolge ein, Platz 1 zuerst. Die Teams sehen sie gemischt.',
        placeholder: 'Platz',
        maxLength: limits().shortText,
        addLabel: '+ Element',
        max: limits().listItems
    }).el;
}

function pairsForm(form) {
    const { task } = form;
    const side = (pair, key, label, index) => textInput({
        value: pair[key],
        placeholder: label,
        ariaLabel: `${label} bei Paar ${index + 1}`,
        maxLength: limits().shortText,
        onValue: (value) => { pair[key] = value; form.changed(); }
    });
    return rowList({
        form,
        label: 'Logische Paare',
        getItems: () => task.pairs,
        createItem: () => ({ left: '', right: '' }),
        addLabel: '+ Paar',
        max: limits().listItems,
        renderRow: (pair, index) => h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-2' },
            side(pair, 'left', 'Links', index),
            side(pair, 'right', 'Rechts', index))
    }).el;
}

function clozeForm(form) {
    return h('div', { class: 'space-y-4' },
        boundArea(form, 'text', 'Text mit [Lücken]', {
            rows: 4,
            maxLength: limits().longText,
            hint: 'Schreibe die gesuchten Wörter in eckige Klammern, zum Beispiel: Die Erde ist [rund].'
        }),
        stringRows(form, 'fakes', {
            label: 'Falsche Wörter',
            placeholder: 'Wort',
            maxLength: limits().shortText,
            addLabel: '+ Falsches Wort',
            max: limits().listItems
        }).el);
}

function countdownForm(form) {
    const { task } = form;
    return field('Dauer (Sekunden)', textInput({
        type: 'number',
        min: 1,
        max: limits().countdownMax,
        value: task.duration,
        onValue: (value) => {
            task.duration = value.trim() === '' ? null : Number(value);
            form.changed();
        }
    }));
}

function noSettings(text) {
    return () => h('p', { class: HINT_CLASS }, text);
}

const FORMS = {
    binary: binaryForm,
    choice: optionsForm,
    select: optionsForm,
    chat: (form) => h('div', { class: 'space-y-4' },
        boundText(form, 'partner', 'Chat-Partner', { maxLength: limits().shortText }),
        chatEditor(form)),
    scroller: scrollerForm,
    detector: (form) => imageField(form, 'Hintergrundbild'),
    hotspot: hotspotEditor,
    password: passwordForm,
    photo: noSettings('Die Teams laden hier ein Foto hoch. Weitere Einstellungen gibt es nicht.'),
    statement: noSettings('Die Teams schreiben hier einen Text. Weitere Einstellungen gibt es nicht.'),
    profile: profileForm,
    mood: (form) => h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
        boundText(form, 'labelLeft', 'Beschriftung links', { maxLength: limits().shortText }),
        boundText(form, 'labelRight', 'Beschriftung rechts', { maxLength: limits().shortText })),
    bucket: bucketForm,
    ranking: rankingForm,
    pairs: pairsForm,
    cloze: clozeForm,
    countdown: countdownForm,
    monster: (form) => h('div', { class: 'space-y-2' },
        imageField(form, 'Bild (optional)', null, { removable: true }),
        h('p', { class: HINT_CLASS }, 'Erscheint auf dem Tablet der Lehrkraft. Die Gruppen warten, bis du die Aufgabe als erledigt bestätigst.'))
};

export const FORM_TYPES = Object.keys(FORMS);

/** Felder einer Aufgabe: Frage und Beschreibung, dann die Typ-Felder und Audio. Die Frage ist auch der Titel auf Dashboard und QR-Bogen. */
export function renderTaskForm(form) {
    return [
        boundText(form, 'question', 'Frage / Anweisung', { maxLength: limits().longText }),
        boundText(form, 'description', 'Kurze Beschreibung / Anleitung', { maxLength: limits().longText }),
        FORMS[form.task.type](form),
        audioField(form)
    ];
}
