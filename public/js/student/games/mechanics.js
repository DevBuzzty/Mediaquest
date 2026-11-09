/* mechanics.js: mood, bucket, ranking, pairs, cloze, countdown. Alles per Tippen, ohne HTML5-Drag-and-Drop. */

import { h, mount, setHidden } from '../../shared/dom.js';
import { BUTTON_BASE, heading, questionLine, questionOf, shake } from './common.js';
import { createBucketModel, createClozeModel, createPairAssignModel, createPairsModel, shuffle, shuffleAway, swap } from './logic.js';

const PAIR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const SELECTED_CHIP = 'border-white ring-2 ring-white';

function hintLine(text) {
    return h('p', { class: 'text-[10px] text-slate-400 uppercase font-black tracking-widest' }, text);
}

export function renderMood(container, task, ctx) {
    const slider = h('input', {
        type: 'range',
        min: '1',
        max: '100',
        value: '50',
        'aria-label': questionOf(task, 'Wie stehst du dazu?'),
        class: 'w-full h-3 bg-slate-800 rounded-full cursor-pointer accent-pink-500 border border-slate-700'
    });
    const tag = (text) => h('span', { class: 'bg-slate-800 px-3 py-1 rounded-lg border border-slate-700 break-words' }, text);

    container.append(h('div', { class: 'space-y-12 py-12' },
        heading('Barometer', 'text-pink-500'),
        h('p', { class: 'text-xl text-slate-100 font-black leading-tight break-words' }, questionOf(task, 'Wie stehst du dazu?')),
        h('div', { class: 'px-6 space-y-6' },
            slider,
            h('div', { class: 'flex justify-between gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400' },
                tag(task.labelLeft || 'Schlecht'),
                tag(task.labelRight || 'Gut'))),
        h('button', {
            type: 'button',
            class: `${BUTTON_BASE} bg-pink-600 hover:bg-pink-500 text-white text-xl`,
            onClick: () => ctx.complete({ value: Number(slider.value) })
        }, 'Absenden')));
}

function placedColors(item, bucket, ctx) {
    if (ctx.neutralFeedback) return 'bg-blue-600/20 border-blue-400 text-blue-200';
    return item.target === bucket ? 'bg-green-600/20 border-green-500 text-green-400' : 'bg-red-600/20 border-red-500 text-red-400';
}

export function renderBucket(container, task, ctx) {
    const items = Array.isArray(task.items) ? task.items : [];
    const buckets = Array.isArray(task.buckets) ? task.buckets : [];
    const model = createBucketModel(items);
    const area = h('div', { class: 'space-y-6' });

    function draw() {
        const open = items.map((item, index) => ({ item, index })).filter(({ index }) => !model.isPlaced(index));
        mount(area,
            heading('Bucket Drop', 'text-orange-500'),
            task.question ? questionLine(task, '') : null,
            hintLine('Tippe erst auf einen Begriff, dann auf einen Korb'),
            h('div', { class: 'flex flex-wrap gap-2 justify-center min-h-[100px] p-4 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-700' },
                open.map(({ item, index }) => h('button', {
                    type: 'button',
                    'aria-pressed': model.selected === index,
                    class: ['bg-slate-800 p-4 rounded-2xl border-2 border-slate-700 shadow-lg text-sm font-black text-slate-200 transition-all break-words', model.selected === index && SELECTED_CHIP],
                    onClick: () => {
                        model.tapItem(index);
                        draw();
                    }
                }, item.text))),
            h('div', { class: 'grid grid-cols-2 gap-4' }, buckets.map((label, bucket) => h('button', {
                type: 'button',
                class: 'bg-slate-800/50 p-4 rounded-[2rem] border-4 border-dashed border-slate-700 min-h-[160px] flex flex-col items-center justify-start text-center transition-all min-w-0',
                onClick: () => {
                    if (!model.tapBucket(bucket)) return;
                    draw();
                    if (model.complete) ctx.completeAfter(1000, { placements: model.placements(buckets) });
                }
            },
            h('span', { class: 'text-4xl mb-3 opacity-30' }, '🗑️'),
            h('span', { class: 'font-black text-xs uppercase tracking-widest text-slate-400 mb-4 break-words max-w-full' }, label),
            h('span', { class: 'block space-y-2 w-full' }, model.placedIn(bucket).map(({ item }) => h('span', {
                class: ['block p-2 text-[10px] font-black uppercase rounded-xl border-2 shadow-inner break-words',
                    placedColors(item, bucket, ctx)]
            }, item.text)))))));
    }

    container.append(area);
    draw();
}

export function renderRanking(container, task, ctx) {
    const original = Array.isArray(task.items) ? task.items : [];
    let order = shuffleAway(original);
    let selected = null;
    const area = h('div', { class: 'space-y-6' });

    function draw() {
        mount(area,
            heading('Ranking', 'text-yellow-500'),
            task.question ? questionLine(task, '') : null,
            hintLine('Tippe zwei Einträge an, um sie zu tauschen'),
            h('div', { class: 'space-y-3' }, order.map((item, index) => h('button', {
                type: 'button',
                'aria-pressed': selected === index,
                class: ['w-full bg-slate-800 p-5 rounded-2xl border-2 border-slate-700 flex items-center gap-5 transition-all text-left', selected === index && SELECTED_CHIP],
                onClick: () => {
                    if (selected === null) {
                        selected = index;
                    } else {
                        if (selected !== index) order = swap(order, selected, index);
                        selected = null;
                    }
                    draw();
                }
            },
            h('span', { class: 'w-8 h-8 shrink-0 rounded-full bg-slate-900 flex items-center justify-center text-xs font-black text-yellow-500 border border-slate-700' }, index + 1),
            h('span', { class: 'flex-1 font-bold text-slate-300 break-words min-w-0' }, item)))),
            h('button', {
                type: 'button',
                class: `${BUTTON_BASE} bg-yellow-700 hover:bg-yellow-800 text-white`,
                onClick: () => ctx.complete({ order })
            }, 'Reihenfolge absenden'));
    }

    container.append(area);
    draw();
}

/** Brettspiel: Die Zuordnung kennt nur der Server. Die Gruppe verbindet alle Paare und gibt einmal ab. */
function renderPairAssignment(container, pairs, task, ctx) {
    const model = createPairAssignModel(pairs.length);
    const order = { left: shuffle(pairs.map((_, index) => index)), right: shuffle(pairs.map((_, index) => index)) };
    const buttons = { left: new Map(), right: new Map() };
    const submit = h('button', {
        type: 'button',
        disabled: true,
        class: `${BUTTON_BASE} bg-indigo-600 hover:bg-indigo-500 text-white`,
        dataset: { role: 'pairs-submit' },
        onClick: () => {
            if (!model.complete) return;
            ctx.complete({ assignments: model.links().map(([left, right]) => ({ left: pairs[left].left, right: pairs[right].right })) });
        }
    }, 'Abgeben');

    function paint() {
        ['left', 'right'].forEach((side) => buttons[side].forEach(({ button, badge }, index) => {
            const link = model.linkOf(side, index);
            const selected = model.isSelected(side, index);
            const number = link === null ? -1 : order.left.indexOf(link);
            const color = number === -1 ? '' : PAIR_COLORS[number % PAIR_COLORS.length];
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('border-blue-500', selected);
            button.classList.toggle('bg-blue-600/20', selected);
            button.style.borderColor = selected ? '' : color;
            button.style.backgroundColor = selected || !color ? '' : `${color}20`;
            badge.textContent = number === -1 ? '' : String(number + 1);
            setHidden(badge, number === -1);
        }));
        submit.disabled = !model.complete;
    }

    const column = (side) => h('div', { class: 'space-y-3' }, order[side].map((index) => {
        const badge = h('span', { class: 'hidden ml-2 px-1.5 rounded-full bg-slate-900 text-white text-[11px]' });
        const button = h('button', {
            type: 'button',
            'aria-pressed': false,
            class: 'w-full min-h-[5rem] bg-slate-800 p-3 rounded-2xl border-2 border-slate-700 text-xs font-black tracking-tight text-slate-200 transition-all leading-tight shadow-lg break-words',
            dataset: { side, pair: index },
            onClick: () => {
                model.tap(side, index);
                paint();
            }
        }, pairs[index][side], badge);
        buttons[side].set(index, { button, badge });
        return button;
    }));

    container.append(h('div', { class: 'space-y-6' },
        heading('Match', 'text-indigo-500'),
        task.question ? questionLine(task, '') : null,
        h('p', { class: 'text-sm font-bold text-slate-300' }, 'Tippt links und rechts an, was zusammengehört. Antippen löst ein Paar wieder.'),
        h('div', { class: 'grid grid-cols-2 gap-4' }, column('left'), column('right')),
        submit));
}

export function renderPairs(container, task, ctx) {
    const pairs = Array.isArray(task.pairs) ? task.pairs : [];
    if (ctx.neutralFeedback) {
        renderPairAssignment(container, pairs, task, ctx);
        return;
    }
    const model = createPairsModel(pairs.length);
    const leftOrder = shuffle(pairs.map((_, index) => index));
    const rightOrder = shuffle(pairs.map((_, index) => index));
    const baseClass = 'w-full min-h-[5rem] bg-slate-800 p-3 rounded-2xl border-2 border-slate-700 text-xs font-black tracking-tight text-slate-300 transition-all leading-tight shadow-lg break-words';
    const buttons = { left: new Map(), right: new Map() };

    function refreshSelection() {
        ['left', 'right'].forEach((side) => buttons[side].forEach((button, pair) => {
            if (model.isMatched(pair)) return;
            const on = Boolean(model.selected && model.selected.side === side && model.selected.pair === pair);
            button.setAttribute('aria-pressed', String(on));
            button.classList.toggle('border-blue-500', on);
            button.classList.toggle('bg-blue-600/20', on);
        }));
    }

    function onTap(side, pair) {
        const outcome = model.tap(side, pair);
        if (outcome.result === 'mismatch') shake(buttons[side].get(pair));
        if (outcome.result === 'match') {
            const color = PAIR_COLORS[(model.matchedCount - 1) % PAIR_COLORS.length];
            [buttons.left.get(pair), buttons.right.get(pair)].forEach((button) => {
                button.disabled = true;
                button.setAttribute('aria-pressed', 'false');
                button.classList.remove('border-blue-500', 'bg-blue-600/20');
                button.style.backgroundColor = `${color}20`;
                button.style.borderColor = color;
                button.style.color = color;
            });
        }
        refreshSelection();
        if (model.complete) ctx.completeAfter(800, { matched: model.matchedCount });
    }

    const column = (side, order, key) => h('div', { class: 'space-y-3' }, order.map((pair) => {
        const button = h('button', {
            type: 'button',
            'aria-pressed': false,
            class: baseClass,
            dataset: { side, pair },
            onClick: () => onTap(side, pair)
        }, pairs[pair][key]);
        buttons[side].set(pair, button);
        return button;
    }));

    container.append(h('div', { class: 'space-y-6' },
        heading('Match', 'text-indigo-500'),
        task.question ? questionLine(task, '') : null,
        h('div', { class: 'grid grid-cols-2 gap-4' }, column('left', leftOrder, 'left'), column('right', rightOrder, 'right'))));
}

export function renderCloze(container, task, ctx) {
    const parsed = window.TaskTypes.parseCloze(task.text);
    const model = createClozeModel(parsed.gaps, Array.isArray(task.fakes) ? task.fakes : []);
    const area = h('div', { class: 'space-y-6' });

    function draw() {
        mount(area,
            heading('Lückentext', 'text-blue-500'),
            task.question ? questionLine(task, '') : null,
            hintLine('Tippe erst auf ein Wort, dann auf eine Lücke'),
            h('div', { class: 'bg-slate-800 p-6 rounded-[2rem] border border-slate-700 text-base leading-loose text-left shadow-2xl font-medium text-slate-300 break-words' },
                parsed.parts.map((part) => {
                    if (part.gap === undefined) return part.text;
                    const word = model.slotWord(part.gap);
                    return h('button', {
                        type: 'button',
                        'aria-label': word ? `Lücke ${part.gap + 1}: ${word}` : `Lücke ${part.gap + 1}, leer`,
                        class: ['border-b-4 border-blue-500 px-3 py-1 mx-1 inline-block min-w-[80px] rounded-lg font-black', word ? 'bg-blue-600/20 text-white' : 'bg-slate-950/50 text-slate-500'],
                        dataset: { gap: part.gap },
                        onClick: () => {
                            model.tapGap(part.gap);
                            draw();
                        }
                    }, word || '...');
                })),
            h('div', { class: 'flex flex-wrap gap-2 justify-center min-h-[64px] p-4 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-700' },
                model.available().map((chip) => h('button', {
                    type: 'button',
                    'aria-pressed': model.selected === chip.id,
                    class: ['bg-blue-600 text-white px-4 py-2 rounded-xl shadow-lg font-bold text-sm transition-all border-2 border-transparent break-words', model.selected === chip.id && SELECTED_CHIP],
                    dataset: { chip: chip.id },
                    onClick: () => {
                        model.tapChip(chip.id);
                        draw();
                    }
                }, chip.word))),
            h('button', {
                type: 'button',
                disabled: !model.complete,
                class: `${BUTTON_BASE} bg-blue-600 hover:bg-blue-500 text-white`,
                onClick: () => ctx.complete({ gaps: model.answer })
            }, 'Fertig'));
    }

    container.append(area);
    draw();
}

export function renderCountdown(container, task, ctx) {
    const duration = Number.isInteger(task.duration) && task.duration > 0 ? task.duration : 60;
    const display = h('div', {
        class: 'text-7xl font-black text-white bg-slate-800 w-56 h-56 rounded-full border-[12px] border-red-600 flex items-center justify-center mx-auto shadow-2xl transition-all duration-300'
    }, duration);
    let stopTicking = () => {};

    function expire() {
        stopTicking();
        display.textContent = '0';
        setHidden(finish, true);
        message.textContent = 'Zeit abgelaufen!';
        setHidden(message, false);
        ctx.completeAfter(1500, { expired: true });
    }

    const finish = h('button', {
        type: 'button',
        class: 'bg-blue-600 hover:bg-blue-500 text-white px-16 py-5 rounded-3xl font-black text-xl uppercase tracking-widest shadow-2xl transition-all active:scale-95 hidden',
        onClick: () => {
            stopTicking();
            ctx.complete({ expired: false });
        }
    }, 'Fertig');
    const message = h('p', { class: 'text-2xl font-black text-red-400 hidden', role: 'status' });

    const start = h('button', {
        type: 'button',
        class: 'bg-green-600 hover:bg-green-500 text-white px-16 py-5 rounded-3xl font-black text-2xl uppercase tracking-widest shadow-2xl transition-all active:scale-95',
        onClick: () => {
            start.remove();
            setHidden(finish, false);
            // Nach der Uhr statt nach Ticks: Im Hintergrund drosseln Browser die Intervalle.
            const endAt = Date.now() + duration * 1000;
            stopTicking = ctx.setInterval(() => {
                const left = Math.ceil((endAt - Date.now()) / 1000);
                if (left <= 0) {
                    expire();
                    return;
                }
                display.textContent = String(left);
                if (left <= 10) {
                    display.classList.add('animate-pulse', 'border-red-400');
                    if (left % 2 === 0 && typeof navigator.vibrate === 'function') navigator.vibrate(100);
                }
            }, 250);
        }
    }, 'Start');

    container.append(h('div', { class: 'space-y-10 py-12' },
        heading('Countdown!', 'text-red-500'),
        display,
        h('p', { class: 'text-2xl font-black text-slate-200 break-words' }, questionOf(task, 'Löse die Aufgabe!')),
        message,
        h('div', { class: 'pt-8' }, start, finish)));
}
