# MeshCore tracker – tracker psa na MeshCore (fork)

Fork [MeshCore](https://github.com/meshcore-dev/MeshCore) `companion-v1.18.0` (licencja MIT, zob.
[license.txt](license.txt) – oryginalna nota copyright zachowana). Gałąź `main` dodaje do firmware companion:

- **tryb trackera** dla Seeed SenseCAP **T1000-E** (`env:t1000e_tracker`) – tracker śpi i sam wysyła meldunki
  z pozycją GPS na prywatny kanał MeshCore,
- [obudowę T1000-E](obudowa/) na kamizelkę MOLLE albo obrożę (OpenSCAD, STL).

Strona projektu: <https://qbart.waw.pl>.

*English summary:* the stock companion keeps the LoRa receiver, GPS and Bluetooth on all the time
(~15–20 mA, about 1.5 days on the T1000-E's 700 mAh battery). In tracker mode the node sleeps (radio in warm
sleep, GPS in RTC backup, Bluetooth off), wakes up, gets a fresh fix and posts one text message to a private
group channel – every minute while moving, every 5 minutes while still (decided by the tracker alone, with
hysteresis against GPS noise). The same packet is sent twice: first over a fixed route through one repeater
(the home node hears it, the mesh is not flooded), then zero-hop (a companion carried by the walker hears it
directly). No ACKs, no bases, no modes and no remote commands – any node with the channel key that hears the
packet shows it, e.g. the official MeshCore app. Version 2 (trk6) replaced the older direct-message design
(trk1–trk5: home/field bases, ACKs, commands), which proved fragile on real walks.

---

## Jak to wygląda w praktyce

```
                   ┌── po trasie przez RPT1 (repeater na dachu) ──► BAZA1 (companion w serwerze) ──► Home Assistant, Traccar
TRK1 (pies) ──────►┤
                   └── zero-hop (3 s później) ──────────────────► każdy companion w pobliżu psa ──► aplikacja MeshCore w telefonie
```

Nazwy w opisie są umowne: **TRK1** – tracker, **RPT1** – repeater, **BAZA1** – węzeł w domu.
Każdy, kto ma kanał (nazwa + sekret), widzi meldunki – w domu, na spacerze, w kilku telefonach naraz.
Nikt nie musi niczego przełączać.

### Dlaczego tak (wersja 2, trk6)

Wersja 1 (trk1–trk5) wysyłała wiadomości prywatne do „bazy domowej” albo „bazy polowej” z potwierdzeniem,
a bazy odsyłały polecenia (odstęp, szukanie, przełączenie bazy). Na spacerach wychodziły kolejne przypadki
brzegowe – np. ostatnia próba floodem kasowała trasę do domu i tracker po powrocie zostawał przy bazie polowej;
aplikacja w przeglądarce traciła połączenie Bluetooth, gdy ekran gasł. Symulacja na prawdziwych meldunkach
(4 scenariusze, 6 wariantów) wybrała kanał z dwiema kopiami: najmniej stanów, które mogą się zaciąć, krótkie
przerwy w domu i w telefonie, ~2,3× mniej eteru niż flood.

## Tracker (T1000-E)

1. **Sen** – radio LoRa w uśpieniu z zachowaniem konfiguracji, GPS w podtrzymaniu zegara (szybki ponowny fix)
   albo w ciągłej pracy przy odstępie ≤ 60 s, Bluetooth wyłączony.
2. **Pobudka** – GPS musi dać *świeżą* pozycję (zdanie NMEA z fixem po pobudce, ≥ 4 satelity, 3 s stabilizacji).
   Limit: 180 s po włączeniu, potem 45 s (w budynku fixu często nie ma – nie marnuje baterii).
3. **Meldunek** na kanał (domyślnie „Pies”), np.:

   ```
   TRK1: idzie 93% 4,18V 9,3°C 12sat nr81 https://maps.google.com/?q=52.22970,21.01220
   ```
   Pierwsze słowo: `start` (po włączeniu), `idzie`, `stoi`, `OK`, `SOS`, `brak GPS` (link = ostatnia znana
   pozycja, przed nim „ost.”). `bateria!` przy ≤ 10 %. `nr` rośnie z każdym meldunkiem – po przeskokach widać,
   ile meldunków nie doszło.
4. **Dwie kopie**: najpierw po trasie `trk_path` (repeater przekazuje ją raz, dalej nie idzie), po 3 s zero-hop.
   Kolejność jest ważna: repeater, który już usłyszał kopię zero-hop, uznałby drugą za powtórkę i jej nie
   przekazał. Odbiorniki widzą jedną wiadomość (ta sama treść = ten sam skrót pakietu).
5. **Odstęp** – decyduje tracker: oddalił się > 40 m od punktu odniesienia → *idzie*, co `trk_move` (60 s);
   3 min bez takiego przesunięcia → *stoi*, co `trk_still` (300 s). Bez poleceń z zewnątrz.

### Przycisk

| Naciśnięcie | Co robi |
|---|---|
| 1× krótko (1 mrugnięcie) | meldunek od razu |
| 2× krótko (2 mrugnięcia) | meldunek **„OK”** (umówiony znak, że wszystko w porządku) |
| 3× krótko (4 mrugnięcia + sygnał) | **SOS** – meldunek „SOS” co 30 s przez 15 min; ponownie 3× = koniec (2 sygnały) |
| 2–6 s (3 mrugnięcia) | okno Bluetooth na 10 min – zwykły companion, działa aplikacja MeshCore |
| > 6 s (5 mrugnięć) | wyłączenie (włącza się ponownie przyciskiem) |

Krótkie naciśnięcia liczą się seriami: tracker czeka 0,8 s po ostatnim i dopiero wtedy wie, czy to 1, 2 czy 3.
Po włączeniu zasilania przez 3 min działa okno Bluetooth. Tracker nie zasypia, dopóki aplikacja jest połączona.

**Słaba bateria** – przy 20 % dwa krótkie sygnały (raz), przy 10 % trzy sygnały, `bateria!` w meldunku
i meldunek najwyżej co 10 min (poza SOS). Ostrzeżenia wracają po naładowaniu do 30 %.

**Zegar** – ustawiany z GPS (tylko z fixu po wybudzeniu).

### Konfiguracja (zmienne własne: aplikacja MeshCore lub `set_custom_var`)

| Zmienna | Wartość |
|---|---|
| `tracker` | `1` – tryb trackera włączony, `0` – zwykły companion |
| `trk_ch` | nazwa kanału na trackerze (domyślnie `Pies`) |
| `trk_path` | trasa pierwszej kopii: skróty repeaterów w hex, np. `a1` (1 bajt na repeater); `-` = tylko zero-hop |
| `trk_move` | odstęp w ruchu, s (domyślnie 60) |
| `trk_still` | odstęp w postoju, s (domyślnie 300) |
| `gps` | `1` – GPS używany także w oknie konfiguracji |

Kanał (nazwa + 16-bajtowy sekret) trzeba dodać na trackerze i na każdym odbiorniku. Sekret jest kluczem –
trzymaj go poza publicznym repozytorium.

## Odbiorniki

- **Telefon**: oficjalna aplikacja MeshCore (Android / iOS) połączona przez Bluetooth z dowolnym companionem
  z kanałem trackera. Natywna aplikacja działa w tle i daje powiadomienia; link z meldunku otwiera mapę.
  Włącz powiadomienia dla kanału i wyłącz dla aplikacji oszczędzanie baterii (Android).
- **Dom**: companion na USB w serwerze + most (poza tym repozytorium) → Traccar (protokół OsmAnd),
  Home Assistant (MQTT), alarm SOS.
- [Aplikacja w przeglądarce](app/) z wersji 1 czyta wiadomości prywatne bazy polowej – meldunków z kanału
  jeszcze nie obsługuje.

## Śledzenie osób (za zgodą)

Ten sam tracker może nosić **osoba** – dziecko, znajomy, uczestnik wyprawy – tam, gdzie lokalizatory GSM nie działają,
bo nie ma zasięgu telefonii. Łączność idzie radiem LoRa (869 MHz), bez operatora i bez internetu.

- **Zgoda jest warunkiem.** Śledź tylko osobę, która się na to zgodziła i wie, kiedy tracker działa; dziecko –
  za zgodą opiekuna. Pozycja osoby to dane osobowe (RODO): kanał tylko dla zaufanych, historię usuwaj, gdy
  przestanie być potrzebna.
- **Przycisk**: 2× = „OK” (umówiony meldunek), 3× = SOS.
- **Zasięg**: bez przeszkód kilka do kilkunastu km między trackerem a odbiornikiem; w dolinie, lesie albo za
  grzbietem dużo mniej. Pomaga odbiornik trzymany wysoko i przenośny repeater.
- To pomoc w odnalezieniu, nie certyfikowany sprzęt ratunkowy – w górach zgłaszaj wyjście i miej przy sobie
  numer ratunkowy (GOPR/TOPR 985, 112).

## Budowanie i wgrywanie

```
pio run -e t1000e_tracker              # tracker (T1000-E)
python bin/uf2conv/uf2conv.py .pio/build/<env>/firmware.hex -c -f 0xADA52840 -o firmware.uf2
```
UF2 kopiuje się na dysk bootloadera (T1000-E: dwuklik przycisku przy podłączaniu; XIAO: dwuklik RESET), albo przez
port szeregowy: `adafruit-nrfutil dfu serial --package firmware.zip -p COMx -b 115200 --singlebank --touch 1200`
(po „touch” bootloader pojawia się na innym porcie COM – wtedy powtórzyć z tym portem).
Gotowe pliki: [release/](release/) (`.uf2` do skopiowania na dysk bootloadera, `-dfu.zip` do `adafruit-nrfutil`).
Klucze, kontakty i kanały zostają przy aktualizacji. Z wersji 1 przechodzi tylko `tracker=1`; kanał i `trk_path`
trzeba ustawić.

Firmware wersji 1 (trk1–trk5, bazy i polecenia) jest w historii repozytorium i w `release/`
(`TrackerBase.{h,cpp}`, `env:Xiao_nrf52_tracker_base` zostały dla porządku, wersja 2 ich nie używa).
Odbiornikiem może być zwykły companion, np. `env:Xiao_nrf52_companion_radio_ble_gps`
(GPS Ai-Thinker GP-02 na UART: GP-02 TX → D7, RX → D6, VCC → 3V3; I2C na pinach 12/13).

## Obudowa

[obudowa/](obudowa/) – obudowa T1000-E na taktyczną kamizelkę psa (MOLLE) lub obrożę, z zaokrąglonymi
krawędziami, oknem na magnetyczne ładowanie i schematem montażu ([obudowa/montaz-molle.html](obudowa/montaz-molle.html)).

## Zmiany względem MeshCore

| Plik | Zmiana |
|---|---|
| `examples/companion_radio/TrackerMode.{h,cpp}` | tryb trackera (wersja 2: kanał) |
| `examples/companion_radio/TrackerBase.{h,cpp}` | baza polowa (tylko wersja 1) |
| `examples/companion_radio/TrackerHooks.h`, `TrackerUtil.h` | wspólny interfejs i pomocnicze funkcje |
| `examples/companion_radio/main.cpp` | uruchomienie (tylko z `-D TRACKER_MODE` albo `-D TRACKER_BASE`) |
| `examples/companion_radio/MyMesh.{h,cpp}` | haki: ACK, wiadomości przychodzące i z aplikacji, zmienne własne, pozycja kontaktu |
| `src/helpers/radiolib/RadioLibWrappers.{h,cpp}` | `sleepRadio()` / `wakeRadio()` |
| `src/helpers/sensors/LocationProvider.h`, `MicroNMEALocationProvider.h` | `lastFixMillis()` – świeżość fixu |
| `variants/t1000-e/platformio.ini` | `env:t1000e_tracker` |
| `variants/xiao_nrf52/platformio.ini`, `target.cpp` | GPS na UART D6/D7, `env:Xiao_nrf52_tracker_base` |
| `obudowa/` | obudowa T1000-E |

Bez `-D TRACKER_MODE` / `-D TRACKER_BASE` firmware zachowuje się jak oryginalny companion.

## Bezpieczeństwo

- Meldunki idą na kanał prywatny, szyfrowany jego sekretem; węzły bez sekretu ich nie odczytają, a repeater
  na trasie tylko je przekazuje. Kto zna sekret, widzi pozycję – udostępniaj go tylko zaufanym.
- Tracker nie przyjmuje żadnych poleceń przez radio.
- Słabym miejscem jest Bluetooth: **zmień domyślny PIN `123456`** na trackerze i odbiornikach.
- Nazwy urządzeń widać w sieci MeshCore (adverty i nagłówek wiadomości na kanale); jeśli nie chcesz, żeby
  nazwa trackera zdradzała, co to jest, nazwij go neutralnie.

## Licencja

MIT, tak jak MeshCore. Oryginalna nota copyright MeshCore w [license.txt](license.txt) zostaje bez zmian;
zmiany i nowe pliki tego forka (firmware i obudowa): Copyright (c) 2026 qbart, na tej samej licencji MIT.
To nieoficjalny fork – nie jest wydawany ani wspierany przez zespół MeshCore.
