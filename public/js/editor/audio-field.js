/* audio-field.js: Audio zum Vorlesen, an jeder Aufgabe. Hochladen, Anhören, Ersetzen, Entfernen. */

import { h, setHidden } from '../shared/dom.js';
import { api, errorMessage } from '../shared/api.js';
import { alert } from '../shared/ui.js';
import { HINT_CLASS, LABEL_CLASS } from './fields.js';

const MAX_BYTES = 15 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120000;
// Browser melden für M4A je nach System verschiedene oder gar keine MIME-Typen; die Bytes prüft der Server.
const ALLOWED_NAME = /\.(?:mp3|m4a|ogg|wav)$/i;
const ACCEPT = '.mp3,.m4a,.ogg,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,audio/x-wav';
const BUTTON_CLASS = 'bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-bold text-blue-300 min-h-[2.75rem]';

// Wie beim Bild: Der Upload gehört zur Aufgabe, die Karte kann währenddessen neu gebaut werden.
const runningUploads = new WeakMap();

let playing = null;

/** Ein neu gezeichnetes Formular hängt seinen Player aus; ausgehängt spielte er unsichtbar weiter. */
export function stopAudioPlayback() {
    if (playing) playing.pause();
    playing = null;
}

function uploadAudio(file) {
    const formData = new FormData();
    formData.append('audio', file, file.name);
    return api.post('/api/upload/audio', undefined, { formData, timeout: UPLOAD_TIMEOUT_MS });
}

async function runUpload(form, file, view) {
    const { task } = form;
    const upload = { view };
    runningUploads.set(task, upload);
    view.showBusy(true);
    let failure = null;
    try {
        const { url } = await uploadAudio(file);
        // Während des Uploads kann die Aufgabe entfernt worden sein.
        if (form.isCurrent()) {
            task.audio = url;
            upload.view.showAudio();
            form.changed();
        }
    } catch (err) {
        failure = err;
    }
    runningUploads.delete(task);
    upload.view.showBusy(false);
    if (failure) await alert(errorMessage(failure, 'Die Audio-Datei konnte nicht hochgeladen werden.'), { title: 'Upload fehlgeschlagen', icon: '❌' });
}

export function audioField(form) {
    const { task } = form;
    const status = h('span', { class: HINT_CLASS, 'aria-live': 'polite' });

    const player = h('audio', {
        controls: true,
        preload: 'none',
        class: 'w-full',
        'aria-label': 'Audio anhören',
        onPlay: () => {
            if (playing && playing !== player) playing.pause();
            playing = player;
        }
    });

    const input = h('input', {
        type: 'file',
        accept: ACCEPT,
        class: 'hidden',
        'aria-label': 'Audio-Datei wählen',
        onChange: () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (file) pick(file);
        }
    });

    const chooseButton = h('button', { type: 'button', class: BUTTON_CLASS, onClick: () => input.click() });

    const removeButton = h('button', {
        type: 'button',
        class: 'text-sm text-red-400 font-bold min-h-[2.75rem] px-2 disabled:opacity-40',
        onClick: () => {
            delete task.audio;
            view.showAudio();
            form.changed();
        }
    }, 'Entfernen');

    const view = {
        showBusy(busy) {
            chooseButton.disabled = busy;
            removeButton.disabled = busy;
            status.textContent = busy ? 'Wird hochgeladen …' : '';
        },
        showAudio() {
            player.pause();
            if (task.audio) player.src = task.audio;
            else player.removeAttribute('src');
            setHidden(player, !task.audio);
            setHidden(removeButton, !task.audio);
            chooseButton.textContent = task.audio ? 'Audio ersetzen' : 'Audio hochladen';
        }
    };

    async function pick(file) {
        if (!ALLOWED_NAME.test(file.name)) {
            await alert('Bitte wähle eine Audio-Datei im Format MP3, M4A, OGG oder WAV.', { title: 'Falsches Format', icon: '⚠️' });
            return;
        }
        if (file.size > MAX_BYTES) {
            await alert('Die Audio-Datei ist zu groß (höchstens 15 MB).', { title: 'Zu groß', icon: '⚠️' });
            return;
        }
        await runUpload(form, file, view);
    }

    view.showAudio();
    view.showBusy(false);
    const running = runningUploads.get(task);
    if (running) {
        running.view = view;
        view.showBusy(true);
    }

    return h('div', { dataset: { field: 'audio' } },
        h('span', { class: LABEL_CLASS }, 'Audio zum Vorlesen (optional)'),
        h('div', { class: 'space-y-3 bg-slate-900 p-4 rounded-xl border border-slate-700' },
            player,
            h('div', { class: 'flex flex-wrap items-center gap-3' }, chooseButton, input, removeButton, status)),
        h('span', { class: `block ${HINT_CLASS}` }, 'MP3, M4A, OGG oder WAV, höchstens 15 MB. Ohne Audio erscheint kein Knopf „Vorlesen“.'));
}
