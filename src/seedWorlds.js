'use strict';

const GameRules = require('../public/js/shared/game-rules.js');

/** Harmlose Beiträge, die jeden Beispiel-Feed auf die nötige Länge bringen. */
const HARMLESS_POSTS = [
    { user: 'Mia', text: 'Heute Fußball im Park, wer kommt mit?', isBad: false },
    { user: 'Stadtbibliothek', text: 'Am Freitag ist Vorlesenachmittag.', isBad: false },
    { user: 'Oma_Gerda', text: 'Der Apfelkuchen ist gelungen!', isBad: false },
    { user: 'SportAG', text: 'Training fällt nächste Woche aus.', isBad: false },
    { user: 'Tierheim', text: 'Bello sucht ein neues Zuhause.', isBad: false },
    { user: 'Wetterdienst', text: 'Morgen wird es sonnig.', isBad: false }
];

function feed(problemPosts) {
    return [
        ...problemPosts.map(([user, text]) => ({ user, text, isBad: true })),
        ...HARMLESS_POSTS
    ];
}

function kartenset({ world, prefix, title, monsters, cards }) {
    const worldInfo = GameRules.WORLDS[world];
    const tasks = cards.map((card, index) => ({ ...card, code: `${prefix}-${String(index + 1).padStart(2, '0')}` }));
    monsters.forEach((text, index) => {
        tasks.push({
            type: 'monster',
            question: `[Platzhalter] ${GameRules.monsterLabel(world, index)}: ${text}`,
            description: 'Beispieltext, bitte im Editor durch eure eigene Monster-Aufgabe ersetzen.',
            image: worldInfo.monsterImage || ''
        });
    });
    return { world, title, tasks };
}

const WORLD_KARTENSETS = [
    kartenset({
        world: 'haupt',
        prefix: 'HAUPT',
        title: 'Allgemeines Spielbrett: Beispielkarten',
        monsters: [
            'Nennt gemeinsam drei Regeln für gutes Verhalten im Netz.',
            'Zeigt der Klasse in einer Pantomime, was ein sicheres Passwort ausmacht.',
            'Erklärt der Lehrkraft, was ihr im Spiel über das Netz gelernt habt.'
        ],
        cards: [
            { type: 'binary', question: 'Darf man jedes Foto aus dem Netz einfach weiterschicken?', description: 'Wische nach rechts für Ja, nach links für Nein.', icon: '📷', correct: 'left' },
            { type: 'choice', question: 'Was gehört in ein sicheres Passwort?', description: 'Wähle die beste Antwort.', options: ['Der eigene Vorname', 'Eine lange Mischung aus Zeichen', 'Das Geburtsdatum'], correct: 1 },
            { type: 'select', question: 'Welche Daten solltest du für dich behalten?', description: 'Markiere alle richtigen Antworten.', options: ['Adresse', 'Lieblingsfarbe', 'Passwort', 'Telefonnummer'], correct: [0, 2, 3] },
            { type: 'bucket', question: 'Privat oder öffentlich?', description: 'Ordne die Begriffe zu.', buckets: ['Privat', 'Öffentlich'], items: [{ text: 'Passwort', target: 0 }, { text: 'Hausnummer', target: 0 }, { text: 'Schulname der Stadtverwaltung', target: 1 }, { text: 'Busfahrplan', target: 1 }] },
            { type: 'ranking', question: 'Bringe in die richtige Reihenfolge: Du bekommst eine seltsame Nachricht.', description: 'Der erste Schritt steht oben.', items: ['Nicht antworten', 'Einen Screenshot machen', 'Einer erwachsenen Person zeigen', 'Absender blockieren'] },
            { type: 'pairs', question: 'Finde die Paare.', description: 'Was gehört zusammen?', pairs: [{ left: 'Link', right: 'Verweis' }, { left: 'Spam', right: 'Werbemüll' }, { left: 'Upload', right: 'Hochladen' }] },
            { type: 'cloze', question: 'Ergänze die Regeln.', description: 'Fülle die Lücken.', text: 'Ein gutes [Passwort] verrate ich [niemandem].', fakes: ['Foto', 'allen'] },
            { type: 'chat', question: 'Eine fremde Person schreibt dich an.', description: 'Reagiere richtig.', partner: 'Fremder42', nodes: { start: { text: 'Hi! Wie heißt deine Schule?', options: [{ label: 'Sag ich nicht.', next: 'ende1' }, { label: 'Die Lindenschule!', next: 'ende2' }] }, ende1: { text: 'Schade.', options: [], success: true }, ende2: { text: 'Danke, das merke ich mir.', options: [] } } },
            { type: 'scroller', question: 'Markiere alle problematischen Posts.', description: 'Tippe auf die Beiträge.', posts: feed([['Gewinn24', 'Du hast gewonnen! Klick hier!'], ['Hater', 'Du bist so dumm!'], ['Bot7', 'Gib hier deine Kontodaten ein.'], ['Fake_Promi', 'Schick mir dein Passwort für Fan-Geschenke.']]) },
            { type: 'statement', question: 'Was ist deine wichtigste Regel im Netz?', description: 'Schreibt einen Satz.' },
            { type: 'photo', question: 'Macht ein Gruppenfoto mit eurer Karte.', description: 'Achtet darauf, dass nur ihr zu sehen seid.' }
        ]
    }),
    kartenset({
        world: 'news',
        prefix: 'NEWS',
        title: 'News Arena: Beispielkarten',
        monsters: [
            'Sucht eine Schlagzeile und erklärt, warum sie echt oder falsch sein könnte.',
            'Spielt ein kurzes Nachrichten-Interview vor der Klasse.',
            'Erfindet ein Merkblatt mit drei Tipps gegen Fake News.'
        ],
        cards: [
            { type: 'binary', question: 'Ist eine Nachricht wahr, nur weil sie oft geteilt wird?', description: 'Rechts für Ja, links für Nein.', icon: '📰', correct: 'left' },
            { type: 'choice', question: 'Woran erkennst du eine seriöse Nachrichtenseite?', description: 'Wähle die beste Antwort.', options: ['Viele bunte Banner', 'Impressum und genannte Quellen', 'Großbuchstaben in der Überschrift'], correct: 1 },
            { type: 'select', question: 'Was hilft beim Prüfen einer Nachricht?', description: 'Markiere alle richtigen Antworten.', options: ['Andere Quellen vergleichen', 'Datum prüfen', 'Nur die Überschrift lesen', 'Autor nachschlagen'], correct: [0, 1, 3] },
            { type: 'bucket', question: 'Fakt oder Meinung?', description: 'Ordne zu.', buckets: ['Fakt', 'Meinung'], items: [{ text: 'Berlin ist die Hauptstadt.', target: 0 }, { text: 'Pizza schmeckt am besten.', target: 1 }, { text: 'Das Spiel endete 2:1.', target: 0 }, { text: 'Der Film war langweilig.', target: 1 }] },
            { type: 'ranking', question: 'So entsteht eine gute Nachricht.', description: 'Der erste Schritt steht oben.', items: ['Thema finden', 'Quellen prüfen', 'Text schreiben', 'Veröffentlichen'] },
            { type: 'pairs', question: 'Finde die Paare.', description: 'Begriff und Bedeutung.', pairs: [{ left: 'Clickbait', right: 'Reißerische Überschrift' }, { left: 'Quelle', right: 'Herkunft der Information' }, { left: 'Deepfake', right: 'Gefälschtes Video' }] },
            { type: 'cloze', question: 'Ergänze den Satz.', description: 'Fülle die Lücken.', text: 'Vor dem Teilen prüfe ich die [Quelle] und das [Datum].', fakes: ['Farbe', 'Likes'] },
            { type: 'chat', question: 'Dein Freund schickt eine Eilmeldung.', description: 'Reagiere richtig.', partner: 'Ben', nodes: { start: { text: 'Krass! Morgen fällt die Schule aus, steht hier. Teil das!', options: [{ label: 'Wird sofort geteilt!', next: 'ende1' }, { label: 'Woher stammt das?', next: 'ende2' }] }, ende1: { text: 'Oh, das war ein Fake.', options: [] }, ende2: { text: 'Stimmt, ich prüfe das erst.', options: [], success: true } } },
            { type: 'scroller', question: 'Markiere alle Fake News.', description: 'Tippe auf die Beiträge.', posts: feed([['EilmeldungHeute', 'Forscher beweisen: Handys machen unsichtbar!'], ['Wahrheit99', 'Geheime Regierung verbietet Ferien!'], ['ClickNews', 'Unglaublich: Dieser Trick macht reich!'], ['Bot_News', 'Teilen, sonst passiert etwas Schlimmes!']]) },
            { type: 'statement', question: 'Wie erkennst du Fake News?', description: 'Schreibt einen Satz.' },
            { type: 'photo', question: 'Stellt eine Titelseite pantomimisch nach und fotografiert sie.', description: 'Das Foto sieht nur eure Lehrkraft.' }
        ]
    }),
    kartenset({
        world: 'dschungel',
        prefix: 'DSCH',
        title: 'Social Media Dschungel: Beispielkarten',
        monsters: [
            'Zeigt pantomimisch drei Reaktionen auf einen gemeinen Kommentar.',
            'Überlegt euch einen freundlichen Kommentar und tragt ihn laut vor.',
            'Erklärt, woran man erkennt, dass ein Profil gefälscht ist.'
        ],
        cards: [
            { type: 'binary', question: 'Darf man Fotos von anderen ohne Erlaubnis posten?', description: 'Rechts für Ja, links für Nein.', icon: '🐒', correct: 'left' },
            { type: 'choice', question: 'Was machst du bei einem gemeinen Kommentar?', description: 'Wähle die beste Antwort.', options: ['Noch gemeiner antworten', 'Melden und Hilfe holen', 'Teilen'], correct: 1 },
            { type: 'select', question: 'Was verrät ein öffentliches Profil oft?', description: 'Markiere alle richtigen Antworten.', options: ['Wohnort', 'Freundeskreis', 'Schulhof-Ampelschaltung', 'Hobbys'], correct: [0, 1, 3] },
            { type: 'bucket', question: 'Gut oder schlecht für dein Profil?', description: 'Ordne zu.', buckets: ['Gut', 'Schlecht'], items: [{ text: 'Profil auf privat stellen', target: 0 }, { text: 'Standort immer teilen', target: 1 }, { text: 'Freundschaften prüfen', target: 0 }, { text: 'Passwort posten', target: 1 }] },
            { type: 'ranking', question: 'Was tust du bei Cybermobbing?', description: 'Der erste Schritt steht oben.', items: ['Nicht antworten', 'Beweise sichern', 'Einer Vertrauensperson erzählen', 'Melden'] },
            { type: 'pairs', question: 'Finde die Paare.', description: 'Begriff und Bedeutung.', pairs: [{ left: 'Follower', right: 'Abonnent' }, { left: 'Story', right: 'Beitrag für 24 Stunden' }, { left: 'Hashtag', right: 'Schlagwort' }] },
            { type: 'cloze', question: 'Ergänze die Regel.', description: 'Fülle die Lücken.', text: 'Bevor ich etwas [poste], frage ich mich: Würde ich das auch [persönlich] sagen?', fakes: ['esse', 'nie'] },
            { type: 'chat', question: 'Jemand will dein Profil nutzen.', description: 'Reagiere richtig.', partner: 'InfluencerMax', nodes: { start: { text: 'Gib mir dein Passwort, ich mache dich berühmt!', options: [{ label: 'Nein, niemals.', next: 'ende1' }, { label: 'Ok, hier ist es.', next: 'ende2' }] }, ende1: { text: 'Na gut, schade.', options: [], success: true }, ende2: { text: 'Dein Profil gehört jetzt mir!', options: [] } } },
            { type: 'scroller', question: 'Markiere alle problematischen Posts.', description: 'Tippe auf die Beiträge.', posts: feed([['Hater_X', 'Du bist hässlich, lösch dich.'], ['Gewinnspiel_4U', 'Folge mir und gib deine Adresse an!'], ['AnonyMob', 'Alle gegen Lena, jetzt kommentieren!'], ['Follower_Shop', 'Kauf 1000 Follower für nur 5 Euro!']]) },
            { type: 'statement', question: 'Was postest du lieber nicht und warum?', description: 'Schreibt einen Satz.' },
            { type: 'photo', question: 'Fotografiert ein Plakat mit einer Netiquette-Regel.', description: 'Das Foto sieht nur eure Lehrkraft.' }
        ]
    }),
    kartenset({
        world: 'daten',
        prefix: 'DATEN',
        title: 'Datenhöhle: Beispielkarten',
        monsters: [
            'Erklärt, welche Spuren ihr heute schon im Netz hinterlassen habt.',
            'Denkt euch ein sicheres Passwort aus und erklärt die Methode, ohne es zu verraten.',
            'Zählt drei Apps auf und überlegt, welche Daten sie brauchen und welche nicht.'
        ],
        cards: [
            { type: 'binary', question: 'Sollte eine Taschenlampen-App auf deine Kontakte zugreifen?', description: 'Rechts für Ja, links für Nein.', icon: '🐌', correct: 'left' },
            { type: 'choice', question: 'Was sind Cookies im Internet?', description: 'Wähle die beste Antwort.', options: ['Kleine Datenspeicher im Browser', 'Ein Computervirus', 'Kekse für Roboter'], correct: 0 },
            { type: 'select', question: 'Was sind persönliche Daten?', description: 'Markiere alle richtigen Antworten.', options: ['Name', 'Fingerabdruck', 'Standort', 'Wetter von gestern'], correct: [0, 1, 2] },
            { type: 'bucket', question: 'Sicher oder unsicher?', description: 'Ordne zu.', buckets: ['Sicher', 'Unsicher'], items: [{ text: 'Zwei-Faktor-Anmeldung', target: 0 }, { text: 'Passwort 123456', target: 1 }, { text: 'Updates installieren', target: 0 }, { text: 'Gratis-WLAN ohne Schutz', target: 1 }] },
            { type: 'ranking', question: 'So richtest du ein Konto sicher ein.', description: 'Der erste Schritt steht oben.', items: ['Starkes Passwort wählen', 'Zwei-Faktor einschalten', 'Privatsphäre einstellen', 'Regelmäßig prüfen'] },
            { type: 'pairs', question: 'Finde die Paare.', description: 'Begriff und Bedeutung.', pairs: [{ left: 'Tracking', right: 'Verfolgen im Netz' }, { left: 'Verschlüsselung', right: 'Daten unlesbar machen' }, { left: 'Backup', right: 'Sicherungskopie' }] },
            { type: 'cloze', question: 'Ergänze den Satz.', description: 'Fülle die Lücken.', text: 'Für jedes Konto nutze ich ein eigenes [Passwort], und ich installiere regelmäßig [Updates].', fakes: ['Foto', 'Spiele'] },
            { type: 'chat', question: 'Eine App will Zugriff.', description: 'Reagiere richtig.', partner: 'GratisSpieleApp', nodes: { start: { text: 'Erlaube Zugriff auf Kontakte, Kamera und Standort!', options: [{ label: 'Alles erlauben.', next: 'ende1' }, { label: 'Nur das Nötigste erlauben.', next: 'ende2' }] }, ende1: { text: 'Deine Daten werden verkauft.', options: [] }, ende2: { text: 'Einstellungen gespeichert.', options: [], success: true } } },
            { type: 'scroller', question: 'Markiere alle Datenfallen.', description: 'Tippe auf die Beiträge.', posts: feed([['PrizeBot', 'Gib deine Handynummer für ein Handy ein!'], ['QuizKing', 'Welcher Promi bist du? Nur mit Adresse!'], ['AppStar', 'Neue App: Zugriff auf alle Kontakte erforderlich.'], ['Datensammler', 'Sende uns ein Foto deines Ausweises!']]) },
            { type: 'statement', question: 'Welche Daten würdest du nie teilen?', description: 'Schreibt einen Satz.' },
            { type: 'photo', question: 'Fotografiert ein Bild eurer eigenen Daten-Regel.', description: 'Bitte keine echten Daten zeigen.' }
        ]
    }),
    kartenset({
        world: 'ki',
        prefix: 'KI',
        title: 'KI Labor: Beispielkarten',
        monsters: [
            'Spielt einen Roboter, der Anweisungen falsch versteht.',
            'Erklärt, woran man ein KI-Bild erkennen könnte.',
            'Stellt drei Regeln auf, wie ihr KI in der Schule fair nutzt.'
        ],
        cards: [
            { type: 'binary', question: 'Macht eine KI nie Fehler?', description: 'Rechts für Ja, links für Nein.', icon: '🤖', correct: 'left' },
            { type: 'choice', question: 'Womit lernt eine KI?', description: 'Wähle die beste Antwort.', options: ['Mit Daten', 'Mit Schlaf', 'Mit Gedankenlesen'], correct: 0 },
            { type: 'select', question: 'Wo steckt oft KI drin?', description: 'Markiere alle richtigen Antworten.', options: ['Sprachassistent', 'Videoempfehlungen', 'Holzlineal', 'Übersetzungs-App'], correct: [0, 1, 3] },
            { type: 'bucket', question: 'Mensch oder Maschine?', description: 'Wer kann das besonders gut?', buckets: ['Mensch', 'Maschine'], items: [{ text: 'Trösten', target: 0 }, { text: 'Millionen Zahlen rechnen', target: 1 }, { text: 'Verantwortung tragen', target: 0 }, { text: 'Riesige Textmengen durchsuchen', target: 1 }] },
            { type: 'ranking', question: 'So arbeitest du sinnvoll mit einer KI.', description: 'Der erste Schritt steht oben.', items: ['Frage klar formulieren', 'Antwort lesen', 'Antwort prüfen', 'Selbst entscheiden'] },
            { type: 'pairs', question: 'Finde die Paare.', description: 'Begriff und Bedeutung.', pairs: [{ left: 'Algorithmus', right: 'Handlungsanweisung' }, { left: 'Trainingsdaten', right: 'Lernmaterial der KI' }, { left: 'Chatbot', right: 'Textbasierter Assistent' }] },
            { type: 'cloze', question: 'Ergänze den Satz.', description: 'Fülle die Lücken.', text: 'Eine KI kann sich [irren], deshalb [prüfe] ich ihre Antworten.', fakes: ['schlafen', 'esse'] },
            { type: 'chat', question: 'Ein KI-Chatbot behauptet etwas.', description: 'Reagiere richtig.', partner: 'KI-Bot', nodes: { start: { text: 'Der Mond ist aus Käse. Das weiß ich sicher!', options: [{ label: 'Das prüfe ich lieber nach.', next: 'ende1' }, { label: 'Dann schreibe ich das ins Heft.', next: 'ende2' }] }, ende1: { text: 'Sehr gut, prüfe immer die Fakten.', options: [], success: true }, ende2: { text: 'Oh nein, das war falsch.', options: [] } } },
            { type: 'scroller', question: 'Markiere alle Beiträge, die dich täuschen sollen.', description: 'Tippe auf die Beiträge.', posts: feed([['DeepfakeStar', 'Das Video zeigt wirklich den Präsidenten beim Tanzen!'], ['AI_Guru', 'KI sagt die Lottozahlen voraus, jetzt kaufen!'], ['BotArmy', 'Tausende stimmen zu, also ist es wahr!'], ['FakeVoice', 'Hör dir die Sprachnachricht deiner Mutter an und zahle!']]) },
            { type: 'statement', question: 'Was sollte eine KI nicht für dich entscheiden?', description: 'Schreibt einen Satz.' },
            { type: 'photo', question: 'Baut einen Roboter aus euren Körpern und fotografiert ihn.', description: 'Das Foto sieht nur eure Lehrkraft.' }
        ]
    }),
    kartenset({
        world: 'strand',
        prefix: 'STRAND',
        title: 'Glitch Strand: Beispielkarten',
        monsters: [
            'Spielt eine Szene, in der ein Betrüger euch ködern will.',
            'Zeigt, wie man eine verdächtige Nachricht meldet.',
            'Erklärt der Lehrkraft, wie ein Phishing-Trick funktioniert.'
        ],
        cards: [
            { type: 'binary', question: 'Darf man auf einen Link in einer unbekannten Mail klicken?', description: 'Rechts für Ja, links für Nein.', icon: '🦈', correct: 'left' },
            { type: 'choice', question: 'Was ist Phishing?', description: 'Wähle die beste Antwort.', options: ['Angeln im Meer', 'Betrug, um an Daten zu kommen', 'Ein Handyspiel'], correct: 1 },
            { type: 'select', question: 'Woran erkennst du Betrugs-Mails?', description: 'Markiere alle richtigen Antworten.', options: ['Komische Absenderadresse', 'Zeitdruck', 'Rechtschreibfehler', 'Dein Lieblingslied im Anhang der Eltern'], correct: [0, 1, 2] },
            { type: 'bucket', question: 'Vertrauen oder Vorsicht?', description: 'Ordne zu.', buckets: ['Vertrauen', 'Vorsicht'], items: [{ text: 'Nachricht von bekannter Lehrkraft in der Schul-App', target: 0 }, { text: 'Gratis-Gutschein von Unbekannt', target: 1 }, { text: 'Offizieller Elternbrief', target: 0 }, { text: 'Paket-SMS mit Zahlungslink', target: 1 }] },
            { type: 'ranking', question: 'Du hast aus Versehen geklickt. Was jetzt?', description: 'Der erste Schritt steht oben.', items: ['Seite schließen', 'Erwachsenen Bescheid sagen', 'Passwort ändern', 'Gerät prüfen lassen'] },
            { type: 'pairs', question: 'Finde die Paare.', description: 'Begriff und Bedeutung.', pairs: [{ left: 'Malware', right: 'Schadsoftware' }, { left: 'Betreff', right: 'Überschrift einer Mail' }, { left: 'Firewall', right: 'Schutz vor Angriffen' }] },
            { type: 'cloze', question: 'Ergänze die Regel.', description: 'Fülle die Lücken.', text: 'Bei einer komischen Mail klicke ich auf [keinen] Link und frage eine [erwachsene] Person.', fakes: ['jeden', 'fremde'] },
            { type: 'chat', question: 'Eine SMS verspricht ein Geschenk.', description: 'Reagiere richtig.', partner: 'Paketdienst24', nodes: { start: { text: 'Dein Paket wartet! Zahle 1 Euro über diesen Link.', options: [{ label: 'Ich zahle sofort.', next: 'ende1' }, { label: 'Ich frage erst meine Eltern.', next: 'ende2' }] }, ende1: { text: 'Deine Daten sind jetzt weg.', options: [] }, ende2: { text: 'Gute Idee, das war Betrug.', options: [], success: true } } },
            { type: 'scroller', question: 'Markiere alle Betrugsversuche.', description: 'Tippe auf die Beiträge.', posts: feed([['Bank_Sicherheit', 'Dein Konto ist gesperrt, klicke hier!'], ['Gewinn_SMS', 'Du hast 1000 Euro gewonnen!'], ['Hai_Angebote', 'Nur heute: Handy für 1 Euro, Vorkasse!'], ['Spiel_Coins', 'Gratis Coins, gib dein Passwort ein!']]) },
            { type: 'statement', question: 'Was tust du bei einer verdächtigen Nachricht?', description: 'Schreibt einen Satz.' },
            { type: 'photo', question: 'Fotografiert euer Warnschild gegen Betrug.', description: 'Das Foto sieht nur eure Lehrkraft.' }
        ]
    })
];

module.exports = { WORLD_KARTENSETS };
