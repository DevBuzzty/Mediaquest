/*
 * hotspot-editor.js: Trefferzonen per Pointer Events zeichnen (Maus, Touch, Stift).
 * Jede Instanz hat eigene Listener am eigenen Element, mehrere Hotspot-Aufgaben stören sich nicht.
 * Die Prozentwerte beziehen sich wie im Spiel auf die Bildfläche im Format 16:9.
 */

import { h, mount, setHidden } from '../shared/dom.js';
import { imageField } from './image-field.js';
import { HINT_CLASS } from './fields.js';
import { pointToPercent, rectFromPoints, zoneFromPoints } from './store.js';

function placeBox(el, rect) {
    el.style.left = `${rect.x}%`;
    el.style.top = `${rect.y}%`;
    el.style.width = `${rect.w}%`;
    el.style.height = `${rect.h}%`;
}

export function hotspotEditor(form) {
    const { task } = form;
    const image = h('img', { alt: 'Bild für die Trefferzonen', class: 'w-full h-full object-contain pointer-events-none', draggable: 'false' });
    const zonesLayer = h('div', { class: 'absolute inset-0' });
    const dragBox = h('div', { class: 'absolute border-2 border-blue-500 bg-blue-500/20 hidden pointer-events-none' });
    const overlay = h('div', { class: 'absolute inset-0 cursor-crosshair touch-none select-none' }, zonesLayer, dragBox);
    const box = h('div', { class: 'relative w-full aspect-video bg-black rounded-2xl overflow-hidden' }, image, overlay);
    const countLabel = h('span', { class: 'text-sm font-bold text-slate-400', 'aria-live': 'polite' });
    const emptyHint = h('p', { class: HINT_CLASS }, 'Lade zuerst ein Bild hoch, dann ziehe die Trefferzonen auf dem Bild auf.');

    function showImage() {
        const hasImage = Boolean(task.image);
        if (hasImage) image.src = task.image;
        setHidden(box, !hasImage);
        setHidden(emptyHint, hasImage);
    }

    function renderZones() {
        mount(zonesLayer, task.zones.map((zone, index) => {
            const button = h('button', {
                type: 'button',
                class: 'absolute top-0 right-0 w-7 h-7 bg-slate-900/80 text-white rounded-bl-lg text-base leading-none',
                'aria-label': `Trefferzone ${index + 1} löschen`,
                title: 'Zone löschen',
                onPointerDown: (event) => event.stopPropagation(),
                onClick: () => {
                    task.zones.splice(index, 1);
                    zonesChanged();
                }
            }, '×');
            const el = h('div', { class: 'absolute border-2 border-green-500 bg-green-500/10 rounded' }, button);
            placeBox(el, zone);
            return el;
        }));
        countLabel.textContent = `${task.zones.length} ${task.zones.length === 1 ? 'Zone' : 'Zonen'} markiert`;
    }

    function zonesChanged() {
        renderZones();
        form.changed();
    }

    let drawing = null;

    function endDrawing() {
        drawing = null;
        setHidden(dragBox, true);
    }

    overlay.addEventListener('pointerdown', (event) => {
        if (drawing || event.button !== 0) return;
        event.preventDefault();
        overlay.setPointerCapture(event.pointerId);
        const start = pointToPercent(event.clientX, event.clientY, overlay.getBoundingClientRect());
        drawing = { pointerId: event.pointerId, start };
        placeBox(dragBox, rectFromPoints(start, start));
        setHidden(dragBox, false);
    });

    overlay.addEventListener('pointermove', (event) => {
        if (!drawing || event.pointerId !== drawing.pointerId) return;
        placeBox(dragBox, rectFromPoints(drawing.start, pointToPercent(event.clientX, event.clientY, overlay.getBoundingClientRect())));
    });

    overlay.addEventListener('pointerup', (event) => {
        if (!drawing || event.pointerId !== drawing.pointerId) return;
        const zone = zoneFromPoints(drawing.start, pointToPercent(event.clientX, event.clientY, overlay.getBoundingClientRect()));
        endDrawing();
        if (zone) {
            task.zones.push(zone);
            zonesChanged();
        }
    });

    overlay.addEventListener('pointercancel', (event) => {
        if (drawing && event.pointerId === drawing.pointerId) endDrawing();
    });

    const clearButton = h('button', {
        type: 'button',
        class: 'text-sm text-red-400 font-bold min-h-[2.75rem] px-2',
        onClick: () => {
            task.zones.splice(0);
            zonesChanged();
        }
    }, 'Zonen löschen');

    showImage();
    renderZones();

    return h('div', { class: 'space-y-3' },
        imageField(form, 'Bild', showImage),
        emptyHint,
        box,
        h('div', { class: 'flex justify-between items-center gap-2' }, countLabel, clearButton));
}
