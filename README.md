# Weltenretter-Forschungsteam Begleit-App (MVP)

Diese Anwendung ist die digitale Begleit-App für das hybride Brettspiel **"Weltenretter-Forschungsteam"**. Sie ermöglicht Lehrkräften das Management von Spiel-Sessions und Schülern die Registrierung ihrer Forschungsteams in Echtzeit.

---

## 📋 Voraussetzungen

Bevor du startest, stelle sicher, dass folgende Software auf deinem Computer installiert ist:
- **Node.js** (Version 16.x oder höher empfohlen)
- **npm** (wird normalerweise zusammen mit Node.js installiert)

Du kannst dies prüfen, indem du folgende Befehle im Terminal (Eingabeaufforderung) ausführst:
```bash
node -v
npm -v
```

---

## 🚀 Installation & Setup

Folge diesen Schritten, um die App lokal einzurichten:

### 1. Projekt-Ordner vorbereiten
Stelle sicher, dass du dich im Hauptverzeichnis des Projekts befindest.

### 2. Abhängigkeiten installieren
Installiere alle benötigten Bibliotheken (Express, Socket.io, SQLite3, etc.):
```bash
npm install
```

### 3. Konfiguration (.env)
Erstelle im Hauptverzeichnis eine Datei namens `.env` (falls nicht vorhanden) und füge folgenden Inhalt hinzu:
```env
SESSION_SECRET=weltenretter-secret-2024
PORT=3000

# E-Mail Versand (optional für Registrierung)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=deine.email@gmail.com
SMTP_PASS=dein-app-passwort
```

### 📧 Gmail SMTP Einrichtung
Wenn du Gmail für den E-Mail-Versand nutzen möchtest, folge diesen Schritten:
1. **2-Faktor-Authentifizierung (2FA)** in deinem Google-Konto aktivieren.
2. Suche nach **"App-Passwörter"** in den Google-Konto-Einstellungen.
3. Erstelle ein neues App-Passwort (Wähle "Andere" und nenne es "Weltenretter").
4. Kopiere das 16-stellige Passwort und füge es bei `SMTP_PASS` in die `.env` ein.
5. Setze `SMTP_USER` auf deine Gmail-Adresse.
- `SESSION_SECRET`: Ein beliebiges Passwort zur Absicherung der Login-Sessions.
- `PORT`: Der Port, auf dem der Server laufen soll (Standard: 3000).

---

## 🔐 Lehrer-Account & Registrierung

### Test-Account
Zum schnellen Testen ist bereits ein Account hinterlegt:
- **Benutzer:** `test`
- **Passwort:** `test`

### Selbst-Registrierung (E-Mail)
Lehrkräfte können sich über die Login-Seite selbst registrieren.
1. Klicke auf "Registrieren".
2. Gib deine E-Mail-Adresse ein.
3. Du erhältst einen 6-stelligen Code per E-Mail, der als Passwort dient.
*Hinweis: Ohne SMTP-Konfiguration in der `.env` wird keine echte Mail versandt. Der Code erscheint dann in der Server-Konsole.*

### Manueller Account (CLI)
Accounts können weiterhin manuell über ein Skript erstellt werden:
1. Öffne dein Terminal im Projektordner.
2. Führe den folgenden Befehl aus:
   ```bash
   node add_teacher.js meinName meinPasswort123
   ```

---

## 💻 Den Server starten

Du hast zwei Möglichkeiten, den Server zu starten:

### A) Normaler Modus (Produktion)
```bash
npm start
```
Der Server läuft stabil und zeigt nur wichtige Logs.

### B) Entwicklungs-Modus (Auto-Restart)
Falls du Änderungen am Code vornimmst und der Server automatisch neu starten soll:
```bash
npm run dev
```

**Sobald der Server läuft, ist die App unter folgender Adresse erreichbar:**
👉 [http://localhost:3000](http://localhost:3000)

---

## 📖 Bedienungsanleitung

### Für Lehrkräfte
1. Gehe auf [http://localhost:3000/login.html](http://localhost:3000/login.html).
2. Logge dich mit deinem erstellten Account ein.
3. **Blueprint Creator (Optional):** Erstelle in diesem Bereich eigene Inhalte (Fragen, Swipe-Karten). Diese können beim Session-Start ausgewählt oder live ins Spiel gepusht werden.
4. Klicke auf **"Neue Session starten"**. Wähle dabei den Spielmodus und optional einen Blueprint aus.
5. Teile den **Session-Code** (z.B. `AB12CD`) deiner Klasse mit.
5. Im Dashboard siehst du live, welche Teams beitreten. Du kannst das Team-Limit anpassen oder Teams löschen.
6. Jedes Team hat einen eigenen **Team-Code**. Sollte ein Schüler die App schließen, kann er über diesen Code wieder seinem Team beitreten.
7. Klicke auf **"Spiel jetzt starten!"**, um alle angemeldeten Teams in den Spielmodus zu versetzen.
8. **Live-Steuerung:** Während das Spiel läuft, kannst du über den "Dev-Modus" im Dashboard jederzeit neue Blueprints an alle Teams senden oder den Modus wechseln.
9. Sessions können über **"Session beenden"** archiviert und später über die Historie mit **"Fortsetzen"** wieder reaktiviert werden.

### Integrierte Mini-Games
- **Binary Swipe:** Karten nach links (Nein/Fake) oder rechts (Ja/Echt) wischen. Ideal für Fakten-Checks.
- **Multiple Choice:** Eine richtige Antwort aus mehreren Möglichkeiten wählen.
- **Multiple Select:** Mehrere zutreffende Antworten markieren.

### Für Schüler
1. Gehe auf [http://localhost:3000/student.html](http://localhost:3000/student.html).
2. **Neues Team:** Gib den Session-Code ein, wähle Name, Größe und eine freie Farbe.
3. **Wieder beitreten:** Klicke auf "Bestehendem Team wieder beitreten" und gib deinen Team-Code ein.
4. Warte in der Lobby, bis die Lehrkraft das Spiel startet.

---

## 🛠 Fehlerbehebung

- **Port bereits belegt:** Falls eine Fehlermeldung wie `EADDRINUSE` erscheint, beende andere Programme, die Port 3000 nutzen, oder ändere den Port in der `.env`.
- **Datenbank-Fehler:** Die Daten werden in der Datei `database.sqlite` gespeichert. Solltest du alles zurücksetzen wollen, kannst du diese Datei einfach löschen (Vorsicht: Alle Accounts und Historien gehen verloren!).
- **Schimpfwort-Filter:** Wenn ein Teamname abgelehnt wird, enthält er Wörter, die auf der Sperrliste in `filter.js` stehen.

---

## 🛠 Technische Details
- **Backend:** Node.js / Express
- **Echtzeit:** Socket.io
- **Datenbank:** SQLite3 (Dateibasiert)
- **Frontend:** HTML5, JavaScript (Vanilla), Tailwind CSS
