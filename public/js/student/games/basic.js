/* basic.js: binary, choice, select und der Stopp-Bildschirm einer Monster-Aufgabe. */

import { h } from '../../shared/dom.js';
import { BUTTON_BASE, flyOut, heading, popIn, questionLine } from './common.js';

const SWIPE_THRESHOLD_PX = 80;

export function renderBinary(container, task, ctx) {
    const hint = h('p', { class: 'text-xs text-slate-400 uppercase font-black tracking-widest' }, 'Entscheide jetzt');
    const card = h('div', {
        class: 'w-64 h-80 mx-auto bg-slate-800 rounded-[3rem] border-4 border-slate-700 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden touch-pan-y select-none cursor-grab',
        dataset: { role: 'swipe-card' }
    },
    h('div', { class: 'text-8xl mb-4 break-words' }, task.icon || '🖼️'),
    h('div', { class: 'absolute bottom-0 left-0 right-0 p-6 bg-slate-900/90 border-t border-slate-700' }, hint));

    function decide(direction) {
        if (!ctx.completeAfter(420, { choice: direction })) return;
        flyOut(card, direction);
    }

    let pointerId = null;
    let startX = 0;
    let deltaX = 0;

    function reset() {
        pointerId = null;
        deltaX = 0;
        card.style.transition = 'transform 0.3s ease-out';
        card.style.transform = '';
        card.style.borderColor = '';
    }

    card.addEventListener('pointerdown', (event) => {
        if (ctx.done) return;
        pointerId = event.pointerId;
        startX = event.clientX;
        deltaX = 0;
        card.style.transition = 'none';
        if (typeof card.setPointerCapture === 'function') {
            try {
                card.setPointerCapture(event.pointerId);
            } catch (err) {
                console.warn(err);
            }
        }
    });
    card.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        deltaX = event.clientX - startX;
        card.style.transform = `translateX(${deltaX}px) rotate(${deltaX / 10}deg)`;
        if (Math.abs(deltaX) > 50) card.style.borderColor = deltaX > 0 ? '#22c55e' : '#ef4444';
        else card.style.borderColor = '';
    });
    card.addEventListener('pointerup', (event) => {
        if (event.pointerId !== pointerId) return;
        const distance = deltaX;
        pointerId = null;
        // Ein Tipp bewegt die Karte nicht und ist daher keine Entscheidung.
        if (Math.abs(distance) >= SWIPE_THRESHOLD_PX) decide(distance > 0 ? 'right' : 'left');
        else reset();
    });
    card.addEventListener('pointercancel', (event) => {
        if (event.pointerId === pointerId) reset();
    });

    const area = h('div', { class: 'space-y-6' },
        heading('Binary Swipe', 'text-blue-500'),
        questionLine(task, 'Echt oder Fake?'),
        card,
        h('div', { class: 'flex justify-center gap-8 pt-4' },
            h('button', {
                type: 'button',
                'aria-label': 'Nach links, Nein',
                class: 'w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all border-4 border-red-900/50 text-2xl',
                onClick: () => decide('left')
            }, '❌'),
            h('button', {
                type: 'button',
                'aria-label': 'Nach rechts, Ja',
                class: 'w-16 h-16 bg-green-600 hover:bg-green-500 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all border-4 border-green-900/50 text-2xl',
                onClick: () => decide('right')
            }, '✅')));
    container.append(area);
    popIn(area);
}

function optionLabel(option, index) {
    return option.includes(')') ? option : `${String.fromCharCode(65 + (index % 26))}) ${option}`;
}

export function renderChoice(container, task, ctx) {
    const options = Array.isArray(task.options) ? task.options : [];
    const buttons = options.map((option, index) => h('button', {
        type: 'button',
        class: 'w-full bg-slate-800 hover:bg-slate-700 p-4 rounded-2xl border-2 border-slate-700 text-left transition-all font-bold text-slate-300 break-words',
        onClick: () => {
            if (!ctx.complete({ index, label: option })) return;
            buttons[index].classList.add('bg-blue-600', 'border-blue-400', 'text-white');
        }
    }, optionLabel(option, index)));

    container.append(h('div', { class: 'space-y-6' },
        heading('Quiz', 'text-purple-500'),
        questionLine(task, 'Wähle die richtige Antwort'),
        h('div', { class: 'grid grid-cols-1 gap-3' }, buttons)));
}

export function renderSelect(container, task, ctx) {
    const options = Array.isArray(task.options) ? task.options : [];
    const boxes = options.map(() => h('input', { type: 'checkbox', class: 'w-6 h-6 shrink-0 accent-yellow-500' }));

    container.append(h('div', { class: 'space-y-6' },
        heading('Checklist', 'text-yellow-500'),
        questionLine(task, 'Markiere alle richtigen Antworten'),
        h('div', { class: 'space-y-2 text-left' }, options.map((option, index) => h('label', {
            class: 'flex items-center gap-4 p-4 bg-slate-800 rounded-2xl cursor-pointer hover:bg-slate-700 transition-all border border-slate-700'
        }, boxes[index], h('span', { class: 'font-bold text-slate-300 break-words min-w-0' }, option)))),
        h('button', {
            type: 'button',
            class: `${BUTTON_BASE} bg-yellow-700 hover:bg-yellow-800 text-white`,
            onClick: () => {
                const indices = boxes.flatMap((box, index) => (box.checked ? [index] : []));
                ctx.complete({ indices, labels: indices.map((index) => options[index]) });
            }
        }, 'Absenden')));
}

/** Die Aufgabe selbst sieht nur die Lehrkraft. Weiter geht es, wenn sie bestätigt (monsterConfirmed). */
export function renderMonster(container, task) {
    const hasImage = typeof task.image === 'string' && task.image.length > 0;
    const emblem = h('div', { class: 'text-8xl', 'aria-hidden': true }, '👾');
    const tile = hasImage ? h('img', {
        src: task.image,
        alt: '',
        draggable: 'false',
        class: 'block mx-auto w-auto h-auto max-w-full max-h-64 rounded-3xl shadow-2xl',
        onError: () => tile.replaceWith(emblem)
    }) : emblem;
    container.append(h('div', { class: 'space-y-5 py-6' },
        heading('Monster-Aufgabe', 'text-pink-500'),
        tile,
        h('p', { class: 'text-2xl font-black text-white' }, 'Stopp!'),
        h('p', { class: 'text-slate-300 font-bold' }, 'Eure Lehrkraft hat diese Aufgabe auf dem Tablet.'),
        h('p', { class: 'text-lg font-black text-amber-300', dataset: { role: 'monster-wait' } }, 'Wartet auf eure Lehrkraft')));
}
