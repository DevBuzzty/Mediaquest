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

let selectedCategory = null;
let tasks = [];
let blueprints = [];

async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (!data.loggedIn) window.location.href = '/login.html';
    document.getElementById('teacherUsername').textContent = data.username;
    loadBlueprints();
}

function renderCategories() {
    const list = document.getElementById('categoryList');
    list.innerHTML = '';

    let lastGroup = '';
    categories.forEach(cat => {
        if (cat.group !== lastGroup) {
            const h = document.createElement('p');
            h.className = 'text-[10px] uppercase font-black text-slate-600 mt-4 mb-1 ml-2 tracking-widest';
            h.textContent = cat.group;
            list.appendChild(h);
            lastGroup = cat.group;
        }

        const btn = document.createElement('button');
        btn.className = `w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all hover:bg-slate-700/50 ${selectedCategory === cat.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`;
        btn.innerHTML = `<span>${cat.icon}</span> <span class="font-bold text-sm">${cat.name}</span>`;
        btn.onclick = () => selectCategory(cat.id);
        list.appendChild(btn);
    });
}

function selectCategory(id) {
    selectedCategory = id;
    tasks = [];
    document.getElementById('blueprintTitle').value = '';
    document.getElementById('editorPlaceholder').classList.add('hidden');
    document.getElementById('editorContainer').classList.remove('hidden');
    document.getElementById('selectedCategoryTitle').textContent = categories.find(c => c.id === id).name;

    renderCategories();
    addTask();
    updatePreview();
}

function addTask() {
    const task = { id: Date.now() + Math.random() };
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
        div.className = 'bg-slate-900/50 p-6 rounded-2xl border border-slate-700 space-y-4 relative group';
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="bg-blue-600/20 text-blue-400 text-[10px] font-black px-2 py-1 rounded">AUFGABE ${index + 1}</span>
                <button onclick="removeTask(${index})" class="text-slate-600 hover:text-red-500 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            <div id="fields-${index}" class="space-y-4"></div>
        `;
        list.appendChild(div);
        renderTaskFields(index);
    });
}

function renderTaskFields(idx) {
    const container = document.getElementById(`fields-${idx}`);
    const type = selectedCategory;
    const task = tasks[idx];

    // Generic Question Field
    if (!['hotspot', 'scroller', 'ranking', 'pairs', 'cloze'].includes(type)) {
        addField(container, 'Frage / Anweisung', 'text', 'question', idx, task.question || '');
    }

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
        <label class="block text-[10px] uppercase font-bold text-slate-500 mb-1 ml-1">${label}</label>
        <input type="${type}" data-key="${key}" value="${val}" class="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all">
    `;
    container.appendChild(div);
}

function addTextarea(container, label, key, idx, val) {
    const div = document.createElement('div');
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 mb-1 ml-1">${label}</label>
        <textarea data-key="${key}" class="w-full h-32 bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-xs">${val}</textarea>
    `;
    container.appendChild(div);
}

function addFileUpload(container, label, key, idx, val) {
    const div = document.createElement('div');
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 mb-1 ml-1">${label}</label>
        <div class="flex items-center gap-4">
            <input type="file" onchange="uploadImage(this, ${idx}, '${key}')" class="text-xs text-slate-500">
            <img src="${val || ''}" class="img-preview h-12 w-12 object-cover rounded-lg border border-slate-700 ${val ? '' : 'hidden'}">
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

// Specialized Areas
function addOptionsArea(container, idx, options) {
    const div = document.createElement('div');
    div.className = 'space-y-2';
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Antworten</label>`;
    options.forEach((opt, i) => {
        const input = document.createElement('input');
        input.className = 'option-input w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-4 outline-none text-sm mb-1';
        input.value = opt;
        input.placeholder = `Option ${i+1}`;
        div.appendChild(input);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'text-[10px] text-blue-400 font-bold ml-1';
    addBtn.textContent = '+ OPTION';
    addBtn.onclick = () => {
        const input = document.createElement('input');
        input.className = 'option-input w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-4 outline-none text-sm mb-1';
        input.placeholder = 'Neue Option';
        input.addEventListener('input', () => { updateTaskData(idx); updatePreview(); });
        div.insertBefore(input, addBtn);
    };
    div.appendChild(addBtn);
    container.appendChild(div);
}

function addScrollerArea(container, idx, posts) {
    const div = document.createElement('div');
    div.className = 'space-y-4';
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Posts (Min. 10 empfohlen)</label>`;
    const postsList = document.createElement('div');
    postsList.className = 'posts-list space-y-2';

    const renderPosts = () => {
        postsList.innerHTML = '';
        posts.forEach((p, i) => {
            const pdiv = document.createElement('div');
            pdiv.className = 'p-3 bg-slate-800 rounded-xl border border-slate-700 space-y-2';
            pdiv.innerHTML = `
                <input type="text" value="${p.user || ''}" class="post-user w-full bg-slate-900 border-none rounded p-1 text-xs" placeholder="User">
                <textarea class="post-text w-full bg-slate-900 border-none rounded p-1 text-xs" placeholder="Inhalt">${p.text || ''}</textarea>
                <label class="flex items-center gap-2 text-[10px] text-slate-400">
                    <input type="checkbox" class="post-is-bad" ${p.isBad ? 'checked' : ''}> Fake News?
                </label>
            `;
            pdiv.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', () => updateTaskData(idx)));
            postsList.appendChild(pdiv);
        });
    };

    const addBtn = document.createElement('button');
    addBtn.className = 'w-full py-2 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-400';
    addBtn.textContent = '+ POST HINZUFÜGEN';
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
        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Hotspot Bild & Zonen</label>
        <div class="flex items-center gap-4">
            <input type="file" onchange="uploadHotspotImage(this, ${idx})" class="text-xs text-slate-500">
        </div>
        <div class="hotspot-editor-box relative w-full aspect-video bg-black rounded-xl overflow-hidden cursor-crosshair ${image ? '' : 'hidden'}">
            <img src="${image || ''}" class="w-full h-full object-contain pointer-events-none">
            <div class="hotspot-overlay absolute inset-0"></div>
            <div class="hotspot-drag-box absolute border-2 border-blue-500 bg-blue-500/20 hidden pointer-events-none"></div>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-[10px] text-slate-500">${zones.length} Zonen definiert</span>
            <button onclick="clearZones(${idx})" class="text-[10px] text-red-400 font-bold">LÖSCHEN</button>
        </div>
        <input type="hidden" data-key="image" value="${image || ''}">
        <input type="hidden" data-key="zones" value='${JSON.stringify(zones)}'>
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

    window.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const rect = overlay.getBoundingClientRect();
        let currX = ((e.clientX - rect.left) / rect.width) * 100;
        let currY = ((e.clientY - rect.top) / rect.height) * 100;

        dragBox.style.width = Math.abs(currX - startX) + '%';
        dragBox.style.height = Math.abs(currY - startY) + '%';
        dragBox.style.left = Math.min(currX, startX) + '%';
        dragBox.style.top = Math.min(currY, startY) + '%';
    });

    window.addEventListener('mouseup', (e) => {
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
    }, { once: true });

    // Draw existing zones
    tasks[idx].zones?.forEach(z => {
        const zdiv = document.createElement('div');
        zdiv.className = 'absolute border-2 border-green-500 bg-green-500/10';
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
    div.className = 'space-y-2';
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Standard Felder</label>
        <div class="grid grid-cols-2 gap-2">
            ${['Name', 'Alter', 'Ort', 'Hobbies', 'E-Mail', 'Foto'].map(f => `
                <label class="flex items-center gap-2 text-xs text-slate-400">
                    <input type="checkbox" class="profile-field" value="${f.toLowerCase()}" ${fields.includes(f.toLowerCase()) ? 'checked' : ''}> ${f}
                </label>
            `).join('')}
        </div>
        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1 mt-4">Eigene Felder</label>
        <div class="custom-fields-list space-y-1"></div>
    `;
    const list = div.querySelector('.custom-fields-list');
    const renderCustom = () => {
        list.innerHTML = '';
        custom.forEach((f, i) => {
            const input = document.createElement('input');
            input.className = 'custom-profile-input w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs';
            input.value = f;
            input.addEventListener('input', () => updateTaskData(idx));
            list.appendChild(input);
        });
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'text-[10px] text-blue-400 font-bold ml-1';
    addBtn.textContent = '+ FELD';
    addBtn.onclick = () => { custom.push(''); renderCustom(); };
    div.appendChild(addBtn);
    container.appendChild(div);
    renderCustom();
}

function addBucketArea(container, idx, buckets, items) {
    const div = document.createElement('div');
    div.innerHTML = `
        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Buckets (Max 4)</label>
        <div class="buckets-list space-y-1 mb-4"></div>
        <label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Items</label>
        <div class="items-list space-y-1"></div>
    `;
    const bList = div.querySelector('.buckets-list');
    const iList = div.querySelector('.items-list');

    const renderB = () => {
        bList.innerHTML = '';
        buckets.forEach((b, i) => {
            const input = document.createElement('input');
            input.className = 'bucket-name w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs';
            input.value = b;
            input.addEventListener('input', () => updateTaskData(idx));
            bList.appendChild(input);
        });
    };
    const renderI = () => {
        iList.innerHTML = '';
        items.forEach((it, i) => {
            const idiv = document.createElement('div');
            idiv.className = 'flex gap-2';
            idiv.innerHTML = `
                <input type="text" value="${it.text || ''}" class="item-text flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" placeholder="Text">
                <input type="number" value="${(it.target || 0) + 1}" class="item-target w-12 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" placeholder="Korb">
            `;
            idiv.querySelectorAll('input').forEach(el => el.addEventListener('input', () => updateTaskData(idx)));
            iList.appendChild(idiv);
        });
    };

    const addBBtn = document.createElement('button');
    addBBtn.className = 'text-[10px] text-blue-400 font-bold ml-1 mb-2';
    addBBtn.textContent = '+ KORB';
    addBBtn.onclick = () => { if (buckets.length < 4) buckets.push(''); renderB(); };

    const addIBtn = document.createElement('button');
    addIBtn.className = 'text-[10px] text-blue-400 font-bold ml-1';
    addIBtn.textContent = '+ ITEM';
    addIBtn.onclick = () => { items.push({ text: '', target: 0 }); renderI(); };

    div.insertBefore(addBBtn, iList);
    div.appendChild(addIBtn);
    container.appendChild(div);
    renderB(); renderI();
}

function addRankingArea(container, idx, items) {
    const div = document.createElement('div');
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Elemente (In richtiger Reihenfolge)</label>
                     <div class="list space-y-1"></div>`;
    const list = div.querySelector('.list');
    const render = () => {
        list.innerHTML = '';
        items.forEach((it, i) => {
            const input = document.createElement('input');
            input.className = 'ranking-item w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs';
            input.value = it;
            input.addEventListener('input', () => updateTaskData(idx));
            list.appendChild(input);
        });
    };
    const addBtn = document.createElement('button');
    addBtn.className = 'text-[10px] text-blue-400 font-bold ml-1';
    addBtn.textContent = '+ ELEMENT';
    addBtn.onclick = () => { items.push(''); render(); };
    div.appendChild(addBtn);
    container.appendChild(div);
    render();
}

function addPairsArea(container, idx, pairs) {
    const div = document.createElement('div');
    div.innerHTML = `<label class="block text-[10px] uppercase font-bold text-slate-500 ml-1">Paare</label>
                     <div class="list space-y-1"></div>`;
    const list = div.querySelector('.list');
    const render = () => {
        list.innerHTML = '';
        pairs.forEach((p, i) => {
            const pdiv = document.createElement('div');
            pdiv.className = 'flex gap-2';
            pdiv.innerHTML = `
                <input type="text" value="${p.left || ''}" class="pair-left flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" placeholder="Links">
                <input type="text" value="${p.right || ''}" class="pair-right flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" placeholder="Rechts">
            `;
            pdiv.querySelectorAll('input').forEach(el => el.addEventListener('input', () => updateTaskData(idx)));
            list.appendChild(pdiv);
        });
    };
    const addBtn = document.createElement('button');
    addBtn.className = 'text-[10px] text-blue-400 font-bold ml-1';
    addBtn.textContent = '+ PAAR';
    addBtn.onclick = () => { pairs.push({ left: '', right: '' }); render(); };
    div.appendChild(addBtn);
    container.appendChild(div);
    render();
}

function updateTaskData(idx) {
    const container = document.getElementById(`fields-${idx}`);
    const task = tasks[idx];

    // Scrape generic inputs
    container.querySelectorAll('input[data-key], textarea[data-key]').forEach(input => {
        const key = input.dataset.key;
        let val = input.value;
        if (key === 'rules' || key === 'fakes') val = val.split(',').map(s => s.trim());
        if (key === 'nodes') { try { val = JSON.parse(val); } catch(e) {} }
        if (key === 'zones') { try { val = JSON.parse(val); } catch(e) {} }
        task[key] = val;
    });

    // Scrape specific areas
    if (selectedCategory === 'choice' || selectedCategory === 'select') {
        task.options = Array.from(container.querySelectorAll('.option-input')).map(i => i.value).filter(v => v);
    } else if (selectedCategory === 'scroller') {
        task.posts = Array.from(container.querySelectorAll('.posts-list > div')).map(pdiv => ({
            user: pdiv.querySelector('.post-user').value,
            text: pdiv.querySelector('.post-text').value,
            isBad: pdiv.querySelector('.post-is-bad').checked
        }));
    } else if (selectedCategory === 'profile') {
        task.fields = Array.from(container.querySelectorAll('.profile-field:checked')).map(i => i.value);
        task.customFields = Array.from(container.querySelectorAll('.custom-profile-input')).map(i => i.value);
    } else if (selectedCategory === 'bucket') {
        task.buckets = Array.from(container.querySelectorAll('.bucket-name')).map(i => i.value);
        task.items = Array.from(container.querySelectorAll('.items-list .flex')).map(idiv => ({
            text: idiv.querySelector('.item-text').value,
            target: parseInt(idiv.querySelector('.item-target').value) - 1
        }));
    } else if (selectedCategory === 'ranking') {
        task.items = Array.from(container.querySelectorAll('.ranking-item')).map(i => i.value);
    } else if (selectedCategory === 'pairs') {
        task.pairs = Array.from(container.querySelectorAll('.flex')).map(pdiv => ({
            left: pdiv.querySelector('.pair-left')?.value,
            right: pdiv.querySelector('.pair-right')?.value
        })).filter(p => p.left && p.right);
    }
}

function updatePreview() {
    const container = document.getElementById('previewContainer');
    if (tasks.length === 0) {
        container.innerHTML = '<p class="text-slate-500 italic">Keine Aufgaben in der Sequenz...</p>';
        return;
    }

    const task = tasks[0]; // Always preview first task
    const type = selectedCategory;

    container.innerHTML = `<div class="space-y-4">
        <h3 class="text-2xl font-bold text-blue-400 mb-2">${categories.find(c => c.id === type).name}</h3>
        <p class="text-xs text-slate-500 mb-6 italic">AUFGABE 1 VON ${tasks.length}</p>
        <div class="preview-inner border border-slate-700 rounded-2xl p-4 bg-slate-900/50">
            ${renderPreviewContent(type, task)}
        </div>
    </div>`;
}

function renderPreviewContent(type, task) {
    if (type === 'binary') {
        return `<div class="text-6xl mb-4">${task.icon || '❓'}</div><p class="text-sm">${task.question || 'Deine Frage...'}</p>`;
    }
    if (type === 'choice' || type === 'select') {
        return `<p class="text-sm font-bold mb-4">${task.question || 'Deine Frage...'}</p>
                <div class="space-y-2">${(task.options || []).map(o => `<div class="bg-slate-800 p-2 rounded text-xs text-left border border-slate-700">${o}</div>`).join('')}</div>`;
    }
    return `<p class="text-slate-500 text-xs italic">Vorschau für diesen Typ im Editor begrenzt. Speichere und starte eine Session zum Testen.</p>`;
}

async function saveBlueprint() {
    const title = document.getElementById('blueprintTitle').value;
    if (!title) return alert('Bitte gib einen Titel für den Blueprint ein.');
    if (tasks.length === 0) return alert('Bitte füge mindestens eine Aufgabe hinzu.');

    // Final data sync
    tasks.forEach((_, i) => updateTaskData(i));

    // Validation
    if (selectedCategory === 'scroller') {
        for (let i = 0; i < tasks.length; i++) {
            if ((tasks[i].posts || []).length < 10) {
                return alert(`Aufgabe ${i+1}: Bitte erstelle mindestens 10 Posts für den Scroller, damit er flüssig scrollt.`);
            }
        }
    }

    const res = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title,
            gameType: selectedCategory,
            content: { tasks: tasks }
        })
    });

    if (res.ok) {
        alert('Blueprint erfolgreich gespeichert!', 'Gespeichert', '✅');
        loadBlueprints();
        // Reset
        document.getElementById('editorContainer').classList.add('hidden');
        document.getElementById('editorPlaceholder').classList.remove('hidden');
        selectedCategory = null;
        renderCategories();
    } else {
        alert('Fehler beim Speichern.');
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
        div.className = 'p-3 bg-slate-700/50 rounded-xl flex justify-between items-center group hover:bg-slate-700 transition-all';
        div.innerHTML = `
            <div>
                <p class="font-bold text-xs">${bp.title}</p>
                <p class="text-[9px] text-slate-500 uppercase">${bp.game_type} • ${bp.content.tasks.length} AUFGABEN</p>
            </div>
            <button onclick="deleteBlueprint(${bp.id})" class="text-slate-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                &times;
            </button>
        `;
        list.appendChild(div);
    });
}

async function deleteBlueprint(id) {
    if (!await confirm('Diesen Blueprint wirklich löschen?')) return;
    const res = await fetch(`/api/blueprints/${id}`, { method: 'DELETE' });
    if (res.ok) loadBlueprints();
}

checkAuth();
renderCategories();
