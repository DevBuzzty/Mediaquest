const colors = [
    '#ef4444', // Red
    '#3b82f6', // Blue
    '#22c55e', // Green
    '#eab308', // Yellow
    '#a855f7', // Purple
    '#ec4899', // Pink
    '#6366f1', // Indigo
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#84cc16'  // Lime
];
let selectedColor = null;
let currentSessionId = null;
let currentGameStatus = 'waiting';
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

document.getElementById('sessionCodeInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

document.getElementById('teamCodeInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('rejoinBtn').click();
});

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

document.getElementById('joinBtn').addEventListener('click', async () => {
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

document.getElementById('rejoinBtn').addEventListener('click', async () => {
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
            selectedColor = data.color;

            socket.emit('joinSessionRoom', currentSessionId);

            document.getElementById('rejoinPhase').classList.add('hidden');
            document.getElementById('joinPhase').classList.add('hidden');

            if (currentGameStatus === 'running') {
                document.getElementById('gamePhase').classList.remove('hidden');
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

// Socket Events
socket.on('colorPicked', (color) => {
    if (!takenColors.includes(color)) {
        takenColors.push(color);
        renderColorPicker();
    }
});

socket.on('colorFreed', (color) => {
    takenColors = takenColors.filter(c => c !== color);
    renderColorPicker();
});

socket.on('gameStarted', () => {
    currentGameStatus = 'running';
    if (!document.getElementById('waitingPhase').classList.contains('hidden')) {
        document.getElementById('waitingPhase').classList.add('hidden');
        document.getElementById('gamePhase').classList.remove('hidden');
    }
});

socket.on('gameEnded', () => {
    alert('Das Spiel wurde von der Lehrkraft beendet.');
    window.location.href = '/';
});

document.getElementById('teamNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('createTeamBtn').click();
});

document.getElementById('createTeamBtn').addEventListener('click', async () => {
    const name = document.getElementById('teamNameInput').value.trim();
    const groupSize = parseInt(document.getElementById('groupSizeInput').value);

    if (!name) {
        alert('Bitte gib einen Teamnamen ein.');
        return;
    }
    if (!selectedColor) {
        alert('Bitte wähle eine Farbe aus.');
        return;
    }
    if (isNaN(groupSize) || groupSize < 1 || groupSize > 10) {
        alert('Gruppengröße muss zwischen 1 und 10 liegen.');
        return;
    }

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
