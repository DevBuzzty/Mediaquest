/*
 * Gemeinsame Definition der 18 Aufgaben-Typen.
 *
 * Laeuft unveraendert im Browser (klassisches Skript, definiert window.TaskTypes)
 * und in Node (module.exports). Keine Abhaengigkeiten, kein DOM, kein Node-API.
 * Der Server validiert jede Spielrunde hiermit, der Editor benutzt dieselben
 * Regeln vor dem Speichern.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.TaskTypes = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    var LIMITS = {
        shortText: 200,
        longText: 2000,
        listItems: 50,
        tasks: 100,
        chatNodes: 100,
        chatOptions: 8,
        passwordRules: 10,
        passwordMinLength: 64,
        countdownMax: 3600,
        scrollerMinPosts: 10,
        bucketsMin: 2,
        bucketsMax: 4
    };

    // Bilder liegen immer auf dem eigenen Server: Hochladen liefert /uploads/...,
    // mitgelieferte Beispielbilder liegen unter /img/...
    var IMAGE_URL = /^\/(uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)|img\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.(?:svg|png|jpg|webp))$/;
    var AUDIO_URL = /^\/uploads\/[a-f0-9]{32}\.(?:mp3|m4a|ogg|wav)$/;
    var STATION_CODE = /^[A-Za-z0-9_-]{3,32}$/;
    // Sonst landen Knoten-Namen beim Lesen und Schreiben auf Object.prototype statt auf dem Dialog.
    var RESERVED_NODE_IDS = ['__proto__', 'constructor', 'prototype'];

    // Was der Editor neu anbietet, in dieser Reihenfolge. Alle anderen Typen bleiben
    // voll funktionsfaehig (Oeffnen, Anzeigen, Speichern); ein Eintrag hier macht sie
    // wieder waehlbar.
    var EDITOR_TYPES = [
        'binary', 'choice', 'select', 'bucket', 'ranking', 'pairs',
        'cloze', 'chat', 'scroller', 'photo', 'statement', 'monster'
    ];

    // Muss mit GameRules.WORLDS uebereinstimmen; ein Test prueft das.
    var WORLD_KEYS = ['haupt', 'news', 'dschungel', 'daten', 'ki', 'strand'];
    var MONSTERS_PER_WORLD = 3;

    var PROFILE_FIELDS = [
        { value: 'name', label: 'Name' },
        { value: 'alter', label: 'Alter' },
        { value: 'ort', label: 'Ort' },
        { value: 'hobbies', label: 'Hobbies' },
        { value: 'e-mail', label: 'E-Mail' },
        { value: 'foto', label: 'Foto' }
    ];

    var DEFAULT_PASSWORD_RULES = ['Mind. 8 Zeichen'];

    function profileFieldLabel(field) {
        var known = PROFILE_FIELDS.filter(function (entry) { return entry.value === field; })[0];
        return known ? known.label : field;
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function isPlainObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function isFilledString(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    // --- Validierungs-Helfer: haengen deutsche Fehlertexte an errors an -------

    function optionalText(errors, task, key, label, max) {
        var value = task[key];
        if (value === undefined || value === null) return;
        if (typeof value !== 'string') {
            errors.push(label + ' muss ein Text sein.');
        } else if (value.length > max) {
            errors.push(label + ' ist zu lang (maximal ' + max + ' Zeichen).');
        }
    }

    function stringList(errors, value, label, min, max, maxLen) {
        if (!Array.isArray(value)) {
            errors.push(label + ': Es muss eine Liste angegeben werden.');
            return false;
        }
        if (value.length < min) {
            errors.push(label + ': Mindestens ' + min + (min === 1 ? ' Eintrag' : ' Einträge') + ' erforderlich.');
            return false;
        }
        if (value.length > max) {
            errors.push(label + ': Höchstens ' + max + ' Einträge erlaubt.');
            return false;
        }
        var ok = true;
        value.forEach(function (entry, i) {
            if (!isFilledString(entry)) {
                errors.push(label + ' ' + (i + 1) + ' darf nicht leer sein.');
                ok = false;
            } else if (entry.length > maxLen) {
                errors.push(label + ' ' + (i + 1) + ' ist zu lang (maximal ' + maxLen + ' Zeichen).');
                ok = false;
            }
        });
        return ok;
    }

    function optionalImage(errors, task) {
        if (task.image === undefined || task.image === null || task.image === '') return;
        if (typeof task.image !== 'string' || !IMAGE_URL.test(task.image)) {
            errors.push('Das Bild muss auf diesem Server hochgeladen sein.');
        }
    }

    function optionalAudio(errors, task) {
        if (task.audio === undefined || task.audio === null || task.audio === '') return;
        if (typeof task.audio !== 'string' || !AUDIO_URL.test(task.audio)) {
            errors.push('Die Audio-Datei muss auf diesem Server hochgeladen sein.');
        }
    }

    function isSet(value) {
        return value !== undefined && value !== null;
    }

    function isIndexIn(value, list) {
        return Number.isInteger(value) && value >= 0 && Array.isArray(list) && value < list.length;
    }

    function correctListOk(value, list) {
        return Array.isArray(value)
            && value.every(function (entry) { return isIndexIn(entry, list); })
            && new Set(value).size === value.length;
    }

    function requiredImage(errors, task) {
        if (!isFilledString(task.image)) {
            errors.push('Es muss ein Bild hochgeladen werden.');
        } else if (!IMAGE_URL.test(task.image)) {
            errors.push('Das Bild muss auf diesem Server hochgeladen sein.');
        }
    }

    // --- Wiederverwendbare Logik fuer Renderer und Validierung -----------------

    /**
     * Zerlegt einen Lueckentext "Das ist [ein] Test".
     * Ergebnis: { parts: [{text}|{gap: index}], gaps: ['ein'] }.
     */
    function parseCloze(text) {
        var parts = [];
        var gaps = [];
        var source = typeof text === 'string' ? text : '';
        var pattern = /\[([^\]]*)\]/g;
        var last = 0;
        var match;
        while ((match = pattern.exec(source)) !== null) {
            if (match.index > last) parts.push({ text: source.slice(last, match.index) });
            parts.push({ gap: gaps.length });
            gaps.push(match[1].trim());
            last = match.index + match[0].length;
        }
        if (last < source.length) parts.push({ text: source.slice(last) });
        return { parts: parts, gaps: gaps };
    }

    var PASSWORD_CLASSES = [
        { name: 'special', words: /sonderzeichen/, chars: /[^\p{L}\p{N}\s]/gu },
        { name: 'space', words: /leerzeichen/, chars: /\s/g },
        { name: 'upper', words: /gro(?:ß|ss)buchstabe|gro(?:ß|ss)schreib/, chars: /\p{Lu}/gu },
        { name: 'lower', words: /kleinbuchstabe|kleinschreib/, chars: /\p{Ll}/gu },
        { name: 'digit', words: /zahl|ziffer/, chars: /\p{N}/gu }
    ];
    var PASSWORD_NEGATION = /^(?:kein\p{L}*|ohne|nicht|nie|niemals|verboten|unerlaubt)$/u;
    var PASSWORD_FILLER = /^(?:bitte|das|passwort|es|im|sind|ist|darf|dürfen|duerfen|enthalten|erlaubt|verwenden|benutzen|nutzen|verwendet|benutzt|werden)$/u;
    var PASSWORD_LIMITED = /\bmax|höchstens|hoechstens|\bnur\b|genau|exakt|\bbis\b|weniger als/;

    function lengthCheck(min, max) {
        var check = {
            test: function (v) {
                return (min === undefined || v.length >= min) && (max === undefined || v.length <= max);
            }
        };
        if (min !== undefined) check.minLength = min;
        if (max !== undefined) check.maxLength = max;
        return check;
    }

    function passwordLengthRule(text, tokens) {
        var mentions = text.match(/\d+\s*zeichen/g);
        if (!mentions) return null;
        var range = text.match(/(\d+)\s*(?:bis|-|–|und)\s*(\d+)\s*zeichen/);
        if (range) {
            var a = parseInt(range[1], 10);
            var b = parseInt(range[2], 10);
            return lengthCheck(Math.min(a, b), Math.max(a, b));
        }
        if (mentions.length > 1) return null;
        var n = parseInt(mentions[0], 10);
        if (/nicht\s+(?:mehr|länger|laenger)\s+als/.test(text)) return lengthCheck(undefined, n);
        if (/nicht\s+(?:weniger|kürzer|kuerzer)\s+als/.test(text)) return lengthCheck(n, undefined);
        if (/(?:mehr|länger|laenger)\s+als/.test(text)) return lengthCheck(n + 1, undefined);
        if (/(?:weniger|kürzer|kuerzer)\s+als/.test(text)) return lengthCheck(undefined, n - 1);
        if (/genau|exakt/.test(text)) return lengthCheck(n, n);
        if (/\bmax|höchstens|hoechstens|\bbis\b/.test(text)) return lengthCheck(undefined, n);
        if (tokens.some(function (t) { return PASSWORD_NEGATION.test(t); })) return null;
        return lengthCheck(n, undefined);
    }

    function passwordClassRule(text, tokens) {
        var named = PASSWORD_CLASSES.filter(function (entry) { return entry.words.test(text); });
        if (named.length !== 1) return null;
        var cls = named[0];
        var count = function (v) { return (v.match(cls.chars) || []).length; };
        var digits = text.match(/\d+/g) || [];

        if (tokens.some(function (t) { return PASSWORD_NEGATION.test(t); })) {
            // Nur das schlichte Verbot ist eindeutig; "Keine Zahl am Anfang" verbietet nicht jede Zahl.
            var plain = digits.length === 0 && tokens.every(function (t) {
                return PASSWORD_NEGATION.test(t) || PASSWORD_FILLER.test(t) || cls.words.test(t);
            });
            if (!plain) return null;
            return { forbids: cls.name, test: function (v) { return count(v) === 0; } };
        }
        if (PASSWORD_LIMITED.test(text)) return null;

        var counted = text.slice(0, text.search(cls.words)).match(/(\d+)\s*$/);
        if (digits.length > (counted ? 1 : 0)) return null;
        var needed = counted ? parseInt(counted[1], 10) : 1;
        if (needed < 1) return null;
        return {
            requires: cls.name,
            minCount: needed,
            minLength: needed,
            test: function (v) { return count(v) >= needed; }
        };
    }

    /** Liefert die Prüfung einer Regel oder null, wenn ihr Sinn nicht eindeutig erkennbar ist. */
    function passwordRuleCheck(rule) {
        var text = String(rule).toLowerCase();
        var tokens = text.split(/[^\p{L}]+/u).filter(Boolean);
        return passwordLengthRule(text, tokens) || passwordClassRule(text, tokens);
    }

    /** Sich widersprechende Regeln würden ein Team dauerhaft aussperren. */
    function passwordRulesSatisfiable(rules) {
        var checks = rules.map(passwordRuleCheck).filter(Boolean);
        var minLength = 1;
        var maxLength = Infinity;
        var required = {};
        var forbidden = {};
        checks.forEach(function (check) {
            if (check.requires) required[check.requires] = Math.max(required[check.requires] || 0, check.minCount);
            else if (check.minLength !== undefined) minLength = Math.max(minLength, check.minLength);
            if (check.maxLength !== undefined) maxLength = Math.min(maxLength, check.maxLength);
            if (check.forbids) forbidden[check.forbids] = true;
        });
        var names = Object.keys(required);
        var needed = names.reduce(function (sum, name) { return sum + required[name]; }, 0);
        if (Math.max(minLength, needed) > maxLength) return false;
        if (names.some(function (name) { return forbidden[name]; })) return false;
        return !['special', 'upper', 'lower', 'digit'].every(function (name) { return forbidden[name]; });
    }

    /**
     * Prueft ein Passwort gegen die konfigurierten Regeln. Regeln, die keinem
     * bekannten Muster entsprechen, werden angezeigt, koennen aber nicht geprueft
     * werden (checkable: false) und blockieren nie: sonst drohte ein Soft-Lock.
     * Der Standard gilt nur, wenn gar keine Regeln angegeben sind; eine leere Liste heisst "keine Regeln".
     */
    function evaluatePasswordRules(rules, value) {
        var list = Array.isArray(rules) ? rules : DEFAULT_PASSWORD_RULES;
        var password = typeof value === 'string' ? value : '';
        var results = list.map(function (rule) {
            var check = passwordRuleCheck(rule);
            return { rule: rule, checkable: !!check, ok: check ? check.test(password) : true };
        });
        return {
            rules: results,
            accepted: password.length > 0 && results.every(function (r) { return r.ok; })
        };
    }

    // Kryptografisch zufaellig in Browser und Node (globalThis.crypto).
    function generateStationCode() {
        var bytes = new Uint32Array(1);
        globalThis.crypto.getRandomValues(bytes);
        return String(100000 + (bytes[0] % 900000));
    }

    function chatErrors(errors, task) {
        var nodes = task.nodes;
        if (!isPlainObject(nodes)) {
            errors.push('Chat: Die Dialog-Struktur ist ungültig.');
            return;
        }
        var ids = Object.keys(nodes);
        if (ids.length > LIMITS.chatNodes) {
            errors.push('Chat: Höchstens ' + LIMITS.chatNodes + ' Knoten erlaubt.');
            return;
        }
        var reserved = ids.filter(function (id) { return RESERVED_NODE_IDS.indexOf(id) !== -1; });
        if (reserved.length) {
            errors.push('Chat: Der Knoten-Name „' + reserved[0] + '“ ist nicht erlaubt.');
            return;
        }
        if (!hasOwn(nodes, 'start')) {
            errors.push('Chat: Es fehlt der Knoten „start“.');
            return;
        }
        var structureOk = true;
        ids.forEach(function (id) {
            var node = nodes[id];
            if (!isPlainObject(node)) {
                errors.push('Chat: Knoten „' + id + '“ ist ungültig.');
                structureOk = false;
                return;
            }
            if (!isFilledString(node.text) || node.text.length > LIMITS.longText) {
                errors.push('Chat: Knoten „' + id + '“ braucht einen Text.');
                structureOk = false;
            }
            if (node.success !== undefined && typeof node.success !== 'boolean') {
                errors.push('Chat: Die Markierung „Erfolg“ in Knoten „' + id + '“ ist ungültig.');
                structureOk = false;
            }
            if (!Array.isArray(node.options) || node.options.length > LIMITS.chatOptions) {
                errors.push('Chat: Knoten „' + id + '“ hat keine gültige Antwortliste (höchstens ' + LIMITS.chatOptions + ').');
                structureOk = false;
                return;
            }
            node.options.forEach(function (opt, i) {
                if (!isPlainObject(opt) || !isFilledString(opt.label) || opt.label.length > LIMITS.shortText) {
                    errors.push('Chat: Antwort ' + (i + 1) + ' in Knoten „' + id + '“ braucht einen Text.');
                    structureOk = false;
                } else if (typeof opt.next !== 'string' || !hasOwn(nodes, opt.next)) {
                    errors.push('Chat: Antwort ' + (i + 1) + ' in Knoten „' + id + '“ verweist auf einen unbekannten Knoten.');
                    structureOk = false;
                }
            });
        });
        if (!structureOk) return;

        // Von jedem erreichbaren Knoten aus muss ein Ende (Knoten ohne Antworten)
        // erreichbar sein, sonst haengt das Team in einer Schleife fest.
        var reachable = new Set();
        var stack = ['start'];
        while (stack.length) {
            var current = stack.pop();
            if (reachable.has(current)) continue;
            reachable.add(current);
            nodes[current].options.forEach(function (opt) { stack.push(opt.next); });
        }
        var canEnd = new Set();
        ids.forEach(function (id) { if (nodes[id].options.length === 0) canEnd.add(id); });
        var changed = true;
        while (changed) {
            changed = false;
            ids.forEach(function (id) {
                if (canEnd.has(id)) return;
                if (nodes[id].options.some(function (opt) { return canEnd.has(opt.next); })) {
                    canEnd.add(id);
                    changed = true;
                }
            });
        }
        reachable.forEach(function (id) {
            if (!canEnd.has(id)) {
                errors.push('Chat: Von Knoten „' + id + '“ aus ist kein Ende erreichbar.');
            }
        });
    }

    // --- Bewertung -------------------------------------------------------------
    //
    // Nur der Server bewertet. Eingaben kommen vom Client und koennen beliebig kaputt sein.

    function sameIndexSet(given, expected) {
        if (!Array.isArray(given) || !Array.isArray(expected)) return false;
        if (given.length !== expected.length) return false;
        if (!given.every(Number.isInteger)) return false;
        if (new Set(given).size !== given.length) return false;
        return given.every(function (entry) { return expected.indexOf(entry) !== -1; });
    }

    function sameTextList(given, expected) {
        if (!Array.isArray(given) || given.length !== expected.length) return false;
        return given.every(function (entry, i) {
            return typeof entry === 'string' && entry.trim() === String(expected[i]).trim();
        });
    }

    function judgeBucket(task, answer) {
        var items = task.items;
        var placements = answer.placements;
        if (!Array.isArray(items) || !Array.isArray(placements) || placements.length !== items.length) return false;
        var open = items.slice();
        return placements.every(function (placement) {
            if (!isPlainObject(placement)) return false;
            var at = -1;
            open.forEach(function (item, i) {
                if (at === -1 && item.text === placement.item && task.buckets[item.target] === placement.bucket) at = i;
            });
            if (at === -1) return false;
            open.splice(at, 1);
            return true;
        });
    }

    function isChatNode(nodes, id) {
        return typeof id === 'string' && hasOwn(nodes, id) && isPlainObject(nodes[id]) && Array.isArray(nodes[id].options);
    }

    function isSuccessEnd(nodes, id) {
        return isChatNode(nodes, id) && nodes[id].options.length === 0 && nodes[id].success === true;
    }

    /** Vollstaendig und exakt: Jedes Paar genau einmal, die Reihenfolge ist egal. */
    function judgePairs(task, answer) {
        var pairs = task.pairs;
        var given = answer.assignments;
        if (!Array.isArray(pairs) || pairs.length === 0 || !Array.isArray(given) || given.length !== pairs.length) return false;
        var open = pairs.slice();
        return given.every(function (entry) {
            if (!isPlainObject(entry)) return false;
            var at = -1;
            open.forEach(function (pair, i) {
                if (at === -1 && pair.left === entry.left && pair.right === entry.right) at = i;
            });
            if (at === -1) return false;
            open.splice(at, 1);
            return true;
        });
    }

    /** Der Pfad muss bei start beginnen, gueltige Antworten waehlen und auf einem Erfolgs-Ende enden. */
    function judgeChat(task, answer) {
        var nodes = task.nodes;
        var path = answer.path;
        if (!isPlainObject(nodes) || !Array.isArray(path) || path.length === 0) return false;
        var current = 'start';
        for (var i = 0; i < path.length; i += 1) {
            var step = path[i];
            if (!isPlainObject(step) || step.node !== current || !hasOwn(nodes, current)) return false;
            var following = path[i + 1];
            var chosen = nodes[current].options.filter(function (opt) {
                if (opt.label !== step.choice) return false;
                return following === undefined ? isSuccessEnd(nodes, opt.next) : isPlainObject(following) && opt.next === following.node;
            })[0];
            if (!chosen) return false;
            current = chosen.next;
        }
        return isSuccessEnd(nodes, current);
    }

    function flaggedPosts(posts) {
        var flagged = [];
        if (Array.isArray(posts)) {
            posts.forEach(function (post, i) { if (isPlainObject(post) && post.isBad === true) flagged.push(i); });
        }
        return flagged;
    }

    /** Ein Erfolgs-Ende, das erst nach mindestens einer Antwort kommt: Ohne Antwort gaebe es nichts zu bewerten. */
    function hasReachableSuccess(nodes) {
        if (!isPlainObject(nodes)) return false;
        var seen = new Set();
        var stack = ['start'];
        while (stack.length) {
            var id = stack.pop();
            if (seen.has(id) || !isChatNode(nodes, id)) continue;
            seen.add(id);
            if (id !== 'start' && isSuccessEnd(nodes, id)) return true;
            nodes[id].options.forEach(function (opt) { if (isPlainObject(opt)) stack.push(opt.next); });
        }
        return false;
    }

    // --- Typ-Definitionen ------------------------------------------------------
    //
    // fields:   typ-spezifische Felder, alles andere ausser den Basisfeldern wird
    //           beim Speichern verworfen.
    // defaults: Startdaten im Editor; eine Fabrik, damit jede Aufgabe ein eigenes
    //           Objekt erhaelt.
    // judge:    (task, answer) -> true/false, nur auf dem Server vertrauenswuerdig.
    //           Typen ohne judge koennen im Brettspiel nicht als Karte dienen.
    // solution: (errors, task) meldet, was zum Bewerten einer Karte fehlt.

    var DEFINITIONS = [
        {
            type: 'binary', label: 'Binary Swipe', category: 'Basis', icon: '↔️',
            fields: ['icon', 'correct'],
            defaults: function () { return { icon: '❓', correct: null }; },
            check: function (e, t) {
                optionalText(e, t, 'icon', 'Emoji', 16);
                if (isSet(t.correct) && t.correct !== 'left' && t.correct !== 'right') e.push('Die richtige Seite muss „links“ oder „rechts“ sein.');
            },
            judge: function (t, a) { return (t.correct === 'left' || t.correct === 'right') && a.choice === t.correct; },
            solution: function (e, t) {
                if (t.correct !== 'left' && t.correct !== 'right') e.push('Bitte lege fest, welche Seite richtig ist.');
            }
        },
        {
            type: 'choice', label: 'Multiple Choice', category: 'Basis', icon: '🔘',
            fields: ['options', 'correct'],
            defaults: function () { return { options: ['', '', ''], correct: null }; },
            check: function (e, t) {
                stringList(e, t.options, 'Antwort', 2, LIMITS.listItems, LIMITS.shortText);
                if (isSet(t.correct) && !isIndexIn(t.correct, t.options)) e.push('Die richtige Antwort gibt es nicht.');
            },
            judge: function (t, a) { return isIndexIn(t.correct, t.options) && a.index === t.correct; },
            solution: function (e, t) {
                if (!isIndexIn(t.correct, t.options)) e.push('Bitte lege die richtige Antwort fest.');
            }
        },
        {
            type: 'select', label: 'Multiple Select', category: 'Basis', icon: '✅',
            fields: ['options', 'correct'],
            defaults: function () { return { options: ['', '', ''], correct: [] }; },
            check: function (e, t) {
                stringList(e, t.options, 'Antwort', 2, LIMITS.listItems, LIMITS.shortText);
                if (isSet(t.correct) && !correctListOk(t.correct, t.options)) e.push('Die richtigen Antworten sind ungültig.');
            },
            judge: function (t, a) { return correctListOk(t.correct, t.options) && t.correct.length > 0 && sameIndexSet(a.indices, t.correct); },
            solution: function (e, t) {
                if (!correctListOk(t.correct, t.options) || t.correct.length === 0) e.push('Bitte lege mindestens eine richtige Antwort fest.');
            }
        },
        {
            type: 'chat', label: 'Chatsimulator', category: 'Interaktion', icon: '💬',
            fields: ['partner', 'nodes'],
            defaults: function () {
                return {
                    partner: 'Unbekannt',
                    nodes: {
                        start: { text: 'Hallo!', options: [{ label: 'Hi!', next: 'end' }] },
                        end: { text: 'Schön dich zu sehen.', options: [] }
                    }
                };
            },
            check: function (e, t) {
                optionalText(e, t, 'partner', 'Chat-Partner', LIMITS.shortText);
                chatErrors(e, t);
            },
            judge: judgeChat,
            solution: function (e, t) {
                if (!hasReachableSuccess(t.nodes)) e.push('Chat: Mindestens ein Ende, das man über eine Antwort erreicht, muss als Erfolg markiert sein.');
            }
        },
        {
            type: 'scroller', label: 'Feed-Scroller', category: 'Interaktion', icon: '📱',
            fields: ['posts'],
            defaults: function () { return { posts: [] }; },
            check: function (e, t) {
                if (!Array.isArray(t.posts) || t.posts.length < LIMITS.scrollerMinPosts) {
                    e.push('Feed-Scroller: Mindestens ' + LIMITS.scrollerMinPosts + ' Posts erforderlich.');
                    return;
                }
                if (t.posts.length > LIMITS.listItems) {
                    e.push('Feed-Scroller: Höchstens ' + LIMITS.listItems + ' Posts erlaubt.');
                    return;
                }
                t.posts.forEach(function (post, i) {
                    if (!isPlainObject(post) || !isFilledString(post.user) || !isFilledString(post.text)) {
                        e.push('Post ' + (i + 1) + ' braucht einen Namen und einen Text.');
                    } else if (post.user.length > LIMITS.shortText || post.text.length > LIMITS.longText) {
                        e.push('Post ' + (i + 1) + ' ist zu lang.');
                    } else if (post.isBad !== undefined && typeof post.isBad !== 'boolean') {
                        e.push('Post ' + (i + 1) + ': Die Markierung „problematisch“ ist ungültig.');
                    }
                });
            },
            judge: function (t, a) {
                var flagged = flaggedPosts(t.posts);
                return flagged.length > 0 && sameIndexSet(a.marked, flagged);
            },
            solution: function (e, t) {
                if (flaggedPosts(t.posts).length === 0) e.push('Feed-Scroller: Mindestens ein Post muss als problematisch markiert sein.');
            }
        },
        {
            type: 'detector', label: 'Detektor (Lupe)', category: 'Interaktion', icon: '🔍',
            fields: ['image'],
            defaults: function () { return { image: '' }; },
            check: requiredImageCheck
        },
        {
            type: 'hotspot', label: 'Hotspot-Bild', category: 'Interaktion', icon: '🎯',
            fields: ['image', 'zones'],
            defaults: function () { return { image: '', zones: [] }; },
            check: function (e, t) {
                requiredImage(e, t);
                if (!Array.isArray(t.zones) || t.zones.length === 0) {
                    e.push('Hotspot: Mindestens eine Trefferzone erforderlich.');
                    return;
                }
                if (t.zones.length > LIMITS.listItems) {
                    e.push('Hotspot: Höchstens ' + LIMITS.listItems + ' Trefferzonen erlaubt.');
                    return;
                }
                t.zones.forEach(function (zone, i) {
                    var ok = isPlainObject(zone) && ['x', 'y', 'w', 'h'].every(function (k) {
                        return typeof zone[k] === 'number' && isFinite(zone[k]) && zone[k] >= 0;
                    });
                    if (!ok || zone.w < 1 || zone.h < 1 || zone.x + zone.w > 100.5 || zone.y + zone.h > 100.5) {
                        e.push('Hotspot: Trefferzone ' + (i + 1) + ' ist ungültig.');
                    }
                });
            }
        },
        {
            type: 'password', label: 'Passwort-Check', category: 'Eingabe', icon: '🔐',
            fields: ['rules'],
            defaults: function () { return { rules: DEFAULT_PASSWORD_RULES.slice() }; },
            check: function (e, t) {
                if (t.rules === undefined) return;
                if (!stringList(e, t.rules, 'Regel', 0, LIMITS.passwordRules, LIMITS.shortText)) return;
                t.rules.forEach(function (rule, i) {
                    var check = passwordRuleCheck(rule);
                    if (check && check.minLength > LIMITS.passwordMinLength) {
                        e.push('Regel ' + (i + 1) + ': Mehr als ' + LIMITS.passwordMinLength + ' Zeichen sind nicht erfüllbar.');
                    }
                });
                if (!passwordRulesSatisfiable(t.rules)) {
                    e.push('Passwort: Die Regeln widersprechen sich, kein Passwort kann alle erfüllen.');
                }
            }
        },
        {
            type: 'photo', label: 'Foto Upload', category: 'Eingabe', icon: '📸',
            fields: [],
            defaults: function () { return {}; },
            check: function () {},
            judge: function (t, a) { return isFilledString(a.url); },
            solution: function () {}
        },
        {
            type: 'statement', label: 'Freitextfeld', category: 'Eingabe', icon: '📝',
            fields: [],
            defaults: function () { return {}; },
            check: function () {},
            judge: function (t, a) { return isFilledString(a.text); },
            solution: function () {}
        },
        {
            type: 'profile', label: 'Profil-Editor', category: 'Eingabe', icon: '👤',
            fields: ['fields', 'customFields'],
            defaults: function () { return { fields: ['name'], customFields: [] }; },
            check: function (e, t) {
                var fields = t.fields === undefined ? [] : t.fields;
                var custom = t.customFields === undefined ? [] : t.customFields;
                var okFields = stringList(e, fields, 'Feld', 0, LIMITS.listItems, LIMITS.shortText);
                var okCustom = stringList(e, custom, 'Eigenes Feld', 0, LIMITS.listItems, LIMITS.shortText);
                if (!okFields || !okCustom) return;
                if (fields.length + custom.length === 0) {
                    e.push('Profil: Mindestens ein Feld erforderlich.');
                }
                // Die Antworten werden nach Beschriftung gespeichert: Doppelte würden sich überschreiben.
                var seen = new Set();
                fields.map(profileFieldLabel).concat(custom).forEach(function (label) {
                    var key = label.trim().toLowerCase();
                    if (seen.has(key)) e.push('Profil: Das Feld „' + label.trim() + '“ kommt doppelt vor.');
                    seen.add(key);
                });
            }
        },
        {
            type: 'mood', label: 'Barometer', category: 'Mechanik', icon: '🌡️',
            fields: ['labelLeft', 'labelRight'],
            defaults: function () { return { labelLeft: 'Schlecht', labelRight: 'Gut' }; },
            check: function (e, t) {
                optionalText(e, t, 'labelLeft', 'Label links', LIMITS.shortText);
                optionalText(e, t, 'labelRight', 'Label rechts', LIMITS.shortText);
            }
        },
        {
            type: 'bucket', label: 'Bucket Drop', category: 'Mechanik', icon: '🗑️',
            fields: ['buckets', 'items'],
            defaults: function () { return { buckets: ['', ''], items: [] }; },
            check: function (e, t) {
                var okBuckets = stringList(e, t.buckets, 'Korb', LIMITS.bucketsMin, LIMITS.bucketsMax, LIMITS.shortText);
                if (!Array.isArray(t.items) || t.items.length === 0) {
                    e.push('Bucket: Mindestens ein Begriff erforderlich.');
                    return;
                }
                if (t.items.length > LIMITS.listItems) {
                    e.push('Bucket: Höchstens ' + LIMITS.listItems + ' Begriffe erlaubt.');
                    return;
                }
                t.items.forEach(function (item, i) {
                    if (!isPlainObject(item) || !isFilledString(item.text) || item.text.length > LIMITS.shortText) {
                        e.push('Begriff ' + (i + 1) + ' darf nicht leer sein.');
                    } else if (okBuckets && (!Number.isInteger(item.target) || item.target < 0 || item.target >= t.buckets.length)) {
                        e.push('Begriff ' + (i + 1) + ': Der Ziel-Korb existiert nicht.');
                    }
                });
            },
            judge: judgeBucket,
            solution: function () {}
        },
        {
            type: 'ranking', label: 'Ranking', category: 'Mechanik', icon: '🔢',
            fields: ['items'],
            defaults: function () { return { items: ['', ''] }; },
            check: function (e, t) { stringList(e, t.items, 'Element', 2, LIMITS.listItems, LIMITS.shortText); },
            judge: function (t, a) { return Array.isArray(t.items) && sameTextList(a.order, t.items); },
            solution: function () {}
        },
        {
            type: 'pairs', label: 'Paare finden', category: 'Mechanik', icon: '🔗',
            fields: ['pairs'],
            defaults: function () { return { pairs: [{ left: '', right: '' }, { left: '', right: '' }] }; },
            check: function (e, t) {
                if (!Array.isArray(t.pairs) || t.pairs.length < 2) {
                    e.push('Paare: Mindestens 2 Paare erforderlich.');
                    return;
                }
                if (t.pairs.length > LIMITS.listItems) {
                    e.push('Paare: Höchstens ' + LIMITS.listItems + ' Paare erlaubt.');
                    return;
                }
                var seenLeft = {};
                var seenRight = {};
                t.pairs.forEach(function (pair, i) {
                    if (!isPlainObject(pair) || !isFilledString(pair.left) || !isFilledString(pair.right)) {
                        e.push('Paar ' + (i + 1) + ' braucht zwei Texte.');
                        return;
                    }
                    if (pair.left.length > LIMITS.shortText || pair.right.length > LIMITS.shortText) {
                        e.push('Paar ' + (i + 1) + ' ist zu lang.');
                        return;
                    }
                    // Gleiche Texte wuerden die Zuordnung mehrdeutig machen.
                    var left = 'k:' + pair.left.trim();
                    var right = 'k:' + pair.right.trim();
                    if (seenLeft[left] || seenRight[right]) {
                        e.push('Paar ' + (i + 1) + ' ist doppelt; jeder Text darf je Seite nur einmal vorkommen.');
                    }
                    seenLeft[left] = true;
                    seenRight[right] = true;
                });
            },
            judge: judgePairs,
            solution: function () {}
        },
        {
            type: 'cloze', label: 'Lückentext', category: 'Mechanik', icon: '🔤',
            fields: ['text', 'fakes'],
            defaults: function () { return { text: '', fakes: [] }; },
            check: function (e, t) {
                if (!isFilledString(t.text)) {
                    e.push('Lückentext: Der Text fehlt.');
                    return;
                }
                if (t.text.length > LIMITS.longText) {
                    e.push('Lückentext: Der Text ist zu lang.');
                    return;
                }
                var parsed = parseCloze(t.text);
                if (parsed.gaps.length === 0) {
                    e.push('Lückentext: Mindestens eine [Lücke] erforderlich.');
                }
                parsed.gaps.forEach(function (gap, i) {
                    if (!gap) e.push('Lückentext: Lücke ' + (i + 1) + ' ist leer.');
                });
                if (t.fakes !== undefined) stringList(e, t.fakes, 'Falsches Wort', 0, LIMITS.listItems, LIMITS.shortText);
            },
            judge: function (t, a) {
                var gaps = parseCloze(t.text).gaps;
                return gaps.length > 0 && sameTextList(a.gaps, gaps);
            },
            solution: function () {}
        },
        {
            type: 'countdown', label: 'Countdown', category: 'Mechanik', icon: '⏳',
            fields: ['duration'],
            defaults: function () { return { duration: 60 }; },
            check: function (e, t) {
                if (t.duration === undefined) return;
                if (!Number.isInteger(t.duration) || t.duration < 1 || t.duration > LIMITS.countdownMax) {
                    e.push('Countdown: Die Dauer muss zwischen 1 und ' + LIMITS.countdownMax + ' Sekunden liegen.');
                }
            }
        },
        {
            // Erscheint nur auf dem Tablet der Lehrkraft; Teams warten auf ihre Bestätigung.
            type: 'monster', label: 'Monster-Aufgaben', category: 'Spielleitung', icon: '👾',
            fields: ['image'],
            defaults: function () { return { image: '' }; },
            check: function (e, t) {
                if (!isFilledString(t.question)) e.push('Monster-Aufgabe: Der Text fehlt.');
                optionalImage(e, t);
            },
            judge: function (t, a) { return a.confirmed === true; }
        }
    ];

    function requiredImageCheck(errors, task) {
        requiredImage(errors, task);
    }

    var COMMON_FIELDS = ['id', 'type', 'question', 'description', 'code', 'audio'];

    var byType = {};
    DEFINITIONS.forEach(function (def) {
        byType[def.type] = def;
        // Oeffentliche Form jeder Definition: Editor/Student lesen diese Felder.
        def.defaultData = function () {
            return Object.assign({ question: '', description: '' }, def.defaults());
        };
        def.validate = function (task) { return validate(Object.assign({}, task, { type: def.type })); };
    });

    function get(type) {
        return typeof type === 'string' && hasOwn(byType, type) ? byType[type] : null;
    }

    /** Neue Aufgabe mit den Startdaten des Typs. */
    function createTask(type) {
        var def = get(type);
        if (!def) throw new Error('Unbekannter Aufgaben-Typ: ' + type);
        return Object.assign({ type: type }, def.defaultData());
    }

    /** Liefert die Fehler einer Aufgabe als Liste deutscher Texte (leer = gültig). */
    function validate(task) {
        if (!isPlainObject(task)) return ['Die Aufgabe ist ungültig.'];
        var def = get(task.type);
        if (!def) return ['Unbekannter Aufgaben-Typ.'];
        var errors = [];
        optionalText(errors, task, 'question', 'Frage', LIMITS.longText);
        optionalText(errors, task, 'description', 'Beschreibung', LIMITS.longText);
        optionalAudio(errors, task);
        def.check(errors, task);
        return errors;
    }

    /**
     * Ist die Antwort vollstaendig richtig? Boese oder kaputte Antworten werfen nie,
     * sie sind einfach falsch.
     */
    function judge(task, answer) {
        var def = isPlainObject(task) ? get(task.type) : null;
        if (!def || !def.judge || !isPlainObject(answer)) return false;
        try {
            return def.judge(task, answer) === true;
        } catch (err) {
            return false;
        }
    }

    /** Fehlt etwas, um diese Aufgabe als Karte im Brettspiel zu bewerten? Liste deutscher Texte. */
    function solutionErrors(task) {
        if (!isPlainObject(task)) return [];
        var def = get(task.type);
        if (!def || task.type === 'monster') return [];
        if (!def.solution) return ['„' + def.label + '“ kann im Brettspiel nicht bewertet werden.'];
        var errors = [];
        def.solution(errors, task);
        return errors;
    }

    function isMonster(task) {
        return isPlainObject(task) && task.type === 'monster';
    }

    function validateWorld(content, errors) {
        if (WORLD_KEYS.indexOf(content.world) === -1) {
            errors.push({ taskIndex: null, message: 'Bitte wähle die Welt des Kartensets aus.' });
        }
        var monsters = content.tasks.filter(isMonster).length;
        if (monsters !== MONSTERS_PER_WORLD) {
            errors.push({ taskIndex: null, message: 'Ein Kartenset braucht genau ' + MONSTERS_PER_WORLD + ' Monster-Aufgaben.' });
        }
        if (monsters === content.tasks.length) {
            errors.push({ taskIndex: null, message: 'Ein Kartenset braucht mindestens eine Karte.' });
        }
    }

    /** Entfernt alles, was nicht zum Typ gehört (z. B. Reste nach einem Typwechsel). */
    function sanitizeTask(task) {
        if (!isPlainObject(task)) return task;
        var def = get(task.type);
        if (!def) return task;
        var clean = {};
        COMMON_FIELDS.concat(def.fields).forEach(function (key) {
            if (hasOwn(task, key) && task[key] !== undefined) clean[key] = task[key];
        });
        if (hasOwn(clean, 'id') && typeof clean.id !== 'number' && typeof clean.id !== 'string') delete clean.id;
        return clone(clean);
    }

    /** Ergänzt fehlende Stations-Codes. Vorhandene Codes bleiben unverändert. */
    function ensureStationCodes(tasks) {
        var used = new Set();
        tasks.forEach(function (task) {
            if (isPlainObject(task) && isFilledString(task.code)) used.add(task.code.toLowerCase());
        });
        tasks.forEach(function (task) {
            if (!isPlainObject(task) || isFilledString(task.code)) return;
            var code;
            do { code = generateStationCode(); } while (used.has(code));
            used.add(code);
            task.code = code;
        });
        return tasks;
    }

    /**
     * Prüft den Inhalt einer Spielrunde: { templateType, tasks }.
     * Ergebnis: Liste von { taskIndex, message }; taskIndex null betrifft die ganze Spielrunde.
     */
    function validateContent(content) {
        var errors = [];
        if (!isPlainObject(content)) {
            return [{ taskIndex: null, message: 'Der Inhalt der Spielrunde ist ungültig.' }];
        }
        var templateType = content.templateType === undefined ? 'normal' : content.templateType;
        var isWorld = templateType === 'world';
        if (templateType !== 'normal' && templateType !== 'qr' && !isWorld) {
            errors.push({ taskIndex: null, message: 'Unbekannter Modus der Spielrunde.' });
        }
        if (!Array.isArray(content.tasks) || content.tasks.length === 0) {
            errors.push({ taskIndex: null, message: 'Eine Spielrunde braucht mindestens eine Aufgabe.' });
            return errors;
        }
        if (content.tasks.length > LIMITS.tasks) {
            errors.push({ taskIndex: null, message: 'Höchstens ' + LIMITS.tasks + ' Aufgaben erlaubt.' });
            return errors;
        }
        if (isWorld) validateWorld(content, errors);
        var seenCodes = new Set();
        content.tasks.forEach(function (task, index) {
            validate(task).forEach(function (message) {
                errors.push({ taskIndex: index, message: message });
            });
            if (isWorld) {
                // Auch bei kaputten Aufgaben: Der Editor zeigt so alles, was noch fehlt, auf einmal.
                solutionErrors(task).forEach(function (message) {
                    errors.push({ taskIndex: index, message: message });
                });
                // Monster-Aufgaben sind keine Karten und brauchen keinen Code.
                if (isMonster(task)) return;
            } else if (templateType !== 'qr') {
                return;
            }
            if (!isPlainObject(task)) return;
            if (typeof task.code !== 'string' || !STATION_CODE.test(task.code)) {
                errors.push({ taskIndex: index, message: 'Der Stations-Code fehlt oder ist ungültig.' });
                return;
            }
            var key = task.code.toLowerCase();
            if (seenCodes.has(key)) {
                errors.push({ taskIndex: index, message: 'Der Stations-Code kommt mehrfach vor.' });
            }
            seenCodes.add(key);
        });
        return errors;
    }

    /** Anzeigename einer Aufgabe, wie ihn das Lehrkräfte-Dashboard zeigt. */
    function taskTitle(task) {
        if (isPlainObject(task) && isFilledString(task.question)) return task.question;
        var def = isPlainObject(task) ? get(task.type) : null;
        return def ? def.label : 'Aufgabe';
    }

    var categories = [];
    DEFINITIONS.forEach(function (def) {
        if (categories.indexOf(def.category) === -1) categories.push(def.category);
    });

    return {
        list: DEFINITIONS,
        types: DEFINITIONS.map(function (def) { return def.type; }),
        categories: categories,
        limits: LIMITS,
        PROFILE_FIELDS: PROFILE_FIELDS,
        DEFAULT_PASSWORD_RULES: DEFAULT_PASSWORD_RULES,
        get: get,
        createTask: createTask,
        validate: validate,
        validateContent: validateContent,
        sanitizeTask: sanitizeTask,
        ensureStationCodes: ensureStationCodes,
        EDITOR_TYPES: EDITOR_TYPES,
        WORLD_KEYS: WORLD_KEYS,
        MONSTERS_PER_WORLD: MONSTERS_PER_WORLD,
        editorList: function () { return EDITOR_TYPES.map(get); },
        judge: judge,
        solutionErrors: solutionErrors,
        generateStationCode: generateStationCode,
        taskTitle: taskTitle,
        parseCloze: parseCloze,
        evaluatePasswordRules: evaluatePasswordRules
    };
});
