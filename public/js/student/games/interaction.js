/* interaction.js: chat, scroller, detector, hotspot. */

import { h, mount, setHidden } from '../../shared/dom.js';
import { BUTTON_BASE, heading, questionLine, questionOf, taskImage } from './common.js';

const MAX_CHAT_PATH = 200;
const HOTSPOT_MISSES_UNTIL_EXIT = 6;
const HOTSPOT_MS_UNTIL_EXIT = 45000;
const LENS_RADIUS = 80;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function renderChat(container, task, ctx) {
    const nodes = task.nodes && typeof task.nodes === 'object' ? task.nodes : {};
    const path = [];
    const area = h('div', { class: 'space-y-6' });
    const header = h('div', { class: 'space-y-2' },
        heading(`Chat: ${task.partner || 'Unbekannt'}`, 'text-blue-500'),
        task.question ? questionLine(task, '') : null);

    function draw(id) {
        const node = hasOwn(nodes, id) ? nodes[id] : null;
        const options = node && Array.isArray(node.options) ? node.options : [];
        mount(area,
            header,
            h('div', { class: 'bg-slate-900/50 p-6 rounded-[2rem] border border-slate-700 min-h-[120px] flex items-center justify-start text-left shadow-inner' },
                h('div', { class: 'bg-blue-600 p-4 rounded-2xl rounded-bl-none max-w-[85%] shadow-lg' },
                    h('p', { class: 'text-sm font-bold leading-relaxed break-words' }, node ? node.text : 'Der Chat ist zu Ende.'))),
            h('div', { class: 'space-y-2' },
                options.map((option) => h('button', {
                    type: 'button',
                    class: 'w-full bg-slate-800 hover:bg-slate-700 p-4 rounded-2xl border-2 border-slate-700 text-sm font-bold text-slate-300 transition-all active:scale-95 break-words',
                    onClick: () => {
                        if (path.length < MAX_CHAT_PATH) path.push({ node: id, choice: option.label });
                        draw(option.next);
                    }
                }, option.label)),
                options.length === 0 ? h('button', {
                    type: 'button',
                    class: `${BUTTON_BASE} bg-blue-600 hover:bg-blue-500 text-white mt-4`,
                    onClick: () => ctx.complete({ path })
                }, 'Chat beenden') : null));
    }

    container.append(area);
    draw('start');
}

export function renderScroller(container, task, ctx) {
    const posts = Array.isArray(task.posts) ? task.posts : [];
    const marked = new Set();

    const cards = posts.map((post, index) => {
        const card = h('button', {
            type: 'button',
            'aria-pressed': false,
            class: 'block w-full text-left p-5 bg-slate-800 rounded-3xl border-2 border-slate-700 space-y-3 transition-all active:scale-[0.98]',
            onClick: () => {
                const on = !marked.has(index);
                if (on) marked.add(index);
                else marked.delete(index);
                card.setAttribute('aria-pressed', String(on));
                let color = post.isBad ? ['border-green-500', 'bg-green-900/20'] : ['border-red-500', 'bg-red-900/20'];
                if (ctx.neutralFeedback) color = ['border-blue-400', 'bg-blue-900/20'];
                color.forEach((name) => card.classList.toggle(name, on));
                card.classList.toggle('bg-slate-800', !on);
                card.classList.toggle('border-slate-700', !on);
            }
        },
        h('span', { class: 'flex items-center gap-3' },
            h('span', { class: 'w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs' }, '👤'),
            h('span', { class: 'font-black text-xs text-blue-400 break-all' }, `@${post.user}`)),
        h('span', { class: 'block text-sm text-slate-300 leading-relaxed font-medium break-words' }, post.text));
        return card;
    });

    container.append(h('div', { class: 'space-y-4 max-h-[600px] overflow-y-auto p-4 border-2 border-slate-800 rounded-[2.5rem] bg-slate-900/50' },
        h('div', { class: 'sticky top-0 bg-slate-900/90 py-4 z-10' },
            heading('Feed-Check', 'text-blue-400'),
            h('p', { class: 'text-[10px] text-slate-400 uppercase font-black tracking-widest' }, questionOf(task, 'Markiere alle problematischen Posts'))),
        cards,
        h('div', { class: 'py-8 text-center' },
            h('button', {
                type: 'button',
                class: 'bg-blue-600 hover:bg-blue-500 text-white px-12 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl',
                onClick: () => ctx.complete({ marked: [...marked].sort((a, b) => a - b) })
            }, 'Fertig'))));
}

function imageFailureHint() {
    return h('p', { class: 'text-sm font-bold text-amber-400 hidden', role: 'alert' }, 'Das Bild konnte nicht geladen werden. Sag bitte deiner Lehrkraft Bescheid.');
}

export function renderDetector(container, task, ctx) {
    const failure = imageFailureHint();
    const showFailure = () => setHidden(failure, false);
    const lensImage = taskImage(task, 'absolute object-cover max-w-none');
    const lens = h('div', {
        class: 'absolute w-40 h-40 rounded-full border-4 border-white overflow-hidden pointer-events-none hidden shadow-2xl'
    }, lensImage);
    const stage = h('div', {
        class: 'relative w-full aspect-[4/3] bg-slate-800 rounded-[2rem] overflow-hidden touch-none border-4 border-slate-700 shadow-2xl',
        dataset: { role: 'detector-stage' }
    },
    taskImage(task, 'w-full h-full object-cover blur-xl opacity-50', showFailure),
    lens);

    function moveLens(event) {
        const rect = stage.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
            setHidden(lens, true);
            return;
        }
        setHidden(lens, false);
        lens.style.left = `${x - LENS_RADIUS}px`;
        lens.style.top = `${y - LENS_RADIUS}px`;
        lensImage.style.width = `${rect.width}px`;
        lensImage.style.height = `${rect.height}px`;
        lensImage.style.left = `${LENS_RADIUS - x}px`;
        lensImage.style.top = `${LENS_RADIUS - y}px`;
    }

    stage.addEventListener('pointerdown', moveLens);
    stage.addEventListener('pointermove', moveLens);
    stage.addEventListener('pointerleave', () => setHidden(lens, true));

    container.append(h('div', { class: 'space-y-6' },
        heading('Detektor', 'text-blue-500'),
        questionLine(task, 'Finde die Fehler!'),
        stage,
        failure,
        h('button', {
            type: 'button',
            class: `${BUTTON_BASE} bg-blue-600 hover:bg-blue-500 text-white`,
            onClick: () => ctx.complete(null)
        }, 'Ich habe alles gefunden')));
}

export function renderHotspot(container, task, ctx) {
    const zones = Array.isArray(task.zones) ? task.zones : [];
    const found = new Set();
    let misses = 0;

    const status = h('span', { class: 'text-xs text-blue-400 font-black uppercase tracking-widest' });
    const finish = () => ctx.complete({ found: [...found].sort((a, b) => a - b) });
    const done = h('button', {
        type: 'button',
        class: 'bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-xl font-black text-xs uppercase hidden',
        onClick: finish
    }, 'Weiter');
    // Winzige Zonen dürfen ein Team nicht festhalten.
    const giveUp = h('button', {
        type: 'button',
        class: 'text-xs font-bold text-slate-400 underline hidden',
        onClick: finish
    }, 'Ich finde nichts mehr');
    const failure = imageFailureHint();

    function showExit() {
        setHidden(giveUp, found.size === zones.length);
    }
    function showFailure() {
        setHidden(failure, false);
        showExit();
    }
    function updateStatus() {
        status.textContent = `Gefunden: ${found.size} / ${zones.length}`;
        const all = found.size === zones.length;
        setHidden(done, !all);
        if (all) setHidden(giveUp, true);
    }

    const layer = h('div', {
        class: 'absolute inset-0 touch-manipulation',
        dataset: { role: 'hotspot-layer' },
        onClick: (event) => {
            const rect = layer.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const x = ((event.clientX - rect.left) / rect.width) * 100;
            const y = ((event.clientY - rect.top) / rect.height) * 100;
            let hit = false;
            zones.forEach((zone, index) => {
                if (found.has(index)) return;
                if (x < zone.x || x > zone.x + zone.w || y < zone.y || y > zone.y + zone.h) return;
                hit = true;
                found.add(index);
                layer.append(h('div', {
                    class: 'absolute border-4 border-green-500 rounded-xl pointer-events-none',
                    style: { left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }
                }));
            });
            if (!hit) {
                misses += 1;
                if (misses >= HOTSPOT_MISSES_UNTIL_EXIT) showExit();
            }
            updateStatus();
        }
    });

    updateStatus();
    ctx.setTimeout(showExit, HOTSPOT_MS_UNTIL_EXIT);

    container.append(h('div', { class: 'space-y-6' },
        heading('Hotspot Suche', 'text-blue-500'),
        questionLine(task, 'Tippe auf die verdächtigen Stellen!'),
        h('div', { class: 'relative w-full aspect-video bg-slate-900 rounded-[2rem] overflow-hidden border-4 border-slate-700 shadow-2xl' },
            taskImage(task, 'w-full h-full object-contain', showFailure),
            layer),
        failure,
        h('div', { class: 'flex justify-between items-center gap-4 px-2' }, status, done),
        h('div', { class: 'text-center' }, giveUp)));
}
