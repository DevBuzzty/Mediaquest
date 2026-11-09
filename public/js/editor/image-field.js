/* image-field.js: Bild-Upload für Detektor, Hotspot und Monster-Aufgaben. */

import { h, setHidden } from '../shared/dom.js';
import { api, errorMessage } from '../shared/api.js';
import { alert } from '../shared/ui.js';
import { HINT_CLASS, LABEL_CLASS } from './fields.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

// Ein Upload gehört zur Aufgabe, nicht zur Karte: Karten werden neu gebaut, während er läuft.
// Aufgabe -> { view }, view ist immer die zuletzt gezeichnete Ansicht des Felds.
const runningUploads = new WeakMap();

function showBusy(view, busy) {
    view.input.disabled = busy;
    view.status.textContent = busy ? 'Wird hochgeladen …' : '';
}

async function runUpload(form, file, view) {
    const { task } = form;
    const upload = { view };
    runningUploads.set(task, upload);
    showBusy(view, true);
    let failure = null;
    try {
        const { url } = await api.uploadImage(file, { purpose: 'blueprint', filename: file.name });
        // Während des Uploads kann die Aufgabe entfernt oder ihr Typ geändert worden sein.
        if (form.isCurrent() && globalThis.TaskTypes.get(task.type).fields.includes('image')) {
            task.image = url;
            upload.view.showImage();
            form.changed();
        }
    } catch (err) {
        failure = err;
    }
    runningUploads.delete(task);
    showBusy(upload.view, false);
    upload.view.input.value = '';
    if (failure) await alert(errorMessage(failure, 'Das Bild konnte nicht hochgeladen werden.'), { title: 'Upload fehlgeschlagen', icon: '❌' });
}

export function imageField(form, label, onUploaded, { removable = false } = {}) {
    const { task } = form;
    const thumbnail = h('img', {
        alt: 'Vorschau des hochgeladenen Bildes',
        class: 'h-16 w-16 object-cover rounded-xl border border-slate-700'
    });
    const status = h('span', { class: HINT_CLASS, 'aria-live': 'polite' });

    const input = h('input', {
        type: 'file',
        accept: ACCEPTED.join(','),
        class: 'text-sm text-slate-400 min-w-0',
        'aria-label': label,
        onChange: () => {
            if (input.files && input.files[0]) pick(input.files[0]);
        }
    });

    const removeButton = removable ? h('button', {
        type: 'button',
        class: 'text-sm text-red-400 font-bold min-h-[2.75rem] px-2',
        onClick: () => {
            task.image = '';
            showThumbnail();
            form.changed();
        }
    }, 'Bild entfernen') : null;

    function showThumbnail() {
        if (task.image) thumbnail.src = task.image;
        setHidden(thumbnail, !task.image);
        if (removeButton) setHidden(removeButton, !task.image);
    }

    const view = {
        input,
        status,
        showImage() {
            showThumbnail();
            if (onUploaded) onUploaded();
        }
    };

    async function pick(file) {
        if (!ACCEPTED.includes(file.type)) {
            input.value = '';
            await alert('Bitte wähle ein Bild im Format JPEG, PNG oder WebP.', { title: 'Falsches Format', icon: '⚠️' });
            return;
        }
        if (file.size > MAX_BYTES) {
            input.value = '';
            await alert('Das Bild ist zu groß (höchstens 5 MB).', { title: 'Zu groß', icon: '⚠️' });
            return;
        }
        await runUpload(form, file, view);
    }

    showThumbnail();
    const running = runningUploads.get(task);
    if (running) {
        running.view = view;
        showBusy(view, true);
    }

    return h('div', null,
        h('span', { class: LABEL_CLASS }, label),
        h('div', { class: 'flex flex-wrap items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-700' }, input, thumbnail, removeButton, status));
}
