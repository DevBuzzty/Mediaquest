/* logic.js: reine Spiel-Logik ohne DOM, damit sie ohne Browser prüfbar bleibt. */

export function shuffle(list, random = Math.random) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** Mischt und stellt sicher, dass nicht die Ausgangsreihenfolge (die Lösung) herauskommt. */
export function shuffleAway(list, random = Math.random) {
    const differs = (order) => order.some((entry, i) => entry !== list[i]);
    let order = shuffle(list, random);
    for (let attempt = 0; attempt < 20 && !differs(order); attempt += 1) order = shuffle(list, random);
    if (!differs(order) && list.length > 1) order = [...list.slice(1), list[0]];
    return order;
}

export function swap(list, a, b) {
    const copy = [...list];
    [copy[a], copy[b]] = [copy[b], copy[a]];
    return copy;
}

/** Tippen statt Ziehen beim Lückentext. Ein ersetztes Wort geht zurück in den Vorrat. */
export function createClozeModel(gaps, fakes = [], random = Math.random) {
    const chips = shuffle([...gaps, ...fakes].map((word, id) => ({ id, word })), random);
    const slots = gaps.map(() => null);
    let selected = null;

    const inUse = (id) => slots.includes(id);
    const wordOf = (id) => {
        const chip = chips.find((candidate) => candidate.id === id);
        return chip ? chip.word : null;
    };

    return {
        get selected() { return selected; },
        get complete() { return slots.every((slot) => slot !== null); },
        get answer() { return slots.map(wordOf); },
        available: () => chips.filter((chip) => !inUse(chip.id)),
        slotWord: (index) => (slots[index] === null ? null : wordOf(slots[index])),
        tapChip(id) {
            if (inUse(id)) return;
            selected = selected === id ? null : id;
        },
        tapGap(index) {
            if (selected !== null) {
                slots[index] = selected;
                selected = null;
            } else if (slots[index] !== null) {
                slots[index] = null;
            }
        }
    };
}

/** Tippen statt Ziehen beim Korb-Spiel. */
export function createBucketModel(items) {
    let selected = null;
    const placed = items.map(() => null);

    return {
        get selected() { return selected; },
        get complete() { return placed.every((bucket) => bucket !== null); },
        isPlaced: (index) => placed[index] !== null,
        placedIn: (bucket) => items.map((item, index) => ({ item, index })).filter(({ index }) => placed[index] === bucket),
        tapItem(index) {
            if (placed[index] !== null) return;
            selected = selected === index ? null : index;
        },
        tapBucket(bucket) {
            if (selected === null) return false;
            placed[selected] = bucket;
            selected = null;
            return true;
        },
        placements: (bucketLabels) => items.map((item, index) => ({ item: item.text, bucket: bucketLabels[placed[index]] }))
    };
}

/**
 * Paare finden im Brettspiel: Die Gruppe verbindet frei, nichts wird geprüft. Ein verbundenes Element
 * antippen löst das Paar wieder; mit einer Auswahl auf der anderen Seite wird es neu verbunden.
 */
export function createPairAssignModel(count) {
    let selected = null;
    const links = new Map();    // Index links -> Index rechts

    function linkOf(side, index) {
        if (side === 'left') return links.has(index) ? index : null;
        for (const [left, right] of links) {
            if (right === index) return left;
        }
        return null;
    }

    function unlink(side, index) {
        const left = linkOf(side, index);
        if (left !== null) links.delete(left);
    }

    const isSelected = (side, index) => Boolean(selected) && selected.side === side && selected.index === index;

    return {
        get complete() { return count > 0 && links.size === count; },
        isSelected,
        linkOf,
        links: () => [...links],
        tap(side, index) {
            if (selected && selected.side !== side) {
                const other = selected;
                selected = null;
                unlink(other.side, other.index);
                unlink(side, index);
                if (side === 'left') links.set(index, other.index);
                else links.set(other.index, index);
                return;
            }
            const wasSelected = isSelected(side, index);
            unlink(side, index);
            selected = wasSelected ? null : { side, index };
        }
    };
}

/** Paare finden: Die Reihenfolge der Seiten ist egal, verglichen wird das Paar selbst. */
export function createPairsModel(count) {
    let selected = null;
    const matched = new Set();

    return {
        get selected() { return selected; },
        get matchedCount() { return matched.size; },
        get complete() { return matched.size === count; },
        isMatched: (pair) => matched.has(pair),
        tap(side, pair) {
            if (matched.has(pair)) return { result: 'ignored' };
            if (!selected || selected.side === side) {
                selected = { side, pair };
                return { result: 'selected' };
            }
            const first = selected;
            selected = null;
            if (first.pair === pair) {
                matched.add(pair);
                return { result: 'match', pair };
            }
            return { result: 'mismatch' };
        }
    };
}
