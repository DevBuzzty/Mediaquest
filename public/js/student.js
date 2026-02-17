const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#f59e0b', '#f43f5e'];
let selectedColor = colors[0];
let currentSessionId = null;
let currentGameStatus = 'waiting';
const socket = io();
const colorPicker = document.getElementById('colorPicker');
if (colorPicker) {
    colors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = 'w-full aspect-square rounded-full border-4 border-transparent hover:scale-110';
        btn.style.backgroundColor = color;
        btn.onclick = () => {
            Array.from(colorPicker.children).forEach(c => c.style.borderColor = 'transparent');
            btn.style.borderColor = 'white';
            selectedColor = color;
        };
        colorPicker.appendChild(btn);
    });
    colorPicker.children[0].style.borderColor = 'white';
}
document.getElementById('sessionCodeInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

document.getElementById('joinBtn').addEventListener('click', async () => {
    const code = document.getElementById('sessionCodeInput').value.trim();
    const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.success) {
        currentSessionId = data.sessionId;
        currentGameStatus = data.gameStatus;
        socket.emit('joinSessionRoom', currentSessionId);
        document.getElementById('joinPhase').classList.add('hidden');
        document.getElementById('createTeamPhase').classList.remove('hidden');
    } else {
        const err = document.getElementById('joinError');
        err.textContent = data.error;
        err.classList.remove('hidden');
    }
});

// Socket Events
socket.on('gameStarted', () => {
    currentGameStatus = 'running';
    document.getElementById('waitingPhase').classList.add('hidden');
    document.getElementById('gamePhase').classList.remove('hidden');
});

socket.on('gameEnded', () => {
    // Redirect to home or show end screen
    alert('Das Spiel wurde von der Lehrkraft beendet.');
    window.location.href = '/';
});
document.getElementById('teamNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('createTeamBtn').click();
});

document.getElementById('createTeamBtn').addEventListener('click', async () => {
    const name = document.getElementById('teamNameInput').value.trim();
    const groupSize = document.getElementById('groupSizeInput').value;
    if (!name) return;
    const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, name, color: selectedColor, groupSize: parseInt(groupSize) })
    });
    const data = await res.json();
    if (data.success) {
        document.getElementById('createTeamPhase').classList.add('hidden');

        if (currentGameStatus === 'running') {
            document.getElementById('gamePhase').classList.remove('hidden');
        } else {
            document.getElementById('waitingPhase').classList.remove('hidden');
        }
        const summary = document.getElementById('teamSummary');
        summary.innerHTML = '';
        const p1 = document.createElement('p');
        p1.innerHTML = '<strong>Team: </strong>';
        p1.appendChild(document.createTextNode(name));
        const p2 = document.createElement('p');
        p2.innerHTML = '<strong>Größe: </strong>';
        p2.appendChild(document.createTextNode(groupSize));
        summary.appendChild(p1);
        summary.appendChild(p2);
    } else {
        const err = document.getElementById('createTeamError');
        err.textContent = data.error;
        err.classList.remove('hidden');
    }
});
