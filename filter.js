const badWords = [
    'arsch', 'arschloch', 'hure', 'hurensohn', 'wichser', 'penis', 'vagina', 'fotze', 'nazi', 'hitler',
    'scheiße', 'scheisse', 'fuck', 'shit', 'pisser', 'schlampe', 'miststück', 'wichsen', 'ficken',
    'idiot', 'depp', 'pimmel', 'nutte', 'huren', 'wichs'
];

function containsBadWords(text) {
    if (!text) return false;
    // Normalize text: remove accents/leetspeak basics if wanted, but keep it simple for now
    const normalized = text.toLowerCase().replace(/[0134578]/g, char => {
        return { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' }[char] || char;
    });

    return badWords.some(word => {
        // Match word as whole or with common suffixes
        const regex = new RegExp(`\\b${word}(e|en|er|es|s)?\\b`, 'i');
        return regex.test(normalized) || regex.test(text.toLowerCase());
    });
}

module.exports = { containsBadWords };
