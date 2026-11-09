/*
 * board.js: Anzeige des Brettspiels auf der Schüler-Seite: Spielbrett und Phasen-Bildschirme.
 *
 * Reine Darstellung von team.board; Entscheidungen trifft der Server. Farben kommen aus
 * GameRules.WORLDS und werden per CSSOM gesetzt (CSP). Richtig oder falsch einer einzelnen Gruppe
 * gibt es hier nicht, nur das Klassen-Ergebnis.
 */

import { h, mount, byId } from '../shared/dom.js';
import { liveCard, snakeCell, snakeOrder, walkPath } from './flow.js';

const COLUMNS = 5;
const STEP_MS = 320;
const MAX_WALK_MS = 2000;
// Die Bilder sind verschieden geschnitten: ganz zeigen, die Rundung sitzt am Bild selbst.
const TILE_CLASS = 'block mx-auto w-auto h-auto max-w-full max-h-64 rounded-3xl shadow-2xl';

let figureAt = null;      // { worldKey, pos }: wo die Figur zuletzt zu sehen war
let boardSignature = null;
let phaseSignature = null;

function reducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Handbuch-Farben einer Welt plus lesbarer Text auf jeder Fläche. */
export function worldTheme(worldKey) {
    const rules = window.GameRules;
    const { colors } = rules.WORLDS[rules.hasWorld(worldKey) ? worldKey : rules.MAIN_WORLD];
    const on = (background) => rules.readableText(background, colors.text);
    return {
        ...colors,
        onBg: on(colors.bg),
        onSurface: on(colors.surface),
        onSurface2: on(colors.surface2),
        onAccent: on(colors.accent),
        onAccent2: on(colors.accent2)
    };
}

/** Färbt die Seite. Aufgaben und Scanner bleiben auf der neutralen Karte, ihre Bausteine sind dafür gemacht. */
export function applyPageTheme(theme, themedCard) {
    const body = document.body;
    const card = byId('mainCard');
    const note = byId('privacyNote');
    if (theme) {
        body.style.setProperty('background-color', theme.bg);
        note.style.setProperty('color', theme.onBg);
    } else {
        body.style.removeProperty('background-color');
        note.style.removeProperty('color');
    }
    if (theme && themedCard) {
        card.style.setProperty('background-color', theme.surface);
        card.style.setProperty('border-color', theme.surface);
        card.style.setProperty('color', theme.onSurface);
    } else {
        ['background-color', 'border-color', 'color'].forEach((name) => card.style.removeProperty(name));
    }
}

function currentField(board) {
    return board.world ? board.worldPos : board.mainPos;
}

function fieldInfo(field, board) {
    const rules = window.GameRules;
    const monster = rules.monsterIndex(field);
    if (monster !== -1) {
        const label = rules.monsterLabel(board.worldKey, monster);
        return { kind: 'monster', emblem: label === 'Endboss' ? '😈' : '👾', label };
    }
    const portal = board.world ? null : (board.portals || []).find((entry) => entry.field === field);
    if (portal) {
        return portal.done
            ? { kind: 'portal-done', emblem: '✔️', label: `Portal ${portal.worldName}, schon gespielt` }
            : { kind: 'portal', emblem: '🌀', label: `Portal ${portal.worldName}` };
    }
    if (field === rules.ARRIVAL_FIELD) return { kind: 'start', emblem: '🏠', label: 'Start' };
    if (field === rules.BOARD_FIELDS) return board.world
        ? { kind: 'goal', emblem: '🚪', label: 'Ausgang der Welt' }
        : { kind: 'goal', emblem: '🏆', label: 'Ziel' };
    return { kind: 'plain', emblem: null, label: '' };
}

function fieldColors(kind, theme) {
    if (kind === 'monster') return { backgroundColor: theme.accent2, color: theme.onAccent2 };
    if (kind === 'portal') return { backgroundColor: theme.accent, color: theme.onAccent };
    if (kind === 'portal-done') return { backgroundColor: theme.surface2, color: theme.onSurface2 };
    return { backgroundColor: theme.surface, color: theme.onSurface };
}

function fieldCell(field, board, theme) {
    const info = fieldInfo(field, board);
    return h('div', { class: 'aspect-square p-0.5', dataset: { field, kind: info.kind } },
        h('div', {
            class: 'relative w-full h-full rounded-lg flex items-center justify-center border',
            style: { ...fieldColors(info.kind, theme), borderColor: `${theme.onBg}33` },
            title: info.label || null
        },
        h('span', { class: 'absolute top-0.5 left-1 text-[10px] sm:text-xs font-black leading-none' }, field),
        info.emblem ? h('span', {
            // Die weiße Scheibe hält das Symbol auf jeder Weltfarbe erkennbar.
            class: 'w-8 h-8 sm:w-11 sm:h-11 rounded-full bg-white/85 text-slate-900 flex items-center justify-center text-lg sm:text-2xl leading-none',
            'aria-hidden': true
        }, info.emblem) : null));
}

function cellOffset(field) {
    const { row, col } = snakeCell(field, COLUMNS);
    return { left: `${(col * 100) / COLUMNS}%`, top: `${(row * 100) / COLUMNS}%` };
}

function figureToken(pos, theme) {
    const offset = cellOffset(pos);
    const figure = h('div', {
        class: 'absolute w-1/5 h-1/5 flex items-center justify-center pointer-events-none',
        style: offset,
        dataset: { role: 'figure', pos }
    },
    h('span', {
        class: 'w-3/5 h-3/5 rounded-full flex items-center justify-center text-lg sm:text-2xl shadow-lg border-2',
        style: { backgroundColor: '#FFFFFF', color: '#0F172A', borderColor: theme.accent }
    }, '♟️'));
    return figure;
}

/** Die Figur läuft Feld für Feld; nach einem Welt-Wechsel steht sie einfach auf dem neuen Feld. */
function walkFigure(figure, worldKey, pos) {
    const previous = figureAt;
    figureAt = { worldKey, pos };
    if (!previous || previous.worldKey !== worldKey || typeof figure.animate !== 'function' || reducedMotion()) return;
    const path = walkPath(previous.pos, pos);
    if (path.length < 2) return;
    try {
        figure.animate(path.map(cellOffset), { duration: Math.min((path.length - 1) * STEP_MS, MAX_WALK_MS), easing: 'linear' });
    } catch (err) {
        console.warn(err);
    }
}

export function renderBoardPanel(container, team) {
    const { board } = team;
    const pos = currentField(board);
    const signature = JSON.stringify([board.worldKey, pos, board.round, board.portals]);
    if (signature === boardSignature) return;
    boardSignature = signature;

    const rules = window.GameRules;
    const theme = worldTheme(board.worldKey);
    const figure = figureToken(pos, theme);
    const legendItem = (emblem, text) => h('span', { class: 'whitespace-nowrap' }, `${emblem} ${text}`);

    mount(container, h('div', {
        class: 'rounded-2xl p-2 sm:p-3 space-y-2',
        style: { backgroundColor: theme.bg, color: theme.onBg },
        dataset: { role: 'board', world: board.worldKey }
    },
    h('div', { class: 'flex items-baseline justify-between gap-3 px-1' },
        h('h3', { class: 'font-black break-words min-w-0' }, board.worldName),
        h('span', { class: 'text-xs font-bold shrink-0' }, `Feld ${pos} von ${rules.BOARD_FIELDS}`)),
    h('div', {
        class: 'relative',
        role: 'img',
        'aria-label': `Spielbrett ${board.worldName}, eure Figur steht auf Feld ${pos} von ${rules.BOARD_FIELDS}`
    },
    h('div', { class: 'grid grid-cols-5' }, snakeOrder(rules.BOARD_FIELDS, COLUMNS).map((field) => fieldCell(field, board, theme))),
    figure),
    h('p', { class: 'flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-bold px-1' },
        legendItem('♟️', 'Eure Figur'),
        legendItem('👾', 'Monster'),
        board.world ? null : legendItem('🌀', 'Portal'))));
    walkFigure(figure, board.worldKey, pos);
}

function waitLine(text) {
    return h('p', { class: 'text-sm font-bold' }, text);
}

function panel(phase, ...children) {
    return h('div', { class: 'text-center space-y-4 py-2', dataset: { boardPhase: phase } }, children);
}

function title(text) {
    return h('h2', { class: 'text-2xl sm:text-3xl font-black break-words' }, text);
}

function emblem(text) {
    return h('div', { class: 'text-6xl', 'aria-hidden': true }, text);
}

function stepsWord(steps) {
    return steps === 1 ? '1 Schritt' : `${steps} Schritte`;
}

function progressLine({ finished, total }, theme) {
    const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
    return h('div', { class: 'space-y-2' },
        h('p', { class: 'text-xl font-black', dataset: { role: 'group-progress' } }, `${finished} von ${total} Gruppen fertig`),
        h('div', { class: 'w-full h-3 rounded-full overflow-hidden', style: { backgroundColor: theme.surface2 } },
            h('div', { class: 'h-full rounded-full transition-all duration-500', style: { width: `${percent}%`, backgroundColor: theme.accent } })));
}

function waitingPanel(team, theme) {
    const card = liveCard(team);
    const skipped = Boolean(card) && card.status === 'skipped';
    return panel('waiting',
        emblem(skipped ? '⏭️' : '📨'),
        title(skipped ? 'Karte übersprungen' : 'Karte abgegeben!'),
        progressLine(team.board.groupProgress, theme),
        waitLine('Wartet auf die anderen Gruppen.'));
}

function resultPanel(board, theme) {
    const result = board.lastResult || { correct: 0, total: 0, percent: 0, steps: 0 };
    return panel('result',
        title('Ergebnis der Klasse'),
        h('p', { class: 'text-5xl font-black' }, `${result.percent} %`),
        h('p', { class: 'text-lg font-bold' }, `${result.correct} von ${result.total} Gruppen richtig`),
        h('p', {
            class: 'inline-block px-6 py-3 rounded-2xl text-2xl font-black',
            style: { backgroundColor: theme.accent, color: theme.onAccent },
            dataset: { role: 'steps' }
        }, stepsWord(result.steps)),
        waitLine('Eure Lehrkraft zieht gleich die Figur.'));
}

function monsterTile(pending, theme) {
    const fallback = h('div', {
        class: 'w-48 h-48 mx-auto rounded-3xl flex items-center justify-center text-8xl shadow-2xl',
        style: { backgroundColor: theme.surface2 },
        'aria-hidden': true
    }, pending.label === 'Endboss' ? '😈' : '👾');
    if (!pending.monsterImage) return fallback;
    const tile = h('img', {
        src: pending.monsterImage,
        alt: pending.label,
        draggable: 'false',
        class: TILE_CLASS,
        onError: () => tile.replaceWith(fallback)
    });
    return tile;
}

function monsterPanel(board, theme) {
    const pending = board.pending || { label: 'Monster', monsterImage: null };
    return panel('monster',
        monsterTile(pending, theme),
        title(`${pending.label}!`),
        h('p', { class: 'font-bold' }, 'Die Figur steht auf einem Monsterfeld. Stopp!'),
        h('p', { class: 'text-lg font-black' }, 'Wartet auf eure Lehrkraft'));
}

function continuePanel(board) {
    return panel('continue',
        emblem('👣'),
        title(board.message || window.GameRules.continueMessage(board.remainingSteps)),
        waitLine('Eure Lehrkraft zieht die Figur weiter.'));
}

function portalPanel(board, theme) {
    const pending = board.pending || {};
    return panel('portal',
        emblem('🌀'),
        title(`Portal: ${pending.worldName || ''}`),
        h('p', { class: 'text-lg font-bold break-words' }, board.message),
        h('p', {
            class: 'inline-block px-4 py-2 rounded-xl font-black break-words max-w-full',
            style: { backgroundColor: theme.accent, color: theme.onAccent },
            dataset: { role: 'kartenset' }
        }, `Kartenset: ${pending.kartenset || ''}`),
        waitLine('Wartet auf eure Lehrkraft.'));
}

function worldDonePanel(board) {
    return panel('worldDone',
        emblem('🌟'),
        title('Welt geschafft!'),
        h('p', { class: 'text-lg font-bold break-words' }, board.message),
        waitLine('Wartet auf eure Lehrkraft.'));
}

function finishedPanel(board) {
    return panel('finished',
        h('div', { class: 'text-8xl', 'aria-hidden': true }, '🏆'),
        h('h2', { class: 'text-4xl font-black' }, 'Gewonnen!'),
        h('p', { class: 'text-lg font-bold break-words' }, board.message || window.GameRules.VICTORY_MESSAGE));
}

function phasePanel(team, theme) {
    const { board } = team;
    switch (board.phase) {
        case 'round': return waitingPanel(team, theme);
        case 'result': return resultPanel(board, theme);
        case 'monster': return monsterPanel(board, theme);
        case 'continue': return continuePanel(board);
        case 'portal': return portalPanel(board, theme);
        case 'worldDone': return worldDonePanel(board);
        default: return finishedPanel(board);
    }
}

export function renderBoardPhase(container, team) {
    const { board } = team;
    const card = liveCard(team);
    const signature = JSON.stringify([board.worldKey, board.phase, board.message, board.remainingSteps, board.pending, board.lastResult, board.groupProgress, card && card.status]);
    if (signature === phaseSignature) return;
    phaseSignature = signature;
    mount(container, phasePanel(team, worldTheme(board.worldKey)));
}
