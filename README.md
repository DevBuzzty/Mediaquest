# Weltenretter-Forschungsteam Begleit-App

Digitale Begleit-App für das hybride Brettspiel **"Weltenretter-Forschungsteam"**. Die Klasse zieht gemeinsam eine Figur über das Hauptbrett und bis zu fünf Welten; in jeder Runde scannt jede Gruppe eine Karte und löst sie, und aus dem Anteil richtiger Gruppen ergeben sich die Schritte. Daneben gibt es die **Einzelne Spielrunde**, in fester Reihenfolge oder an QR-Stationen. Lehrkräfte öffnen dazu eine Session mit einem Session-Code, Schülerteams spielen auf dem Handy, die Lehrkraft verfolgt alles live.

Der genaue Vertrag zwischen Server und Clients (HTTP-Routen, Socket-Ereignisse, Antwortformate) steht in [docs/API.md](docs/API.md).

---

## Voraussetzungen

- **Node.js** 22 oder neuer
- **npm** (kommt mit Node.js)

## Einrichtung

```bash
npm ci
npm start
```

Die App ist dann unter <http://localhost:3000> erreichbar. Einen Build-Schritt braucht sie nicht: `public/css/app.css` und `public/vendor` liegen fertig im Projekt. In der Entwicklung wird beim ersten Start alles Nötige in `data/` angelegt, eine `.env` ist nicht erforderlich.

## npm-Skripte

| Befehl | Zweck |
|---|---|
| `npm start` | Server starten |
| `npm run dev` | Server starten und bei Code-Änderungen neu starten (nodemon) |
| `npm test` | Alle Tests mit `node:test`. Die Tests nutzen zufällige freie Ports und temporäre Datenverzeichnisse |
| `npm run build:css` | `public/css/app.css` mit Tailwind neu bauen. Nötig, sobald in HTML oder JS neue Tailwind-Klassen vorkommen; ein Test prüft, dass die Datei aktuell ist |
| `npm run watch:css` | Wie `build:css`, baut bei jeder Änderung neu |
| `npm run vendor` | `public/vendor` (QR-Bibliotheken) aus den npm-Paketen neu erzeugen |

## Umgebungsvariablen

Vorlage ist `.env.example`; die Werte gehören in eine `.env` im Projektordner, die nicht ins Repository kommt.

| Variable | Bedeutung | Standard |
|---|---|---|
| `NODE_ENV` | `production` schaltet den Betriebsmodus ein | `development` |
| `PORT` | Port des Servers | `3000` |
| `HOST` | Adresse, an die der Server bindet | alle Adressen |
| `DATA_DIR` | Ordner für die SQLite-Datenbank und `uploads/` | `<Projekt>/data` |
| `SESSION_SECRET` | Schlüssel der Anmelde-Sessions, im Betrieb Pflicht (mindestens 32 zufällige Zeichen) | nur außerhalb des Betriebs automatisch |
| `SESSION_MAX_AGE_HOURS` | Gültigkeit einer Anmeldung in Stunden | `12` |
| `TRUST_PROXY` | Anzahl der Reverse-Proxies vor der App | im Betrieb `1`, sonst aus |
| `COOKIE_SECURE` | Cookies nur über HTTPS | im Betrieb an, sonst aus |
| `ALLOW_REGISTRATION` | Selbst-Registrierung per E-Mail | im Betrieb aus, sonst an |
| `SEED_DEMO` | Demo-Konten anlegen | im Betrieb aus, sonst an |
| `SESSION_RETENTION_DAYS` | Abgeschlossene Sessions samt Fotos nach so vielen Tagen löschen, `0` = nie | im Betrieb `90`, sonst `0` |
| `BCRYPT_ROUNDS` | Kostenfaktor für Passwort-Hashes | `12` |
| `LOG_LEVEL` | `silent`, `error`, `warn`, `info` oder `debug` | `info` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | E-Mail-Versand für Login-Codes | keiner |

Ein Secret lässt sich so erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Betrieb (`NODE_ENV=production`)

- Ohne starkes `SESSION_SECRET` startet der Server nicht.
- Es werden keine Demo-Konten angelegt. Das erste Konto entsteht per `scripts/add_teacher.js` (siehe unten). `SEED_DEMO=true` sollte auf einem erreichbaren Server nie gesetzt sein.
- Hinter einem Reverse-Proxy mit HTTPS betreiben und WebSocket-Upgrades für `/socket.io/` durchreichen. Die Kamera für QR-Codes braucht HTTPS. Details stehen am Ende von [docs/API.md](docs/API.md).
- `DATA_DIR` auf einen dauerhaften Ordner außerhalb des Projekts legen und sichern.
- Native Module mit `npm ci` auf dem Zielsystem installieren, `node_modules` nicht von einem anderen Betriebssystem kopieren.
- `GET /healthz` meldet, ob Server und Datenbank antworten.

## Lehrer-Konten

### Konto per Skript anlegen

```bash
node scripts/add_teacher.js meinName
```

Das Passwort (mindestens 8 Zeichen) wird abgefragt und nie als Argument übergeben, damit es nicht in der Shell-Historie landet. Für automatische Abläufe liest das Skript die erste Zeile von stdin:

```bash
printf '%s\n' "$PASSWORT" | node scripts/add_teacher.js meinName
```

Für den Namen gilt dieselbe Regel wie beim Login: Leerzeichen am Anfang und Ende fallen weg, danach sind 1 bis 254 Zeichen erlaubt.

Im Betrieb braucht auch dieses Skript ein gültiges `SESSION_SECRET` in der Umgebung oder der `.env`.

### Selbst-Registrierung per E-Mail

Wenn `ALLOW_REGISTRATION` aktiv ist, zeigt die Login-Seite den Link zur Registrierung (sonst fehlt er, und `/register.html` leitet zum Login um). Dann können sich Lehrkräfte registrieren und bekommen einen Login-Code per E-Mail. Ohne SMTP-Konfiguration erscheint der Code außerhalb des Betriebs in der Server-Konsole; im Betrieb steht er nie im Log. Das Passwort lässt sich danach im Dashboard ändern.

### Demo-Konten (nur Entwicklung)

Außerhalb des Betriebs werden die Konten `admin` und `test` angelegt, Passwort jeweils wie der Name. Im Betrieb gibt es sie nicht, außer jemand setzt ausdrücklich `SEED_DEMO=true`.

Jede neue Lehrkraft bekommt Beispiel-Spielrunden und für jede der 6 Welten ein vollständiges Kartenset (bestehende Konten über Migration 002). Die Monster-Aufgaben darin beginnen mit „[Platzhalter]“ und sind im Editor zu ersetzen.

## Bedienung

### Brettspiel

1. Im Editor (`/blueprints.html`) gibt es unter **Welt-Kartenset** für jede Welt ein Set aus Karten mit Codes und genau 3 Monster-Aufgaben (Felder 8, 16, 24; auf dem Hauptbrett ist die dritte der Endboss).
2. Auf dem Dashboard **Brettspiel** wählen: 1 bis 5 Welten, welche Welt auf welches Portalfeld kommt und welches Kartenset gilt. Die QR-Karten lassen sich als Bogen drucken.
3. **Runde:** Jede Gruppe scannt eine Karte oder gibt ihren Code ein. Haben alle abgegeben, folgt die Auswertung; **Runde jetzt auswerten** beendet die Runde früher. Über 80 % richtige Gruppen sind 4 Schritte, über 60 % sind 2, sonst 1.
4. **Ziehen:** Die Lehrkraft drückt **Figur bewegen**. Die Figur stoppt immer auf Monsterfeldern, die Lehrkraft bestätigt die Aufgabe, danach geht es mit den restlichen Schritten weiter. Auf einem noch nicht gespielten Portal stoppt sie ebenfalls, die restlichen Schritte verfallen (Regel: `PORTAL_ALWAYS_STOPS` in `public/js/shared/game-rules.js`).
5. Feld 25 einer Welt beendet sie und führt zurück auf das Portalfeld, Feld 25 des Hauptbretts ist der Sieg.

Der Spielstand liegt in der Datenbank und übersteht Neuladen, Verbindungsabbruch und Serverneustart. **Spiel unterbrechen** hält ihn an; ein neues Spiel braucht eine neue Session.

### Für Lehrkräfte

1. Auf `/login.html` anmelden. Das Dashboard liegt auf `/teacher.html`.
2. Über **Spielrunden bearbeiten** eigene Spielrunden erstellen (`/blueprints.html`). Der Editor zeigt jede Aufgabe in einer Vorschau, die dieselbe Darstellung wie bei den Teams benutzt. Zu jeder Aufgabe lässt sich Audio für den Knopf **Vorlesen** hochladen (MP3, M4A, OGG, WAV, höchstens 15 MB).
3. Eine Session mit einem Team-Limit öffnen: als Brettspiel oder als Einzelne Spielrunde.
4. Den **Session-Code** der Klasse mitteilen. Bei QR-Spielrunden die Stations-Codes vor dem Start ausdrucken.
5. Das Dashboard zeigt live, welche Teams beitreten, wie weit sie sind und was sie geantwortet haben.
6. Das Spiel starten. Während es läuft, kann zu einer anderen Spielrunde gewechselt werden; alle Teams beginnen sie dann von vorn.
7. Ergebnisse für die Teams freigeben, Sessions schließen, aus dem Verlauf wieder öffnen oder endgültig löschen, inklusive aller Fotos.

### Für Schülerteams

1. `/student.html` öffnen.
2. **Neues Team:** Session-Code eingeben, dann Name, Größe und eine freie Farbe wählen.
3. **Wieder beitreten:** Mit dem **Team-Code**, der im Spiel immer sichtbar ist. Nach einem Neuladen derselben Seite geht es automatisch weiter.
4. In der Lobby warten, bis die Lehrkraft das Spiel startet.

## Projektstruktur

```text
index.js                 Startpunkt: Konfiguration laden, Server starten, sauber beenden
src/
  app.js                 createApp({ config, db }): baut Express, Socket.io und Routen, ohne zu lauschen
  config.js              alle Einstellungen aus der Umgebung, absolute Pfade
  seed.js                Demo-Konten, Beispiel-Spielrunden und Kartensets (seedWorlds.js)
  db/                    SQLite-Zugriff, Transaktionen, nummerierte Migrationen (PRAGMA user_version)
  lib/                   Fachlogik: Sessions, Spielstand, Brettspiel (board.js), zod-Schemas, Codes, Uploads, Wortfilter, Mailer, Logger
  middleware/            Sicherheits-Header, Rate-Limits, Session-Store, Authentifizierung, Fehlerbehandlung
  routes/                HTTP-Routen: auth, blueprints, sessions, teams, uploads, health
  sockets/               Socket.io: Raumverwaltung, Ereignisse von Clients, Notifier für alle Live-Nachrichten
public/
  *.html                 Seiten: Start, Login, Registrierung, Schüler, Dashboard, Editor
  css/app.css            gebautes Tailwind, liegt im Projekt
  vendor/                gepinnte QR-Bibliotheken
  img/                   Bilder
  js/shared/             von allen Seiten genutzt; task-types.js und game-rules.js gelten auch im Server
  js/student/            Schüler-Seite; games/ enthält die Mini-Games, board.js das Spielbrett
  js/teacher/            Dashboard, Login, Registrierung, QR-Druckbogen
  js/editor/             Spielrunden-Editor mit Vorschau
scripts/
  add_teacher.js         Konto anlegen
  vendor.js              public/vendor neu erzeugen
styles/tailwind.css      Eingabe für build:css
docs/API.md              HTTP- und Socket-Vertrag
test/                    node:test mit echtem Server und socket.io-client
data/                    Laufzeitdaten (Datenbank, Fotos), nicht im Repository
```

## Ein neues Mini-Game hinzufügen

1. **Definition:** In `public/js/shared/task-types.js` einen Eintrag in `DEFINITIONS` ergänzen: `type`, `label`, `category`, `icon`, `fields`, `defaults()` und `check(errors, task)`. Diese Datei läuft im Browser und im Server, die Prüfung gilt also an beiden Stellen. Im Editor erscheint ein Typ nur, wenn er in `EDITOR_TYPES` steht; als Karte im Brettspiel braucht er außerdem eine Bewertung in `judge`.
2. **Darstellung:** In `public/js/student/games/` eine Funktion `render<Name>(container, task, ctx)` schreiben. Das Ergebnis meldet sie mit `ctx.complete(answer)`; Timer und Listener laufen über `ctx.setTimeout`, `ctx.setInterval` und `ctx.on`, damit sie mit der Aufgabe enden. Der vollständige `ctx`-Vertrag steht am Anfang von `games/index.js`.
3. **Registrieren:** Die Funktion in `gameRenderers` in `public/js/student/games/index.js` eintragen. Damit funktioniert auch die Vorschau im Editor.
4. **Editor-Formular:** In `public/js/editor/task-forms.js` eine Formular-Funktion schreiben und in `FORMS` eintragen.
5. **Dokumentation:** Das Antwortformat in der Tabelle in `docs/API.md` ergänzen. Enthält die Antwort etwas, das nicht gespeichert werden darf, gehört das in `normalizeAnswer` in `src/sockets/index.js`.
6. **Prüfen:** `npm run build:css` (bei neuen Klassen) und `npm test`.

Alle Texte sind Deutsch. Eingefügt wird nur über den DOM-Helfer `h()` aus `public/js/shared/dom.js`, nie über `innerHTML`, und ohne Inline-Styles oder Inline-Handler: Die Content-Security-Policy blockiert beides.

## Fehlerbehebung

- **Port belegt (`EADDRINUSE`):** Anderes Programm beenden oder `PORT` in der `.env` ändern.
- **Alles zurücksetzen:** Server stoppen und den Inhalt von `DATA_DIR` löschen. Alle Konten, Sessions und Fotos gehen dabei verloren.
- **Teamname abgelehnt:** Er braucht mindestens einen Buchstaben oder eine Ziffer und darf keine Wörter der Sperrliste in `src/lib/filter.js` enthalten.
- **Kamera startet nicht:** Sie braucht HTTPS oder `localhost`. Stations-Codes lassen sich immer auch von Hand eingeben.

### Alte Datenbanken

Die App liest nur `<DATA_DIR>/database.sqlite`. Eine Datei von vor den Migrationen (`PRAGMA user_version` 0, aber mit Tabellen, früher `database.sqlite` im Projektordner) wird nicht aktualisiert: Liegt sie im `DATA_DIR`, bricht der Start mit einer Meldung ab, ihre Daten bleiben unverändert. Es gibt keinen Import. Lege die Datenbank neu an, indem du die Datei aus dem `DATA_DIR` entfernst, und die Konten mit `scripts/add_teacher.js`.

## Technik

- **Backend:** Node.js, Express 4, Socket.io, SQLite
- **Frontend:** HTML, JavaScript-Module ohne Framework, Tailwind CSS 3 (fertig gebaut)
- **Tests:** `node:test`, `socket.io-client`
