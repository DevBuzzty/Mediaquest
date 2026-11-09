/*
 * scope.js: Aufräum-Bereich einer Aufgabe. Timer, Listener und Objekt-URLs, die hierüber
 * laufen, werden beim Verlassen der Aufgabe zuverlässig beendet.
 */

export function createScope() {
    const cleanups = new Set();
    let disposed = false;

    function track(cleanup) {
        if (disposed) {
            cleanup();
            return () => {};
        }
        cleanups.add(cleanup);
        return () => cleanups.delete(cleanup);
    }

    return {
        get disposed() { return disposed; },
        setTimeout(fn, ms) {
            if (disposed) return null;
            let release = () => {};
            const id = window.setTimeout(() => {
                release();
                if (!disposed) fn();
            }, ms);
            release = track(() => window.clearTimeout(id));
            return id;
        },
        /** Liefert eine Funktion zum vorzeitigen Stoppen. */
        setInterval(fn, ms) {
            if (disposed) return () => {};
            const id = window.setInterval(() => { if (!disposed) fn(); }, ms);
            const release = track(() => window.clearInterval(id));
            return () => {
                window.clearInterval(id);
                release();
            };
        },
        on(target, type, handler, options) {
            target.addEventListener(type, handler, options);
            track(() => target.removeEventListener(type, handler, options));
        },
        onCleanup(fn) {
            track(fn);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            cleanups.forEach((cleanup) => {
                try {
                    cleanup();
                } catch (err) {
                    console.warn('Aufräumen fehlgeschlagen', err);
                }
            });
            cleanups.clear();
        }
    };
}
