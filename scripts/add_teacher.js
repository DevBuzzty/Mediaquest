'use strict';

/*
 * Legt eine Lehrkraft an. Das Passwort kommt per Eingabe oder stdin,
 * niemals als Argument (sonst landet es in Shell-Historie und Prozessliste).
 *
 *   node scripts/add_teacher.js <benutzername>
 *   echo "$PASSWORT" | node scripts/add_teacher.js <benutzername>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');
const readline = require('readline');
const { Writable } = require('stream');
const { loadConfig } = require('../src/config');
const { openDatabase, isUniqueViolation } = require('../src/db');
const { seedExampleBlueprints } = require('../src/seed');
const { schemas } = require('../src/lib/schemas');

const MIN_PASSWORD_LENGTH = 8;

function readPasswordFromPipe() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data.split(/\r?\n/)[0]));
        process.stdin.on('error', reject);
    });
}

function promptHidden(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);
        const muted = new Writable({ write(chunk, encoding, done) { done(); } });
        const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
        rl.question('', (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
    });
}

async function main() {
    if (!process.argv[2] || process.argv.length > 3) {
        console.error('Aufruf: node scripts/add_teacher.js <benutzername>  (Passwort per Eingabe oder stdin)');
        return 1;
    }
    // Dieselbe Regel wie beim Login, sonst entstehen Konten, die sich nie anmelden können.
    const name = schemas.login.shape.username.safeParse(process.argv[2]);
    if (!name.success) {
        console.error('Der Benutzername braucht 1 bis 254 Zeichen, Leerzeichen am Anfang und Ende nicht mitgezählt.');
        return 1;
    }
    const username = name.data;
    const password = process.stdin.isTTY ? await promptHidden('Passwort: ') : await readPasswordFromPipe();
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        console.error(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
        return 1;
    }

    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    try {
        await db.ready;
        const hash = await bcrypt.hash(password, config.bcryptRounds);
        await db.transaction(async (tx) => {
            const result = await tx.run('INSERT INTO teachers (username, password, created_at) VALUES (?, ?, ?)', [username, hash, new Date().toISOString()]);
            await seedExampleBlueprints(tx, result.lastID);
        });
        console.log(`Lehrkraft ${username} wurde angelegt.`);
        return 0;
    } catch (err) {
        console.error(isUniqueViolation(err) ? 'Fehler: Benutzername existiert bereits.' : `Fehler: ${err.message}`);
        return 1;
    } finally {
        await db.close();
    }
}

main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`Fehler: ${err.message}`);
    process.exitCode = 1;
});
