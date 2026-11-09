/* audio.js: Knopf „Vorlesen“ einer Aufgabe. Ohne task.audio gibt es ihn nicht; die Wiedergabe endet mit dem Scope der Aufgabe. */

import { h, setHidden } from '../../shared/dom.js';

const LABEL_IDLE = '🔊 Vorlesen';
const LABEL_PLAYING = '⏹ Vorlesen stoppen';
const LOAD_FAILED = 'Der Text kann gerade nicht vorgelesen werden.';

export function readAloudPanel(task, scope) {
    if (typeof task.audio !== 'string' || !task.audio) return null;
    let audio = null;

    const failure = h('p', { class: 'text-sm font-bold text-amber-400 hidden mt-2', role: 'alert' }, LOAD_FAILED);
    const button = h('button', {
        type: 'button',
        class: 'w-full min-h-[3rem] px-4 py-3 rounded-2xl font-black bg-slate-700 hover:bg-slate-600 text-white transition-all active:scale-95',
        dataset: { role: 'read-aloud' },
        onClick: toggle
    }, LABEL_IDLE);

    function showIdle() {
        button.textContent = LABEL_IDLE;
    }

    function fail() {
        showIdle();
        setHidden(failure, false);
    }

    function stop() {
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        showIdle();
    }

    function create() {
        const player = new Audio(task.audio);
        scope.on(player, 'ended', showIdle);
        scope.on(player, 'error', fail);
        return player;
    }

    function play() {
        if (!audio) audio = create();
        setHidden(failure, true);
        button.textContent = LABEL_PLAYING;
        const started = audio.play();
        if (started && typeof started.catch === 'function') {
            started.catch((err) => {
                // Ein Stopp während des Ladens ist kein Fehler.
                if (err && err.name !== 'AbortError') fail();
            });
        }
    }

    function toggle() {
        if (audio && !audio.paused) stop();
        else play();
    }

    scope.onCleanup(() => {
        if (!audio) return;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    });

    const panel = h('div', { class: 'mb-4' }, button, failure);
    panel.stop = stop;
    return panel;
}
