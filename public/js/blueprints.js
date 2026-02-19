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

async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return null;
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (data.success) {
        input.dataset.url = data.url;
        // Show a small preview if possible
        const preview = input.parentElement.querySelector('.img-preview');
        if (preview) preview.src = data.url;
        return data.url;
    }
    return null;
}

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
    } else if (type === 'chat') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Name des Gegenübers</label>
                <input type="text" id="chatPartner" required placeholder="Unbekannt" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
            <div id="chatNodes" class="space-y-4">
                <h3 class="font-bold text-sm text-slate-300 mt-4">Dialog-Baum (JSON Format für Fortgeschrittene)</h3>
                <textarea id="chatJson" class="w-full h-40 bg-slate-900 font-mono text-xs p-2 border border-slate-700" placeholder='{ "start": { "text": "Hallo!", "options": [ { "label": "Hi!", "next": "next" } ] } }'></textarea>
                <p class="text-[10px] text-slate-500 italic">Hinweis: Standard-Struktur wird verwendet, wenn leer.</p>
            </div>
        `;
    } else if (type === 'scroller') {
        dynamicFields.innerHTML = `
            <div id="postsContainer" class="space-y-4">
                <label class="block text-sm font-medium text-slate-400 mb-1">Posts für den Feed</label>
                <div class="post-entry p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-2">
                    <input type="text" class="post-user w-full bg-slate-700 p-2 text-sm rounded" placeholder="Benutzername">
                    <textarea class="post-text w-full bg-slate-700 p-2 text-sm rounded" placeholder="Inhalt"></textarea>
                    <label class="flex items-center gap-2 text-xs">
                        <input type="checkbox" class="post-is-bad"> Ist Hassrede / Fake News?
                    </label>
                </div>
            </div>
            <button type="button" onclick="addPostField()" class="text-sm text-blue-400 hover:text-blue-300">+ Post hinzufügen</button>
        `;
    } else if (type === 'detector') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Bild zum Untersuchen</label>
                <input type="file" accept="image/*" onchange="handleFileUpload(this)" class="w-full text-sm text-slate-400">
                <img class="img-preview h-20 mt-2 rounded border border-slate-700">
            </div>
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Anleitung</label>
                <input type="text" id="question" value="Nutze die Lupe um Fehler zu finden." class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
        `;
    } else if (type === 'hotspot') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Hintergrundbild</label>
                <input type="file" id="hotspotImageInput" accept="image/*" onchange="handleHotspotImageLoad(this)" class="w-full text-sm text-slate-400">
            </div>
            <div id="hotspotEditor" class="relative bg-black w-full aspect-video mt-4 overflow-hidden cursor-crosshair hidden">
                <img id="hotspotImgDisplay" class="w-full h-full object-contain pointer-events-none">
                <div id="hotspotOverlay" class="absolute inset-0"></div>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">Ziehe mit der Maus Rechtecke über die verdächtigen Stellen.</p>
            <input type="hidden" id="hotspotData">
            <button type="button" onclick="clearHotspots()" class="text-xs text-red-400 mt-2">Zonen löschen</button>
        `;
    } else if (type === 'password') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Anforderungen (getrennt durch Komma)</label>
                <input type="text" id="rules" placeholder="Sonderzeichen, Zahl, > 8 Zeichen" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Lösung (Optional)</label>
                <input type="text" id="solution" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
        `;
    } else if (type === 'profile') {
        dynamicFields.innerHTML = `
            <div class="space-y-2">
                <label class="block text-sm font-medium text-slate-400 mb-1">Felder im Profil</label>
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <label><input type="checkbox" checked value="name" class="profile-field"> Name</label>
                    <label><input type="checkbox" checked value="age" class="profile-field"> Alter</label>
                    <label><input type="checkbox" checked value="location" class="profile-field"> Wohnort</label>
                    <label><input type="checkbox" checked value="hobbies" class="profile-field"> Hobbies</label>
                    <label><input type="checkbox" checked value="photo" class="profile-field"> Profilbild</label>
                    <label><input type="checkbox" checked value="email" class="profile-field"> E-Mail</label>
                </div>
                <div id="customProfileFields" class="space-y-1 mt-4">
                     <input type="text" class="custom-profile-input w-full bg-slate-700 p-2 text-xs rounded" placeholder="Eigener Feldname (z.B. Schule)">
                </div>
                <button type="button" onclick="addCustomProfileField()" class="text-[10px] text-blue-400">+ Eigenes Feld</button>
            </div>
        `;
    } else if (type === 'mood') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Frage</label>
                <input type="text" id="question" required placeholder="Wie fühlst du dich bei dieser Nachricht?" class="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-4">
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="text-[10px] text-slate-500">Label Links</label>
                    <input type="text" id="labelLeft" value="Ganz schlecht" class="w-full bg-slate-700 p-2 rounded">
                </div>
                <div>
                    <label class="text-[10px] text-slate-500">Label Rechts</label>
                    <input type="text" id="labelRight" value="Super gut" class="w-full bg-slate-700 p-2 rounded">
                </div>
            </div>
        `;
    } else if (type === 'bucket') {
        dynamicFields.innerHTML = `
            <div id="bucketsContainer" class="space-y-2">
                <label class="block text-sm font-medium text-slate-400 mb-1">Kategorien (Buckets)</label>
                <input type="text" class="bucket-name w-full bg-slate-700 p-2 rounded mb-2" placeholder="Korb Name (z.B. Privat)">
                <input type="text" class="bucket-name w-full bg-slate-700 p-2 rounded mb-2" placeholder="Korb Name (z.B. Öffentlich)">
            </div>
            <button type="button" onclick="addBucketField()" class="text-xs text-blue-400">+ Korb hinzufügen (Max 4)</button>
            <div id="bucketItems" class="mt-4 space-y-2">
                <label class="block text-sm font-medium text-slate-400 mb-1">Begriffe / Items</label>
                <div class="flex gap-2">
                    <input type="text" class="item-text flex-1 bg-slate-700 p-2 rounded" placeholder="z.B. Telefonnummer">
                    <input type="number" class="item-target w-16 bg-slate-700 p-2 rounded" placeholder="Korb #">
                </div>
            </div>
            <button type="button" onclick="addBucketItem()" class="text-xs text-blue-400">+ Begriff hinzufügen</button>
        `;
    } else if (type === 'ranking') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Elemente in der richtigen Reihenfolge (Oben = Platz 1)</label>
                <div id="rankingContainer" class="space-y-2">
                    <input type="text" class="ranking-item w-full bg-slate-700 p-2 rounded" placeholder="Element 1">
                    <input type="text" class="ranking-item w-full bg-slate-700 p-2 rounded" placeholder="Element 2">
                </div>
                <button type="button" onclick="addRankingField()" class="text-xs text-blue-400 mt-2">+ Element hinzufügen</button>
            </div>
        `;
    } else if (type === 'pairs') {
        dynamicFields.innerHTML = `
            <label class="block text-sm font-medium text-slate-400 mb-1">Paare (Links & Rechts)</label>
            <div id="pairsContainer" class="space-y-2">
                <div class="flex gap-2">
                    <input type="text" class="pair-left flex-1 bg-slate-700 p-2 rounded" placeholder="Links">
                    <input type="text" class="pair-right flex-1 bg-slate-700 p-2 rounded" placeholder="Rechts">
                </div>
            </div>
            <button type="button" onclick="addPairField()" class="text-xs text-blue-400 mt-2">+ Paar hinzufügen</button>
        `;
    } else if (type === 'cloze') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Text mit Lücken (Lücken als [WORT] schreiben)</label>
                <textarea id="clozeText" class="w-full h-32 bg-slate-700 p-2 rounded" placeholder="Das [Internet] ist für viele [Neuland]."></textarea>
            </div>
        `;
    } else if (type === 'countdown') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Zeit in Sekunden</label>
                <input type="number" id="duration" value="60" class="w-full bg-slate-700 p-2 rounded">
            </div>
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Aufgabentext</label>
                <input type="text" id="question" placeholder="Stellt pantomimisch ein Passwort dar!" class="w-full bg-slate-700 p-2 rounded">
            </div>
        `;
    } else if (type === 'photo' || type === 'statement') {
        dynamicFields.innerHTML = `
            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Anleitung / Aufgabe</label>
                <input type="text" id="question" required placeholder="Mache ein Foto von..." class="w-full bg-slate-700 p-2 rounded">
            </div>
        `;
    }

    // Add event listeners for preview
    dynamicFields.querySelectorAll('input, textarea, select').forEach(input => {
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

function addPostField() {
    const container = document.getElementById('postsContainer');
    const div = document.createElement('div');
    div.className = 'post-entry p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-2';
    div.innerHTML = `
        <input type="text" class="post-user w-full bg-slate-700 p-2 text-sm rounded" placeholder="Benutzername">
        <textarea class="post-text w-full bg-slate-700 p-2 text-sm rounded" placeholder="Inhalt"></textarea>
        <label class="flex items-center gap-2 text-xs">
            <input type="checkbox" class="post-is-bad"> Ist Hassrede / Fake News?
        </label>
    `;
    div.querySelectorAll('input, textarea').forEach(i => i.addEventListener('input', updatePreview));
    container.appendChild(div);
}

function addCustomProfileField() {
    const container = document.getElementById('customProfileFields');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-profile-input w-full bg-slate-700 p-2 text-xs rounded';
    input.placeholder = 'Eigener Feldname';
    input.addEventListener('input', updatePreview);
    container.appendChild(input);
}

function addBucketField() {
    const container = document.getElementById('bucketsContainer');
    if (container.querySelectorAll('.bucket-name').length >= 4) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bucket-name w-full bg-slate-700 p-2 rounded mb-2';
    input.placeholder = `Korb Name ${container.querySelectorAll('.bucket-name').length + 1}`;
    input.addEventListener('input', updatePreview);
    container.appendChild(input);
}

function addBucketItem() {
    const container = document.getElementById('bucketItems');
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `
        <input type="text" class="item-text flex-1 bg-slate-700 p-2 rounded" placeholder="z.B. Passwort">
        <input type="number" class="item-target w-16 bg-slate-700 p-2 rounded" placeholder="Korb #">
    `;
    div.querySelectorAll('input').forEach(i => i.addEventListener('input', updatePreview));
    container.appendChild(div);
}

function addRankingField() {
    const container = document.getElementById('rankingContainer');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ranking-item w-full bg-slate-700 p-2 rounded';
    input.placeholder = `Element ${container.querySelectorAll('.ranking-item').length + 1}`;
    input.addEventListener('input', updatePreview);
    container.appendChild(input);
}

function addPairField() {
    const container = document.getElementById('pairsContainer');
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `
        <input type="text" class="pair-left flex-1 bg-slate-700 p-2 rounded" placeholder="Links">
        <input type="text" class="pair-right flex-1 bg-slate-700 p-2 rounded" placeholder="Rechts">
    `;
    div.querySelectorAll('input').forEach(i => i.addEventListener('input', updatePreview));
    container.appendChild(div);
}

// Hotspot Logic
let hotspots = [];
function handleHotspotImageLoad(input) {
    handleFileUpload(input).then(url => {
        if (url) {
            const editor = document.getElementById('hotspotEditor');
            const img = document.getElementById('hotspotImgDisplay');
            img.src = url;
            editor.classList.remove('hidden');
            initHotspotEditor();
        }
    });
}

function initHotspotEditor() {
    const overlay = document.getElementById('hotspotOverlay');
    let startX, startY, isDrawing = false, currentRect = null;

    overlay.onmousedown = (e) => {
        isDrawing = true;
        const rect = overlay.getBoundingClientRect();
        startX = ((e.clientX - rect.left) / rect.width) * 100;
        startY = ((e.clientY - rect.top) / rect.height) * 100;

        currentRect = document.createElement('div');
        currentRect.className = 'absolute border-2 border-red-500 bg-red-500/20';
        currentRect.style.left = startX + '%';
        currentRect.style.top = startY + '%';
        overlay.appendChild(currentRect);
    };

    window.onmousemove = (e) => {
        if (!isDrawing) return;
        const rect = overlay.getBoundingClientRect();
        let currX = ((e.clientX - rect.left) / rect.width) * 100;
        let currY = ((e.clientY - rect.top) / rect.height) * 100;

        currentRect.style.width = Math.abs(currX - startX) + '%';
        currentRect.style.height = Math.abs(currY - startY) + '%';
        currentRect.style.left = Math.min(currX, startX) + '%';
        currentRect.style.top = Math.min(currY, startY) + '%';
    };

    window.onmouseup = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        const rect = {
            x: parseFloat(currentRect.style.left),
            y: parseFloat(currentRect.style.top),
            w: parseFloat(currentRect.style.width),
            h: parseFloat(currentRect.style.height)
        };
        if (rect.w > 1 && rect.h > 1) {
            hotspots.push(rect);
            document.getElementById('hotspotData').value = JSON.stringify(hotspots);
            updatePreview();
        } else {
            currentRect.remove();
        }
    };
}

function clearHotspots() {
    hotspots = [];
    document.getElementById('hotspotOverlay').innerHTML = '';
    document.getElementById('hotspotData').value = '';
    updatePreview();
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
    } else {
        previewContainer.innerHTML = `
            <div class="p-8 border-2 border-dashed border-slate-700 rounded-2xl">
                <p class="text-slate-500">Vorschau für <span class="uppercase font-bold">${type}</span> folgt in der Schüler-Ansicht.</p>
            </div>
        `;
    }
}

blueprintForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = gameTypeSelect.value;
    const title = document.getElementById('title').value;

    let content = {};
    if (['binary', 'choice', 'select', 'detector', 'mood', 'countdown', 'photo', 'statement'].includes(type)) {
        content.question = document.getElementById('question')?.value;
    }

    if (type === 'binary') {
        content.icon = document.getElementById('icon').value;
    } else if (type === 'choice' || type === 'select') {
        content.options = Array.from(document.querySelectorAll('.option-input')).map(i => i.value).filter(v => v);
    } else if (type === 'chat') {
        content.partner = document.getElementById('chatPartner').value;
        try {
            content.nodes = JSON.parse(document.getElementById('chatJson').value || '{}');
        } catch(e) { content.nodes = {}; }
    } else if (type === 'scroller') {
        content.posts = Array.from(document.querySelectorAll('.post-entry')).map(div => ({
            user: div.querySelector('.post-user').value,
            text: div.querySelector('.post-text').value,
            isBad: div.querySelector('.post-is-bad').checked
        }));
    } else if (type === 'detector') {
        content.image = document.querySelector('input[type="file"]').dataset.url;
    } else if (type === 'hotspot') {
        content.image = document.getElementById('hotspotImageInput').dataset.url;
        content.zones = JSON.parse(document.getElementById('hotspotData').value || '[]');
    } else if (type === 'password') {
        content.rules = document.getElementById('rules').value.split(',').map(s => s.trim());
        content.solution = document.getElementById('solution').value;
    } else if (type === 'profile') {
        content.fields = Array.from(document.querySelectorAll('.profile-field:checked')).map(i => i.value);
        content.customFields = Array.from(document.querySelectorAll('.custom-profile-input')).map(i => i.value).filter(v => v);
    } else if (type === 'mood') {
        content.labelLeft = document.getElementById('labelLeft').value;
        content.labelRight = document.getElementById('labelRight').value;
    } else if (type === 'bucket') {
        content.buckets = Array.from(document.querySelectorAll('.bucket-name')).map(i => i.value).filter(v => v);
        content.items = Array.from(document.querySelectorAll('#bucketItems .flex')).map(div => ({
            text: div.querySelector('.item-text').value,
            target: parseInt(div.querySelector('.item-target').value) - 1
        }));
    } else if (type === 'ranking') {
        content.items = Array.from(document.querySelectorAll('.ranking-item')).map(i => i.value).filter(v => v);
    } else if (type === 'pairs') {
        content.pairs = Array.from(document.querySelectorAll('#pairsContainer .flex')).map(div => ({
            left: div.querySelector('.pair-left').value,
            right: div.querySelector('.pair-right').value
        }));
    } else if (type === 'cloze') {
        content.text = document.getElementById('clozeText').value;
    } else if (type === 'countdown') {
        content.duration = parseInt(document.getElementById('duration').value);
    }

    const res = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, gameType: type, content })
    });

    if (res.ok) {
        alert('Blueprint gespeichert!');
        blueprintForm.reset();
        hotspots = [];
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
