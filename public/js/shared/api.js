/*
 * api.js: fetch-Wrapper für die HTTP-Routen aus docs/API.md. Immer JSON, einheitliche Fehler.
 *
 *   import { api, ApiError, errorMessage } from '/js/shared/api.js';
 *
 *   try {
 *       const { blueprints } = await api.get('/api/blueprints');
 *       await api.post('/api/sessions', { blueprintId: 1, maxTeams: 5 });
 *       await api.patch('/api/sessions/active/limit', { maxTeams: 8 });
 *       await api.delete(`/api/teams/${id}`);
 *       const { url } = await api.uploadImage(blob, { purpose: 'submission', filename: 'foto.jpg' });
 *   } catch (err) {
 *       if (err instanceof ApiError && err.status === 401) location.href = '/login.html';
 *       else await alert(errorMessage(err), { title: 'Fehler' });
 *   }
 *
 * Erfolg: die Promise liefert das JSON der Antwort (null bei leerem Body).
 * Fehler: die Promise wird immer mit ApiError abgelehnt.
 *   err.message  deutscher Text, darf angezeigt werden
 *   err.status   HTTP-Status, 0 wenn keine Antwort kam
 *   err.code     Code des Servers (z. B. 'TEAM_LIMIT', 'COLOR_TAKEN'), lokal: 'NETWORK', 'TIMEOUT',
 *                'ABORTED' (eigenes signal), 'BAD_RESPONSE' (Antwort ist kein JSON), sonst null
 *   err.details  z. B. [{ taskIndex, message }] bei INVALID_BLUEPRINT, sonst null
 *   err.data     gesamter JSON-Body der Fehlerantwort oder null
 *
 * Optionen (letztes Argument jeder Methode): { signal, timeout } mit timeout in ms.
 * Standard 15 s, bei uploadImage 60 s.
 *
 * uploadImage(blob, { purpose, filename, signal, timeout }) sendet das Feld "image" an /api/upload.
 * Die Schüler-Seite übergibt immer purpose: 'submission'. Das Verkleinern erledigt der Aufrufer.
 *
 * errorMessage(err, fallback) liefert für jeden gefangenen Wert einen anzeigbaren Text.
 * Unerwartete Fehler (Programmierfehler) landen in der Konsole und zeigen nur den fallback.
 * socket.js lehnt fehlgeschlagene Acks ebenfalls mit ApiError ab.
 */

const DEFAULT_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 60000;

const STATUS_MESSAGES = {
    400: 'Die Eingabe ist ungültig.',
    401: 'Bitte melde dich an.',
    403: 'Das ist nicht erlaubt.',
    404: 'Nicht gefunden.',
    409: 'Das geht gerade nicht.',
    413: 'Die Datei ist zu groß.',
    429: 'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.'
};
const SERVER_ERROR_MESSAGE = 'Der Server hat ein Problem. Bitte versuche es gleich noch einmal.';
const NETWORK_MESSAGE = 'Keine Verbindung zum Server. Bitte prüfe das Netz und versuche es erneut.';
const TIMEOUT_MESSAGE = 'Der Server antwortet nicht. Bitte versuche es erneut.';
const ABORTED_MESSAGE = 'Die Anfrage wurde abgebrochen.';
const BAD_RESPONSE_MESSAGE = 'Der Server hat unerwartet geantwortet. Bitte versuche es erneut.';
const FALLBACK_MESSAGE = 'Etwas ist schiefgelaufen. Bitte versuche es erneut.';

export class ApiError extends Error {
    constructor(message, { status = 0, code = null, details = null, data = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
        this.data = data;
    }
}

export function errorMessage(err, fallback = FALLBACK_MESSAGE) {
    if (err instanceof ApiError) return err.message;
    console.error(err);
    return fallback;
}

function parseJson(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false, value: null };
    }
}

function statusMessage(status) {
    return STATUS_MESSAGES[status] || (status >= 500 ? SERVER_ERROR_MESSAGE : FALLBACK_MESSAGE);
}

async function request(method, path, { body, formData, signal, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    const forwardAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', forwardAbort, { once: true });
    }

    const headers = { Accept: 'application/json' };
    const init = { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal };
    if (formData) {
        init.body = formData;
    } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(path, init);
        const text = await response.text();
        const parsed = text ? parseJson(text) : { ok: true, value: null };

        if (!response.ok) {
            const data = parsed.value && typeof parsed.value === 'object' ? parsed.value : null;
            throw new ApiError(data && typeof data.error === 'string' ? data.error : statusMessage(response.status), {
                status: response.status,
                code: data && data.code ? data.code : null,
                details: data && data.details ? data.details : null,
                data
            });
        }
        if (!parsed.ok) throw new ApiError(BAD_RESPONSE_MESSAGE, { status: response.status, code: 'BAD_RESPONSE' });
        return parsed.value;
    } catch (err) {
        if (err instanceof ApiError) throw err;
        if (timedOut) throw new ApiError(TIMEOUT_MESSAGE, { code: 'TIMEOUT' });
        if (controller.signal.aborted) throw new ApiError(ABORTED_MESSAGE, { code: 'ABORTED' });
        throw new ApiError(NETWORK_MESSAGE, { code: 'NETWORK' });
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', forwardAbort);
    }
}

export const api = {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),

    uploadImage(blob, { purpose, filename = 'bild.jpg', ...options } = {}) {
        const formData = new FormData();
        formData.append('image', blob, filename);
        const query = purpose ? `?purpose=${encodeURIComponent(purpose)}` : '';
        return request('POST', `/api/upload${query}`, { timeout: UPLOAD_TIMEOUT_MS, ...options, formData });
    }
};
