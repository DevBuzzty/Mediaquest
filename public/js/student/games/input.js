/* input.js: password, photo, statement, profile. */

import { h, setHidden } from '../../shared/dom.js';
import { errorMessage } from '../../shared/api.js';
import { compressPhoto, PhotoError } from '../photo.js';
import { BUTTON_BASE, errorLine, heading, questionLine, skipOffer } from './common.js';

const MAX_STATEMENT = 2000;
const MAX_PROFILE_VALUE = 100;

export const PHOTO_NOTICE = 'Fotos sehen nur eure Lehrkraft und die Teams dieser Session. Eure Lehrkraft kann sie jederzeit löschen. '
    + 'Ort und Kameradaten werden vor dem Hochladen entfernt. Fotografiert niemanden, der das nicht möchte.';

export function renderPassword(container, task, ctx) {
    const evaluate = (value) => window.TaskTypes.evaluatePasswordRules(task.rules, value);
    let accepted = false;
    let summary = evaluate('');

    const marks = summary.rules.map(() => h('span', { class: 'shrink-0' }, '🔒'));
    const lock = h('div', { class: 'text-6xl py-4 transition-all duration-500' }, '🔒');
    const feedback = h('p', { class: 'text-[10px] uppercase font-black text-slate-500 tracking-widest' }, 'Status: Gesperrt');
    const submit = h('button', {
        type: 'button',
        disabled: true,
        class: `${BUTTON_BASE} bg-green-600 hover:bg-green-500 text-white`,
        onClick: () => {
            if (!accepted) return;
            // Das Passwort selbst verlässt das Gerät nie.
            ctx.complete({ length: input.value.length, rulesMet: summary.rules.map((rule) => rule.ok) });
        }
    }, 'Tresor öffnen');
    const input = h('input', {
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        maxlength: '128',
        placeholder: 'Passwort...',
        class: 'w-full bg-slate-900 border-2 border-slate-700 p-5 rounded-2xl text-center font-mono text-2xl text-white outline-none focus:border-green-500 transition-all',
        onInput: () => {
            summary = evaluate(input.value);
            accepted = summary.accepted;
            summary.rules.forEach((rule, index) => {
                const ok = input.value.length > 0 && rule.ok;
                marks[index].textContent = ok ? '✅' : '🔒';
            });
            lock.textContent = accepted ? '🔓' : '🔒';
            feedback.textContent = accepted ? 'Status: Entriegelt' : 'Status: Gesperrt';
            feedback.classList.toggle('text-green-500', accepted);
            feedback.classList.toggle('text-slate-500', !accepted);
            submit.disabled = !accepted;
        }
    });

    container.append(h('div', { class: 'space-y-6' },
        heading('Sicherheit', 'text-green-500'),
        task.question ? questionLine(task, '') : null,
        h('div', { class: 'bg-slate-800 p-6 rounded-[2rem] border-2 border-slate-700 space-y-4' },
            h('ul', { class: 'text-left text-xs space-y-2 font-bold text-slate-400' },
                summary.rules.map((entry, index) => h('li', { class: 'flex items-center gap-2' }, marks[index], h('span', { class: 'break-words min-w-0' }, entry.rule)))),
            input,
            lock,
            feedback),
        submit));
}

export function renderPhoto(container, task, ctx) {
    let photo = null;
    let uploadedUrl = null;
    let previewUrl = null;
    let busy = false;

    const error = errorLine();
    const skip = skipOffer(ctx);
    const preview = h('img', { alt: 'Vorschau deines Fotos', class: 'absolute inset-0 w-full h-full object-cover hidden' });
    const icon = h('div', { class: 'text-7xl mb-6 opacity-30' }, '📸');
    const pickLabel = h('span', null, 'Kamera / Galerie');

    function revokePreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    ctx.onCleanup(revokePreview);

    function setBusy(next, text) {
        busy = next;
        submit.disabled = next;
        submit.textContent = text;
        // Während einer Übertragung würde Überspringen die laufende Einsendung überholen.
        if (next) skip.show(false);
    }

    const input = h('input', {
        type: 'file',
        accept: 'image/*',
        class: 'sr-only',
        onCancel: () => skip.show(!photo),
        onChange: async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file || busy) return;
            error.show('');
            setBusy(true, 'Bereite Foto vor...');
            try {
                const compressed = await compressPhoto(file);
                if (ctx.disposed) return;
                photo = compressed;
                uploadedUrl = null;
                revokePreview();
                previewUrl = URL.createObjectURL(compressed);
                preview.src = previewUrl;
                setHidden(preview, false);
                setHidden(icon, true);
                pickLabel.textContent = 'Anderes Foto';
            } catch (err) {
                if (ctx.disposed) return;
                error.show(err instanceof PhotoError ? err.message : errorMessage(err));
                setBusy(false, 'Absenden');
                skip.show(true);
                return;
            }
            setBusy(false, 'Absenden');
        }
    });

    const submit = h('button', {
        type: 'button',
        class: `${BUTTON_BASE} bg-blue-600 hover:bg-blue-500 text-white`,
        onClick: async () => {
            if (busy) return;
            if (!photo) {
                error.show('Bitte mache zuerst ein Foto.');
                skip.show(true);
                return;
            }
            error.show('');
            setBusy(true, 'Übermittle...');
            try {
                // Nach einem Fehler beim Einsenden wird das Foto nicht erneut hochgeladen.
                if (!uploadedUrl) uploadedUrl = (await ctx.uploadPhoto(photo)).url;
                await ctx.submit('photo', uploadedUrl);
                if (ctx.disposed) return;
                ctx.complete({ url: uploadedUrl });
            } catch (err) {
                if (ctx.disposed) return;
                if (err && err.code === 'INVALID_PHOTO') uploadedUrl = null;
                error.show(errorMessage(err, 'Das Foto konnte nicht gesendet werden. Bitte versuche es erneut.'));
                setBusy(false, 'Absenden');
                skip.show(true);
            }
        }
    }, 'Absenden');

    container.append(h('div', { class: 'space-y-6' },
        heading('Foto-Mission', 'text-blue-500'),
        questionLine(task, 'Mache ein Foto'),
        h('div', { class: 'relative w-full aspect-square bg-slate-800 rounded-[3rem] border-4 border-dashed border-slate-700 flex flex-col items-center justify-center overflow-hidden shadow-inner' },
            preview,
            icon,
            h('label', { class: 'bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest cursor-pointer transition-all shadow-xl relative z-10' }, pickLabel, input)),
        h('p', { class: 'text-xs text-slate-400 leading-relaxed' }, PHOTO_NOTICE),
        error,
        submit,
        skip));
}

export function renderStatement(container, task, ctx) {
    let busy = false;
    const error = errorLine();
    const skip = skipOffer(ctx);
    const textarea = h('textarea', {
        maxlength: String(MAX_STATEMENT),
        placeholder: 'Deine Nachricht...',
        class: 'w-full h-56 bg-slate-800 p-6 rounded-[2rem] border-2 border-slate-700 text-white outline-none focus:border-purple-500 transition-all font-bold text-lg shadow-inner'
    });
    const submit = h('button', {
        type: 'button',
        class: `${BUTTON_BASE} bg-purple-600 hover:bg-purple-500 text-white`,
        onClick: async () => {
            if (busy) return;
            const text = textarea.value.trim();
            if (!text) {
                error.show('Bitte schreibe erst etwas.');
                return;
            }
            error.show('');
            busy = true;
            submit.disabled = true;
            submit.textContent = 'Übermittle...';
            skip.show(false);
            try {
                await ctx.submit('statement', text);
                if (ctx.disposed) return;
                ctx.complete({ text });
            } catch (err) {
                if (ctx.disposed) return;
                error.show(errorMessage(err, 'Dein Text konnte nicht gesendet werden. Bitte versuche es erneut.'));
                busy = false;
                submit.disabled = false;
                submit.textContent = 'Absenden';
                skip.show(true);
            }
        }
    }, 'Absenden');

    container.append(h('div', { class: 'space-y-6' },
        heading('Freitext', 'text-purple-500'),
        questionLine(task, 'Schreibe etwas'),
        textarea,
        error,
        submit,
        skip));
}

export function renderProfile(container, task, ctx) {
    const known = window.TaskTypes.PROFILE_FIELDS;
    const labelFor = (field) => {
        const entry = known.find((candidate) => candidate.value === field);
        return entry ? entry.label : field;
    };
    const fields = [...(Array.isArray(task.fields) ? task.fields : []), ...(Array.isArray(task.customFields) ? task.customFields : [])];
    const rows = fields.map((field) => ({
        label: labelFor(field),
        input: h('input', {
            type: 'text',
            maxlength: String(MAX_PROFILE_VALUE),
            autocomplete: 'off',
            placeholder: 'Eingabe...',
            class: 'w-full bg-slate-900 border border-slate-700 p-3 rounded-xl text-sm font-bold text-slate-200 outline-none focus:border-blue-500 transition-all'
        })
    }));

    container.append(h('div', { class: 'space-y-6' },
        heading('Profil-Check', 'text-blue-500'),
        task.question ? questionLine(task, '') : null,
        h('div', { class: 'bg-slate-800 p-8 rounded-[2.5rem] border border-slate-700 space-y-5 text-left shadow-2xl relative overflow-hidden' },
            h('div', { class: 'absolute top-0 left-0 w-full h-2 bg-blue-600' }),
            h('div', { class: 'w-24 h-24 bg-slate-700 rounded-full mx-auto mb-6 border-4 border-blue-600 flex items-center justify-center text-5xl shadow-xl' }, '👤'),
            rows.map((row) => h('label', { class: 'block space-y-1' },
                h('span', { class: 'block text-[10px] uppercase font-black text-slate-400 ml-1 tracking-widest break-words' }, row.label),
                row.input))),
        h('button', {
            type: 'button',
            class: `${BUTTON_BASE} bg-blue-600 hover:bg-blue-500 text-white`,
            onClick: () => ctx.complete({ fields: Object.fromEntries(rows.map((row) => [row.label, row.input.value.trim()])) })
        }, 'Profil speichern')));
}
