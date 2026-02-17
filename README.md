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
```
- `SESSION_SECRET`: Ein beliebiges Passwort zur Absicherung der Login-Sessions.
- `PORT`: Der Port, auf dem der Server laufen soll (Standard: 3000).

---

## 🔐 Lehrer-Account erstellen

Die App hat keine öffentliche Registrierung für Lehrer. Accounts müssen manuell über ein Skript erstellt werden:

1. Öffne dein Terminal im Projektordner.
2. Führe den folgenden Befehl aus (ersetze `<username>` und `<password>`):
   ```bash
   node add_teacher.js meinName meinPasswort123
   ```
3. Du erhältst eine Bestätigung: `Lehrer meinName erfolgreich erstellt!`.

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
3. Klicke auf **"Neue Session starten"**.
4. Teile den **Session-Code** (z.B. `AB12CD`) deiner Klasse mit.
5. Im Dashboard siehst du live, welche Teams beitreten. Du kannst das Team-Limit jederzeit anpassen.
6. Klicke auf **"Spiel jetzt starten!"**, um alle angemeldeten Teams in den Spielmodus zu versetzen.
7. Am Ende des Spiels kannst du über **"Spiel beenden"** alle Schüler zurückwerfen.

### Für Schüler
1. Gehe auf die Startseite oder direkt auf [http://localhost:3000/student.html](http://localhost:3000/student.html).
2. Gib den Session-Code der Lehrkraft ein.
3. Wähle einen **Teamnamen**, die **Gruppengröße** und eine **Farbe**.
4. Nach der Registrierung wartest du in der Lobby, bis die Lehrkraft das Spiel startet.
5. Sobald das Spiel läuft, erscheint ein entsprechender Status-Bildschirm.

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
