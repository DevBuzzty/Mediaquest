const categories = [
    { id: 'binary', name: 'Binary Swipe', icon: '↔️', group: 'Basis' },
    { id: 'choice', name: 'Multiple Choice', icon: '🔘', group: 'Basis' },
    { id: 'select', name: 'Multiple Select', icon: '✅', group: 'Basis' },
    { id: 'chat', name: 'Chat-Simulator', icon: '💬', group: 'Interaktion' },
    { id: 'scroller', name: 'Feed-Scroller', icon: '📱', group: 'Interaktion' },
    { id: 'detector', name: 'Detektor (Lupe)', icon: '🔍', group: 'Interaktion' },
    { id: 'hotspot', name: 'Hotspot-Bild', icon: '🎯', group: 'Interaktion' },
    { id: 'password', name: 'Passwort-Check', icon: '🔐', group: 'Eingabe' },
    { id: 'photo', name: 'Foto-Upload', icon: '📸', group: 'Eingabe' },
    { id: 'statement', name: 'Statement', icon: '📝', group: 'Eingabe' },
    { id: 'profile', name: 'Profil-Editor', icon: '👤', group: 'Eingabe' },
    { id: 'mood', name: 'Barometer', icon: '🌡️', group: 'Mechanik' },
    { id: 'bucket', name: 'Bucket Drop', icon: '🗑️', group: 'Mechanik' },
    { id: 'ranking', name: 'Ranking', icon: '🔢', group: 'Mechanik' },
    { id: 'pairs', name: 'Paare finden', icon: '🔗', group: 'Mechanik' },
    { id: 'cloze', name: 'Lückentext', icon: '🔤', group: 'Mechanik' },
    { id: 'countdown', name: 'Countdown', icon: '⏳', group: 'Mechanik' }
];

let tasks = [];
let blueprints = [];
let editingBlueprintId = null;
let currentTemplateType = 'normal';

async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (!data.loggedIn) window.location.href = '/login.html';
    document.getElementById('teacherUsername').textContent = data.username;
    loadBlueprints();
}

function createNewTemplate() {
    editingBlueprintId = null;
    tasks = [];
    setTemplateType('normal');
    document.getElementById('blueprintTitle').value = '';
    document.getElementById('editorPlaceholder').classList.add('hidden');
    document.getElementById('editorContainer').classList.remove('hidden');
    addTask();
}

function setTemplateType(type) {
    currentTemplateType = type;
    const btnNormal = document.getElementById('type-normal');
    const btnQr = document.getElementById('type-qr');

    if (type === 'normal') {
        btnNormal.className = 'flex-1 rounded-xl font-bold text-sm transition-all bg-blue-600 text-white';
        btnQr.className = 'flex-1 rounded-xl font-bold text-sm transition-all text-slate-500 hover:text-slate-300';
    } else {
        btnQr.className = 'flex-1 rounded-xl font-bold text-sm transition-all bg-blue-600 text-white';
        btnNormal.className = 'flex-1 rounded-xl font-bold text-sm transition-all text-slate-500 hover:text-slate-300';
    }

    renderTasks();
}

function cancelEditor() {
    document.getElementById('editorContainer').classList.add('hidden');
    document.getElementById('editorPlaceholder').classList.remove('hidden');
}

function generateTaskCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function addTask() {
    const task = {
        id: Date.now() + Math.random(),
        type: 'choice', // Default type
        code: generateTaskCode()
    };
    tasks.push(task);
    renderTasks();
}

function removeTask(index) {
    tasks.splice(index, 1);
    renderTasks();
    updatePreview();
}

function renderTasks() {
    const list = document.getElementById('tasksList');
    list.innerHTML = '';

    tasks.forEach((task, index) => {
        const div = document.createElement('div');
        div.className = 'bg-slate-900/80 p-8 rounded-[2.5rem] border-2 border-slate-700 space-y-6 relative shadow-xl';

        let typeOptions = '';
        let currentGroup = '';
        categories.forEach(c => {
            if (c.group !== currentGroup) {
                if (currentGroup) typeOptions += '</optgroup>';
                typeOptions += `<optgroup label="${c.group}">`;
                currentGroup = c.group;
            }
            typeOptions += `<option value="${c.id}" ${task.type === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`;
        });
        typeOptions += '</optgroup>';

        div.innerHTML = `
            <div class="flex justify-between items-center pb-4 border-b border-slate-800">
                <div class="flex items-center gap-4">
                    <span class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-black text-sm shadow-lg shadow-blue-500/20">${index + 1}</span>
                    <select onchange="updateTaskType(${index}, this.value)" class="bg-slate-800 border-none rounded-xl px-4 py-2 font-bold text-blue-400 outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
                        ${typeOptions}
                    </select>
                </div>

                ${currentTemplateType === 'qr' ? `
                    <div class="flex items-center gap-4">
                        <div class="bg-slate-800 px-4 py-2 rounded-xl border border-slate-700">
                            <span class="text-[10px] uppercase font-black text-slate-500 block">Task-Code</span>
                            <span class="text-lg font-black text-blue-400 tracking-widest">${task.code}</span>
                        </div>
                        <div id="qr-${index}" class="bg-white p-1 rounded-lg"></div>
                    </div>
                ` : ''}

                <button onclick="removeTask(${index})" class="w-10 h-10 rounded-xl bg-slate-800 text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-all flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            <div id="fields-${index}" class="space-y-6"></div>
        `;
        list.appendChild(div);

        if (currentTemplateType === 'qr') {
            setTimeout(() => {
                new QRCode(document.getElementById(`qr-${index}`), {
                    text: task.code,
                    width: 48,
                    height: 48,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            }, 0);
        }

        renderTaskFields(index);
    });
}

function updateTaskType(idx, type) {
    updateTaskData(idx); // Save existing data before switching
    tasks[idx].type = type;
    renderTasks();
    updatePreview();
}

function renderTaskFields(idx) {
    const container = document.getElementById(`fields-${idx}`);
    const type = tasks[idx].type;
    const task = tasks[idx];

    // Generic Question Field
    if (!['hotspot', 'scroller', 'ranking', 'pairs', 'cloze'].includes(type)) {
        addField(container, 'Frage / Anweisung', 'text', 'question', idx, task.question || '');
    }

    // New Description Field for all tasks
    addField(container, 'Kurze Beschreibung / Anleitung', 'text', 'description', idx, task.description || '');

    if (type === 'binary') {
        addField(container, 'Emoji / Icon', 'text', 'icon', idx, task.icon || '❓');
    } else if (type === 'choice' || type === 'select') {
        addOptionsArea(container, idx, task.options || ['', '', '']);
    } else if (type === 'chat') {
        addField(container, 'Chat-Partner', 'text', 'partner', idx, task.partner || 'Unbekannt');
        addTextarea(container, 'Dialog-Struktur (JSON)', 'nodes', idx, JSON.stringify(task.nodes || {
            "start": { "text": "Hallo!", "options": [{ "label": "Hi!", "next": "end" }] },
            "end": { "text": "Schön dich zu sehen.", "options": [] }
        }, null, 2));
    } else if (type === 'scroller') {
        addScrollerArea(container, idx, task.posts || []);
    } else if (type === 'detector') {
        addFileUpload(container, 'Hintergrundbild', 'image', idx, task.image);
    } else if (type === 'hotspot') {
        addHotspotEditor(container, idx, task.image, task.zones || []);
    } else if (type === 'password') {
        addField(container, 'Regeln (Komma getrennt)', 'text', 'rules', idx, (task.rules || []).join(', '));
    } else if (type === 'profile') {
        addProfileFieldsArea(container, idx, task.fields || [], task.customFields || []);
    } else if (type === 'mood') {
        addField(container, 'Label Links', 'text', 'labelLeft', idx, task.labelLeft || 'Schlecht');
        addField(container, 'Label Rechts', 'text', 'labelRight', idx, task.labelRight || 'Gut');
    } else if (type === 'bucket') {
        addBucketArea(container, idx, task.buckets || [], task.items || []);
    } else if (type === 'ranking') {
        addRankingArea(container, idx, task.items || []);
    } else if (type === 'pairs') {
        addPairsArea(container, idx, task.pairs || []);
    } else if (type === 'cloze') {
        addTextarea(container, 'Text mit [Lücken]', 'text', idx, task.text || '');
        addField(container, 'Falsche Wörter (Komma getrennt)', 'text', 'fakes', idx, (task.fakes || []).join(', '));
    } else if (type === 'countdown') {
        addField(container, 'Dauer (Sekunden)', 'number', 'duration', idx, task.duration || 60);
    }

    container.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('input', () => {
            updateTaskData(idx);
            updatePreview();
        });
    });
}

function addField(container, label, type, key, idx, val) {
    const div = document.createElement('div');
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 mb-2 ml-1 tracking-widest">${label}</label>
        <input type="${type}" data-key="${key}" value="${val}" class="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold">
    `;
    container.appendChild(div);
}

function addTextarea(container, label, key, idx, val) {
    const div = document.createElement('div');
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 mb-2 ml-1 tracking-widest">${label}</label>
        <textarea data-key="${key}" class="w-full h-32 bg-slate-900 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-xs">${val}</textarea>
    `;
    container.appendChild(div);
}

function addFileUpload(container, label, key, idx, val) {
    const div = document.createElement('div');
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 mb-2 ml-1 tracking-widest">${label}</label>
        <div class="flex items-center gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-700">
            <input type="file" onchange="uploadImage(this, ${idx}, '${key}')" class="text-xs text-slate-500">
            <img src="${val || ''}" class="img-preview h-16 w-16 object-cover rounded-xl border border-slate-700 ${val ? '' : 'hidden'}">
        </div>
        <input type="hidden" data-key="${key}" value="${val || ''}">
    `;
    container.appendChild(div);
}

async function uploadImage(input, idx, key) {
    const file = input.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
        const hidden = input.parentElement.parentElement.querySelector(`input[data-key="${key}"]`);
        hidden.value = data.url;
        const img = input.parentElement.querySelector('img');
        img.src = data.url;
        img.classList.remove('hidden');
        updateTaskData(idx);
        updatePreview();
    }
}

function addOptionsArea(container, idx, options) {
    const div = document.createElement('div');
    div.className = 'space-y-3';
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 ml-1 tracking-widest">Antwortmöglichkeiten</label>`;
    const list = document.createElement('div');
    list.className = 'options-list space-y-2';
    div.appendChild(list);

    const render = () => {
        list.innerHTML = '';
        options.forEach((opt, i) => {
            const input = document.createElement('input');
            input.className = 'option-input w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-6 outline-none text-sm font-bold';
            input.value = opt;
            input.placeholder = `Option ${i+1}`;
            input.addEventListener('input', () => updateTaskData(idx));
            list.appendChild(input);
        });
    };

    const addBtn = document.createElement('button');
    addBtn.className = 'bg-slate-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase text-blue-400 mt-2';
    addBtn.textContent = '+ Option';
    addBtn.onclick = () => { options.push(''); render(); };
    div.appendChild(addBtn);
    container.appendChild(div);
    render();
}

function addScrollerArea(container, idx, posts) {
    const div = document.createElement('div');
    div.className = 'space-y-4';
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 ml-1 tracking-widest">Feed Posts (Min. 10 benötigt)</label>`;
    const postsList = document.createElement('div');
    postsList.className = 'posts-list space-y-3';

    const renderPosts = () => {
        postsList.innerHTML = '';
        posts.forEach((p, i) => {
            const pdiv = document.createElement('div');
            pdiv.className = 'p-5 bg-slate-900 rounded-[1.5rem] border border-slate-700 space-y-3 shadow-inner';
            pdiv.innerHTML = `
                <div class="flex justify-between items-center">
                    <input type="text" value="${p.user || ''}" class="post-user bg-slate-800 border-none rounded-lg px-3 py-1 text-[10px] font-black text-blue-400 w-1/2" placeholder="User">
                    <button onclick="this.parentElement.parentElement.remove(); updateTaskData(${idx});" class="text-slate-600 hover:text-red-500">&times;</button>
                </div>
                <textarea class="post-text w-full bg-slate-800 border-none rounded-xl p-3 text-xs font-bold text-slate-300" placeholder="Post Inhalt...">${p.text || ''}</textarea>
                <label class="flex items-center gap-2 text-[10px] uppercase font-black text-slate-500">
                    <input type="checkbox" class="post-is-bad" ${p.isBad ? 'checked' : ''}> Problematischer Inhalt?
                </label>
            `;
            pdiv.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', () => updateTaskData(idx)));
            postsList.appendChild(pdiv);
        });
    };

    const addBtn = document.createElement('button');
    addBtn.className = 'w-full py-4 bg-slate-900 border-2 border-dashed border-slate-700 rounded-2xl text-[10px] font-black uppercase text-slate-500 hover:border-blue-500 transition-all';
    addBtn.textContent = '+ Weiteren Post hinzufügen';
    addBtn.onclick = () => { posts.push({ user: '', text: '', isBad: false }); renderPosts(); };

    div.appendChild(postsList);
    div.appendChild(addBtn);
    container.appendChild(div);
    renderPosts();
}

function addHotspotEditor(container, idx, image, zones) {
    const div = document.createElement('div');
    div.className = 'space-y-4';
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1 tracking-widest">Bild & Trefferzonen</label>
        <div class="flex items-center gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-700 mb-4">
            <input type="file" onchange="uploadHotspotImage(this, ${idx})" class="text-xs text-slate-500">
        </div>
        <div class="hotspot-editor-box relative w-full aspect-video bg-black rounded-[2rem] overflow-hidden cursor-crosshair shadow-2xl ${image ? '' : 'hidden'}">
            <img src="${image || ''}" class="w-full h-full object-contain pointer-events-none">
            <div class="hotspot-overlay absolute inset-0"></div>
            <div class="hotspot-drag-box absolute border-2 border-blue-500 bg-blue-500/20 hidden pointer-events-none"></div>
        </div>
        <div class="flex justify-between items-center px-1">
            <span class="text-[10px] font-black uppercase text-slate-600 tracking-widest">${zones.length} Zonen markiert</span>
            <button onclick="clearZones(${idx})" class="text-[10px] text-red-500 font-black uppercase">Zonen löschen</button>
        </div>
    `;
    container.appendChild(div);
    if (image) initHotspotInteractions(div, idx);
}

async function uploadHotspotImage(input, idx) {
    const file = input.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
        tasks[idx].image = data.url;
        renderTasks();
        updatePreview();
    }
}

function initHotspotInteractions(container, idx) {
    const overlay = container.querySelector('.hotspot-overlay');
    const dragBox = container.querySelector('.hotspot-drag-box');
    let startX, startY, isDrawing = false;

    overlay.onmousedown = (e) => {
        isDrawing = true;
        const rect = overlay.getBoundingClientRect();
        startX = ((e.clientX - rect.left) / rect.width) * 100;
        startY = ((e.clientY - rect.top) / rect.height) * 100;

        dragBox.classList.remove('hidden');
        dragBox.style.left = startX + '%';
        dragBox.style.top = startY + '%';
        dragBox.style.width = '0%';
        dragBox.style.height = '0%';
    };

    window.onmousemove = (e) => {
        if (!isDrawing) return;
        const rect = overlay.getBoundingClientRect();
        let currX = ((e.clientX - rect.left) / rect.width) * 100;
        let currY = ((e.clientY - rect.top) / rect.height) * 100;

        dragBox.style.width = Math.abs(currX - startX) + '%';
        dragBox.style.height = Math.abs(currY - startY) + '%';
        dragBox.style.left = Math.min(currX, startX) + '%';
        dragBox.style.top = Math.min(currY, startY) + '%';
    };

    window.onmouseup = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        const rect = {
            x: parseFloat(dragBox.style.left),
            y: parseFloat(dragBox.style.top),
            w: parseFloat(dragBox.style.width),
            h: parseFloat(dragBox.style.height)
        };
        if (rect.w > 1 && rect.h > 1) {
            if (!tasks[idx].zones) tasks[idx].zones = [];
            tasks[idx].zones.push(rect);
            renderTasks();
            updatePreview();
        }
        dragBox.classList.add('hidden');
    };

    tasks[idx].zones?.forEach(z => {
        const zdiv = document.createElement('div');
        zdiv.className = 'absolute border-2 border-green-500 bg-green-500/10 rounded';
        zdiv.style.left = z.x + '%';
        zdiv.style.top = z.y + '%';
        zdiv.style.width = z.w + '%';
        zdiv.style.height = z.h + '%';
        overlay.appendChild(zdiv);
    });
}

function clearZones(idx) {
    tasks[idx].zones = [];
    renderTasks();
    updatePreview();
}

function addProfileFieldsArea(container, idx, fields, custom) {
    const div = document.createElement('div');
    div.className = 'space-y-4';
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 tracking-widest ml-1">Standard Felder</label>
        <div class="grid grid-cols-2 gap-3 bg-slate-900 p-6 rounded-2xl border border-slate-700 shadow-inner">
            ${['Name', 'Alter', 'Ort', 'Hobbies', 'E-Mail', 'Foto'].map(f => `
                <label class="flex items-center gap-3 text-xs font-bold text-slate-400 cursor-pointer">
                    <input type="checkbox" class="profile-field w-5 h-5 rounded-lg border-slate-700 bg-slate-800 text-blue-500" value="${f.toLowerCase()}" ${fields.includes(f.toLowerCase()) ? 'checked' : ''}> ${f}
                </label>
            `).join('')}
        </div>
        <label class="block text-[10px] uppercase font-bold text-slate-500 tracking-widest ml-1">Eigene Felder</label>
        <div class="custom-fields-list space-y-2"></div>
    `;
    const list = div.querySelector('.custom-fields-list');
    const renderCustom = () => {
        list.innerHTML = '';
        custom.forEach((f, i) => {
            const idiv = document.createElement('div');
            idiv.className = 'flex gap-2';
            idiv.innerHTML = `<input type="text" value="${f}" class="custom-profile-input flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-sm font-bold" placeholder="Feldname">
                             <button onclick="this.parentElement.remove(); updateTaskData(${idx});" class="text-slate-600 hover:text-red-500 px-2">&times;</button>`;
            idiv.querySelector('input').addEventListener('input', () => updateTaskData(idx));
            list.appendChild(idiv);
        });
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'bg-slate-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase text-blue-400 mt-2';
    addBtn.textContent = '+ Eigenes Feld';
    addBtn.onclick = () => { custom.push(''); renderCustom(); };
    div.appendChild(list);
    div.appendChild(addBtn);
    container.appendChild(div);
    renderCustom();
}

function addBucketArea(container, idx, buckets, items) {
    const div = document.createElement('div');
    div.className = 'space-y-6';
    div.innerHTML = `
        <div class="space-y-2">
            <label class="block text-[10px] uppercase font-bold text-slate-500 tracking-widest ml-1">Buckets (Max 4)</label>
            <div class="buckets-list grid grid-cols-2 gap-2"></div>
        </div>
        <div class="space-y-2">
            <label class="block text-[10px] uppercase font-bold text-slate-500 tracking-widest ml-1">Items zum Einsortieren</label>
            <div class="items-list space-y-2"></div>
        </div>
    `;
    const bList = div.querySelector('.buckets-list');
    const iList = div.querySelector('.items-list');

    const renderB = () => {
        bList.innerHTML = '';
        buckets.forEach((b, i) => {
            const input = document.createElement('input');
            input.className = 'bucket-name w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs font-bold';
            input.value = b;
            input.placeholder = `Bucket ${i+1}`;
            input.addEventListener('input', () => updateTaskData(idx));
            bList.appendChild(input);
        });
    };
    const renderI = () => {
        iList.innerHTML = '';
        items.forEach((it, i) => {
            const idiv = document.createElement('div');
            idiv.className = 'flex gap-2 p-3 bg-slate-900 rounded-xl border border-slate-700';
            idiv.innerHTML = `
                <input type="text" value="${it.text || ''}" class="item-text flex-1 bg-slate-800 border-none rounded-lg px-3 py-1 text-xs font-bold" placeholder="Item Name">
                <input type="number" value="${(it.target || 0) + 1}" class="item-target w-12 bg-slate-800 border-none rounded-lg px-2 py-1 text-xs text-center font-bold" placeholder="#">
                <button onclick="this.parentElement.remove(); updateTaskData(${idx});" class="text-slate-600 hover:text-red-500 px-1">&times;</button>
            `;
            idiv.querySelectorAll('input').forEach(el => el.addEventListener('input', () => updateTaskData(idx)));
            iList.appendChild(idiv);
        });
    };

    const addBBtn = document.createElement('button');
    addBBtn.className = 'bg-slate-800 px-3 py-1.5 rounded-lg text-[10px] font-black text-blue-400 mb-2';
    addBBtn.textContent = '+ Bucket';
    addBBtn.onclick = () => { if (buckets.length < 4) buckets.push(''); renderB(); };

    const addIBtn = document.createElement('button');
    addIBtn.className = 'w-full py-3 bg-slate-900 border border-slate-700 rounded-xl text-[10px] font-black text-slate-500 uppercase mt-2';
    addIBtn.textContent = '+ Item hinzufügen';
    addIBtn.onclick = () => { items.push({ text: '', target: 0 }); renderI(); };

    div.querySelector('.space-y-2').appendChild(addBBtn);
    div.appendChild(addIBtn);
    container.appendChild(div);
    renderB(); renderI();
}

function addRankingArea(container, idx, items) {
    const div = document.createElement('div');
    div.className = 'space-y-4';
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 tracking-widest ml-1">Ranking Elemente (Reihenfolge Platz 1 bis N)</label>
                     <div class="list space-y-2"></div>`;
    const list = div.querySelector('.list');
    const render = () => {
        list.innerHTML = '';
        items.forEach((it, i) => {
            const idiv = document.createElement('div');
            idiv.className = 'flex gap-2';
            idiv.innerHTML = `<span class="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center font-bold text-[10px] text-slate-500 border border-slate-700">${i+1}</span>
                             <input type="text" class="ranking-item flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-sm font-bold" value="${it}">
                             <button onclick="this.parentElement.remove(); updateTaskData(${idx});" class="text-slate-600 hover:text-red-500 px-1">&times;</button>`;
            idiv.querySelector('input').addEventListener('input', () => updateTaskData(idx));
            list.appendChild(idiv);
        });
    };
    const addBtn = document.createElement('button');
    addBtn.className = 'bg-slate-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase text-blue-400 mt-2';
    addBtn.textContent = '+ Element';
    addBtn.onclick = () => { items.push(''); render(); };
    div.appendChild(addBtn);
    container.appendChild(div);
    render();
}

function addPairsArea(container, idx, pairs) {
    const div = document.createElement('div');
    div.className = 'space-y-4';
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 tracking-widest ml-1">Logische Paare</label>
                     <div class="list space-y-2"></div>`;
    const list = div.querySelector('.list');
    const render = () => {
        list.innerHTML = '';
        pairs.forEach((p, i) => {
            const pdiv = document.createElement('div');
            pdiv.className = 'flex gap-2 items-center bg-slate-900 p-3 rounded-xl border border-slate-700';
            pdiv.innerHTML = `
                <input type="text" value="${p.left || ''}" class="pair-left flex-1 bg-slate-800 border-none rounded-lg px-3 py-1 text-xs font-bold" placeholder="Links">
                <span class="text-blue-500 font-bold">🔗</span>
                <input type="text" value="${p.right || ''}" class="pair-right flex-1 bg-slate-800 border-none rounded-lg px-3 py-1 text-xs font-bold" placeholder="Rechts">
                <button onclick="this.parentElement.remove(); updateTaskData(${idx});" class="text-slate-600 hover:text-red-500 ml-2">&times;</button>
            `;
            pdiv.querySelectorAll('input').forEach(el => el.addEventListener('input', () => updateTaskData(idx)));
            list.appendChild(pdiv);
        });
    };
    const addBtn = document.createElement('button');
    addBtn.className = 'bg-slate-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase text-blue-400 mt-2';
    addBtn.textContent = '+ Paar';
    addBtn.onclick = () => { pairs.push({ left: '', right: '' }); render(); };
    div.appendChild(addBtn);
    container.appendChild(div);
    render();
}

function updateTaskData(idx) {
    const container = document.getElementById(`fields-${idx}`);
    if (!container) return;
    const task = tasks[idx];

    container.querySelectorAll('input[data-key], textarea[data-key]').forEach(input => {
        const key = input.dataset.key;
        let val = input.value;
        if (key === 'rules' || key === 'fakes') val = val.split(',').map(s => s.trim()).filter(v => v);
        if (key === 'nodes') { try { val = JSON.parse(val); } catch(e) {} }
        if (key === 'zones') { try { val = JSON.parse(val); } catch(e) {} }
        task[key] = val;
    });

    const type = task.type;
    if (type === 'choice' || type === 'select') {
        task.options = Array.from(container.querySelectorAll('.option-input')).map(i => i.value).filter(v => v);
    } else if (type === 'scroller') {
        task.posts = Array.from(container.querySelectorAll('.posts-list > div')).map(pdiv => ({
            user: pdiv.querySelector('.post-user').value,
            text: pdiv.querySelector('.post-text').value,
            isBad: pdiv.querySelector('.post-is-bad').checked
        }));
    } else if (type === 'profile') {
        task.fields = Array.from(container.querySelectorAll('.profile-field:checked')).map(i => i.value);
        task.customFields = Array.from(container.querySelectorAll('.custom-profile-input')).map(i => i.value).filter(v => v);
    } else if (type === 'bucket') {
        task.buckets = Array.from(container.querySelectorAll('.bucket-name')).map(i => i.value).filter(v => v);
        task.items = Array.from(container.querySelectorAll('.items-list > div')).map(idiv => ({
            text: idiv.querySelector('.item-text').value,
            target: parseInt(idiv.querySelector('.item-target').value) - 1
        })).filter(it => it.text);
    } else if (type === 'ranking') {
        task.items = Array.from(container.querySelectorAll('.ranking-item')).map(i => i.value).filter(v => v);
    } else if (type === 'pairs') {
        task.pairs = Array.from(container.querySelectorAll('.list > div')).map(pdiv => ({
            left: pdiv.querySelector('.pair-left')?.value,
            right: pdiv.querySelector('.pair-right')?.value
        })).filter(p => p.left && p.right);
    }
}

function updatePreview() {
    const container = document.getElementById('previewContainer');
    if (tasks.length === 0) {
        container.innerHTML = '<div class="text-slate-600 text-center italic text-sm"><div class="text-5xl mb-4">✨</div>Noch keine Aufgaben...</div>';
        return;
    }

    const task = tasks[0];
    container.innerHTML = `<div class="space-y-6">
        <div class="flex items-center gap-3 justify-center mb-4">
            <span class="text-2xl">${categories.find(c => c.id === task.type).icon}</span>
            <h3 class="text-xl font-black text-blue-500 uppercase tracking-tighter">${categories.find(c => c.id === task.type).name}</h3>
        </div>
        <div class="preview-inner bg-slate-900/50 rounded-3xl p-6 border border-slate-700 shadow-inner min-h-[300px] flex flex-col items-center justify-center">
            ${renderPreviewContent(task.type, task)}
        </div>
        <p class="text-[10px] text-slate-500 font-black uppercase tracking-widest text-center mt-8">VORSCHAU: AUFGABE 1 VON ${tasks.length}</p>
    </div>`;
}

function renderPreviewContent(type, task) {
    if (type === 'binary') return `<div class="text-8xl mb-6">${task.icon || '❓'}</div><p class="text-sm font-bold text-slate-300 text-center">${task.question || 'Deine Frage...'}</p>`;
    if (type === 'choice' || type === 'select') return `<p class="text-sm font-black text-white mb-6 text-center leading-relaxed">${task.question || 'Deine Frage...'}</p><div class="w-full space-y-2">${(task.options || []).map(o => `<div class="bg-slate-800 border border-slate-700 p-3 rounded-xl text-xs text-left font-bold text-slate-400">${o}</div>`).join('')}</div>`;
    return `<div class="text-center space-y-4"><div class="text-4xl opacity-20">🕹️</div><p class="text-slate-500 text-xs italic">Vorschau für diesen Typ im Editor begrenzt. Speichere und starte eine Session.</p></div>`;
}

async function saveBlueprint() {
    const title = document.getElementById('blueprintTitle').value;
    if (!title) return WeltenretterUI.alert('Bitte gib einen Namen für die Spielrunde ein.', 'Halt!', '⚠️');
    if (tasks.length === 0) return WeltenretterUI.alert('Ein Template braucht mindestens eine Aufgabe.', 'Halt!', '⚠️');

    tasks.forEach((_, i) => updateTaskData(i));

    // Validations
    for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].type === 'scroller' && (tasks[i].posts || []).length < 10) {
            return WeltenretterUI.alert(`Aufgabe ${i+1}: Feed-Scroller benötigt mindestens 10 Posts für flüssiges Scrollen.`, 'Validierungsfehler', '❌');
        }
    }

    const res = await fetch('/api/blueprints' + (editingBlueprintId ? `/${editingBlueprintId}` : ''), {
        method: editingBlueprintId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title,
            gameType: 'template',
            content: {
                tasks: tasks,
                templateType: currentTemplateType
            }
        })
    });

    if (res.ok) {
        await WeltenretterUI.alert('Spielrunde wurde erfolgreich gespeichert!', 'Erfolg', '✅');
        loadBlueprints();
        cancelEditor();
    } else {
        WeltenretterUI.alert('Fehler beim Speichern.', 'Fehler', '❌');
    }
}

async function loadBlueprints() {
    const res = await fetch('/api/blueprints');
    const data = await res.json();
    blueprints = data.blueprints;

    const list = document.getElementById('blueprintList');
    list.innerHTML = '';

    blueprints.forEach(bp => {
        const div = document.createElement('div');
        div.className = 'group p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-blue-500 transition-all cursor-pointer relative';
        div.onclick = (e) => {
            if (e.target.closest('button')) return;
            editBlueprint(bp);
        };
        div.innerHTML = `
            <div class="pr-8">
                <p class="font-black text-sm text-slate-100 uppercase tracking-tighter">${bp.title}</p>
                <div class="flex gap-2 mt-2">
                    <span class="text-[9px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded font-black uppercase">${bp.content.tasks.length} GAMES</span>
                    <span class="text-[9px] ${bp.content.templateType === 'qr' ? 'bg-purple-600/20 text-purple-400' : 'bg-green-600/20 text-green-400'} px-2 py-0.5 rounded font-black uppercase">${bp.content.templateType === 'qr' ? 'QR-MODE' : 'NORMAL'}</span>
                </div>
            </div>
            <div class="absolute right-2 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button onclick="exportBlueprint(${bp.id})" class="text-slate-500 hover:text-blue-400" title="Exportieren">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                </button>
                <button onclick="deleteBlueprint(${bp.id})" class="text-slate-500 hover:text-red-500" title="Löschen">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

function editBlueprint(bp) {
    editingBlueprintId = bp.id;
    tasks = bp.content.tasks;
    setTemplateType(bp.content.templateType || 'normal');
    document.getElementById('blueprintTitle').value = bp.title;
    document.getElementById('editorPlaceholder').classList.add('hidden');
    document.getElementById('editorContainer').classList.remove('hidden');
    renderTasks();
    updatePreview();
}

async function deleteBlueprint(id) {
    if (!await WeltenretterUI.confirm('Möchtest du dieses Template unwiderruflich löschen?', 'Template löschen', '🗑️')) return;
    const res = await fetch(`/api/blueprints/${id}`, { method: 'DELETE' });
    if (res.ok) loadBlueprints();
}

function exportBlueprint(id) {
    const bp = blueprints.find(b => b.id === id);
    if (!bp) return;

    const dataStr = JSON.stringify(bp, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `Weltenretter_Template_${bp.title.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importBlueprint(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            // Basic validation
            if (!data.title || !data.content || !data.content.tasks) {
                throw new Error('Ungültiges Template-Format');
            }

            // Save via API
            const res = await fetch('/api/blueprints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: data.title + ' (Import)',
                    gameType: data.game_type || 'template',
                    content: data.content
                })
            });

            if (res.ok) {
                WeltenretterUI.alert('Template erfolgreich importiert!', 'Erfolg', '✅');
                loadBlueprints();
            } else {
                throw new Error('Fehler beim Speichern des importierten Templates');
            }
        } catch (err) {
            WeltenretterUI.alert(err.message, 'Fehler', '❌');
        }
        input.value = '';
    };
    reader.readAsText(file);
}

checkAuth();
