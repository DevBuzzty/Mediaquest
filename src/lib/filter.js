'use strict';

const BAD_WORDS = [
    'arsch', 'arschloch', 'hure', 'hurensohn', 'wichser', 'penis', 'vagina', 'fotze', 'nazi', 'hitler',
    'scheiße', 'fuck', 'shit', 'pisser', 'schlampe', 'miststück', 'wichsen', 'ficken',
    'idiot', 'depp', 'pimmel', 'nutte', 'huren', 'wichs'
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };

// Vereinheitlicht Umlaute und ß, damit "Scheiße" und "Scheisse" gleich zählen.
function transliterate(text) {
    return text
        .replace(/ß/g, 'ss')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue');
}

const WORD_PATTERN = [...new Set(BAD_WORDS.map(transliterate))].join('|');

// JS-\b kennt nur ASCII und findet nach "ß" keine Wortgrenze; deshalb Unicode-Lookarounds.
const MATCHER = new RegExp(`(?<![\\p{L}\\p{N}])(?:${WORD_PATTERN})(?:e|en|er|es|s)?(?![\\p{L}\\p{N}])`, 'u');

const INVISIBLE_CHARS = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** Entfernt Zeichen ohne sichtbare Form (z. B. U+200B). */
function stripInvisible(text) {
    return text.replace(INVISIBLE_CHARS, '');
}

function containsBadWords(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    const plain = transliterate(stripInvisible(text).normalize('NFC').toLowerCase());
    const deLeeted = plain.replace(/[0134578]/g, (digit) => LEET[digit]);
    return MATCHER.test(plain) || MATCHER.test(deLeeted);
}

module.exports = { containsBadWords, stripInvisible };
