# Weltenretter-Forschungsteam Begleit-App (MVP)

Diese App dient als digitale Unterstützung für das hybride Brettspiel "Weltenretter-Forschungsteam".

## Installation

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. `.env` Datei anpassen (optional):
   ```
   SESSION_SECRET=dein-geheimnis
   PORT=3000
   ```

## Lehrer-Accounts verwalten

Neue Lehrer können über das CLI-Skript erstellt werden:
```bash
node add_teacher.js <benutzername> <passwort>
```

## Starten der Anwendung

```bash
npm start
```
Die App ist dann unter `http://localhost:3000` erreichbar.

## Funktionen

- **Lehrer-Dashboard:**
  - Login/Logout.
  - Starten einer neuen Spiel-Session mit Session-Code.
  - **Dynamische Anpassung des Team-Limits** während einer aktiven Session.
  - Echtzeit-Anzeige beigetretener Teams.
  - Einsicht in vergangene Sessions und deren Teams.
- **Schüler-Interface:**
  - Beitritt über Session-Code.
  - Teamerstellung mit Name, Gruppengröße und Farbwahl.
  - Schimpfwort-Filter für Teamnamen.
- **Technik:**
  - Node.js Express Backend (Async/Await mit Promise-basiertem DB-Wrapper).
  - Socket.io für Echtzeit-Synchronisation.
  - SQLite3 für persistente Speicherung (indiziert für hohe Performance).
  - Tailwind CSS für ein modernes Dark-Theme.
  - **Optimierter Schimpfwort-Filter** mit Regex und Leetspeak-Erkennung.
  - **XSS-Schutz** durch konsequente Daten-Sicherheit im Frontend.
