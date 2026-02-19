const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        code TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        game_status TEXT DEFAULT 'waiting', -- 'waiting' or 'running'
        game_type TEXT DEFAULT 'binary', -- 'binary', 'choice', 'select'
        blueprint_id INTEGER,
        max_teams INTEGER DEFAULT 5,
        created_at DATETIME,
        closed_at DATETIME,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id),
        FOREIGN KEY (blueprint_id) REFERENCES blueprints(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        group_size INTEGER DEFAULT 1,
        team_code TEXT,
        created_at DATETIME,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS blueprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        game_type TEXT NOT NULL,
        content TEXT NOT NULL, -- JSON
        created_at DATETIME,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        team_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (team_id) REFERENCES teams(id)
    )`);

    // Indexes for performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_teams_code ON teams(team_code)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacher_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_teams_session ON teams(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_blueprints_teacher ON blueprints(teacher_id)`);
});

// Promise-based wrapper
const dbAsync = {
    get: (sql, params = []) => new Promise((res, rej) => {
        db.get(sql, params, (err, row) => err ? rej(err) : res(row));
    }),
    all: (sql, params = []) => new Promise((res, rej) => {
        db.all(sql, params, (err, rows) => err ? rej(err) : res(rows));
    }),
    run: (sql, params = []) => new Promise((res, rej) => {
        db.run(sql, params, function(err) {
            err ? rej(err) : res({ lastID: this.lastID, changes: this.changes });
        });
    })
};

module.exports = { db, dbAsync };
