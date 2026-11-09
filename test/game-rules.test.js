'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GameRules = require('../public/js/shared/game-rules.js');
const TaskTypes = require('../public/js/shared/task-types.js');
const { ROOT_DIR } = require('../src/config');

test('Schritte: alle Ergebnisse bei 6 Gruppen', () => {
    const expected = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 2, 5: 4, 6: 4 };
    for (const [correct, steps] of Object.entries(expected)) {
        assert.equal(GameRules.computeSteps(Number(correct), 6), steps, `${correct} von 6`);
    }
});

test('Schritte: Grenzen sind exklusiv und ohne Rundungsfehler', () => {
    assert.equal(GameRules.computeSteps(4, 5), 2); // genau 80 %
    assert.equal(GameRules.computeSteps(3, 5), 1); // genau 60 %
    assert.equal(GameRules.computeSteps(5, 5), 4);
    assert.equal(GameRules.computeSteps(81, 100), 4);
    assert.equal(GameRules.computeSteps(80, 100), 2);
    assert.equal(GameRules.computeSteps(61, 100), 2);
    assert.equal(GameRules.computeSteps(60, 100), 1);
    assert.equal(GameRules.computeSteps(0, 1), 1);
    assert.equal(GameRules.computeSteps(1, 1), 4);
    assert.equal(GameRules.computeSteps(0, 0), 1);
});

test('Ergebnis enthält Anteil und Schritte', () => {
    assert.deepEqual(GameRules.roundResult(5, 6), { correct: 5, total: 6, percent: 83, steps: 4 });
    assert.deepEqual(GameRules.roundResult(0, 3), { correct: 0, total: 3, percent: 0, steps: 1 });
});

test('Portalfelder je Weltenzahl', () => {
    assert.deepEqual(GameRules.portalFields(5), [3, 6, 10, 13, 19]);
    assert.deepEqual(GameRules.portalFields(4), [3, 6, 13, 19]);
    assert.deepEqual(GameRules.portalFields(3), [6, 13, 19]);
    assert.deepEqual(GameRules.portalFields(2), [6, 19]);
    assert.deepEqual(GameRules.portalFields(1), [13]);
    for (const invalid of [0, 6, -1, 2.5, '__proto__', undefined, null]) {
        assert.deepEqual(GameRules.portalFields(invalid), [], String(invalid));
    }
    GameRules.portalFields(1).push(99);
    assert.deepEqual(GameRules.portalFields(1), [13]);
});

test('planMove: Monster stoppt immer und merkt sich die Restschritte', () => {
    assert.deepEqual(GameRules.planMove({ pos: 5, steps: 4 }), { to: 8, remaining: 1, stoppedAt: 'monster' });
    assert.deepEqual(GameRules.planMove({ pos: 6, steps: 2 }), { to: 8, remaining: 0, stoppedAt: 'monster' });
    assert.deepEqual(GameRules.planMove({ pos: 7, steps: 4 }), { to: 8, remaining: 3, stoppedAt: 'monster' });
    assert.deepEqual(GameRules.planMove({ pos: 23, steps: 4 }), { to: 24, remaining: 3, stoppedAt: 'monster' });
});

test('planMove: Start auf dem Monsterfeld löst es nicht erneut aus', () => {
    assert.deepEqual(GameRules.planMove({ pos: 8, steps: 3 }), { to: 11, remaining: 0, stoppedAt: null });
    assert.deepEqual(GameRules.planMove({ pos: 16, steps: 1 }), { to: 17, remaining: 0, stoppedAt: null });
});

test('planMove: genaue Landung, Überschießen von 25 und Null Schritte', () => {
    assert.deepEqual(GameRules.planMove({ pos: 1, steps: 4 }), { to: 5, remaining: 0, stoppedAt: null });
    assert.deepEqual(GameRules.planMove({ pos: 24, steps: 1 }), { to: 25, remaining: 0, stoppedAt: 'end' });
    assert.deepEqual(GameRules.planMove({ pos: 24, steps: 4 }), { to: 25, remaining: 0, stoppedAt: 'end' });
    assert.deepEqual(GameRules.planMove({ pos: 5, steps: 0 }), { to: 5, remaining: 0, stoppedAt: null });
});

test('planMove: Portal stoppt, Restschritte verfallen, gespielte Portale zählen nicht', () => {
    const portals = [3, 6, 13];
    assert.deepEqual(GameRules.planMove({ pos: 1, steps: 4, stops: { portals } }), { to: 3, remaining: 0, stoppedAt: 'portal' });
    assert.deepEqual(GameRules.planMove({ pos: 11, steps: 2, stops: { portals } }), { to: 13, remaining: 0, stoppedAt: 'portal' });
    assert.deepEqual(GameRules.planMove({ pos: 1, steps: 4, stops: { portals: [6, 13] } }), { to: 5, remaining: 0, stoppedAt: null });
    assert.deepEqual(GameRules.planMove({ pos: 2, steps: 4, stops: { portals: [6, 13] } }), { to: 6, remaining: 0, stoppedAt: 'portal' });
});

test('planMove: Rückkehr aus einer Welt startet hinter dem Portal und löst es nicht aus', () => {
    assert.deepEqual(GameRules.planMove({ pos: 13, steps: 4, stops: { portals: [6, 19] } }), { to: 16, remaining: 1, stoppedAt: 'monster' });
    assert.deepEqual(GameRules.planMove({ pos: 13, steps: 2, stops: { portals: [] } }), { to: 15, remaining: 0, stoppedAt: null });
});

test('Monster-Beschriftung: nur das dritte Monster des Hauptbretts ist der Endboss', () => {
    assert.equal(GameRules.monsterLabel('haupt', 0), 'Monster 1');
    assert.equal(GameRules.monsterLabel('haupt', 1), 'Monster 2');
    assert.equal(GameRules.monsterLabel('haupt', 2), 'Endboss');
    assert.equal(GameRules.monsterLabel('news', 2), 'Monster 3');
    assert.equal(GameRules.monsterIndex(8), 0);
    assert.equal(GameRules.monsterIndex(24), 2);
    assert.equal(GameRules.monsterIndex(9), -1);
});

test('Meldungstexte nennen Welt und Kartenset', () => {
    assert.equal(GameRules.continueMessage(3), 'Du darfst noch 3 Schritte gehen.');
    assert.equal(GameRules.continueMessage(1), 'Du darfst noch 1 Schritt gehen.');
    const portal = GameRules.portalMessage('news', 'Mein Set');
    assert.match(portal, /News Arena/);
    assert.match(portal, /Mein Set/);
    assert.match(portal, /Weltenbrett/);
    assert.match(GameRules.worldDoneMessage('news', 13), /News Arena/);
});

test('Welten: Katalog, Farben und Bilder', () => {
    assert.deepEqual(TaskTypes.WORLD_KEYS, Object.keys(GameRules.WORLDS));
    assert.equal(GameRules.WORLDS.daten.name, 'Datenhöhle');
    assert.equal(GameRules.WORLDS.haupt.monsterImage, null);
    assert.deepEqual(GameRules.WORLD_KEYS, ['news', 'dschungel', 'daten', 'ki', 'strand']);
    for (const world of Object.values(GameRules.WORLDS)) {
        for (const key of ['bg', 'surface', 'surface2', 'accent', 'accent2', 'text']) {
            assert.match(world.colors[key], /^#[0-9A-Fa-f]{6}$/, `${world.key}.${key}`);
        }
        if (world.monsterImage) {
            assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public', world.monsterImage)), world.monsterImage);
            assert.deepEqual(TaskTypes.validate({ type: 'monster', question: 'x', image: world.monsterImage }), []);
        }
    }
    assert.equal(GameRules.WORLDS.news.colors.text, '#182247');
    const news = GameRules.WORLDS.news.colors;
    assert.notEqual(GameRules.readableText(news.bg, news.text), news.text);
});

test('Lesbarer Text erreicht auf jeder Weltfarbe mindestens 4.5:1', () => {
    for (const world of Object.values(GameRules.WORLDS)) {
        for (const name of ['bg', 'surface', 'surface2', 'accent', 'accent2']) {
            const background = world.colors[name];
            const text = GameRules.readableText(background, world.colors.text);
            assert.ok(GameRules.contrast(background, text) >= 4.5, `${world.key}.${name}: ${text} auf ${background}`);
        }
    }
});

test('game-rules läuft als klassisches Browser-Skript', () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/shared/game-rules.js'), 'utf8');
    const window = {};
    vm.runInNewContext(source, { window });
    assert.equal(window.GameRules.BOARD_FIELDS, 25);
    assert.deepEqual(Array.from(window.GameRules.MONSTER_FIELDS), [8, 16, 24]);
    assert.equal(window.GameRules.PORTAL_ALWAYS_STOPS, true);
});
