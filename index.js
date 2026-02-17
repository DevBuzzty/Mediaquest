require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const { dbAsync } = require('./db');
const { containsBadWords } = require('./filter');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'weltenretter-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.use(express.static('public'));

function isAuthenticated(req, res, next) {
    if (req.session.teacherId) return next();
    res.status(401).json({ error: 'Nicht autorisiert' });
}

// Routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const teacher = await dbAsync.get('SELECT * FROM teachers WHERE username = ?', [username]);
        if (!teacher) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

        const match = await bcrypt.compare(password, teacher.password);
        if (match) {
            req.session.teacherId = teacher.id;
            req.session.username = teacher.username;
            res.json({ success: true, username: teacher.username });
        } else {
            res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (req.session.teacherId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/sessions', isAuthenticated, async (req, res) => {
    const teacherId = req.session.teacherId;
    const { maxTeams } = req.body;

    try {
        const activeSession = await dbAsync.get('SELECT id FROM sessions WHERE teacher_id = ? AND status = "active"', [teacherId]);
        if (activeSession) {
            await dbAsync.run('UPDATE sessions SET status = "closed", closed_at = ? WHERE id = ?', [new Date().toISOString(), activeSession.id]);
        }

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const createdAt = new Date().toISOString();

        await dbAsync.run('INSERT INTO sessions (teacher_id, code, max_teams, created_at) VALUES (?, ?, ?, ?)', [teacherId, code, maxTeams || 5, createdAt]);
        res.json({ success: true, code: code });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Erstellen der Session' });
    }
});

app.get('/api/sessions/active', isAuthenticated, async (req, res) => {
    try {
        const session = await dbAsync.get('SELECT * FROM sessions WHERE teacher_id = ? AND status = "active"', [req.session.teacherId]);
        if (!session) return res.json({ active: false });

        const teams = await dbAsync.all('SELECT * FROM teams WHERE session_id = ?', [session.id]);
        res.json({ active: true, session: session, teams: teams });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/sessions/close', isAuthenticated, async (req, res) => {
    try {
        const closedAt = new Date().toISOString();
        await dbAsync.run('UPDATE sessions SET status = "closed", closed_at = ? WHERE teacher_id = ? AND status = "active"', [closedAt, req.session.teacherId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Schließen der Session' });
    }
});

app.get('/api/sessions/history', isAuthenticated, async (req, res) => {
    try {
        const sessions = await dbAsync.all('SELECT * FROM sessions WHERE teacher_id = ? AND status = "closed" ORDER BY created_at DESC', [req.session.teacherId]);
        res.json({ sessions });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.get('/api/sessions/:id/teams', isAuthenticated, async (req, res) => {
    const sessionId = req.params.id;
    try {
        const session = await dbAsync.get('SELECT id FROM sessions WHERE id = ? AND teacher_id = ?', [sessionId, req.session.teacherId]);
        if (!session) return res.status(403).json({ error: 'Zugriff verweigert' });
        const teams = await dbAsync.all('SELECT * FROM teams WHERE session_id = ?', [sessionId]);
        res.json({ teams });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/join', async (req, res) => {
    const { code } = req.body;
    try {
        const session = await dbAsync.get('SELECT * FROM sessions WHERE code = ? AND status = "active"', [code.toUpperCase()]);
        if (!session) return res.status(404).json({ error: 'Session nicht gefunden oder abgelaufen' });
        res.json({ success: true, sessionId: session.id, maxTeams: session.max_teams });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/teams', async (req, res) => {
    const { sessionId, name, color, groupSize } = req.body;

    if (containsBadWords(name)) {
        return res.status(400).json({ error: 'Unangemessener Teamname' });
    }

    try {
        const session = await dbAsync.get('SELECT max_teams FROM sessions WHERE id = ? AND status = "active"', [sessionId]);
        if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

        const row = await dbAsync.get('SELECT COUNT(*) as count FROM teams WHERE session_id = ?', [sessionId]);
        if (row.count >= session.max_teams) {
            return res.status(400).json({ error: 'Maximale Teamanzahl erreicht' });
        }

        const createdAt = new Date().toISOString();
        const result = await dbAsync.run('INSERT INTO teams (session_id, name, color, group_size, created_at) VALUES (?, ?, ?, ?, ?)', [sessionId, name, color, groupSize || 1, createdAt]);
        io.to(`session_${sessionId}`).emit('teamCreated', { id: result.lastID, name, color, group_size: groupSize, created_at: createdAt });
        res.json({ success: true, teamId: result.lastID });
    } catch (err) {
        res.status(500).json({ error: 'Fehler bei der Teamerstellung' });
    }
});

// Update Team Limit (Teacher)
app.patch('/api/sessions/active/limit', isAuthenticated, async (req, res) => {
    const { maxTeams } = req.body;
    try {
        const session = await dbAsync.get('SELECT id FROM sessions WHERE teacher_id = ? AND status = "active"', [req.session.teacherId]);
        if (!session) return res.status(404).json({ error: 'Keine aktive Session gefunden' });

        const teamCount = await dbAsync.get('SELECT COUNT(*) as count FROM teams WHERE session_id = ?', [session.id]);
        if (maxTeams < teamCount.count) {
            return res.status(400).json({ error: 'Das Limit kann nicht kleiner als die aktuelle Teamanzahl sein.' });
        }

        await dbAsync.run('UPDATE sessions SET max_teams = ? WHERE id = ?', [maxTeams, session.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Aktualisieren des Limits' });
    }
});

io.on('connection', (socket) => {
    socket.on('joinSessionRoom', (sessionId) => {
        socket.join(`session_${sessionId}`);
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});
