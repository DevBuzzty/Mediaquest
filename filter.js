const badWords = [
    'arsch', 'arschloch', 'hure', 'hurensohn', 'wichser', 'penis', 'vagina', 'fotze', 'nazi', 'hitler',
    'scheiße', 'scheisse', 'fuck', 'shit', 'pisser', 'schlampe', 'miststück', 'wichsen', 'ficken'
];

function containsBadWords(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    // Use word boundaries to avoid Scunthorpe problem
    return badWords.some(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(lowerText);
    });
}

module.exports = { containsBadWords };
