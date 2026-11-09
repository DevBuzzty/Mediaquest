'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { migrate } = require('./migrate');

function promisifiedRun(conn, sql, params) {
    return new Promise((resolve, reject) => {
        conn.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function promisifiedGet(conn, sql, params) {
    return new Promise((resolve, reject) => {
        conn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function promisifiedAll(conn, sql, params) {
    return new Promise((resolve, reject) => {
        conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function promisifiedExec(conn, sql) {
    return new Promise((resolve, reject) => {
        conn.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
}

/**
 * Promise-Huelle um die eine sqlite3-Verbindung.
 *
 * Alle Statements laufen nacheinander durch eine Warteschlange. Das ist noetig,
 * weil Transaktionen an der Verbindung haengen: Ohne Warteschlange wuerde ein
 * paralleler Request zwischen BEGIN und COMMIT in die fremde Transaktion geraten.
 * Innerhalb von transaction(fn) nur das uebergebene tx benutzen, nie db,
 * sonst wartet die Transaktion auf sich selbst.
 */
class Database {
    constructor(conn) {
        this.conn = conn;
        this.tail = Promise.resolve();
        this.txApi = {
            run: (sql, params = []) => promisifiedRun(this.conn, sql, params),
            get: (sql, params = []) => promisifiedGet(this.conn, sql, params),
            all: (sql, params = []) => promisifiedAll(this.conn, sql, params),
            exec: (sql) => promisifiedExec(this.conn, sql)
        };
    }

    enqueue(task) {
        const result = this.tail.then(task);
        this.tail = result.catch(() => {});
        return result;
    }

    run(sql, params = []) {
        return this.enqueue(() => this.txApi.run(sql, params));
    }

    get(sql, params = []) {
        return this.enqueue(() => this.txApi.get(sql, params));
    }

    all(sql, params = []) {
        return this.enqueue(() => this.txApi.all(sql, params));
    }

    exec(sql) {
        return this.enqueue(() => this.txApi.exec(sql));
    }

    transaction(body) {
        return this.enqueue(async () => {
            await this.txApi.exec('BEGIN IMMEDIATE');
            try {
                const result = await body(this.txApi);
                await this.txApi.exec('COMMIT');
                return result;
            } catch (err) {
                await this.txApi.exec('ROLLBACK').catch(() => {});
                throw err;
            }
        });
    }

    close() {
        return this.enqueue(() => new Promise((resolve, reject) => {
            this.conn.close((err) => (err ? reject(err) : resolve()));
        }));
    }
}

function openConnection(file) {
    return new Promise((resolve, reject) => {
        const conn = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(conn)));
    });
}

function isUniqueViolation(err, columnHint) {
    if (!err || typeof err.message !== 'string') return false;
    if (!err.message.includes('UNIQUE constraint failed')) return false;
    return columnHint ? err.message.includes(columnHint) : true;
}

/**
 * Oeffnet die Datenbank und bringt das Schema auf den aktuellen Stand. Die
 * Rueckgabe ist sofort nutzbar: Statements warten hinter der Migration.
 */
function openDatabase(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(null);
    db.ready = db.enqueue(async () => {
        db.conn = await openConnection(file);
        await db.txApi.exec(`
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
        `);
        await migrate(db.txApi);
    });
    return db;
}

module.exports = { openDatabase, isUniqueViolation };
