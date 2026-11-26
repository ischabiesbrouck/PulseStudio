// Akkoordenmaker: akkoordprogressies in elke toonsoort, met voicing, uitbreidingen, stemvoering en ritme.
// Pure functies (geen DOM, geen audio), zodat ze ook in node te testen zijn.
//
// Een progressie is een reeks trapnamen (Romeinse cijfers) ten opzichte van de toonladder van de progressie:
//   hoofdletter = groot, kleine letter = klein, met optioneel ♭/b of ♯/# ervoor (geleend akkoord)
//   en erachter: 7, maj7, 9, sus2, sus4, ° (verminderd), ø (halfverminderd), + (overmatig).
// Voorbeeld in A mineur: "i VI III VII" = Am F C G.

export const ROOTS = [['C', 0], ['C♯', 1], ['D♭', 1], ['D', 2], ['E♭', 3], ['E', 4], ['F', 5], ['F♯', 6], ['G♭', 6], ['G', 7], ['A♭', 8], ['A', 9], ['B♭', 10], ['B', 11]];
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
export const MODE_NAMES = { major: 'majeur', minor: 'mineur' };

export const PROGRESSIONS = [
  { id: 'pop', name: 'Pop', mode: 'major', degrees: 'I V vi IV' },
  { id: 'ballad', name: 'Ballade', mode: 'major', degrees: 'vi IV I V' },
  { id: 'doowop', name: 'Jaren vijftig', mode: 'major', degrees: 'I vi IV V' },
  { id: 'royal', name: 'Royal road', mode: 'major', degrees: 'IV V iii vi' },
  { id: 'canon', name: 'Canon', mode: 'major', degrees: 'I V vi iii IV I IV V' },
  { id: 'jazz', name: 'Jazz ii–V–I', mode: 'major', degrees: 'ii7 V7 Imaj7 Imaj7' },
  { id: 'soul', name: 'Soul (met geleende iv)', mode: 'major', degrees: 'I iii IV iv' },
  { id: 'neosoul', name: 'Neo-soul', mode: 'major', degrees: 'IVmaj7 iii7 ii7 Imaj7' },
  { id: 'turnaround', name: 'Turnaround', mode: 'major', degrees: 'I vi ii V' },
  { id: 'rock', name: 'Rock (met ♭VII)', mode: 'major', degrees: 'I ♭VII IV I' },
  { id: 'epic', name: 'Episch', mode: 'minor', degrees: 'i VI III VII' },
  { id: 'deephouse', name: 'Deep house', mode: 'minor', degrees: 'i VII VI VII' },
  { id: 'andalusian', name: 'Andalusisch', mode: 'minor', degrees: 'i VII VI V' },
  { id: 'minorpop', name: 'Mineur pop', mode: 'minor', degrees: 'i iv VII III' },
  { id: 'dark', name: 'Donker', mode: 'minor', degrees: 'i VI iv V' },
  { id: 'lofi', name: 'Lo-fi ii–V–i', mode: 'minor', degrees: 'iiø7 V7 i7 i7' },
  { id: 'trance', name: 'Trance', mode: 'minor', degrees: 'i VI III VII i VI iv V' },
  { id: 'drama', name: 'Drama', mode: 'minor', degrees: 'i iv v i' },
];

export const RHYTHMS = [
  ['sustain', 'Lang aangehouden'],
  ['halves', 'Halve noten'],
  ['quarters', 'Kwartnoten'],
  ['pop', 'Pop (3-3-2)'],
  ['deephouse', 'Deep house'],
  ['offbeat', 'House-stabs (na de tel)'],
  ['arp', 'Arpeggio (zestienden)'],
  ['broken', 'Gebroken (achtsten)'],
  ['strum', 'Strum (gitaar)'],
];
export const VOICINGS = [['close', 'Dicht'], ['open', 'Open'], ['wide', 'Breed']];
export const EXTENSIONS = [['triad', 'Drieklank'], ['7', '7'], ['9', '9']];

export const DEFAULT_SETTINGS = { root: 9, progression: 'epic', rhythm: 'sustain', voicing: 'close', extension: 'triad', bars: 1, octave: 4, bass: true, custom: '', customMode: 'minor' };

// ---------- Trapnamen ontleden ----------

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// "♭VIImaj7" → { acc: -1, degree: 6, minor: false, quality: 'maj7' }; geeft null bij onzin.
export function parseNumeral(token) {
  const m = /^([♭b♯#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(token.trim());
  if (!m) return null;
  const degree = NUMERALS.indexOf(m[2].toUpperCase());
  const rest = m[3].split('/')[0];
  if (!/^(maj7|maj9|m7|7|9|sus2|sus4|°7|°|ø7|ø|\+|add9|6)?$/.test(rest)) return null;
  return { acc: m[1] === '♭' || m[1] === 'b' ? -1 : m[1] === '♯' || m[1] === '#' ? 1 : 0, degree, minor: m[2] === m[2].toLowerCase(), suffix: rest, slash: m[3].includes('/') ? m[3].split('/')[1] : null };
}

export function parseProgression(text) {
  const tokens = text.split(/[\s,–-]+/).filter(Boolean);
  const out = tokens.map(parseNumeral);
  return out.every(Boolean) && out.length ? out : null;
}

// ---------- Akkoorden bouwen ----------

const mod = (x, n) => ((x % n) + n) % n;

// Toonhoogteklassen (0-11, vanaf de grondtoon van het akkoord) en een naam, bijv. { root: 9, tones: [0, 3, 7, 10], name: 'Am7' }.
export function chordOf(num, key, mode, extension = 'triad') {
  const scale = SCALES[mode];
  const rootPc = mod(key + scale[num.degree] + num.acc, 12);
  // Diatonisch? Dan stapelen we tertsen uit de toonladder (dus Imaj7 in majeur, i7 in mineur, V7 vanzelf).
  const fromScale = (steps) => scale[(num.degree + steps) % 7] + 12 * Math.floor((num.degree + steps) / 7) - scale[num.degree];
  const diatonicThird = fromScale(2), diatonicFifth = fromScale(4);
  const wantThird = num.minor ? 3 : 4;
  const s = num.suffix;
  let tones;
  if (s === '°' || s === '°7') tones = [0, 3, 6, ...(s === '°7' ? [9] : [])];
  else if (s === 'ø' || s === 'ø7') tones = [0, 3, 6, 10];
  else if (s === '+') tones = [0, 4, 8];
  else if (s === 'sus2') tones = [0, 2, 7];
  else if (s === 'sus4') tones = [0, 5, 7];
  else tones = [0, wantThird, num.minor && diatonicFifth === 6 && num.acc === 0 ? 6 : 7];
  const diatonic = num.acc === 0 && diatonicThird === wantThird;
  const seventh = () => {
    if (s === 'maj7' || s === 'maj9') return 11;
    if (s === '7' || s === '9' || s === 'm7') return 10;
    if (diatonic) return fromScale(6) % 12;
    return num.minor ? 10 : num.degree === 4 ? 10 : 11; // geleend groot akkoord: maj7, behalve een dominant
  };
  const explicit7 = /7|9/.test(s) && !/°$|^ø$/.test(s);
  if (s === '6') tones.push(9);
  if (s === 'add9') tones.push(14);
  if (explicit7 || ((extension === '7' || extension === '9') && !/sus|°|ø|\+|6|add9/.test(s))) if (!tones.includes(seventh()) && !tones.includes(9)) tones.push(seventh());
  // Een kleine none (op iii en vii) klinkt hard: dan laten we de 9 weg.
  if ((s === '9' || s === 'maj9' || extension === '9') && !/°|ø|\+|add9/.test(s)) { const nine = diatonic ? fromScale(8) : 14; if (nine === 14) tones.push(14); }
  const unique = [...new Set(tones)].sort((a, b) => a - b);
  return { root: rootPc, tones: unique, name: chordName(rootPc, unique, key, mode, num.acc) };
}

// Met mollen of kruisen spellen, zoals in de toonsoort (F, B♭, E♭, A♭, D♭, G♭ groot en hun mineur gebruiken mollen).
// Een verlaagde trap (♭VII) krijgt altijd een mol, een verhoogde een kruis.
export const spell = (pc, key, mode, acc = 0) => (acc < 0 || (acc === 0 && [5, 10, 3, 8, 1, 6].includes(mode === 'minor' ? mod(key + 3, 12) : key)) ? FLAT_NAMES : SHARP_NAMES)[mod(pc, 12)];

function chordName(rootPc, tones, key, mode, acc = 0) {
  const n = spell(rootPc, key, mode, acc);
  const has = (x) => tones.includes(x) || tones.includes(x + 12);
  const minor = has(3) && !has(4);
  let q = '';
  if (has(3) && has(6) && has(10)) q = 'm7♭5';
  else if (has(3) && has(6)) q = has(9) ? '°7' : '°';
  else if (has(4) && has(8)) q = '+';
  else if (has(2) && !has(3) && !has(4)) q = 'sus2';
  else if (has(5) && !has(3) && !has(4)) q = 'sus4';
  else {
    q = minor ? 'm' : '';
    if (has(11)) q += minor ? 'maj7' : 'maj7';
    else if (has(10)) q += '7';
    else if (has(9) && !has(10)) q += '6';
    if (tones.includes(14) || tones.includes(13) || tones.includes(15)) q = q.includes('7') ? q.replace('7', '9') : `${q}add9`;
  }
  return n + q;
}

// ---------- Voicing en stemvoering ----------

// Alle omkeringen van een akkoord rond `center`; kies die het dichtst bij het vorige akkoord ligt.
function closeCandidates(root, tones, center) {
  const pcs = tones.map((t) => mod(root + t, 12));
  const ext = tones.filter((t) => t > 12).map((t) => mod(root + t, 12)); // 9 boven in de stapel
  const base = [...new Set(pcs.filter((p, i) => tones[i] <= 12))];
  const out = [];
  for (let inv = 0; inv < base.length; inv++) {
    const order = [...base.slice(inv), ...base.slice(0, inv)];
    for (let oct = -2; oct <= 2; oct++) {
      const notes = [];
      let prev = -Infinity;
      for (const pc of order) {
        let p = Math.floor(center / 12) * 12 + oct * 12 + pc;
        while (p <= prev) p += 12;
        notes.push(p);
        prev = p;
      }
      for (const pc of ext) { let p = notes[notes.length - 1] - 12 + mod(pc - notes[notes.length - 1], 12); while (p <= notes[notes.length - 1]) p += 12; notes.push(p); }
      out.push(notes);
    }
  }
  return out;
}
const movement = (a, b) => {
  if (!a) return 0;
  let s = 0;
  for (const n of b) s += Math.min(...a.map((x) => Math.abs(x - n)));
  return s;
};

export function voiceProgression(chords, { voicing = 'close', octave = 4, bass = true } = {}) {
  const center = (octave + 1) * 12 + 4; // ongeveer E4 bij octaaf 4
  let prev = null;
  return chords.map((c) => {
    const cands = closeCandidates(c.root, c.tones, center).filter((n) => n[0] >= center - 9 && n[0] <= center + 4);
    const pick = cands.reduce((best, n) => {
      const cost = movement(prev, n) + Math.abs((n[0] + n[n.length - 1]) / 2 - center) * (prev ? 0.3 : 1);
      return !best || cost < best.cost ? { n, cost } : best;
    }, null).n;
    prev = pick;
    let notes = [...pick];
    if (voicing === 'open' && notes.length >= 3) notes = [notes[notes.length - 2] - 12, ...notes.filter((_, i) => i !== notes.length - 2)];
    if (voicing === 'wide' && notes.length >= 3) notes = [notes[0], notes[2], notes[1] + 12, ...notes.slice(3).map((p) => p + 12)];
    const bassNote = bass || voicing === 'wide' ? [(octave - 1) * 12 + 12 + c.root - (c.root > 4 ? 12 : 0)] : [];
    return [...bassNote, ...notes.sort((a, b) => a - b)].filter((p, i, a) => a.indexOf(p) === i);
  });
}

// ---------- Ritme ----------

let seed = 1;
const wobble = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.08; };

function hitsFor(rhythm, len) {
  // [begin, lengte, sterkte] binnen één akkoord van `len` tellen.
  const per = (pattern) => { const out = []; for (let b = 0; b < len; b += 4) for (const [t, d, v] of pattern) if (b + t < len) out.push([b + t, Math.min(d, len - b - t), v]); return out; };
  switch (rhythm) {
    case 'halves': return per([[0, 1.9, 0.75], [2, 1.9, 0.62]]);
    case 'quarters': return per([[0, 0.8, 0.75], [1, 0.8, 0.55], [2, 0.8, 0.65], [3, 0.8, 0.55]]);
    case 'pop': return per([[0, 1.4, 0.75], [1.5, 1, 0.6], [2.5, 1.4, 0.68]]);
    case 'deephouse': return per([[0, 0.7, 0.68], [1.5, 0.45, 0.52], [2.75, 0.6, 0.6], [3.5, 0.4, 0.48]]);
    case 'offbeat': return per([[0.5, 0.3, 0.7], [1.5, 0.3, 0.6], [2.5, 0.3, 0.66], [3.5, 0.3, 0.58]]);
    default: return [[0, len - 0.05, 0.72]];
  }
}

// ---------- Alles samen ----------

export function progressionOf(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (s.progression === 'custom') {
    const parsed = parseProgression(s.custom || '');
    return parsed ? { name: 'Eigen reeks', mode: s.customMode, nums: parsed } : null;
  }
  const p = PROGRESSIONS.find((x) => x.id === s.progression) || PROGRESSIONS[0];
  return { name: p.name, mode: p.mode, nums: parseProgression(p.degrees) };
}

// Geeft { notes, length, chords: [{ name, start, notes }], key } of null als de eigen reeks niet klopt.
export function buildProgression(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const prog = progressionOf(s);
  if (!prog) return null;
  const chords = prog.nums.map((num) => chordOf(num, s.root, prog.mode, s.extension));
  const voiced = voiceProgression(chords, s);
  const hasBass = s.bass || s.voicing === 'wide';
  const len = 4 * s.bars;
  const notes = [];
  seed = 7 + s.root;
  voiced.forEach((pitches, i) => {
    const start = i * len;
    if (s.rhythm === 'arp' || s.rhythm === 'broken') {
      const step = s.rhythm === 'arp' ? 0.25 : 0.5;
      const up = pitches.slice(hasBass ? 1 : 0);
      const top = up[up.length - 1] + 12;
      const order = s.rhythm === 'arp' ? [...up, ...(top <= 88 ? [top] : []), ...up.slice(1).reverse()] : [...up, ...up.slice(1, -1).reverse()];
      if (hasBass) notes.push({ t: start, d: len - 0.05, p: pitches[0], v: 0.62 });
      for (let k = 0; k * step < len; k++) notes.push({ t: start + k * step, d: step * 0.9, p: order[k % order.length], v: Math.max(0.2, Math.min(1, (k % 4 === 0 ? 0.72 : 0.55) + wobble())) });
      return;
    }
    for (const [t, d, v] of hitsFor(s.rhythm, len)) {
      pitches.forEach((p, j) => {
        const strum = s.rhythm === 'strum' ? j * 0.03 : j * 0.004;
        notes.push({ t: start + t + strum, d: Math.max(0.1, d - strum), p, v: Math.max(0.2, Math.min(1, v - j * 0.015 + wobble())) });
      });
    }
  });
  return {
    notes: notes.map((n) => ({ ...n, t: Math.round(n.t * 1000) / 1000, d: Math.round(n.d * 1000) / 1000 })),
    length: voiced.length * len,
    chords: chords.map((c, i) => ({ name: c.name, start: i * len, notes: voiced[i] })),
    name: prog.name, mode: prog.mode,
    key: `${spell(s.root, s.root, prog.mode)} ${MODE_NAMES[prog.mode]}`,
  };
}

// De akkoordnamen van een progressie in een toonsoort, voor de lijst ("Am F C G").
export function chordNames(settings) {
  const r = buildProgression({ ...settings, rhythm: 'sustain' });
  return r ? r.chords.map((c) => c.name).join(' ') : '';
}
