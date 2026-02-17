const socket = io();

async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (!data.loggedIn) window.location.href = '/login.html';
    else {
        document.getElementById('teacherUsername').textContent = data.username;
        loadActiveSession();
        loadHistory();
    }
}

async function loadActiveSession() {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();
    if (data.active) {
        document.getElementById('activeSessionContainer').classList.remove('hidden');
        document.getElementById('noActiveSessionContainer').classList.add('hidden');
        document.getElementById('sessionCodeDisplay').textContent = data.session.code;
        document.getElementById('updateMaxTeams').value = data.session.max_teams;

        if (data.session.game_status === 'running') {
            document.getElementById('lobbyView').classList.add('hidden');
            document.getElementById('gameView').classList.remove('hidden');
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
    if (!confirm(`Team "${name}" wirklich löschen?`)) return;
    const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' });
    if (!res.ok) alert('Fehler beim Löschen');
}

socket.on('teamCreated', addTeamCard);
socket.on('teamDeleted', (id) => {
    const card = document.getElementById(`team-card-${id}`);
    if (card) card.remove();
});

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
    if (!confirm('Diese Session wieder eröffnen? Eine eventuell aktive Session wird dabei geschlossen.')) return;
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
    const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTeams })
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
        document.getElementById('lobbyView').classList.add('hidden');
        document.getElementById('gameView').classList.remove('hidden');
    } else alert('Fehler beim Starten');
});

document.getElementById('endGameBtn').addEventListener('click', async () => {
    if (!confirm('Spiel beenden?')) return;
    const res = await fetch('/api/sessions/active/end', { method: 'POST' });
    if (res.ok) {
        document.getElementById('lobbyView').classList.remove('hidden');
        document.getElementById('gameView').classList.add('hidden');
    } else alert('Fehler beim Beenden');
});

document.getElementById('closeSessionBtn').addEventListener('click', async () => {
    if (!confirm('Session wirklich schließen?')) return;
    await fetch('/api/sessions/close', { method: 'POST' });
    loadActiveSession();
    loadHistory();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
});

checkAuth();
