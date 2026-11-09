/* main.js: Spielrunden-Editor. Liste, Entwurf, Speichern, Import und Export. */

import { h, byId, clear, mount, setHidden } from '../shared/dom.js';
import { ApiError, api, errorMessage } from '../shared/api.js';
import { alert, confirm } from '../shared/ui.js';
import { createPreview } from './preview.js';
import { createTaskCard } from './task-card.js';
import { stopAudioPlayback } from './audio-field.js';
import {
    ImportError, MAX_IMPORT_BYTES, addTask, changeTaskType, draftFromBlueprint, exportFilename, formatErrorDetails, groupErrors,
    newDraft, parseImport, removeTask, savePayload, serializeDraft, setTemplateType, surplusMonsters, typeChangeLosesData, validateDraft
} from './store.js';

const MODE_ACTIVE = 'flex-1 rounded-xl font-bold text-sm bg-blue-600 text-white';
const MODE_INACTIVE = 'flex-1 rounded-xl font-bold text-sm text-slate-400 hover:text-slate-200';
const VALIDATION_DELAY_MS = 250;

const el = {
    list: byId('blueprintList'),
    sidebar: byId('blueprintSidebar'),
    placeholder: byId('editorPlaceholder'),
    editor: byId('editorContainer'),
    title: byId('blueprintTitle'),
    titleError: byId('titleError'),
    tasks: byId('tasksList'),
    generalErrors: byId('generalErrors'),
    dirty: byId('dirtyBadge'),
    save: byId('saveButton'),
    modeNormal: byId('modeNormal'),
    modeQr: byId('modeQr'),
    modeWorld: byId('modeWorld'),
    worldRow: byId('worldRow'),
    world: byId('worldSelect'),
    addTask: byId('addTaskButton'),
    monsterSection: byId('monsterSection'),
    monsters: byId('monsterList'),
    importFile: byId('importFile'),
    previewPager: byId('previewPager'),
    previewLabel: byId('previewLabel'),
    previewPrev: byId('previewPrev'),
    previewNext: byId('previewNext')
};

const preview = createPreview(byId('previewContainer'), { isBoardCard: () => Boolean(draft) && draft.templateType === 'world' });

let blueprints = [];
let draft = null;
let baseline = '';
let cards = new Map();
let selectedTask = null;
let showErrors = false;
let saving = false;
let refreshTimer = null;

function isDirty() {
    return draft !== null && serializeDraft(draft) !== baseline;
}

async function confirmDiscard() {
    if (!isDirty()) return true;
    return confirm('Deine Änderungen an dieser Spielrunde gehen dann verloren.', {
        title: 'Änderungen verwerfen?', icon: '⚠️', okLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten', danger: true
    });
}

/** Bei abgelaufener Anmeldung bleibt der Entwurf offen; ein Wechsel zum Login würde ihn verwerfen. */
function showApiError(err, title, fallback) {
    if (err instanceof ApiError && err.status === 401) {
        return alert('Du bist nicht mehr angemeldet. Melde dich in einem neuen Tab an und versuche es dann noch einmal.', { title: 'Anmeldung abgelaufen', icon: '🔒' });
    }
    return alert(errorMessage(err, fallback), { title, icon: '❌' });
}

// --- Fehleranzeige, Vorschau, Geändert-Hinweis -------------------------------

function displayErrors({ general, perTask, title }) {
    el.titleError.textContent = title || '';
    setHidden(el.titleError, !title);
    mount(el.generalErrors, general.map((message) => h('li', null, message)));
    setHidden(el.generalErrors, general.length === 0);
    draft.tasks.forEach((task, index) => cards.get(task).setErrors(perTask.get(index) || []));
}

function refreshPager() {
    const index = draft && selectedTask ? draft.tasks.indexOf(selectedTask) : -1;
    setHidden(el.previewPager, index === -1);
    if (index === -1) return;
    el.previewLabel.textContent = `Aufgabe ${index + 1} von ${draft.tasks.length}`;
    el.previewPrev.disabled = index === 0;
    el.previewNext.disabled = index === draft.tasks.length - 1;
}

function refreshDerived() {
    if (!draft) return;
    setHidden(el.dirty, !isDirty());
    if (showErrors) displayErrors(validateDraft(draft));
    preview.show(selectedTask);
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshDerived, VALIDATION_DELAY_MS);
}

function selectTask(task) {
    if (task === selectedTask) return;
    if (selectedTask && cards.has(selectedTask)) cards.get(selectedTask).setSelected(false);
    selectedTask = task;
    if (task && cards.has(task)) cards.get(task).setSelected(true);
    refreshPager();
    preview.show(task);
}

// --- Aufgaben ----------------------------------------------------------------

const cardActions = {
    changed: scheduleRefresh,
    isCurrent: (task) => draft !== null && draft.tasks.includes(task),
    select: selectTask,

    async typeChange(task, select, rerender) {
        const newType = select.value;
        if (typeChangeLosesData(task, newType)) {
            const ok = await confirm('Eingaben, die zum neuen Typ nicht passen, gehen dabei verloren.', {
                title: 'Typ wechseln?', icon: '⚠️', okLabel: 'Typ wechseln', danger: true
            });
            if (!ok || !cardActions.isCurrent(task)) {
                select.value = task.type;
                return;
            }
        }
        changeTaskType(task, newType);
        rerender();
        scheduleRefresh();
    },

    remove(task) {
        const index = draft.tasks.indexOf(task);
        removeTask(draft, task);
        if (selectedTask === task) selectedTask = draft.tasks[Math.min(index, draft.tasks.length - 1)] || null;
        renderTasks();
        refreshDerived();
    }
};

function buildCard(options) {
    const card = createTaskCard({ ...options, actions: cardActions });
    cards.set(options.task, card);
    return card.el;
}

function renderRoundTasks() {
    const codeLabel = draft.templateType === 'qr' ? 'Station-Code' : null;
    mount(el.tasks, draft.tasks.map((task, index) => buildCard({ task, number: index + 1, codeLabel })));
    clear(el.monsters);
}

function renderWorldTasks() {
    const isMonster = (task) => task.type === 'monster';
    mount(el.tasks,
        h('div', null,
            h('h3', { class: 'text-xl font-black text-blue-300' }, 'Karten'),
            h('p', { class: 'text-sm text-slate-400' }, 'Jede Gruppe scannt in einer Runde eine Karte. Trage bei jeder Karte die richtige Lösung ein.')),
        draft.tasks.filter((task) => !isMonster(task)).map((task, index) => buildCard({
            task, number: index + 1, codeLabel: 'Karten-Code', excludedTypes: ['monster']
        })));
    mount(el.monsters, draft.tasks.filter(isMonster).map((task, index) => buildCard({
        task,
        slot: { field: GameRules.MONSTER_FIELDS[index], label: GameRules.monsterLabel(draft.world, index) }
    })));
}

function renderTasks() {
    stopAudioPlayback();
    cards = new Map();
    const isWorld = draft.templateType === 'world';
    if (isWorld) renderWorldTasks();
    else renderRoundTasks();
    setHidden(el.monsterSection, !isWorld);
    el.addTask.textContent = isWorld ? '+ Karte zum Kartenset hinzufügen' : '+ Aufgabe zur Spielrunde hinzufügen';
    if (selectedTask && cards.has(selectedTask)) cards.get(selectedTask).setSelected(true);
    refreshPager();
}

function renderMode() {
    [[el.modeNormal, 'normal'], [el.modeQr, 'qr'], [el.modeWorld, 'world']].forEach(([button, templateType]) => {
        const active = draft.templateType === templateType;
        button.className = active ? MODE_ACTIVE : MODE_INACTIVE;
        button.setAttribute('aria-pressed', String(active));
    });
    setHidden(el.worldRow, draft.templateType !== 'world');
    el.world.value = draft.world;
}

async function switchMode(templateType) {
    if (!draft || draft.templateType === templateType) return;
    const target = draft;
    const surplus = templateType === 'world' ? surplusMonsters(target) : 0;
    if (surplus > 0) {
        const ok = await confirm(`Ein Kartenset hat genau ${TaskTypes.MONSTERS_PER_WORLD} Monster-Aufgaben. Die letzten ${surplus} gehen dabei verloren.`, {
            title: 'Zum Kartenset wechseln?', icon: '⚠️', okLabel: 'Wechseln', danger: true
        });
        if (!ok || draft !== target) return;
    }
    setTemplateType(draft, templateType);
    if (!draft.tasks.includes(selectedTask)) selectedTask = draft.tasks[0] || null;
    renderMode();
    renderTasks();
    refreshDerived();
}

// --- Editor öffnen und schließen ---------------------------------------------

function openEditor(nextDraft) {
    clearTimeout(refreshTimer);
    draft = nextDraft;
    baseline = serializeDraft(draft);
    showErrors = false;
    selectedTask = draft.tasks[0] || null;
    el.title.value = draft.title;
    renderMode();
    renderTasks();
    displayErrors({ general: [], perTask: new Map(), title: null });
    setHidden(el.placeholder, true);
    setHidden(el.editor, false);
    setHidden(el.dirty, true);
    preview.reset();
    preview.show(selectedTask);
    renderList();
}

function closeEditor() {
    clearTimeout(refreshTimer);
    stopAudioPlayback();
    draft = null;
    baseline = '';
    selectedTask = null;
    cards = new Map();
    clear(el.tasks);
    clear(el.monsters);
    setHidden(el.editor, true);
    setHidden(el.placeholder, false);
    refreshPager();
    preview.show(null);
    renderList();
}

// --- Speichern ---------------------------------------------------------------

function firstErrorElement(errors) {
    if (errors.title) return el.title;
    if (errors.general.length > 0) return el.generalErrors;
    const firstIndex = Math.min(...errors.perTask.keys());
    return cards.get(draft.tasks[firstIndex]).el;
}

/** Gesperrt bis zur Antwort: Nach dem Speichern schließt der Entwurf, spätere Eingaben gingen sonst verloren. */
function setSaving(active) {
    saving = active;
    el.save.disabled = active;
    el.editor.inert = active;
    el.sidebar.inert = active;
    el.editor.classList.toggle('opacity-60', active);
}

async function save() {
    if (!draft || saving) return;
    showErrors = true;
    const errors = validateDraft(draft);
    displayErrors(errors);
    if (errors.hasErrors) {
        firstErrorElement(errors).scrollIntoView({ behavior: 'smooth', block: 'center' });
        await alert('Die Spielrunde enthält noch Fehler. Sie stehen rot an den betroffenen Aufgaben.', { title: 'Noch nicht speicherbar', icon: '⚠️' });
        return;
    }

    setSaving(true);
    try {
        const payload = savePayload(draft);
        if (draft.id === null) await api.post('/api/blueprints', payload);
        else await api.patch(`/api/blueprints/${draft.id}`, payload);
        closeEditor();
        await reloadList();
        await alert('Die Spielrunde wurde gespeichert.', { title: 'Gespeichert', icon: '✅' });
    } catch (err) {
        if (err instanceof ApiError && err.code === 'INVALID_BLUEPRINT' && Array.isArray(err.details)) {
            displayErrors({ ...groupErrors(err.details), title: null });
            showErrors = false;
            await alert(formatErrorDetails(err.details).slice(0, 10).join('\n'), { title: 'Vom Server abgelehnt', icon: '❌' });
        } else {
            await showApiError(err, 'Speichern fehlgeschlagen', 'Die Spielrunde konnte nicht gespeichert werden.');
        }
    } finally {
        setSaving(false);
    }
}

// --- Liste, Export, Löschen, Import ------------------------------------------

function exportBlueprint(blueprint) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json' }));
    const link = h('a', { href: url, download: exportFilename(blueprint.title) });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deleteBlueprint(blueprint) {
    const ok = await confirm(`„${blueprint.title}“ wird unwiderruflich gelöscht. Laufende Sessions spielen ihren Stand weiter.`, {
        title: 'Spielrunde löschen', icon: '🗑️', okLabel: 'Löschen', danger: true
    });
    if (!ok) return;
    try {
        await api.delete(`/api/blueprints/${blueprint.id}`);
        if (draft && draft.id === blueprint.id) closeEditor();
    } catch (err) {
        await showApiError(err, 'Löschen fehlgeschlagen', 'Die Spielrunde konnte nicht gelöscht werden.');
        return;
    }
    await reloadList();
}

async function reloadList() {
    try {
        await loadBlueprints();
    } catch (err) {
        await showApiError(err, 'Liste nicht aktuell', 'Die Liste der Spielrunden konnte nicht neu geladen werden.');
    }
}

async function openBlueprint(blueprint) {
    if (draft && draft.id === blueprint.id) return;
    if (!await confirmDiscard()) return;
    try {
        openEditor(draftFromBlueprint(blueprint));
    } catch (err) {
        console.error(err);
        await alert('Diese Spielrunde konnte nicht geöffnet werden.', { title: 'Fehler', icon: '❌' });
    }
}

function listKind(content) {
    const templateType = content && content.templateType;
    if (templateType === 'world') return { label: `Kartenset: ${GameRules.worldName(content.world)}`, colors: 'bg-amber-600/20 text-amber-300' };
    if (templateType === 'qr') return { label: 'QR-Stationen', colors: 'bg-purple-600/20 text-purple-300' };
    return { label: 'Feste Reihenfolge', colors: 'bg-green-600/20 text-green-300' };
}

function renderList() {
    if (blueprints.length === 0) {
        mount(el.list, h('p', { class: 'text-sm text-slate-500' }, 'Noch keine Spielrunden vorhanden.'));
        return;
    }
    mount(el.list, blueprints.map((blueprint) => {
        const tasks = Array.isArray(blueprint.content && blueprint.content.tasks) ? blueprint.content.tasks.length : 0;
        const kind = listKind(blueprint.content);
        const active = draft !== null && draft.id === blueprint.id;
        return h('div', {
            class: ['flex items-start gap-1 p-2 bg-slate-900 border rounded-2xl', active ? 'border-blue-500' : 'border-slate-800 hover:border-blue-500']
        },
        h('button', {
            type: 'button',
            class: 'flex-1 min-w-0 text-left p-2',
            onClick: () => openBlueprint(blueprint)
        },
        h('span', { class: 'block font-black text-sm text-slate-100 break-words' }, blueprint.title),
        h('span', { class: 'flex flex-wrap gap-2 mt-2' },
            h('span', { class: 'text-xs bg-blue-600/20 text-blue-300 px-2 py-0.5 rounded font-bold' }, `${tasks} ${tasks === 1 ? 'Aufgabe' : 'Aufgaben'}`),
            h('span', { class: ['text-xs px-2 py-0.5 rounded font-bold', kind.colors] }, kind.label))),
        h('div', { class: 'flex flex-col' },
            h('button', {
                type: 'button',
                class: 'w-11 h-11 rounded-lg text-slate-400 hover:text-blue-400',
                title: 'Exportieren',
                'aria-label': `${blueprint.title} exportieren`,
                onClick: () => exportBlueprint(blueprint)
            }, '⬇️'),
            h('button', {
                type: 'button',
                class: 'w-11 h-11 rounded-lg text-slate-400 hover:text-red-400',
                title: 'Löschen',
                'aria-label': `${blueprint.title} löschen`,
                onClick: () => deleteBlueprint(blueprint)
            }, '🗑️')));
    }));
}

async function loadBlueprints() {
    const data = await api.get('/api/blueprints');
    blueprints = data.blueprints;
    renderList();
}

async function importFile(file) {
    try {
        if (file.size > MAX_IMPORT_BYTES) throw new ImportError('Die Datei ist zu groß.');
        const parsed = parseImport(await file.text());
        await api.post('/api/blueprints', parsed);
        await reloadList();
        await alert('Die Spielrunde wurde importiert.', { title: 'Importiert', icon: '✅' });
    } catch (err) {
        if (err instanceof ImportError) {
            await alert(err.message, { title: 'Import nicht möglich', icon: '❌' });
        } else if (err instanceof ApiError && Array.isArray(err.details)) {
            await alert(formatErrorDetails(err.details).slice(0, 10).join('\n'), { title: 'Import nicht möglich', icon: '❌' });
        } else {
            await showApiError(err, 'Import fehlgeschlagen', 'Die Datei konnte nicht importiert werden.');
        }
    }
}

// --- Verdrahtung -------------------------------------------------------------

byId('newBlueprintButton').addEventListener('click', async () => {
    if (await confirmDiscard()) openEditor(newDraft());
});

byId('cancelButton').addEventListener('click', async () => {
    if (await confirmDiscard()) closeEditor();
});

el.save.addEventListener('click', save);

el.addTask.addEventListener('click', () => {
    const task = addTask(draft);
    selectedTask = task;
    renderTasks();
    refreshDerived();
    const card = cards.get(task).el;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const select = card.querySelector('select');
    if (select) select.focus({ preventScroll: true });
});

el.title.addEventListener('input', () => {
    draft.title = el.title.value;
    scheduleRefresh();
});

el.modeNormal.addEventListener('click', () => switchMode('normal'));
el.modeQr.addEventListener('click', () => switchMode('qr'));
el.modeWorld.addEventListener('click', () => switchMode('world'));

mount(el.world, h('option', { value: '' }, 'Welt wählen …'),
    TaskTypes.WORLD_KEYS.map((key) => h('option', { value: key }, GameRules.worldName(key))));
el.world.addEventListener('change', () => {
    draft.world = el.world.value;
    renderTasks();
    scheduleRefresh();
});

byId('importButton').addEventListener('click', () => el.importFile.click());
el.importFile.addEventListener('change', async () => {
    const file = el.importFile.files[0];
    if (!file) return;
    await importFile(file);
    el.importFile.value = '';
});

function step(delta) {
    if (!draft) return;
    const next = draft.tasks[draft.tasks.indexOf(selectedTask) + delta];
    if (next) selectTask(next);
}
el.previewPrev.addEventListener('click', () => step(-1));
el.previewNext.addEventListener('click', () => step(1));

window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
        event.preventDefault();
        event.returnValue = '';
    }
});

async function boot() {
    preview.show(null);
    try {
        const me = await api.get('/api/me');
        if (!me.loggedIn) {
            location.href = '/login.html';
            return;
        }
        byId('teacherUsername').textContent = me.username;
        await loadBlueprints();
    } catch (err) {
        await showApiError(err, 'Fehler', 'Die Spielrunden konnten nicht geladen werden.');
    }
}

boot();
