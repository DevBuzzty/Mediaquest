async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (!data.loggedIn) window.location.href = '/login.html';
    document.getElementById('teacherUsername').textContent = data.username;
    loadBlueprints();
}

const gameTypeSelect = document.getElementById('gameType');
const dynamicFields = document.getElementById('dynamicFields');
const previewContainer = document.getElementById('previewContainer');
const blueprintForm = document.getElementById('blueprintForm');

gameTypeSelect.addEventListener('change', renderForm);

function renderForm() {
    const type = gameTypeSelect.value;
    dynamicFields.innerHTML = '';

    if (type === 'binary') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Frage / Behauptung</label>
                <input type="text" id="question" required placeholder="Ist das ein Bot?" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Emoji / Icon (optional)</label>
                <input type="text" id="icon" placeholder="🤖" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
        `;
    } else if (type === 'choice' || type === 'select') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Frage</label>
                <input type="text" id="question" required placeholder="Worauf achtest du?" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
            <div id="optionsContainer" class="space-y-2">
                <label class="block text-sm font-medium text-slate-400 mb-1">Antwortmöglichkeiten</label>
                <input type="text" class="option-input w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4" placeholder="Option 1">
                <input type="text" class="option-input w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4" placeholder="Option 2">
                <input type="text" class="option-input w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4" placeholder="Option 3">
            </div>
            <button type="button" onclick="addOptionField()" class="text-sm text-blue-400 hover:text-blue-300">+ Option hinzufügen</button>
        `;
    }

    // Add event listeners for preview
    dynamicFields.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updatePreview);
    });
    updatePreview();
}

function addOptionField() {
    const container = document.getElementById('optionsContainer');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'option-input w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4';
    input.placeholder = `Option ${container.querySelectorAll('.option-input').length + 1}`;
    input.addEventListener('input', updatePreview);
    container.appendChild(input);
}

function updatePreview() {
    const type = gameTypeSelect.value;
    const question = document.getElementById('question')?.value || 'Deine Frage...';

    previewContainer.innerHTML = '';

    if (type === 'binary') {
        const icon = document.getElementById('icon')?.value || '🖼️';
        previewContainer.innerHTML = `
            <div class="space-y-6">
                <h2 class="text-2xl font-bold text-blue-400">Binary Swipe</h2>
                <p class="text-slate-400">${question}</p>
                <div class="w-64 h-80 mx-auto bg-slate-700 rounded-3xl border-4 border-slate-600 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden">
                    <div class="text-7xl mb-4">${icon}</div>
                    <div class="absolute bottom-0 left-0 right-0 p-4 bg-slate-800/80 border-t border-slate-600">
                        <p class="font-bold text-sm text-blue-300">Echt oder Fake?</p>
                    </div>
                </div>
            </div>
        `;
    } else if (type === 'choice') {
        const options = Array.from(document.querySelectorAll('.option-input')).map(i => i.value).filter(v => v);
        previewContainer.innerHTML = `
            <div class="space-y-6">
                <h2 class="text-2xl font-bold text-purple-400">Multiple Choice</h2>
                <p class="text-slate-400">${question}</p>
                <div class="grid grid-cols-1 gap-3">
                    ${options.map((opt, i) => `
                        <div class="bg-slate-700 p-4 rounded-xl border-2 border-slate-600 text-left">
                            ${String.fromCharCode(65 + i)}) ${opt}
                        </div>
                    `).join('') || '<p class="text-slate-600">Noch keine Optionen...</p>'}
                </div>
            </div>
        `;
    } else if (type === 'select') {
        const options = Array.from(document.querySelectorAll('.option-input')).map(i => i.value).filter(v => v);
        previewContainer.innerHTML = `
            <div class="space-y-6">
                <h2 class="text-2xl font-bold text-yellow-400">Multiple Select</h2>
                <p class="text-slate-400">${question}</p>
                <div class="space-y-2 text-left">
                    ${options.map(opt => `
                        <div class="flex items-center gap-3 p-4 bg-slate-700 rounded-xl border border-slate-600">
                            <div class="w-5 h-5 rounded border-slate-500 bg-slate-800"></div>
                            <span>${opt}</span>
                        </div>
                    `).join('') || '<p class="text-slate-600">Noch keine Optionen...</p>'}
                </div>
                <button class="w-full bg-yellow-600 text-white font-bold py-3 px-4 rounded-xl">Absenden</button>
            </div>
        `;
    }
}

blueprintForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = gameTypeSelect.value;
    const title = document.getElementById('title').value;
    const question = document.getElementById('question').value;

    let data = { question };
    if (type === 'binary') {
        data.icon = document.getElementById('icon').value;
    } else {
        data.options = Array.from(document.querySelectorAll('.option-input')).map(i => i.value).filter(v => v);
    }

    const res = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, gameType: type, content: data })
    });

    if (res.ok) {
        alert('Blueprint gespeichert!');
        blueprintForm.reset();
        renderForm();
        loadBlueprints();
    } else {
        alert('Fehler beim Speichern');
    }
});

async function loadBlueprints() {
    const res = await fetch('/api/blueprints');
    const data = await res.json();
    const list = document.getElementById('blueprintList');
    list.innerHTML = '';

    data.blueprints.forEach(bp => {
        const item = document.createElement('div');
        item.className = 'bg-slate-700 p-3 rounded-lg flex justify-between items-center group hover:bg-slate-650 transition-colors';
        item.innerHTML = `
            <div>
                <p class="font-bold text-sm">${bp.title}</p>
                <p class="text-xs text-slate-400 uppercase tracking-tighter">${bp.game_type}</p>
            </div>
            <button onclick="deleteBlueprint(${bp.id})" class="text-slate-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                &times;
            </button>
        `;
        list.appendChild(item);
    });
}

async function deleteBlueprint(id) {
    if (!confirm('Diesen Blueprint wirklich löschen?')) return;
    const res = await fetch(`/api/blueprints/${id}`, { method: 'DELETE' });
    if (res.ok) loadBlueprints();
}

checkAuth();
renderForm();
