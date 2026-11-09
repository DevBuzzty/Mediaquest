/*
 * board-view.js: Das laufende Brettspiel auf dem Tablet der Lehrkraft.
 *
 * Das Gerüst entsteht einmal und bleibt stehen. Gruppen melden sich mitten im Tippen, deshalb darf
 * ein Neuzeichnen weder den Hauptknopf ersetzen (der Tipp ginge verloren) noch das Vorlesen abbrechen.
 * patch() baut einen Bereich nur neu, wenn sich sein Inhalt geändert hat.
 */
import { h, mount, setHidden } from '../shared/dom.js';
import { boardFields, boardTheme, currentField, groupTask, groupView, movePreview, phaseView, snakeOrder } from './board-format.js';

const GameRules = globalThis.GameRules;

// So lange nach jedem Phasenwechsel gesperrt: Der zweite Tipp eines Doppeltipps träfe sonst die nächste Aktion.
const PRESS_GUARD_MS = 300;

// Klebt am unteren Rand: Auf dem Tablet im Querformat bleibt der Knopf sichtbar, egal wie lang die Phase wird.
const PRIMARY_CLASS = 'sticky bottom-3 z-20 w-full min-h-[4.5rem] rounded-2xl px-6 py-4 text-2xl font-black shadow-lg transition-transform active:scale-95 disabled:opacity-50';
const QUIET_BUTTON_CLASS = 'min-h-[3rem] rounded-xl px-4 py-2 font-bold hover:brightness-110';
const DISC_CLASS = 'rounded-full bg-white/85 text-slate-900 flex items-center justify-center leading-none';
const STATUS_CLASSES = { none: 'bg-slate-600 text-slate-200', working: 'bg-blue-700 text-white', finished: 'bg-slate-600 text-white' };

const createSlot = (el) => ({ el, signature: null });

function patch(slot, signature, build) {
    if (slot.signature === signature) return;
    slot.signature = signature;
    mount(slot.el, build());
}

/** Abgesetzte Fläche auf der Aktionskarte; Text und Grund kommen zusammen aus dem Thema, damit der Kontrast stimmt. */
const insetColors = (theme) => ({ backgroundColor: theme.surface2, color: theme.onSurface2 });

function statTile(stat, theme) {
    return h('div', { class: 'rounded-xl px-4 py-3 text-center min-w-[7rem]', style: insetColors(theme) },
        h('div', { class: 'text-3xl font-black' }, stat.value),
        h('div', { class: 'text-xs font-bold uppercase tracking-widest' }, stat.label));
}

function fieldColors(field, index, theme) {
    if (field.done) return insetColors(theme);
    if (field.kind === 'portal') {
        const accent = GameRules.WORLDS[field.world].colors.accent;
        return { backgroundColor: accent, color: GameRules.readableText(accent) };
    }
    return index % 2 === 0
        ? { backgroundColor: theme.surface, color: theme.onSurface }
        : { backgroundColor: theme.surface2, color: theme.onSurface2 };
}

/** Figur und Symbole liegen auf einer weißen Scheibe, sonst verschwinden sie auf den dunklen Welten. */
function fieldIcon(field, figure) {
    if (figure) return h('span', { class: `w-8 h-8 md:w-9 md:h-9 text-xl ${DISC_CLASS}`, 'aria-hidden': true }, '♟️');
    if (!field.icon) return null;
    if (field.done) return h('span', { class: 'text-lg font-black leading-none', 'aria-hidden': true }, field.icon);
    return h('span', { class: `w-7 h-7 md:w-8 md:h-8 text-base ${DISC_CLASS}`, 'aria-hidden': true }, field.icon);
}

function fieldTile(field, index, { theme, figureAt, target }) {
    const figure = field.number === figureAt;
    const isTarget = field.number === target;
    const style = fieldColors(field, index, theme);
    if (field.kind === 'monster') style.borderColor = theme.accent2;
    if (field.done) style.borderColor = theme.onSurface2;
    if (figure) style.boxShadow = `0 0 0 4px ${theme.accent}`;
    if (isTarget) style.outline = `3px dashed ${theme.accent}`;
    const dataset = { field: field.number, fieldKind: field.kind };
    if (figure) dataset.figure = '1';
    if (isTarget) dataset.target = '1';
    return h('div', {
        role: 'listitem',
        'aria-label': [`Feld ${field.number}`, field.label, field.done ? 'erledigt' : '', figure ? 'Figur steht hier' : ''].filter(Boolean).join(', '),
        class: ['relative min-h-[3.75rem] md:min-h-[4.5rem] rounded-xl p-1 flex flex-col items-center justify-center text-center border-2 border-transparent overflow-hidden',
            field.done && 'border-dashed', figure && 'z-10'],
        style,
        dataset
    },
    h('span', { class: 'absolute top-0.5 left-1 text-[11px] font-black' }, field.number),
    fieldIcon(field, figure),
    field.label ? h('span', { class: 'text-[10px] md:text-[11px] font-bold leading-tight max-w-full break-words' }, field.label) : null);
}

function portalLegend(board) {
    if (board.world !== null) {
        return h('p', { class: 'text-sm' }, `Auf dem Hauptbrett wartet die Figur auf Feld ${board.mainPos}.`);
    }
    return h('ul', { class: 'text-sm space-y-1' }, board.portals.map((portal) => h('li', { class: 'break-words' },
        `Feld ${portal.field}: ${portal.worldName} (Kartenset „${portal.kartenset}“)${portal.done ? ' ✓ gespielt' : ''}`)));
}

function groupCard(group, view, teamCode, onDelete) {
    return h('article', {
        class: 'bg-slate-700 border-l-4 p-4 rounded-r-lg shadow space-y-2 min-w-0',
        style: { borderLeftColor: group.color },
        dataset: { teamId: group.teamId, groupStatus: group.status }
    },
    h('div', { class: 'flex items-start justify-between gap-3' },
        h('div', { class: 'min-w-0' },
            h('h4', { class: 'font-bold text-lg break-words' }, group.name),
            teamCode ? h('p', { class: 'text-xs text-slate-400' }, 'Team-Code: ', h('span', { class: 'text-white font-mono font-bold' }, teamCode)) : null),
        h('button', {
            type: 'button',
            class: 'shrink-0 text-xs text-slate-400 hover:text-red-400 underline',
            'aria-label': `Team ${group.name} löschen`,
            dataset: { focusKey: `delete-${group.teamId}` },
            onClick: () => onDelete({ id: group.teamId, name: group.name })
        }, 'Löschen')),
    h('div', { class: 'flex flex-wrap gap-2' },
        h('span', { class: ['px-3 py-1 rounded-full text-xs font-black uppercase', STATUS_CLASSES[view.status]] }, view.statusText),
        view.verdict
            ? h('span', { class: ['px-3 py-1 rounded-full text-xs font-black uppercase text-white', view.correct ? 'bg-green-700' : 'bg-red-700'] }, view.verdict)
            : null),
    view.card
        ? h('p', { class: 'text-sm font-bold text-slate-200 break-words' }, view.card.title,
            h('span', { class: 'ml-2 font-mono text-xs text-blue-300' }, view.card.code))
        : null,
    view.note ? h('p', { class: 'text-xs text-amber-300' }, view.note) : null,
    view.image
        ? h('a', { href: view.image, target: '_blank', rel: 'noopener' },
            h('img', { src: view.image, alt: `Foto von ${group.name}`, loading: 'lazy', class: 'w-full h-32 object-cover rounded' }))
        : null,
    view.lines.length
        ? h('div', { class: 'bg-slate-800 rounded-lg p-3 space-y-1' },
            h('p', { class: 'text-[10px] uppercase font-black text-slate-400' }, 'Antwort'),
            view.lines.map((line) => h('p', { class: 'text-sm text-slate-300 break-words whitespace-pre-line' }, line)))
        : null);
}

const monsterAudioKey = (board) => `board-${board.worldKey}-${board.pending.field}-${board.round}`;

/**
 * @param {{ root, readAloud, onAction, onShowQr, onDeleteTeam }} options
 *   onAction(action, rev) darf async sein; solange sie läuft, ist der Hauptknopf gesperrt.
 */
export function createBoardView({ root, readAloud, onAction, onShowQr, onDeleteTeam }) {
    const heading = h('h3', { id: 'boardHeading', class: 'text-2xl md:text-3xl font-black break-words' });
    const subheading = h('p', { id: 'boardSubheading', class: 'text-sm font-bold break-words' });
    const qrBtn = h('button', {
        type: 'button',
        id: 'boardQrBtn',
        class: `${QUIET_BUTTON_CLASS} text-sm shrink-0`,
        onClick: () => onShowQr()
    }, 'QR-Karten drucken');

    const eyebrow = h('p', { id: 'boardEyebrow', class: 'text-xs font-black uppercase tracking-widest' });
    const title = h('h3', { id: 'boardPhaseTitle', 'aria-live': 'polite', class: 'text-3xl font-black break-words' });
    const details = createSlot(h('div', { id: 'boardDetails', class: 'space-y-3' }));
    const primary = h('button', { type: 'button', id: 'boardPrimaryBtn', class: PRIMARY_CLASS, onClick: press });
    const actionCard = h('div', { class: 'rounded-2xl p-5 md:p-6 space-y-4 min-w-0' }, eyebrow, title, details.el, primary);

    const grid = createSlot(h('div', { id: 'boardGrid', role: 'list', 'aria-label': 'Spielbrett', class: 'grid grid-cols-5 gap-1.5 md:gap-2' }));
    const legend = createSlot(h('div', { id: 'boardLegend' }));
    const hero = h('div', { class: 'rounded-2xl p-4 md:p-6 space-y-4' },
        h('div', { class: 'flex flex-wrap items-start justify-between gap-3' },
            h('div', { class: 'min-w-0 space-y-1' }, heading, subheading),
            qrBtn),
        h('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start' },
            actionCard,
            h('div', { class: 'space-y-3 min-w-0' }, grid.el, legend.el)));

    const groupsHeading = h('h3', { class: 'text-xl font-bold border-b border-slate-700 pb-2' });
    const groupList = h('div', { id: 'boardGroups', class: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' });
    mount(root, hero, h('div', { class: 'space-y-4' }, groupsHeading, groupList));

    const groupCache = new Map();
    let current = null;
    let phaseKey = null;
    let shownTheme = null;
    let busy = false;
    let guardTimer = null;

    function refreshPrimary() {
        const action = current ? current.view.action : null;
        setHidden(primary, !action);
        if (!action) return;
        primary.textContent = action.label;
        primary.disabled = busy || guardTimer !== null || Boolean(action.disabled);
    }

    function guardPresses() {
        clearTimeout(guardTimer);
        guardTimer = setTimeout(() => {
            guardTimer = null;
            refreshPrimary();
        }, PRESS_GUARD_MS);
    }

    async function press() {
        if (primary.disabled || !current || !current.view.action) return;
        const { view, board } = current;
        busy = true;
        refreshPrimary();
        try {
            await onAction(view.action, board.rev);
        } finally {
            busy = false;
            guardPresses();
            refreshPrimary();
        }
    }

    function applyTheme(worldKey) {
        if (shownTheme === worldKey) return;
        shownTheme = worldKey;
        const theme = boardTheme(worldKey);
        hero.style.backgroundColor = theme.bg;
        hero.style.color = theme.onBg;
        actionCard.style.backgroundColor = theme.surface;
        actionCard.style.color = theme.onSurface;
        primary.style.backgroundColor = theme.accent;
        primary.style.color = theme.onAccent;
        qrBtn.style.backgroundColor = theme.surface;
        qrBtn.style.color = theme.onSurface;
        root.dataset.theme = worldKey;
    }

    function monsterBlock(board) {
        const task = board.monsterTask || {};
        const image = task.image || board.pending.monsterImage;
        const theme = boardTheme(board.worldKey);
        let voice = null;
        if (task.audio) {
            voice = readAloud.button(monsterAudioKey(board), task.audio, QUIET_BUTTON_CLASS);
            Object.assign(voice.style, insetColors(theme));
        }
        return h('div', { class: 'flex flex-wrap gap-4 items-start', dataset: { monsterTask: '1' } },
            // Die Bilder sind verschieden geschnitten: ganz zeigen, die Rundung sitzt am Bild selbst.
            image ? h('img', { src: image, alt: board.pending.label, class: 'block w-auto h-auto max-w-[45%] max-h-40 md:max-h-48 shrink-0 rounded-3xl' }) : null,
            h('div', { class: 'space-y-2 min-w-[12rem] flex-1' },
                h('p', { class: 'text-xl font-bold break-words whitespace-pre-line' }, task.question || ''),
                task.description ? h('p', { class: 'break-words whitespace-pre-line' }, task.description) : null,
                voice));
    }

    function buildDetails(view, board) {
        const theme = boardTheme(board.worldKey);
        return [
            view.victory ? h('p', { class: 'text-7xl text-center', 'aria-hidden': true }, '🏆') : null,
            view.stats ? h('div', { class: 'flex flex-wrap gap-3' }, view.stats.map((stat) => statTile(stat, theme))) : null,
            view.monster ? monsterBlock(board) : null,
            view.lines ? view.lines.map((line) => h('p', { class: 'text-lg break-words' }, line)) : null,
            view.move
                ? h('div', { id: 'boardMoveHint', class: 'rounded-xl p-4 space-y-1', style: insetColors(theme) },
                    h('p', { class: 'text-2xl font-black' }, view.move.headline),
                    h('p', null, view.move.detail))
                : null
        ];
    }

    function renderGrid(board) {
        const move = movePreview(board);
        const options = { theme: boardTheme(board.worldKey), figureAt: currentField(board), target: move ? move.to : null };
        patch(grid, JSON.stringify([board.worldKey, options.figureAt, options.target, board.portals]),
            () => snakeOrder(boardFields(board)).map((field, index) => fieldTile(field, index, options)));
    }

    function renderGroups(board, teams) {
        groupsHeading.textContent = board.round > 0 ? `Gruppen in Runde ${board.round}` : 'Gruppen';
        if (board.groups.length === 0) {
            groupCache.clear();
            mount(groupList, h('p', { class: 'text-slate-400 italic' }, 'Noch keine Gruppen beigetreten.'));
            return;
        }
        const codes = new Map(teams.map((team) => [team.id, team.team_code]));
        const active = document.activeElement;
        const focusKey = active && groupList.contains(active) ? active.dataset.focusKey : null;
        const seen = new Set();
        const roundOver = board.phase !== 'round' && board.phase !== 'lobby';
        const cards = board.groups.map((group) => {
            const signature = JSON.stringify([group, codes.get(group.teamId), board.worldKey, roundOver]);
            seen.add(group.teamId);
            let entry = groupCache.get(group.teamId);
            if (!entry || entry.signature !== signature) {
                entry = { signature, el: groupCard(group, groupView(group, groupTask(board, group), { roundOver }), codes.get(group.teamId), onDeleteTeam) };
                groupCache.set(group.teamId, entry);
            }
            return entry.el;
        });
        [...groupCache.keys()].filter((id) => !seen.has(id)).forEach((id) => groupCache.delete(id));
        mount(groupList, cards);
        if (focusKey) {
            const next = groupList.querySelector(`[data-focus-key="${focusKey}"]`);
            if (next) next.focus();
        }
    }

    /** Zeichnet den Stand. Liefert den Audio-Schlüssel der angezeigten Monster-Aufgabe oder null. */
    function render({ board, session, teams }) {
        const view = phaseView(board, session);
        current = { view, board };
        applyTheme(board.worldKey);

        const key = `${board.phase}:${board.rev}:${session.game_status}`;
        if (phaseKey !== null && phaseKey !== key) guardPresses();
        phaseKey = key;

        root.dataset.phase = board.phase;
        heading.textContent = board.world === null ? 'Hauptbrett' : board.worldName;
        subheading.textContent = `Kartenset: ${board.kartenset} · Figur auf Feld ${currentField(board)}`;
        eyebrow.textContent = view.eyebrow;
        title.textContent = view.title;

        patch(details, JSON.stringify([view, board.monsterTask, board.pending, board.round, board.worldKey]), () => buildDetails(view, board));
        refreshPrimary();
        renderGrid(board);
        patch(legend, JSON.stringify([board.world, board.mainPos, board.portals]), () => portalLegend(board));
        renderGroups(board, teams);
        return view.monster ? monsterAudioKey(board) : null;
    }

    return { render };
}
