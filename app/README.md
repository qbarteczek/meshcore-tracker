# Tracker psa – aplikacja w przeglądarce

Strona-aplikacja dla bazy polowej (firmware `Xiao_nrf52_tracker_base`): **Chrome na Androidzie**, połączenie
z bazą przez Web Bluetooth, **działa bez internetu** po pierwszym otwarciu. Opublikowana pod
<https://qbart.waw.pl/tracker/> (pokaz bez urządzeń: `#demo`).

- **radar** – pies względem telefonu (GPS i kompas telefonu): odległość, kierunek, ślad psa i Twój,
  skala dobierana sama; „północ u góry” albo „kierunek patrzenia u góry”,
- **przyciski** zamiast wpisywania poleceń: Szukaj, Znaleziony, co 1 / 2 / 5 min, Bluetooth psa, Koniec wędrówki;
  przycisk świeci, dopóki tracker nie potwierdzi polecenia,
- **alarm** (dźwięk, wibracja, powiadomienie), gdy przez 2 odstępy + 1 min nie ma meldunku albo baza zgłosi brak,
- przyciski **Mapy Google / Inna mapa / Prowadź pieszo** – pozycja psa w aplikacji mapowej (offline działa, jeśli
  wcześniej pobrałeś mapę obszaru w Mapach Google lub OsmAnd),
- bateria i GPS psa, odstęp meldunków, czas do następnego, lista meldunków; ślad zapisany w telefonie.

## Pierwsze uruchomienie (w domu, z internetem)

1. Otwórz w Chrome `https://qbart.waw.pl/tracker/`, menu ⋮ → **Dodaj do ekranu głównego** (zainstaluj).
2. Zezwól na lokalizację; w ustawieniach strony „Zezwól na powiadomienia”.
3. Rozłącz aplikację MeshCore od bazy (Bluetooth przyjmuje jedną aplikację naraz), dotknij **Połącz z bazą**,
   wybierz `MeshCore-<nazwa bazy>`, PIN `123456`.
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

Pliki: `index.html`, `app.css`, `app.js`, `sw.js` (offline), `manifest.webmanifest`, ikony. Bez bibliotek,
bez żądań do internetu. Serwer musi zezwalać na `geolocation` i `bluetooth` w nagłówku Permissions-Policy.
