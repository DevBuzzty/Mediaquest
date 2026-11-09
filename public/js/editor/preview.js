/*
 * preview.js: Vorschau einer Aufgabe mit den echten Schüler-Renderern.
 * mountGame({ preview: true }) simuliert Upload und Einsendung, es geht nichts an den Server.
 * Monster-Aufgaben sieht nur die Lehrkraft, die Vorschau zeigt deshalb das Tablet.
 * Karten eines Kartensets laufen wie im Brettspiel, also ohne Richtig/Falsch-Rückmeldung.
 */

import { h, mount } from '../shared/dom.js';
import { cleanTask } from './store.js';

const GAMES_MODULE = '../student/games/index.js';

let gamesModule = null;

/** Dynamisch, damit ein Fehler in den Renderern nur die Vorschau trifft und nie den Editor. */
function loadGames() {
    if (!gamesModule) {
        gamesModule = import(GAMES_MODULE).catch((err) => {
            gamesModule = null;
            throw err;
        });
    }
    return gamesModule;
}

function notice(text, detail) {
    return h('div', { class: 'text-center space-y-2 py-8' },
        h('p', { class: 'text-slate-400 text-sm' }, text),
        detail || null);
}

export function createPreview(root, { isBoardCard = () => false } = {}) {
    let game = null;
    let lastKey = null;
    let ticket = 0;
    let voice = null;

    function stopVoice() {
        if (voice) voice.pause();
        voice = null;
    }

    function voiceButton(url) {
        const player = h('audio', { src: url, preload: 'none' });
        voice = player;
        return h('button', {
            type: 'button',
            class: 'bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-bold min-h-[2.75rem]',
            onClick: () => {
                player.currentTime = 0;
                player.play().catch(() => {});
            }
        }, '🔊 Vorlesen');
    }

    function monsterPanel(task) {
        return h('div', { class: 'space-y-4 text-center' },
            h('p', { class: 'text-xs uppercase font-bold text-purple-300 tracking-wide' }, 'Tablet der Lehrkraft'),
            task.image ? h('img', { src: task.image, alt: '', class: 'w-40 h-40 object-cover rounded-2xl mx-auto' }) : null,
            h('p', { class: 'text-lg font-black break-words' }, task.question),
            task.description ? h('p', { class: 'text-sm text-slate-300 break-words' }, task.description) : null,
            task.audio ? voiceButton(task.audio) : null,
            h('button', { type: 'button', disabled: true, class: 'w-full bg-green-600 opacity-50 rounded-xl font-black min-h-[2.75rem]' }, 'Erledigt bestätigen'));
    }

    function stopGame() {
        if (!game) return;
        const running = game;
        game = null;
        try {
            running.cleanup();
        } catch (err) {
            console.warn(err);
        }
    }

    function showResult({ status, answer }, restart) {
        mount(root, h('div', { class: 'space-y-4 text-center py-4' },
            h('p', { class: 'text-green-400 font-bold' }, status === 'skipped' ? 'Aufgabe übersprungen' : 'Aufgabe abgeschlossen'),
            h('p', { class: 'text-xs text-slate-500' }, 'In der Vorschau wird nichts gespeichert.'),
            answer === null ? null : h('pre', { class: 'text-left text-xs text-slate-300 bg-slate-900 rounded-xl p-3 overflow-x-auto' }, JSON.stringify(answer, null, 2)),
            h('button', {
                type: 'button',
                class: 'bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-bold min-h-[2.75rem]',
                onClick: restart
            }, 'Nochmal')));
    }

    async function start(clean) {
        ticket += 1;
        const current = ticket;
        stopGame();
        let games;
        try {
            games = await loadGames();
        } catch (err) {
            console.error(err);
            if (current === ticket) mount(root, notice('Die Vorschau konnte nicht geladen werden.'));
            return;
        }
        if (current !== ticket) return;

        const stage = h('div', { class: 'text-center' });
        mount(root, stage);
        game = games.mountGame(stage, { ...clean, key: 'vorschau' }, {
            preview: true,
            neutralFeedback: isBoardCard(),
            onComplete: (result) => {
                if (current !== ticket) return;
                stopGame();
                showResult(result, () => start(clean));
            }
        });
    }

    return {
        /** Zeigt die Aufgabe; zeichnet nur neu, wenn sich ihr gespeicherter Inhalt geändert hat. */
        show(task) {
            if (!task) {
                ticket += 1;
                lastKey = null;
                stopVoice();
                stopGame();
                mount(root, notice('Noch keine Aufgabe ausgewählt.'));
                return;
            }
            const clean = cleanTask(task);
            const key = JSON.stringify([clean, isBoardCard()]);
            if (key === lastKey) return;
            lastKey = key;
            stopVoice();

            const errors = globalThis.TaskTypes.validate(clean);
            if (errors.length > 0) {
                ticket += 1;
                stopGame();
                mount(root, notice('Die Vorschau erscheint, sobald die Aufgabe vollständig ist:',
                    h('ul', { class: 'text-sm text-amber-300 space-y-1' }, errors.map((text) => h('li', null, text)))));
                return;
            }
            if (clean.type === 'monster') {
                ticket += 1;
                stopGame();
                mount(root, monsterPanel(clean));
                return;
            }
            start(clean);
        },

        /** Erzwingt beim nächsten show() ein Neuzeichnen. */
        reset() {
            lastKey = null;
        }
    };
}
