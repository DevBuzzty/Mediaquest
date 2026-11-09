/*
 * format.js: Anzeige-Logik ohne DOM. Antworten stammen von Teams und sind ungeprüft, deshalb
 * vertragen alle Funktionen hier beliebige Formen. Es wird nichts bewertet, nur wiedergegeben.
 */

const TaskTypes = globalThis.TaskTypes;

const MAX_TEXT = 500;
const MAX_ITEMS = 60;
const MIN_TEAMS = 1;
const MAX_TEAMS = 10;
const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_BYTES = 72;
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []);

function asText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** Nur eigene Upload-Pfade dürfen als Bild oder Link eingesetzt werden. */
export function safeUploadUrl(value) {
    return typeof value === 'string' && UPLOAD_URL.test(value) ? value : null;
}

/** Ein Listeneintrag: Index in die Definition der Aufgabe oder schon der Text. */
function resolveLabel(entry, source, pick = (item) => item) {
    if (Number.isInteger(entry) && Array.isArray(source) && source[entry] !== undefined) {
        return asText(pick(source[entry]));
    }
    return asText(entry);
}

function chatChoice(step, task) {
    const node = isObject(step) && isObject(task.nodes) ? task.nodes[step.node] : null;
    const choice = isObject(step) ? step.choice : step;
    return resolveLabel(choice, isObject(node) ? node.options : null, (option) => (isObject(option) ? option.label : option));
}

const ANSWER_LINES = {
    binary: (a) => (a.choice === 'left' ? ['Nach links gewischt'] : a.choice === 'right' ? ['Nach rechts gewischt'] : []),
    choice: (a, task) => {
        const label = a.label !== undefined ? asText(a.label) : resolveLabel(a.index, task.options);
        return label === '' ? [] : [label];
    },
    select: (a, task) => {
        const source = Array.isArray(a.labels) ? a.labels : listOf(a.indices).map((index) => resolveLabel(index, task.options));
        const labels = listOf(source).map(asText);
        return labels.length ? labels : ['Nichts ausgewählt'];
    },
    chat: (a, task) => listOf(a.path).map((step) => chatChoice(step, task)).filter(Boolean),
    scroller: (a, task) => {
        const marked = listOf(a.marked);
        if (!marked.length) return ['Keine Posts markiert'];
        return [`Markierte Posts: ${marked.length}`,
            ...marked.map((entry) => resolveLabel(entry, task.posts, (post) => (isObject(post) ? `${asText(post.user)}: ${asText(post.text)}` : post)))];
    },
    hotspot: (a, task) => {
        if (!Array.isArray(a.found)) return [];
        const total = Array.isArray(task.zones) ? ` von ${task.zones.length}` : '';
        return [`Gefundene Bereiche: ${a.found.length}${total}`];
    },
    password: (a) => {
        const lines = [];
        if (Number.isInteger(a.length)) lines.push(`Passwortlänge: ${a.length} Zeichen`);
        if (Array.isArray(a.rulesMet)) lines.push(`Regeln erfüllt: ${a.rulesMet.filter(Boolean).length} von ${a.rulesMet.length}`);
        return lines;
    },
    statement: (a) => (a.text === undefined ? [] : [asText(a.text)]),
    profile: (a) => (isObject(a.fields)
        ? Object.entries(a.fields).slice(0, MAX_ITEMS).map(([name, value]) => `${asText(name)}: ${asText(value)}`)
        : []),
    mood: (a, task) => {
        if (a.value === undefined) return [];
        const scale = task.labelLeft && task.labelRight ? ` (${asText(task.labelLeft)} bis ${asText(task.labelRight)})` : '';
        return [`Wert: ${asText(a.value)} von 100${scale}`];
    },
    bucket: (a, task) => listOf(a.placements).map((placement) => {
        if (!isObject(placement)) return asText(placement);
        const item = resolveLabel(placement.item, task.items, (entry) => (isObject(entry) ? entry.text : entry));
        return `${item} → ${resolveLabel(placement.bucket, task.buckets)}`;
    }),
    ranking: (a) => listOf(a.order).map((entry, index) => `${index + 1}. ${asText(entry)}`),
    pairs: (a) => (Array.isArray(a.assignments)
        ? listOf(a.assignments).map((entry) => (isObject(entry) ? `${asText(entry.left)} ↔ ${asText(entry.right)}` : asText(entry)))
        : (a.matched === undefined ? [] : [`Gefundene Paare: ${asText(a.matched)}`])),
    cloze: (a) => listOf(a.gaps).map((word, index) => `Lücke ${index + 1}: ${asText(word)}`),
    countdown: (a) => (a.expired === true ? ['Zeit abgelaufen'] : a.expired === false ? ['Vor Ablauf beendet'] : [])
};

/**
 * Macht aus einer Antwort anzeigbare Zeilen.
 * @returns {{ lines: string[], image: string|null }}
 */
export function formatAnswer(type, answer, task) {
    if (answer === null || answer === undefined) return { lines: [], image: null };
    const definition = isObject(task) ? task : {};
    const image = type === 'photo' && isObject(answer) ? safeUploadUrl(answer.url) : null;
    let lines = [];
    if (isObject(answer) && Object.prototype.hasOwnProperty.call(ANSWER_LINES, type)) {
        try {
            lines = ANSWER_LINES[type](answer, definition);
        } catch {
            lines = [];
        }
    }
    if (lines.length === 0 && !image) lines = [asText(answer)];
    return { lines, image };
}

export const STATUS_LABELS = {
    pending: 'Offen',
    started: 'In Arbeit',
    completed: 'Abgeschlossen',
    skipped: 'Übersprungen'
};

const QR_STATUS_LABELS = { ...STATUS_LABELS, skipped: 'Abgebrochen' };

const STATUS_MARKS = { pending: '', started: '…', completed: '✓', skipped: '✕' };

function statusLine(progress, tasks, finished, isQr, running) {
    if (finished) {
        const allDone = progress.total > 0 && progress.completed + (isQr ? 0 : progress.skipped) === progress.total;
        return { kind: 'finished', heading: 'Fertig', detail: allDone ? 'Alle Aufgaben erledigt' : 'Hat das Spiel beendet' };
    }
    if (!running) return { kind: 'idle', heading: '', detail: 'Wartet auf Start...' };
    if (isQr) {
        const open = tasks.filter((task) => task.status === 'started').pop();
        return open
            ? { kind: 'active', heading: 'Aktuelle Station', detail: asText(open.title) }
            : { kind: 'idle', heading: '', detail: 'Keine Station geöffnet' };
    }
    const current = tasks.find((task) => task.index === progress.currentIndex);
    if (!current) return { kind: 'idle', heading: '', detail: 'Wartet auf Start...' };
    const untouched = progress.completed + progress.skipped === 0 && current.status === 'pending';
    return untouched
        ? { kind: 'idle', heading: '', detail: 'Noch nicht begonnen' }
        : { kind: 'active', heading: 'Aktuelle Aufgabe', detail: asText(current.title) };
}

/** Monster-Aufgabe, die dieses Team gerade stoppt, nach denselben Regeln wie der Server. */
function openMonster(raw, tasks, definitions, finished, isQr, running) {
    if (finished || !running) return null;
    const entry = tasks.find((task) => task.type === 'monster'
        && task.status !== 'completed'
        && (isQr ? task.status === 'started' : task.key === raw.currentTaskKey));
    return entry ? { key: entry.key, title: asText(entry.title), task: definitions.get(entry.key) || null } : null;
}

/**
 * Alles, was eine Team-Karte zeigt. Dieselbe Funktion für Live-Stand und Reload,
 * damit beide Ansichten gleich sind.
 */
export function teamView(team, blueprint, running) {
    const raw = isObject(team.progress) ? team.progress : {};
    const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    const progress = {
        total: Number(raw.total) || 0,
        completed: Number(raw.completed) || 0,
        skipped: Number(raw.skipped) || 0,
        currentIndex: raw.currentIndex
    };
    const isQr = Boolean(blueprint && blueprint.templateType === 'qr');
    const finished = Boolean(raw.finished || team.finished_at);
    const labels = isQr ? QR_STATUS_LABELS : STATUS_LABELS;
    const results = new Map((Array.isArray(team.results) ? team.results : []).map((row) => [row.task_key, row]));
    const definitions = new Map((blueprint && Array.isArray(blueprint.tasks) ? blueprint.tasks : []).map((task) => [task.key, task]));
    const done = isQr ? progress.completed : progress.completed + progress.skipped;
    const skippedWord = isQr ? 'abgebrochen' : 'übersprungen';

    return {
        id: team.id,
        name: asText(team.name),
        color: team.color,
        initial: Array.from(asText(team.name))[0] || '?',
        teamCode: asText(team.team_code),
        groupSize: asText(team.group_size),
        finished,
        status: statusLine(progress, tasks, finished, isQr, running),
        monster: openMonster(raw, tasks, definitions, finished, isQr, running),
        progressText: `${progress.completed} von ${progress.total} erledigt${progress.skipped ? `, ${progress.skipped} ${skippedWord}` : ''}`,
        percent: progress.total ? Math.min(100, Math.round((done / progress.total) * 100)) : 0,
        hasActivity: tasks.some((task) => task.status !== 'pending') || finished,
        steps: tasks.map((task) => ({
            number: task.index + 1,
            status: task.status,
            mark: STATUS_MARKS[task.status] || '',
            label: `${isQr ? 'Station' : 'Aufgabe'} ${task.index + 1}: ${asText(task.title)} (${labels[task.status] || asText(task.status)})`
        })),
        answers: tasks.filter((task) => task.status !== 'pending').map((task) => {
            const result = results.get(task.key);
            return {
                key: task.key,
                title: asText(task.title),
                typeIcon: (TaskTypes.get(task.type) || {}).icon || '🎮',
                status: labels[task.status] || asText(task.status),
                ...formatAnswer(task.type, result ? result.answer : null, definitions.get(task.key))
            };
        })
    };
}

/** Prüft ein Team-Limit aus einem Eingabefeld. */
export function parseTeamLimit(raw, minimum = MIN_TEAMS) {
    const text = String(raw === null || raw === undefined ? '' : raw).trim();
    const value = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
    if (!(value >= MIN_TEAMS && value <= MAX_TEAMS)) {
        return { error: `Bitte gib eine ganze Zahl von ${MIN_TEAMS} bis ${MAX_TEAMS} ein.` };
    }
    if (value < minimum) {
        return { error: `Das Limit kann nicht kleiner als die aktuelle Teamanzahl (${minimum}) sein.` };
    }
    return { value };
}

/** Prüft das Formular "Passwort ändern". Liefert einen Fehlertext oder null. */
export function passwordChangeError({ current, next, repeat }) {
    if (!current) return 'Bitte gib dein aktuelles Passwort ein.';
    if (next.length < PASSWORD_MIN_CHARS) return `Das neue Passwort braucht mindestens ${PASSWORD_MIN_CHARS} Zeichen.`;
    if (new TextEncoder().encode(next).length > PASSWORD_MAX_BYTES) return 'Das neue Passwort ist zu lang.';
    if (next !== repeat) return 'Die beiden neuen Passwörter stimmen nicht überein.';
    if (next === current) return 'Das neue Passwort muss sich vom alten unterscheiden.';
    return null;
}

export function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? asText(value) : date.toLocaleString('de-DE');
}

export function sessionStatusLabel(status) {
    return status === 'active' ? 'Aktiv' : 'Beendet';
}

/** Kartensets sind nur fürs Brettspiel, als einzelne Spielrunde lehnt der Server sie ab. */
export function isKartenset(blueprint) {
    return Boolean(blueprint && blueprint.content && blueprint.content.templateType === 'world');
}

export function blueprintTaskCount(blueprint) {
    const tasks = blueprint && blueprint.content ? blueprint.content.tasks : null;
    return Array.isArray(tasks) ? tasks.length : 0;
}

/** Beschriftung einer Spielrunde in Auswahllisten. */
export function blueprintOptionLabel(blueprint) {
    const isQr = blueprint.content && blueprint.content.templateType === 'qr';
    const count = blueprintTaskCount(blueprint);
    const noun = isQr ? (count === 1 ? 'Station' : 'Stationen') : (count === 1 ? 'Aufgabe' : 'Aufgaben');
    return `${asText(blueprint.title)} (${count} ${noun})`;
}
