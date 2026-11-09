/*
 * audio.js: "Vorlesen"-Knöpfe des Dashboards. Es spielt immer höchstens eine Datei.
 * Knöpfe dürfen beim Neuzeichnen neu entstehen; der Stand steckt im Player, nicht im Knopf.
 * keepOnly() stoppt die Wiedergabe, sobald die zugehörige Aufgabe nicht mehr angezeigt wird.
 */
import { h } from '../shared/dom.js';

const LABEL_PLAY = '🔊 Vorlesen';
const LABEL_STOP = '⏹ Vorlesen stoppen';

export function createReadAloud({ onError = () => {} } = {}) {
    let audio = null;
    let currentKey = null;
    const buttons = new Set();

    function refresh() {
        buttons.forEach((button) => {
            if (button.isConnected) button.dataset.mounted = '1';
            else if (button.dataset.mounted === '1') buttons.delete(button);
            const playing = button.dataset.audioKey === currentKey;
            button.textContent = playing ? LABEL_STOP : LABEL_PLAY;
            button.setAttribute('aria-pressed', String(playing));
        });
    }

    function stop() {
        if (audio) audio.pause();
        audio = null;
        currentKey = null;
        refresh();
    }

    function fail(el) {
        if (audio !== el) return;
        stop();
        onError('Die Audio-Datei konnte nicht abgespielt werden.');
    }

    function play(key, url) {
        stop();
        const el = new Audio(url);
        audio = el;
        currentKey = key;
        el.addEventListener('ended', () => { if (audio === el) stop(); });
        el.addEventListener('error', () => fail(el));
        el.play().catch(() => fail(el));
        refresh();
    }

    /** Ein Knopf für die Datei url. key benennt die angezeigte Aufgabe. */
    function button(key, url, className) {
        const el = h('button', {
            type: 'button',
            class: className,
            dataset: { audioKey: key, readAloud: '1' },
            onClick: () => (currentKey === key ? stop() : play(key, url))
        }, LABEL_PLAY);
        buttons.add(el);
        refresh();
        return el;
    }

    /** Stoppt die Wiedergabe, wenn ihre Aufgabe nicht mehr unter keys ist. */
    function keepOnly(keys) {
        if (currentKey !== null && !keys.has(currentKey)) stop();
        refresh();
    }

    return { button, stop, keepOnly };
}
