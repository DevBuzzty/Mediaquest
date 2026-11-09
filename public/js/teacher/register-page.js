/* Registrierung per E-Mail. Die Antwort ist für neue und vorhandene Adressen gleich. */
import { api, errorMessage } from '../shared/api.js';
import { byId, setHidden } from '../shared/dom.js';

const IDLE_LABEL = 'Code anfordern';
const MESSAGE_BASE = 'text-sm p-3 rounded-lg';
const MESSAGE_OK = `${MESSAGE_BASE} bg-green-900/30 text-green-400 border border-green-500`;
const MESSAGE_ERROR = `${MESSAGE_BASE} bg-red-900/30 text-red-400 border border-red-500`;

const form = byId('registerForm');
const messageBox = byId('message');
const submitBtn = byId('submitBtn');

function showMessage(text, className) {
    messageBox.textContent = text;
    messageBox.className = className;
    setHidden(messageBox, false);
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sende...';
    setHidden(messageBox, true);
    try {
        const data = await api.post('/api/register', { email: byId('email').value.trim() });
        showMessage(data.message, MESSAGE_OK);
        submitBtn.textContent = 'Code angefordert';
    } catch (err) {
        showMessage(errorMessage(err), MESSAGE_ERROR);
        submitBtn.disabled = false;
        submitBtn.textContent = IDLE_LABEL;
    }
});
