'use strict';

// Eingefrorener Stand der Kartensets: Das Seed darf sich aendern, eine Migration nicht.
const WORLD_KARTENSETS = require('./002_board.kartensets.json');

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Bestehende Konten bekommen die Beispiel-Kartensets genau einmal, mit dieser Migration.
function backfillKartensets() {
    const now = new Date().toISOString();
    return WORLD_KARTENSETS.map((set) => `
INSERT INTO blueprints (teacher_id, title, game_type, content, created_at)
SELECT id, ${sqlText(set.title)}, 'template', ${sqlText(JSON.stringify({ templateType: 'world', world: set.world, tasks: set.tasks }))}, ${sqlText(now)}
FROM teachers;`).join('\n');
}

exports.up = `
ALTER TABLE sessions ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'classic' CHECK (game_mode IN ('classic', 'board'));

CREATE TABLE board_states (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    world_count INTEGER NOT NULL CHECK (world_count BETWEEN 1 AND 5),
    portals TEXT NOT NULL,
    sets TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('lobby', 'round', 'result', 'monster', 'continue', 'portal', 'worldDone', 'finished')),
    world TEXT,
    main_pos INTEGER NOT NULL DEFAULT 1,
    world_pos INTEGER NOT NULL DEFAULT 1,
    round INTEGER NOT NULL DEFAULT 0,
    remaining_steps INTEGER NOT NULL DEFAULT 0,
    last_result TEXT,
    pending TEXT,
    done_portals TEXT NOT NULL DEFAULT '[]',
    rev INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE board_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    set_key TEXT NOT NULL,
    card_index INTEGER NOT NULL,
    code TEXT NOT NULL,
    task_type TEXT NOT NULL,
    task_title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('working', 'finished', 'skipped')),
    answer TEXT,
    correct INTEGER,
    opened_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE (session_id, round, team_id),
    UNIQUE (session_id, round, card_index)
);
CREATE INDEX idx_board_cards_team ON board_cards(team_id);

${backfillKartensets()}
`;
