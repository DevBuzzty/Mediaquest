const { dbAsync } = require('./db');
const bcrypt = require('bcrypt');

async function createTeacher(username, password) {
    if (!username || !password) {
        console.log('Usage: node add_teacher.js <username> <password>');
        process.exit(1);
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await dbAsync.run('INSERT INTO teachers (username, password) VALUES (?, ?)', [username, hashedPassword]);
        console.log(`Lehrer ${username} erfolgreich erstellt!`);
        process.exit(0);
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            console.error('Fehler: Benutzername existiert bereits.');
        } else {
            console.error('Fehler beim Erstellen des Lehrers:', err.message || err);
        }
        process.exit(1);
    }
}

const [,, user, pass] = process.argv;
createTeacher(user, pass);
