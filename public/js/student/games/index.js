/*
 * games/index.js: Registry der 18 Mini-Games. Wird auch von der Vorschau im Editor benutzt.
 *
 *   import { mountGame, gameRenderers } from '/js/student/games/index.js';
 *
 *   const game = mountGame(container, task, {
 *       onComplete({ status, answer }) { ... },   // status: 'completed' | 'skipped'
 *       uploadPhoto(blob) { return Promise<{ url }> },   // optional, Vorschau: kein Upload
 *       submit(type, content) { return Promise },        // optional, Vorschau: nichts passiert
 *       preview: true,
 *       neutralFeedback: true                            // Brettspiel: keine Richtig/Falsch-Farben, die Lösung fehlt dort
 *   });
 *   game.cleanup();   // beendet Timer und Listener, leert den Container
 *
 * Die Seite braucht das klassische Skript /js/shared/task-types.js (window.TaskTypes).
 * mountGame zeigt die Anleitung (task.description), den Knopf „Vorlesen“ (nur mit task.audio) und
 * das Spiel, Fortschrittsanzeige und Stations-Kopf liegen beim Aufrufer. Die Wiedergabe endet mit
 * cleanup(), also bei jedem Aufgabenwechsel.
 *
 * Vertrag jedes Renderers in gameRenderers[type]:
 *   render(container, task, ctx)  baut das Spiel in container auf
 *   cleanup(container, ctx)       räumt auf
 *
 * ctx:
 *   complete(answer)              meldet das Ergebnis; nur der erste Aufruf zählt (true), danach false
 *   completeAfter(ms, answer)     wie complete, aber erst nach einer Animation; sperrt sofort
 *   skip()                        Notausgang, wenn eine Aufgabe nicht spielbar ist
 *   Nach dem ersten complete, completeAfter oder skip ist der Spielbereich inert.
 *   done, disposed                bereits abgeschlossen / schon aufgeräumt
 *   neutralFeedback               keine Richtig/Falsch-Farben zeigen
 *   setTimeout, setInterval, on, onCleanup   enden automatisch mit der Aufgabe
 *   uploadPhoto(blob), submit(type, content) siehe oben
 */

import { h, clear } from '../../shared/dom.js';
import { createScope } from './scope.js';
import { readAloudPanel } from './audio.js';
import { renderBinary, renderChoice, renderMonster, renderSelect } from './basic.js';
import { renderChat, renderDetector, renderHotspot, renderScroller } from './interaction.js';
import { renderPassword, renderPhoto, renderProfile, renderStatement } from './input.js';
import { renderBucket, renderCloze, renderCountdown, renderMood, renderPairs, renderRanking } from './mechanics.js';

function game(render) {
    return {
        render,
        cleanup(container, ctx) {
            ctx.dispose();
            clear(container);
        }
    };
}

export const gameRenderers = {
    binary: game(renderBinary),
    choice: game(renderChoice),
    select: game(renderSelect),
    chat: game(renderChat),
    scroller: game(renderScroller),
    detector: game(renderDetector),
    hotspot: game(renderHotspot),
    password: game(renderPassword),
    photo: game(renderPhoto),
    statement: game(renderStatement),
    profile: game(renderProfile),
    mood: game(renderMood),
    bucket: game(renderBucket),
    ranking: game(renderRanking),
    pairs: game(renderPairs),
    cloze: game(renderCloze),
    countdown: game(renderCountdown),
    monster: game(renderMonster)
};

export const gameTypes = Object.keys(gameRenderers);

function descriptionPanel(task) {
    if (typeof task.description !== 'string' || !task.description.trim()) return null;
    return h('div', { class: 'mb-6 p-4 bg-slate-800/80 rounded-2xl border border-slate-700 text-sm font-bold text-slate-300 leading-relaxed text-left' },
        h('div', { class: 'flex items-center gap-2 mb-1' },
            h('span', { class: 'text-blue-500' }, 'ℹ️'),
            h('span', { class: 'text-[10px] uppercase font-black text-slate-400 tracking-widest' }, 'Anleitung')),
        h('p', { class: 'break-words' }, task.description));
}

function fallbackPanel(ctx) {
    return h('div', { class: 'space-y-4' },
        h('p', { class: 'font-bold text-amber-400' }, 'Diese Aufgabe kann gerade nicht angezeigt werden. Sag bitte deiner Lehrkraft Bescheid.'),
        h('button', {
            type: 'button',
            class: 'w-full min-h-[3rem] p-4 rounded-2xl font-black uppercase tracking-widest bg-slate-700 hover:bg-slate-600 text-white',
            onClick: () => ctx.skip()
        }, 'Überspringen'));
}

/** Ausstattung für die Vorschau im Editor: nichts verlässt die Seite. */
const previewServices = {
    uploadPhoto: async () => ({ url: '' }),
    submit: async () => ({})
};

export function mountGame(container, task, options = {}) {
    const scope = createScope();
    const { onComplete = () => {}, preview = false } = options;
    const uploadPhoto = options.uploadPhoto || previewServices.uploadPhoto;
    const submit = options.submit || previewServices.submit;
    const area = h('div', { dataset: { game: task && task.type } });
    let locked = false;
    let cancelled = false;

    function deliver(status, answer) {
        if (!scope.disposed) onComplete({ status, answer: answer === undefined ? null : answer });
    }

    /** Das Ergebnis steht fest: Die Anzeige darf ab jetzt nicht mehr davon abweichen. */
    function freeze() {
        locked = true;
        area.inert = true;
    }

    function latch() {
        if (locked || scope.disposed) return false;
        freeze();
        return true;
    }

    const ctx = {
        preview,
        neutralFeedback: Boolean(options.neutralFeedback),
        uploadPhoto,
        submit,
        get done() { return locked; },
        get disposed() { return scope.disposed; },
        complete(answer) {
            if (!latch()) return false;
            deliver('completed', answer);
            return true;
        },
        completeAfter(ms, answer) {
            if (!latch()) return false;
            scope.setTimeout(() => {
                if (!cancelled) deliver('completed', answer);
            }, ms);
            return true;
        },
        skip() {
            if (!latch()) return false;
            deliver('skipped');
            return true;
        },
        setTimeout: (fn, ms) => scope.setTimeout(fn, ms),
        setInterval: (fn, ms) => scope.setInterval(fn, ms),
        on: (target, type, handler, opts) => scope.on(target, type, handler, opts),
        onCleanup: (fn) => scope.onCleanup(fn),
        dispose: () => scope.dispose()
    };

    const renderer = Object.prototype.hasOwnProperty.call(gameRenderers, task && task.type) ? gameRenderers[task.type] : null;
    // Eine Monster-Aufgabe liegt beim Tablet der Lehrkraft: Das Team sieht nur den Stopp-Bildschirm.
    const forTeam = Boolean(task) && task.type !== 'monster';
    const readAloud = forTeam ? readAloudPanel(task, scope) : null;
    const panels = forTeam ? [descriptionPanel(task), readAloud].filter(Boolean) : [];
    container.replaceChildren(...panels, area);

    try {
        if (!renderer) throw new Error(`Unbekannter Aufgaben-Typ: ${task && task.type}`);
        renderer.render(area, task, ctx);
    } catch (err) {
        // Kaputte Aufgaben dürfen nie zu einer leeren, ausweglosen Seite führen.
        console.error(err);
        area.replaceChildren(fallbackPanel(ctx));
    }

    return {
        ctx,
        /** Beendet das Vorlesen, etwa wenn die Aufgabe nur vorübergehend verdeckt wird. */
        stopReading() {
            if (readAloud) readAloud.stop();
        },
        /** Sperrt weitere Eingaben, etwa während eine Station abgebrochen wird. Eine noch laufende Abschluss-Animation meldet dann nichts mehr. */
        lock() {
            cancelled = true;
            freeze();
        },
        cleanup() {
            if (renderer) renderer.cleanup(container, ctx);
            else {
                ctx.dispose();
                clear(container);
            }
        }
    };
}
