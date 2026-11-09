/*
 * flow.js: reine Ablauf-Logik der Schüler-Seite, ohne DOM und ohne Netz.
 *
 * Der Zustand S ist ein einfaches Objekt (siehe main.js). computeView leitet daraus
 * ab, was zu sehen ist; so gibt es genau eine Stelle für alle Phasenwechsel.
 */

export const NETWORK_CODES = new Set(['DISCONNECTED', 'TIMEOUT']);

// Der Server-Stand passt nicht mehr zur Anzeige: neu laden statt erneut senden.
export const RESYNC_CODES = new Set(['UNKNOWN_TASK', 'NOT_RUNNING', 'TEAM_GONE', 'SESSION_CLOSED', 'NOT_QR', 'ALREADY_FINISHED', 'STATION_NOT_OPEN', 'NOT_IN_ROUND', 'NO_CARD', 'NOT_BOARD', 'CARD_ALREADY_OPEN']);

const MAX_ANSWER_BYTES = 15 * 1024;
const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export function normalizeCode(value) {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidCode(code) {
    return CODE_PATTERN.test(code);
}

/** Gruppengröße aus dem Eingabefeld; null, wenn ungültig. */
export function parseGroupSize(value) {
    const size = Number(value);
    return Number.isInteger(size) && size >= 1 && size <= 10 ? size : null;
}

export function isQr(team) {
    return Boolean(team && team.blueprint && team.blueprint.templateType === 'qr');
}

// --- Brettspiel ----------------------------------------------------------------

export function isBoard(team) {
    return Boolean(team) && team.gameMode === 'board';
}

/** Die eigene Karte, solange sie zur laufenden Runde gehört, sonst null. */
export function liveCard(team) {
    const board = team && team.board;
    const card = team && team.card;
    if (!board || !card || board.phase !== 'round' || card.round !== board.round) return null;
    return card;
}

/** Unterbrochenes Spiel, und diese Karte ist noch offen? Dann bleibt ihr Stand im Hintergrund erhalten. */
export function isPausedOnCard(team, key) {
    if (!isBoard(team) || !team.board || team.board.gameStatus === 'running') return false;
    const card = liveCard(team);
    return Boolean(card) && card.taskKey === key && card.status === 'working';
}

/** Ändert sich dieser Wert, ist ein offener Dialog zur Karte hinfällig; null außerhalb des Brettspiels. */
export function boardDialogKey(team) {
    if (!isBoard(team) || !team.board) return null;
    const card = liveCard(team);
    return [team.board.phase, team.board.round, card ? card.taskKey : '', card ? card.status : ''].join(':');
}

/** Bildschirm im Brettspiel: lobby, qr (Karte holen), task (Karte spielen) oder board (Spielbrett mit Phasen-Anzeige). */
export function boardScreen(team) {
    const board = team.board;
    if (!board || board.phase === 'lobby') return 'lobby';
    if (board.phase === 'finished') return 'board';
    if (board.gameStatus !== 'running') return 'lobby';
    if (board.phase !== 'round') return 'board';
    const card = liveCard(team);
    if (!card) return 'qr';
    return card.status === 'working' && card.task ? 'task' : 'board';
}

/** Übernimmt einen boardState. Eine Karte aus einer früheren Runde oder Phase wird dabei vergessen. */
export function applyBoardState(S, board) {
    if (!S.team) return;
    S.team.board = board;
    if (!liveCard(S.team)) S.team.card = null;
    reconcile(S);
}

/** Spalte und Zeile eines Feldes in der Schlangen-Anordnung: 1 oben links, jede zweite Zeile läuft zurück. */
export function snakeCell(field, columns = 5) {
    const index = field - 1;
    const row = Math.floor(index / columns);
    const offset = index % columns;
    return { row, col: row % 2 === 0 ? offset : columns - 1 - offset };
}

/** Feldnummern in Anzeige-Reihenfolge (zeilenweise von links nach rechts). */
export function snakeOrder(fields = 25, columns = 5) {
    const order = [];
    for (let row = 0; row < Math.ceil(fields / columns); row += 1) {
        const line = [];
        for (let offset = 0; offset < columns; offset += 1) {
            const field = row * columns + offset + 1;
            if (field <= fields) line.push(field);
        }
        order.push(...(row % 2 === 0 ? line : line.reverse()));
    }
    return order;
}

/** Die Felder, über die die Figur läuft, einschließlich Start und Ziel. Leer, wenn sie nicht vorwärts läuft. */
export function walkPath(from, to) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) return [];
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

// --- Einzelne Spielrunde --------------------------------------------------------

function taskStatus(team, key) {
    const tasks = team && team.progress && Array.isArray(team.progress.tasks) ? team.progress.tasks : [];
    const entry = tasks.find((task) => task.key === key);
    return entry ? entry.status : null;
}

export function blueprintTask(team, key) {
    const tasks = team && team.blueprint && Array.isArray(team.blueprint.tasks) ? team.blueprint.tasks : [];
    return tasks.find((task) => task.key === key) || null;
}

/** Die Aufgabe, die jetzt gespielt wird, oder null. */
export function currentTask(S) {
    const team = S.team;
    if (isBoard(team)) return boardScreen(team) === 'task' ? liveCard(team).task : null;
    if (!team || team.phase !== 'running' || !team.blueprint || !team.progress) return null;
    if (isQr(team)) return S.station ? S.station.task : null;
    return blueprintTask(team, team.progress.currentTaskKey);
}

/** Was unter einer eventuell geöffneten Ergebnis-Ansicht liegt. */
export function baseView(S) {
    if (S.ended) return { screen: 'ended' };
    if (S.loading) return { screen: 'loading' };
    const team = S.team;
    if (!team) return { screen: S.entry };
    if (isBoard(team)) return { screen: boardScreen(team) };
    if (team.phase === 'lobby') return { screen: 'lobby' };
    if (team.phase === 'finished') return { screen: 'finished' };
    if (isQr(team)) return { screen: S.station ? 'task' : 'qr' };
    return currentTask(S) ? { screen: 'task' } : { screen: 'finished' };
}

export function computeView(S) {
    const base = baseView(S);
    if (S.showResults && S.team && base.screen !== 'ended') return { screen: 'results' };
    return base;
}

/**
 * Gleicht Station und ausstehendes Ergebnis mit dem Server-Stand ab.
 * Eine Spielrunde kann währenddessen gewechselt oder beendet worden sein.
 */
export function reconcile(S) {
    const team = S.team;
    if (isBoard(team)) {
        S.station = null;
        if (S.pending) {
            const card = liveCard(team);
            if (!card || card.taskKey !== S.pending.taskKey || card.status !== 'working') S.pending = null;
        }
        return;
    }
    const running = Boolean(team && team.phase === 'running' && team.blueprint);

    if (S.station) {
        // Nur eine vom Server als geöffnet geführte Station kann gespielt werden.
        const stale = !running || !isQr(team) || !blueprintTask(team, S.station.key)
            || taskStatus(team, S.station.key) !== 'started';
        if (stale) S.station = null;
    }

    // Eine offene Monster-Station bleibt auch nach einem Neuladen der Stopp-Bildschirm.
    if (!S.station && running && isQr(team)) {
        const open = (team.blueprint.tasks || []).find((task) => task.type === 'monster' && taskStatus(team, task.key) === 'started');
        if (open) S.station = { key: open.key, task: open };
    }

    if (S.pending) {
        const key = S.pending.taskKey;
        const status = taskStatus(team, key);
        const settled = !running || !blueprintTask(team, key) || status === 'completed'
            || (S.pending.status === 'skipped' && status === 'skipped');
        if (settled) {
            if (S.station && S.station.key === key) S.station = null;
            S.pending = null;
        }
    }
}

/** Ohne Team gibt es weder offene Stationen noch ausstehende Ergebnisse, auch nicht für ein neues Team. */
export function forgetTeamProgress(S) {
    S.team = null;
    S.station = null;
    S.pending = null;
    S.showResults = false;
}

/** Übernimmt den Fortschritt aus einem Ack. */
export function applyProgress(S, progress) {
    if (!S.team || !progress) return;
    S.team.progress = progress;
    if (S.team.phase !== 'lobby') S.team.phase = progress.finished ? 'finished' : 'running';
}

/** Antworten über dem Server-Limit dürfen ein Team nie blockieren. */
export function fitAnswer(answer) {
    if (answer === undefined || answer === null) return answer;
    const json = JSON.stringify(answer);
    if (json === undefined) return null;
    return new TextEncoder().encode(json).length > MAX_ANSWER_BYTES ? { tooLarge: true } : answer;
}

/** Zeilen der Stationsliste. */
export function stationRows(team) {
    const tasks = team && team.progress && Array.isArray(team.progress.tasks) ? team.progress.tasks : [];
    return tasks.map((task, index) => ({
        key: task.key,
        number: index + 1,
        title: task.title,
        status: task.status,
        done: task.status === 'completed',
        resumable: task.status === 'started'
    }));
}

/** Anzeige im Kopf einer Aufgabe in der festen Reihenfolge. */
export function sequencePosition(team) {
    const progress = team.progress;
    const number = progress.currentIndex === null ? progress.total : progress.currentIndex + 1;
    return { number, total: progress.total, percent: Math.round((number / progress.total) * 100) };
}
