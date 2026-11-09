'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function loadMigrations() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d+_.+\.js$/.test(name))
        .map((name) => ({ version: Number.parseInt(name, 10), name, up: require(path.join(MIGRATIONS_DIR, name)).up }))
        .sort((a, b) => a.version - b.version);
}

/** Datenbanken von vor den Migrationen haben Tabellen, aber keinen Stand. */
async function refuseLegacyDatabase(conn, version) {
    if (version !== 0) return;
    if (!await conn.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teachers'")) return;
    throw new Error('Diese Datenbank stammt aus einer alten Version ohne Migrationsstand und lässt sich nicht aktualisieren. Lege sie neu an (siehe README, Abschnitt "Alte Datenbanken"); ihre Daten bleiben unverändert.');
}

/**
 * Spielt fehlende Migrationen ein. Der Stand steht in PRAGMA user_version,
 * jede Migration laeuft in einer eigenen Transaktion.
 */
async function migrate(conn) {
    const row = await conn.get('PRAGMA user_version');
    let current = row.user_version;
    await refuseLegacyDatabase(conn, current);
    for (const migration of loadMigrations()) {
        if (migration.version <= current) continue;
        await conn.exec('BEGIN IMMEDIATE');
        try {
            await conn.exec(migration.up);
            await conn.exec(`PRAGMA user_version = ${migration.version}`);
            await conn.exec('COMMIT');
        } catch (err) {
            await conn.exec('ROLLBACK').catch(() => {});
            throw new Error(`Migration ${migration.name} fehlgeschlagen: ${err.message}`);
        }
        current = migration.version;
    }
}

module.exports = { migrate };
