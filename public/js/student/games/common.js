/* common.js: Bausteine, die sich die Mini-Games teilen. Bewegung läuft über die Web Animations API (CSP). */

import { h } from '../../shared/dom.js';

export const BUTTON_BASE = 'w-full min-h-[3rem] p-4 rounded-2xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';

export function heading(text, colorClass) {
    return h('h2', { class: ['text-2xl font-black uppercase tracking-tighter', colorClass] }, text);
}

export function questionOf(task, fallback) {
    return typeof task.question === 'string' && task.question.trim() ? task.question : fallback;
}

export function questionLine(task, fallback) {
    return h('p', { class: 'text-slate-200 text-lg font-bold break-words' }, questionOf(task, fallback));
}

export function errorLine() {
    const line = h('p', { class: 'text-sm font-bold text-red-400 hidden', role: 'alert' });
    line.show = (text) => {
        line.textContent = text || '';
        line.classList.toggle('hidden', !text);
    };
    return line;
}

/** Notausgang, der erst erscheint, wenn eine Aufgabe sich nicht abschließen lässt. */
export function skipOffer(ctx) {
    const button = h('button', {
        type: 'button',
        class: 'w-full min-h-[3rem] p-4 rounded-2xl font-bold bg-slate-700 hover:bg-slate-600 text-white hidden',
        onClick: () => ctx.skip()
    }, 'Überspringen');
    button.show = (visible) => button.classList.toggle('hidden', !visible);
    return button;
}

function reducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animate(el, frames, options) {
    if (typeof el.animate !== 'function' || reducedMotion()) return;
    try {
        el.animate(frames, options);
    } catch (err) {
        console.warn(err);
    }
}

export function popIn(el) {
    animate(el, [
        { transform: 'scale(0.9)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 }
    ], { duration: 220, easing: 'ease-out' });
}

export function shake(el) {
    animate(el, [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-10px)' },
        { transform: 'translateX(10px)' },
        { transform: 'translateX(0)' }
    ], { duration: 300 });
}

export function flyOut(el, direction) {
    const sign = direction === 'left' ? -1 : 1;
    animate(el, [
        { transform: el.style.transform || 'none', opacity: 1 },
        { transform: `translateX(${sign * 150}%) rotate(${sign * 20}deg)`, opacity: 0 }
    ], { duration: 400, easing: 'ease-in', fill: 'forwards' });
}

/** Zeigt statt eines kaputten Bildes einen Hinweis, das Spiel bleibt bedienbar. */
export function taskImage(task, className, onFailure) {
    const hasImage = typeof task.image === 'string' && task.image.length > 0;
    return h('img', {
        src: hasImage ? task.image : null,
        alt: '',
        draggable: 'false',
        class: className,
        onError: onFailure
    });
}
