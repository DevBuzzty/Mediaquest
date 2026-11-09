/*
 * store.js: Zustand und Regeln des Spielrunden-Editors, ohne DOM.
 *
 * Ein "Entwurf" ist { id, title, templateType, world, tasks }. Jede Aufgabe ist genau ein Objekt in
 * draft.tasks und die einzige Quelle der Wahrheit: Formulare schreiben bei jeder Eingabe hinein
 * und werden nur daraus gezeichnet. Ein Entwurf ist immer eine tiefe Kopie, Abbrechen verwirft ihn.
 * In einem Kartenset (templateType "world") stehen erst die Karten, dann genau die drei
 * Monster-Aufgaben in der Reihenfolge der Felder 8, 16, 24.
 */

const TT = () => globalThis.TaskTypes;

export const MAX_TITLE_LENGTH = 120;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MIN_ZONE_PERCENT = 1;

// Felder, die bei einem Typwechsel dieselbe Bedeutung und Form behalten. "items" gehört nicht
// dazu: Bucket speichert Objekte, Ranking Texte.
const COMPATIBLE_FIELDS = ['options', 'image'];
const TEMPLATE_TYPES = ['normal', 'qr', 'world'];

const CHAT_NODE_ID = /^[\p{L}\p{N}_-]{1,40}$/u;

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Entwurf -----------------------------------------------------------------

const isMonster = (task) => task.type === 'monster';

function ensureCodes(draft) {
    if (draft.templateType === 'qr') TT().ensureStationCodes(draft.tasks);
    // Monster-Aufgaben eines Kartensets lassen sich nicht scannen.
    if (draft.templateType === 'world') TT().ensureStationCodes(draft.tasks.filter((task) => !isMonster(task)));
}

function arrangeWorld(draft) {
    const monsters = draft.tasks.filter(isMonster).slice(0, TT().MONSTERS_PER_WORLD);
    while (monsters.length < TT().MONSTERS_PER_WORLD) monsters.push(TT().createTask('monster'));
    draft.tasks = [...draft.tasks.filter((task) => !isMonster(task)), ...monsters];
}

function defaultTaskType() {
    const offered = TT().EDITOR_TYPES;
    return offered.includes('choice') ? 'choice' : offered[0];
}

export function newDraft() {
    return { id: null, title: '', templateType: 'normal', world: '', tasks: [TT().createTask(defaultTaskType())] };
}

/** Tiefe Kopie einer gespeicherten Spielrunde; fehlende optionale Felder bekommen ihre Startwerte. */
export function draftFromBlueprint(blueprint) {
    const content = isPlainObject(blueprint.content) ? blueprint.content : {};
    const sourceTasks = Array.isArray(content.tasks) ? content.tasks : [];
    const tasks = sourceTasks.map((source) => {
        if (!isPlainObject(source) || !TT().get(source.type)) {
            throw new Error('Unbekannter Aufgaben-Typ');
        }
        return Object.assign(TT().createTask(source.type), clone(source));
    });
    const draft = {
        id: blueprint.id,
        title: typeof blueprint.title === 'string' ? blueprint.title : '',
        templateType: TEMPLATE_TYPES.includes(content.templateType) ? content.templateType : 'normal',
        world: typeof content.world === 'string' ? content.world : '',
        tasks
    };
    if (draft.templateType === 'world') arrangeWorld(draft);
    ensureCodes(draft);
    return draft;
}

export function serializeDraft(draft) {
    return JSON.stringify([draft.title, draft.templateType, draft.world, draft.tasks]);
}

/** Wie viele Monster-Aufgaben ein Wechsel zum Kartenset verwerfen würde. */
export function surplusMonsters(draft) {
    return Math.max(0, draft.tasks.filter(isMonster).length - TT().MONSTERS_PER_WORLD);
}

function isUntouchedMonster(task) {
    return isMonster(task) && [task.question, task.description, task.image, task.audio].every((value) => !value || isBlank(value));
}

export function setTemplateType(draft, templateType) {
    const leavesWorld = draft.templateType === 'world';
    draft.templateType = TEMPLATE_TYPES.includes(templateType) ? templateType : 'normal';
    if (draft.templateType === 'world') arrangeWorld(draft);
    // Die drei Plätze hat der Wechsel zum Kartenset angelegt; leer wären sie jetzt nur noch Fehler.
    else if (leavesWorld) draft.tasks = draft.tasks.filter((task) => !isUntouchedMonster(task));
    ensureCodes(draft);
}

export function addTask(draft, type = defaultTaskType()) {
    const task = TT().createTask(type);
    const firstMonster = draft.templateType === 'world' ? draft.tasks.findIndex(isMonster) : -1;
    if (firstMonster === -1) draft.tasks.push(task);
    else draft.tasks.splice(firstMonster, 0, task);
    ensureCodes(draft);
    return task;
}

export function removeTask(draft, task) {
    if (draft.templateType === 'world' && isMonster(task)) return;
    const index = draft.tasks.indexOf(task);
    if (index !== -1) draft.tasks.splice(index, 1);
}

// --- Typwechsel --------------------------------------------------------------

function keptFields(task, newType) {
    const target = TT().get(newType);
    const kept = {};
    if (task.id !== undefined) kept.id = task.id;
    if (task.code !== undefined) kept.code = task.code;
    if (task.audio !== undefined) kept.audio = task.audio;
    kept.description = task.description === undefined ? '' : task.description;
    kept.question = task.question === undefined ? '' : task.question;
    COMPATIBLE_FIELDS.forEach((key) => {
        if (target.fields.includes(key) && task[key] !== undefined) kept[key] = clone(task[key]);
    });
    return kept;
}

/** true, wenn ein Wechsel eingegebene Daten verwerfen würde (dann fragt der Editor nach). */
export function typeChangeLosesData(task, newType) {
    const current = TT().get(task.type);
    const target = TT().get(newType);
    if (!current || !target || task.type === newType) return false;
    const defaults = current.defaultData();
    return current.fields.some((key) => {
        if (COMPATIBLE_FIELDS.includes(key) && target.fields.includes(key)) return false;
        return JSON.stringify(task[key]) !== JSON.stringify(defaults[key]);
    });
}

/** Ändert das Objekt an Ort und Stelle, damit Verweise darauf gültig bleiben. */
export function changeTaskType(task, newType) {
    const replacement = Object.assign(TT().createTask(newType), keptFields(task, newType));
    Object.keys(task).forEach((key) => delete task[key]);
    Object.assign(task, replacement);
    return task;
}

// --- Antwortmöglichkeiten -----------------------------------------------------

/** Entfernt eine Antwort. Die Lösung zeigt per Index darauf und rückt deshalb mit. */
export function removeOption(task, index) {
    task.options.splice(index, 1);
    if (Array.isArray(task.correct)) {
        task.correct = task.correct.filter((entry) => entry !== index).map((entry) => (entry > index ? entry - 1 : entry));
    } else if (task.correct === index) {
        task.correct = null;
    } else if (Number.isInteger(task.correct) && task.correct > index) {
        task.correct -= 1;
    }
}

// --- Bucket ------------------------------------------------------------------

/** Entfernt einen Korb. Ziele dahinter rücken nach, Begriffe im gelöschten Korb verlieren ihr Ziel. */
export function removeBucket(task, index) {
    task.buckets.splice(index, 1);
    task.items.forEach((item) => {
        if (item.target === index) item.target = null;
        else if (Number.isInteger(item.target) && item.target > index) item.target -= 1;
    });
}

// --- Chat --------------------------------------------------------------------

export function addChatNode(task) {
    let number = Object.keys(task.nodes).length;
    let id;
    do {
        number += 1;
        id = `knoten-${number}`;
    } while (Object.prototype.hasOwnProperty.call(task.nodes, id));
    task.nodes[id] = { text: '', options: [] };
    return id;
}

/** Entfernt einen Knoten. Antworten, die darauf zeigten, werden ziellos und von der Prüfung gemeldet. */
export function removeChatNode(task, id) {
    if (id === 'start') return;
    delete task.nodes[id];
    Object.values(task.nodes).forEach((node) => {
        node.options.forEach((option) => {
            if (option.next === id) option.next = '';
        });
    });
}

/** Benennt einen Knoten um und zieht alle Verweise nach. Liefert einen Fehlertext oder null. */
export function renameChatNode(task, oldId, newIdRaw) {
    const newId = String(newIdRaw).trim();
    if (newId === oldId) return null;
    if (oldId === 'start') return 'Der Knoten „start“ kann nicht umbenannt werden.';
    if (!CHAT_NODE_ID.test(newId) || newId === '__proto__') {
        return 'Knoten-Namen dürfen nur aus Buchstaben, Ziffern, _ und - bestehen (höchstens 40 Zeichen).';
    }
    if (Object.prototype.hasOwnProperty.call(task.nodes, newId)) return `Den Knoten „${newId}“ gibt es schon.`;
    task.nodes = Object.fromEntries(Object.entries(task.nodes).map(([id, node]) => [id === oldId ? newId : id, node]));
    Object.values(task.nodes).forEach((node) => {
        node.options.forEach((option) => {
            if (option.next === oldId) option.next = newId;
        });
    });
    return null;
}

// --- Hotspot -----------------------------------------------------------------

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function round(value) {
    return Math.round(value * 100) / 100;
}

export function pointToPercent(clientX, clientY, rect) {
    return {
        x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
        y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100)
    };
}

export function rectFromPoints(a, b) {
    return {
        x: round(Math.min(a.x, b.x)),
        y: round(Math.min(a.y, b.y)),
        w: round(Math.abs(a.x - b.x)),
        h: round(Math.abs(a.y - b.y))
    };
}

/** Rechteck aus zwei Punkten oder null, wenn es für eine Trefferzone zu klein ist. */
export function zoneFromPoints(a, b) {
    const zone = rectFromPoints(a, b);
    return zone.w >= MIN_ZONE_PERCENT && zone.h >= MIN_ZONE_PERCENT ? zone : null;
}

// --- Speichern und Prüfen ----------------------------------------------------

function isBlank(value) {
    return typeof value === 'string' && value.trim() === '';
}

const dropBlank = (list) => list.filter((entry) => !isBlank(entry));

const BLANK_ROW_CLEANERS = {
    choice: { options: dropBlank },
    select: { options: dropBlank },
    ranking: { items: dropBlank },
    password: { rules: dropBlank },
    cloze: { fakes: dropBlank },
    profile: { customFields: dropBlank },
    scroller: { posts: (posts) => posts.filter((post) => !(isBlank(post.user) && isBlank(post.text))) },
    bucket: { items: (items) => items.filter((item) => !isBlank(item.text)) },
    pairs: { pairs: (pairs) => pairs.filter((pair) => !(isBlank(pair.left) && isBlank(pair.right))) }
};

/** Leere Zeilen fallen gleich weg: Die Lösung muss danach noch auf dieselben Antworten zeigen. */
function keepCorrectOnBlankRows(clean) {
    if ((clean.type !== 'choice' && clean.type !== 'select') || !Array.isArray(clean.options)) return;
    const newIndex = new Map();
    clean.options.forEach((option, index) => {
        if (!isBlank(option)) newIndex.set(index, newIndex.size);
    });
    if (Array.isArray(clean.correct)) {
        clean.correct = clean.correct.filter((entry) => newIndex.has(entry)).map((entry) => newIndex.get(entry));
    } else if (Number.isInteger(clean.correct)) {
        clean.correct = newIndex.has(clean.correct) ? newIndex.get(clean.correct) : null;
    }
}

/**
 * Kopie einer Aufgabe, wie sie gespeichert wird: nur Felder des Typs, ohne leere Zusatzzeilen.
 * Körbe bleiben absichtlich stehen: Ein gefilterter Korb würde die Ziele der Begriffe verschieben.
 */
export function cleanTask(task) {
    const clean = TT().sanitizeTask(task);
    keepCorrectOnBlankRows(clean);
    const cleaners = BLANK_ROW_CLEANERS[clean.type];
    if (cleaners) {
        Object.entries(cleaners).forEach(([key, cleaner]) => {
            if (Array.isArray(clean[key])) clean[key] = cleaner(clean[key]);
        });
    }
    return clean;
}

export function toContent(draft) {
    const content = { templateType: draft.templateType, tasks: draft.tasks.map(cleanTask) };
    if (draft.templateType === 'world') content.world = draft.world;
    return content;
}

export function validateTitle(title) {
    const trimmed = typeof title === 'string' ? title.trim() : '';
    if (!trimmed) return 'Bitte gib einen Namen für die Spielrunde ein.';
    if (trimmed.length > MAX_TITLE_LENGTH) return `Der Name darf höchstens ${MAX_TITLE_LENGTH} Zeichen lang sein.`;
    return null;
}

/** Gruppiert [{ taskIndex, message }] in { general: [...], perTask: Map(index -> [...]) }. */
export function groupErrors(details) {
    const general = [];
    const perTask = new Map();
    details.forEach(({ taskIndex, message }) => {
        if (taskIndex === null || taskIndex === undefined) {
            general.push(message);
        } else {
            if (!perTask.has(taskIndex)) perTask.set(taskIndex, []);
            perTask.get(taskIndex).push(message);
        }
    });
    return { general, perTask };
}

export function validateDraft(draft) {
    const result = groupErrors(TT().validateContent(toContent(draft)));
    const title = validateTitle(draft.title);
    return { ...result, title, hasErrors: Boolean(title) || result.general.length > 0 || result.perTask.size > 0 };
}

export function savePayload(draft) {
    return { title: draft.title.trim(), content: toContent(draft) };
}

export function formatErrorDetails(details) {
    return details.map(({ taskIndex, message }) => (
        taskIndex === null || taskIndex === undefined ? message : `Aufgabe ${taskIndex + 1}: ${message}`
    ));
}

// --- Import und Export -------------------------------------------------------

export class ImportError extends Error {}

/** Prüft eine exportierte Datei vollständig; bei Erfolg { title, content }, sonst ImportError. */
export function parseImport(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new ImportError('Die Datei enthält kein gültiges JSON.');
    }
    if (!isPlainObject(data) || typeof data.title !== 'string' || !data.title.trim() || !isPlainObject(data.content)) {
        throw new ImportError('Die Datei ist keine exportierte Spielrunde.');
    }
    if (!Array.isArray(data.content.tasks)) throw new ImportError('Die Datei enthält keine Aufgaben-Liste.');

    const suffix = ' (Import)';
    const content = {
        templateType: data.content.templateType === undefined ? 'normal' : data.content.templateType,
        tasks: data.content.tasks.map((task) => TT().sanitizeTask(task))
    };
    if (content.templateType === 'world') content.world = data.content.world;
    ensureCodes(content);
    const details = TT().validateContent(content);
    if (details.length > 0) {
        throw new ImportError(`Die Spielrunde enthält Fehler:\n${formatErrorDetails(details).slice(0, 10).join('\n')}`);
    }
    return { title: data.title.trim().slice(0, MAX_TITLE_LENGTH - suffix.length) + suffix, content };
}

export function exportFilename(title) {
    const safe = String(title).trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80);
    return `Weltenretter_Spielrunde_${safe || 'Export'}.json`;
}
