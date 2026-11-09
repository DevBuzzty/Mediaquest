'use strict';

// Die Beispiel-Chats verrieten die Antwort schon im Namen des Zielknotens. Ersetzt wird nur der
// unveraenderte Originaltext; von Lehrkraeften bearbeitete Runden und Session-Snapshots bleiben.
const BEFORE = '"options":[{"label":"Klar!","next":"bad"},{"label":"Nein!","next":"good"}]},"bad":{"text":"Account gehackt!","options":[]},"good":{"text":"Sicher geblieben!","options":[]}}';
const AFTER = '"options":[{"label":"Klar!","next":"ende1"},{"label":"Nein!","next":"ende2"}]},"ende1":{"text":"Account gehackt!","options":[]},"ende2":{"text":"Sicher geblieben!","options":[]}}';

exports.up = `
UPDATE blueprints SET content = replace(content, '${BEFORE}', '${AFTER}')
WHERE instr(content, '${BEFORE}') > 0;
`;
