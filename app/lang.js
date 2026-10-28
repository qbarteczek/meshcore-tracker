// Języki aplikacji „Tracker psa” (wbudowane, działa bez internetu): pl (źródło), en, de, cs, sv.
// Język: ?lang=xx, potem wybór zapisany w telefonie, potem język telefonu, inaczej angielski.
// t('tekst po polsku') -> tłumaczenie; tf('wzór {n}', {n: 5}) -> wzór z wartościami.
// Uwaga: meldunki tworzy baza polowa (firmware) po polsku - strona czyta je po polsku niezależnie od języka.
'use strict';

const LANGS = ['pl', 'en', 'de', 'cs', 'sv'];
const LANG_NAMES = { pl: '🇵🇱 Polski', en: '🇬🇧 English', de: '🇩🇪 Deutsch', cs: '🇨🇿 Čeština', sv: '🇸🇪 Svenska' };   // flagi: emoji (Android je rysuje)
const LANG = (() => {
  let l = null;
  try { l = new URLSearchParams(location.search).get('lang'); } catch { /* */ }
  try {
    if (LANGS.includes(l)) localStorage.setItem('qbart.lang', l);
    else l = localStorage.getItem('qbart.lang');
  } catch { /* bez pamięci */ }
  if (!LANGS.includes(l)) l = (navigator.language || '').slice(0, 2).toLowerCase();
  return LANGS.includes(l) ? l : 'en';
})();

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// kolejność w tablicy: en, de, cs, sv
const T = {
  'Tracker psa': ['Dog tracker', 'Hunde-Tracker', 'Tracker pro psa', 'Hundspårare'],
  'Połącz z bazą': ['Connect to base', 'Mit Basis verbinden', 'Připojit k základně', 'Anslut till basen'],
  'Połączono': ['Connected', 'Verbunden', 'Připojeno', 'Ansluten'],
  'Nie połączono. Włącz bazę polową i dotknij „Połącz z bazą”.': ['Not connected. Switch on the field base and tap “Connect to base”.', 'Nicht verbunden. Schalte die Feldbasis ein und tippe auf „Mit Basis verbinden“.', 'Nepřipojeno. Zapni polní základnu a klepni na „Připojit k základně“.', 'Inte ansluten. Slå på fältbasen och tryck på ”Anslut till basen”.'],
  'Nie połączono.': ['Not connected.', 'Nicht verbunden.', 'Nepřipojeno.', 'Inte ansluten.'],
  'Brak meldunku': ['No report', 'Keine Meldung', 'Žádné hlášení', 'Ingen rapport'],
  'Radar: pies względem telefonu': ['Radar: the dog relative to the phone', 'Radar: der Hund relativ zum Handy', 'Radar: pes vůči telefonu', 'Radar: hunden i förhållande till telefonen'],
  'brak pozycji': ['no position', 'keine Position', 'žádná poloha', 'ingen position'],
  'czekam na meldunek': ['waiting for a report', 'warte auf eine Meldung', 'čekám na hlášení', 'väntar på en rapport'],
  'Północ u góry': ['North up', 'Norden oben', 'Sever nahoře', 'Norr uppåt'],
  'Kierunek patrzenia u góry': ['Heading up', 'Blickrichtung oben', 'Směr pohledu nahoře', 'Blickriktning uppåt'],
  'Ekran: zwykły': ['Screen: normal', 'Bildschirm: normal', 'Obrazovka: běžně', 'Skärm: normal'],
  'Ekran: zawsze włączony': ['Screen: always on', 'Bildschirm: immer an', 'Obrazovka: stále zapnutá', 'Skärm: alltid på'],
  'Bateria psa': ['Dog battery', 'Akku Hund', 'Baterie psa', 'Hundens batteri'],
  'GPS psa': ['Dog GPS', 'GPS Hund', 'GPS psa', 'Hundens GPS'],
  'Meldunek co': ['Report every', 'Meldung alle', 'Hlášení každých', 'Rapport var'],
  'Następny za': ['Next in', 'Nächste in', 'Další za', 'Nästa om'],
  'Szukaj': ['Search', 'Suchen', 'Hledat', 'Sök'],
  'meldunek co 30 s': ['report every 30 s', 'Meldung alle 30 s', 'hlášení každých 30 s', 'rapport var 30:e s'],
  'Znaleziony': ['Found', 'Gefunden', 'Nalezen', 'Hittad'],
  'koniec szukania': ['end the search', 'Suche beenden', 'konec hledání', 'avsluta sökningen'],
  'Co 1 min': ['Every 1 min', 'Alle 1 min', 'Každou 1 min', 'Var 1:a min'],
  'Co 2 min': ['Every 2 min', 'Alle 2 min', 'Každé 2 min', 'Var 2:a min'],
  'Co 5 min': ['Every 5 min', 'Alle 5 min', 'Každých 5 min', 'Var 5:e min'],
  'Bluetooth psa': ['Dog Bluetooth', 'Bluetooth Hund', 'Bluetooth psa', 'Hundens Bluetooth'],
  'Koniec wędrówki': ['End of hike', 'Wanderung beenden', 'Konec túry', 'Vandringen slut'],
  'Zakończyć wędrówkę? Tracker wróci do bazy domowej.': ['End the hike? The tracker will return to the home base.', 'Wanderung beenden? Der Tracker kehrt zur Heimbasis zurück.', 'Ukončit túru? Tracker se vrátí k domácí základně.', 'Avsluta vandringen? Spåraren går tillbaka till hembasen.'],
  'Polecenie dojdzie do psa przy jego najbliższym meldunku.': ['The command reaches the dog with its next report.', 'Der Befehl erreicht den Hund bei seiner nächsten Meldung.', 'Příkaz dojde psovi při jeho nejbližším hlášení.', 'Kommandot når hunden vid nästa rapport.'],
  'Mapy Google': ['Google Maps', 'Google Maps', 'Mapy Google', 'Google Maps'],
  'Inna mapa': ['Other map', 'Andere Karte', 'Jiná mapa', 'Annan karta'],
  'Prowadź pieszo': ['Walk there', 'Zu Fuß hin', 'Navigovat pěšky', 'Gå dit'],
  'Mapy będą dostępne po pierwszej pozycji GPS psa (w budynku tracker zwykle jej nie łapie).': ['Maps become available after the dog\'s first GPS position (indoors the tracker usually gets none).', 'Karten sind nach der ersten GPS-Position des Hundes verfügbar (im Gebäude bekommt der Tracker meist keine).', 'Mapy budou k dispozici po první poloze GPS psa (v budově ji tracker obvykle nezachytí).', 'Kartor blir tillgängliga efter hundens första GPS-position (inomhus får spåraren oftast ingen).'],
  'Meldunki': ['Reports', 'Meldungen', 'Hlášení', 'Rapporter'],
  'Ustawienia': ['Settings', 'Einstellungen', 'Nastavení', 'Inställningar'],
  'Tracker (kontakt)': ['Tracker (contact)', 'Tracker (Kontakt)', 'Tracker (kontakt)', 'Spårare (kontakt)'],
  '– wybierz po połączeniu –': ['– choose after connecting –', '– nach dem Verbinden wählen –', '– vyber po připojení –', '– välj efter anslutning –'],
  '– wybierz –': ['– choose –', '– wählen –', '– vyber –', '– välj –'],
  'Język': ['Language', 'Sprache', 'Jazyk', 'Språk'],
  'Dźwięk i wibracja alarmu': ['Alarm sound and vibration', 'Alarmton und Vibration', 'Zvuk a vibrace poplachu', 'Larmljud och vibration'],
  'Zezwól na powiadomienia': ['Allow notifications', 'Benachrichtigungen erlauben', 'Povolit oznámení', 'Tillåt aviseringar'],
  'Powiadomienia:': ['Notifications:', 'Benachrichtigungen:', 'Oznámení:', 'Aviseringar:'],
  'Wyczyść ślad i meldunki': ['Clear track and reports', 'Spur und Meldungen löschen', 'Smazat stopu a hlášení', 'Rensa spår och rapporter'],
  'Usunąć zapisane meldunki i ślad?': ['Delete the saved reports and track?', 'Gespeicherte Meldungen und Spur löschen?', 'Smazat uložená hlášení a stopu?', 'Radera sparade rapporter och spår?'],
  'Rozłączyć z bazą?': ['Disconnect from the base?', 'Von der Basis trennen?', 'Odpojit od základny?', 'Koppla från basen?'],
  'Telefon może być połączony przez Bluetooth tylko z jedną aplikacją: na czas korzystania z tej strony rozłącz aplikację MeshCore. Strona działa bez internetu po pierwszym otwarciu (menu Chrome → „Dodaj do ekranu głównego”). Mapy Google i OsmAnd działają offline, jeśli pobrałeś wcześniej mapę obszaru.': [
    'The phone can be connected over Bluetooth to only one app: while using this page, disconnect the MeshCore app. The page works without internet after the first visit (Chrome menu → “Add to Home screen”). Google Maps and OsmAnd work offline if you downloaded the area map beforehand.',
    'Das Handy kann per Bluetooth nur mit einer App verbunden sein: Trenne die MeshCore-App, solange du diese Seite nutzt. Die Seite funktioniert nach dem ersten Öffnen ohne Internet (Chrome-Menü → „Zum Startbildschirm hinzufügen“). Google Maps und OsmAnd funktionieren offline, wenn du die Karte des Gebiets vorher heruntergeladen hast.',
    'Telefon může být přes Bluetooth připojen jen k jedné aplikaci: při používání této stránky odpoj aplikaci MeshCore. Stránka funguje bez internetu po prvním otevření (nabídka Chrome → „Přidat na plochu“). Mapy Google a OsmAnd fungují offline, pokud sis předem stáhl mapu oblasti.',
    'Telefonen kan bara vara ansluten via Bluetooth till en app: koppla från MeshCore-appen medan du använder den här sidan. Sidan fungerar utan internet efter första besöket (Chrome-menyn → ”Lägg till på startskärmen”). Google Maps och OsmAnd fungerar offline om du har laddat ner kartan över området i förväg.'],
  'Bezpieczeństwo: zmień domyślny PIN Bluetooth bazy i trackera (123456) na własny – w aplikacji MeshCore, w ustawieniach urządzenia. Ta strona nie wysyła niczego do internetu.': [
    'Security: change the default Bluetooth PIN of the base and the tracker (123456) to your own – in the MeshCore app, in the device settings. This page sends nothing to the internet.',
    'Sicherheit: Ändere die Standard-Bluetooth-PIN von Basis und Tracker (123456) auf eine eigene – in der MeshCore-App, in den Geräteeinstellungen. Diese Seite sendet nichts ins Internet.',
    'Bezpečnost: změň výchozí PIN Bluetooth základny a trackeru (123456) na vlastní – v aplikaci MeshCore, v nastavení zařízení. Tato stránka nic neposílá na internet.',
    'Säkerhet: byt standard-PIN för Bluetooth på basen och spåraren (123456) till en egen – i MeshCore-appen, i enhetsinställningarna. Den här sidan skickar ingenting till internet.'],
  'Ta przeglądarka nie obsługuje Bluetooth. Użyj Chrome na Androidzie.': ['This browser does not support Bluetooth. Use Chrome on Android.', 'Dieser Browser unterstützt kein Bluetooth. Nutze Chrome auf Android.', 'Tento prohlížeč nepodporuje Bluetooth. Použij Chrome na Androidu.', 'Den här webbläsaren stöder inte Bluetooth. Använd Chrome på Android.'],
  'Nie wybrano urządzenia.': ['No device selected.', 'Kein Gerät gewählt.', 'Nebylo vybráno žádné zařízení.', 'Ingen enhet vald.'],
  'Nie udało się połączyć:': ['Could not connect:', 'Verbindung fehlgeschlagen:', 'Nepodařilo se připojit:', 'Det gick inte att ansluta:'],
  'Łączenie z {name}…': ['Connecting to {name}…', 'Verbinde mit {name}…', 'Připojuji k {name}…', 'Ansluter till {name}…'],
  'Rozłączono z bazą – ponawiam połączenie…': ['Disconnected from the base – reconnecting…', 'Verbindung zur Basis getrennt – verbinde erneut…', 'Odpojeno od základny – znovu se připojuji…', 'Frånkopplad från basen – ansluter igen…'],
  'Połączono z bazą {name}.': ['Connected to the base {name}.', 'Mit der Basis {name} verbunden.', 'Připojeno k základně {name}.', 'Ansluten till basen {name}.'],
  'Polecenie „{c}” czeka w bazie na meldunek psa.': ['The command “{c}” is waiting in the base for the dog\'s report.', 'Der Befehl „{c}“ wartet in der Basis auf die Meldung des Hundes.', 'Příkaz „{c}“ čeká v základně na hlášení psa.', 'Kommandot ”{c}” väntar i basen på hundens rapport.'],
  'Pies przyjął polecenie „{c}”.': ['The dog accepted the command “{c}”.', 'Der Hund hat den Befehl „{c}“ angenommen.', 'Pes přijal příkaz „{c}“.', 'Hunden tog emot kommandot ”{c}”.'],
  'Baza odrzuciła polecenie (kod {c}).': ['The base rejected the command (code {c}).', 'Die Basis hat den Befehl abgelehnt (Code {c}).', 'Základna příkaz odmítla (kód {c}).', 'Basen avvisade kommandot (kod {c}).'],
  'Najpierw musi przyjść meldunek od psa (albo wybierz tracker w ustawieniach).': ['A report from the dog has to arrive first (or choose the tracker in the settings).', 'Zuerst muss eine Meldung vom Hund kommen (oder wähle den Tracker in den Einstellungen).', 'Nejdřív musí přijít hlášení od psa (nebo vyber tracker v nastavení).', 'Först måste en rapport komma från hunden (eller välj spåraren i inställningarna).'],
  'Najpierw połącz się z bazą.': ['Connect to the base first.', 'Verbinde dich zuerst mit der Basis.', 'Nejdřív se připoj k základně.', 'Anslut till basen först.'],
  'Wysyłanie „{c}” do bazy…': ['Sending “{c}” to the base…', 'Sende „{c}“ an die Basis…', 'Odesílám „{c}“ do základny…', 'Skickar ”{c}” till basen…'],
  'GPS telefonu:': ['Phone GPS:', 'GPS des Handys:', 'GPS telefonu:', 'Telefonens GPS:'],
  'tuż obok': ['right here', 'direkt nebenan', 'hned vedle', 'alldeles intill'],
  'czekam na GPS telefonu': ['waiting for the phone GPS', 'warte auf das GPS des Handys', 'čekám na GPS telefonu', 'väntar på telefonens GPS'],
  'pies bez fixu GPS': ['dog has no GPS fix', 'Hund ohne GPS-Fix', 'pes bez fixu GPS', 'hunden saknar GPS-fix'],
  'meldunek {a}': ['report {a}', 'Meldung {a}', 'hlášení {a}', 'rapport {a}'],
  'pozycja {a}': ['position {a}', 'Position {a}', 'poloha {a}', 'position {a}'],
  '{d} temu': ['{d} ago', 'vor {d}', 'před {d}', 'för {d} sedan'],
  'brak fixu': ['no fix', 'kein Fix', 'bez fixu', 'ingen fix'],
  'szukanie': ['search', 'Suche', 'hledání', 'sökning'],
  'zaraz': ['any moment', 'gleich', 'za chvíli', 'när som helst'],
  'spóźniony {d}': ['late by {d}', '{d} verspätet', 'zpoždění {d}', '{d} försenad'],
  'czekam na pozycję': ['waiting for a position', 'warte auf eine Position', 'čekám na polohu', 'väntar på en position'],
  'Brak meldunku od {n} min': ['No report for {n} min', 'Seit {n} min keine Meldung', 'Žádné hlášení {n} min', 'Ingen rapport på {n} min'],
  '(baza rozłączona!)': ['(base disconnected!)', '(Basis getrennt!)', '(základna odpojena!)', '(basen frånkopplad!)'],
  'Pokaz (dane przykładowe).': ['Demo (sample data).', 'Demo (Beispieldaten).', 'Ukázka (vzorová data).', 'Demo (exempeldata).'],
  'Wersja': ['Version', 'Version', 'Verze', 'Version'],
  'kod:': ['code:', 'Code:', 'kód:', 'kod:'],
  'północ': ['north', 'Norden', 'sever', 'norr'],
  'pn.-wsch.': ['north-east', 'Nordosten', 'severovýchod', 'nordost'],
  'wschód': ['east', 'Osten', 'východ', 'öster'],
  'pd.-wsch.': ['south-east', 'Südosten', 'jihovýchod', 'sydost'],
  'południe': ['south', 'Süden', 'jih', 'söder'],
  'pd.-zach.': ['south-west', 'Südwesten', 'jihozápad', 'sydväst'],
  'zachód': ['west', 'Westen', 'západ', 'väster'],
  'pn.-zach.': ['north-west', 'Nordwesten', 'severozápad', 'nordväst'],
  // trasa dnia
  'Trasa dnia': ['Route of the day', 'Tagesroute', 'Trasa dne', 'Dagens rutt'],
  'Poprzedni dzień': ['Previous day', 'Vorheriger Tag', 'Předchozí den', 'Föregående dag'],
  'Następny dzień': ['Next day', 'Nächster Tag', 'Následující den', 'Nästa dag'],
  'Dzień': ['Day', 'Tag', 'Den', 'Dag'],
  'Ślad psa z wybranego dnia': ['The dog’s track on the selected day', 'Spur des Hundes am gewählten Tag', 'Stopa psa ve vybraném dni', 'Hundens spår den valda dagen'],
  'Czas na trasie': ['Time on the route', 'Zeit auf der Route', 'Čas na trase', 'Tid på rutten'],
  'Brak zapisanych tras. Trasa zapisuje się sama z meldunków z pozycją GPS.': ['No saved routes yet. The route is saved automatically from reports with a GPS position.', 'Noch keine gespeicherten Routen. Die Route wird automatisch aus Meldungen mit GPS-Position gespeichert.', 'Zatím žádné uložené trasy. Trasa se ukládá sama z hlášení s polohou GPS.', 'Inga sparade rutter ännu. Rutten sparas automatiskt från rapporter med GPS-position.'],
  'Zapisz GPX': ['Save GPX', 'GPX speichern', 'Uložit GPX', 'Spara GPX'],
  'Usuń ten dzień': ['Delete this day', 'Diesen Tag löschen', 'Smazat tento den', 'Radera denna dag'],
  'Usunąć trasę z dnia {d}?': ['Delete the route from {d}?', 'Route vom {d} löschen?', 'Smazat trasu ze dne {d}?', 'Radera rutten från {d}?'],
  '{n} pkt': ['{n} pts', '{n} Pkt.', '{n} bodů', '{n} pkt'],
  'Pies': ['Dog', 'Hund', 'Pes', 'Hund'],
  // analizy (analiza.js)
  'Odtwórz trasę': ['Play the route', 'Route abspielen', 'Přehrát trasu', 'Spela upp rutten'],
  'Tempo odtwarzania': ['Playback speed', 'Wiedergabetempo', 'Rychlost přehrávání', 'Uppspelningshastighet'],
  'Wykres: bateria (linia) i prędkość (słupki)': ['Chart: battery (line) and speed (bars)', 'Diagramm: Akku (Linie) und Tempo (Balken)', 'Graf: baterie (čára) a rychlost (sloupce)', 'Diagram: batteri (linje) och hastighet (staplar)'],
  'Postój': ['Stop', 'Halt', 'Zastávka', 'Stopp'],
  'Przejście': ['Walk', 'Strecke', 'Přesun', 'Förflyttning'],
  'śr.': ['avg', 'Ø', 'prům.', 'medel'],
  'maks.': ['max', 'max.', 'max.', 'max'],
  'Strefy': ['Zones', 'Zonen', 'Zóny', 'Zoner'],
  'Strefa': ['Zone', 'Zone', 'Zóna', 'Zon'],
  'Dom': ['Home', 'Zuhause', 'Domov', 'Hem'],
  'Nazwa strefy': ['Zone name', 'Name der Zone', 'Název zóny', 'Zonens namn'],
  'Promień strefy': ['Zone radius', 'Radius der Zone', 'Poloměr zóny', 'Zonens radie'],
  'Środek strefy': ['Zone centre', 'Mittelpunkt der Zone', 'Střed zóny', 'Zonens mittpunkt'],
  'wokół psa': ['around the dog', 'um den Hund', 'kolem psa', 'runt hunden'],
  'wokół mnie': ['around me', 'um mich', 'kolem mě', 'runt mig'],
  'Dodaj strefę': ['Add zone', 'Zone hinzufügen', 'Přidat zónu', 'Lägg till zon'],
  'Alarm, gdy pies wyjdzie ze strefy (sprawdzane przy każdym meldunku).': ['Alarm when the dog leaves a zone (checked at every report).', 'Alarm, wenn der Hund eine Zone verlässt (bei jeder Meldung geprüft).', 'Poplach, když pes opustí zónu (kontroluje se při každém hlášení).', 'Larm när hunden lämnar en zon (kontrolleras vid varje rapport).'],
  'Brak stref. Dodaj strefę, a aplikacja zaalarmuje, gdy pies z niej wyjdzie.': ['No zones. Add one and the app will alarm when the dog leaves it.', 'Keine Zonen. Füge eine hinzu, dann alarmiert die App, wenn der Hund sie verlässt.', 'Žádné zóny. Přidej zónu a aplikace spustí poplach, když z ní pes odejde.', 'Inga zoner. Lägg till en så larmar appen när hunden lämnar den.'],
  'Strefa włączona': ['Zone enabled', 'Zone aktiv', 'Zóna zapnuta', 'Zon aktiverad'],
  'pies w strefie': ['dog inside', 'Hund drin', 'pes uvnitř', 'hunden innanför'],
  'pies poza strefą': ['dog outside', 'Hund draußen', 'pes venku', 'hunden utanför'],
  'Usuń strefę': ['Delete zone', 'Zone löschen', 'Smazat zónu', 'Radera zon'],
  'Usunąć strefę „{n}”?': ['Delete zone “{n}”?', 'Zone „{n}“ löschen?', 'Smazat zónu „{n}“?', 'Radera zonen ”{n}”?'],
  'Brak pozycji telefonu.': ['No phone position.', 'Keine Handyposition.', 'Žádná poloha telefonu.', 'Ingen telefonposition.'],
  'Brak pozycji psa.': ['No dog position.', 'Keine Position des Hundes.', 'Žádná poloha psa.', 'Ingen position för hunden.'],
  'Dodano strefę „{n}”.': ['Zone “{n}” added.', 'Zone „{n}“ hinzugefügt.', 'Zóna „{n}“ přidána.', 'Zonen ”{n}” tillagd.'],
  'Zdarzenia': ['Events', 'Ereignisse', 'Události', 'Händelser'],
  'Brak zdarzeń.': ['No events.', 'Keine Ereignisse.', 'Žádné události.', 'Inga händelser.'],
  'Wyczyść dziennik': ['Clear log', 'Protokoll leeren', 'Vymazat záznam', 'Rensa loggen'],
  'Wyczyścić dziennik zdarzeń?': ['Clear the event log?', 'Ereignisprotokoll leeren?', 'Vymazat záznam událostí?', 'Rensa händelseloggen?'],
  'Niska bateria trackera: {p}%': ['Tracker battery low: {p}%', 'Tracker-Akku schwach: {p}%', 'Slabá baterie trackeru: {p}%', 'Låg batterinivå i spåraren: {p}%'],
  'Tracker stracił GPS': ['Tracker lost GPS', 'Tracker hat GPS verloren', 'Tracker ztratil GPS', 'Spåraren tappade GPS'],
  'Szybki bieg: {v}': ['Running fast: {v}', 'Schnelles Laufen: {v}', 'Rychlý běh: {v}', 'Snabb löpning: {v}'],
  'Pies wrócił do strefy „{n}”': ['The dog is back in zone “{n}”', 'Der Hund ist zurück in Zone „{n}“', 'Pes se vrátil do zóny „{n}“', 'Hunden är tillbaka i zonen ”{n}”'],
  'Pies wyszedł ze strefy „{n}” ({d} od środka)': ['The dog left zone “{n}” ({d} from the centre)', 'Der Hund hat Zone „{n}“ verlassen ({d} vom Mittelpunkt)', 'Pes opustil zónu „{n}“ ({d} od středu)', 'Hunden lämnade zonen ”{n}” ({d} från mittpunkten)'],
  'Ostatnie dni': ['Recent days', 'Letzte Tage', 'Poslední dny', 'Senaste dagarna'],
  'Dystans psa w ostatnich dniach': ['The dog’s distance in recent days', 'Strecke des Hundes in den letzten Tagen', 'Vzdálenost psa v posledních dnech', 'Hundens sträcka de senaste dagarna'],
  'Brak danych.': ['No data.', 'Keine Daten.', 'Žádná data.', 'Inga data.'],
  '{n} dni · razem {d} · w ruchu {a}': ['{n} days · total {d} · moving {a}', '{n} Tage · gesamt {d} · in Bewegung {a}', '{n} dní · celkem {d} · v pohybu {a}', '{n} dagar · totalt {d} · i rörelse {a}'],
};

const DICT = {};
for (const [k, v] of Object.entries(T)) DICT[norm(k)] = v;
const IDX = { en: 0, de: 1, cs: 2, sv: 3 };

function t(s) {
  if (LANG === 'pl') return s;
  const v = DICT[norm(s)];
  return v ? v[IDX[LANG]] : s;
}
function tf(s, vals) {
  return t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
// liczba z przecinkiem dziesiętnym (pl, de, cs, sv) albo kropką (en)
function num(v, digits) {
  const s = Number(v).toFixed(digits);
  return LANG === 'en' ? s : s.replace('.', ',');
}

// napisy w HTML (tekst i atrybuty title/aria-label/data-confirm)
function applyLang(root) {
  document.documentElement.lang = LANG;
  if (LANG === 'pl') return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const k = norm(n.nodeValue);
    if (k && DICT[k]) n.nodeValue = n.nodeValue.replace(/\S[\s\S]*\S|\S/, t(k));
  }
  for (const el of root.querySelectorAll('[title],[aria-label],[data-confirm]')) {
    for (const a of ['title', 'aria-label', 'data-confirm']) {
      const v = el.getAttribute(a);
      if (v && DICT[norm(v)]) el.setAttribute(a, t(v));
    }
  }
  document.title = t(document.title);
}
