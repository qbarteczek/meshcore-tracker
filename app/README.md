# Tracker psa – aplikacja w przeglądarce

Strona-aplikacja dla bazy polowej (firmware `Xiao_nrf52_tracker_base`): **Chrome na Androidzie**, połączenie
z bazą przez Web Bluetooth, **działa bez internetu** po pierwszym otwarciu. Opublikowana pod
<https://qbart.waw.pl/tracker/> – wersja stabilna (tag `app-stable`), a bieżąca z `main` jako beta pod
<https://qbart.waw.pl/tracker/beta/> (pokaz bez urządzeń: `#demo`). Awans bety: `git tag -f app-stable main`.

Układ jak w Traccarze (dolne zakładki), wszystko w telefonie, bez serwera:

- **Mapa** – podkład OpenStreetMap (Leaflet 1.9.4 w `vendor/`, licencja BSD-2), pies ze strzałką kierunku ruchu,
  ślad psa i Twój z ostatnich 24 h, klikane punkty meldunków, przyciski „pokaż psa / mnie / wszystko”, „Śledź psa”;
  pod mapą **karta psa** (status na czas / spóźniony, bateria, prędkość, GPS, temperatura, odstęp, następny meldunek,
  strefy, dystans dziś, pozycja), **polecenia** i **strefy** (kilka nazwanych okręgów 50 m–2 km wokół psa,
  Ciebie albo środka mapy, np. „Obóz”; wyjście psa = alarm, powrót = zdarzenie),
- **Trasa** – historia bez limitu w IndexedDB telefonu, po dniach; okres: ostatnia godzina, 6 h, dziś, wczoraj,
  dowolny dzień, cała historia; **odtwarzanie** na mapie (suwak, ▶, ½–10×), **wykres** baterii (linia) i prędkości
  (słupki), **raport** (dystans, czas, w ruchu, średnia i najwyższa prędkość, najdalej od startu, postoje, bateria),
  lista **przejść i postojów** (postój: ≥ 5 min w promieniu 40 m; dotknięcie pokazuje odcinek na mapie),
  **ostatnie dni** (dystans z 14 dni, czas w ruchu), eksport **GPX / KML / CSV** (na Androidzie przez „Udostępnij”),
  usuwanie dnia,
- **Radar** – pies względem telefonu (GPS i kompas telefonu): odległość, kierunek, ślad psa i Twój,
  skala dobierana sama; „północ u góry” albo „kierunek patrzenia u góry”,
- **przyciski** zamiast wpisywania poleceń: Szukaj, Znaleziony, co 1 / 2 / 5 min, Bluetooth psa, Koniec wędrówki;
  przycisk świeci, dopóki tracker nie potwierdzi polecenia,
- **alarm** (dźwięk, wibracja, powiadomienie), gdy przez 2 odstępy + 1 min nie ma meldunku albo baza zgłosi brak,
- **Zdarzenia** – jak w Traccarze: wyjście i powrót do strefy, niska bateria trackera (≤ 20%), utrata GPS,
  szybki bieg (≥ 15 km/h), brak meldunku, powrót kontaktu, szukanie, polecenia, połączenie z bazą; filtr Alarmy,
  lista meldunków, dotknięcie pokazuje miejsce na mapie; licznik nowych alarmów na zakładce,
- przyciski **Organic Maps / Mapy Google / Inna mapa / Prowadź pieszo** (w zakładce Radar) – pozycja psa w aplikacji mapowej (offline
  działa, jeśli wcześniej pobrałeś mapę obszaru); aktywne po pierwszej pozycji GPS psa,

Analizy (`analiza.js`) są wzorowane na raportach Traccara (Replay, Trips, Stops, Chart, Geofences, Events, Summary)
i liczone w telefonie – bez serwera i bez internetu.

Języki: polski, angielski, niemiecki, czeski i szwedzki (`lang.js`, wbudowane – działa offline). Język wybiera się
sam według ustawień telefonu; można go zmienić w Ustawieniach. Teksty meldunków na liście przychodzą z firmware bazy
i są po polsku.

## Pierwsze uruchomienie (w domu, z internetem)

1. Otwórz w Chrome `https://qbart.waw.pl/tracker/`, menu ⋮ → **Dodaj do ekranu głównego** (zainstaluj).
2. Zezwól na lokalizację; w ustawieniach strony „Zezwól na powiadomienia”.
3. Rozłącz aplikację MeshCore od bazy (Bluetooth przyjmuje jedną aplikację naraz), dotknij **Połącz z bazą**,
   wybierz `MeshCore-<nazwa bazy>` i wpisz PIN Bluetooth bazy (domyślny `123456` – **zmień go na własny**
   w aplikacji MeshCore, w ustawieniach urządzenia; domyślny PIN jest publiczny).
4. Tracker ustawia się sam przy pierwszym meldunku (albo w Ustawieniach → Tracker).

**Internet jest potrzebny tylko do tego pierwszego otwarcia.** Potem aplikacja uruchamia się z pamięci telefonu,
a łączność idzie bez sieci komórkowej: pies → radio LoRa → baza → Bluetooth → telefon; pozycja z GPS telefonu.
Sprawdzenie przed wyjazdem: tryb samolotowy, z powrotem włącz Bluetooth i lokalizację, uruchom z ikony, połącz z bazą.

Na trasie: otwórz aplikację z ekranu głównego i „Połącz z bazą”. Najpewniej działa przy włączonym ekranie
(„Ekran: zawsze włączony”) – Android może usypiać Bluetooth stron w tle.

## Jak to działa

Protokół companiona MeshCore przez Nordic UART (`6e400001-…`): `DEVICE_QUERY`, `APP_START`, ustawienie zegara
bazy z telefonu, lista kontaktów, pobieranie wiadomości (`SYNC_NEXT_MESSAGE` po `PUSH_CODE_MSG_WAITING`).
Meldunki to czytelne wiadomości, które baza tworzy z `#T1` (zob. `TrackerBase.cpp`); strona czyta z nich pozycję
(link `?q=lat,lon`), baterię, odstęp i flagi. Przyciski wysyłają wiadomość tekstową do kontaktu trackera
(`#SZUKAJ`, `#STOP`, `#CO n`, `#BT`, `#DOM`) – baza trzyma ją do najbliższego meldunku, a potwierdzenie
doręczenia (`PUSH_CODE_SEND_CONFIRMED`) gasi podświetlenie przycisku.

Aktualizacja: przy zmianie podbij `CACHE` w `sw.js` oraz `VERSION` i `?v=` w `index.html`. Instalator pobiera pliki
z pominięciem pamięci przeglądarki (Cloudflare daje plikom `.js` `max-age=14400`), a strona przeładowuje się sama,
gdy nowa wersja przejmie kontrolę.

Pliki: `index.html`, `app.css`, `app.js`, `analiza.js`, `lang.js`, `sw.js` (offline), `manifest.webmanifest`, ikony,
`vendor/leaflet.*`. Jedyne żądania do internetu to kafelki mapy z `tile.openstreetmap.org` – `sw.js` zapisuje każdy
obejrzany kafelek w osobnej pamięci (`tracker-psa-tiles`, do 6000 kafelków, nie znika przy aktualizacji aplikacji).
Hurtowego pobierania obszaru nie ma celowo: zasady serwera kafelków OSM go zabraniają. Dane: pozycje psa po dniach
w IndexedDB `tracker-psa` (bez limitu), ostatnie 3000 meldunków, zdarzenia (500) i strefy w `localStorage`.
Serwer musi zezwalać na `geolocation` i `bluetooth` w nagłówku Permissions-Policy, a CSP na
`https://tile.openstreetmap.org` w `img-src` i `connect-src`.
