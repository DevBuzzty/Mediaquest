'use strict';

exports.up = `
CREATE TABLE teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE blueprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    game_type TEXT NOT NULL DEFAULT 'template',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
);
CREATE INDEX idx_blueprints_teacher ON blueprints(teacher_id);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    game_status TEXT NOT NULL DEFAULT 'waiting' CHECK (game_status IN ('waiting', 'running')),
    blueprint_id INTEGER REFERENCES blueprints(id) ON DELETE SET NULL,
    snapshot TEXT NOT NULL,
    snapshot_rev INTEGER NOT NULL DEFAULT 0,
    max_teams INTEGER NOT NULL DEFAULT 5 CHECK (max_teams BETWEEN 1 AND 10),
    results_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    closed_at TEXT
);
CREATE INDEX idx_sessions_teacher ON sessions(teacher_id);
CREATE UNIQUE INDEX idx_sessions_one_active ON sessions(teacher_id) WHERE status = 'active';

CREATE TABLE teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    group_size INTEGER NOT NULL DEFAULT 1 CHECK (group_size BETWEEN 1 AND 10),
    team_code TEXT NOT NULL UNIQUE,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, color)
);
CREATE INDEX idx_teams_session ON teams(session_id);

CREATE TABLE task_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    task_key TEXT NOT NULL,
    task_index INTEGER NOT NULL,
    task_type TEXT NOT NULL,
    task_title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'skipped')),
    answer TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (team_id, task_key)
);
CREATE INDEX idx_task_results_session ON task_results(session_id);

CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    task_key TEXT NOT NULL,
    task_title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('photo', 'statement')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (team_id, task_key)
);
CREATE INDEX idx_submissions_session ON submissions(session_id);

CREATE TABLE uploads (
    filename TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('blueprint', 'submission')),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_uploads_team ON uploads(team_id);
CREATE INDEX idx_uploads_session ON uploads(session_id);

CREATE TABLE http_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
);
CREATE INDEX idx_http_sessions_expires ON http_sessions(expires);
`;
