# Tracker psa – aplikacja w przeglądarce

Strona-aplikacja dla bazy polowej (firmware `Xiao_nrf52_tracker_base`): **Chrome na Androidzie**, połączenie
z bazą przez Web Bluetooth, **działa bez internetu** po pierwszym otwarciu. Opublikowana pod
<https://qbart.waw.pl/tracker/> (pokaz bez urządzeń: `#demo`).

Układ jak w Traccarze (dolne zakładki), wszystko w telefonie, bez serwera:

- **Mapa** – podkład OpenStreetMap (Leaflet 1.9.4 w `vendor/`, licencja BSD-2), pies ze strzałką kierunku ruchu,
  ślad psa i Twój z ostatnich 24 h, klikane punkty meldunków, przyciski „pokaż psa / mnie / wszystko”, „Śledź psa”;
  pod mapą **karta psa** (status na czas / spóźniony, bateria, prędkość, GPS, temperatura, odstęp, następny meldunek,
  strefa, dystans dziś, pozycja), **polecenia** i **strefa bezpieczna** (okrąg wokół Ciebie, psa albo środka mapy;
  wyjście psa poza strefę = alarm),
- **Trasa** – odtwarzanie (ostatnia godzina, 6 h, dziś, wczoraj, dowolny dzień, cała historia; suwak, ▶, 1–30×),
  **raport**: dystans, czas, czas w ruchu, średnia i najwyższa prędkość, najdalej od startu, postoje (≥ 5 min
  w promieniu 40 m), bateria; zapis **GPX** i **CSV** (działa bez internetu),
- **Radar** – pies względem telefonu (GPS i kompas telefonu): odległość, kierunek, ślad psa i Twój,
  skala dobierana sama; „północ u góry” albo „kierunek patrzenia u góry”,
- **przyciski** zamiast wpisywania poleceń: Szukaj, Znaleziony, co 1 / 2 / 5 min, Bluetooth psa, Koniec wędrówki;
  przycisk świeci, dopóki tracker nie potwierdzi polecenia,
- **alarm** (dźwięk, wibracja, powiadomienie), gdy przez 2 odstępy + 1 min nie ma meldunku albo baza zgłosi brak,
- **Zdarzenia** – jak w Traccarze: alarmy, wyjście i powrót do strefy, słaba bateria (20%), szukanie, brak meldunku,
  powrót kontaktu, połączenie z bazą; filtr Alarmy, lista meldunków; licznik nowych alarmów na zakładce,
- przyciski **Organic Maps / Mapy Google / Inna mapa / Prowadź pieszo** (w zakładce Radar) – pozycja psa w aplikacji mapowej (offline
  działa, jeśli wcześniej pobrałeś mapę obszaru); aktywne po pierwszej pozycji GPS psa,
- bateria i GPS psa, odstęp meldunków, czas do następnego, lista meldunków; ślad zapisany w telefonie.

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

Pliki: `index.html`, `app.css`, `app.js`, `lang.js`, `sw.js` (offline), `manifest.webmanifest`, ikony,
`vendor/leaflet.*`. Jedyne żądania do internetu to kafelki mapy z `tile.openstreetmap.org` – `sw.js` zapisuje każdy
obejrzany kafelek w osobnej pamięci (`tracker-psa-tiles`, do 6000 kafelków, nie znika przy aktualizacji aplikacji).
Hurtowego pobierania obszaru nie ma celowo: zasady serwera kafelków OSM go zabraniają. Historia: do 10 000 meldunków
i 500 zdarzeń w `localStorage` (ok. 1 MB, przy meldunku co minutę prawie tydzień).
Serwer musi zezwalać na `geolocation` i `bluetooth` w nagłówku Permissions-Policy, a CSP na
`https://tile.openstreetmap.org` w `img-src` i `connect-src`.
