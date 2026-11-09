/*
 * socket.js: Socket.io-Verbindung mit Callback bei JEDEM connect (Re-Join und Resync).
 *
 * Im HTML vor dem Modul laden:  <script src="/socket.io/socket.io.js"></script>
 *
 *   import { connectSocket } from '/js/shared/socket.js';
 *
 *   const conn = connectSocket({
 *       async onConnect({ isReconnect, isStale }) {
 *           const ack = await conn.emit('joinSessionRoom', { sessionId, as: 'team' });
 *           if (isStale()) return;           // inzwischen neue Verbindung, Ergebnis verwerfen
 *           applyState(ack.state);           // Ack entspricht dem Stand nach einem Reload
 *       },
 *       onStatus(status) { banner.show(status !== 'connected'); },
 *       onError(err) { showError(errorMessage(err)); }
 *   });
 *   conn.on('gameStarted', handleGameStarted);   // EINMAL registrieren, nicht in onConnect
 *
 *   try {
 *       const { progress } = await conn.emit('reportTaskResult', { taskKey, status: 'completed', answer });
 *   } catch (err) { ... }
 *
 * connectSocket({ onConnect, onStatus, onError, autoConnect = true, ackTimeout = 10000 })
 *   onConnect({ isReconnect, isStale })  bei jedem connect, darf async sein. Wirft er oder lehnt er ab,
 *                                        wird onError gerufen (bei veralteter Verbindung nichts).
 *   onStatus(status, detail)             'connecting' | 'connected' | 'reconnecting' | 'disconnected'.
 *                                        'disconnected' heißt: kein automatischer neuer Versuch mehr,
 *                                        z. B. nach Abmeldung oder conn.disconnect().
 *   onError(err)                         ohne Angabe: console.error
 *   autoConnect: false                   erst mit conn.connect() verbinden
 *
 * Rückgabe conn:
 *   emit(event, payload, { timeout })  Promise mit dem Ack ({ ok: true, ... }). payload weglassen, wenn
 *       das Ereignis keinen hat. Abgelehnt wird mit ApiError aus api.js: err.message anzeigbar, err.code vom
 *       Server (z. B. 'TEAM_GONE'), lokal 'DISCONNECTED' oder 'TIMEOUT'. Ohne Verbindung wird nichts
 *       gepuffert. Der Aufrufer entscheidet über einen neuen Versuch.
 *   on(event, handler)  gilt über Reconnects hinweg, liefert eine Funktion zum Abmelden
 *   connect(), disconnect(), reconnect()
 *   connected (bool), status (String), socket (rohes Socket.io-Objekt)
 *
 * Wichtig (docs/API.md): Die Identität wird beim Verbindungsaufbau aus dem Cookie gelesen. Nach /api/login
 * und nach dem ersten /api/join oder /api/rejoin conn.reconnect() aufrufen oder erst dann verbinden.
 * Nach POST /api/teams ist das nicht nötig.
 */

import { ApiError } from './api.js';

const DISCONNECTED_MESSAGE = 'Keine Verbindung zum Server. Bitte warte einen Moment und versuche es erneut.';
const TIMEOUT_MESSAGE = 'Der Server antwortet nicht. Bitte versuche es erneut.';
const REJECTED_MESSAGE = 'Das hat nicht geklappt. Bitte versuche es erneut.';

export function connectSocket({ onConnect, onStatus, onError, autoConnect = true, ackTimeout = 10000 } = {}) {
    if (typeof window.io !== 'function') {
        throw new Error('socket.js: /socket.io/socket.io.js muss vor dem Modul geladen werden');
    }

    // forceNew: Ein geteilter Manager behielte den Handshake mit dem alten Cookie.
    const socket = window.io({ autoConnect: false, forceNew: true });
    let status = 'disconnected';
    let connectionId = 0;
    let connectCount = 0;

    function setStatus(next, detail) {
        status = next;
        if (onStatus) onStatus(next, detail);
    }

    function reportError(err) {
        if (onError) onError(err);
        else console.error(err);
    }

    async function runOnConnect(info) {
        try {
            await onConnect(info);
        } catch (err) {
            if (!info.isStale()) reportError(err);
        }
    }

    socket.on('connect', () => {
        connectionId += 1;
        const id = connectionId;
        const isReconnect = connectCount > 0;
        connectCount += 1;
        setStatus('connected');
        if (onConnect) runOnConnect({ isReconnect, isStale: () => id !== connectionId });
    });

    socket.on('disconnect', (reason) => {
        connectionId += 1;
        setStatus(socket.active ? 'reconnecting' : 'disconnected', reason);
    });

    socket.on('connect_error', (err) => {
        setStatus(socket.active ? 'reconnecting' : 'disconnected', err.message);
    });

    function connect() {
        if (socket.connected) return;
        setStatus('connecting');
        socket.connect();
    }

    function disconnect() {
        socket.disconnect();
    }

    function reconnect() {
        socket.disconnect();
        connect();
    }

    function emit(event, payload, { timeout = ackTimeout } = {}) {
        return new Promise((resolve, reject) => {
            if (!socket.connected) {
                reject(new ApiError(DISCONNECTED_MESSAGE, { code: 'DISCONNECTED' }));
                return;
            }
            const args = payload === undefined ? [] : [payload];
            socket.timeout(timeout).emit(event, ...args, (err, ack) => {
                if (err) {
                    reject(new ApiError(TIMEOUT_MESSAGE, { code: 'TIMEOUT' }));
                } else if (ack && ack.ok === true) {
                    resolve(ack);
                } else {
                    reject(new ApiError(ack && typeof ack.error === 'string' ? ack.error : REJECTED_MESSAGE, {
                        code: ack && ack.code ? ack.code : null,
                        data: ack || null
                    }));
                }
            });
        });
    }

    function on(event, handler) {
        socket.on(event, handler);
        return () => socket.off(event, handler);
    }

    if (autoConnect) connect();

    return {
        emit,
        on,
        connect,
        disconnect,
        reconnect,
        socket,
        get connected() { return socket.connected; },
        get status() { return status; }
    };
}
