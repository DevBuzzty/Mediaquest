/* Anmeldung der Lehrkräfte. */
import { api, errorMessage } from '../shared/api.js';
import { byId, setHidden } from '../shared/dom.js';

const form = byId('loginForm');
const errorBox = byId('errorMessage');
const submitBtn = byId('submitBtn');

// Ohne Antwort bleibt der Link versteckt: lieber kein Link als einer ins Leere.
api.get('/api/config')
    .then(({ allowRegistration }) => setHidden(byId('registerLink'), !allowRegistration))
    .catch((err) => console.warn(err));

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    setHidden(errorBox, true);
    try {
        await api.post('/api/login', {
            username: byId('username').value.trim(),
            password: byId('password').value
        });
        window.location.href = '/teacher.html';
    } catch (err) {
        errorBox.textContent = errorMessage(err);
        setHidden(errorBox, false);
        submitBtn.disabled = false;
    }
});
