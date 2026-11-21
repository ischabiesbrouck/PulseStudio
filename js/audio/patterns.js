// Patronen: drumgrooves en melodische figuren als bewerkbare noten. Melodisch alles in A mineur.
// Ze worden als MIDI-clip in een spoor gezet, en ook als audioloop gerenderd voor de bibliotheek.
import { rng } from './dsp.js';

// Per drumgeluid een rij van 16 stappen per maat (of 32 voor twee maten):
//   X = accent, x = hard, o = middel, g = ghost note (heel zacht), . = rust.
const VEL = { X: 1, x: 0.9, o: 0.62, g: 0.3 };

export const DRUM_PATTERNS = [
  { id: 'house', name: 'House', kit: '909', bpm: 124, rows: { 36: 'x...x...x...x...', 39: '....x.......x...', 42: '..x...x...x...x.', 46: '..............o.', 70: 'g.o.g.o.g.o.g.o.' } },
  { id: 'deephouse', name: 'Deep house', kit: '909', bpm: 120, swing: 0.12, rows: { 36: 'x...x...x...x...', 37: '...o..o....o..g.', 39: '....o.......o...', 42: 'g.x.g.x.g.x.g.xo', 70: 'o.g.o.g.o.g.o.g.' } },
  { id: 'techno', name: 'Techno', kit: '909', bpm: 130, rows: { 36: 'X...x...X...x...', 46: '..x...x...x...x.', 51: 'o.o.o.o.o.o.o.o.', 39: '....o.......o...', 37: '...g..g....g..g.' } },
  { id: 'hiphop', name: 'Boom bap', kit: 'Studio', bpm: 90, swing: 0.18, rows: { 36: 'x......x..x.....x.x....x..x..x..', 38: '....x..g....x.g.....x..g....x...', 42: 'x.o.x.o.x.o.x.oox.o.x.o.x.o.x.o.' } },
  { id: 'trap', name: 'Trap', kit: '808', bpm: 140, rows: { 36: 'x.....x...x.....x......x..x.....', 38: '........x...............x.......', 39: '........o...............o.......', 42: 'x.o.x.o.x.o.x...x.o.x.o.x.oox.o.', 46: '..............o.................' }, rolls: [[12, 42, 6], [28, 42, 4]] },
  { id: 'dnb', name: 'Drum and bass', kit: 'Studio', bpm: 172, rows: { 36: 'x.........x.....', 38: '....x.......x...', 42: 'x.o.x.o.x.o.x.o.', 51: 'o...o...o...o...' } },
  { id: 'breakbeat', name: 'Breakbeat', kit: 'Studio', bpm: 100, rows: { 36: 'x.x.......x.....', 38: '....x..g.g..x..g', 51: 'x.o.x.o.x.o.x.o.' } },
  { id: 'funk', name: 'Funk', kit: 'Studio', bpm: 104, swing: 0.08, rows: { 36: 'x..x..x...x..x..', 38: '....x..g.g..x..g', 42: 'xoooxoooxoooxooo' } },
  { id: 'rock', name: 'Rock', kit: 'Studio', bpm: 116, rows: { 36: 'x.......x.x.....x.......x.x.x...', 38: '....x.......x.......x.......x...', 42: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x...', 49: '................................', 46: '..............................o.' }, crashFirst: true },
  { id: 'lofi', name: 'Lo-fi', kit: 'Cassette', bpm: 84, swing: 0.22, rows: { 36: 'x.....x..x......', 38: '....x.......x...', 42: 'x.ooxgo.x.ooxgo.', 70: '..o...o...o...o.' } },
  { id: 'dembow', name: 'Reggaeton (dembow)', kit: '808', bpm: 95, rows: { 36: 'x...x...x...x...', 38: '...x..x....x..x.', 42: 'o.o.o.o.o.o.o.o.' } },
  { id: 'afro', name: 'Afrobeat', kit: 'Studio', bpm: 108, swing: 0.1, rows: { 36: 'x.....x...x.....', 37: '...o.....o..o...', 56: 'x..x..x...x..x..', 70: 'oggooggooggooggo', 42: '..x...x...x...x.' } },
  { id: 'garage', name: 'UK garage', kit: '909', bpm: 132, swing: 0.16, rows: { 36: 'x.........x.....x......x..x.....', 38: '....x.......x.......x.......x...', 42: '..x...x...x...x...x...x...x...x.', 70: 'oooooooooooooooooooooooooooooooo' } },
  { id: 'jazz', name: 'Jazz swing', kit: 'Kamer', bpm: 132, swing: 0.33, rows: { 51: 'x...o.x.x...o.x.', 42: '....x.......x...', 36: 'g.......g.......', 38: '..........g.....' } },
];

// Melodisch: [tel, lengte, toonhoogte, velocity]. Akkoorden: Am, F, C, G.
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ROOTS = [45, 41, 48, 43];

function build(fn) {
  const notes = [];
  for (let bar = 0; bar < 4; bar++) fn(bar, notes);
  return notes;
}

export const MELODIC_PATTERNS = [
  { id: 'bass-house', name: 'Housebas (offbeat)', role: 'Bas', instrument: 'fingerbass', bpm: 124,
    notes: build((b, n) => { for (const t of [0.5, 1.5, 2.5, 3.5]) n.push([b * 4 + t, 0.4, ROOTS[b] - 12, 0.85]); }) },
  { id: 'bass-acid', name: 'Acid-lijn', role: 'Bas', preset: 'Acid-bas', bpm: 128,
    notes: build((b, n) => { [0, 0, 12, 0, 7, 0, 12, 10, 0, 0, 12, 0, 7, 3, 12, 0].forEach((o, i) => n.push([b * 4 + i * 0.25, 0.22, ROOTS[b] - 12 + o, i % 4 === 0 ? 0.95 : 0.6])); }) },
  { id: 'bass-808', name: '808-bas', role: 'Bas', preset: 'Sub-bas', bpm: 140,
    notes: build((b, n) => { n.push([b * 4, 1.4, ROOTS[b] - 12, 0.95], [b * 4 + 1.75, 0.7, ROOTS[b] - 12, 0.8], [b * 4 + 2.75, 1, ROOTS[b] - 5, 0.85]); }) },
  { id: 'bass-upright', name: 'Walking bass', role: 'Bas', instrument: 'upright', bpm: 132,
    notes: build((b, n) => { [0, 3, 7, 10].forEach((o, i) => n.push([b * 4 + i, 0.9, ROOTS[b] - 12 + o, i ? 0.7 : 0.85])); }) },
  { id: 'chords-house', name: 'Housepiano-stabs', role: 'Akkoorden', instrument: 'piano', bpm: 124,
    notes: build((b, n) => { for (const t of [0.5, 1.5, 2.5, 3.25]) for (const p of CHORDS[b]) n.push([b * 4 + t, 0.3, p + 12, 0.8]); }) },
  { id: 'chords-rhodes', name: 'Rhodes-akkoorden', role: 'Akkoorden', instrument: 'epiano', bpm: 84,
    notes: build((b, n) => { for (const [t, d, v] of [[0, 1.5, 0.7], [1.75, 0.5, 0.5], [2.5, 1.4, 0.62]]) for (const p of [...CHORDS[b], CHORDS[b][0] + 11]) n.push([b * 4 + t, d, p, v]); }) },
  { id: 'chords-strings', name: 'Strijkers-akkoorden', role: 'Akkoorden', instrument: 'strings', bpm: 100,
    notes: build((b, n) => { for (const p of [ROOTS[b] - 12, ...CHORDS[b]]) n.push([b * 4, 3.95, p, 0.7]); }) },
  { id: 'chords-guitar', name: 'Gitaar-strum', role: 'Akkoorden', instrument: 'nylon', bpm: 96,
    notes: build((b, n) => { [0, 1, 1.5, 2.5, 3].forEach((t, i) => CHORDS[b].forEach((p, j) => n.push([b * 4 + t + j * 0.02, 0.45, p, i === 0 ? 0.8 : 0.6]))); }) },
  { id: 'arp-trance', name: 'Trance-arpeggio', role: 'Arpeggio', preset: 'Pluk', bpm: 138,
    notes: build((b, n) => { const c = [...CHORDS[b], CHORDS[b][0] + 12]; for (let i = 0; i < 16; i++) n.push([b * 4 + i * 0.25, 0.2, c[[0, 1, 2, 3, 2, 1][i % 6]] + 12, i % 4 ? 0.6 : 0.9]); }) },
  { id: 'arp-harp', name: 'Harp-arpeggio', role: 'Arpeggio', instrument: 'harp', bpm: 90,
    notes: build((b, n) => { const c = CHORDS[b]; [c[0] - 12, c[0], c[1], c[2], c[0] + 12, c[2], c[1], c[0]].forEach((p, i) => n.push([b * 4 + i * 0.5, 0.9, p, 0.7])); }) },
  { id: 'lead-vibes', name: 'Vibrafoon-melodie', role: 'Melodie', instrument: 'vibes', bpm: 100,
    notes: [[0, 76], [0.5, 72], [1, 69], [2, 72], [2.5, 74], [4, 72], [4.5, 69], [5, 65], [6, 69], [6.5, 72], [8, 72], [8.5, 76], [9, 79], [10, 76], [12, 74], [12.5, 71], [13, 67], [14, 71]].map(([t, p]) => [t, 0.45, p, 0.75]) },
  { id: 'lead-sax', name: 'Sax-frase', role: 'Melodie', instrument: 'sax', bpm: 96,
    notes: [[0, 1, 69], [1, 0.5, 72], [1.5, 0.5, 74], [2, 1.5, 76], [4, 0.75, 77], [4.75, 0.25, 76], [5, 1, 74], [6, 2, 72], [8, 1, 72], [9, 1, 74], [10, 1.5, 76], [12, 0.5, 79], [12.5, 0.5, 76], [13, 1, 74], [14, 2, 71]].map(([t, d, p]) => [t, d, p, 0.75]) },
];

// Noten van een drumpatroon over `bars` maten, licht gehumaniseerd (voorspelbaar, dus elke keer hetzelfde).
export function drumNotes(pat, { humanize = true } = {}) {
  const r = rng(pat.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const acoustic = ['Studio', 'Kamer', 'Cassette'].includes(pat.kit);
  const bars = Math.max(...Object.values(pat.rows).map((s) => s.length)) / 16;
  const notes = [];
  for (const [pitch, row] of Object.entries(pat.rows)) {
    for (let bar = 0; bar < bars; bar++) {
      for (let i = 0; i < 16; i++) {
        const ch = row[(bar * 16 + i) % row.length];
        if (!VEL[ch]) continue;
        const swing = i % 2 ? (pat.swing || 0) * 0.25 : 0;
        const jitter = humanize && acoustic ? (r() - 0.5) * 0.02 : 0;
        const v = Math.min(1, Math.max(0.08, VEL[ch] + (humanize ? (r() - 0.5) * 0.12 : 0)));
        notes.push({ t: Math.max(0, bar * 4 + i / 4 + swing + jitter), d: 0.25, p: +pitch, v });
      }
    }
  }
  for (const [step, pitch, count] of pat.rolls || []) {
    for (let k = 0; k < count; k++) notes.push({ t: step / 4 + k * (0.25 / count), d: 0.25 / count, p: pitch, v: 0.4 + 0.4 * (k / count) });
  }
  if (pat.crashFirst) notes.push({ t: 0, d: 0.25, p: 49, v: 0.85 });
  return { notes: notes.sort((a, b) => a.t - b.t), length: bars * 4 };
}

export function melodicNotes(pat) {
  const notes = pat.notes.map(([t, d, p, v]) => ({ t, d, p, v }));
  const length = Math.max(4, Math.ceil(Math.max(...notes.map((n) => n.t + n.d)) / 4) * 4);
  return { notes, length };
}

export const findPattern = (id) => DRUM_PATTERNS.find((p) => p.id === id) || MELODIC_PATTERNS.find((p) => p.id === id) || null;
export const isDrumPattern = (p) => !!p.rows;
