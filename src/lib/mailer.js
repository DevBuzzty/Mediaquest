'use strict';

const nodemailer = require('nodemailer');

/** Versendet Login-Codes. Ohne SMTP_HOST ist enabled false. */
function createMailer(smtp) {
    if (!smtp.host) {
        return {
            enabled: false,
            async sendLoginCode() {
                throw new Error('SMTP ist nicht konfiguriert.');
            }
        };
    }
    const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
    });
    return {
        enabled: true,
        async sendLoginCode(email, code) {
            await transport.sendMail({
                from: `"Weltenretter App" <${smtp.from}>`,
                to: email,
                subject: 'Dein Login-Code für Weltenretter',
                text: `Hallo!\n\nDein Login-Code für die Weltenretter App lautet: ${code}\n\nNutze diesen Code als Passwort zusammen mit deiner E-Mail-Adresse. Du kannst ihn nach der Anmeldung ändern.\n\nViel Spaß!`
            });
        }
    };
}

module.exports = { createMailer };
