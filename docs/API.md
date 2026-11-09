# Weltenretter-Forschungsteam: API-Vertrag

Verbindlicher Vertrag zwischen Server und Clients (Schüler-Seite, Lehrkraft-Dashboard, Editor).
Vokabular: "Spielrunde" = Blueprint, "Aufgabe" = Task, "Station" = Aufgabe im QR-Modus.

## Grundregeln

- JSON mit `Content-Type: application/json`. Formular-Bodies werden nicht geparst.
- Identität steckt ausschließlich im HttpOnly-Cookie `wr.sid` (SameSite=Lax). Clients senden nie Team- oder Lehrkraft-IDs als Identität. `fetch` auf derselben Origin schickt das Cookie von selbst.
- Fehlerantwort immer: `{ "error": "<deutscher Text>", "code"?: "<MASCHINENCODE>", "details"?: [...] }`. Kein Stacktrace. `error` ist immer deutsch und darf dem Nutzer angezeigt werden.
- Übliche Status: `400` ungültige Eingabe, `401` nicht angemeldet, `403` nicht erlaubt, `404` nicht gefunden, `409` Konflikt, `413` zu groß, `429` Rate-Limit, `500` Serverfehler.
- Alle Zeitstempel sind ISO-8601-Texte.
- Reihenfolge von `submissions`: immer älteste zuerst. Wer neueste oben zeigen will, fügt jede Karte vorne ein, wie bei Live-Ereignissen.
- Inhalte aus Spielrunden oder von Teams sind Daten: immer über Textknoten einsetzen, nie als HTML.
- Bedeutung der Rollen in den Tabellen:
  - **Lehrkraft**: Cookie nach `/api/login`.
  - **Beigetreten**: Cookie nach `/api/join` (Session-Code bekannt, noch kein Team).
  - **Team**: Cookie nach `POST /api/teams` oder `/api/rejoin`.
  - Ein Browser kann gleichzeitig Lehrkraft und Team sein (Testen in zwei Tabs).

### Datenformate

**Spielrunde (`Blueprint`)**, wie vom Editor gesendet und gespeichert:
```json
{ "id": 1, "title": "Runde", "game_type": "template", "created_at": "...", "updated_at": null,
  "content": { "templateType": "normal", "tasks": [ { "type": "choice", "question": "?", "description": "", "options": ["A", "B"] } ] } }
```
`templateType` ist `normal`, `qr` oder `world` (Kartenset fürs Brettspiel, siehe unten; dann zusätzlich `world`). Die Felder jeder Aufgabe stehen in `public/js/shared/task-types.js`. Jede Aufgabe kann `audio` tragen: eine URL aus `POST /api/upload/audio`. Ist es gesetzt, zeigt die Team-Ansicht (bei `monster` das Tablet) einen Knopf „Vorlesen“; ohne `audio` fehlt der Knopf. Die Wiedergabe stoppt beim Aufgabenwechsel.

**Snapshot (`SessionBlueprint`)**, wie eine Session ihn liefert. Eine Session spielt immer ihren eigenen Snapshot, Änderungen oder das Löschen der Vorlage wirken nicht auf sie.
```json
{ "id": 1, "title": "Runde", "templateType": "normal",
  "tasks": [ { "key": "1-0", "type": "choice", "question": "?", "options": ["A", "B"] } ] }
```
- `key` identifiziert die Aufgabe im aktuellen Durchlauf (`<Revision>-<Index>`). Jeder Spielstart und jeder Spielrunden-Wechsel erzeugt neue Keys. Keys immer aus dem aktuellen `blueprint` nehmen, nie selbst bauen.
- `id` ist `null`, wenn die Vorlage gelöscht wurde.
- `code` (Stations-Code) ist **nur** in der Lehrkraft-Sicht enthalten. Teams bekommen keine Codes und öffnen Stationen über `openStation`.

**Fortschritt (`Progress`)**
```json
{ "total": 3, "completed": 1, "skipped": 0, "currentIndex": 1, "currentTaskKey": "1-1",
  "finished": false, "finishedAt": null,
  "tasks": [ { "key": "1-0", "index": 0, "type": "choice", "title": "Frage", "status": "completed", "completedAt": "..." } ] }
```
- `status` je Aufgabe: `pending`, `started`, `completed`, `skipped`.
- `currentIndex`/`currentTaskKey`: erste offene Aufgabe im Normalmodus, sonst `null` (QR-Modus oder alles erledigt).
- `finished`: Normalmodus, wenn jede Aufgabe `completed` oder `skipped` ist; QR-Modus, wenn alle Stationen `completed` sind oder das Team `finishStations` gesendet hat. Danach nimmt der Server für den laufenden Durchlauf nichts mehr an (`ALREADY_FINISHED`), erst ein neuer Spielstart oder Spielrunden-Wechsel beginnt von vorn.

**Ergebnis (`Result`)**: `{ task_key, task_index, task_type, task_title, status, answer, started_at, completed_at }`. `answer` ist das, was das Team geantwortet hat, ungeprüft und ohne Bewertung.

**Team-Stand (`TeamState`)**, identisch aus `/api/teams`, `/api/rejoin`, `/api/team/me`, `joinSessionRoom`:
```json
{ "sessionId": 1, "sessionCode": "ABC234", "maxTeams": 5, "teamId": 7, "teamCode": "XYZ987",
  "name": "Team", "color": "#3b82f6", "groupSize": 3,
  "gameStatus": "running", "phase": "running", "resultsEnabled": false,
  "blueprint": { "...": "SessionBlueprint ohne code, null solange nicht running" },
  "progress": { "...": "Progress, null solange nicht running" },
  "gameMode": "classic", "board": null, "card": null }
```
`phase`: `lobby` (Spiel läuft nicht), `running`, `finished` (Team ist fertig, das Spiel läuft noch).

**Team für Lehrkräfte (`TeacherTeam`)**: `{ id, name, color, group_size, team_code, created_at, finished_at, progress: Progress, results: Result[] }`. `results` enthält den aktuellen Durchlauf.

**Einsendung (`Submission`)**: `{ id, session_id, team_id, team_name, team_color, team_code, task_key, task_title, type, content, created_at }`. `type` ist `photo` (dann `content` = `/uploads/...`) oder `statement`. Je Team und Aufgabe gibt es höchstens eine Einsendung; eine erneute Einsendung behält die `id` und ersetzt den Inhalt, Clients ersetzen also die Karte mit gleicher `id`. Diese Form bekommen nur Lehrkräfte.

**Einsendung für Teams (`PublicSubmission`)**: `{ team_name, team_color, task_title, type, content, created_at }`. Enthält bewusst keinen `team_code` und keine IDs: Mit einem fremden Team-Code ließe sich das andere Team per `/api/rejoin` übernehmen.

**Lehrkraft-Stand (`TeacherState`)**, identisch aus `GET /api/sessions/active` und `joinSessionRoom`:
```json
{ "active": true,
  "board": null,
  "session": { "id": 1, "code": "ABC234", "status": "active", "game_status": "waiting", "game_mode": "classic", "max_teams": 5,
               "blueprint_id": 1, "results_enabled": false, "created_at": "...", "closed_at": null,
               "blueprint": { "...": "SessionBlueprint inklusive code, auch vor dem Spielstart (zum Drucken der QR-Codes)" } },
  "teams": [ "TeacherTeam" ], "submissions": [ "Submission" ] }
```

### Antworten je Aufgaben-Typ (`answer` in `reportTaskResult`)

Alle Felder sind Empfehlungen für eine einheitliche Anzeige; der Server speichert JSON bis 16 KB und höchstens 32 Ebenen Verschachtelung unverändert, außer bei `password`.

| Typ | `answer` |
|---|---|
| binary | `{ choice: "left" \| "right" }` |
| choice | `{ index, label }` |
| select | `{ indices: [..], labels: [..] }` |
| chat | `{ path: [{ node, choice }] }` |
| scroller | `{ marked: [Postindex, ...] }` |
| detector | `null` |
| hotspot | `{ found: [Zonenindex, ...] }` |
| password | `{ length, rulesMet: [bool, ...] }`. Der Server verwirft alles andere, das eingegebene Passwort wird nie gespeichert |
| monster | keine: `reportTaskResult` ist gesperrt, die Lehrkraft bestätigt |
| photo | `{ url }` (Einsendung zusätzlich per `studentSubmission`) |
| statement | `{ text }` (Einsendung zusätzlich per `studentSubmission`) |
| profile | `{ fields: { Feldname: Wert } }` |
| mood | `{ value }` (1 bis 100) |
| bucket | `{ placements: [{ item, bucket }] }` |
| ranking | `{ order: [Text, ...] }` |
| pairs | Einzelne Spielrunde: `{ matched: Anzahl }`. Brettspiel: `{ assignments: [{ left, right }, ...] }` |
| cloze | `{ gaps: [Wort, ...] }` |
| countdown | `{ expired: true \| false }` |

## HTTP-Routen

### Betrieb

| Route | Rolle | Antwort |
|---|---|---|
| `GET /healthz` | keine | `200 { status: "ok" }`, bei DB-Fehler `503 { status: "error" }` |
| `GET /socket.io/socket.io.js` | keine | Socket.io-Client vom Server |

### Anmeldung

| Route | Rolle | Request | Antwort |
|---|---|---|---|
| `GET /api/config` | keine | | `200 { allowRegistration }`. Die Login-Seite zeigt den Link zur Registrierung nur, wenn er `true` ist. Ist die Registrierung aus, leitet `/register.html` auf `/login.html` um |
| `POST /api/register` | keine | `{ email }` | `200 { success: true, message }`, identisch für neue und vorhandene Adressen. Ein vorhandenes Konto bleibt unverändert. `403`, wenn `ALLOW_REGISTRATION` aus ist |
| `POST /api/login` | keine | `{ username, password }` | `200 { success: true, username }`, `401` bei falschen Daten. Vergibt eine neue Session-ID und trennt die Sockets der alten |
| `POST /api/logout` | beliebig | | `200 { success: true }`. Trennt die Sockets dieses Browsers |
| `GET /api/me` | beliebig | | `{ loggedIn: true, username }` oder `{ loggedIn: false }` |
| `POST /api/change-password` | Lehrkraft | `{ currentPassword, newPassword }` (8 Zeichen bis 72 Bytes) | `200 { success: true }`, `403` mit `code: "WRONG_PASSWORD"`. Andere Anmeldungen dieser Lehrkraft enden |

### Spielrunden (Lehrkraft, nur eigene; fremde IDs liefern `404`)

| Route | Request | Antwort |
|---|---|---|
| `GET /api/blueprints` | | `{ blueprints: Blueprint[] }`, neueste zuerst |
| `POST /api/blueprints` | `{ title, content }` | `201 { success: true, blueprint }` |
| `PATCH /api/blueprints/:id` | `{ title, content }` (vollständiger Ersatz) | `200 { success: true, blueprint }` |
| `DELETE /api/blueprints/:id` | | `200 { success: true }`, laufende Sessions spielen ihren Snapshot weiter |

`content` darf höchstens 32 Ebenen tief verschachtelt sein (sonst `400`, `code: "INVALID_INPUT"`) und wird mit `TaskTypes.validateContent` geprüft. Fehler: `400 { error, code: "INVALID_BLUEPRINT", details: [{ taskIndex, message }] }`, `taskIndex` ist `null` für Fehler der ganzen Spielrunde. Fremdfelder eines Typs entfernt der Server. Bei `templateType: "qr"` erzeugt er fehlende Stations-Codes, doppelte werden abgelehnt. Abgelehnt werden auch Chat-Knoten namens `__proto__`, `constructor` oder `prototype` sowie Passwort-Regeln, die sich widersprechen.

Bilder in Aufgaben müssen `/uploads/...` oder `/img/...` sein. Externe URLs und `data:` werden abgelehnt.

### Sessions (Lehrkraft)

| Route | Request | Antwort und Live-Ereignisse |
|---|---|---|
| `POST /api/sessions` | `{ blueprintId, maxTeams? }` (1 bis 10, Standard 5) | `201 { success: true, code, sessionId }`. `sessionOpened`; eine aktive Session wird geschlossen: `sessionClosed` |
| `GET /api/sessions/active` | | `TeacherState` oder `{ active: false }` |
| `POST /api/sessions/close` | | `200 { success: true }`. `sessionClosed` |
| `GET /api/sessions/history` | | `{ sessions: [...] }`, geschlossene Sessions, Felder wie `TeacherState.session` |
| `PATCH /api/sessions/active/limit` | `{ maxTeams }` | `200 { success: true, maxTeams }`, `400` wenn kleiner als die Teamanzahl. `teamLimitUpdated` |
| `POST /api/sessions/active/start` | | `200 { success: true, alreadyRunning, blueprint }`. `gameStarted`, außer wenn es schon lief |
| `PATCH /api/sessions/active/mode` | `{ blueprintId }` | `200 { success: true, blueprint }`. Neuer Snapshot, neue Keys, alle Teams beginnen von vorn. `gameModeUpdated` |
| `POST /api/sessions/active/end` | | `200 { success: true }`. `gameEnded`; Teams bleiben erhalten und warten auf einen neuen Start |
| `POST /api/sessions/:id/reopen` | | `200 { success: true, sessionId, code }`, `404` wenn nicht die eigene (nichts wird geschlossen). Spielstatus danach `waiting`. `sessionOpened`; andere aktive Session: `sessionClosed` |
| `GET /api/sessions/:id/teams` | | `{ teams: TeacherTeam[] }`, `403` wenn nicht die eigene |
| `GET /api/sessions/:id/submissions` | | `{ submissions: Submission[] }`, `403` wenn nicht die eigene |
| `GET /api/sessions/:id/board-history` | | Verlauf einer Brett-Session, auch nach dem Schließen: `{ board: BoardState, rounds: [{ round, world, worldName, kartenset, cards: [{ teamId, teamName, teamColor, code, type, title, status, correct, answer, task }] }] }`. `status`: `working` (nicht abgegeben, `correct` ist `null`), `finished` oder `skipped`. `task` ist die Karte aus dem Snapshot, mit Lösung. Enthält nur Gruppen, die noch existieren. `403` wenn nicht die eigene, `409 NOT_BOARD` bei einer Einzelnen Spielrunde |
| `DELETE /api/sessions/:id` | | `200 { success: true }`. Löscht eine **geschlossene** Session mit allen Daten und Fotos; `409` bei aktiver, `404` wenn nicht die eigene |

| Route | Rolle | Antwort |
|---|---|---|
| `GET /api/sessions/:id/results` | Lehrkraft der Session | `{ submissions, results: [{ team_id, ...Result }] }`, alle Durchläufe |
| | Team der Session, nachdem die Lehrkraft `showResults` ausgelöst hat | `{ submissions: PublicSubmission[] }` |
| | sonst | `403` |

### Teams

| Route | Rolle | Request | Antwort und Live-Ereignisse |
|---|---|---|---|
| `POST /api/join` | keine | `{ code }` (Session-Code) | `200 { success, sessionId, maxTeams, gameStatus, takenColors, colors, team }`, `404` sonst. `team` ist `TeamState`, falls dieses Gerät schon zu einem Team der Session gehört, sonst `null`. Enthält keine Aufgaben |
| `POST /api/teams` | Beigetreten | `{ name, color, groupSize? }` | `201 { success: true, ...TeamState }`. `400` ungültig oder Name unangemessen, `403` ohne Join, `409` mit `code`: `TEAM_LIMIT`, `COLOR_TAKEN`, `ALREADY_IN_TEAM`. `teamCreated`, `colorPicked` |
| `POST /api/rejoin` | keine | `{ teamCode }` | `200 { success: true, ...TeamState }`, `404` sonst. Gehörte der Browser zu einem anderen Team, verlassen seine Sockets dessen Räume; Clients verbinden danach neu und betreten den neuen Raum |
| `GET /api/team/me` | beliebig | | `{ role: "team", ...TeamState }` oder `{ role: "joined", sessionId, maxTeams, gameStatus, takenColors, colors }` oder `{ role: "none" }`. Für die Wiederherstellung beim Seitenaufruf |
| `DELETE /api/teams/:id` | Lehrkraft der Session | | `200 { success: true }`, `404` sonst. Entfernt Ergebnisse, Einsendungen und Dateien. `teamDeleted`, `colorFreed` |

`color` muss eine der zehn Farben aus `colors` sein, `groupSize` ganze Zahl 1 bis 10. `name`: 1 bis 30 Zeichen mit mindestens einem Buchstaben oder einer Ziffer; unsichtbare Zeichen (z. B. U+200B) entfernt der Server vor der Prüfung, die Antwort enthält den bereinigten Namen.

### Bilder

| Route | Rolle | Request | Antwort |
|---|---|---|---|
| `POST /api/upload[?purpose=blueprint\|submission]` | Lehrkraft oder Team | `multipart/form-data`, Feld `image` | `201 { success: true, url: "/uploads/<name>" }` |
| `POST /api/upload/audio` | Lehrkraft | `multipart/form-data`, Feld `audio` | `201 { success: true, url: "/uploads/<name>" }` |
| `GET /uploads/:name` | siehe unten | | die Bilddatei, `403` nicht erlaubt, `404` unbekannt |

- JPEG, PNG oder WebP, erkannt an den Bytes, höchstens 5 MB (`413`), sonst `400` mit `code: "INVALID_IMAGE"`. Ein kaputtes oder abgebrochenes Formular ergibt `400` mit `code: "INVALID_UPLOAD"`. `409` mit `code: "UPLOAD_LIMIT"` ab 50 Bildern je Team oder 300 Spielrunden-Bildern je Lehrkraft.
- Audio: MP3, M4A, OGG oder WAV, erkannt an den Bytes, höchstens 15 MB (`413`), sonst `400` mit `code: "INVALID_AUDIO"`. Nur Lehrkräfte laden hoch (`401` sonst). Gespeichert und ausgeliefert wie Spielrunden-Bilder, zählt zum selben Limit und unterliegt derselben Bereinigung. Die CSP erlaubt Medien nur von der eigenen Origin (`media-src 'self'`).
- Spielrunden-Bilder, die 24 Stunden nach dem Hochladen weder eine Spielrunde noch ein Session-Snapshot nutzt, löscht der Server automatisch.
- `purpose`: ohne Angabe `blueprint` für Lehrkräfte, sonst `submission`. Die Schüler-Seite sendet immer `purpose=submission`, damit ein Test in einem angemeldeten Browser als Team zählt.
- `blueprint`-Bilder sehen angemeldete Lehrkräfte und jedes Team. `submission`-Bilder sehen die Lehrkraft der Session und Teams dieser Session.

### Rate-Limits je IP

| Route | Limit |
|---|---|
| Login, Passwort ändern (nur fehlgeschlagene zählen) | 30 je 15 Minuten |
| Registrierung | 10 je Stunde |
| Join | 300 je 15 Minuten |
| Rejoin, Team anlegen | je 100 je 15 Minuten |
| Upload | 300 je 15 Minuten |

## Socket.io

### Verbindung

- Der Server liest die Identität beim Verbindungsaufbau aus dem Cookie und pro Ereignis neu aus der Session. Endet die HTTP-Session (Abmeldung, neue Anmeldung im selben Browser, Passwortwechsel, Ablauf nach spätestens einer Minute), trennt der Server ihre Sockets ohne automatischen Reconnect. **Ein Socket, der vor dem Cookie verbunden wurde, bleibt anonym.** Nach `/api/login` und nach dem ersten `/api/join` oder `/api/rejoin` daher `socket.disconnect().connect()` aufrufen (oder den Socket erst dann öffnen). Ein Wechsel von Beigetreten zu Team (`POST /api/teams`) braucht keine neue Verbindung, weil die Session-ID gleich bleibt.
- Bei **jedem** `connect` (auch nach Reconnect) den Raum neu betreten (`joinLobby` oder `joinSessionRoom`) und den Stand aus dem Ack übernehmen. Der Ack entspricht dem Stand nach einem Reload.
- Client-Nachrichten dürfen höchstens 64 KB groß sein, sonst trennt der Server die Verbindung.
- Alle Client-Ereignisse akzeptieren eine Ack-Funktion: `{ ok: true, ... }` oder `{ ok: false, error, code }`. Ohne Ack wird still verworfen.

Gemeinsame Fehlercodes: `INVALID_INPUT`, `RATE_LIMITED`, `SERVER_ERROR`, `TEAM_GONE`, `SESSION_CLOSED`, `NOT_RUNNING`, `UNKNOWN_TASK`, `ALREADY_FINISHED`, `STATION_NOT_OPEN`.

### Client an Server

| Ereignis | Identität | Payload | Ack bei Erfolg |
|---|---|---|---|
| `joinLobby` | Beigetreten | keine | `{ ok, state: { sessionId, maxTeams, gameStatus, takenColors } }` |
| `joinSessionRoom` | Lehrkraft der Session oder Team der Session | `{ sessionId, as?: "teacher" \| "team" }` | `{ ok, role: "teacher", state: TeacherState }` oder `{ ok, role: "team", state: TeamState }` |
| `reportTaskStart` | Team, Spiel läuft, nicht fertig; QR: Station geöffnet | `{ taskKey }` | `{ ok, progress }`. Ein `completed`- oder `skipped`-Eintrag bleibt unverändert |
| `reportTaskResult` | Team, Spiel läuft, nicht fertig; QR: Station geöffnet | `{ taskKey, status: "completed" \| "skipped", answer? }` | `{ ok, progress, alreadyCompleted }` |
| `openStation` | Team, Spiel läuft, QR-Modus, nicht fertig | `{ code }` | `{ ok, taskKey, task, progress }`. Fehlercodes: `UNKNOWN_CODE`, `ALREADY_COMPLETED`, `ALREADY_FINISHED`, `NOT_QR` |
| `finishStations` | Team, QR-Modus | keine | `{ ok, progress }`. Beendet das Spiel für dieses Team endgültig; `NOT_QR` sonst |
| `studentSubmission` | Team, Spiel läuft, nicht fertig; QR: Station geöffnet | `{ taskKey, type: "photo" \| "statement", content }` | `{ ok, submission }`. `content`: Text bis 2000 Zeichen oder die `url` aus dem eigenen Upload. Fehlercodes: `BAD_WORDS`, `WRONG_TYPE`, `INVALID_PHOTO` |
| `showResults` | Lehrkraft der Session | `{ sessionId }` | `{ ok }` |

Hinweise:

- `as: "team"` wählt die Team-Rolle, wenn derselbe Browser auch Lehrkraft ist. Die Schüler-Seite sendet es immer.
- `reportTaskResult` ist idempotent, solange das Team nicht fertig ist: Ein `completed`-Eintrag wird nie überschrieben (`alreadyCompleted: true`, keine Live-Meldung). Das sichert Doppel-Taps ab. Nach dem Ende des Teams antwortet der Server mit `ALREADY_FINISHED`; Clients laden dann den Stand neu.
- QR-Modus: Start, Ergebnis und Einsendung für eine Station brauchen ein vorheriges `openStation` mit ihrem Code, sonst `STATION_NOT_OPEN`.
- Abbrechen einer Station: `reportTaskResult` mit `status: "skipped"`. Die Station gilt als nicht abgeschlossen und muss per `openStation` erneut geöffnet werden, bevor sie wieder gemeldet werden kann.
- Reihenfolge bei Foto und Statement: erst `studentSubmission` senden, nach `ok: true` dann `reportTaskResult`.

### Server an Client

| Ereignis | Empfänger | Payload |
|---|---|---|
| `gameStarted` | Lehrkraft, Teams, Lobby | `{ sessionId, gameStatus, blueprint }`. Lobby ohne `blueprint`; Teams ohne `code`. Fortschritt beginnt neu |
| `gameModeUpdated` | Lehrkraft, Teams, Lobby | wie `gameStarted`; Teams beginnen die neue Spielrunde von vorn |
| `gameEnded` | Lehrkraft, Teams, Lobby | `{ sessionId }` |
| `sessionClosed` | Lehrkraft, Teams, Lobby | `{ sessionId }`, danach verlässt der Server alle Sockets aus den Räumen. Das Dashboard vergleicht `sessionId` mit der angezeigten Session, weil beim Anlegen einer neuen Session die alte geschlossen wird |
| `sessionOpened` | alle Sockets der angemeldeten Lehrkraft, ohne Raumbeitritt | `{ sessionId }`, nach `POST /api/sessions` und `/reopen`. Damit erfahren auch Dashboards ohne aktive Session davon; sie gleichen dann mit dem Server ab und betreten den Raum |
| `displayResults` | Lehrkraft, Teams | `{ sessionId }`, Teams laden dann `GET /api/sessions/:id/results` (`PublicSubmission[]`) |
| `teamLimitUpdated` | Lehrkraft, Lobby | `{ sessionId, maxTeams }` |
| `colorPicked` | Lehrkraft, Teams, Lobby | `{ sessionId, color }` |
| `colorFreed` | Lehrkraft, Teams, Lobby | `{ sessionId, color }` |
| `teamCreated` | nur Lehrkraft | `{ sessionId, gameStatus, team: TeacherTeam }` |
| `teamDeleted` | Lehrkraft und betroffenes Team | `{ sessionId, teamId }`. Das Team ist danach aus den Räumen entfernt |
| `teamTaskUpdate` | nur Lehrkraft | `{ sessionId, teamId, team: { id, name, color, team_code }, taskKey, taskIndex, taskType, taskTitle, status: "started", progress }` |
| `teamTaskResult` | nur Lehrkraft | `{ sessionId, teamId, team, result: Result, progress }` |
| `teamFinished` | nur Lehrkraft | `{ sessionId, teamId, team, finishedAt, explicit, progress }`. `explicit` ist `true` nach `finishStations` |
| `newSubmission` | nur Lehrkraft | `Submission` |

## Brettspiel

Das Brettspiel ist eine eigene Session-Art (`game_mode: "board"`). Die bisherigen Abläufe (feste Reihenfolge, QR-Stationen) heißen „Einzelne Spielrunde“ und bleiben `game_mode: "classic"`.

Regeln und Stammdaten stehen in `public/js/shared/game-rules.js` (`window.GameRules` und Node-Modul, siehe unten). Clients laden das Skript wie `task-types.js`. **Der Server entscheidet**; Clients benutzen `GameRules` nur für Anzeige, Farben und Texte.

### Kartensets (`templateType: "world"`)

Eine Spielrunde mit `content: { templateType: "world", world: "<Weltenschlüssel>", tasks: [...] }`. Weltenschlüssel: `haupt`, `news`, `dschungel`, `daten`, `ki`, `strand`.

- Aufgaben außer `monster` sind **Karten**: Sie brauchen einen Code wie Stationen (`A-Z a-z 0-9 _ -`, 3 bis 32 Zeichen), eindeutig im Set ohne Beachtung von Groß/Klein. Fehlende Codes erzeugt der Server beim Speichern.
- Genau **3** Aufgaben vom Typ `monster`. Ihre Reihenfolge in `tasks` entspricht den Feldern 8, 16, 24. Der Server entfernt ein `code` von Monster-Aufgaben; sie lassen sich nicht scannen.
- Mindestens eine Karte.
- Jede Karte muss bewertbar sein. Fehlt die Lösung, antwortet der Server `400`, `code: "INVALID_BLUEPRINT"`, mit `details: [{ taskIndex, message }]` je Aufgabe. Erlaubte Karten-Typen sind die aus `TaskTypes.EDITOR_TYPES` außer `monster`; andere Typen werden im Kartenset abgelehnt.

| Typ | Lösungsfeld (zusätzlich zur Aufgabe) | Bedeutung |
|---|---|---|
| binary | `correct: "left" \| "right"` | richtige Seite |
| choice | `correct: Index` | richtige Antwort, Index in `options` |
| select | `correct: [Index, ...]` | alle richtigen Antworten, mindestens eine |
| chat | `success: true` an einem Knoten ohne Antworten | mindestens ein Erfolgs-Ende, das über eine Antwort erreichbar ist; `start` selbst zählt nicht |
| scroller | `isBad: true` an Posts | mindestens einer markiert |
| bucket | `target` an Begriffen | wie bisher |
| ranking | Reihenfolge von `items` | wie bisher: gespeicherte Reihenfolge ist die richtige |
| pairs | `pairs` | gespeicherte Zuordnung ist die richtige |
| cloze | `[Lücke]` in `text` | wie bisher |
| photo, statement | keines | zählen bei Einsendung als richtig |

Die Felder `correct` sind außerhalb von Kartensets optional und werden dort nur auf Gültigkeit geprüft.

Bewertung (`TaskTypes.judge(task, answer)`, nur der Server, gegen die Antwortformate oben): `binary` `answer.choice`; `choice` `answer.index`; `select` `answer.indices` als exakte Menge ohne Doppelte; `bucket` alle `placements` richtig und vollständig; `ranking` `answer.order` exakt; `pairs` `answer.assignments` enthält jedes Paar genau einmal (`left` und `right` exakt, die alte Form `{ matched }` ist im Brettspiel falsch); `cloze` `answer.gaps` positionsgenau (nach `trim`); `chat` gültiger `answer.path` ab `start` bis zu einem Erfolgs-Ende, ein unterwegs endender Pfad ist falsch; `scroller` `answer.marked` exakt die markierten Posts; `photo`/`statement` wahr, wenn zuvor per `studentSubmission` eingereicht wurde und `url`/`text` nicht leer ist. Kaputte Antworten werfen nie, sie sind falsch. Ein vom Client gesendetes `correct` wird ignoriert.

### Session anlegen

`POST /api/sessions` (Lehrkraft) mit
```json
{ "gameMode": "board", "maxTeams": 6,
  "board": { "worldCount": 2, "portals": ["news", "ki"], "sets": { "haupt": 11, "news": 12, "ki": 13 } } }
```
- `worldCount` 1 bis 5, `portals` genau so viele verschiedene Welten (ohne `haupt`), in der Reihenfolge von `GameRules.portalFields(worldCount)`.
- `sets`: für `haupt` und jede gewählte Welt die Blueprint-ID eines eigenen Kartensets dieser Welt.
- Antwort `201 { success: true, code, sessionId }`, Ereignisse wie bei der einzelnen Spielrunde (`sessionOpened`, ggf. `sessionClosed`).
- Fehler: `400 INVALID_INPUT` (Form), `400 INVALID_BOARD_CONFIG` (Anzahl, Doppelte, fehlendes Set), `400 WORLD_MISMATCH` (falsche Welt oder kein Kartenset), `400 INVALID_BLUEPRINT` (Set ungültig), `404` (fremde oder unbekannte Spielrunde).
- Die Sets werden als Snapshot in die Session kopiert. Spätere Änderungen oder Löschen der Vorlagen wirken nicht.
- Ein Kartenset lässt sich nicht als einzelne Spielrunde spielen: `POST /api/sessions` ohne `gameMode: "board"` und `PATCH /active/mode` antworten dann `400 WRONG_TEMPLATE`.
- In einer Brett-Session antwortet `PATCH /active/mode` immer `409 BOARD_SESSION`.

`POST /active/start` startet Runde 1. Wurde das Spiel per `POST /active/end` oder `/reopen` unterbrochen, setzt ein neuer Start den Stand fort (nie von vorn). Für ein neues Spiel wird eine neue Session angelegt. Reicht die Kartenzahl nicht für die Gruppen, bekommen die übrigen Gruppen `CARD_TAKEN`; die Lehrkraft kann mit `forceEvaluate` weitermachen (`cardCount` zeigt die Karten des aktuellen Sets).

### Spielstand (`BoardState`)

Identisch aus `TeacherState.board`, `TeamState.board` und dem Ereignis `boardState`, abzüglich der Lehrkraft-Felder bei Teams.

```json
{ "sessionId": 1, "gameMode": "board", "gameStatus": "running", "rev": 7, "phase": "round",
  "world": null, "worldKey": "haupt", "worldName": "Allgemeines Spielbrett", "kartenset": "Set",
  "mainPos": 5, "worldPos": 1, "round": 3, "remainingSteps": 0,
  "lastResult": { "correct": 5, "total": 6, "percent": 83, "steps": 4 },
  "pending": null, "message": null, "donePortals": [13], "worldCount": 2,
  "portals": [ { "field": 6, "world": "news", "worldName": "News Arena", "kartenset": "Set", "done": false } ],
  "groupProgress": { "total": 6, "finished": 2 } }
```

- `world`: `null` = Hauptbrett, sonst der Weltenschlüssel. `worldKey`: immer gesetzt (`haupt` auf dem Hauptbrett), bestimmt Farben und Monster-Bild über `GameRules.WORLDS[worldKey]`.
- `mainPos`, `worldPos`: Felder 1 bis 25. `mainPos` bleibt auf dem Portalfeld stehen, solange eine Welt läuft. `worldPos` nur mit `world` lesen.
- `lastResult`: Klassen-Ergebnis der zuletzt ausgewerteten Runde, `null` vor der ersten Auswertung. Bleibt in der nächsten Runde stehen, bis neu ausgewertet ist. `percent` ist gerundet und nur zur Anzeige.
- `rev`: steigt bei jeder Änderung der Spielfelder oben (Phase, Position, Runde, ...). Karten-Stände der Gruppen ändern `rev` nicht. Jede Aktion der Lehrkraft sendet die zuletzt gesehene `rev`. **Teams dürfen `rev` ignorieren.**
- `message`: fertiger deutscher Text für `continue` (`Du darfst noch X Schritte gehen.`), `portal`, `worldDone`, `finished`, sonst `null`.
- `pending` je nach Phase:
  - `monster`: `{ kind: "monster", field, index, label, world, worldName, monsterImage }`, `label` ist `Monster 1`, `Monster 2`, `Monster 3` oder `Endboss`, `monsterImage` kann `null` sein.
  - `portal`: `{ kind: "portal", field, world, worldName, kartenset, message }`.
  - `worldDone`: `{ kind: "worldDone", field, world, worldName, kartenset, message }`, `field` ist das Portalfeld der Rückkehr.
  - sonst `null`.

Nur für Lehrkräfte zusätzlich:

```json
{ "groups": [ { "teamId": 7, "name": "Team", "color": "#3b82f6",
                "status": "finished", "skipped": false,
                "card": { "taskKey": "3-2", "code": "NEWS-03", "type": "choice", "title": "Frage", "index": 2 },
                "correct": true, "answer": { "index": 1, "label": "B" },
                "openedAt": "...", "finishedAt": "..." } ],
  "monsterTask": { "type": "monster", "question": "...", "description": "", "image": "", "audio": "" },
  "cardCount": 11 }
```

- `status`: `none` (keine Karte), `working`, `finished`. `card`, `correct`, `answer` je nach Stand `null`. Eine abgebrochene Karte ist `finished` mit `skipped: true` und `correct: false`.
- `monsterTask`: die Aufgabe für das Tablet in der Phase `monster`, sonst `null`.
- Nur in `TeacherState.board` (nicht im Ereignis `boardState`): `sets: { haupt: { blueprintId, title, world, tasks }, ... }` mit Codes und Lösungen, etwa zum Drucken der QR-Karten.

`TeacherState.session.game_mode` ist `classic` oder `board`. In der Brett-Session sind `session.blueprint.tasks` leer. In `TeamState` kommen `gameMode` und `board` (bei `classic` `null`) sowie `card` (eigene Karte der laufenden Runde, siehe unten) dazu; `blueprint` und `progress` sind im Brettspiel immer `null`, `phase` bleibt `lobby`/`running`.

### Phasen

| `phase` | Bedeutung | Aktion der Lehrkraft | danach |
|---|---|---|---|
| `lobby` | noch nicht gestartet | `POST /active/start` | `round` |
| `round` | Gruppen scannen und lösen | `forceEvaluate` (nur mit mindestens einer Gruppe) | `result`; sonst automatisch `result`, sobald jede aktuelle Gruppe fertig ist |
| `result` | Klassen-Ergebnis | `move` | je nach Feld: `monster`, `portal`, `worldDone`, `finished`, sonst nächste `round` |
| `monster` | Monster-Aufgabe auf dem Tablet, Teams warten | `confirm` | `continue` bei Restschritten, sonst nächste `round` |
| `continue` | `Du darfst noch X Schritte gehen.` | `move` | wie nach `result` |
| `portal` | Weltenbrett auslegen, Kartenset holen | `confirm` | nächste `round` in der Welt, `worldPos = 1` |
| `worldDone` | Welt geschafft, Weltenbrett weg | `confirm` | nächste `round` auf dem Hauptbrett, Portal `done` |
| `finished` | Sieg, endgültig | keine | |

Runden: Beim Start einer neuen Runde steigt `round`; alte Karten bleiben gespeichert, gelten aber nicht mehr. Karten dürfen in späteren Runden wieder genutzt werden. Wird eine Gruppe in der Runde gelöscht und alle übrigen sind fertig, folgt `result`. Eine neu beitretende Gruppe zählt sofort mit. In einer Runde ohne Gruppen passiert nichts, bis eine dazukommt.

### Karten

- `TeamState.card` und das Ereignis `boardCard`: `{ taskKey, round, status, type, title, openedAt, finishedAt, task }`, oder `null`.
  - `status`: `working`, `finished` oder `skipped`.
  - `task`: Die Aufgabe (mit `key` gleich `taskKey`) nur bei `working`, sonst `null`. Ohne `code` und ohne Lösungen.
  - Die Karte gibt es nur in der Phase `round`; `round` im `boardState` zeigt, ob sie noch gilt. Ein neuer Wert von `board.round` heißt: Karte vergessen.
  - **Richtig oder falsch wird Teams nie gemeldet.** Sie sehen nur `board.lastResult`.
- Aus `task` entfernt der Server: `code`, `correct`, `isBad` (scroller), `target` (bucket), `success` (chat). `ranking.items` kommt gemischt an. Bei `pairs.pairs` sind linke und rechte Seite getrennt gemischt: Die Texte stimmen, die Zeilen sagen nichts über die Zuordnung. Die Gruppe ordnet alle Paare zu und gibt einmal ab; im Brettspiel gibt es dabei keine Rückmeldung je Paar.
- Ausnahmen, die der Renderer zum Spielen braucht und die deshalb lesbar bleiben: `cloze.text` (enthält die Wörter der Lücken) und die Knoten-Struktur von `chat`. Dazu gehören die Knotennamen: Sie sind für Teams im Netzwerkverkehr sichtbar und dürfen deshalb nichts über richtig oder falsch verraten (die Beispiel-Kartensets heißen `ende1`, `ende2`).
- **Hinweis für Renderer im Brettspiel:** Ohne `target` und `isBad` darf `bucket` und `scroller` nicht nach richtig/falsch einfärben (sonst wäre alles rot); dort neutrale Farben verwenden.

### Einsendungen im Brettspiel

Foto und Freitext: erst `studentSubmission` mit `taskKey` der Karte, nach `ok: true` dann `boardSubmitCard`. Ohne vorherige Einsendung antwortet der Server `SUBMISSION_MISSING`.

### Socket-Ereignisse des Brettspiels

| Ereignis (Client an Server) | Identität | Payload | Ack bei Erfolg | Fehlercodes |
|---|---|---|---|---|
| `boardOpenCard` | Team, Spiel läuft | `{ code }` (Groß/Klein egal) | `{ ok, card }`. Die eigene offene Karte erneut öffnen ist erlaubt (Reload) | `NOT_RUNNING`, `NOT_BOARD`, `NOT_IN_ROUND`, `UNKNOWN_CODE` (fremdes Set oder Monster), `CARD_TAKEN`, `CARD_ALREADY_OPEN`, `ALREADY_FINISHED` |
| `boardSubmitCard` | Team, Spiel läuft | `{ taskKey, status: "completed" \| "skipped", answer? }` | `{ ok, card }` | `NOT_RUNNING`, `NOT_BOARD`, `NOT_IN_ROUND`, `NO_CARD`, `UNKNOWN_TASK`, `ALREADY_FINISHED`, `SUBMISSION_MISSING`, `ANSWER_TOO_LARGE` |
| `boardAction` | Lehrkraft der Session | `{ sessionId, action: "move" \| "confirm" \| "forceEvaluate", rev }` | `{ ok, board }`, `board` wie Ereignis `boardState` (ohne `sets`) | `STALE_STATE` (`rev` veraltet: Stand übernehmen, nicht automatisch wiederholen), `INVALID_ACTION` (falsche Phase), `NO_TEAMS`, `NOT_RUNNING`, `NOT_BOARD`, `SESSION_CLOSED`, `INVALID_INPUT` |

| Ereignis (Server an Client) | Empfänger | Payload |
|---|---|---|
| `boardState` | Lehrkraft, Teams der Session | `BoardState`; Teams ohne `groups`, `monsterTask`, `cardCount`. Bei jeder Änderung einschließlich Karten-Stand und neuen Gruppen |
| `boardCard` | nur das betroffene Team | `{ sessionId, card }` nach `boardOpenCard` und `boardSubmitCard` |

`gameStarted`, `gameEnded`, `gameModeUpdated` enthalten nun zusätzlich `gameMode`. Auch nach `gameStarted`/`gameEnded` kommt ein `boardState`. Nach jedem `connect` und Reload liefert `joinSessionRoom` den vollen Stand mit `board` und `card`.

Weitere Fehlercodes: `NOT_IN_ROUND`, `CARD_TAKEN`, `CARD_ALREADY_OPEN`, `NO_CARD`, `SUBMISSION_MISSING`, `UNKNOWN_CODE`, `STALE_STATE`, `INVALID_ACTION`, `NO_TEAMS`, `NOT_BOARD`, `BOARD_SESSION`.

### Monster-Aufgabe in einer einzelnen Spielrunde

Typ `monster` in `normal`- und `qr`-Spielrunden. Teams melden den Beginn wie immer (`reportTaskStart`, bei QR `openStation` mit dem Code der Karte) und warten dann, bis die Lehrkraft bestätigt:

- Teams können das Monster nicht selbst abschließen oder abbrechen: `reportTaskResult` antwortet `MONSTER_PENDING`. `reportTaskStart`, `reportTaskResult` und `studentSubmission` späterer Aufgaben (normal) beziehungsweise anderer Stationen (QR), `openStation` und `finishStations` antworten ebenfalls `MONSTER_PENDING`, solange das Monster offen ist.
- Das Dashboard sieht `teamTaskUpdate` mit `taskType: "monster"` und `status: "started"` sowie `progress.currentTaskKey`.

| Ereignis | Identität | Payload | Ack bei Erfolg |
|---|---|---|---|
| `confirmMonster` | Lehrkraft der Session | `{ sessionId, teamId, taskKey }` | `{ ok, progress, alreadyCompleted }`. Fehlercodes: `MONSTER_NOT_REACHED` (normal: Monster noch nicht die aktuelle Aufgabe; QR: Karte noch nicht geöffnet), `NOT_MONSTER`, `UNKNOWN_TASK`, `TEAM_GONE`, `ALREADY_FINISHED`, `NOT_RUNNING`, `SESSION_CLOSED`, `BOARD_SESSION` |

| Ereignis | Empfänger | Payload |
|---|---|---|
| `monsterConfirmed` | nur das betroffene Team | `{ sessionId, taskKey, progress }`. Zusätzlich `teamTaskResult` an die Lehrkraft; `Result.status` ist `completed`, `answer` ist `null` |

### Rate-Limits

Client-Ereignisse fallen unter das gemeinsame Socket-Budget (`RATE_LIMITED`, 200 Ereignisse je 10 Sekunden und Socket). `POST /api/upload/audio` zählt beim Upload-Limit mit.

## Game-Rules (`public/js/shared/game-rules.js`)

Klassisches Skript (`window.GameRules`) und Node-Modul (`module.exports`), ohne Abhängigkeiten.

| Mitglied | Zweck |
|---|---|
| `BOARD_FIELDS` (25), `ARRIVAL_FIELD` (1), `MONSTER_FIELDS` ([8, 16, 24]), `MAIN_WORLD` (`"haupt"`), `MIN_WORLDS`, `MAX_WORLDS` | Stammdaten |
| `PORTAL_ALWAYS_STOPS` | Die Portal-Regel, an einer Stelle: `true` = immer stoppen, Restschritte verfallen |
| `WORLDS` | `{ key: { key, name, colors: { bg, surface, surface2, accent, accent2, text }, monsterImage } }`. `colors` sind die Handbuch-Farben unverändert, `monsterImage` kann `null` sein. Monster-Bilder haben keinen transparenten Hintergrund: immer in abgerundeten Kacheln zeigen |
| `WORLD_KEYS` | wählbare Welten ohne `haupt` |
| `hasWorld(key)`, `worldName(key)` | Abfragen |
| `portalFields(worldCount)` | Portalfelder, leer bei ungültiger Anzahl |
| `computeSteps(correct, total)`, `roundResult(correct, total)` | Schritte (> 80 % 4, > 60 % 2, sonst 1) und Ergebnis `{ correct, total, percent, steps }` |
| `planMove({ pos, steps, stops })` | `{ to, remaining, stoppedAt: "monster" \| "portal" \| "end" \| null }`. `stops: { portals: [offene Portalfelder], monsters? }` |
| `monsterIndex(field)`, `monsterLabel(world, index)` | Monster-Position und Anzeigename |
| `continueMessage(x)`, `portalMessage(world, kartenset)`, `worldDoneMessage(world, field)`, `VICTORY_MESSAGE` | Fertige deutsche Texte |
| `readableText(background, preferred?)` | Lesbare Textfarbe auf `background`: `preferred`, wenn der Kontrast mindestens 4.5 ist, sonst hell oder dunkel, auf mittleren Farben Schwarz oder Weiß. Die `text`-Farben einiger Welten sind allein nicht lesbar (etwa `news`), also immer hierüber wählen |

## Task-Types (`public/js/shared/task-types.js`)

Klassisches Skript (`window.TaskTypes`) und Node-Modul (`module.exports`).

| Mitglied | Zweck |
|---|---|
| `list` | alle 18 Definitionen: `{ type, label, category, icon, fields, defaultData(), validate(task) }` |
| `EDITOR_TYPES`, `editorList()` | die 12 im Editor angebotenen Typen, in Anzeigereihenfolge; `editorList()` liefert die Definitionen. Ein Typ, der hier fehlt, bleibt voll funktionsfähig, wird aber nicht neu angeboten. Bestehende Aufgaben solcher Typen öffnen, rendern und speichern weiter. Wieder einblenden: Eintrag in `EDITOR_TYPES` ergänzen |
| `judge(task, answer)`, `solutionErrors(task)` | Bewertung (true/false, nur Server) und was zum Bewerten fehlt |
| `WORLD_KEYS`, `MONSTERS_PER_WORLD` | Schlüssel der Kartensets, 3 |
| `types`, `categories`, `limits`, `PROFILE_FIELDS`, `DEFAULT_PASSWORD_RULES` | Stammdaten |
| `get(type)` | Definition oder `null` |
| `createTask(type)` | neue Aufgabe mit Startdaten (eigenes Objekt) |
| `validate(task)` | deutsche Fehlertexte, leer = gültig |
| `validateContent({ templateType, tasks })` | `[{ taskIndex, message }]` |
| `sanitizeTask(task)` | Kopie nur mit Feldern des Typs |
| `ensureStationCodes(tasks)`, `generateStationCode()` | Stations-Codes |
| `taskTitle(task)` | Anzeigename |
| `parseCloze(text)` | `{ parts: [{ text } \| { gap }], gaps }` |
| `evaluatePasswordRules(rules, value)` | `{ rules: [{ rule, checkable, ok }], accepted }`. Unbekannte Regeln zählen als erfüllt. Ohne `rules` gilt `DEFAULT_PASSWORD_RULES`, eine leere Liste heißt: keine Regeln, jedes nicht leere Passwort genügt |

Editor-Hinweis: Die Startdaten einiger Typen (leere Optionen, leerer Feed) sind absichtlich noch nicht gültig; die Validierung meldet sie bis zur Eingabe.

## Betrieb

Umgebungsvariablen stehen in `.env.example`.

- **Daten**: `DATA_DIR` (Standard `<Projekt>/data`) enthält `database.sqlite` und `uploads/`. Sicherung: `sqlite3 database.sqlite ".backup ziel.sqlite"` plus Kopie von `uploads/`.
- **Aufbewahrung**: `SESSION_RETENTION_DAYS` löscht abgeschlossene Sessions samt Fotos nach so vielen Tagen. Standard im Betrieb 90, sonst 0 (aus).
- **Reverse-Proxy**: Domain-Root oder eigener Host, HTTPS (die Kamera braucht einen sicheren Kontext), WebSocket-Upgrade für `/socket.io/`, `X-Forwarded-Proto` und `X-Forwarded-For` setzen. `TRUST_PROXY` ist die Anzahl der Proxies davor (Standard im Betrieb 1).
- **Prozess**: `node index.js` unter systemd oder einem anderen Supervisor; `SIGTERM` beendet sauber. Native Module (`bcrypt`, `sqlite3`) mit `npm ci` auf dem Zielsystem installieren, `node_modules` nicht von Windows kopieren. Node 22 oder neuer.
- **Lehrkraft anlegen**: `node scripts/add_teacher.js <name>`; das Passwort wird abgefragt oder von stdin gelesen. Für den Namen gilt dieselbe Regel wie beim Login: Leerzeichen am Rand fallen weg, danach 1 bis 254 Zeichen.
- **Alte Datenbanken**: Eine Datenbank von vor den Migrationen (`PRAGMA user_version` 0, aber mit Tabellen, früher `database.sqlite` im Projektordner) wird nicht aktualisiert. Die App liest nur `<DATA_DIR>/database.sqlite` und bricht beim Start mit einer Meldung ab, wenn dort eine solche Datei liegt; ihre Daten bleiben dabei unverändert. Sie muss neu angelegt werden.
