/*
 * scanner.js: Kamera-Steuerung für die QR-Stationen.
 *
 * Start und Stopp laufen streng nacheinander, html5-qrcode wirft sonst, wenn gestoppt wird,
 * bevor die Kamera läuft. Gleiche Treffer werden entprellt: Die Bibliothek liefert sie bis zu
 * zehnmal pro Sekunde.
 *
 * Gelesen wird das ganze Kamerabild. Einen Suchrahmen gibt es bewusst nicht: Die Bibliothek
 * zeichnet ihn am Kasten aus, liest aber mittig im Video, und beides stimmt selten überein.
 */

const REPEAT_BLOCK_MS = 2500;
const RELEASE_AFTER_MS = 2000;
// Nach einem Kamerastart ist das Bild oft noch unscharf: Ohne einen ersten Treffer länger warten.
const RELEASE_UNSEEN_MS = 4000;
const UI_WAIT_MS = 4000;
const UI_POLL_MS = 30;

export function cameraErrorMessage(err) {
    const text = String(err && err.message ? err.message : err);
    if (/NotAllowed|Permission/i.test(text)) return 'Die Kamera ist nicht freigegeben. Erlaube den Zugriff oder gib den Code unten ein.';
    if (/NotFound|Requested device not found/i.test(text)) return 'Es wurde keine Kamera gefunden. Gib den Code unten ein.';
    if (/NotReadable|in use/i.test(text)) return 'Die Kamera wird gerade von einer anderen App benutzt. Gib den Code unten ein.';
    return 'Die Kamera konnte nicht gestartet werden. Gib den Code unten ein.';
}

/** Entprellt Treffer: gleicher Text erst wieder nach blockMs. */
export function createDebounce(blockMs = REPEAT_BLOCK_MS, now = () => Date.now()) {
    let lastText = null;
    let lastAt = 0;
    return (text) => {
        const at = now();
        if (text === lastText && at - lastAt < blockMs) return false;
        lastText = text;
        lastAt = at;
        return true;
    };
}

/**
 * Sperrt Codes für die Kamera, bis sie eine Weile nicht mehr im Bild waren: gerade verlassene
 * Stationen und abgelehnte Codes. Jeder Code hat seine eigene Sperre, ein anderer Code geht
 * sofort durch. Die Uhr läuft nur über ausgewertete Kamerabilder, eine ausgeschaltete Kamera
 * zählt also nicht als „nicht im Bild“.
 */
export function createCodeHold({ releaseMs = RELEASE_AFTER_MS, unseenMs = RELEASE_UNSEEN_MS, now = () => Date.now() } = {}) {
    const held = new Map();
    const keyOf = (text) => String(text).trim().toLowerCase();

    function age(exceptKey) {
        const at = now();
        held.forEach((entry, key) => {
            if (key === exceptKey) return;
            if (entry.missingSince === null) entry.missingSince = at;
            else if (at - entry.missingSince >= (entry.seen ? releaseMs : unseenMs)) held.delete(key);
        });
    }

    return {
        hold(text) {
            held.set(keyOf(text), { seen: false, missingSince: null });
        },
        clear() {
            held.clear();
        },
        /** Ein Kamerabild mit diesem Code: true, solange er gesperrt ist. */
        blocks(text) {
            const key = keyOf(text);
            age(key);
            const entry = held.get(key);
            if (!entry) return false;
            entry.seen = true;
            entry.missingSince = null;
            return true;
        },
        /** Ein Kamerabild ohne lesbaren Code. */
        miss() {
            age(null);
        }
    };
}

export function createScanner({ elementId, onCode, onStatus }) {
    let instance = null;
    let running = false;
    let wanted = false;
    let queue = Promise.resolve();
    const accept = createDebounce();
    const holds = createCodeHold();

    function enqueue(job) {
        queue = queue.then(job).catch((err) => console.warn('Scanner:', err));
        return queue;
    }

    function unavailableReason() {
        if (typeof window.Html5Qrcode !== 'function') return 'Der QR-Scanner konnte nicht geladen werden. Gib den Code unten ein.';
        if (!window.isSecureContext || !navigator.mediaDevices) return 'Die Kamera funktioniert nur über eine sichere Verbindung (HTTPS). Gib den Code unten ein.';
        return null;
    }

    /** start() ist fertig, bevor das Video spielt; das Canvas entsteht erst danach, und stop() braucht es. */
    async function waitForLibraryUi() {
        const root = document.getElementById(elementId);
        const deadline = Date.now() + UI_WAIT_MS;
        while (root && !root.querySelector('canvas') && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, UI_POLL_MS));
        }
        return Boolean(root && root.querySelector('canvas'));
    }

    async function doStop() {
        if (!running) return;
        const scanner = instance;
        running = false;
        instance = null;
        const uiReady = await waitForLibraryUi();
        try {
            await scanner.stop();
            scanner.clear();
        } catch (err) {
            // Ohne Canvas wirft stop() erst nach dem Freigeben der Kamera: Es bleibt nur das Aufräumen.
            if (uiReady) console.warn('Kamera-Stopp fehlgeschlagen', err);
            else document.getElementById(elementId)?.replaceChildren();
        }
    }

    function onDecoded(text) {
        if (!wanted || holds.blocks(text)) return;
        if (accept(text)) onCode(text);
    }

    async function doStart() {
        if (!wanted || running) return;
        const reason = unavailableReason();
        if (reason) {
            onStatus('failed', reason);
            return;
        }
        onStatus('starting');
        const scanner = new window.Html5Qrcode(elementId, false);
        try {
            await scanner.start({ facingMode: 'environment' }, { fps: 10 }, onDecoded, () => holds.miss());
        } catch (err) {
            console.warn('Kamera-Start fehlgeschlagen', err);
            onStatus('failed', cameraErrorMessage(err));
            return;
        }
        instance = scanner;
        running = true;
        onStatus('running');
        // Schon wieder abgewählt, während die Kamera startete.
        if (!wanted) await doStop();
    }

    return {
        start() {
            wanted = true;
            return enqueue(doStart);
        },
        stop() {
            wanted = false;
            // Wer den Scan-Bildschirm verlässt, wird beim nächsten Mal nicht mehr ausgebremst.
            holds.clear();
            return enqueue(doStop);
        },
        /** Die Kamera ignoriert diesen Code, bis er eine Weile nicht mehr im Bild war. Handeingabe bleibt frei. */
        hold(code) {
            holds.hold(code);
        }
    };
}
