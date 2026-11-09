/*
 * board-format.js: Anzeige-Logik des Brettspiels, ohne DOM.
 * Der Server entscheidet; GameRules dient hier nur der Vorschau, was ein Tipp bewirken wird.
 */
import { formatAnswer } from './format.js';

const GameRules = globalThis.GameRules;

const fieldsText = (count) => `${count} ${count === 1 ? 'Feld' : 'Felder'}`;
const stepsText = (count) => `${count} ${count === 1 ? 'Schritt' : 'Schritte'}`;
const groupsText = (count) => (count === 1 ? 'Gruppe' : 'Gruppen');

/** Farben einer Welt mit lesbaren Textfarben. Die Handbuch-Farbe "text" passt nicht auf jeden Grund. */
export function boardTheme(worldKey) {
    const world = GameRules.hasWorld(worldKey) ? GameRules.WORLDS[worldKey] : GameRules.WORLDS[GameRules.MAIN_WORLD];
    const { bg, surface, surface2, accent, accent2, text } = world.colors;
    return {
        bg,
        surface,
        surface2,
        accent,
        accent2,
        onBg: GameRules.readableText(bg, text),
        onSurface: GameRules.readableText(surface, text),
        onSurface2: GameRules.readableText(surface2, text),
        onAccent: GameRules.readableText(accent)
    };
}

export function currentField(board) {
    return board.world === null ? board.mainPos : board.worldPos;
}

/** Was "Figur bewegen" gleich tun wird; null, wenn die Phase keine Bewegung erlaubt. */
export function movePreview(board) {
    if (board.phase !== 'result' && board.phase !== 'continue') return null;
    const steps = board.phase === 'result' ? (board.lastResult ? board.lastResult.steps : 0) : board.remainingSteps;
    const from = currentField(board);
    const open = board.world === null ? board.portals.filter((portal) => !portal.done) : [];
    const plan = GameRules.planMove({ pos: from, steps, stops: { portals: open.map((portal) => portal.field) } });
    return { ...plan, from, steps, walked: plan.to - from, portal: open.find((portal) => portal.field === plan.to) || null };
}

function moveDetail(board, move) {
    if (move.stoppedAt === 'monster') {
        const label = GameRules.monsterLabel(board.worldKey, GameRules.monsterIndex(move.to));
        return `Dort wartet ${label === 'Endboss' ? 'der Endboss' : label}.${move.remaining > 0 ? ` Danach geht es mit ${stepsText(move.remaining)} weiter.` : ''}`;
    }
    if (move.stoppedAt === 'portal') {
        const lapsed = move.steps - move.walked;
        const rest = lapsed === 0 ? '' : `, ${lapsed === 1 ? 'der restliche Schritt verfällt' : `die restlichen ${lapsed} Schritte verfallen`}`;
        return `Dort ist das Portal zu „${move.portal.worldName}“. Die Figur bleibt stehen${rest}.`;
    }
    if (move.stoppedAt === 'end') return board.world === null ? 'Das ist das Ziel des Hauptbretts!' : 'Das ist das Ende dieser Welt.';
    return 'Danach beginnt die nächste Runde.';
}

function moveLines(board) {
    const move = movePreview(board);
    return { headline: `${fieldsText(move.walked)} vor, auf Feld ${move.to}`, detail: moveDetail(board, move) };
}

const PHASES = {
    round(board) {
        const { total, finished } = board.groupProgress;
        const lines = [`Jede Gruppe scannt eine Karte aus dem Kartenset „${board.kartenset}“.`];
        lines.push(total === 0 ? 'Noch ist keine Gruppe beigetreten.' : `${finished} von ${total} ${groupsText(total)} fertig.`);
        if (board.cardCount < total) {
            lines.push(`Das Kartenset hat nur ${board.cardCount} Karten für ${total} Gruppen. Gruppen ohne Karte zählen als nicht richtig.`);
        }
        return {
            eyebrow: `Runde ${board.round}`,
            title: 'Die Gruppen lösen ihre Karten',
            lines,
            action: { kind: 'forceEvaluate', label: 'Runde jetzt auswerten', disabled: total === 0 }
        };
    },
    result(board) {
        const { correct, total, percent, steps } = board.lastResult;
        return {
            eyebrow: `Auswertung Runde ${board.round}`,
            title: `${correct} von ${total} ${groupsText(total)} richtig`,
            stats: [{ label: 'Richtig', value: `${percent} %` }, { label: steps === 1 ? 'Schritt' : 'Schritte', value: String(steps) }],
            move: moveLines(board),
            action: { kind: 'move', label: 'Figur bewegen' }
        };
    },
    monster(board) {
        const { pending, remainingSteps } = board;
        const after = remainingSteps > 0 ? `Danach darf die Figur noch ${stepsText(remainingSteps)} gehen.` : 'Danach beginnt die nächste Runde.';
        return {
            eyebrow: `${pending.label} auf Feld ${pending.field}`,
            title: pending.label === 'Endboss' ? 'Der Endboss wartet!' : 'Ein Monster versperrt den Weg!',
            monster: true,
            lines: [`Die Gruppen warten, bis du bestätigst. ${after}`],
            action: { kind: 'confirm', label: 'Monster bewältigt' }
        };
    },
    continue(board) {
        return {
            eyebrow: 'Es geht weiter',
            title: board.message,
            move: moveLines(board),
            action: { kind: 'move', label: 'Figur bewegen' }
        };
    },
    portal(board) {
        return {
            eyebrow: `Portal auf Feld ${board.pending.field}`,
            title: `Auf in die Welt „${board.pending.worldName}“`,
            lines: [board.pending.message],
            action: { kind: 'confirm', label: 'Welt liegt bereit' }
        };
    },
    worldDone(board) {
        return {
            eyebrow: 'Welt geschafft',
            title: board.pending.worldName,
            lines: [board.pending.message],
            action: { kind: 'confirm', label: 'Zurück zum Hauptbrett' }
        };
    }
};

/**
 * Was die Hauptkarte in dieser Phase zeigt, mit genau einer Aktion oder keiner.
 * @returns {{ eyebrow, title, lines?, stats?, move?, monster?, victory?, action }}
 */
export function phaseView(board, session) {
    if (board.phase === 'finished') {
        return { eyebrow: 'Spielende', title: 'Gewonnen!', lines: [board.message || GameRules.VICTORY_MESSAGE], victory: true, action: null };
    }
    if (session.game_status !== 'running') {
        return board.phase === 'lobby'
            ? {
                eyebrow: 'Vorbereitung',
                title: 'Bereit zum Start',
                lines: [`Die Gruppen treten mit dem Session-Code ${session.code} bei. Drucke vorher die QR-Karten aus.`],
                action: { kind: 'start', label: 'Spiel starten' }
            }
            : {
                eyebrow: 'Unterbrochen',
                title: 'Das Spiel ist unterbrochen',
                lines: ['Der Spielstand bleibt erhalten, es geht an derselben Stelle weiter.'],
                action: { kind: 'start', label: 'Spiel fortsetzen' }
            };
    }
    const build = Object.prototype.hasOwnProperty.call(PHASES, board.phase) ? PHASES[board.phase] : null;
    return build ? build(board) : { eyebrow: '', title: 'Der Spielstand wird geladen...', action: null };
}

/** Die 25 Felder des aktuellen Bretts. */
export function boardFields(board) {
    const portals = new Map(board.world === null ? board.portals.map((portal) => [portal.field, portal]) : []);
    const fields = [];
    for (let number = 1; number <= GameRules.BOARD_FIELDS; number += 1) {
        const monster = GameRules.monsterIndex(number);
        const portal = portals.get(number);
        if (number === GameRules.ARRIVAL_FIELD) {
            fields.push({ number, kind: 'start', icon: '🚩', label: 'Start' });
        } else if (number === GameRules.BOARD_FIELDS) {
            fields.push({ number, kind: 'goal', icon: '🏁', label: board.world === null ? 'Ziel' : 'Welt-Ende' });
        } else if (monster !== -1) {
            const label = GameRules.monsterLabel(board.worldKey, monster);
            fields.push({ number, kind: 'monster', icon: label === 'Endboss' ? '👹' : '👾', label });
        } else if (portal) {
            fields.push({ number, kind: 'portal', icon: portal.done ? '✓' : '🌀', label: portal.worldName, world: portal.world, done: portal.done });
        } else {
            fields.push({ number, kind: 'plain', icon: '', label: '' });
        }
    }
    return fields;
}

/** Felder in Schlangenlinie, Zeile für Zeile; so liegen aufeinanderfolgende Felder nebeneinander. */
export function snakeOrder(fields, columns = 5) {
    const rows = [];
    for (let start = 0; start < fields.length; start += columns) {
        const row = fields.slice(start, start + columns);
        rows.push(rows.length % 2 === 1 ? row.reverse() : row);
    }
    return rows.flat();
}

const STATUS_TEXT = { none: 'Keine Karte', working: 'In Arbeit', finished: 'Fertig' };

/** Alles, was eine Gruppen-Karte zeigt. task ist die Karte aus dem Snapshot, falls vorhanden. */
export function groupView(group, task, { roundOver = false } = {}) {
    const finished = group.status === 'finished';
    // Nach "Runde jetzt auswerten" arbeitet niemand mehr; die Gruppe zählt als nicht richtig.
    const missed = roundOver && !finished;
    const answer = finished && !group.skipped && group.card ? formatAnswer(group.card.type, group.answer, task) : { lines: [], image: null };
    return {
        statusText: missed && group.status === 'working' ? 'Nicht abgegeben' : (STATUS_TEXT[group.status] || ''),
        status: group.status,
        verdict: finished || missed ? (finished && group.correct ? 'Richtig' : 'Falsch') : null,
        correct: finished && group.correct === true,
        note: group.skipped ? 'Karte abgebrochen, zählt als nicht richtig.' : (missed ? 'Nicht fertig geworden, zählt als nicht richtig.' : null),
        card: group.card,
        ...answer
    };
}

/** Karte einer Gruppe im Snapshot des aktuellen Sets. Die Sets stehen nur im vollen Stand. */
export function groupTask(board, group) {
    const set = board.sets ? board.sets[board.worldKey] : null;
    return set && group.card ? set.tasks[group.card.index] : undefined;
}

export function unfinishedGroups(board) {
    return board.groups.filter((group) => group.status !== 'finished');
}

/** Eine gespielte Karte im Verlauf, gleich dargestellt wie die Gruppen-Karte im laufenden Spiel. */
export function historyCardView(card) {
    const view = groupView({
        status: card.status === 'working' ? 'working' : 'finished',
        skipped: card.status === 'skipped',
        correct: card.correct,
        card: { type: card.type },
        answer: card.answer
    }, card.task || undefined);
    return { ...view, statusText: card.status === 'working' ? 'Nicht abgegeben' : view.statusText };
}

/** Wie das Spiel ausgegangen ist, in Sätzen für den Verlauf. */
export function historySummary(board) {
    const lines = [];
    if (board.phase === 'finished') {
        lines.push('Gewonnen! Die Klasse hat das Ziel erreicht.');
    } else if (board.phase === 'lobby') {
        lines.push('Das Spiel wurde nicht gestartet.');
    } else {
        lines.push(`Nicht zu Ende gespielt. Die Figur stand ${board.world === null ? 'auf dem Hauptbrett' : `in der Welt „${board.worldName}“`} auf Feld ${currentField(board)}.`);
    }
    const played = board.portals.filter((portal) => portal.done).map((portal) => portal.worldName);
    lines.push(played.length ? `Gespielte Welten: ${played.join(', ')}.` : 'Es wurde keine Welt zu Ende gespielt.');
    lines.push(`Gespielte Runden: ${board.round}.`);
    return lines;
}

/** Abschnitte für den QR-Bogen: je Kartenset die Karten mit Code, Monster haben keinen. */
export function boardQrSections(board) {
    if (!board.sets) return [];
    const order = [GameRules.MAIN_WORLD, ...board.portals.map((portal) => portal.world)];
    return order.filter((key) => board.sets[key]).map((key) => ({
        id: key,
        title: board.sets[key].title.startsWith(GameRules.worldName(key)) ? board.sets[key].title : `${GameRules.worldName(key)}: ${board.sets[key].title}`,
        noun: 'Karte',
        tasks: board.sets[key].tasks.filter((task) => task.type !== 'monster')
    }));
}
