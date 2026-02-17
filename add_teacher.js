const db = require('./db');
const bcrypt = require('bcrypt');

async function createTeacher(username, password) {
    if (!username || !password) {
        console.log('Usage: node add_teacher.js <username> <password>');
        process.exit(1);
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO teachers (username, password) VALUES (?, ?)', [username, hashedPassword], (err) => {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    console.error('Fehler: Benutzername existiert bereits.');
                } else {
                    console.error('Fehler beim Erstellen des Lehrers:', err.message);
                }
            } else {
                console.log(`Lehrer ${username} erfolgreich erstellt!`);
            }
            process.exit(0);
        });
    } catch (error) {
        console.error('Fehler:', error);
        process.exit(1);
    }
}

const [,, user, pass] = process.argv;
createTeacher(user, pass);
