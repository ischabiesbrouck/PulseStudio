# PulseStudio

Een all-in-one DAW (digital audio workstation) in de browser: componeren, opnemen, mixen en exporteren op één plek. Geen installatie en geen build-stap; alles wordt lokaal in de browser opgeslagen en de app werkt ook offline.

## Wat er al in zit

- **Arrangeerweergave** met synth-, drum- en audiosporen. Clips verplaats je door te slepen, met de rechterrand pas je de lengte aan, Alt+slepen kopieert en een dubbelklik maakt een nieuwe clip.
- **Pianorol** voor synthclips en een **stappenraster** voor drumclips, met velocity, raster tot 1/32 (ook triolen), kwantiseren en patronen die zich herhalen tot het einde van de clip.
- **Synth**: twee oscillatoren, een filter met envelope, ADSR en vijf presets (Lead, Bas, Pad, Pluk, Keys).
- **Drumcomputer**: kick, snare, clap, hihats, toms en crash, allemaal gesynthetiseerd.
- **Effecten per spoor**: 3-bands EQ, compressor, tempo-gesynchroniseerde delay en galm.
- **Mixer** met volume, pan, mute, solo en meters, plus een masterbus met begrenzer.
- **Opnemen**: noten via het computertoetsenbord of een MIDI-keyboard, en audio via de microfoon.
- **Audio importeren** door een bestand op een audiospoor te slepen.
- **Transport**: loop (slepen in de liniaal), metronoom, tempo, ongedaan maken en opnieuw.
- **Exporteren** van het hele nummer als WAV (44,1 kHz, 16 bit).
- **Projecten** worden automatisch opgeslagen in IndexedDB.

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
- `js/audio/`: engine (planning met lookahead, offline renderen), instrumenten, effectketen, microfoonopname
- `js/ui/`: arrangeerweergave, editor, mixer, klankpaneel
- `js/store.js`: opslag in IndexedDB
- `js/wav.js`: WAV-encoder en golfvormpieken (getest)
