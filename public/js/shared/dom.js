/*
 * dom.js: DOM-Bausteine ohne HTML-Strings (CSP-konform).
 *
 *   import { h, mount, clear, setHidden, byId } from '/js/shared/dom.js';
 *
 *   const btn = h('button', { class: ['btn', aktiv && 'ring-2'], onClick: speichern }, 'Speichern');
 *   const liste = h('ul', { class: 'space-y-2' }, teams.map((t) => h('li', null, t.name)));
 *   mount(byId('app'), h('h2', null, task.question), liste, btn);
 *
 * h(tag, props, ...children)
 *   props: immer ein Objekt oder null. Nutzerdaten gehören NIE an diese Stelle, nur in children.
 *     class/className  String oder Array (falsche Werte werden übersprungen)
 *     style            Objekt, z. B. { backgroundColor: team.color, '--x': '1' }, oder String
 *     dataset          Objekt, z. B. { index: 3 }
 *     onClick, onPointerDown, ...  Funktion, wird per addEventListener gebunden (null/false: keiner)
 *     value, checked, disabled, hidden, selected, ...  werden als Property gesetzt.
 *       value und checked erst nach den children, damit <select> und Slider den Wert behalten.
 *     aria-*           true/false werden zu "true"/"false"
 *     alles andere     setAttribute; true = leeres Attribut, false/null/undefined = kein Attribut
 *     innerHTML, outerHTML, srcdoc und Inline-Handler als String lösen einen TypeError aus.
 *   children: Strings und Zahlen werden Textknoten, Nodes werden eingehängt, Arrays beliebig tief
 *     geglättet, null/undefined/true/false ignoriert. Andere Objekte (etwa ungeprüfte Team-Antworten)
 *     erscheinen als JSON-Text, sie können die Seite also nicht zum Absturz bringen.
 *
 * Für Listener auf window/document oder mit Optionen ({ passive: false }) addEventListener direkt
 * benutzen und beim Aufräumen wieder entfernen.
 *
 * mount(parent, ...children)  ersetzt den Inhalt von parent, nimmt children wie h()
 * clear(parent)               leert parent
 * setHidden(el, bool)         schaltet die Tailwind-Klasse "hidden"
 * byId(id)                    getElementById, wirft bei fehlendem Element
 */

const FORBIDDEN_PROPS = new Set(['innerHTML', 'outerHTML', 'srcdoc']);
const PROPERTIES = new Set([
    'disabled', 'hidden', 'selected', 'muted', 'readOnly', 'required', 'multiple',
    'indeterminate', 'open', 'htmlFor', 'tabIndex', 'textContent'
]);
const LATE_PROPERTIES = new Set(['value', 'checked']);

function collectNodes(child, nodes) {
    if (child === null || child === undefined || typeof child === 'boolean') return;
    if (Array.isArray(child)) {
        child.forEach((entry) => collectNodes(entry, nodes));
    } else if (child instanceof Node) {
        nodes.push(child);
    } else if (typeof child === 'object') {
        nodes.push(document.createTextNode(JSON.stringify(child)));
    } else {
        nodes.push(document.createTextNode(String(child)));
    }
}

function toNodes(children) {
    const nodes = [];
    collectNodes(children, nodes);
    return nodes;
}

function applyStyle(el, style) {
    if (typeof style === 'string') {
        // Über das CSSOM, ein style-Attribut würde die CSP blockieren.
        el.style.cssText = style;
        return;
    }
    Object.entries(style).forEach(([name, value]) => {
        if (value === null || value === undefined) return;
        if (name.includes('-')) el.style.setProperty(name, String(value));
        else el.style[name] = value;
    });
}

function applyClass(el, value) {
    const names = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    if (names) el.setAttribute('class', names);
}

function applyProp(el, key, value) {
    if (FORBIDDEN_PROPS.has(key)) throw new TypeError(`h(): "${key}" ist nicht erlaubt`);
    if (key.startsWith('on')) {
        if (value === null || value === undefined || value === false) return;
        if (typeof value !== 'function') throw new TypeError(`h(): "${key}" muss eine Funktion sein`);
        el.addEventListener(key.slice(2).toLowerCase(), value);
        return;
    }
    if (value === null || value === undefined) return;
    if (key === 'class' || key === 'className') applyClass(el, value);
    else if (key === 'style') applyStyle(el, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (PROPERTIES.has(key) || LATE_PROPERTIES.has(key)) el[key] = value;
    else if (key.startsWith('aria-')) el.setAttribute(key, String(value));
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false) el.setAttribute(key, String(value));
}

export function h(tag, props, ...children) {
    if (props !== null && props !== undefined
        && (typeof props !== 'object' || Array.isArray(props) || props instanceof Node)) {
        throw new TypeError('h(): das zweite Argument muss ein Props-Objekt oder null sein');
    }
    const el = document.createElement(tag);
    const entries = Object.entries(props || {});
    entries.filter(([key]) => !LATE_PROPERTIES.has(key)).forEach(([key, value]) => applyProp(el, key, value));
    el.append(...toNodes(children));
    entries.filter(([key]) => LATE_PROPERTIES.has(key)).forEach(([key, value]) => applyProp(el, key, value));
    return el;
}

export function mount(parent, ...children) {
    parent.replaceChildren(...toNodes(children));
    return parent;
}

export function clear(parent) {
    parent.replaceChildren();
    return parent;
}

export function setHidden(el, hidden) {
    el.classList.toggle('hidden', Boolean(hidden));
    return el;
}

export function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} fehlt`);
    return el;
}
