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
  'Rozłączyć z bazą?': ['Disconnect from the base?', 'Von der Basis trennen?', 'Odpojit od základny?', 'Koppla från basen?'],
  'Telefon może być połączony przez Bluetooth tylko z jedną aplikacją: na czas korzystania z tej strony rozłącz aplikację MeshCore. Strona działa bez internetu po pierwszym otwarciu (menu Chrome → „Dodaj do ekranu głównego”). Mapy Google i OsmAnd działają offline, jeśli pobrałeś wcześniej mapę obszaru.': [
    'The phone can be connected over Bluetooth to only one app: while using this page, disconnect the MeshCore app. The page works without internet after the first visit (Chrome menu → “Add to Home screen”). Google Maps and OsmAnd work offline if you downloaded the area map beforehand.',
    'Das Handy kann per Bluetooth nur mit einer App verbunden sein: Trenne die MeshCore-App, solange du diese Seite nutzt. Die Seite funktioniert nach dem ersten Öffnen ohne Internet (Chrome-Menü → „Zum Startbildschirm hinzufügen“). Google Maps und OsmAnd funktionieren offline, wenn du die Karte des Gebiets vorher heruntergeladen hast.',
    'Telefon může být přes Bluetooth připojen jen k jedné aplikaci: při používání této stránky odpoj aplikaci MeshCore. Stránka funguje bez internetu po prvním otevření (nabídka Chrome → „Přidat na plochu“). Mapy Google a OsmAnd fungují offline, pokud sis předem stáhl mapu oblasti.',
    'Telefonen kan bara vara ansluten via Bluetooth till en app: koppla från MeshCore-appen medan du använder den här sidan. Sidan fungerar utan internet efter första besöket (Chrome-menyn → ”Lägg till på startskärmen”). Google Maps och OsmAnd fungerar offline om du har laddat ner kartan över området i förväg.'],
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
  // --- v8: widoki jak w Traccarze (mapa, trasa, strefa, zdarzenia)
  'Mapa': ['Map', 'Karte', 'Mapa', 'Karta'],
  'Trasa': ['Route', 'Route', 'Trasa', 'Rutt'],
  'Radar': ['Radar', 'Radar', 'Radar', 'Radar'],
  'Zdarzenia': ['Events', 'Ereignisse', 'Události', 'Händelser'],
  'Widoki': ['Views', 'Ansichten', 'Zobrazení', 'Vyer'],
  'Pokaż psa': ['Show the dog', 'Hund zeigen', 'Ukázat psa', 'Visa hunden'],
  'Pokaż mnie': ['Show me', 'Mich zeigen', 'Ukázat mě', 'Visa mig'],
  'Pokaż wszystko': ['Show everything', 'Alles zeigen', 'Ukázat vše', 'Visa allt'],
  'Śledź psa': ['Follow the dog', 'Hund folgen', 'Sledovat psa', 'Följ hunden'],
  'Śledzę psa': ['Following the dog', 'Folge dem Hund', 'Sleduji psa', 'Följer hunden'],
  'Pies': ['Dog', 'Hund', 'Pes', 'Hund'],
  'brak danych': ['no data', 'keine Daten', 'žádná data', 'inga data'],
  'Odległość': ['Distance', 'Entfernung', 'Vzdálenost', 'Avstånd'],
  'Kierunek': ['Direction', 'Richtung', 'Směr', 'Riktning'],
  'Prędkość': ['Speed', 'Geschwindigkeit', 'Rychlost', 'Hastighet'],
  'Bateria': ['Battery', 'Akku', 'Baterie', 'Batteri'],
  'bateria': ['battery', 'Akku', 'baterie', 'batteri'],
  'Temperatura': ['Temperature', 'Temperatur', 'Teplota', 'Temperatur'],
  'Strefa': ['Zone', 'Zone', 'Zóna', 'Zon'],
  'wyłączona': ['off', 'aus', 'vypnuta', 'av'],
  'Dziś przebiegł': ['Covered today', 'Heute gelaufen', 'Dnes uběhl', 'Sprungit i dag'],
  'Pozycja': ['Position', 'Position', 'Poloha', 'Position'],
  'Polecenia': ['Commands', 'Befehle', 'Příkazy', 'Kommandon'],
  'Strefa bezpieczna': ['Safe zone', 'Sichere Zone', 'Bezpečná zóna', 'Säker zon'],
  'Alarm, gdy pies wyjdzie poza okrąg (jak strefy w Traccarze). Środek: Ty, pies albo środek mapy (np. obóz).': [
    'Alarm when the dog leaves the circle (like geofences in Traccar). Centre: you, the dog or the map centre (e.g. the camp).',
    'Alarm, wenn der Hund den Kreis verlässt (wie Geofences in Traccar). Mitte: du, der Hund oder die Kartenmitte (z. B. das Lager).',
    'Poplach, když pes opustí kruh (jako zóny v Traccaru). Střed: ty, pes nebo střed mapy (např. tábor).',
    'Larm när hunden lämnar cirkeln (som geofences i Traccar). Mitten: du, hunden eller kartans mitt (t.ex. lägret).'],
  'Promień': ['Radius', 'Radius', 'Poloměr', 'Radie'],
  'Wokół mnie': ['Around me', 'Um mich', 'Kolem mě', 'Runt mig'],
  'Wokół psa': ['Around the dog', 'Um den Hund', 'Kolem psa', 'Runt hunden'],
  'Środek mapy': ['Map centre', 'Kartenmitte', 'Střed mapy', 'Kartans mitt'],
  'Wyłącz': ['Turn off', 'Ausschalten', 'Vypnout', 'Stäng av'],
  'Okres': ['Period', 'Zeitraum', 'Období', 'Period'],
  'Ostatnia godzina': ['Last hour', 'Letzte Stunde', 'Poslední hodina', 'Senaste timmen'],
  'Ostatnie 6 h': ['Last 6 h', 'Letzte 6 h', 'Posledních 6 h', 'Senaste 6 h'],
  'Dziś': ['Today', 'Heute', 'Dnes', 'I dag'],
  'Wczoraj': ['Yesterday', 'Gestern', 'Včera', 'I går'],
  'Cała historia': ['All history', 'Gesamter Verlauf', 'Celá historie', 'Hela historiken'],
  'Pozycja na trasie': ['Position on the route', 'Position auf der Route', 'Poloha na trase', 'Position på rutten'],
  'Szybkość odtwarzania': ['Playback speed', 'Wiedergabetempo', 'Rychlost přehrávání', 'Uppspelningshastighet'],
  'Brak pozycji w tym okresie.': ['No positions in this period.', 'Keine Positionen in diesem Zeitraum.', 'V tomto období nejsou žádné polohy.', 'Inga positioner under den här perioden.'],
  'Raport trasy': ['Route report', 'Routenbericht', 'Zpráva o trase', 'Ruttrapport'],
  'Dystans': ['Distance', 'Strecke', 'Vzdálenost', 'Sträcka'],
  'Czas': ['Time', 'Dauer', 'Čas', 'Tid'],
  'W ruchu': ['Moving', 'In Bewegung', 'V pohybu', 'I rörelse'],
  'Średnia w ruchu': ['Average moving', 'Schnitt in Bewegung', 'Průměr v pohybu', 'Snitt i rörelse'],
  'Najszybciej': ['Top speed', 'Höchstens', 'Nejrychleji', 'Högsta fart'],
  'Najdalej od startu': ['Farthest from start', 'Am weitesten vom Start', 'Nejdál od startu', 'Längst från start'],
  'Postoje': ['Stops', 'Stopps', 'Zastávky', 'Stopp'],
  'Postoje (co najmniej 5 min)': ['Stops (at least 5 min)', 'Stopps (mindestens 5 min)', 'Zastávky (nejméně 5 min)', 'Stopp (minst 5 min)'],
  'Postój': ['Stop', 'Stopp', 'Zastávka', 'Stopp'],
  'Brak postojów.': ['No stops.', 'Keine Stopps.', 'Žádné zastávky.', 'Inga stopp.'],
  'Zapisz GPX': ['Save GPX', 'GPX speichern', 'Uložit GPX', 'Spara GPX'],
  'Zapisz CSV': ['Save CSV', 'CSV speichern', 'Uložit CSV', 'Spara CSV'],
  'GPX otworzysz w Organic Maps, OsmAnd, Mapach Google (Moje mapy) albo zaimportujesz później do innych programów.': [
    'You can open the GPX in Organic Maps, OsmAnd or Google My Maps, or import it into other programs later.',
    'Das GPX öffnest du in Organic Maps, OsmAnd oder Google My Maps oder importierst es später in andere Programme.',
    'GPX otevřeš v Organic Maps, OsmAnd nebo Google Moje mapy, případně ho později importuješ do jiných programů.',
    'GPX-filen kan du öppna i Organic Maps, OsmAnd eller Google My Maps, eller importera i andra program senare.'],
  'Alarmy': ['Alarms', 'Alarme', 'Poplachy', 'Larm'],
  'Brak zdarzeń.': ['No events.', 'Keine Ereignisse.', 'Žádné události.', 'Inga händelser.'],
  'Nazwa psa na mapie': ['Dog name on the map', 'Name des Hundes auf der Karte', 'Jméno psa na mapě', 'Hundens namn på kartan'],
  'Ostrzegaj o słabej baterii psa (20%)': ['Warn about the dog\'s low battery (20%)', 'Vor schwachem Akku des Hundes warnen (20 %)', 'Upozornit na slabou baterii psa (20 %)', 'Varna för låg batterinivå hos hunden (20 %)'],
  'Mapa offline': ['Offline map', 'Offline-Karte', 'Offline mapa', 'Offlinekarta'],
  'Podkład mapy pochodzi z OpenStreetMap. Każdy obejrzany fragment mapy zostaje w telefonie: przed wyjazdem, z internetem, przejrzyj okolicę wędrówki w kilku powiększeniach (ogólnie i z bliska). Bez internetu mapa pokaże zapisane fragmenty, a trasa psa i strefa rysują się zawsze, także na pustym tle.': [
    'The base map comes from OpenStreetMap. Every part of the map you view stays on the phone: before leaving, with internet, look over the hiking area at several zoom levels (overview and close up). Without internet the map shows the saved parts, and the dog\'s route and the zone are always drawn, even on an empty background.',
    'Die Grundkarte stammt von OpenStreetMap. Jeder angesehene Kartenausschnitt bleibt auf dem Handy: Sieh dir vor der Abfahrt mit Internet das Wandergebiet in mehreren Zoomstufen an (Übersicht und nah). Ohne Internet zeigt die Karte die gespeicherten Ausschnitte; Route des Hundes und Zone werden immer gezeichnet, auch auf leerem Hintergrund.',
    'Podkladová mapa je z OpenStreetMap. Každá prohlédnutá část mapy zůstane v telefonu: před odjezdem s internetem si prohlédni oblast túry v několika přiblíženích (celkově i zblízka). Bez internetu mapa ukáže uložené části a trasa psa i zóna se kreslí vždy, i na prázdném pozadí.',
    'Bakgrundskartan kommer från OpenStreetMap. Varje del av kartan du tittar på sparas i telefonen: titta före avresan, med internet, igenom vandringsområdet i flera zoomnivåer (översikt och nära). Utan internet visar kartan de sparade delarna, och hundens rutt och zonen ritas alltid, även på tom bakgrund.'],
  'Usuń zapisaną mapę': ['Delete the saved map', 'Gespeicherte Karte löschen', 'Smazat uloženou mapu', 'Radera den sparade kartan'],
  'Dane': ['Data', 'Daten', 'Data', 'Data'],
  'Wyczyść ślad, meldunki i zdarzenia': ['Clear track, reports and events', 'Spur, Meldungen und Ereignisse löschen', 'Smazat stopu, hlášení a události', 'Rensa spår, rapporter och händelser'],
  'Usunąć zapisane meldunki, ślad i zdarzenia?': ['Delete the saved reports, track and events?', 'Gespeicherte Meldungen, Spur und Ereignisse löschen?', 'Smazat uložená hlášení, stopu a události?', 'Radera sparade rapporter, spår och händelser?'],
  'Bezpieczeństwo: zmień domyślny PIN Bluetooth bazy i trackera (123456) na własny – w aplikacji MeshCore, w ustawieniach urządzenia. Strona nie wysyła danych psa do internetu; pobiera tylko kafelki mapy.': [
    'Security: change the default Bluetooth PIN of the base and the tracker (123456) to your own – in the MeshCore app, in the device settings. The page sends no dog data to the internet; it only downloads map tiles.',
    'Sicherheit: Ändere die Standard-Bluetooth-PIN von Basis und Tracker (123456) auf eine eigene – in der MeshCore-App, in den Geräteeinstellungen. Die Seite sendet keine Hundedaten ins Internet; sie lädt nur Kartenkacheln.',
    'Bezpečnost: změň výchozí PIN Bluetooth základny a trackeru (123456) na vlastní – v aplikaci MeshCore, v nastavení zařízení. Stránka neposílá data psa na internet; stahuje jen dlaždice mapy.',
    'Säkerhet: byt standard-PIN för Bluetooth på basen och spåraren (123456) till en egen – i MeshCore-appen, i enhetsinställningarna. Sidan skickar inga hunddata till internet; den hämtar bara kartrutor.'],
  'Rozłączono z bazą': ['Disconnected from the base', 'Von der Basis getrennt', 'Odpojeno od základny', 'Frånkopplad från basen'],
  'Kontakt z psem wrócił': ['Contact with the dog is back', 'Kontakt zum Hund wieder da', 'Spojení se psem je zpět', 'Kontakten med hunden är tillbaka'],
  'Szukanie włączone (meldunek co 30 s)': ['Search on (report every 30 s)', 'Suche an (Meldung alle 30 s)', 'Hledání zapnuto (hlášení každých 30 s)', 'Sökning på (rapport var 30:e s)'],
  'Szukanie zakończone': ['Search ended', 'Suche beendet', 'Hledání ukončeno', 'Sökningen avslutad'],
  'Słaba bateria psa: {p}%': ['Dog battery low: {p}%', 'Akku des Hundes schwach: {p} %', 'Slabá baterie psa: {p} %', 'Låg batterinivå hos hunden: {p} %'],
  'Pies poza strefą: {d} od środka': ['Dog outside the zone: {d} from the centre', 'Hund außerhalb der Zone: {d} von der Mitte', 'Pes mimo zónu: {d} od středu', 'Hunden utanför zonen: {d} från mitten'],
  'Pies wrócił do strefy': ['The dog is back in the zone', 'Der Hund ist zurück in der Zone', 'Pes se vrátil do zóny', 'Hunden är tillbaka i zonen'],
  'Strefa wyłączona': ['Zone turned off', 'Zone ausgeschaltet', 'Zóna vypnuta', 'Zonen avstängd'],
  'Strefa {r} ustawiona': ['Zone {r} set', 'Zone {r} gesetzt', 'Zóna {r} nastavena', 'Zon {r} inställd'],
  'Mapa niedostępna.': ['Map unavailable.', 'Karte nicht verfügbar.', 'Mapa není k dispozici.', 'Kartan är inte tillgänglig.'],
  'Od Ciebie': ['From you', 'Von dir', 'Od tebe', 'Från dig'],
  '{n} pozycji': ['{n} positions', '{n} Positionen', '{n} poloh', '{n} positioner'],
  'od startu': ['from start', 'vom Start', 'od startu', 'från start'],
  'meldunki na czas': ['reports on time', 'Meldungen pünktlich', 'hlášení včas', 'rapporter i tid'],
  'baza rozłączona': ['base disconnected', 'Basis getrennt', 'základna odpojena', 'basen frånkopplad'],
  'spóźniony meldunek': ['report overdue', 'Meldung überfällig', 'hlášení se zpožďuje', 'rapporten försenad'],
  'w strefie': ['in the zone', 'in der Zone', 'v zóně', 'i zonen'],
  'POZA strefą': ['OUTSIDE the zone', 'AUSSERHALB der Zone', 'MIMO zónu', 'UTANFÖR zonen'],
  'strefa {r}': ['zone {r}', 'Zone {r}', 'zóna {r}', 'zon {r}'],
  'W telefonie: {n} meldunków, {e} zdarzeń, ok. {kb} kB.': ['On the phone: {n} reports, {e} events, about {kb} kB.', 'Auf dem Handy: {n} Meldungen, {e} Ereignisse, ca. {kb} kB.', 'V telefonu: {n} hlášení, {e} událostí, asi {kb} kB.', 'I telefonen: {n} rapporter, {e} händelser, cirka {kb} kB.'],
  'Od {d}.': ['Since {d}.', 'Seit {d}.', 'Od {d}.', 'Sedan {d}.'],
  'Zapisane fragmenty mapy: {n}.': ['Saved map tiles: {n}.', 'Gespeicherte Kartenkacheln: {n}.', 'Uložené dlaždice mapy: {n}.', 'Sparade kartrutor: {n}.'],
  'Brak pozycji GPS telefonu.': ['No phone GPS position.', 'Keine GPS-Position des Handys.', 'Žádná poloha GPS telefonu.', 'Ingen GPS-position från telefonen.'],
  'Brak pozycji psa.': ['No dog position.', 'Keine Position des Hundes.', 'Žádná poloha psa.', 'Ingen position för hunden.'],
  'Usunąć zapisane fragmenty mapy? Bez internetu mapa będzie pusta.': ['Delete the saved map tiles? Without internet the map will be empty.', 'Gespeicherte Kartenkacheln löschen? Ohne Internet bleibt die Karte leer.', 'Smazat uložené dlaždice mapy? Bez internetu bude mapa prázdná.', 'Radera sparade kartrutor? Utan internet blir kartan tom.'],
  // --- v10: analizy z bety (trasa dnia, strefy, zdarzenia, statystyki)
  'Wyczyść ślad i meldunki': ['Clear track and reports', 'Spur und Meldungen löschen', 'Smazat stopu a hlášení', 'Rensa spår och rapporter'],
  'Usunąć zapisane meldunki i ślad?': ['Delete the saved reports and track?', 'Gespeicherte Meldungen und Spur löschen?', 'Smazat uložená hlášení a stopu?', 'Radera sparade rapporter och spår?'],
  'Bezpieczeństwo: zmień domyślny PIN Bluetooth bazy i trackera (123456) na własny – w aplikacji MeshCore, w ustawieniach urządzenia. Ta strona nie wysyła niczego do internetu.': ['Security: change the default Bluetooth PIN of the base and the tracker (123456) to your own – in the MeshCore app, in the device settings. This page sends nothing to the internet.', 'Sicherheit: Ändere die Standard-Bluetooth-PIN von Basis und Tracker (123456) auf eine eigene – in der MeshCore-App, in den Geräteeinstellungen. Diese Seite sendet nichts ins Internet.', 'Bezpečnost: změň výchozí PIN Bluetooth základny a trackeru (123456) na vlastní – v aplikaci MeshCore, v nastavení zařízení. Tato stránka nic neposílá na internet.', 'Säkerhet: byt standard-PIN för Bluetooth på basen och spåraren (123456) till en egen – i MeshCore-appen, i enhetsinställningarna. Den här sidan skickar ingenting till internet.'],
  'Trasa dnia': ['Route of the day', 'Tagesroute', 'Trasa dne', 'Dagens rutt'],
  'Poprzedni dzień': ['Previous day', 'Vorheriger Tag', 'Předchozí den', 'Föregående dag'],
  'Następny dzień': ['Next day', 'Nächster Tag', 'Následující den', 'Nästa dag'],
  'Dzień': ['Day', 'Tag', 'Den', 'Dag'],
  'Ślad psa z wybranego dnia': ['The dog’s track on the selected day', 'Spur des Hundes am gewählten Tag', 'Stopa psa ve vybraném dni', 'Hundens spår den valda dagen'],
  'Czas na trasie': ['Time on the route', 'Zeit auf der Route', 'Čas na trase', 'Tid på rutten'],
  'Brak zapisanych tras. Trasa zapisuje się sama z meldunków z pozycją GPS.': ['No saved routes yet. The route is saved automatically from reports with a GPS position.', 'Noch keine gespeicherten Routen. Die Route wird automatisch aus Meldungen mit GPS-Position gespeichert.', 'Zatím žádné uložené trasy. Trasa se ukládá sama z hlášení s polohou GPS.', 'Inga sparade rutter ännu. Rutten sparas automatiskt från rapporter med GPS-position.'],
  'Usuń ten dzień': ['Delete this day', 'Diesen Tag löschen', 'Smazat tento den', 'Radera denna dag'],
  'Usunąć trasę z dnia {d}?': ['Delete the route from {d}?', 'Route vom {d} löschen?', 'Smazat trasu ze dne {d}?', 'Radera rutten från {d}?'],
  '{n} pkt': ['{n} pts', '{n} Pkt.', '{n} bodů', '{n} pkt'],
  'Odtwórz trasę': ['Play the route', 'Route abspielen', 'Přehrát trasu', 'Spela upp rutten'],
  'Tempo odtwarzania': ['Playback speed', 'Wiedergabetempo', 'Rychlost přehrávání', 'Uppspelningshastighet'],
  'Wykres: bateria (linia) i prędkość (słupki)': ['Chart: battery (line) and speed (bars)', 'Diagramm: Akku (Linie) und Tempo (Balken)', 'Graf: baterie (čára) a rychlost (sloupce)', 'Diagram: batteri (linje) och hastighet (staplar)'],
  'Przejście': ['Walk', 'Strecke', 'Přesun', 'Förflyttning'],
  'śr.': ['avg', 'Ø', 'prům.', 'medel'],
  'maks.': ['max', 'max.', 'max.', 'max'],
  'Strefy': ['Zones', 'Zonen', 'Zóny', 'Zoner'],
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
  'Dodano strefę „{n}”.': ['Zone “{n}” added.', 'Zone „{n}“ hinzugefügt.', 'Zóna „{n}“ přidána.', 'Zonen ”{n}” tillagd.'],
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
  'Start': ['Start', 'Start', 'Start', 'Start'],
  'Przejścia i postoje': ['Walks and stops', 'Strecken und Stopps', 'Přesuny a zastávky', 'Förflyttningar och stopp'],
  'Brak przejść i postojów.': ['No walks or stops.', 'Keine Strecken oder Stopps.', 'Žádné přesuny ani zastávky.', 'Inga förflyttningar eller stopp.'],
  'brak stref': ['no zones', 'keine Zonen', 'žádné zóny', 'inga zoner'],
  'Obóz': ['Camp', 'Lager', 'Tábor', 'Läger'],
  'środek mapy': ['map centre', 'Kartenmitte', 'střed mapy', 'kartans mitt'],
  'Nazwa, np. Obóz': ['Name, e.g. Camp', 'Name, z. B. Lager', 'Název, např. Tábor', 'Namn, t.ex. Läger'],
  'Plik otworzysz przez „Udostępnij” w Organic Maps, OsmAnd albo Google Earth, albo zaimportujesz później do innych programów.': ['Open the file via “Share” in Organic Maps, OsmAnd or Google Earth, or import it into other programs later.', 'Öffne die Datei über „Teilen“ in Organic Maps, OsmAnd oder Google Earth oder importiere sie später in andere Programme.', 'Soubor otevřeš přes „Sdílet“ v Organic Maps, OsmAnd nebo Google Earth, případně ho později importuješ do jiných programů.', 'Öppna filen via ”Dela” i Organic Maps, OsmAnd eller Google Earth, eller importera den i andra program senare.'],
  'Historia tras: {d} dni, {p} pozycji.': ['Route history: {d} days, {p} positions.', 'Routenverlauf: {d} Tage, {p} Positionen.', 'Historie tras: {d} dní, {p} poloh.', 'Rutthistorik: {d} dagar, {p} positioner.'],
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
  for (const el of root.querySelectorAll('[title],[aria-label],[data-confirm],[placeholder]')) {
    for (const a of ['title', 'aria-label', 'data-confirm', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && DICT[norm(v)]) el.setAttribute(a, t(v));
    }
  }
  document.title = t(document.title);
}
