/*
 * board-setup.js: Formularteil "Brettspiel anlegen": Anzahl der Welten, Welt je Portal, Kartensets.
 * Die Reihenfolge der fünf Welten bleibt immer vollständig; die ersten worldCount gehören zu den Portalen.
 * Wer eine schon vergebene Welt wählt, tauscht sie mit dem anderen Portal, Doppelte entstehen so nicht.
 */
import { h, mount } from '../shared/dom.js';

const GameRules = globalThis.GameRules;
const MAIN = GameRules.MAIN_WORLD;

const SELECT_CLASS = 'w-full min-h-[3rem] bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 font-bold text-blue-400 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60';
const ROW_CLASS = 'bg-slate-700/30 border border-slate-700 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-center';
const HEADING_CLASS = 'text-xs font-black uppercase text-slate-400 tracking-widest';

export function createBoardSetup(root) {
    let blueprints = [];
    let worldCount = GameRules.MAX_WORLDS;
    const order = [...GameRules.WORLD_KEYS];
    const chosen = new Map();

    function setsFor(world) {
        return blueprints.filter((blueprint) => blueprint.content
            && blueprint.content.templateType === 'world' && blueprint.content.world === world);
    }

    /** Gewähltes Set der Welt; ohne Wahl oder nach dem Löschen das erste passende. */
    function selectedSet(world) {
        const list = setsFor(world);
        return list.find((blueprint) => String(blueprint.id) === chosen.get(world)) || list[0] || null;
    }

    function setSelect(world, label) {
        const list = setsFor(world);
        const current = selectedSet(world);
        return h('select', {
            class: SELECT_CLASS,
            'aria-label': label,
            disabled: list.length === 0,
            dataset: { setSelect: world, focusKey: `set-${world}` },
            value: current ? String(current.id) : '',
            onChange: (event) => chosen.set(world, event.target.value)
        }, list.length === 0
            ? h('option', { value: '' }, 'Kein Kartenset vorhanden')
            : list.map((blueprint) => h('option', { value: String(blueprint.id) }, blueprint.title)));
    }

    function pickWorld(index, world) {
        const other = order.indexOf(world);
        if (other === -1 || other === index) return;
        [order[index], order[other]] = [order[other], order[index]];
        render();
    }

    function worldSelect(index, world, field) {
        return h('select', {
            class: SELECT_CLASS,
            'aria-label': `Welt für das Portal auf Feld ${field}`,
            dataset: { worldSelect: index, focusKey: `world-${index}` },
            value: world,
            onChange: (event) => pickWorld(index, event.target.value)
        }, GameRules.WORLD_KEYS.map((key) => h('option', { value: key }, GameRules.worldName(key))));
    }

    function fieldBadge(text, world) {
        const { accent } = GameRules.WORLDS[world].colors;
        return h('span', {
            class: 'inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-black whitespace-nowrap',
            style: { backgroundColor: accent, color: GameRules.readableText(accent) }
        }, text);
    }

    function portalRow(field, index) {
        const world = order[index];
        return h('div', { class: ROW_CLASS, dataset: { portalField: field } },
            fieldBadge(`Feld ${field}`, world),
            worldSelect(index, world, field),
            setSelect(world, `Kartenset für ${GameRules.worldName(world)}`));
    }

    function countOptions() {
        const options = [];
        for (let count = GameRules.MIN_WORLDS; count <= GameRules.MAX_WORLDS; count += 1) {
            options.push(h('option', { value: String(count) }, `${count} ${count === 1 ? 'Welt' : 'Welten'}`));
        }
        return options;
    }

    function render() {
        const active = document.activeElement;
        const focusKey = active && root.contains(active) ? active.dataset.focusKey : null;
        mount(root,
            h('div', { class: 'space-y-2' },
                h('label', { for: 'boardWorldCount', class: `block ${HEADING_CLASS}` }, '2. Wie viele Welten spielt ihr?'),
                h('select', {
                    id: 'boardWorldCount',
                    class: `${SELECT_CLASS} md:w-64`,
                    dataset: { focusKey: 'count' },
                    value: String(worldCount),
                    onChange: (event) => {
                        worldCount = Number(event.target.value);
                        render();
                    }
                }, countOptions())),
            h('div', { class: 'space-y-3' },
                h('p', { class: HEADING_CLASS }, '3. Welt und Kartenset je Portalfeld'),
                GameRules.portalFields(worldCount).map(portalRow)),
            h('div', { class: 'space-y-3' },
                h('p', { class: HEADING_CLASS }, '4. Kartenset für das Hauptbrett'),
                h('div', { class: ROW_CLASS },
                    fieldBadge('Haupt', MAIN),
                    h('span', { class: 'font-bold text-slate-200 break-words' }, GameRules.worldName(MAIN)),
                    setSelect(MAIN, 'Kartenset für das Hauptbrett'))));
        if (focusKey) {
            const next = root.querySelector(`[data-focus-key="${focusKey}"]`);
            if (next) next.focus();
        }
    }

    /** Neue Liste der Spielrunden; die bisherige Auswahl bleibt, solange es sie noch gibt. */
    function setBlueprints(list) {
        blueprints = list;
        render();
    }

    /** Prüft die Eingaben. @returns {{ error: string }|{ value: object }} */
    function collect() {
        const fields = GameRules.portalFields(worldCount);
        const portals = order.slice(0, fields.length);
        if (fields.length === 0) return { error: 'Bitte wähle aus, wie viele Welten ihr spielt.' };
        if (new Set(portals).size !== portals.length) return { error: 'Jede Welt darf nur einem Portal zugeordnet sein.' };
        const sets = {};
        for (const world of [MAIN, ...portals]) {
            const set = selectedSet(world);
            if (!set) {
                return { error: `Für „${GameRules.worldName(world)}“ gibt es noch kein Kartenset. Lege im Spielrunden-Editor eines an.` };
            }
            sets[world] = set.id;
        }
        return { value: { worldCount, portals, sets } };
    }

    return { setBlueprints, collect };
}
