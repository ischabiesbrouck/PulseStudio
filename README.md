# PulseStudio

Een all-in-one DAW (digital audio workstation) in de browser: componeren, opnemen, mixen en exporteren op één plek. Geen installatie en geen build-stap; alles wordt lokaal in de browser opgeslagen en de app werkt ook offline.

## Wat er al in zit

- **Arrangeerweergave** met synth-, drum-, sampler- en audiosporen. Clips verplaats je door te slepen, met de rechterrand pas je de lengte aan, Alt+slepen kopieert en een dubbelklik maakt een nieuwe clip.
- **Pianorol** voor synth- en samplerclips en een **stappenraster** voor drumclips, met velocity, raster tot 1/32 (ook triolen), kwantiseren en patronen die zich herhalen tot het einde van de clip.
- **Synth**: oscillator 1 met unison (tot 7 stemmen, stereo gespreid), oscillator 2 met octaaf/halve tonen, FM, sub en ruis, filter (laag/hoog/band, 12 of 24 dB) met eigen envelope, keytracking en drive, volume-envelope en een LFO naar toonhoogte, filter of volume. 22 presets in vijf categorieën: bas, lead, pad, keys en pluk.
- **Drumcomputer** met vier kits (Analoog 808, Analoog 909, Akoestisch, Lo-fi tape) en twaalf geluiden: kick, snare, clap, rimshot, open en dichte hihat, shaker, cowbell, twee toms, crash en ride. Per pad stel je volume, stemming en lengte in, en elke pad kan een eigen sample krijgen. De dichte hihat smoort de open hihat.
- **Sampler**: speelt elk sample chromatisch af, met grondtoon, fijnstemming, beginpunt, loop, ADSR en filter.
- **Bibliotheek** met 25 ingebouwde geluiden die in de browser worden gemaakt (vrij te gebruiken): drumloops in het tempo van je project (house, techno, hiphop, trap, breakbeat, lo-fi), instrumenten voor de sampler (piano, gitaarsnaar, strijkers, koor, kalimba, klokje, orgel, 808-bas), akkoorden en effecten (impact, riser, downlifter, sub drop, ruissweep, omgekeerde crash, laser, vinylkraak).
- **Effectenrack** per spoor en op de master, met 13 ingebouwde effecten: EQ, compressor, verzadiging, lo-fi, chorus, phaser, delay (ook pingpong), galm, autofilter, tremolo/autopan, pomp (sidechain), stereobreedte en limiter. Effecten zet je aan of uit, verplaats je en verwijder je.
- **Mixer** met volume, pan, mute, solo en meters. Op de master staan standaard een lijmcompressor en een limiter.
- **Opnemen**: noten via het computertoetsenbord of een MIDI-keyboard, en audio via de microfoon.
- **Audio importeren** door een bestand op een audiospoor te slepen.
- **Transport**: loop (slepen in de liniaal), metronoom, tempo, ongedaan maken en opnieuw.
- **Exporteren** van het hele nummer als WAV (44,1 kHz, 16 bit).
- **Projecten** worden automatisch opgeslagen in IndexedDB.

## Interface

- Browser links (B) met geluiden, instrumenten en effecten; slepen naar een spoor of de effectenketen, dubbelklikken voegt toe.
- Apparatenketen per spoor en voor de master, met draaiknoppen en een scherm per apparaat: EQ-curve met versleepbare banden, VU-meter voor gain reduction, echo's van de delay, galmverval, filter- en envelopecurve van de synth, drumpads en sample-golfvorm met versleepbare markeringen.
- Mixer met inserts, panknop, dB-schaal, stereometers met piekvasthouden en een spectrumanalyser op de master.
- Fades op audioclips (witte blokjes bovenin de clip), stereometers in de spoorkoppen en een infobalk die uitlegt waar de muis staat.
- Vormgeving: neutraal grafiet, Archivo en Archivo Narrow, één amber accent en geen decoratieve gloed of kleurverlopen.

## Echte opnames

Naast de synthese gebruikt PulseStudio opnames uit vrij te gebruiken bibliotheken. Ze worden pas geladen als je ze nodig hebt en daarna in de browser bewaard (Cache API), zodat ze ook offline werken.

- **Drumkits** Studio akoestisch, Jazz in de kamer en Cassette lo-fi: *Virtuosity Drums* van Versilian Studios (CC0), met close-microfoons op kick en snare, overheads, kamer- en lo-fi-microfoons, tot zes snelheidslagen en round robin. Handklappen uit *VCSL* (CC0).
- **Vleugel**: *Salamander Grand Piano V3* door Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), 30 opnames van A0 tot C8.
- **31 overige instrumenten** (elektrische piano's, orgels, mallets, gitaren, bassen, strijkers, koor, blazers, synths, wereld): *FluidR3_GM* door Frank Wen, CC BY 3.0, via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) van Benjamin Gleitzman. Aanhoudende instrumenten krijgen een naadloze loop.
- **Patronen**: 14 drumgrooves en 12 melodische figuren als bewerkbare clips, ook als audioloop in het tempo van je project.

## Starten

```bash
python -m http.server 8810
```

Open daarna http://localhost:8810. De app gebruikt ES-modules en moet dus via een webserver draaien, niet als los bestand.

## Testen

```bash
npm test
```

## Opbouw

- `js/model.js`: projectmodel en tijdrekening (pure functies, getest)
- `js/state.js`: toestand met ongedaan maken / opnieuw (getest)
- `js/audio/`: engine (planning met lookahead, offline renderen), instrumenten, effecten (`plugins.js`, beschrijving in `plugin-defs.js`), signaalketen, bibliotheek, microfoonopname
- `js/ui/`: arrangeerweergave, editor, mixer, klankpaneel
- `js/store.js`: opslag in IndexedDB
- `js/wav.js`: WAV-encoder en golfvormpieken (getest)
