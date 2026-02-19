const colors = [
    '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316',
    '#a855f7', '#ec4899', '#6366f1', '#f97316', '#14b8a6'
];
let selectedColor = null;
let currentSessionId = null;
let currentGameStatus = 'waiting';
let currentGameType = 'binary';
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
function renderGame(mode) {
    currentGameType = mode;
    const container = document.getElementById('gameContent');
    container.style.opacity = '0';

    setTimeout(() => {
        container.innerHTML = '';
        if (mode === 'binary') {
            container.innerHTML = `
                <div class="space-y-6 animate-bounce-in">
                    <h2 class="text-2xl font-bold text-blue-400">Binary Swipe</h2>
                    <p class="text-slate-400">Ist dieses Bild echt oder ein Fake?</p>
                    <div id="swipeCard" class="swipe-card w-64 h-80 mx-auto bg-slate-700 rounded-3xl border-4 border-slate-600 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden">
                        <div class="text-7xl mb-4">🖼️</div>
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
            container.innerHTML = `
                <div class="space-y-6 animate-bounce-in">
                    <h2 class="text-2xl font-bold text-purple-400">Multiple Choice</h2>
                    <p class="text-slate-400">Welches dieser Merkmale deutet auf ein fehlendes Impressum hin?</p>
                    <div class="grid grid-cols-1 gap-3">
                        <button onclick="selectChoice(0)" class="choice-btn w-full bg-slate-700 hover:bg-slate-600 p-4 rounded-xl border-2 border-slate-600 text-left transition-all">A) Die Seite ist sehr bunt.</button>
                        <button onclick="selectChoice(1)" class="choice-btn w-full bg-slate-700 hover:bg-slate-600 p-4 rounded-xl border-2 border-slate-600 text-left transition-all">B) Es gibt keine Kontaktadresse.</button>
                        <button onclick="selectChoice(2)" class="choice-btn w-full bg-slate-700 hover:bg-slate-600 p-4 rounded-xl border-2 border-slate-600 text-left transition-all">C) Die Schriftart ist Arial.</button>
                        <button onclick="selectChoice(3)" class="choice-btn w-full bg-slate-700 hover:bg-slate-600 p-4 rounded-xl border-2 border-slate-600 text-left transition-all">D) Die Seite lädt sehr schnell.</button>
                    </div>
                </div>
            `;
        } else if (mode === 'select') {
            container.innerHTML = `
                <div class="space-y-6 animate-bounce-in">
                    <h2 class="text-2xl font-bold text-yellow-400">Multiple Select</h2>
                    <p class="text-slate-400">Woran erkennst du eine seriöse Website? (Mehrere Antworten möglich)</p>
                    <div class="space-y-2 text-left">
                        <label class="flex items-center gap-3 p-4 bg-slate-700 rounded-xl cursor-pointer hover:bg-slate-650 transition-colors border border-slate-600">
                            <input type="checkbox" class="w-5 h-5 rounded border-slate-500 bg-slate-800 text-blue-500 focus:ring-blue-500">
                            <span>Vollständiges Impressum vorhanden</span>
                        </label>
                        <label class="flex items-center gap-3 p-4 bg-slate-700 rounded-xl cursor-pointer hover:bg-slate-650 transition-colors border border-slate-600">
                            <input type="checkbox" class="w-5 h-5 rounded border-slate-500 bg-slate-800 text-blue-500 focus:ring-blue-500">
                            <span>HTTPS-Verschlüsselung (Schloss-Symbol)</span>
                        </label>
                        <label class="flex items-center gap-3 p-4 bg-slate-700 rounded-xl cursor-pointer hover:bg-slate-650 transition-colors border border-slate-600">
                            <input type="checkbox" class="w-5 h-5 rounded border-slate-500 bg-slate-800 text-blue-500 focus:ring-blue-500">
                            <span>Keine Werbung auf der ganzen Seite</span>
                        </label>
                        <label class="flex items-center gap-3 p-4 bg-slate-700 rounded-xl cursor-pointer hover:bg-slate-650 transition-colors border border-slate-600">
                            <input type="checkbox" class="w-5 h-5 rounded border-slate-500 bg-slate-800 text-blue-500 focus:ring-blue-500">
                            <span>Quellenangaben bei Fakten</span>
                        </label>
                    </div>
                    <button onclick="submitSelect()" class="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg active:scale-95">Absenden</button>
                </div>
            `;
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

// Socket Events
socket.on('gameStarted', (data) => {
    currentGameStatus = 'running';
    document.getElementById('waitingPhase').classList.add('hidden');
    document.getElementById('gamePhase').classList.remove('hidden');
    renderGame(data.gameType || 'binary');
});

socket.on('gameModeUpdated', (data) => {
    renderGame(data.gameType);
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
            currentGameStatus = data.gameStatus;
            currentGameType = data.gameType || 'binary';
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
            selectedColor = data.color;

            socket.emit('joinSessionRoom', currentSessionId);

            document.getElementById('rejoinPhase').classList.add('hidden');
            document.getElementById('joinPhase').classList.add('hidden');

            if (data.gameStatus === 'running') {
                document.getElementById('gamePhase').classList.remove('hidden');
                renderGame(currentGameType);
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
            document.getElementById('createTeamPhase').classList.add('hidden');
            if (currentGameStatus === 'running') {
                document.getElementById('gamePhase').classList.remove('hidden');
                renderGame(currentGameType);
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
