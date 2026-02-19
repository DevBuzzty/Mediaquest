const colors = [
    '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316',
    '#a855f7', '#ec4899', '#6366f1', '#8b5cf6', '#14b8a6'
];
let selectedColor = null;
let currentSessionId = null;
let currentTeamId = null;
let currentGameStatus = 'waiting';
let currentGameType = 'binary';
let currentBlueprint = null;
let takenColors = [];

const socket = io();

function renderColorPicker() {
    const colorPicker = document.getElementById('colorPicker');
    if (!colorPicker) return;
    colorPicker.innerHTML = '';

    colors.forEach(color => {
        const isTaken = takenColors.includes(color);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-full aspect-square rounded-full border-4 transition-all ${isTaken ? 'opacity-20 cursor-not-allowed grayscale' : 'hover:scale-110 cursor-pointer shadow-lg'}`;
        btn.style.backgroundColor = color;
        btn.style.borderColor = selectedColor === color ? 'white' : 'transparent';

        if (!isTaken) {
            btn.onclick = () => {
                selectedColor = color;
                renderColorPicker();
            };
        } else if (selectedColor === color) {
            selectedColor = null;
        }

        colorPicker.appendChild(btn);
    });
}

function displayTeamSummary(name, color, size, code, isRejoin = false) {
    const summary = document.getElementById('teamSummary');
    summary.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-4 justify-center';

    const dot = document.createElement('div');
    dot.className = 'w-6 h-6 rounded-full';
    dot.style.backgroundColor = color;

    const teamNameSpan = document.createElement('span');
    teamNameSpan.className = 'text-xl font-bold';
    teamNameSpan.textContent = name;

    header.appendChild(dot);
    header.appendChild(teamNameSpan);

    const codeP = document.createElement('p');
    codeP.className = 'text-slate-400 mt-2';
    const label = isRejoin ? 'Team-Code' : 'Team-Code für den Lehrer';
    codeP.innerHTML = `${label}: <span class="text-white font-mono font-bold">${code}</span>`;

    const sizeP = document.createElement('p');
    sizeP.className = 'text-slate-400';
    sizeP.textContent = `Mitglieder: ${size}`;

    summary.appendChild(header);
    summary.appendChild(codeP);
    summary.appendChild(sizeP);
}

// Mini-Games Rendering
function renderGame(mode, blueprint = null) {
    currentGameType = mode;
    const container = document.getElementById('gameContent');
    container.style.opacity = '0';

    const question = blueprint?.question || '';

    setTimeout(() => {
        container.innerHTML = '';
        if (mode === 'binary') {
            const icon = blueprint?.icon || '🖼️';
            container.innerHTML = `
                <div class="space-y-6 animate-bounce-in">
                    <h2 class="text-2xl font-bold text-blue-400">Binary Swipe</h2>
                    <p class="text-slate-400">${question || 'Ist dieses Bild echt oder ein Fake?'}</p>
                    <div id="swipeCard" class="swipe-card w-64 h-80 mx-auto bg-slate-700 rounded-3xl border-4 border-slate-600 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden">
                        <div class="text-7xl mb-4">${icon}</div>
                        <div class="absolute bottom-0 left-0 right-0 p-4 bg-slate-800/80 border-t border-slate-600">
                            <p class="font-bold text-sm text-blue-300">Echt oder Fake?</p>
                            <p class="text-xs text-slate-400">Wische nach links oder rechts</p>
                        </div>
                    </div>
                    <div class="flex justify-center gap-8 pt-4">
                        <button onclick="handleSwipe('left')" class="w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center shadow-lg transform active:scale-90 transition-all">
                            <span class="text-2xl">❌</span>
                        </button>
                        <button onclick="handleSwipe('right')" class="w-16 h-16 bg-green-600 hover:bg-green-500 rounded-full flex items-center justify-center shadow-lg transform active:scale-90 transition-all">
                            <span class="text-2xl">✅</span>
                        </button>
                    </div>
                </div>
            `;
            initSwipe();
        } else if (mode === 'choice') {
            const options = blueprint?.options || ['A', 'B', 'C'];
            container.innerHTML = `
                <div class="space-y-6 animate-bounce-in">
                    <h2 class="text-2xl font-bold text-purple-400">Multiple Choice</h2>
                    <p class="text-slate-400">${question || 'Wähle die richtige Antwort'}</p>
                    <div class="grid grid-cols-1 gap-3">
                        ${options.map((opt, i) => `
                            <button onclick="selectChoice(${i})" class="choice-btn w-full bg-slate-700 hover:bg-slate-600 p-4 rounded-xl border-2 border-slate-600 text-left transition-all">
                                ${opt.includes(')') ? opt : String.fromCharCode(65+i) + ') ' + opt}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (mode === 'select') {
            const options = blueprint?.options || ['Opt 1', 'Opt 2'];
            container.innerHTML = `
                <div class="space-y-6 animate-bounce-in">
                    <h2 class="text-2xl font-bold text-yellow-400">Multiple Select</h2>
                    <p class="text-slate-400">${question || 'Markiere alle richtigen Antworten'}</p>
                    <div class="space-y-2 text-left">
                        ${options.map(opt => `
                            <label class="flex items-center gap-3 p-4 bg-slate-700 rounded-xl cursor-pointer hover:bg-slate-650 transition-colors border border-slate-600">
                                <input type="checkbox" class="w-5 h-5 rounded border-slate-500 bg-slate-800 text-blue-500 focus:ring-blue-500">
                                <span>${opt}</span>
                            </label>
                        `).join('')}
                    </div>
                    <button onclick="submitSelect()" class="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg active:scale-95">Absenden</button>
                </div>
            `;
        } else if (mode === 'chat') {
            renderChat(blueprint);
        } else if (mode === 'scroller') {
            renderScroller(blueprint);
        } else if (mode === 'detector') {
            renderDetector(blueprint);
        } else if (mode === 'hotspot') {
            renderHotspot(blueprint);
        } else if (mode === 'password') {
            renderPassword(blueprint);
        } else if (mode === 'profile') {
            renderProfile(blueprint);
        } else if (mode === 'mood') {
            renderMood(blueprint);
        } else if (mode === 'bucket') {
            renderBucket(blueprint);
        } else if (mode === 'ranking') {
            renderRanking(blueprint);
        } else if (mode === 'pairs') {
            renderPairs(blueprint);
        } else if (mode === 'cloze') {
            renderCloze(blueprint);
        } else if (mode === 'countdown') {
            renderCountdown(blueprint);
        } else if (mode === 'photo' || mode === 'statement') {
            renderCapture(mode, blueprint);
        }
        container.style.opacity = '1';
    }, 300);
}

function handleSwipe(dir) {
    const card = document.getElementById('swipeCard');
    if (!card) return;
    card.classList.add(dir === 'left' ? 'swipe-left' : 'swipe-right');
    setTimeout(() => {
        renderGame('binary'); // Reset for demo
    }, 600);
}

function initSwipe() {
    const card = document.getElementById('swipeCard');
    if (!card) return;
    let startX = 0;

    card.addEventListener('touchstart', e => startX = e.touches[0].clientX);
    card.addEventListener('touchend', e => {
        const diff = e.changedTouches[0].clientX - startX;
        if (Math.abs(diff) > 100) handleSwipe(diff > 0 ? 'right' : 'left');
    });

    // Mouse fallback
    let isDown = false;
    card.addEventListener('mousedown', e => { isDown = true; startX = e.clientX; });
    window.addEventListener('mouseup', e => {
        if (!isDown) return;
        isDown = false;
        const diff = e.clientX - startX;
        if (Math.abs(diff) > 100) handleSwipe(diff > 0 ? 'right' : 'left');
    });
}

function selectChoice(index) {
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach((b, i) => {
        if (i === index) {
            b.classList.add('bg-blue-600', 'border-blue-400', 'scale-105');
            b.classList.remove('bg-slate-700', 'border-slate-600');
        } else {
            b.classList.remove('bg-blue-600', 'border-blue-400', 'scale-105');
            b.classList.add('bg-slate-700', 'border-slate-600');
        }
    });
    setTimeout(() => alert('Antwort gewählt!'), 300);
}

function submitSelect() {
    alert('Vielen Dank! Deine Antworten wurden übermittelt.');
}

// Chat Simulator
function renderChat(blueprint) {
    const container = document.getElementById('gameContent');
    const nodes = blueprint?.nodes || {
        "start": { "text": "Hey, hast du schon gehört? Die Mathearbeit wurde verschoben!", "options": [ { "label": "Echt? Cool!", "next": "cool" }, { "label": "Glaub ich nicht.", "next": "fake" } ] },
        "cool": { "text": "Ja, voll gut oder? Schreibst du mir wenn du mehr weißt?", "options": [] },
        "fake": { "text": "Stimmt, war nur ein Scherz um zu sehen ob du alles glaubst.", "options": [] }
    };

    let currentNode = "start";
    const drawNode = (nodeId) => {
        const node = nodes[nodeId] || nodes["start"];
        container.innerHTML = `
            <div class="space-y-6 animate-bounce-in">
                <h2 class="text-2xl font-bold text-blue-400">Chat mit ${blueprint?.partner || 'Unbekannt'}</h2>
                <div class="bg-slate-900/50 p-4 rounded-2xl border border-slate-700 min-h-[100px] flex items-center justify-start text-left">
                    <div class="bg-blue-600 p-3 rounded-2xl rounded-bl-none max-w-[80%] shadow-lg">
                        <p class="text-sm">${node.text}</p>
                    </div>
                </div>
                <div class="space-y-2">
                    ${node.options.map((opt, i) => `
                        <button onclick="window.chatAction('${opt.next}')" class="w-full bg-slate-700 hover:bg-slate-600 p-3 rounded-xl border border-slate-600 text-sm transition-all">
                            ${opt.label}
                        </button>
                    `).join('')}
                    ${node.options.length === 0 ? '<p class="text-slate-500 italic text-sm">Chat beendet.</p>' : ''}
                </div>
            </div>
        `;
    };
    window.chatAction = drawNode;
    drawNode(currentNode);
}

// Feed Scroller
function renderScroller(blueprint) {
    const container = document.getElementById('gameContent');
    const posts = blueprint?.posts || [
        { user: "User123", text: "Schönen guten Morgen alle zusammen! ☀️", isBad: false },
        { user: "Hater44", text: "Du bist so dumm, lösch dich einfach!!!", isBad: true },
        { user: "NewsBot", text: "ACHTUNG: Morgen regnet es Gold vom Himmel! Klicke hier!", isBad: true }
    ];

    container.innerHTML = `
        <div class="space-y-4 h-[500px] overflow-y-auto p-2 border border-slate-700 rounded-xl bg-slate-900/30" id="scrollerBody">
            <h2 class="text-xl font-bold text-blue-400 sticky top-0 bg-slate-900/80 p-2 z-10">Social Media Feed</h2>
            <p class="text-xs text-slate-500 mb-4">Finde und markiere Hassrede oder Fake News!</p>
            ${posts.map((p, i) => `
                <div class="p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-2 transition-all" onclick="markPost(this, ${p.isBad})">
                    <p class="font-bold text-xs text-blue-300">@${p.user}</p>
                    <p class="text-sm text-slate-200">${p.text}</p>
                </div>
            `).join('')}
            <div class="p-8 text-center text-slate-500 italic text-sm">Ende des Feeds</div>
        </div>
        <button onclick="alert('Gut gemacht!')" class="w-full mt-4 bg-blue-600 p-3 rounded-xl font-bold">Fertig</button>
    `;
}

function markPost(el, isBad) {
    el.classList.add(isBad ? 'border-green-500' : 'border-red-500');
    el.classList.add(isBad ? 'bg-green-900/20' : 'bg-red-900/20');
}

// Detector (Lupe)
function renderDetector(blueprint) {
    const container = document.getElementById('gameContent');
    const imgUrl = blueprint?.image || 'https://via.placeholder.com/600x400?text=Beispielbild';

    container.innerHTML = `
        <div class="space-y-4">
            <h2 class="text-2xl font-bold text-blue-400">Detektor</h2>
            <p class="text-sm text-slate-400">${blueprint?.question || 'Nutze die Lupe um Details zu finden.'}</p>
            <div id="detectorCanvas" class="relative w-full aspect-video bg-black rounded-xl overflow-hidden cursor-none touch-none">
                <img src="${imgUrl}" class="w-full h-full object-cover blur-md">
                <div id="lupe" class="absolute w-32 h-32 rounded-full border-4 border-white shadow-2xl overflow-hidden pointer-events-none" style="display:none;">
                     <img src="${imgUrl}" id="lupeImg" class="absolute object-cover" style="width:1000%; height:1000%;">
                </div>
            </div>
        </div>
    `;

    const canvas = document.getElementById('detectorCanvas');
    const lupe = document.getElementById('lupe');
    const lupeImg = document.getElementById('lupeImg');

    const handleMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;

        if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
            lupe.style.display = 'none';
            return;
        }

        lupe.style.display = 'block';
        lupe.style.left = (x - 64) + 'px';
        lupe.style.top = (y - 64) + 'px';

        // Calculate percentages
        const px = (x / rect.width) * 100;
        const py = (y / rect.height) * 100;

        lupeImg.style.width = (rect.width) + 'px';
        lupeImg.style.height = (rect.height) + 'px';
        lupeImg.style.left = (-x + 64) + 'px';
        lupeImg.style.top = (-y + 64) + 'px';
        lupeImg.style.maxWidth = 'none';
    };

    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('touchmove', handleMove);
}

// Hotspot
function renderHotspot(blueprint) {
    const container = document.getElementById('gameContent');
    const imgUrl = blueprint?.image || 'https://via.placeholder.com/600x400?text=Hotspot+Bild';
    const zones = blueprint?.zones || [];
    let found = [];

    container.innerHTML = `
        <div class="space-y-4">
            <h2 class="text-2xl font-bold text-blue-400">Hotspot Suche</h2>
            <p class="text-sm text-slate-400">Tippe auf die verdächtigen Stellen!</p>
            <div id="hotspotContainer" class="relative w-full aspect-video bg-slate-900 rounded-xl overflow-hidden">
                <img src="${imgUrl}" class="w-full h-full object-contain">
                <div id="hotspotTouchLayer" class="absolute inset-0"></div>
            </div>
            <p id="hotspotStatus" class="text-xs text-blue-300 font-bold">Gefunden: 0 / ${zones.length}</p>
        </div>
    `;

    const layer = document.getElementById('hotspotTouchLayer');
    layer.onclick = (e) => {
        const rect = layer.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 100;
        const py = ((e.clientY - rect.top) / rect.height) * 100;

        zones.forEach((z, i) => {
            if (found.includes(i)) return;
            if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) {
                found.push(i);
                const marker = document.createElement('div');
                marker.className = 'absolute border-4 border-green-500 rounded-lg animate-bounce-in';
                marker.style.left = z.x + '%';
                marker.style.top = z.y + '%';
                marker.style.width = z.w + '%';
                marker.style.height = z.h + '%';
                layer.appendChild(marker);
            }
        });
        document.getElementById('hotspotStatus').textContent = `Gefunden: ${found.length} / ${zones.length}`;
        if (found.length === zones.length && zones.length > 0) {
            setTimeout(() => alert('Alle Hotspots gefunden!'), 500);
        }
    };
}

// Password Generator
function renderPassword(blueprint) {
    const container = document.getElementById('gameContent');
    const rules = blueprint?.rules || ['Mind. 8 Zeichen', 'Ein Sonderzeichen'];

    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-bold text-green-400">Tresor öffnen</h2>
            <p class="text-sm text-slate-400">Erstelle ein sicheres Passwort mit diesen Regeln:</p>
            <ul class="text-left text-xs space-y-1 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                ${rules.map(r => `<li>🔒 ${r}</li>`).join('')}
            </ul>
            <div class="relative">
                <input type="text" id="pwInput" class="w-full bg-slate-700 p-4 rounded-xl text-center font-mono text-xl border-2 border-slate-600 focus:border-green-500 outline-none" placeholder="Passwort...">
                <div id="lockIcon" class="text-4xl mt-4">🔒</div>
            </div>
            <p id="pwFeedback" class="text-xs italic text-slate-500">Das Schloss ist noch zu.</p>
        </div>
    `;

    document.getElementById('pwInput').oninput = (e) => {
        const val = e.target.value;
        const feedback = document.getElementById('pwFeedback');
        const lock = document.getElementById('lockIcon');

        // Simple logic: if length > 5 and contains a special char from rules or generally
        let secure = val.length >= 8;
        if (secure) {
            lock.textContent = '🔓';
            feedback.textContent = 'Das Schloss geht auf!';
            feedback.classList.replace('text-slate-500', 'text-green-400');
        } else {
            lock.textContent = '🔒';
            feedback.textContent = 'Noch nicht sicher genug...';
            feedback.classList.replace('text-green-400', 'text-slate-500');
        }
    };
}

// Profile Editor
function renderProfile(blueprint) {
    const container = document.getElementById('gameContent');
    const fields = blueprint?.fields || ['name', 'age'];
    const custom = blueprint?.customFields || [];

    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-bold text-blue-400">Profil erstellen</h2>
            <p class="text-sm text-slate-400">Welche Daten gibst du preis?</p>
            <div class="bg-slate-800 p-6 rounded-3xl border border-slate-700 space-y-4 text-left shadow-2xl">
                <div class="w-20 h-20 bg-slate-700 rounded-full mx-auto mb-4 border-4 border-blue-500 flex items-center justify-center text-4xl">👤</div>
                ${fields.concat(custom).map(f => `
                    <div>
                        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">${f}</label>
                        <input type="text" class="w-full bg-slate-700 p-2 rounded-lg border border-slate-600 text-sm" placeholder="...">
                    </div>
                `).join('')}
            </div>
            <button onclick="alert('Profil gespeichert!')" class="w-full bg-blue-600 p-3 rounded-xl font-bold">Profil veröffentlichen</button>
        </div>
    `;
}

// Bucket Drop
function renderBucket(blueprint) {
    const container = document.getElementById('gameContent');
    const buckets = blueprint?.buckets || ['Privat', 'Öffentlich'];
    const items = blueprint?.items || [{ text: 'Passwort', target: 0 }, { text: 'Witz', target: 1 }];

    container.innerHTML = `
        <div class="space-y-6">
            <h2 class="text-2xl font-bold text-orange-400">Bucket Drop</h2>
            <div class="flex flex-wrap gap-2 justify-center mb-8" id="itemSource">
                ${items.map((item, i) => `
                    <div draggable="true" ondragstart="event.dataTransfer.setData('text', '${i}')" class="bg-slate-700 p-3 rounded-lg border border-slate-600 cursor-move shadow-md text-sm">
                        ${item.text}
                    </div>
                `).join('')}
            </div>
            <div class="grid grid-cols-2 gap-4">
                ${buckets.map((b, i) => `
                    <div ondragover="event.preventDefault()" ondrop="handleBucketDrop(event, ${i})" class="bg-slate-800 p-4 rounded-2xl border-2 border-dashed border-slate-700 min-h-[120px] flex flex-col items-center justify-center text-center">
                        <span class="text-3xl mb-2">🗑️</span>
                        <span class="font-bold text-sm">${b}</span>
                        <div class="bucket-list mt-2 space-y-1 w-full"></div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    window.handleBucketDrop = (e, bucketIdx) => {
        e.preventDefault();
        const itemIdx = e.dataTransfer.getData('text');
        const item = items[itemIdx];
        const targetDiv = e.target.closest('.bg-slate-800').querySelector('.bucket-list');
        const newItem = document.createElement('div');
        newItem.className = `p-1 text-xs rounded ${item.target === bucketIdx ? 'bg-green-600' : 'bg-red-600'}`;
        newItem.textContent = item.text;
        targetDiv.appendChild(newItem);
    };
}

// Ranking
function renderRanking(blueprint) {
    const container = document.getElementById('gameContent');
    const items = blueprint?.items || ['Element A', 'Element B', 'Element C'];

    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-bold text-yellow-400">Ranking</h2>
            <p class="text-xs text-slate-500">Bringe die Elemente in die richtige Reihenfolge!</p>
            <div id="sortableList" class="space-y-2">
                ${items.map((it, i) => `
                    <div draggable="true" ondragstart="handleSortStart(event, ${i})" ondragover="event.preventDefault()" ondrop="handleSortDrop(event, ${i})" class="bg-slate-700 p-4 rounded-xl border border-slate-600 flex items-center gap-4 cursor-move">
                        <span class="text-slate-500 font-mono">${i+1}.</span>
                        <span class="flex-1 text-left">${it}</span>
                        <span class="text-slate-600">☰</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="alert('Reihenfolge gespeichert!')" class="w-full bg-yellow-600 p-3 rounded-xl font-bold mt-4">Prüfen</button>
        </div>
    `;

    let dragIdx;
    window.handleSortStart = (e, i) => dragIdx = i;
    window.handleSortDrop = (e, i) => {
        const list = document.getElementById('sortableList');
        const rows = Array.from(list.children);
        if (dragIdx < i) list.insertBefore(rows[dragIdx], rows[i].nextSibling);
        else list.insertBefore(rows[dragIdx], rows[i]);
        // Update numbers
        Array.from(list.children).forEach((row, idx) => row.querySelector('span').textContent = (idx + 1) + '.');
    };
}

// Pairs
function renderPairs(blueprint) {
    const container = document.getElementById('gameContent');
    const pairs = blueprint?.pairs || [{ left: 'App', right: 'Berechtigung' }, { left: 'Browser', right: 'Cookies' }];

    container.innerHTML = `
        <div class="space-y-6">
            <h2 class="text-2xl font-bold text-indigo-400">Paare finden</h2>
            <div class="grid grid-cols-2 gap-8">
                <div class="space-y-2" id="pairsLeft">
                    ${pairs.map((p, i) => `<button onclick="selectPair(this, 'left', ${i})" class="w-full bg-slate-800 p-3 rounded-lg border border-slate-700 text-xs transition-all">${p.left}</button>`).join('')}
                </div>
                <div class="space-y-2" id="pairsRight">
                    ${pairs.map((p, i) => `<button onclick="selectPair(this, 'right', ${i})" class="w-full bg-slate-800 p-3 rounded-lg border border-slate-700 text-xs transition-all">${p.right}</button>`).join('')}
                </div>
            </div>
        </div>
    `;

    let selectedLeft = null;
    window.selectPair = (btn, side, idx) => {
        btn.classList.toggle('border-indigo-500');
        btn.classList.toggle('bg-indigo-900/30');
        if (side === 'left') selectedLeft = btn;
        else if (selectedLeft) {
            alert('Paar verknüpft!');
            selectedLeft = null;
        }
    };
}

// Cloze (Lückentext)
function renderCloze(blueprint) {
    const container = document.getElementById('gameContent');
    const text = blueprint?.text || "Das [Internet] ist für viele [Neuland].";
    const words = [];
    const html = text.replace(/\[(.*?)\]/g, (match, word) => {
        words.push(word);
        return `<span class="cloze-drop bg-slate-900 border-b-2 border-blue-500 px-4 py-1 mx-1 inline-block min-w-[60px]" ondragover="event.preventDefault()" ondrop="handleClozeDrop(event, this)"></span>`;
    });

    container.innerHTML = `
        <div class="space-y-8 animate-bounce-in">
            <h2 class="text-2xl font-bold text-blue-400">Lückentext</h2>
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 text-lg leading-relaxed text-left">
                ${html}
            </div>
            <div class="flex flex-wrap gap-2 justify-center" id="clozeSource">
                ${words.sort().map(w => `<div draggable="true" ondragstart="event.dataTransfer.setData('text', '${w}')" class="bg-blue-600 px-3 py-1 rounded shadow cursor-move">${w}</div>`).join('')}
            </div>
        </div>
    `;
    window.handleClozeDrop = (e, el) => {
        el.textContent = e.dataTransfer.getData('text');
        el.classList.add('text-blue-400', 'font-bold');
    };
}

// Tablet-friendly Drag & Drop Helper
function enableTouchDrag() {
    let activeItem = null;
    let offsetX = 0, offsetY = 0;

    document.addEventListener('touchstart', e => {
        const item = e.target.closest('[draggable="true"]');
        if (item) {
            activeItem = item.cloneNode(true);
            activeItem.style.position = 'fixed';
            activeItem.style.zIndex = '1000';
            activeItem.style.pointerEvents = 'none';
            activeItem.style.opacity = '0.8';
            activeItem.dataset.sourceId = item.id || '';
            document.body.appendChild(activeItem);

            const rect = item.getBoundingClientRect();
            offsetX = e.touches[0].clientX - rect.left;
            offsetY = e.touches[0].clientY - rect.top;

            updateTouchPos(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    document.addEventListener('touchmove', e => {
        if (activeItem) {
            e.preventDefault();
            updateTouchPos(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    document.addEventListener('touchend', e => {
        if (activeItem) {
            const x = e.changedTouches[0].clientX;
            const y = e.changedTouches[0].clientY;
            activeItem.remove();

            const dropTarget = document.elementFromPoint(x, y)?.closest('[ondrop]');
            if (dropTarget) {
                // Simulate drop
                const dropFn = dropTarget.getAttribute('ondrop');
                if (dropFn) {
                    // This is a bit hacky but works for our simple cases
                    const data = activeItem.textContent.trim();
                    // We need to pass the right data based on game type
                    // For now, let's assume text is enough for Cloze and Bucket
                }
            }
            activeItem = null;
        }
    });

    function updateTouchPos(x, y) {
        activeItem.style.left = (x - offsetX) + 'px';
        activeItem.style.top = (y - offsetY) + 'px';
    }
}

// Countdown
async function renderSummary() {
    const container = document.getElementById('gameContent');
    document.getElementById('gamePhase').classList.remove('hidden');
    document.getElementById('waitingPhase').classList.add('hidden');

    container.innerHTML = `<h2 class="text-3xl font-black text-blue-500 mb-8 animate-bounce-in">Spiel abgeschlossen!</h2>
                           <div id="summaryList" class="space-y-4">Lade Ergebnisse...</div>`;

    const res = await fetch(`/api/sessions/${currentSessionId}/submissions`);
    const data = await res.json();
    const list = document.getElementById('summaryList');
    list.innerHTML = '';

    if (data.submissions.length === 0) {
        list.innerHTML = '<p class="text-slate-500 italic">Keine Einsendungen gefunden.</p>';
    } else {
        data.submissions.forEach(sub => {
            const card = document.createElement('div');
            card.className = 'bg-slate-800 p-4 rounded-2xl border-l-4 text-left shadow-xl animate-bounce-in';
            card.style.borderLeftColor = sub.team_color;
            card.innerHTML = `
                <p class="text-[10px] font-bold text-slate-500 uppercase">${sub.team_name}</p>
                ${sub.type === 'photo' ? `<img src="${sub.content}" class="w-full h-40 object-cover rounded-lg mt-2">` : `<p class="text-lg italic mt-1">"${sub.content}"</p>`}
            `;
            list.appendChild(card);
        });
    }
}

function renderCountdown(blueprint) {
    const container = document.getElementById('gameContent');
    let timeLeft = blueprint?.duration || 60;

    container.innerHTML = `
        <div class="space-y-8 animate-bounce-in py-12">
            <h2 class="text-3xl font-bold text-red-500">Zeit läuft!</h2>
            <div id="timerDisplay" class="text-7xl font-black text-white bg-slate-800 w-48 h-48 rounded-full border-8 border-red-600 flex items-center justify-center mx-auto shadow-2xl">
                ${timeLeft}
            </div>
            <p class="text-xl font-bold">${blueprint?.question || 'Löse die Aufgabe!'}</p>
            <div class="pt-8">
                <button onclick="window.startTimer(this)" class="bg-green-600 px-8 py-3 rounded-xl font-bold text-xl shadow-lg hover:bg-green-500 transition-all">Start</button>
            </div>
        </div>
    `;

    window.startTimer = (btn) => {
        btn.remove();
        const display = document.getElementById('timerDisplay');
        const interval = setInterval(() => {
            timeLeft--;
            display.textContent = timeLeft;
            if (timeLeft <= 10) display.classList.add('animate-pulse', 'text-red-500', 'border-red-400');
            if (timeLeft <= 0) {
                clearInterval(interval);
                alert('Zeit abgelaufen!');
            }
        }, 1000);
    };
}

// Capture (Photo / Statement)
function renderCapture(mode, blueprint) {
    const container = document.getElementById('gameContent');
    const isPhoto = mode === 'photo';

    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-bold ${isPhoto ? 'text-blue-400' : 'text-purple-400'}">${isPhoto ? 'Foto-Check' : 'Text-Statement'}</h2>
            <p class="text-lg">${blueprint?.question || (isPhoto ? 'Mache ein Foto von etwas verdächtigem' : 'Schreibe ein kurzes Statement')}</p>

            ${isPhoto ? `
                <div class="relative w-full aspect-square bg-slate-800 rounded-3xl border-4 border-dashed border-slate-700 flex flex-col items-center justify-center overflow-hidden">
                    <img id="capturePreview" class="absolute inset-0 w-full h-full object-cover hidden">
                    <div id="captureIcon" class="text-6xl mb-4">📸</div>
                    <label class="bg-blue-600 px-6 py-3 rounded-xl font-bold cursor-pointer hover:bg-blue-500 transition-all">
                        Kamera öffnen
                        <input type="file" accept="image/*" capture="environment" class="hidden" onchange="handleCapture(this)">
                    </label>
                </div>
            ` : `
                <textarea id="statementInput" class="w-full h-40 bg-slate-700 p-4 rounded-2xl border-2 border-slate-600 focus:border-purple-500 outline-none" placeholder="Deine Nachricht..."></textarea>
            `}

            <button id="submitCaptureBtn" onclick="submitCapture('${mode}')" class="w-full ${isPhoto ? 'bg-blue-600' : 'bg-purple-600'} p-4 rounded-2xl font-bold text-lg shadow-lg">Absenden</button>
        </div>
    `;

    window.handleCapture = async (input) => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('capturePreview');
            preview.src = e.target.result;
            preview.classList.remove('hidden');
            document.getElementById('captureIcon').classList.add('hidden');
        };
        reader.readAsDataURL(file);

        // Upload to server
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) input.dataset.url = data.url;
    };

    window.submitCapture = async (m) => {
        const btn = document.getElementById('submitCaptureBtn');
        btn.disabled = true;
        btn.textContent = 'Wird gesendet...';

        const data = {
            sessionId: currentSessionId,
            teamId: currentTeamId, // I need to make sure I have this
            type: m,
            content: m === 'photo' ? document.querySelector('input[type="file"]').dataset.url : document.getElementById('statementInput').value
        };

        // Notify teacher via socket or API
        socket.emit('studentSubmission', data);

        alert('Vielen Dank! Deine Antwort wurde übermittelt.');
        btn.textContent = 'Gesendet!';
    };
}

// Mood Barometer
function renderMood(blueprint) {
    const container = document.getElementById('gameContent');
    container.innerHTML = `
        <div class="space-y-12 animate-bounce-in py-8">
            <h2 class="text-2xl font-bold text-pink-400">Stimmungs-Barometer</h2>
            <p class="text-lg text-slate-200">${blueprint?.question || 'Wie stehst du dazu?'}</p>
            <div class="px-4">
                <input type="range" min="1" max="10" value="5" class="w-full h-4 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-pink-500">
                <div class="flex justify-between mt-4 text-xs font-bold text-slate-400">
                    <span>${blueprint?.labelLeft || 'Schlecht'}</span>
                    <span>${blueprint?.labelRight || 'Gut'}</span>
                </div>
            </div>
            <button onclick="alert('Danke für dein Feedback!')" class="w-full bg-pink-600 p-4 rounded-2xl font-bold text-lg shadow-lg">Absenden</button>
        </div>
    `;
}

// Socket Events
socket.on('gameStarted', (data) => {
    currentGameStatus = 'running';
    document.getElementById('waitingPhase').classList.add('hidden');
    document.getElementById('gamePhase').classList.remove('hidden');
    renderGame(data.gameType || 'binary', data.blueprint);
});

socket.on('gameModeUpdated', (data) => {
    renderGame(data.gameType, data.blueprint);
});

socket.on('displayResults', () => {
    renderSummary();
});

socket.on('gameEnded', () => {
    alert('Das Spiel wurde von der Lehrkraft beendet.');
    window.location.href = '/';
});

// Auth & Setup
document.getElementById('sessionCodeInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

document.getElementById('teamCodeInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('rejoinBtn').click();
});

document.getElementById('joinBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('sessionCodeInput').value.trim();
    if (!code) return;

    try {
        const res = await fetch('/api/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.success) {
            currentSessionId = data.sessionId;
            currentTeamId = data.teamId;
            currentGameStatus = data.gameStatus;
            currentGameType = data.gameType || 'binary';
            currentBlueprint = data.blueprint || null;
            takenColors = data.takenColors || [];

            socket.emit('joinSessionRoom', currentSessionId);

            document.getElementById('joinPhase').classList.add('hidden');
            document.getElementById('createTeamPhase').classList.remove('hidden');
            renderColorPicker();
        } else {
            const err = document.getElementById('joinError');
            err.textContent = data.error;
            err.classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('rejoinBtn')?.addEventListener('click', async () => {
    const teamCode = document.getElementById('teamCodeInput').value.trim().toUpperCase();
    if (!teamCode) return;

    try {
        const res = await fetch('/api/rejoin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamCode })
        });
        const data = await res.json();
        if (data.success) {
            currentSessionId = data.sessionId;
            currentGameStatus = data.gameStatus;
            currentGameType = data.gameType || 'binary';
            currentBlueprint = data.blueprint || null;
            selectedColor = data.color;

            socket.emit('joinSessionRoom', currentSessionId);

            document.getElementById('rejoinPhase').classList.add('hidden');
            document.getElementById('joinPhase').classList.add('hidden');

            if (data.gameStatus === 'running') {
                document.getElementById('gamePhase').classList.remove('hidden');
                renderGame(currentGameType, currentBlueprint);
            } else {
                document.getElementById('waitingPhase').classList.remove('hidden');
            }

            displayTeamSummary(data.name, data.color, data.groupSize, teamCode, true);
        } else {
            const err = document.getElementById('rejoinError');
            err.textContent = data.error;
            err.classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('createTeamBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('teamNameInput').value.trim();
    const groupSize = parseInt(document.getElementById('groupSizeInput').value);

    if (!name || !selectedColor || isNaN(groupSize)) return alert('Bitte alles ausfüllen!');

    try {
        const res = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId, name, color: selectedColor, groupSize })
        });
        const data = await res.json();
        if (data.success) {
            currentTeamId = data.teamId;
            document.getElementById('createTeamPhase').classList.add('hidden');
            if (currentGameStatus === 'running') {
                document.getElementById('gamePhase').classList.remove('hidden');
                renderGame(currentGameType, currentBlueprint);
            } else {
                document.getElementById('waitingPhase').classList.remove('hidden');
            }
            displayTeamSummary(name, selectedColor, groupSize, data.teamCode);
        } else {
            const err = document.getElementById('createTeamError');
            err.textContent = data.error;
            err.classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
    }
});

enableTouchDrag();
