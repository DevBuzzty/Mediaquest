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
    card.className = 'bg-slate-700 border-l-4 p-4 rounded-r-lg shadow flex items-center justify-between';
    card.style.borderLeftColor = team.color;
    const content = document.createElement('div');
    const h4 = document.createElement('h4');
    h4.className = 'font-bold text-lg';
    h4.textContent = team.name;
    const p = document.createElement('p');
    p.className = 'text-xs text-slate-400';
    p.textContent = `Beigetreten: ${new Date(team.created_at).toLocaleTimeString()}`;
    content.appendChild(h4);
    content.appendChild(p);
    const color = document.createElement('div');
    color.className = 'w-4 h-4 rounded-full';
    color.style.backgroundColor = team.color;
    card.appendChild(content);
    card.appendChild(color);
    teamList.appendChild(card);
}
socket.on('teamCreated', addTeamCard);
async function loadHistory() {
    const res = await fetch('/api/sessions/history');
    const data = await res.json();
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    data.sessions.forEach(session => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-700 hover:bg-slate-750';
        tr.innerHTML = `<td class="p-4 text-sm">${new Date(session.created_at).toLocaleString()}</td>
            <td class="p-4 font-mono font-bold">${session.code}</td>
            <td class="p-4">${session.max_teams}</td>
            <td class="p-4"><span class="bg-slate-600 px-2 py-1 rounded text-xs">Beendet</span></td>
            <td class="p-4"><button onclick="viewDetails(${session.id}, '${session.code}')" class="text-blue-400 hover:underline">Details</button></td>`;
        tbody.appendChild(tr);
    });
}
async function viewDetails(id, code) {
    const res = await fetch(`/api/sessions/${id}/teams`);
    const data = await res.json();
    document.getElementById('modalTitle').textContent = `Teams in Session ${code}`;
    const content = document.getElementById('modalContent');
    content.innerHTML = '';
    if (data.teams.length === 0) content.innerHTML = '<p class="text-slate-400">Keine Teams.</p>';
    else {
        const div = document.createElement('div');
        div.className = 'space-y-2';
        data.teams.forEach(team => {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-2 bg-slate-700 rounded';
            const col = document.createElement('div');
            col.className = 'w-4 h-4 rounded-full';
            col.style.backgroundColor = team.color;
            const span = document.createElement('span');
            span.className = 'font-bold';
            span.textContent = team.name;
            item.appendChild(col);
            item.appendChild(span);
            div.appendChild(item);
        });
        content.appendChild(div);
    }
    document.getElementById('detailsModal').classList.remove('hidden');
}
document.getElementById('startSessionBtn').addEventListener('click', async () => {
    const maxTeams = document.getElementById('maxTeams').value;
    await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTeams })
    });
    loadActiveSession();
});
document.getElementById('closeSessionBtn').addEventListener('click', async () => {
    if (!confirm('Session beenden?')) return;
    await fetch('/api/sessions/close', { method: 'POST' });
    loadActiveSession();
    loadHistory();
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
});
checkAuth();
