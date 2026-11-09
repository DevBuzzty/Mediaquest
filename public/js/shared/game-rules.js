/*
 * Spielregeln des Brettspiels (Spielbrett, Schritte, Portale, Welten).
 *
 * Laeuft unveraendert im Browser (klassisches Skript, definiert window.GameRules)
 * und in Node (module.exports). Keine Abhaengigkeiten, kein DOM, kein Node-API.
 * Der Server entscheidet mit diesen Funktionen, die Oberflaechen benutzen sie nur
 * fuer Anzeige und Texte.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.GameRules = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    // --- Die Portal-Regel: nur hier aendern --------------------------------------
    //
    // true:  Die Figur bleibt auf jedem noch nicht gespielten Portalfeld stehen, auch
    //        wenn sie noch Schritte haette. Die restlichen Schritte dieses Zuges verfallen.
    // false: Die Figur bleibt nur stehen, wenn ihr letzter Schritt genau auf dem Portalfeld
    //        endet. Wer darueber hinaus geht, laeuft am Portal vorbei.
    var PORTAL_ALWAYS_STOPS = true;

    var BOARD_FIELDS = 25;
    var ARRIVAL_FIELD = 1;
    var MONSTER_FIELDS = [8, 16, 24];
    var MAIN_WORLD = 'haupt';
    var MIN_WORLDS = 1;
    var MAX_WORLDS = 5;

    var PORTAL_FIELDS = {
        1: [13],
        2: [6, 19],
        3: [6, 13, 19],
        4: [3, 6, 13, 19],
        5: [3, 6, 10, 13, 19]
    };

    // colors enthaelt die Farben aus dem Design-Handbuch unveraendert. Lesbaren Text
    // liefert readableText(), denn nicht jedes "text" ist auf jedem Hintergrund lesbar.
    var WORLDS = {
        haupt: {
            key: 'haupt',
            name: 'Allgemeines Spielbrett',
            colors: { bg: '#0F172A', surface: '#1E293B', surface2: '#172033', accent: '#3B82F6', accent2: '#A855F7', text: '#E2E8F0' },
            monsterImage: null
        },
        news: {
            key: 'news',
            name: 'News Arena',
            colors: { bg: '#080C18', surface: '#101836', surface2: '#0A1024', accent: '#35E5FF', accent2: '#FF3EA5', text: '#182247' },
            monsterImage: '/img/monsters/news-arena-schlange.png'
        },
        dschungel: {
            key: 'dschungel',
            name: 'Social Media Dschungel',
            colors: { bg: '#CFCABD', surface: '#6AA76C', surface2: '#588F5B', accent: '#2F6B41', accent2: '#F6D34A', text: '#ECE7D4' },
            monsterImage: '/img/monsters/dschungel-affe.png'
        },
        daten: {
            key: 'daten',
            name: 'Datenhöhle',
            colors: { bg: '#1C1830', surface: '#2C2648', surface2: '#211C3A', accent: '#D1453A', accent2: '#8B5CF6', text: '#D9D3C4' },
            monsterImage: '/img/monsters/datenhoehle-schnecke.png'
        },
        ki: {
            key: 'ki',
            name: 'KI Labor',
            colors: { bg: '#C6CCD6', surface: '#3F6EA0', surface2: '#345D88', accent: '#5FD0C0', accent2: '#FFB84D', text: '#E9F1FA' },
            monsterImage: '/img/monsters/ki-labor-roboter.png'
        },
        strand: {
            key: 'strand',
            name: 'Glitch Strand',
            colors: { bg: '#D8C48C', surface: '#E6CD93', surface2: '#D3B877', accent: '#2F9FD0', accent2: '#FF6F5E', text: '#FDF7EA' },
            monsterImage: '/img/monsters/glitch-strand-hai.png'
        }
    };

    var WORLD_KEYS = ['news', 'dschungel', 'daten', 'ki', 'strand'];

    function hasWorld(key) {
        return typeof key === 'string' && Object.prototype.hasOwnProperty.call(WORLDS, key);
    }

    function worldName(key) {
        return hasWorld(key) ? WORLDS[key].name : '';
    }

    /** Portalfelder des Hauptbretts, aufsteigend; leer bei ungueltiger Weltenzahl. */
    function portalFields(worldCount) {
        return Object.prototype.hasOwnProperty.call(PORTAL_FIELDS, worldCount) ? PORTAL_FIELDS[worldCount].slice() : [];
    }

    /** Anteil der richtigen Gruppen in Schritte: ueber 80 % vier, ueber 60 % zwei, sonst einer. */
    function computeSteps(correct, total) {
        if (!(total > 0)) return 1;
        var right = Math.max(0, Math.min(correct, total));
        // Ganzzahlig vergleichen, damit Rundung nie an einer Grenze entscheidet.
        if (right * 100 > total * 80) return 4;
        if (right * 100 > total * 60) return 2;
        return 1;
    }

    /** Klassen-Ergebnis einer Runde. percent ist gerundet und dient nur der Anzeige. */
    function roundResult(correct, total) {
        return {
            correct: correct,
            total: total,
            percent: total > 0 ? Math.round((Math.max(0, Math.min(correct, total)) * 100) / total) : 0,
            steps: computeSteps(correct, total)
        };
    }

    /**
     * Laeuft Feld fuer Feld ab pos + 1.
     * stops: { portals: [noch nicht gespielte Portalfelder], monsters: [...] } (optional).
     * Ergebnis: { to, remaining, stoppedAt } mit stoppedAt 'monster', 'portal', 'end' oder null.
     * remaining ist nur nach einem Monsterstopp groesser als 0.
     */
    function planMove(input) {
        var source = input || {};
        var pos = Number.isInteger(source.pos) ? source.pos : ARRIVAL_FIELD;
        var steps = Number.isInteger(source.steps) && source.steps > 0 ? source.steps : 0;
        var stops = source.stops || {};
        var monsters = Array.isArray(stops.monsters) ? stops.monsters : MONSTER_FIELDS;
        var portals = Array.isArray(stops.portals) ? stops.portals : [];
        var at = pos;
        for (var walked = 1; walked <= steps; walked += 1) {
            var left = steps - walked;
            at += 1;
            if (at >= BOARD_FIELDS) return { to: BOARD_FIELDS, remaining: 0, stoppedAt: 'end' };
            if (monsters.indexOf(at) !== -1) return { to: at, remaining: left, stoppedAt: 'monster' };
            if (portals.indexOf(at) !== -1 && (PORTAL_ALWAYS_STOPS || left === 0)) {
                return { to: at, remaining: 0, stoppedAt: 'portal' };
            }
        }
        return { to: at, remaining: 0, stoppedAt: null };
    }

    /** Position in den drei Monster-Aufgaben einer Welt; -1 wenn field kein Monsterfeld ist. */
    function monsterIndex(field) {
        return MONSTER_FIELDS.indexOf(field);
    }

    /** Anzeigename: Monster 1, Monster 2, Monster 3; im Hauptbrett ist das dritte der Endboss. */
    function monsterLabel(worldKey, index) {
        if (worldKey === MAIN_WORLD && index === 2) return 'Endboss';
        return 'Monster ' + (index + 1);
    }

    function continueMessage(steps) {
        return 'Du darfst noch ' + steps + (steps === 1 ? ' Schritt' : ' Schritte') + ' gehen.';
    }

    function portalMessage(worldKey, kartenset) {
        return 'Portal entdeckt! Legt jetzt das Weltenbrett „' + worldName(worldKey) + '“ aus und nehmt das Kartenset „' + kartenset + '“.';
    }

    function worldDoneMessage(worldKey, portalField) {
        return 'Die Welt „' + worldName(worldKey) + '“ ist geschafft! Räumt das Weltenbrett weg, weiter geht es auf dem Hauptbrett auf Feld ' + portalField + '.';
    }

    var VICTORY_MESSAGE = 'Geschafft! Ihr habt das Ziel erreicht und die Welt gerettet!';

    function channel(value) {
        var v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function luminance(hex) {
        var match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
        if (!match) return 0;
        return 0.2126 * channel(parseInt(match[1], 16)) + 0.7152 * channel(parseInt(match[2], 16)) + 0.0722 * channel(parseInt(match[3], 16));
    }

    function contrast(a, b) {
        var high = Math.max(luminance(a), luminance(b));
        var low = Math.min(luminance(a), luminance(b));
        return (high + 0.05) / (low + 0.05);
    }

    var MIN_CONTRAST = 4.5;

    function betterOf(background, dark, light) {
        return contrast(background, dark) >= contrast(background, light) ? dark : light;
    }

    /**
     * Lesbare Textfarbe fuer background: preferred, wenn der Kontrast reicht, sonst das
     * weiche Hell oder Dunkel. Auf mittleren Farben reicht auch das nicht, dort Schwarz oder Weiss.
     */
    function readableText(background, preferred) {
        if (preferred && contrast(background, preferred) >= MIN_CONTRAST) return preferred;
        var soft = betterOf(background, '#0F172A', '#F8FAFC');
        return contrast(background, soft) >= MIN_CONTRAST ? soft : betterOf(background, '#000000', '#FFFFFF');
    }

    return {
        PORTAL_ALWAYS_STOPS: PORTAL_ALWAYS_STOPS,
        BOARD_FIELDS: BOARD_FIELDS,
        ARRIVAL_FIELD: ARRIVAL_FIELD,
        MONSTER_FIELDS: MONSTER_FIELDS,
        MAIN_WORLD: MAIN_WORLD,
        MIN_WORLDS: MIN_WORLDS,
        MAX_WORLDS: MAX_WORLDS,
        WORLDS: WORLDS,
        WORLD_KEYS: WORLD_KEYS,
        VICTORY_MESSAGE: VICTORY_MESSAGE,
        hasWorld: hasWorld,
        worldName: worldName,
        portalFields: portalFields,
        computeSteps: computeSteps,
        roundResult: roundResult,
        planMove: planMove,
        monsterIndex: monsterIndex,
        monsterLabel: monsterLabel,
        continueMessage: continueMessage,
        portalMessage: portalMessage,
        worldDoneMessage: worldDoneMessage,
        contrast: contrast,
        readableText: readableText
    };
});
