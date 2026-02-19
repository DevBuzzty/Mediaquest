require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { dbAsync, db } = require('./db');
const { containsBadWords } = require('./filter');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Email Transporter (Nodemailer)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || 'user@example.com',
        pass: process.env.SMTP_PASS || 'password'
    }
});

// Ensure default accounts exist
async function ensureDefaultAccounts() {
    try {
        // Test account
        const testUser = await dbAsync.get('SELECT * FROM teachers WHERE username = ?', ['test']);
        if (!testUser) {
            const hashedPass = await bcrypt.hash('test', 10);
            await dbAsync.run('INSERT INTO teachers (username, password) VALUES (?, ?)', ['test', hashedPass]);
            console.log('Test account (test:test) created.');
        }

        // Admin account
        const adminUser = await dbAsync.get('SELECT * FROM teachers WHERE username = ?', ['admin']);
        if (!adminUser) {
            const hashedPass = await bcrypt.hash('admin', 10);
            await dbAsync.run('INSERT INTO teachers (username, password) VALUES (?, ?)', ['admin', hashedPass]);
            console.log('Admin account (admin:admin) created.');
        }
    } catch (err) {
        console.error('Error creating default accounts:', err);
    }
}
ensureDefaultAccounts();

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

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

function isAuthenticated(req, res, next) {
    if (req.session.teacherId) return next();
    res.status(401).json({ error: 'Nicht autorisiert' });
}

// Routes
app.post('/api/register', async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
    }

    try {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const hashedPassword = await bcrypt.hash(code, 10);

        // Update or Insert
        const existing = await dbAsync.get('SELECT id FROM teachers WHERE username = ?', [email]);
        if (existing) {
            await dbAsync.run('UPDATE teachers SET password = ? WHERE id = ?', [hashedPassword, existing.id]);
        } else {
            await dbAsync.run('INSERT INTO teachers (username, password) VALUES (?, ?)', [email, hashedPassword]);
        }

        // Send Email
        console.log(`[DEBUG] Registrierung für ${email}: Code = ${code}`);

        try {
            await transporter.sendMail({
                from: `"Weltenretter App" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'Dein Login-Code für Weltenretter',
                text: `Hallo!\n\nDein Login-Code für die Weltenretter App lautet: ${code}\n\nNutze diesen Code als Passwort zusammen mit deiner E-Mail-Adresse.\n\nViel Spaß!`,
                html: `<p>Hallo!</p><p>Dein Login-Code für die Weltenretter App lautet:</p><h2 style="color: #3b82f6;">${code}</h2><p>Nutze diesen Code als Passwort zusammen mit deiner E-Mail-Adresse.</p><p>Viel Spaß!</p>`
            });
            res.json({ success: true, message: 'Code wurde per E-Mail gesendet.' });
        } catch (mailErr) {
            console.warn('E-Mail Versand fehlgeschlagen, aber Account wurde erstellt/aktualisiert. Code:', code);
            // If mail fails but we are in dev/local, we might still want to succeed or at least tell the user.
            res.json({ success: true, message: 'Account aktualisiert. (E-Mail konnte nicht gesendet werden, siehe Server-Konsole)' });
        }
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Fehler bei der Registrierung oder E-Mail-Versand' });
    }
});

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

app.get('/api/sessions/:id/submissions', isAuthenticated, async (req, res) => {
    const sessionId = req.params.id;
    try {
        const session = await dbAsync.get('SELECT id FROM sessions WHERE id = ? AND teacher_id = ?', [sessionId, req.session.teacherId]);
        if (!session) return res.status(403).json({ error: 'Zugriff verweigert' });
        const submissions = await dbAsync.all(`
            SELECT s.*, t.name as team_name, t.color as team_color
            FROM submissions s
            JOIN teams t ON s.team_id = t.id
            WHERE s.session_id = ?
            ORDER BY s.created_at DESC
        `, [sessionId]);
        res.json({ submissions });
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

// File Upload Route
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: url });
});

// Blueprint Routes
app.get('/api/blueprints', isAuthenticated, async (req, res) => {
    try {
        const blueprints = await dbAsync.all('SELECT * FROM blueprints WHERE teacher_id = ? ORDER BY created_at DESC', [req.session.teacherId]);
        res.json({ blueprints: blueprints.map(bp => ({ ...bp, content: JSON.parse(bp.content) })) });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/blueprints', isAuthenticated, async (req, res) => {
    const { title, gameType, content } = req.body;
    try {
        await dbAsync.run(
            'INSERT INTO blueprints (teacher_id, title, game_type, content, created_at) VALUES (?, ?, ?, ?, ?)',
            [req.session.teacherId, title, gameType, JSON.stringify(content), new Date().toISOString()]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.delete('/api/blueprints/:id', isAuthenticated, async (req, res) => {
    try {
        await dbAsync.run('DELETE FROM blueprints WHERE id = ? AND teacher_id = ?', [req.params.id, req.session.teacherId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/sessions', isAuthenticated, async (req, res) => {
    const teacherId = req.session.teacherId;
    const { maxTeams, gameType, blueprintId } = req.body;

    try {
        const activeSession = await dbAsync.get('SELECT id FROM sessions WHERE teacher_id = ? AND status = "active"', [teacherId]);
        if (activeSession) {
            await dbAsync.run('UPDATE sessions SET status = "closed", closed_at = ? WHERE id = ?', [new Date().toISOString(), activeSession.id]);
        }

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const createdAt = new Date().toISOString();

        await dbAsync.run(
            'INSERT INTO sessions (teacher_id, code, max_teams, game_type, blueprint_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [teacherId, code, maxTeams || 5, gameType || 'binary', blueprintId || null, createdAt]
        );
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

app.post('/api/sessions/:id/reopen', isAuthenticated, async (req, res) => {
    const sessionId = req.params.id;
    try {
        const teacherId = req.session.teacherId;

        // Close any currently active session first
        await dbAsync.run('UPDATE sessions SET status = "closed", closed_at = ? WHERE teacher_id = ? AND status = "active"', [new Date().toISOString(), teacherId]);

        // Reopen the requested session
        await dbAsync.run('UPDATE sessions SET status = "active", closed_at = NULL WHERE id = ? AND teacher_id = ?', [sessionId, teacherId]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Wiedereröffnen' });
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

app.post('/api/rejoin', async (req, res) => {
    const { teamCode } = req.body;
    try {
        const team = await dbAsync.get(`
            SELECT t.*, s.status as session_status, s.game_status, s.game_type, s.blueprint_id, s.code as session_code
            FROM teams t
            JOIN sessions s ON t.session_id = s.id
            WHERE t.team_code = ? AND s.status = 'active'
        `, [teamCode.toUpperCase()]);

        if (!team) return res.status(404).json({ error: 'Team-Code ungültig oder Session beendet.' });

        let blueprint = null;
        if (team.blueprint_id) {
            const bp = await dbAsync.get('SELECT content FROM blueprints WHERE id = ?', [team.blueprint_id]);
            if (bp) blueprint = JSON.parse(bp.content);
        }

        res.json({
            success: true,
            sessionId: team.session_id,
            teamId: team.id,
            name: team.name,
            color: team.color,
            groupSize: team.group_size,
            gameStatus: team.game_status,
            gameType: team.game_type,
            blueprint: blueprint,
            sessionCode: team.session_code
        });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/join', async (req, res) => {
    const { code } = req.body;
    try {
        const session = await dbAsync.get('SELECT * FROM sessions WHERE code = ? AND status = "active"', [code.toUpperCase()]);
        if (!session) return res.status(404).json({ error: 'Session nicht gefunden oder abgelaufen' });

        const teams = await dbAsync.all('SELECT color FROM teams WHERE session_id = ?', [session.id]);
        const takenColors = teams.map(t => t.color);

        let blueprint = null;
        if (session.blueprint_id) {
            const bp = await dbAsync.get('SELECT content FROM blueprints WHERE id = ?', [session.blueprint_id]);
            if (bp) blueprint = JSON.parse(bp.content);
        }

        res.json({
            success: true,
            sessionId: session.id,
            maxTeams: session.max_teams,
            gameStatus: session.game_status,
            gameType: session.game_type,
            blueprint: blueprint,
            takenColors
        });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

app.post('/api/teams', async (req, res) => {
    const { sessionId, name, color, groupSize } = req.body;

    if (containsBadWords(name)) {
        return res.status(400).json({ error: 'Unangemessener Teamname' });
    }

    if (groupSize > 10) {
        return res.status(400).json({ error: 'Maximale Teamgröße ist 10 Personen.' });
    }

    try {
        const session = await dbAsync.get('SELECT max_teams FROM sessions WHERE id = ? AND status = "active"', [sessionId]);
        if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

        const row = await dbAsync.get('SELECT COUNT(*) as count FROM teams WHERE session_id = ?', [sessionId]);
        if (row.count >= Math.min(session.max_teams, 10)) {
            return res.status(400).json({ error: 'Maximale Teamanzahl erreicht (max. 10)' });
        }

        // Check if color is already taken
        const colorTaken = await dbAsync.get('SELECT id FROM teams WHERE session_id = ? AND color = ?', [sessionId, color]);
        if (colorTaken) {
            return res.status(400).json({ error: 'Diese Farbe ist bereits vergeben.' });
        }

        const createdAt = new Date().toISOString();
        const teamCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const result = await dbAsync.run(
            'INSERT INTO teams (session_id, name, color, group_size, team_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [sessionId, name, color, groupSize || 1, teamCode, createdAt]
        );

        io.to(`session_${sessionId}`).emit('teamCreated', { id: result.lastID, name, color, group_size: groupSize, created_at: createdAt });
        io.to(`session_${sessionId}`).emit('colorPicked', color);

        res.json({ success: true, teamId: result.lastID, teamCode: teamCode });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Fehler bei der Teamerstellung' });
    }
});

// Delete Team (Teacher)
app.delete('/api/teams/:id', isAuthenticated, async (req, res) => {
    const teamId = req.params.id;
    try {
        const team = await dbAsync.get('SELECT t.* FROM teams t JOIN sessions s ON t.session_id = s.id WHERE t.id = ? AND s.teacher_id = ?', [teamId, req.session.teacherId]);
        if (!team) return res.status(404).json({ error: 'Team nicht gefunden' });

        await dbAsync.run('DELETE FROM teams WHERE id = ?', [teamId]);

        io.to(`session_${team.session_id}`).emit('teamDeleted', teamId);
        io.to(`session_${team.session_id}`).emit('colorFreed', team.color);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Löschen des Teams' });
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

// Start Game (Teacher)
app.post('/api/sessions/active/start', isAuthenticated, async (req, res) => {
    try {
        const session = await dbAsync.get('SELECT id, game_type, blueprint_id FROM sessions WHERE teacher_id = ? AND status = "active"', [req.session.teacherId]);
        if (!session) return res.status(404).json({ error: 'Keine aktive Session gefunden' });

        await dbAsync.run('UPDATE sessions SET game_status = "running" WHERE id = ?', [session.id]);

        let blueprint = null;
        if (session.blueprint_id) {
            const bp = await dbAsync.get('SELECT content FROM blueprints WHERE id = ?', [session.blueprint_id]);
            if (bp) blueprint = JSON.parse(bp.content);
        }

        // Notify all students in this session
        io.to(`session_${session.id}`).emit('gameStarted', { gameType: session.game_type, blueprint });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Starten des Spiels' });
    }
});

// Live Change Game Mode (Teacher/Dev)
app.patch('/api/sessions/active/mode', isAuthenticated, async (req, res) => {
    const { gameType, blueprintId } = req.body;
    try {
        const session = await dbAsync.get('SELECT id FROM sessions WHERE teacher_id = ? AND status = "active"', [req.session.teacherId]);
        if (!session) return res.status(404).json({ error: 'Keine aktive Session gefunden' });

        await dbAsync.run('UPDATE sessions SET game_type = ?, blueprint_id = ? WHERE id = ?', [gameType, blueprintId || null, session.id]);

        let blueprint = null;
        if (blueprintId) {
            const bp = await dbAsync.get('SELECT content FROM blueprints WHERE id = ?', [blueprintId]);
            if (bp) blueprint = JSON.parse(bp.content);
        }

        // Notify all students in this session
        io.to(`session_${session.id}`).emit('gameModeUpdated', { gameType, blueprint });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Ändern des Spielmodus' });
    }
});

// End Game (Teacher)
app.post('/api/sessions/active/end', isAuthenticated, async (req, res) => {
    try {
        const session = await dbAsync.get('SELECT id FROM sessions WHERE teacher_id = ? AND status = "active"', [req.session.teacherId]);
        if (!session) return res.status(404).json({ error: 'Keine aktive Session gefunden' });

        await dbAsync.run('UPDATE sessions SET game_status = "waiting" WHERE id = ?', [session.id]);

        // Notify all students in this session
        io.to(`session_${session.id}`).emit('gameEnded');

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Beenden des Spiels' });
    }
});

io.on('connection', (socket) => {
    socket.on('joinSessionRoom', (sessionId) => {
        socket.join(`session_${sessionId}`);
    });

    socket.on('studentSubmission', async (data) => {
        try {
            const { sessionId, teamId, type, content } = data;
            await dbAsync.run(
                'INSERT INTO submissions (session_id, team_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)',
                [sessionId, teamId, type, content, new Date().toISOString()]
            );
            // Notify teacher
            io.to(`session_${sessionId}`).emit('newSubmission', data);
        } catch (err) {
            console.error('Submission error:', err);
        }
    });

    socket.on('showResults', (data) => {
        io.to(`session_${data.sessionId}`).emit('displayResults');
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});
