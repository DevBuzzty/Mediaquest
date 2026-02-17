require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const db = require('./db');
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
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM teachers WHERE username = ?', [username], async (err, teacher) => {
        if (err) return res.status(500).json({ error: 'Datenbankfehler' });
        if (!teacher) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

        const match = await bcrypt.compare(password, teacher.password);
        if (match) {
            req.session.teacherId = teacher.id;
            req.session.username = teacher.username;
            res.json({ success: true, username: teacher.username });
        } else {
            res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
    });
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

app.post('/api/sessions', isAuthenticated, (req, res) => {
    const teacherId = req.session.teacherId;
    const { maxTeams } = req.body;

    db.get('SELECT id FROM sessions WHERE teacher_id = ? AND status = "active"', [teacherId], (err, row) => {
        if (row) {
            db.run('UPDATE sessions SET status = "closed", closed_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
        }

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const createdAt = new Date().toISOString();

        db.run('INSERT INTO sessions (teacher_id, code, max_teams, created_at) VALUES (?, ?, ?, ?)', [teacherId, code, maxTeams || 5, createdAt], function(err) {
            if (err) return res.status(500).json({ error: 'Fehler beim Erstellen der Session' });
            res.json({ success: true, code: code });
        });
    });
});

app.get('/api/sessions/active', isAuthenticated, (req, res) => {
    db.get('SELECT * FROM sessions WHERE teacher_id = ? AND status = "active"', [req.session.teacherId], (err, session) => {
        if (err) return res.status(500).json({ error: 'Datenbankfehler' });
        if (!session) return res.json({ active: false });

        db.all('SELECT * FROM teams WHERE session_id = ?', [session.id], (err, teams) => {
            res.json({ active: true, session: session, teams: teams });
        });
    });
});

app.post('/api/sessions/close', isAuthenticated, (req, res) => {
    const closedAt = new Date().toISOString();
    db.run('UPDATE sessions SET status = "closed", closed_at = ? WHERE teacher_id = ? AND status = "active"', [closedAt, req.session.teacherId], (err) => {
        if (err) return res.status(500).json({ error: 'Fehler beim Schließen der Session' });
        res.json({ success: true });
    });
});

app.get('/api/sessions/history', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM sessions WHERE teacher_id = ? AND status = "closed" ORDER BY created_at DESC', [req.session.teacherId], (err, sessions) => {
        if (err) return res.status(500).json({ error: 'Datenbankfehler' });
        res.json({ sessions });
    });
});

app.get('/api/sessions/:id/teams', isAuthenticated, (req, res) => {
    const sessionId = req.params.id;
    db.get('SELECT id FROM sessions WHERE id = ? AND teacher_id = ?', [sessionId, req.session.teacherId], (err, session) => {
        if (!session) return res.status(403).json({ error: 'Zugriff verweigert' });
        db.all('SELECT * FROM teams WHERE session_id = ?', [sessionId], (err, teams) => {
            res.json({ teams });
        });
    });
});

app.post('/api/join', (req, res) => {
    const { code } = req.body;
    db.get('SELECT * FROM sessions WHERE code = ? AND status = "active"', [code.toUpperCase()], (err, session) => {
        if (err) return res.status(500).json({ error: 'Datenbankfehler' });
        if (!session) return res.status(404).json({ error: 'Session nicht gefunden oder abgelaufen' });
        res.json({ success: true, sessionId: session.id, maxTeams: session.max_teams });
    });
});

app.post('/api/teams', (req, res) => {
    const { sessionId, name, color, groupSize } = req.body;

    if (containsBadWords(name)) {
        return res.status(400).json({ error: 'Unangemessener Teamname' });
    }

    db.get('SELECT max_teams FROM sessions WHERE id = ? AND status = "active"', [sessionId], (err, session) => {
        if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

        db.get('SELECT COUNT(*) as count FROM teams WHERE session_id = ?', [sessionId], (err, row) => {
            if (row.count >= session.max_teams) {
                return res.status(400).json({ error: 'Maximale Teamanzahl erreicht' });
            }

            const createdAt = new Date().toISOString();
            db.run('INSERT INTO teams (session_id, name, color, group_size, created_at) VALUES (?, ?, ?, ?, ?)', [sessionId, name, color, groupSize || 1, createdAt], function(err) {
                if (err) return res.status(500).json({ error: 'Fehler bei der Teamerstellung' });
                io.to(`session_${sessionId}`).emit('teamCreated', { id: this.lastID, name, color, group_size: groupSize, created_at: createdAt });
                res.json({ success: true, teamId: this.lastID });
            });
        });
    });
});

io.on('connection', (socket) => {
    socket.on('joinSessionRoom', (sessionId) => {
        socket.join(`session_${sessionId}`);
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});
