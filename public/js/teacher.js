const socket = io();

let myBlueprints = [];
let currentSessionId = null;

async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (!data.loggedIn) window.location.href = '/login.html';
    else {
        document.getElementById('teacherUsername').textContent = data.username;
        loadBlueprints();
        loadActiveSession();
        loadHistory();
    }
}

async function loadBlueprints() {
    const res = await fetch('/api/blueprints');
    const data = await res.json();
    myBlueprints = data.blueprints;
    updateBlueprintSelects();
}

function updateBlueprintSelects() {
    const mainSelect = document.getElementById('blueprintSelect');
    const devList = document.getElementById('devBlueprintList');
    if (!mainSelect || !devList) return;

    mainSelect.innerHTML = '<option value="">Spielrunde wählen...</option>';
    devList.innerHTML = '';

    myBlueprints.forEach(bp => {
        // Add to main select
        const opt = document.createElement('option');
        opt.value = bp.id;
        opt.textContent = `${bp.title} (${bp.game_type})`;
        mainSelect.appendChild(opt);

        // Add to dev list
        const btn = document.createElement('button');
        btn.className = 'bg-slate-700 hover:bg-blue-600 px-3 py-1 rounded text-[10px] transition-colors border border-slate-600';
        btn.textContent = bp.title;
        btn.onclick = () => sendBlueprint(bp.id);
        devList.appendChild(btn);
    });
}

document.getElementById('blueprintSelect')?.addEventListener('change', (e) => {
    const bpId = e.target.value;
    const info = document.getElementById('selectedTemplateInfo');
    const countDisp = document.getElementById('taskCountDisplay');

    if (!bpId) {
        info.classList.add('hidden');
        return;
    }

    const bp = myBlueprints.find(b => b.id == bpId);
    if (bp) {
        info.classList.remove('hidden');
        countDisp.textContent = bp.content.tasks.length;
    }
});

async function loadActiveSession() {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();
    if (data.active) {
        currentSessionId = data.session.id;
        document.getElementById('activeSessionContainer').classList.remove('hidden');
        document.getElementById('noActiveSessionContainer').classList.add('hidden');
        document.getElementById('sessionCodeDisplay').textContent = data.session.code;
        document.getElementById('updateMaxTeams').value = data.session.max_teams;

        if (data.session.game_status === 'running') {
            document.getElementById('lobbyView').classList.add('hidden');
            document.getElementById('gameView').classList.remove('hidden');

            const bp = data.session.blueprint;
            if (bp) {
                window.currentActiveBlueprint = bp;
                renderTemplateOverview(bp);
                if (bp.content?.templateType === 'qr') {
                    document.getElementById('activeGameModeDisplay').innerHTML = `
                        <div class="flex flex-col items-center gap-2">
                            <span>QR-MODE: ${bp.title}</span>
                            <button onclick="showSessionQrCodes()" class="bg-blue-600 hover:bg-blue-500 text-[10px] px-3 py-1 rounded-full text-white font-black uppercase tracking-widest transition-all">QR-Codes anzeigen</button>
                        </div>
                    `;
                } else {
                    document.getElementById('activeGameModeDisplay').textContent = `${bp.title} (${data.session.game_type})`;
                }
            } else {
                document.getElementById('activeGameModeDisplay').textContent = data.session.game_type;
                document.getElementById('templateOverviewList').innerHTML = '<p class="text-xs text-slate-500 italic">Kein Template aktiv.</p>';
            }

            const gameTeamList = document.getElementById('activeGameTeamList');
            gameTeamList.innerHTML = '';
            data.teams.forEach(team => addTeamCardToGame(team));

            loadSubmissions(data.session.id);
        } else {
            document.getElementById('lobbyView').classList.remove('hidden');
            document.getElementById('gameView').classList.add('hidden');
        }

        const teamList = document.getElementById('teamList');
        teamList.innerHTML = '';
        data.teams.forEach(addTeamCard);
        socket.emit('joinSessionRoom', data.session.id);
    } else {
        document.getElementById('activeSessionContainer').classList.add('hidden');
        document.getElementById('noActiveSessionContainer').classList.remove('hidden');
    }
}

function addTeamCard(team) {
    const teamList = document.getElementById('teamList');
    const card = document.createElement('div');
    card.id = `team-card-${team.id}`;
    card.className = 'bg-slate-700 border-l-4 p-4 rounded-r-lg shadow flex items-center justify-between group';
    card.style.borderLeftColor = team.color;

    const content = document.createElement('div');
    const h4 = document.createElement('h4');
    h4.className = 'font-bold text-lg';
    h4.textContent = team.name;

    const p = document.createElement('p');
    p.className = 'text-xs text-slate-400';
    p.innerHTML = `Code: <span class="text-white font-mono font-bold">${team.team_code || '---'}</span> | Größe: ${team.group_size}`;

    content.appendChild(h4);
    content.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-3';

    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-500 hover:text-red-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
    `;
    deleteBtn.onclick = () => deleteTeam(team.id, team.name);

    const colorCircle = document.createElement('div');
    colorCircle.className = 'w-4 h-4 rounded-full';
    colorCircle.style.backgroundColor = team.color;

    actions.appendChild(deleteBtn);
    actions.appendChild(colorCircle);

    card.appendChild(content);
    card.appendChild(actions);
    teamList.appendChild(card);
}

async function deleteTeam(id, name) {
    if (!await confirm(`Team "${name}" wirklich löschen?`)) return;
    const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' });
    if (!res.ok) alert('Fehler beim Löschen');
}

socket.on('teamCreated', addTeamCard);
socket.on('teamDeleted', (id) => {
    const card = document.getElementById(`team-card-${id}`);
    if (card) card.remove();
    const gameCard = document.getElementById(`game-team-card-${id}`);
    if (gameCard) gameCard.remove();
});

socket.on('teamTaskUpdate', (data) => {
    const statusEl = document.getElementById(`team-status-${data.teamId}`);
    if (statusEl) {
        statusEl.innerHTML = `
            <div class="flex flex-col">
                <span class="text-[9px] uppercase font-black text-blue-500">Aktuelle Aufgabe</span>
                <span class="text-xs font-bold text-white">${data.taskTitle || `Station ${data.taskIndex + 1}`}</span>
            </div>
        `;
        const card = document.getElementById(`game-team-card-${data.teamId}`);
        if (card) {
            card.classList.add('ring-2', 'ring-blue-500', 'bg-slate-700');
            setTimeout(() => card.classList.remove('ring-2', 'ring-blue-500'), 2000);
        }
    }
});

socket.on('newSubmission', (data) => {
    addSubmissionCard(data);
});

async function loadSubmissions(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/submissions`);
    const data = await res.json();
    const list = document.getElementById('submissionsList');
    list.innerHTML = '';
    data.submissions.forEach(addSubmissionCard);
}

function renderTemplateOverview(bp) {
    const list = document.getElementById('templateOverviewList');
    list.innerHTML = '';

    if (!bp.content?.tasks) return;

    bp.content.tasks.forEach((task, i) => {
        const item = document.createElement('div');
        item.className = 'bg-slate-800 p-3 rounded-xl border border-slate-700 flex flex-col gap-1';

        const typeIcon = getTaskIcon(task.type);

        item.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="text-[10px] font-black text-slate-500 uppercase">Station ${i+1}</span>
                <span class="text-[10px] bg-slate-700 px-2 py-0.5 rounded text-blue-400 font-mono">${task.code || '---'}</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-lg">${typeIcon}</span>
                <span class="text-xs font-bold text-slate-300 truncate">${task.question || task.type}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

function getTaskIcon(type) {
    const icons = {
        'binary': '↔️', 'choice': '🔘', 'select': '✅', 'chat': '💬',
        'scroller': '📱', 'detector': '🔍', 'hotspot': '🎯', 'password': '🔐',
        'photo': '📸', 'statement': '📝', 'profile': '👤', 'mood': '🌡️',
        'bucket': '🗑️', 'ranking': '🔢', 'pairs': '🔗', 'cloze': '🔤', 'countdown': '⏳'
    };
    return icons[type] || '🎮';
}

function addTeamCardToGame(team) {
    const list = document.getElementById('activeGameTeamList');
    const card = document.createElement('div');
    card.id = `game-team-card-${team.id}`;
    card.className = 'bg-slate-800/50 p-4 rounded-2xl border-l-4 border-slate-700 flex items-center justify-between transition-all';
    card.style.borderLeftColor = team.color;

    const leftDiv = document.createElement('div');
    leftDiv.className = 'flex items-center gap-4';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'w-10 h-10 rounded-full flex items-center justify-center text-white font-black';
    iconDiv.style.backgroundColor = team.color;
    iconDiv.textContent = team.name.charAt(0);

    const infoDiv = document.createElement('div');
    const h4 = document.createElement('h4');
    h4.className = 'font-bold text-sm';
    h4.textContent = team.name;

    const statusDiv = document.createElement('div');
    statusDiv.id = `team-status-${team.id}`;
    statusDiv.className = 'mt-1';
    statusDiv.innerHTML = '<span class="text-[10px] text-slate-500 italic">Wartet auf Start...</span>';

    infoDiv.appendChild(h4);
    infoDiv.appendChild(statusDiv);
    leftDiv.appendChild(iconDiv);
    leftDiv.appendChild(infoDiv);

    const sizeDiv = document.createElement('div');
    sizeDiv.className = 'text-[9px] font-black text-slate-600 bg-slate-900 px-2 py-1 rounded';
    sizeDiv.textContent = `SIZE: ${team.group_size}`;

    card.appendChild(leftDiv);
    card.appendChild(sizeDiv);

    list.appendChild(card);
}

function addSubmissionCard(sub) {
    const list = document.getElementById('submissionsList');
    const card = document.createElement('div');
    card.className = 'bg-slate-700 p-3 rounded-lg border-l-4 shadow-lg flex flex-col gap-2';
    card.style.borderLeftColor = sub.team_color || '#3b82f6';

    const header = document.createElement('p');
    header.className = 'text-[10px] font-bold uppercase text-slate-400';
    header.textContent = `${sub.team_name || 'Team'} - ${sub.type}`;

    card.appendChild(header);

    if (sub.type === 'photo') {
        const img = document.createElement('img');
        img.src = sub.content;
        img.className = 'w-full h-32 object-cover rounded cursor-pointer';
        img.onclick = () => window.open(sub.content);
        card.appendChild(img);
    } else {
        const p = document.createElement('p');
        p.className = 'text-sm italic text-slate-300';
        p.textContent = `"${sub.content}"`;
        card.appendChild(p);
    }

    list.prepend(card);
}

async function loadHistory() {
    const res = await fetch('/api/sessions/history');
    const data = await res.json();
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    data.sessions.forEach(session => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-700 hover:bg-slate-750';
        tr.innerHTML = `
            <td class="p-4 text-sm">${new Date(session.created_at).toLocaleString()}</td>
            <td class="p-4 font-mono font-bold">${session.code}</td>
            <td class="p-4">${session.max_teams}</td>
            <td class="p-4"><span class="bg-slate-600 px-2 py-1 rounded text-xs">Beendet</span></td>
            <td class="p-4 flex gap-4">
                <button onclick="viewDetails(${session.id}, '${session.code}')" class="text-blue-400 hover:underline">Details</button>
                <button onclick="reopenSession(${session.id})" class="text-green-400 hover:underline">Fortsetzen</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function reopenSession(id) {
    if (!await confirm('Diese Session wieder eröffnen? Eine eventuell aktive Session wird dabei geschlossen.')) return;
    const res = await fetch(`/api/sessions/${id}/reopen`, { method: 'POST' });
    if (res.ok) loadActiveSession();
    else alert('Fehler beim Wiedereröffnen');
}

async function viewDetails(id, code) {
    const res = await fetch(`/api/sessions/${id}/teams`);
    const data = await res.json();
    document.getElementById('modalTitle').textContent = `Teams in Session ${code}`;
    const content = document.getElementById('modalContent');
    content.innerHTML = '';

    if (data.teams.length === 0) {
        content.innerHTML = '<p class="text-slate-400">Keine Teams gefunden.</p>';
    } else {
        const div = document.createElement('div');
        div.className = 'grid grid-cols-2 gap-4';
        data.teams.forEach(team => {
            const item = document.createElement('div');
            item.className = 'p-3 bg-slate-700 rounded-lg border-l-4';
            item.style.borderLeftColor = team.color;

            const nameDiv = document.createElement('div');
            nameDiv.className = 'font-bold';
            nameDiv.textContent = team.name;

            const sizeDiv = document.createElement('div');
            sizeDiv.className = 'text-xs text-slate-400';
            sizeDiv.textContent = `Größe: ${team.group_size}`;

            item.appendChild(nameDiv);
            item.appendChild(sizeDiv);
            div.appendChild(item);
        });
        content.appendChild(div);
    }
    document.getElementById('detailsModal').classList.remove('hidden');
}

document.getElementById('startSessionBtn').addEventListener('click', async () => {
    const maxTeams = parseInt(document.getElementById('maxTeams').value);
    const blueprintId = document.getElementById('blueprintSelect').value;

    if (!blueprintId) return WeltenretterUI.alert('Bitte wähle ein Spielrunden-Template aus!', 'Fehlende Auswahl', '⚠️');

    const bp = myBlueprints.find(b => b.id == blueprintId);

    const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTeams, gameType: 'template', blueprintId })
    });
    if (res.ok) loadActiveSession();
    else alert('Fehler beim Starten der Session');
});

document.getElementById('updateLimitBtn').addEventListener('click', async () => {
    const maxTeams = parseInt(document.getElementById('updateMaxTeams').value);
    const res = await fetch('/api/sessions/active/limit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTeams })
    });
    if (res.ok) alert('Limit aktualisiert');
    else {
        const data = await res.json();
        alert(data.error || 'Fehler beim Aktualisieren');
    }
});

document.getElementById('startGameBtn').addEventListener('click', async () => {
    const res = await fetch('/api/sessions/active/start', { method: 'POST' });
    if (res.ok) {
        loadActiveSession();
    } else alert('Fehler beim Starten');
});

document.getElementById('endGameBtn').addEventListener('click', async () => {
    if (!await confirm('Spiel beenden?')) return;
    const res = await fetch('/api/sessions/active/end', { method: 'POST' });
    if (res.ok) {
        document.getElementById('lobbyView').classList.remove('hidden');
        document.getElementById('gameView').classList.add('hidden');
    } else alert('Fehler beim Beenden');
});

document.getElementById('showResultsBtn').addEventListener('click', () => {
    socket.emit('showResults', { sessionId: currentSessionId });
    showSummaryView();
});

async function showSummaryView() {
    const res = await fetch(`/api/sessions/${currentSessionId}/submissions`);
    const data = await res.json();

    document.getElementById('modalTitle').textContent = "Abschluss-Ergebnisse (Alle Teams)";
    const content = document.getElementById('modalContent');
    content.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>';
    const grid = content.querySelector('div');

    data.submissions.forEach(sub => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-slate-700 rounded-lg border-l-4 shadow';
        item.style.borderLeftColor = sub.team_color;

        const nameP = document.createElement('p');
        nameP.className = 'text-[10px] font-bold text-slate-400 uppercase';
        nameP.textContent = sub.team_name;
        item.appendChild(nameP);

        if (sub.type === 'photo') {
            const img = document.createElement('img');
            img.src = sub.content;
            img.className = 'w-full h-32 object-cover rounded mt-1';
            item.appendChild(img);
        } else {
            const p = document.createElement('p');
            p.className = 'text-sm italic mt-1 text-slate-200';
            p.textContent = `"${sub.content}"`;
            item.appendChild(p);
        }

        grid.appendChild(item);
    });

    document.getElementById('detailsModal').classList.remove('hidden');
}

document.getElementById('closeSessionBtn').addEventListener('click', async () => {
    if (!await confirm('Session wirklich schließen?')) return;
    await fetch('/api/sessions/close', { method: 'POST' });
    loadActiveSession();
    loadHistory();
});

function showSessionQrCodes() {
    const bp = window.currentActiveBlueprint;
    if (!bp) return;

    document.getElementById('modalTitle').textContent = `QR-Codes: ${bp.title}`;
    const content = document.getElementById('modalContent');
    content.innerHTML = `
        <p class="text-sm text-slate-400 mb-6 text-center">Drucke diese QR-Codes aus oder zeige sie an den Stationen.</p>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-6 max-h-[500px] overflow-y-auto p-4">
            ${bp.content.tasks.map((task, i) => `
                <div class="bg-slate-900 p-4 rounded-2xl flex flex-col items-center gap-3 border border-slate-700">
                    <span class="text-[10px] font-black text-slate-500 uppercase">Station ${i+1}</span>
                    <div id="modal-qr-${i}" class="bg-white p-2 rounded-lg"></div>
                    <span class="text-xl font-black text-blue-500 tracking-widest">${task.code}</span>
                    <span class="text-[9px] text-slate-600 uppercase font-bold text-center">${task.type}</span>
                </div>
            `).join('')}
        </div>
        <div class="mt-6 flex justify-center">
            <button onclick="window.print()" class="bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-xl text-xs font-bold transition-all">Druck-Ansicht öffnen</button>
        </div>
    `;

    document.getElementById('detailsModal').classList.remove('hidden');

    // Render QRs
    bp.content.tasks.forEach((task, i) => {
        setTimeout(() => {
            new QRCode(document.getElementById(`modal-qr-${i}`), {
                text: task.code,
                width: 100,
                height: 100
            });
        }, 10);
    });
}

async function changeGameMode(mode) {
    const res = await fetch('/api/sessions/active/mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: mode, blueprintId: null })
    });
    if (res.ok) {
        document.getElementById('activeGameModeDisplay').textContent = mode;
    } else {
        alert('Fehler beim Modus-Wechsel');
    }
}

async function sendBlueprint(id) {
    const bp = myBlueprints.find(b => b.id == id);
    if (!bp) return;

    const res = await fetch('/api/sessions/active/mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: bp.game_type, blueprintId: bp.id })
    });

    if (res.ok) {
        document.getElementById('activeGameModeDisplay').textContent = `${bp.game_type} (${bp.title})`;
    } else {
        alert('Fehler beim Senden des Blueprints');
    }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
});

checkAuth();
