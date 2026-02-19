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
let currentTaskIndex = 0;
let takenColors = [];
let html5QrScanner = null;

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

// Sequence Engine
function initGameSequence(blueprint, mode) {
    currentBlueprint = blueprint;
    currentGameType = mode;
    currentTaskIndex = 0;

    if (currentBlueprint?.templateType === 'qr') {
        startQrPhase();
    } else {
        renderNextTask();
    }
}

function startQrPhase() {
    document.getElementById('gamePhase').classList.add('hidden');
    document.getElementById('qrPhase').classList.remove('hidden');
    document.getElementById('waitingPhase').classList.add('hidden');
    startQrScanner();
}

function startQrScanner() {
    if (html5QrScanner) return;
    html5QrScanner = new Html5Qrcode("qr-reader");
    html5QrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onScanSuccess
    ).catch(err => {
        console.warn("Scanner failed - probably no camera or permission", err);
    });
}

async function stopQrScanner() {
    if (html5QrScanner) {
        try {
            await html5QrScanner.stop();
        } catch (e) {
            console.warn("Scanner stop failed (maybe never started):", e);
        }
        html5QrScanner = null;
        const readerEl = document.getElementById('qr-reader');
        if (readerEl) readerEl.innerHTML = '';
    }
}

function onScanSuccess(decodedText) {
    handleTaskCode(decodedText);
}

window.handleManualCode = () => {
    const code = document.getElementById('manualCodeInput').value.trim();
    handleTaskCode(code);
};

async function handleTaskCode(code) {
    const task = currentBlueprint.tasks.find(t => t.code === code);
    if (task) {
        await stopQrScanner();
        document.getElementById('qrPhase').classList.add('hidden');
        document.getElementById('gamePhase').classList.remove('hidden');
        document.getElementById('manualCodeInput').value = '';
        renderGame(task.type, task, 0); // 0 totalTasks means no progress bar
    } else {
        WeltenretterUI.alert('Ungültiger Code für diese Spielrunde.', 'Ups!', '❓');
    }
}

async function renderNextTask() {
    const tasks = currentBlueprint?.tasks || [];
    if (currentTaskIndex >= tasks.length && tasks.length > 0) {
        await WeltenretterUI.alert('Du hast alle Aufgaben dieser Sequenz gelöst!', 'Super!', '🏆');
        document.getElementById('waitingPhase').classList.remove('hidden');
        document.getElementById('gamePhase').classList.add('hidden');
        return;
    }

    const task = tasks[currentTaskIndex] || {};
    // Use the type defined in the task itself
    const mode = task.type || currentGameType;
    renderGame(mode, task, tasks.length);
}

async function completeTask() {
    if (currentBlueprint?.templateType === 'qr') {
        await WeltenretterUI.alert('Station erfolgreich abgeschlossen!', 'Sehr gut!', '✅');
        startQrPhase();
    } else {
        currentTaskIndex++;
        renderNextTask();
    }
}

// Mini-Games Rendering
function renderGame(mode, task, totalTasks) {
    // Report progress to teacher
    if (currentSessionId && currentTeamId) {
        socket.emit('reportTaskStart', {
            sessionId: currentSessionId,
            teamId: currentTeamId,
            taskIndex: currentTaskIndex,
            taskTitle: task.question || task.type
        });
    }

    const container = document.getElementById('gameContent');
    container.style.opacity = '0';

    setTimeout(() => {
        container.innerHTML = '';

        // Progress Header
        if (totalTasks > 1) {
            const progress = document.createElement('div');
            progress.className = 'mb-6 space-y-1';
            progress.innerHTML = `
                <div class="flex justify-between text-[10px] font-black text-slate-500 uppercase">
                    <span>Aufgabe ${currentTaskIndex + 1} von ${totalTasks}</span>
                    <span>${Math.round(((currentTaskIndex + 1) / totalTasks) * 100)}%</span>
                </div>
                <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                    <div class="h-full bg-blue-500 transition-all duration-500" style="width: ${((currentTaskIndex + 1) / totalTasks) * 100}%"></div>
                </div>
            `;
            container.appendChild(progress);
        } else if (currentBlueprint?.templateType === 'qr') {
            const qrHeader = document.createElement('div');
            qrHeader.className = 'mb-6 flex justify-between items-center';
            qrHeader.innerHTML = `
                <div class="bg-blue-600/20 text-blue-400 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-500/30">
                    Station: ${task.code}
                </div>
                <button onclick="completeTask()" class="text-[10px] font-black text-slate-500 uppercase hover:text-white transition-colors">Abbrechen</button>
            `;
            container.appendChild(qrHeader);
        }

        const gameArea = document.createElement('div');
        gameArea.id = 'gameArea';

        if (task.description) {
            const desc = document.createElement('div');
            desc.className = 'mb-6 p-4 bg-slate-800/80 rounded-2xl border border-slate-700 text-sm font-bold text-slate-300 leading-relaxed text-left';

            const descHeader = document.createElement('div');
            descHeader.className = 'flex items-center gap-2 mb-1';
            descHeader.innerHTML = '<span class="text-blue-500">ℹ️</span><span class="text-[10px] uppercase font-black text-slate-500 tracking-widest">Anleitung</span>';

            const descText = document.createElement('p');
            descText.textContent = task.description;

            desc.appendChild(descHeader);
            desc.appendChild(descText);
            container.appendChild(desc);
        }

        container.appendChild(gameArea);

        if (mode === 'binary') {
            renderBinary(task, gameArea);
        } else if (mode === 'choice') {
            renderChoice(task, gameArea);
        } else if (mode === 'select') {
            renderSelect(task, gameArea);
        } else if (mode === 'chat') {
            renderChat(task, gameArea);
        } else if (mode === 'scroller') {
            renderScroller(task, gameArea);
        } else if (mode === 'detector') {
            renderDetector(task, gameArea);
        } else if (mode === 'hotspot') {
            renderHotspot(task, gameArea);
        } else if (mode === 'password') {
            renderPassword(task, gameArea);
        } else if (mode === 'profile') {
            renderProfile(task, gameArea);
        } else if (mode === 'mood') {
            renderMood(task, gameArea);
        } else if (mode === 'bucket') {
            renderBucket(task, gameArea);
        } else if (mode === 'ranking') {
            renderRanking(task, gameArea);
        } else if (mode === 'pairs') {
            renderPairs(task, gameArea);
        } else if (mode === 'cloze') {
            renderCloze(task, gameArea);
        } else if (mode === 'countdown') {
            renderCountdown(task, gameArea);
        } else if (mode === 'photo' || mode === 'statement') {
            renderCapture(mode, task, gameArea);
        }
        container.style.opacity = '1';
    }, 300);
}

// Game Types
function renderBinary(task, container) {
    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-black text-blue-500 uppercase tracking-tighter">Binary Swipe</h2>
            <p class="text-slate-400 font-bold">${task.question || 'Echt oder Fake?'}</p>
            <div id="swipeCard" class="swipe-card w-64 h-80 mx-auto bg-slate-800 rounded-[3rem] border-4 border-slate-700 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden">
                <div class="text-8xl mb-4 transform transition-transform hover:scale-110">${task.icon || '🖼️'}</div>
                <div class="absolute bottom-0 left-0 right-0 p-6 bg-slate-900/90 border-t border-slate-700">
                    <p class="text-xs text-slate-500 uppercase font-black tracking-widest">Entscheide jetzt</p>
                </div>
            </div>
            <div class="flex justify-center gap-8 pt-4">
                <button onclick="handleSwipe('left')" class="w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center shadow-lg transform active:scale-90 transition-all border-4 border-red-900/50">
                    <span class="text-2xl">❌</span>
                </button>
                <button onclick="handleSwipe('right')" class="w-16 h-16 bg-green-600 hover:bg-green-500 rounded-full flex items-center justify-center shadow-lg transform active:scale-90 transition-all border-4 border-green-900/50">
                    <span class="text-2xl">✅</span>
                </button>
            </div>
        </div>
    `;
    initSwipe();
}

function initSwipe() {
    const card = document.getElementById('swipeCard');
    if (!card) return;

    let startX = 0;
    let currentX = 0;

    const onStart = (e) => {
        startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        card.style.transition = 'none';
    };

    const onMove = (e) => {
        if (!startX) return;
        currentX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const diff = currentX - startX;
        const rotate = diff / 10;
        card.style.transform = `translateX(${diff}px) rotate(${rotate}deg)`;

        if (Math.abs(diff) > 50) {
            card.style.borderColor = diff > 0 ? '#22c55e' : '#ef4444';
        } else {
            card.style.borderColor = '#334155';
        }
    };

    const onEnd = () => {
        if (!startX) return;
        const diff = currentX - startX;
        card.style.transition = 'all 0.5s cubic-bezier(0.23, 1, 0.32, 1)';

        if (diff > 100) {
            handleSwipe('right');
        } else if (diff < -100) {
            handleSwipe('left');
        } else {
            card.style.transform = '';
            card.style.borderColor = '#334155';
        }
        startX = 0;
    };

    card.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    card.addEventListener('touchstart', onStart);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onEnd);
}

function handleSwipe(dir) {
    const card = document.getElementById('swipeCard');
    if (!card) return;
    card.classList.add(dir === 'left' ? 'swipe-left' : 'swipe-right');
    setTimeout(completeTask, 600);
}

function renderChoice(task, container) {
    const options = task.options || ['A', 'B', 'C'];
    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-black text-purple-500 uppercase tracking-tighter">Quiz</h2>
            <p class="text-slate-200 text-lg font-bold">${task.question || 'Wähle die richtige Antwort'}</p>
            <div class="grid grid-cols-1 gap-3">
                ${options.map((opt, i) => `
                    <button onclick="selectChoice(${i})" class="choice-btn w-full bg-slate-800 hover:bg-slate-700 p-4 rounded-2xl border-2 border-slate-700 text-left transition-all font-bold text-slate-300">
                        ${opt.includes(')') ? opt : String.fromCharCode(65+i) + ') ' + opt}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

async function selectChoice(index) {
    const btns = document.querySelectorAll('.choice-btn');
    btns[index].classList.add('bg-blue-600', 'border-blue-400', 'text-white', 'scale-[1.02]');
    await WeltenretterUI.alert('Antwort gespeichert!', 'Vielen Dank', '✨');
    completeTask();
}

function renderSelect(task, container) {
    const options = task.options || ['Opt 1', 'Opt 2'];
    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-black text-yellow-500 uppercase tracking-tighter">Checklist</h2>
            <p class="text-slate-200 text-lg font-bold">${task.question || 'Markiere alle richtigen Antworten'}</p>
            <div class="space-y-2 text-left">
                ${options.map(opt => `
                    <label class="flex items-center gap-4 p-4 bg-slate-800 rounded-2xl cursor-pointer hover:bg-slate-700 transition-all border border-slate-700">
                        <input type="checkbox" class="w-6 h-6 rounded-lg border-slate-600 bg-slate-900 text-yellow-500 focus:ring-yellow-500">
                        <span class="font-bold text-slate-300">${opt}</span>
                    </label>
                `).join('')}
            </div>
            <button onclick="submitSelect()" class="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-black py-4 rounded-2xl transition-all shadow-xl active:scale-95">ABSENDEN</button>
        </div>
    `;
}

async function submitSelect() {
    await WeltenretterUI.alert('Deine Auswahl wurde übermittelt.', 'Erfolgreich', '✅');
    completeTask();
}

function renderChat(task, container) {
    const nodes = task.nodes || {
        "start": { "text": "Hallo!", "options": [{ "label": "Hi!", "next": "end" }] },
        "end": { "text": "Bis bald.", "options": [] }
    };

    let currentNode = "start";
    const drawNode = (nodeId) => {
        const node = nodes[nodeId] || nodes["start"];
        container.innerHTML = `
            <div class="space-y-6 animate-bounce-in">
                <h2 class="text-2xl font-black text-blue-500 uppercase tracking-tighter">Chat: ${task.partner || 'Unbekannt'}</h2>
                <div class="bg-slate-900/50 p-6 rounded-[2rem] border border-slate-700 min-h-[120px] flex items-center justify-start text-left shadow-inner">
                    <div class="bg-blue-600 p-4 rounded-2xl rounded-bl-none max-w-[85%] shadow-lg">
                        <p class="text-sm font-bold leading-relaxed">${node.text}</p>
                    </div>
                </div>
                <div class="space-y-2">
                    ${node.options.map((opt, i) => `
                        <button onclick="window.chatAction('${opt.next}')" class="w-full bg-slate-800 hover:bg-slate-700 p-4 rounded-2xl border-2 border-slate-700 text-sm font-bold text-slate-300 transition-all active:scale-95">
                            ${opt.label}
                        </button>
                    `).join('')}
                    ${node.options.length === 0 ? `
                        <button onclick="completeTask()" class="w-full bg-blue-600 p-4 rounded-2xl font-black uppercase tracking-widest shadow-lg mt-4">Chat beenden</button>
                    ` : ''}
                </div>
            </div>
        `;
    };
    window.chatAction = drawNode;
    drawNode(currentNode);
}

function renderScroller(task, container) {
    const posts = task.posts || [];
    container.innerHTML = `
        <div class="space-y-4 max-h-[600px] overflow-y-auto p-4 border-2 border-slate-800 rounded-[2.5rem] bg-slate-900/50 scroll-smooth" id="scrollerBody">
            <h2 class="text-2xl font-black text-blue-400 sticky top-0 bg-slate-900/90 py-4 z-10 backdrop-blur-md">Feed-Check</h2>
            <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-6">Markiere alle problematischen Posts</p>
            ${posts.map((p, i) => `
                <div class="p-5 bg-slate-800 rounded-3xl border border-slate-700 space-y-3 transition-all active:scale-[0.98]" onclick="markPost(this, ${p.isBad})">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs">👤</div>
                        <p class="font-black text-xs text-blue-400">@${p.user}</p>
                    </div>
                    <p class="text-sm text-slate-300 leading-relaxed font-medium">${p.text}</p>
                </div>
            `).join('')}
            <div class="py-12 text-center">
                <button onclick="completeTask()" class="bg-blue-600 px-12 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl">Fertig</button>
            </div>
        </div>
    `;
}

function markPost(el, isBad) {
    el.classList.add(isBad ? 'border-green-500' : 'border-red-500');
    el.classList.add(isBad ? 'bg-green-900/20' : 'bg-red-900/20');
}

function renderDetector(task, container) {
    const imgUrl = task.image || 'https://via.placeholder.com/800x600?text=Bild+wird+geladen...';
    container.innerHTML = `
        <div class="space-y-6">
            <h2 class="text-2xl font-black text-blue-500 uppercase tracking-tighter">Detektor</h2>
            <p class="text-slate-400 font-bold">${task.question || 'Finde die Fehler!'}</p>
            <div id="detectorCanvas" class="relative w-full aspect-[4/3] bg-slate-800 rounded-[2rem] overflow-hidden cursor-none touch-none border-4 border-slate-700 shadow-2xl">
                <img src="${imgUrl}" class="w-full h-full object-cover blur-xl opacity-50">
                <div id="lupe" class="absolute w-40 h-40 rounded-full border-4 border-white shadow-[0_0_50px_rgba(255,255,255,0.3)] overflow-hidden pointer-events-none" style="display:none;">
                     <img src="${imgUrl}" id="lupeImg" class="absolute object-cover" style="width:1000%; height:1000%;">
                </div>
            </div>
            <button onclick="completeTask()" class="w-full bg-blue-600 p-4 rounded-2xl font-black uppercase tracking-widest">Ich habe alles gefunden</button>
        </div>
    `;

    const canvas = document.getElementById('detectorCanvas');
    const lupe = document.getElementById('lupe');
    const lupeImg = document.getElementById('lupeImg');

    const handleMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
            lupe.style.display = 'none';
            return;
        }

        lupe.style.display = 'block';
        lupe.style.left = (x - 80) + 'px';
        lupe.style.top = (y - 80) + 'px';

        lupeImg.style.width = (rect.width) + 'px';
        lupeImg.style.height = (rect.height) + 'px';
        lupeImg.style.left = (-x + 80) + 'px';
        lupeImg.style.top = (-y + 80) + 'px';
        lupeImg.style.maxWidth = 'none';
    };

    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('touchmove', e => { e.preventDefault(); handleMove(e); }, { passive: false });
}

function renderHotspot(task, container) {
    const imgUrl = task.image || 'https://via.placeholder.com/800x600?text=Hotspot+Bild';
    const zones = task.zones || [];
    let found = [];

    container.innerHTML = `
        <div class="space-y-6">
            <h2 class="text-2xl font-black text-blue-500 uppercase tracking-tighter">Hotspot Suche</h2>
            <p class="text-slate-400 font-bold">Tippe auf die verdächtigen Stellen!</p>
            <div id="hotspotContainer" class="relative w-full aspect-video bg-slate-900 rounded-[2rem] overflow-hidden border-4 border-slate-700 shadow-2xl">
                <img src="${imgUrl}" class="w-full h-full object-contain">
                <div id="hotspotTouchLayer" class="absolute inset-0"></div>
            </div>
            <div class="flex justify-between items-center px-2">
                <span id="hotspotStatus" class="text-xs text-blue-400 font-black uppercase tracking-widest">Gefunden: 0 / ${zones.length}</span>
                <button id="hotspotDone" class="hidden bg-green-600 px-6 py-2 rounded-xl font-black text-xs uppercase" onclick="completeTask()">Weiter</button>
            </div>
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
                marker.className = 'absolute border-4 border-green-500 rounded-xl animate-bounce-in shadow-[0_0_20px_rgba(34,197,94,0.5)]';
                marker.style.left = z.x + '%';
                marker.style.top = z.y + '%';
                marker.style.width = z.w + '%';
                marker.style.height = z.h + '%';
                layer.appendChild(marker);
            }
        });
        document.getElementById('hotspotStatus').textContent = `Gefunden: ${found.length} / ${zones.length}`;
        if (found.length === zones.length && zones.length > 0) {
            document.getElementById('hotspotDone').classList.remove('hidden');
        }
    };
}

function renderPassword(task, container) {
    const rules = task.rules || ['Mind. 8 Zeichen'];
    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-black text-green-500 uppercase tracking-tighter">Sicherheit</h2>
            <div class="bg-slate-800 p-6 rounded-[2rem] border-2 border-slate-700 space-y-4">
                <ul class="text-left text-xs space-y-2 font-bold text-slate-400">
                    ${rules.map(r => `<li class="flex items-center gap-2"><span class="text-green-500">🔒</span> ${r}</li>`).join('')}
                </ul>
                <input type="text" id="pwInput" class="w-full bg-slate-900 border-2 border-slate-700 p-5 rounded-2xl text-center font-mono text-2xl text-white outline-none focus:border-green-500 transition-all" placeholder="Passwort...">
                <div id="lockIcon" class="text-6xl py-4 transition-all duration-500">🔒</div>
                <p id="pwFeedback" class="text-[10px] uppercase font-black text-slate-600 tracking-widest">Status: Gesperrt</p>
            </div>
            <button id="pwSubmit" disabled onclick="completeTask()" class="w-full bg-slate-700 p-4 rounded-2xl font-black uppercase text-slate-500 transition-all">Tresor öffnen</button>
        </div>
    `;

    document.getElementById('pwInput').oninput = (e) => {
        const val = e.target.value;
        const feedback = document.getElementById('pwFeedback');
        const lock = document.getElementById('lockIcon');
        const btn = document.getElementById('pwSubmit');

        let secure = val.length >= 8; // Basic validation
        if (secure) {
            lock.textContent = '🔓';
            lock.classList.add('scale-110', 'text-green-500');
            feedback.textContent = 'Status: Entriegelt';
            feedback.classList.replace('text-slate-600', 'text-green-500');
            btn.disabled = false;
            btn.classList.replace('bg-slate-700', 'bg-green-600');
            btn.classList.replace('text-slate-500', 'text-white');
        } else {
            lock.textContent = '🔒';
            lock.classList.remove('scale-110', 'text-green-500');
            feedback.textContent = 'Status: Gesperrt';
            feedback.classList.replace('text-green-500', 'text-slate-600');
            btn.disabled = true;
            btn.classList.replace('bg-green-600', 'bg-slate-700');
            btn.classList.replace('text-white', 'text-slate-500');
        }
    };
}

function renderProfile(task, container) {
    const fields = task.fields || ['name'];
    const custom = task.customFields || [];
    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-black text-blue-500 uppercase tracking-tighter">Profil-Check</h2>
            <div class="bg-slate-800 p-8 rounded-[2.5rem] border border-slate-700 space-y-5 text-left shadow-2xl relative overflow-hidden">
                <div class="absolute top-0 left-0 w-full h-2 bg-blue-600"></div>
                <div class="w-24 h-24 bg-slate-700 rounded-full mx-auto mb-6 border-4 border-blue-600 flex items-center justify-center text-5xl shadow-xl">👤</div>
                ${fields.concat(custom).map(f => `
                    <div class="space-y-1">
                        <label class="block text-[10px] uppercase font-black text-slate-500 ml-1 tracking-widest">${f}</label>
                        <input type="text" class="w-full bg-slate-900 border border-slate-700 p-3 rounded-xl text-sm font-bold text-slate-200 outline-none focus:border-blue-500 transition-all" placeholder="Eingabe...">
                    </div>
                `).join('')}
            </div>
            <button onclick="completeTask()" class="w-full bg-blue-600 p-4 rounded-2xl font-black uppercase tracking-widest shadow-xl">Profil speichern</button>
        </div>
    `;
}

function renderMood(task, container) {
    container.innerHTML = `
        <div class="space-y-12 animate-bounce-in py-12">
            <h2 class="text-2xl font-black text-pink-500 uppercase tracking-tighter">Barometer</h2>
            <p class="text-xl text-slate-100 font-black leading-tight">${task.question || 'Wie stehst du dazu?'}</p>
            <div class="px-6 space-y-6">
                <input type="range" min="1" max="100" value="50" class="w-full h-3 bg-slate-800 rounded-full appearance-none cursor-pointer accent-pink-500 border border-slate-700">
                <div class="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span class="bg-slate-800 px-3 py-1 rounded-lg border border-slate-700">${task.labelLeft || 'Schlecht'}</span>
                    <span class="bg-slate-800 px-3 py-1 rounded-lg border border-slate-700">${task.labelRight || 'Gut'}</span>
                </div>
            </div>
            <button onclick="completeTask()" class="w-full bg-pink-600 hover:bg-pink-500 p-5 rounded-3xl font-black text-xl uppercase tracking-widest shadow-2xl transition-all active:scale-95">Absenden</button>
        </div>
    `;
}

function renderBucket(task, container) {
    const buckets = task.buckets || ['Korb A', 'Korb B'];
    const items = task.items || [];
    let remaining = items.length;

    container.innerHTML = `
        <div class="space-y-8">
            <h2 class="text-2xl font-black text-orange-500 uppercase tracking-tighter">Bucket Drop</h2>
            <div class="flex flex-wrap gap-2 justify-center min-h-[100px] p-4 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-800" id="itemSource">
                ${items.map((it, i) => `
                    <div id="drag-item-${i}" draggable="true" ondragstart="event.dataTransfer.setData('text', '${i}')" class="bg-slate-800 p-4 rounded-2xl border-2 border-slate-700 cursor-move shadow-lg text-sm font-black text-slate-200 transition-all hover:border-orange-500">
                        ${it.text}
                    </div>
                `).join('')}
            </div>
            <div class="grid grid-cols-2 gap-4">
                ${buckets.map((b, i) => `
                    <div ondragover="event.preventDefault()" ondrop="handleBucketDrop(event, ${i})" class="bg-slate-800/50 p-6 rounded-[2.5rem] border-4 border-dashed border-slate-800 min-h-[160px] flex flex-col items-center justify-center text-center transition-all">
                        <span class="text-4xl mb-3 opacity-30">🗑️</span>
                        <span class="font-black text-xs uppercase tracking-widest text-slate-500 mb-4">${b}</span>
                        <div class="bucket-list space-y-2 w-full"></div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    window.handleBucketDrop = async (e, bucketIdx) => {
        e.preventDefault();
        const itemIdx = e.dataTransfer.getData('text');
        const item = items[itemIdx];
        const dragEl = document.getElementById(`drag-item-${itemIdx}`);
        if (!dragEl) return;

        const targetDiv = e.target.closest('div[ondrop]').querySelector('.bucket-list');
        const isCorrect = item.target === bucketIdx;

        const newItem = document.createElement('div');
        newItem.className = `p-2 text-[10px] font-black uppercase rounded-xl border-2 shadow-inner animate-bounce-in ${isCorrect ? 'bg-green-600/20 border-green-500 text-green-400' : 'bg-red-600/20 border-red-500 text-red-400'}`;
        newItem.textContent = item.text;
        targetDiv.appendChild(newItem);

        dragEl.remove();
        remaining--;
        if (remaining <= 0) setTimeout(completeTask, 1000);
    };
}

function renderRanking(task, container) {
    const items = [...(task.items || [])];
    container.innerHTML = `
        <div class="space-y-6 animate-bounce-in">
            <h2 class="text-2xl font-black text-yellow-500 uppercase tracking-tighter">Ranking</h2>
            <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest">Tausche die Plätze per Drag & Drop</p>
            <div id="sortableList" class="space-y-3">
                ${items.map((it, i) => `
                    <div id="rank-${i}" draggable="true" ondragstart="handleSortStart(event, ${i})" ondragover="event.preventDefault()" ondrop="handleSortDrop(event, ${i})" class="bg-slate-800 p-5 rounded-2xl border-2 border-slate-700 flex items-center gap-5 cursor-move transition-all hover:border-yellow-500 group">
                        <span class="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-xs font-black text-yellow-500 border border-slate-700 group-hover:bg-yellow-500 group-hover:text-black transition-colors">${i+1}</span>
                        <span class="flex-1 text-left font-bold text-slate-300">${it}</span>
                        <span class="text-slate-600 opacity-30">☰</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="completeTask()" class="w-full bg-yellow-600 p-4 rounded-2xl font-black uppercase tracking-widest shadow-xl mt-6">Prüfen & Weiter</button>
        </div>
    `;

    let dragIdx;
    window.handleSortStart = (e, i) => dragIdx = i;
    window.handleSortDrop = (e, i) => {
        // SWAP Logic as requested
        const list = document.getElementById('sortableList');
        const itemsList = Array.from(list.children);
        const sourceText = itemsList[dragIdx].querySelector('.flex-1').textContent;
        const targetText = itemsList[i].querySelector('.flex-1').textContent;

        itemsList[dragIdx].querySelector('.flex-1').textContent = targetText;
        itemsList[i].querySelector('.flex-1').textContent = sourceText;
    };
}

function renderPairs(task, container) {
    const pairs = task.pairs || [];
    const lefts = [...pairs].sort(() => Math.random() - 0.5);
    const rights = [...pairs].sort(() => Math.random() - 0.5);
    let matched = 0;

    container.innerHTML = `
        <div class="space-y-8">
            <h2 class="text-2xl font-black text-indigo-500 uppercase tracking-tighter">Match</h2>
            <div class="grid grid-cols-2 gap-6">
                <div class="space-y-3" id="pairsLeft">
                    ${lefts.map((p, i) => `<button onclick="selectPair(this, 'left', '${p.left}')" class="w-full h-20 bg-slate-800 p-4 rounded-2xl border-2 border-slate-700 text-[10px] font-black uppercase tracking-tighter text-slate-400 transition-all leading-tight shadow-lg overflow-hidden">${p.left}</button>`).join('')}
                </div>
                <div class="space-y-3" id="pairsRight">
                    ${rights.map((p, i) => `<button onclick="selectPair(this, 'right', '${p.right}')" class="w-full h-20 bg-slate-800 p-4 rounded-2xl border-2 border-slate-700 text-[10px] font-black uppercase tracking-tighter text-slate-400 transition-all leading-tight shadow-lg overflow-hidden">${p.right}</button>`).join('')}
                </div>
            </div>
        </div>
    `;

    let selectedLeft = null;
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    window.selectPair = (btn, side, val) => {
        if (btn.disabled) return;

        if (side === 'left') {
            document.querySelectorAll('#pairsLeft button').forEach(b => b.classList.remove('border-blue-500', 'bg-blue-600/20', 'text-white'));
            btn.classList.add('border-blue-500', 'bg-blue-600/20', 'text-white');
            selectedLeft = { btn, val };
        } else if (selectedLeft) {
            const pair = pairs.find(p => p.left === selectedLeft.val && p.right === val);
            if (pair) {
                const color = colors[matched % colors.length];
                [selectedLeft.btn, btn].forEach(b => {
                    b.disabled = true;
                    b.style.backgroundColor = color + '20';
                    b.style.borderColor = color;
                    b.style.color = color;
                    b.classList.add('opacity-80', 'scale-95');
                });
                matched++;
                selectedLeft = null;
                if (matched === pairs.length) setTimeout(completeTask, 1000);
            } else {
                btn.classList.add('shake', 'border-red-500');
                setTimeout(() => btn.classList.remove('shake', 'border-red-500'), 500);
            }
        }
    };
}

function renderCloze(task, container) {
    const text = task.text || "";
    const fakes = task.fakes || [];
    const words = [];
    const html = text.replace(/\[(.*?)\]/g, (match, word) => {
        words.push(word);
        return `<span class="cloze-drop bg-slate-950/50 border-b-4 border-blue-500 px-4 py-1 mx-1 inline-block min-w-[80px] rounded-lg text-transparent" ondragover="event.preventDefault()" ondrop="handleClozeDrop(event, this, '${word}')">.</span>`;
    });

    const allOptions = [...words, ...fakes].sort(() => Math.random() - 0.5);
    let filled = 0;

    container.innerHTML = `
        <div class="space-y-10 animate-bounce-in">
            <h2 class="text-2xl font-black text-blue-500 uppercase tracking-tighter">Lückentext</h2>
            <div class="bg-slate-800 p-8 rounded-[2.5rem] border border-slate-700 text-base leading-loose text-left shadow-2xl font-medium text-slate-300">
                ${html}
            </div>
            <div class="flex flex-wrap gap-2 justify-center p-4 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-800" id="clozeSource">
                ${allOptions.map((w, i) => `<div id="cloze-word-${i}" draggable="true" ondragstart="event.dataTransfer.setData('text', '${w}|${i}')" class="bg-blue-600 px-4 py-2 rounded-xl shadow-lg cursor-move font-bold text-sm transition-all hover:scale-105 active:scale-95">${w}</div>`).join('')}
            </div>
        </div>
    `;

    window.handleClozeDrop = (e, el, correctWord) => {
        const [droppedWord, idx] = e.dataTransfer.getData('text').split('|');
        el.textContent = droppedWord;
        el.classList.remove('text-transparent');
        el.classList.add('text-white', 'font-black', 'bg-blue-600/20');

        document.getElementById(`cloze-word-${idx}`).classList.add('hidden');

        filled++;
        if (filled === words.length) setTimeout(completeTask, 1500);
    };
}

function renderCountdown(task, container) {
    let timeLeft = task.duration || 60;
    container.innerHTML = `
        <div class="space-y-10 animate-bounce-in py-12">
            <h2 class="text-3xl font-black text-red-500 uppercase tracking-tighter">Countdown!</h2>
            <div id="timerDisplay" class="text-8xl font-black text-white bg-slate-800 w-56 h-56 rounded-full border-[12px] border-red-600 flex items-center justify-center mx-auto shadow-[0_0_60px_rgba(220,38,38,0.4)] transition-all duration-300">
                ${timeLeft}
            </div>
            <p class="text-2xl font-black text-slate-200">${task.question || 'Löse die Aufgabe!'}</p>
            <div class="pt-8">
                <button id="timerBtn" onclick="window.startTimer(this)" class="bg-green-600 hover:bg-green-500 px-16 py-5 rounded-3xl font-black text-2xl uppercase tracking-widest shadow-2xl transition-all active:scale-95">START</button>
            </div>
        </div>
    `;

    window.startTimer = (btn) => {
        btn.remove();
        const display = document.getElementById('timerDisplay');
        const interval = setInterval(() => {
            timeLeft--;
            display.textContent = timeLeft;
            if (timeLeft <= 10) {
                display.classList.add('animate-pulse', 'text-red-500', 'border-red-400');
                if (timeLeft % 2 === 0) WeltenretterUI.vibrate?.(100);
            }
            if (timeLeft <= 0) {
                clearInterval(interval);
                WeltenretterUI.alert('Zeit abgelaufen!', 'Ende', '⏰').then(completeTask);
            }
        }, 1000);
    };
}

function renderCapture(mode, task, container) {
    const isPhoto = mode === 'photo';
    container.innerHTML = `
        <div class="space-y-8 animate-bounce-in">
            <h2 class="text-2xl font-black ${isPhoto ? 'text-blue-500' : 'text-purple-500'} uppercase tracking-tighter">${isPhoto ? 'Foto-Mission' : 'Statement'}</h2>
            <p class="text-xl font-bold text-slate-200">${task.question || (isPhoto ? 'Mache ein Foto' : 'Schreibe etwas')}</p>

            ${isPhoto ? `
                <div class="relative w-full aspect-square bg-slate-800 rounded-[3rem] border-4 border-dashed border-slate-700 flex flex-col items-center justify-center overflow-hidden group shadow-inner">
                    <img id="capturePreview" class="absolute inset-0 w-full h-full object-cover hidden">
                    <div id="captureIcon" class="text-7xl mb-6 opacity-30 group-hover:scale-110 transition-transform duration-500">📸</div>
                    <label class="bg-blue-600 px-10 py-4 rounded-2xl font-black uppercase tracking-widest cursor-pointer hover:bg-blue-500 transition-all shadow-xl active:scale-95 relative z-10">
                        Kamera / Galerie
                        <input type="file" accept="image/*" class="hidden" onchange="handleCapture(this)">
                    </label>
                </div>
            ` : `
                <textarea id="statementInput" class="w-full h-56 bg-slate-800 p-6 rounded-[2rem] border-2 border-slate-700 text-white outline-none focus:border-purple-500 transition-all font-bold text-lg shadow-inner" placeholder="Deine Nachricht..."></textarea>
            `}

            <button id="submitCaptureBtn" onclick="submitCapture('${mode}')" class="w-full ${isPhoto ? 'bg-blue-600' : 'bg-purple-600'} p-5 rounded-3xl font-black text-xl uppercase tracking-widest shadow-2xl transition-all active:scale-95">Absenden</button>
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

        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) input.dataset.url = data.url;
    };

    window.submitCapture = async (m) => {
        const btn = document.getElementById('submitCaptureBtn');
        const content = m === 'photo' ? document.querySelector('input[type="file"]').dataset.url : document.getElementById('statementInput').value;
        if (!content) return WeltenretterUI.alert('Bitte erstelle erst eine Einsendung!', 'Halt!', '⚠️');

        btn.disabled = true;
        btn.textContent = 'ÜBERMITTLE...';

        socket.emit('studentSubmission', {
            sessionId: currentSessionId,
            teamId: currentTeamId,
            type: m,
            content
        });

        await WeltenretterUI.alert('Deine Antwort wurde erfolgreich übermittelt.', 'Danke!', '🚀');
        completeTask();
    };
}

// Socket Events
socket.on('gameStarted', (data) => {
    currentGameStatus = 'running';
    document.getElementById('waitingPhase').classList.add('hidden');
    document.getElementById('gamePhase').classList.remove('hidden');
    initGameSequence(data.blueprint, data.gameType || 'binary');
});

socket.on('gameModeUpdated', (data) => {
    initGameSequence(data.blueprint, data.gameType);
});

socket.on('displayResults', () => {
    renderSummary();
});

socket.on('gameEnded', () => {
    WeltenretterUI.alert('Das Spiel wurde von der Lehrkraft beendet.', 'Beendet', '🏁').then(() => {
        window.location.href = '/';
    });
});

socket.on('sessionClosed', () => {
    WeltenretterUI.alert('Die Session wurde von der Lehrkraft geschlossen.', 'Session beendet', '🚪').then(() => {
        window.location.href = '/';
    });
});

// Auth & Join
document.getElementById('sessionCodeInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

document.getElementById('joinBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('sessionCodeInput').value.trim();
    if (!code) return;

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
});

document.getElementById('createTeamBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('teamNameInput').value.trim();
    const groupSize = parseInt(document.getElementById('groupSizeInput').value);
    if (!name || !selectedColor) return WeltenretterUI.alert('Bitte Name und Farbe wählen!', 'Unvollständig', '⚠️');

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
            initGameSequence(currentBlueprint, currentGameType);
        } else {
            document.getElementById('waitingPhase').classList.remove('hidden');
        }
        displayTeamSummary(name, selectedColor, groupSize, data.teamCode);
    } else {
        WeltenretterUI.alert(data.error, 'Fehler', '❌');
    }
});

// Summary
async function renderSummary() {
    const container = document.getElementById('gameContent');
    document.getElementById('gamePhase').classList.remove('hidden');
    document.getElementById('waitingPhase').classList.add('hidden');

    container.innerHTML = `
        <div class="space-y-8 py-8 animate-bounce-in">
            <h2 class="text-4xl font-black text-blue-500 uppercase tracking-tighter italic">Abschluss</h2>
            <div id="summaryList" class="grid grid-cols-1 gap-4">Lade Ergebnisse...</div>
            <button onclick="window.location.reload()" class="w-full bg-slate-800 p-4 rounded-2xl font-bold border border-slate-700 text-slate-400">Zurück zum Start</button>
        </div>`;

    const res = await fetch(`/api/sessions/${currentSessionId}/submissions`);
    const data = await res.json();
    const list = document.getElementById('summaryList');
    list.innerHTML = '';

    if (data.submissions.length === 0) {
        list.innerHTML = '<p class="text-slate-500 italic text-center">Noch keine Einsendungen vorhanden.</p>';
    } else {
        data.submissions.forEach(sub => {
            const card = document.createElement('div');
            card.className = 'bg-slate-800 p-5 rounded-[2rem] border-l-8 text-left shadow-2xl animate-bounce-in';
            card.style.borderLeftColor = sub.team_color;

            const header = document.createElement('div');
            header.className = 'flex justify-between items-center mb-3';

            const nameP = document.createElement('p');
            nameP.className = 'text-[10px] font-black text-slate-500 uppercase tracking-widest';
            nameP.textContent = sub.team_name;

            const typeSpan = document.createElement('span');
            typeSpan.className = 'text-[10px] bg-slate-900 px-2 py-0.5 rounded-full text-slate-500';
            typeSpan.textContent = sub.type;

            header.appendChild(nameP);
            header.appendChild(typeSpan);
            card.appendChild(header);

            if (sub.type === 'photo') {
                const img = document.createElement('img');
                img.src = sub.content;
                img.className = 'w-full h-48 object-cover rounded-2xl';
                card.appendChild(img);
            } else {
                const p = document.createElement('p');
                p.className = 'text-lg font-bold text-slate-200 italic leading-snug';
                p.textContent = `"${sub.content}"`;
                card.appendChild(p);
            }

            list.appendChild(card);
        });
    }
}
