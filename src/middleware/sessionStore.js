'use strict';

const session = require('express-session');

// Kurz, weil daran auch das Trennen der Sockets abgelaufener Sessions haengt.
const PRUNE_INTERVAL_MS = 60000;

/** express-session-Store auf der Tabelle http_sessions. */
class SqliteSessionStore extends session.Store {
    constructor({ db, defaultMaxAgeMs, logger }) {
        super();
        this.db = db;
        this.defaultMaxAgeMs = defaultMaxAgeMs;
        this.logger = logger;
        this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
        this.pruneTimer.unref();
    }

    expiryOf(sess) {
        const expires = sess && sess.cookie && sess.cookie.expires;
        return expires ? new Date(expires).getTime() : Date.now() + this.defaultMaxAgeMs;
    }

    /** Liest die Session direkt, z. B. fuer die Identitaet eines Sockets. */
    async load(sid) {
        const row = await this.db.get('SELECT sess FROM http_sessions WHERE sid = ? AND expires > ?', [sid, Date.now()]);
        return row ? JSON.parse(row.sess) : null;
    }

    get(sid, callback) {
        this.load(sid).then((sess) => callback(null, sess), callback);
    }

    set(sid, sess, callback = () => {}) {
        this.db.run(
            `INSERT INTO http_sessions (sid, sess, expires) VALUES (?, ?, ?)
             ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
            [sid, JSON.stringify(sess), this.expiryOf(sess)]
        ).then(() => callback(null), callback);
    }

    destroy(sid, callback = () => {}) {
        this.db.run('DELETE FROM http_sessions WHERE sid = ?', [sid]).then(() => callback(null), callback);
    }

    touch(sid, sess, callback = () => {}) {
        this.db.run('UPDATE http_sessions SET expires = ? WHERE sid = ?', [this.expiryOf(sess), sid])
            .then(() => callback(null), callback);
    }

    length(callback) {
        this.db.get('SELECT COUNT(*) AS count FROM http_sessions WHERE expires > ?', [Date.now()])
            .then((row) => callback(null, row.count), callback);
    }

    clear(callback = () => {}) {
        this.db.run('DELETE FROM http_sessions').then(() => callback(null), callback);
    }

    /** Entfernt abgelaufene Sessions und meldet ihre IDs per Ereignis 'expired'. */
    async prune() {
        const now = Date.now();
        try {
            const sids = await this.db.transaction(async (tx) => {
                const rows = await tx.all('SELECT sid FROM http_sessions WHERE expires <= ?', [now]);
                await tx.run('DELETE FROM http_sessions WHERE expires <= ?', [now]);
                return rows.map((row) => row.sid);
            });
            if (sids.length > 0) this.emit('expired', sids);
            return sids;
        } catch (err) {
            this.logger.error('Abgelaufene Sessions konnten nicht entfernt werden', err);
            return [];
        }
    }

    /** Beendet alle anderen Anmeldungen einer Lehrkraft und liefert ihre Session-IDs. */
    async destroyOtherTeacherSessions(teacherId, keepSid) {
        return this.db.transaction(async (tx) => {
            const where = "json_extract(sess, '$.teacherId') = ? AND sid <> ?";
            const rows = await tx.all(`SELECT sid FROM http_sessions WHERE ${where}`, [teacherId, keepSid]);
            await tx.run(`DELETE FROM http_sessions WHERE ${where}`, [teacherId, keepSid]);
            return rows.map((row) => row.sid);
        });
    }

    stop() {
        clearInterval(this.pruneTimer);
    }
}

module.exports = { SqliteSessionStore };
