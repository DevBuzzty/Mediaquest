/*
 * qr-sheet.js: Bogen mit den QR-Codes aller Stationen oder Karten. Vor dem Spielstart nutzbar.
 * Der Druck läuft über print.css und zeigt nur diesen Bogen.
 *
 * Inhalt ist ein "Bogen": { title, sections: [{ id, title, noun, tasks }] }. Eine Spielrunde ergibt
 * einen Abschnitt ohne eigene Überschrift, ein Brettspiel einen Abschnitt je Kartenset.
 */
import { h, mount, setHidden } from '../shared/dom.js';

const QR_OPTIONS = { width: 320, margin: 2, errorCorrectionLevel: 'M' };
const OPEN_CLASS = 'qr-sheet-open';

const TaskTypes = globalThis.TaskTypes;

/** Bogen einer QR-Spielrunde; null, wenn sie keine Stationen hat. */
export function blueprintSheet(blueprint) {
    if (!blueprint || blueprint.templateType !== 'qr') return null;
    return {
        title: `QR-Codes: ${blueprint.title}`,
        sections: [{ id: 'stations', title: null, noun: 'Station', tasks: blueprint.tasks }]
    };
}

async function qrImage(code) {
    const url = await window.QRCode.toDataURL(code, QR_OPTIONS);
    return h('img', {
        src: url,
        alt: `QR-Code für ${code}`,
        width: QR_OPTIONS.width,
        height: QR_OPTIONS.width,
        class: 'bg-white p-2 rounded-lg w-40 h-40'
    });
}

function stationCard(task, index, slot, noun) {
    const definition = TaskTypes.get(task.type);
    return h('div', { class: 'qr-card bg-slate-800 p-4 rounded-2xl flex flex-col items-center gap-3 border border-slate-700 text-center' },
        h('span', { class: 'text-sm font-black text-slate-400 uppercase' }, `${noun} ${index + 1}`),
        slot,
        h('span', { class: 'text-xl font-black text-blue-400 tracking-widest' }, task.code || '---'),
        h('span', { class: 'text-sm font-bold text-slate-200 break-words max-w-full' }, TaskTypes.taskTitle(task)),
        definition ? h('span', { class: 'text-xs text-slate-400' }, definition.label) : null);
}

function sheetKey(sheet) {
    return JSON.stringify([sheet.title, sheet.sections.map((section) => [section.id, section.tasks.map((task) => [task.code, task.key])])]);
}

function allTasks(sheet) {
    return sheet.sections.flatMap((section) => section.tasks);
}

/**
 * @param {{ sheet, title, grid, printBtn, closeBtn }} elements
 */
export function createQrSheet({ sheet, title, grid, printBtn, closeBtn }) {
    let renderToken = 0;
    let isOpen = false;
    let shownKey = null;
    let focusBefore = null;

    function onKeyDown(event) {
        if (event.key === 'Escape') close();
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        shownKey = null;
        renderToken += 1;
        setHidden(sheet, true);
        document.body.classList.remove(OPEN_CLASS);
        document.removeEventListener('keydown', onKeyDown);
        if (focusBefore && focusBefore.isConnected) focusBefore.focus();
    }

    async function render(content) {
        renderToken += 1;
        const token = renderToken;
        printBtn.disabled = true;
        title.textContent = content.title;
        const tasks = allTasks(content);
        const slots = new Map(tasks.map((task) => [task, h('div', { class: 'w-40 h-40 flex items-center justify-center text-xs text-slate-400' }, 'Wird erzeugt...')]));
        mount(grid, content.sections.map((section) => h('section', { class: 'qr-section space-y-4' },
            section.title ? h('h3', { class: 'qr-section-title text-xl font-bold break-words' }, section.title) : null,
            h('div', { class: 'qr-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6' },
                section.tasks.map((task, index) => stationCard(task, index, slots.get(task), section.noun))))));
        await Promise.all(tasks.map(async (task) => {
            let image;
            try {
                if (!task.code) throw new Error('Kein Code');
                image = await qrImage(task.code);
            } catch (err) {
                console.error(err);
                image = 'QR-Code konnte nicht erzeugt werden. Bitte nutze den Code darunter.';
            }
            if (token === renderToken) mount(slots.get(task), image);
        }));
        if (token === renderToken) printBtn.disabled = false;
    }

    function open(content) {
        if (!isOpen) {
            focusBefore = document.activeElement;
            document.addEventListener('keydown', onKeyDown);
        }
        isOpen = true;
        shownKey = sheetKey(content);
        setHidden(sheet, false);
        document.body.classList.add(OPEN_CLASS);
        closeBtn.focus();
        return render(content);
    }

    /** Hält einen offenen Bogen beim Live-Wechsel aktuell; ohne Inhalt schließt er. */
    function sync(content) {
        if (!isOpen) return;
        if (!content) {
            close();
        } else if (sheetKey(content) !== shownKey) {
            shownKey = sheetKey(content);
            render(content);
        }
    }

    closeBtn.addEventListener('click', close);
    printBtn.addEventListener('click', () => window.print());

    return { open, close, sync };
}
