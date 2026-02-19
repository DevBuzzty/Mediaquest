const WeltenretterUI = {
    modal: null,

    init() {
        if (document.getElementById('wr-modal-container')) return;
        const container = document.createElement('div');
        container.id = 'wr-modal-container';
        container.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm hidden opacity-0 transition-all duration-300';
        container.innerHTML = `
            <div id="wr-modal-content" class="bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-8 transform scale-95 transition-all duration-300">
                <div id="wr-modal-icon" class="w-16 h-16 rounded-full bg-blue-600/20 flex items-center justify-center mx-auto mb-6 text-3xl">ℹ️</div>
                <h3 id="wr-modal-title" class="text-2xl font-bold text-center text-white mb-4">Meldung</h3>
                <p id="wr-modal-text" class="text-slate-400 text-center mb-8 leading-relaxed"></p>
                <div id="wr-modal-actions" class="flex flex-col gap-3">
                    <button id="wr-modal-ok" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all active:scale-95">Verstanden</button>
                    <button id="wr-modal-cancel" class="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold py-3 px-6 rounded-xl transition-all active:scale-95 hidden">Abbrechen</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        this.modal = container;
    },

    alert(text, title = "Hinweis", icon = "ℹ️") {
        this.init();
        return new Promise(resolve => {
            document.getElementById('wr-modal-title').textContent = title;
            document.getElementById('wr-modal-text').textContent = text;
            document.getElementById('wr-modal-icon').textContent = icon;
            document.getElementById('wr-modal-cancel').classList.add('hidden');

            const okBtn = document.getElementById('wr-modal-ok');
            okBtn.onclick = () => {
                this.hide();
                resolve();
            };

            this.show();
        });
    },

    confirm(text, title = "Bist du sicher?", icon = "❓") {
        this.init();
        return new Promise(resolve => {
            document.getElementById('wr-modal-title').textContent = title;
            document.getElementById('wr-modal-text').textContent = text;
            document.getElementById('wr-modal-icon').textContent = icon;

            const cancelBtn = document.getElementById('wr-modal-cancel');
            cancelBtn.classList.remove('hidden');

            const okBtn = document.getElementById('wr-modal-ok');
            okBtn.onclick = () => {
                this.hide();
                resolve(true);
            };

            cancelBtn.onclick = () => {
                this.hide();
                resolve(false);
            };

            this.show();
        });
    },

    show() {
        this.modal.classList.remove('hidden');
        setTimeout(() => {
            this.modal.classList.add('opacity-100');
            this.modal.querySelector('#wr-modal-content').classList.remove('scale-95');
            this.modal.querySelector('#wr-modal-content').classList.add('scale-100');
        }, 10);
    },

    hide() {
        this.modal.classList.remove('opacity-100');
        this.modal.querySelector('#wr-modal-content').classList.remove('scale-100');
        this.modal.querySelector('#wr-modal-content').classList.add('scale-95');
        setTimeout(() => {
            this.modal.classList.add('hidden');
        }, 300);
    }
};

// Global overrides
window.alert = (t) => WeltenretterUI.alert(t);
window.confirm = (t) => WeltenretterUI.confirm(t);
