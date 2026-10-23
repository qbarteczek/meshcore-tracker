# Obudowa T1000-E na kamizelkę MOLLE (lub obrożę)

Obudowa na SenseCAP Card Tracker T1000-E (85 × 55 × 6,5 mm) do taktycznej kamizelki psa
z paskami MOLLE na grzbiecie (szelki z AliExpress, rozmiar L). Grzbiet to najlepsze miejsce
dla GPS. Plik źródłowy: [t1000e-obroza.scad](t1000e-obroza.scad), gotowe pliki: [stl/](stl/).

- **podstawa**: kieszeń na tracker, a z tyłu 3 bloczki, które wchodzą w przerwy między
  paskami kamizelki, z tunelami na listwy. Ma też okno na magnetyczne styki ładowania.
- **ramka**: front z otworami na przycisk, diodę/czujnik światła i brzęczyk, przykręcany 4 wkrętami
  M2 × 8 do plastiku
- **listwy** (2 sztuki + 1 zapasowa): idą w poprzek psa przez bloczek, pod paskiem kamizelki,
  przez bloczek, pod paskiem i przez bloczek. Na końcu zatrzaskują się rozdwojonym grotem.
  Żeby zdjąć, ściśnij grot palcami i wysuń listwę za główkę.

Wszystkie wypukłe krawędzie są zaokrąglone, żeby nic nie drapało psa i nie przecierało kamizelki:
podstawa r 1,4 mm (tunele na listwy są wycinane po zaokrągleniu, więc mostki pod listwami, 2 mm, zostają pełne), ramka r 0,9 mm, listwy r 1,0 mm,
a naroża listew w płaszczyźnie 1,5 mm. Robi to moduł `zaokraglij()`. Kieszeń i otwory na wkręty są
wycinane po zaokrągleniu, bo po złożeniu są zakryte. Zbliżenia: [podglad/krawedzie.png](podglad/krawedzie.png).

Wymiary: 91,6 mm wzdłuż grzbietu × 79 mm w poprzek (korpus 61,6 mm, płyta z bloczkami 79 mm),
grubość ok. 17,5 mm (nad listwą jest miejsce na pasek kamizelki).

Schemat montażu krok po kroku: [montaz-molle.html](montaz-molle.html).

Ładowanie: wysuń listwy, zdejmij obudowę i przyłóż kabel magnetyczny do okna z tyłu.
Nie trzeba jej rozkręcać.

Wariant na obrożę: `-D 'mocowanie="obroza"'` (plik [stl/podstawa-obroza.stl](stl/podstawa-obroza.stl), obroża do 25 × 3,5 mm).

## Do zmierzenia przed drukiem

Na kamizelce (suwmiarką):

| Parametr | Co zmierzyć | Domyślnie |
|---|---|---|
| `pas_szer` | szerokość paska taśmy na grzbiecie | 25 |
| `pas_przerwa` | przerwa między sąsiednimi paskami | 10 |
| `petla_rozstaw` | odstęp między szwami (przeszyciami) na pasku, czyli długość pętli | 38,1 |
| `pas_ile` | pod iloma paskami ma iść listwa (bloczków jest o 1 więcej) | 2 |

Na trackerze: położenie przycisku, diody, brzęczyka i styków ładowania jest oszacowane ze zdjęć
producenta. Popraw `otwory_front` i `okno_tyl_*`. Najpierw wydrukuj samą ramkę na próbę.

## Druk

| Część | Ułożenie FDM | Materiał |
|---|---|---|
| podstawa | na stojąco, na krótszym końcu (bez podpór), z brimem | PETG lub ASA |
| ramka | płasko, frontem do stołu | PETG / ASA |
| listwy | płasko | PETG albo nylon (PA). Muszą się trochę uginać, więc nie PLA |

Żywica (Photon): użyj żywicy wytrzymałej (tough/ABS-like), a listwy i tak wydrukuj na FDM.

Render (OpenSCAD 2025 z Manifold, każda część renderuje się ok. 15 s):

```
openscad --backend=Manifold -D 'czesc="podstawa"' -o stl/podstawa.stl t1000e-obroza.scad
openscad --backend=Manifold -D 'czesc="ramka"'    -o stl/ramka.stl    t1000e-obroza.scad
openscad --backend=Manifold -D 'czesc="listwy"'   -o stl/listwy.stl   t1000e-obroza.scad
```

Opcjonalnie `napis="tel. 600 000 000"` dodaje wgłębiony napis na dłuższym boku podstawy.
