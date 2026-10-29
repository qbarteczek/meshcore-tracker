# MeshCore tracker – tracker psa na MeshCore (fork)

Fork [MeshCore](https://github.com/meshcore-dev/MeshCore) `companion-v1.18.0` (licencja MIT, zob.
[license.txt](license.txt) – oryginalna nota copyright zachowana). Gałąź `main` dodaje do firmware companion:

- **tryb trackera** dla Seeed SenseCAP **T1000-E** (`env:t1000e_tracker`) – tracker śpi i sam wysyła meldunki z pozycją GPS,
- **bazę polową** dla companiona noszonego na wędrówce, np. XIAO nRF52840 + Wio-SX1262 z GPS
  (`env:Xiao_nrf52_tracker_base`) – pokazuje psa w aplikacji MeshCore na telefonie i przekazuje mu polecenia,
- [obudowę T1000-E](obudowa/) na kamizelkę MOLLE albo obrożę (OpenSCAD, STL).

Strona projektu: <https://qbart.waw.pl>.

*English summary:* the stock companion keeps the LoRa receiver, GPS and Bluetooth on all the time
(~15–20 mA, about 1.5 days on the T1000-E's 700 mAh battery). In tracker mode the node sleeps (radio in warm
sleep, GPS in RTC backup, Bluetooth off) and wakes up every *interval* seconds to get a fresh fix and send a
short direct message to its base, which ACKs it and can answer with a command (interval, search mode,
Bluetooth window, home/field base). There are two bases: a **home base** (a companion on a home server,
reached through a repeater) and a **field base** (a companion you carry on a hike, built with
`TRACKER_BASE`). When the active base does not answer, the tracker tries the other one, zero-hop for the field
base so the mesh is not flooded. The field base shows the dog on the MeshCore app's map, turns the reports
into readable messages (distance, direction, battery), holds commands typed in the app until the tracker's
next report, and raises an alarm when reports stop. Everything stays inside a normal MeshCore network.

---

## Jak to wygląda w praktyce

```
w domu / na spacerze:   TRK1 (pies) ──► RPT1 (repeater na dachu) ──► BAZA1 – baza domowa (companion na USB w serwerze) ──► Home Assistant
na wędrówce:            TRK1 (pies) ──► BAZA2 – baza polowa (w kieszeni, zero-hop) ──► aplikacja MeshCore w telefonie
                        TRK1 ··(co 15 min, jeśli jest zasięg)··► baza domowa
```

Nazwy w opisie są umowne: **TRK1** – tracker, **BAZA1** – baza domowa, **BAZA2** – baza polowa, **RPT1** – repeater.

Przełączanie jest samoczynne: gdy aktywna baza nie potwierdza meldunku, tracker próbuje drugiej, a ta, która
potwierdzi, zostaje bazą. Można też przełączyć ręcznie (polecenie `b=`, w aplikacji `#DOM`, w Home Assistant
przełącznik „Wędrówka”).

## Tracker (T1000-E)

1. **Sen** – radio LoRa w uśpieniu z zachowaniem konfiguracji, GPS w podtrzymaniu zegara (szybki ponowny fix),
   Bluetooth wyłączony, procesor w trybie niskiego poboru.
2. **Pobudka co `interval` s** – GPS budzi się i musi dać *świeżą* pozycję (zdanie NMEA z fixem po pobudce,
   ≥ 4 satelity, 3 s stabilizacji). Limit: 180 s po włączeniu, potem 60 s. Bez fixu meldunek idzie bez pozycji
   (nie wysyła starej pozycji).
3. **Meldunek** – wiadomość prywatna do aktywnej bazy, np.:

   ```
   #T1 52.229700,21.012200,110,3978,21.5,9,900,b,1
        lat       lon       alt mV   °C   sat int flagi nr
   ```
   Flagi: `b` pierwszy po włączeniu, `m` przesunął się > 100 m od ostatniej dostarczonej pozycji,
   `n` brak fixu, `s` tryb szukania, `l` poprzednie meldunki nie doszły, `f` tryb wędrówki (baza polowa).
   Do 3 prób; ostatnia w trybie szukania idzie floodem (do całej sieci). Jeśli nie dojdzie –
   2 próby do drugiej bazy.
4. **Okno poleceń** – po ACK nasłuch 8 s na odpowiedź bazy:

   ```
   #C i=900 s=0 c=1 b=h
   ```
   `i` = odstęp meldunków w sekundach (15–3600), `s` = tryb szukania, `c=1` = otwórz okno Bluetooth,
   `b=h` / `b=f` = baza domowa / polowa. Polecenia przyjmuje tylko od swoich dwóch baz.
   Baza odpowiada tylko wtedy, gdy trzeba coś zmienić.
5. **Sam z siebie** tracker skraca odstęp do 120 s, gdy oddalił się > 100 m od ostatniej dostarczonej pozycji,
   a gdy meldunki nie dochodzą – próbuje co 120 s (po 10 nieudanych co 300 s).
6. **Wędrówka** – do bazy polowej tracker nadaje najpierw zero-hop (słyszy to tylko najbliższe otoczenie,
   repeatery tego nie powtarzają); druga próba też zero-hop, nawet gdy wcześniej poznał trasę przez repeater.
   W trybie wędrówki co 15 min wysyła kopię meldunku do bazy domowej, ale tylko po znanej trasie (bez floodu).

### Przycisk

| Naciśnięcie | Co robi |
|---|---|
| krótkie (1 mrugnięcie) | meldunek od razu |
| 2–6 s (3 mrugnięcia) | okno Bluetooth na 10 min – zwykły companion, działa aplikacja MeshCore |
| > 6 s (5 mrugnięć) | wyłączenie (włącza się ponownie przyciskiem) |

Po włączeniu zasilania przez 3 min działa okno Bluetooth. Tracker nie zasypia, dopóki aplikacja jest połączona.

### Konfiguracja trackera (zmienne własne, aplikacja MeshCore lub `set_custom_var`)

| Zmienna | Wartość |
|---|---|
| `tracker` | `1` – tryb trackera włączony, `0` – zwykły companion |
| `trk_int` | domyślny odstęp w sekundach (do pierwszego polecenia bazy), np. `120` |
| `trk_field` | początek nazwy kontaktu bazy polowej, np. `BAZA2` (pasuje też do „BAZA2 🏕”); `-` = bez bazy polowej |
| `gps` | `1` – GPS używany także w oknie konfiguracji |

Obie bazy muszą być na trackerze **ulubionymi** kontaktami. Baza domowa = pierwszy ulubiony, który nie jest bazą
polową. Bazie domowej warto ustawić stałą trasę przez najbliższy repeater, żeby meldunki nie szły floodem.

## Baza polowa (companion na wędrówkę)

Zwykły companion BLE MeshCore – aplikacja, czaty, kanały i mapa działają jak zawsze. Dodatkowo:

- **meldunek `#T1`** od trackera zamienia na czytelną wiadomość od kontaktu trackera, np.

  ```
  1,2 km PN-WSCH · 3,98 V 82% · 22°C · 9 sat · co 60 s
  https://maps.google.com/?q=52.22970,21.01220
  ```
  (odległość i kierunek tylko wtedy, gdy baza ma własny fix GPS; bez niego „GPS ok”),
- aktualizuje pozycję kontaktu trackera, więc **pies jest na mapie aplikacji**,
- sama ustawia trackerowi odstęp z `tb_int` (domyślnie 60 s),
- **polecenia** wpisane w aplikacji jako wiadomość do trackera przechowuje do jego najbliższego meldunku
  (tracker śpi i słucha tylko kilka sekund po meldunku); aplikacja pokazuje „doręczone”, gdy tracker je potwierdzi:

  | Wpisz | Co robi |
  |---|---|
  | `#SZUKAJ` | tryb szukania, meldunek co 30 s |
  | `#STOP` | koniec szukania, odstęp z `tb_int` |
  | `#DOM` | wróć do bazy domowej |
  | `#BT` | otwórz Bluetooth trackera na 10 min |
  | `#CO 120` | odstęp meldunków w sekundach |
  | `#C i=60 s=0` | polecenie wprost |

  Kilka poleceń wpisanych przed meldunkiem łączy się w jedno.
- **alarm** – gdy przez 2 odstępy + 1 min nie ma meldunku, przychodzi wiadomość
  „⚠ brak meldunku od N min, ostatnio … + link do ostatniej pozycji” (co 10 min, po 3 razach co 30 min).

Zmienna własna bazy: `tb_int` – odstęp meldunków na wędrówce w sekundach, `0` = nie zmieniaj.

Uwaga: polecenia z bazy polowej docierają tylko wtedy, gdy tracker do niej melduje (tryb wędrówki).
Po powrocie do domu wyłącz bazę polową albo wpisz `#DOM` – inaczej tracker dalej melduje do niej.

## Telefon: aplikacja i obsługa na wędrówce

### Jaka aplikacja

Zwykła, oficjalna **aplikacja MeshCore** (Android / iOS) – bez żadnych dodatków. Telefon łączy się przez
Bluetooth z **BAZA2** (nie z trackerem). Wszystko idzie przez radio LoRa w sieci MeshCore: nie potrzeba
internetu, zasięgu GSM ani karty SIM w trackerze.

```
TRK1 (pies) ── LoRa, zero-hop ──► BAZA2 (kieszeń/plecak) ── Bluetooth ──► telefon: aplikacja MeshCore
           ◄── polecenia #C ─────                      ◄── wpisujesz #SZUKAJ, #DOM ... ──
```

Na Androidzie zamiast aplikacji MeshCore można użyć **[aplikacji „Tracker psa”](app/)** w Chrome
(<https://qbart.waw.pl/tracker/>, nowości najpierw w becie: <https://qbart.waw.pl/tracker/beta/>). Układ jest
wzorowany na Traccarze, ale działa bez serwera i bez internetu: mapa OpenStreetMap z psem, jego śladem i kartą stanu
(bateria, prędkość, GPS, czas meldunku), historia tras po dniach z odtwarzaniem, wykresem baterii i prędkości,
raportem (dystans, czas w ruchu, prędkości, przejścia i postoje) i zapisem GPX/KML/CSV, strefy z alarmem (jak
geofence), lista zdarzeń, radar z psem względem telefonu (GPS i kompas telefonu – odległość i kierunek działają
nawet wtedy, gdy baza nie ma GPS), przyciski zamiast wpisywania poleceń, alarm z dźwiękiem i wibracją.
Po pierwszym otwarciu działa bez internetu; mapa pokazuje fragmenty obejrzane wcześniej z internetem. Telefon łączy się przez Bluetooth z jedną aplikacją naraz – albo ta
strona, albo aplikacja MeshCore.

### Przygotowanie (raz, w domu)

1. Wgraj firmware: tracker – `t1000e_tracker`, baza polowa – `Xiao_nrf52_tracker_base` (zob. niżej).
2. Połącz aplikację z BAZA2 (PIN Bluetooth domyślnie `123456`). Ustaw radio jak w całej sieci.
   **Od razu zmień PIN Bluetooth na własny** (6 cyfr, w ustawieniach urządzenia w aplikacji) – na BAZA2 i na TRK1
   (w oknie Bluetooth trackera). Domyślny PIN jest publiczny: ktoś w zasięgu Bluetooth mógłby się sparować,
   czytać meldunki i wysyłać polecenia.
3. **Wymień kontakty** – obie strony muszą się znać, bo wiadomości są szyfrowane parami kluczy:
   - na BAZA2: dodaj TRK1 (advert z trackera albo udostępniony kontakt),
   - na TRK1: dodaj BAZA2 i oznacz ją jako **ulubioną** (gwiazdka). Aplikację połączysz z trackerem w oknie
     Bluetooth: przytrzymaj przycisk 2–6 s (3 mrugnięcia), po włączeniu zasilania okno jest otwarte 3 min.
4. Na TRK1 ustaw zmienną `trk_field` = początek nazwy BAZA2 (np. `BAZA2`). Aplikacja pokazuje zmienne własne
   w ustawieniach urządzenia; można też użyć `meshcore-cli` albo biblioteki `meshcore` w Pythonie
   (`set_custom_var`).
5. Opcjonalnie na BAZA2 `tb_int` – jak często pies ma się meldować na wędrówce (domyślnie 60 s).
6. Rozłącz aplikację od trackera i połącz z powrotem z BAZA2. Tracker nie zaśnie, dopóki aplikacja jest z nim
   połączona – w terenie telefon ma być połączony tylko z bazą.

### Na wędrówce

- Weź BAZA2 (włączoną, z powerbankiem – zwykły companion bierze ok. 15–20 mA) i telefon z aplikacją połączoną z BAZA2.
- **Przełączenie jest samo**: gdy tracker straci bazę domową, kolejny meldunek idzie do BAZA2 (flaga `f`).
  Od razu można też przełączyć z domu (`#C b=f` z bazy domowej, np. przełącznikiem w Home Assistant).
- **Co widać w aplikacji** – w czacie z kontaktem TRK1 przychodzi wiadomość co meldunek:

  ```
  1,2 km PN-WSCH · 3,98 V 82% · 22°C · 9 sat · co 60 s
  https://maps.google.com/?q=52.22970,21.01220
  ```
  Odległość i kierunek liczone od BAZA2 – tylko gdy baza ma swój GPS z fixem; bez niego jest „GPS ok” i link.
  Pozycja kontaktu TRK1 jest aktualizowana, więc tracker widać na **mapie** w aplikacji.
- **Polecenia** – wpisz jako zwykłą wiadomość do TRK1 (czekają w BAZA2 do najbliższego meldunku, bo tracker śpi;
  aplikacja pokaże „doręczone”, gdy tracker potwierdzi):

  | Wpisz | Kiedy |
  |---|---|
  | `#SZUKAJ` | pies zniknął z oczu – meldunek co 30 s, ostatnia próba floodem przez całą sieć |
  | `#STOP` | znaleziony – z powrotem co `tb_int` |
  | `#CO 300` | rzadsze meldunki, żeby oszczędzać baterię trackera |
  | `#BT` | otworzyć Bluetooth trackera na 10 min (np. zmiana ustawień w terenie) |
  | `#DOM` | koniec wędrówki – tracker wraca do bazy domowej |

- **Alarm** – gdy meldunki przestaną przychodzić (2 odstępy + 1 min), w czacie TRK1 pojawia się
  „⚠ brak meldunku od N min, ostatnio … + link do ostatniej pozycji”, potem co 10 min (po 3 razach co 30 min).
  Po odzyskaniu kontaktu wiadomość zaczyna się od „✅ kontakt wrócił”.

### Wskazówki

- **Powiadomienia**: włącz powiadomienia aplikacji MeshCore i wyłącz dla niej oszczędzanie baterii (Android),
  inaczej system może zerwać połączenie Bluetooth w tle i alarm przyjdzie dopiero po otwarciu aplikacji.
- **Mapa offline**: podkład mapy w aplikacji MeshCore pobiera się z internetu. Bez zasięgu ściągnij wcześniej
  obszar w Google Maps lub OsmAnd – link z meldunku otworzy się wtedy także offline. W aplikacji „Tracker psa”
  przed wyjazdem obejrzyj okolicę na mapie w kilku powiększeniach – obejrzane fragmenty zostają w telefonie.
- **Zasięg**: zero-hop między psem a bazą to zwykle kilkaset metrów do kilku km w terenie otwartym, w lesie
  i za wzgórzem dużo mniej. Gdy w okolicy są repeatery, `#SZUKAJ` pozwala ostatniej próbie meldunku pójść
  przez nie (flood).
- **Bateria trackera**: przy meldunku co 60 s z GPS w ciągłej pracy pobór rośnie; na długą trasę rozważ `#CO 120`
  albo więcej, a `#SZUKAJ` włączaj tylko na czas szukania.
- **Po powrocie**: wpisz `#DOM` albo po prostu wyłącz BAZA2 – tracker po 3 nieudanych próbach sam wróci do
  bazy domowej.
- Telefon może być połączony tylko z jednym urządzeniem MeshCore naraz. Do zwykłych rozmów na wędrówce używaj
  BAZA2 – to pełny companion (czaty, kanały, mapa).

## Budowanie i wgrywanie

```
pio run -e t1000e_tracker              # tracker (T1000-E)
pio run -e Xiao_nrf52_tracker_base     # baza polowa (XIAO nRF52840 + Wio-SX1262, GPS na D6/D7)
python bin/uf2conv/uf2conv.py .pio/build/<env>/firmware.hex -c -f 0xADA52840 -o firmware.uf2
```
UF2 kopiuje się na dysk bootloadera (T1000-E: dwuklik przycisku przy podłączaniu; XIAO: dwuklik RESET), albo przez
port szeregowy: `adafruit-nrfutil dfu serial --package firmware.zip -p COMx -b 115200 --singlebank --touch 1200`
(po „touch” bootloader pojawia się na innym porcie COM – wtedy powtórzyć z tym portem).
Gotowe pliki: [release/](release/) (`.uf2` do skopiowania na dysk bootloadera, `-dfu.zip` do `adafruit-nrfutil`). Klucze, kontakty i ustawienia zostają przy aktualizacji (także ustawienia
trackera z wersji trk1).

Baza dla XIAO ma GPS Ai-Thinker GP-02 na UART: GP-02 TX → D7, RX → D6, VCC → 3V3; magistrala I2C jest
przeniesiona na piny 12/13. Bez podłączonego GPS działa tak samo, tylko bez odległości i kierunku.

## Obudowa

[obudowa/](obudowa/) – obudowa T1000-E na taktyczną kamizelkę psa (MOLLE) lub obrożę, z zaokrąglonymi
krawędziami, oknem na magnetyczne ładowanie i schematem montażu ([obudowa/montaz-molle.html](obudowa/montaz-molle.html)).

## Zmiany względem MeshCore

| Plik | Zmiana |
|---|---|
| `examples/companion_radio/TrackerMode.{h,cpp}` | tryb trackera, dwie bazy |
| `examples/companion_radio/TrackerBase.{h,cpp}` | baza polowa |
| `examples/companion_radio/TrackerHooks.h`, `TrackerUtil.h` | wspólny interfejs i pomocnicze funkcje |
| `examples/companion_radio/main.cpp` | uruchomienie (tylko z `-D TRACKER_MODE` albo `-D TRACKER_BASE`) |
| `examples/companion_radio/MyMesh.{h,cpp}` | haki: ACK, wiadomości przychodzące i z aplikacji, zmienne własne, pozycja kontaktu |
| `src/helpers/radiolib/RadioLibWrappers.{h,cpp}` | `sleepRadio()` / `wakeRadio()` |
| `src/helpers/sensors/LocationProvider.h`, `MicroNMEALocationProvider.h` | `lastFixMillis()` – świeżość fixu |
| `variants/t1000-e/platformio.ini` | `env:t1000e_tracker` |
| `variants/xiao_nrf52/platformio.ini`, `target.cpp` | GPS na UART D6/D7, `env:Xiao_nrf52_tracker_base` |
| `obudowa/` | obudowa T1000-E |

Bez `-D TRACKER_MODE` / `-D TRACKER_BASE` firmware zachowuje się jak oryginalny companion.

## Strona serwera

Bazą domową jest companion podłączony do serwera przez USB; mały program (most) odbiera meldunki, wysyła je do
[Traccar](https://www.traccar.org/) (protokół OsmAnd) i do Home Assistant (MQTT), a odpowiada poleceniami:
odstęp zależny od odległości od domu i pory, tryb szukania, okno Bluetooth, przełącznik „Wędrówka”.
Meldunków z flagą `f` nie zmienia (o odstępie decyduje wtedy baza polowa) i nie podnosi dla nich alarmu
„brak kontaktu”. Most nie jest częścią tego repozytorium.

## Bezpieczeństwo

- Meldunki i polecenia między trackerem a bazami idą jako wiadomości prywatne MeshCore, szyfrowane kluczami
  urządzeń; inne węzły sieci ich nie odczytają. Tracker przyjmuje polecenia `#C` tylko od swoich dwóch baz
  (ulubionych kontaktów).
- Słabym miejscem jest Bluetooth: **zmień domyślny PIN `123456`** na BAZA2 i TRK1. Kto zna PIN i jest w zasięgu
  Bluetooth (kilkanaście metrów), może połączyć się z bazą jak Ty.
- Aplikacja w przeglądarce nie wysyła niczego do internetu i nie przechowuje danych na serwerze – wszystko
  zostaje w telefonie.
- Nazwy urządzeń widać w sieci MeshCore (adverty); jeśli nie chcesz, żeby nazwa trackera zdradzała, co to jest,
  nazwij go neutralnie.

## Licencja

MIT, tak jak MeshCore. Oryginalna nota copyright MeshCore w [license.txt](license.txt) zostaje bez zmian;
zmiany i nowe pliki tego forka (firmware i obudowa): Copyright (c) 2026 qbart, na tej samej licencji MIT.
To nieoficjalny fork – nie jest wydawany ani wspierany przez zespół MeshCore.
