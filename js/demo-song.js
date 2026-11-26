// Voorbeeldnummer "Nachtlicht": melodische deep house in A mineur, 122 BPM, 84 maten (ongeveer 2:45).
//
//   maat  1–8    intro       kick en hihats, pad, later het arpeggio
//   maat  9–24   couplet     groove, bas, Rhodes-akkoorden; vanaf maat 17 het arpeggio
//   maat 25–32   opbouw      claproffel die versnelt, riser, alles houdt in op de laatste tel
//   maat 33–48   drop        alles erin, met de leadmelodie
//   maat 49–56   breakdown   vleugel met een eigen melodie, pad, geen drums
//   maat 57–60   opbouw 2    vleugelakkoorden in achtsten, roffel, riser
//   maat 61–76   drop 2      volle drop met vleugelstabs, ride en een hogere melodie
//   maat 77–84   outro       de lagen gaan er een voor een uit
//
// Alles is gewone, bewerkbare clips en effecten; galm en echo lopen via de return-sporen.
import { createProject, createTrack, createClip, defaultSynth, defaultDrums, defaultSampler } from './model.js';
import { createInsert } from './audio/plugin-defs.js';
import { rng } from './audio/dsp.js';

const BAR = 4;

// Akkoorden (stemmingen dicht bij elkaar, zodat de akkoorden soepel in elkaar overlopen) en grondtonen voor de bas.
const CH = {
  Am9: { v: [60, 64, 67, 71], root: 33 },  // A: C E G B
  Fmaj9: { v: [57, 60, 64, 67], root: 29 }, // F: A C E G
  Cadd9: { v: [55, 60, 62, 64], root: 36 }, // C: G C D E
  G6: { v: [55, 59, 62, 64], root: 31 },    // G: G B D E
  Fmaj7: { v: [57, 60, 64, 65], root: 29 },
  Gadd9: { v: [55, 59, 62, 69], root: 31 }, // G: G B D A

  Em7: { v: [55, 59, 62, 64], root: 28 },
  Am7: { v: [55, 60, 64, 67], root: 33 },
};
const MAIN = [CH.Am9, CH.Fmaj9, CH.Cadd9, CH.G6];
const BREAK = [CH.Fmaj7, CH.Gadd9, CH.Em7, CH.Am7];

const n = (t, p, v, d = 0.25) => ({ t, d, p, v: Math.max(0.05, Math.min(1, v)) });
const clip = (kind, startBar, bars, patternBars, name, notes) =>
  createClip(kind, startBar * BAR, bars * BAR, { pattern: patternBars * BAR, name, notes });

// ---------- Drums (909) ----------

const K = 36, SN = 38, CL = 39, RIM = 37, CH_ = 42, OH = 46, SH = 70, CR = 49, RD = 51, TH = 50, TL = 45;

function kicks(notes, bar, skipLast = false, level = 1) {
  for (let b = 0; b < 4; b++) if (!(skipLast && b === 3)) notes.push(n(bar * BAR + b, K, (b === 0 ? 1 : 0.93) * level));
}
function hats(notes, bar, r, { open = true, sixteenths = true, level = 1 } = {}) {
  for (let s = 0; s < 16; s++) {
    const t = bar * BAR + s * 0.25;
    if (s % 4 === 2) { if (open) notes.push(n(t, OH, (0.5 + r() * 0.08) * level, 0.2)); else notes.push(n(t, CH_, (0.55 + r() * 0.1) * level)); }
    else if (sixteenths && s % 2 === 1) notes.push(n(t, CH_, (0.28 + r() * 0.14 + (s % 4 === 3 ? 0.06 : 0)) * level));
  }
}
function claps(notes, bar, v = 0.82, snare = false) {
  for (const b of [1, 3]) { notes.push(n(bar * BAR + b, CL, v)); if (snare) notes.push(n(bar * BAR + b, SN, v * 0.5)); }
}

function drumIntro() {
  const r = rng(11), notes = [];
  for (let bar = 0; bar < 8; bar++) {
    kicks(notes, bar);
    hats(notes, bar, r, { open: false, sixteenths: bar >= 4, level: 0.8 + bar * 0.03 });
    if (bar === 7) notes.push(n(bar * BAR + 3.5, CL, 0.5), n(bar * BAR + 3.75, CL, 0.65));
  }
  return notes;
}

function drumGroove(r, { drop = false } = {}) {
  const notes = [];
  for (let bar = 0; bar < 4; bar++) {
    // Het couplet iets zachter dan de drop, zodat de drop echt binnenkomt.
    kicks(notes, bar, false, drop ? 1 : 0.9);
    claps(notes, bar, drop ? 0.88 : 0.72, drop);
    hats(notes, bar, r, { open: true, sixteenths: true, level: drop ? 1 : 0.8 });
    // Kleine variatie aan het eind van elke vier maten.
    if (bar === 3) notes.push(n(bar * BAR + 3.75, CL, 0.45), ...(drop ? [n(bar * BAR + 2.75, K, 0.6)] : []));
  }
  return notes;
}

function drumBuild(bars, seed) {
  const r = rng(seed), notes = [];
  for (let bar = 0; bar < bars; bar++) {
    const fromEnd = bars - bar;
    // Een opbouw bouwt op naar de drop: hij mag spannend zijn, maar niet luider dan wat erna komt.
    // De kick valt de laatste vier maten weg, zodat hij in de drop weer binnenkomt.
    if (fromEnd > 4) kicks(notes, bar, false, 0.7);
    // Dun gehouden: de compressor op de drums trekt zachtere slagen toch weer op, dus minder slagen in plaats van zachter.
    hats(notes, bar, r, { open: fromEnd > 4, sixteenths: false, level: 0.4 });
    // Roffel: kwarten → achtsten → zestienden, steeds harder; de laatste tel is stil.
    const step = fromEnd > 4 ? 1 : fromEnd > 1 ? 0.5 : 0.25;
    for (let t = 0; t < 4; t += step) {
      if (fromEnd === 1 && t >= 3) break;
      const prog = (bar * 4 + t) / (bars * 4);
      notes.push(n(bar * BAR + t, CL, 0.12 + prog * 0.3, 0.2));
      if (step < 0.5) notes.push(n(bar * BAR + t, SN, 0.15 + prog * 0.35, 0.2));
    }
  }
  // De laatste tel helemaal stil: de spanning vlak voor de drop.
  return notes.filter((x) => x.t < bars * BAR - 1);
}

function drumOutro() {
  const r = rng(21), notes = [];
  for (let bar = 0; bar < 8; bar++) {
    kicks(notes, bar);
    if (bar < 4) claps(notes, bar, 0.7);
    hats(notes, bar, r, { open: bar < 4, sixteenths: bar < 6, level: 0.9 - bar * 0.07 });
  }
  return notes;
}

// ---------- Percussie (opgenomen studiokit) ----------

function percGroove(r, { ride = false } = {}) {
  const notes = [];
  const acc = [0.5, 0.22, 0.34, 0.24];
  for (let bar = 0; bar < 4; bar++) {
    for (let s = 0; s < 16; s++) notes.push(n(bar * BAR + s * 0.25, SH, acc[s % 4] + r() * 0.06));
    notes.push(n(bar * BAR + 1.75, RIM, 0.5), n(bar * BAR + (bar % 2 ? 3.25 : 2.75), RIM, 0.42));
    if (ride) for (let b = 0; b < 4; b++) notes.push(n(bar * BAR + b + 0.5, RD, 0.32 + r() * 0.05, 0.5));
  }
  return notes;
}
const crash = (v = 0.75) => [n(0, CR, v, 2)];
function tomFill(bars) {
  // Tomroffel in de laatste maat van een opbouw.
  const last = (bars - 1) * BAR;
  return [n(last + 2, TH, 0.6), n(last + 2.25, TH, 0.55), n(last + 2.5, TL, 0.65), n(last + 2.75, TL, 0.7)];
}

// ---------- Bas ----------

function bassLine(prog, { busy = false, level = 1 } = {}) {
  const notes = [];
  prog.forEach((c, bar) => {
    const r0 = c.root + 12, o = bar * BAR;
    const hits = busy
      ? [[0, 0.4, 0, 0.95], [0.75, 0.2, 0, 0.7], [1.5, 0.4, 12, 0.85], [2.25, 0.2, 0, 0.7], [2.5, 0.4, 0, 0.9], [3.25, 0.2, 7, 0.75], [3.5, 0.4, 12, 0.8]]
      : [[0, 0.45, 0, 0.9], [1.5, 0.4, 12, 0.8], [2.5, 0.45, 0, 0.85], [3.5, 0.4, 7, 0.75]];
    for (const [t, d, add, v] of hits) notes.push(n(o + t, r0 + add, v * level, d));
  });
  return notes;
}

// ---------- Akkoorden ----------

// Rhodes: korte, swingende aanslagen, zoals bij deep house.
function rhodesComp(prog, level = 1) {
  const notes = [];
  prog.forEach((c, bar) => {
    for (const [t, d, v] of [[0, 0.7, 0.62], [1.5, 0.45, 0.48], [2.75, 0.6, 0.56], [3.5, 0.4, 0.44]]) {
      c.v.forEach((p, i) => notes.push(n(bar * BAR + t + i * 0.008, p, (v - i * 0.02) * level, d)));
    }
  });
  return notes;
}
const sustained = (prog, octave = 0, v = 0.6, d = BAR) => prog.flatMap((c, bar) => c.v.map((p) => n(bar * BAR, p + octave, v, d)));

// Vleugel: akkoordstabs na de tel in de tweede drop.
function pianoStabs(prog) {
  const notes = [];
  prog.forEach((c, bar) => {
    for (const t of [0.5, 2.5]) c.v.forEach((p) => notes.push(n(bar * BAR + t, p + 12, 0.55, 0.3)));
  });
  return notes;
}

// Vleugel in de opbouw: akkoorden in achtsten die steeds harder worden.
// (Ook in de breakdown staat de grondtoon in de linkerhand; de rechterhand speelt de melodie.)
function pianoBuild(prog) {
  const notes = [];
  prog.forEach((c, bar) => {
    for (let t = 0; t < 4; t += 0.5) {
      const v = 0.11 + ((bar * 8 + t * 2) / 32) * 0.22;
      c.v.forEach((p) => notes.push(n(bar * BAR + t, p, v, 0.4)));
      notes.push(n(bar * BAR + t, c.root + 12, v * 0.9, 0.4));
    }
  });
  return notes;
}

// ---------- Arpeggio ----------

function arp(prog, seed, level = 1) {
  const r = rng(seed), notes = [];
  const order = [0, 1, 2, 3, 2, 1, 3, 2];
  prog.forEach((c, bar) => {
    const tones = c.v.map((p) => p + 12);
    for (let s = 0; s < 16; s++) {
      const p = tones[order[s % 8]] + (s === 14 ? 12 : 0);
      notes.push(n(bar * BAR + s * 0.25, p, ((s % 4 === 0 ? 0.78 : 0.55) + r() * 0.08) * level, 0.22));
    }
  });
  return notes;
}

// ---------- Melodieën ----------

// Hoofdthema over Am9–Fmaj9–Cadd9–G6; tweede helft eindigt hoger.
const THEME_A = [
  [0, 76, 0.5], [0.75, 74, 0.25], [1, 72, 0.5], [1.5, 69, 0.5], [2.5, 72, 0.5], [3, 74, 0.75],
  [4, 72, 0.5], [4.5, 69, 0.5], [5, 67, 0.5], [5.5, 69, 1.5], [7.5, 72, 0.5],
  [8, 76, 0.5], [8.75, 74, 0.25], [9, 76, 0.5], [9.5, 79, 0.5], [10.5, 76, 0.5], [11, 74, 1],
  [12, 74, 0.5], [12.5, 72, 0.5], [13, 71, 0.5], [13.5, 67, 0.5], [14, 69, 1.5], [15.5, 71, 0.5],
];
const THEME_B_END = [[12, 79, 0.5], [12.5, 76, 0.5], [13, 74, 0.5], [13.5, 76, 2.5]];
function theme(octave = 0, accent = 1) {
  const a = THEME_A.map(([t, p, d]) => n(t, p + octave, (0.78 + (t % 1 === 0 ? 0.1 : 0)) * accent, d * 0.95));
  const b = [...THEME_A.filter(([t]) => t < 12), ...THEME_B_END].map(([t, p, d]) => n(16 + t, p + octave, (0.8 + (t % 1 === 0 ? 0.1 : 0)) * accent, d * 0.95));
  return [...a, ...b];
}

// Breakdownmelodie voor de vleugel, over Fmaj7–Gsus–Em7–Am7, met de akkoorden in de linkerhand.
function pianoBreakdown() {
  const mel = [
    [0, 72, 1.5], [1.5, 69, 0.5], [2, 67, 1], [3, 69, 1],
    [4, 71, 1.5], [5.5, 74, 0.5], [6, 71, 1], [7, 67, 1],
    [8, 76, 2], [10, 74, 0.5], [10.5, 71, 0.5], [11, 67, 1],
    [12, 69, 3], [15, 71, 0.5], [15.5, 72, 0.5],
  ];
  const notes = [];
  for (const rep of [0, 1]) {
    const o = rep * 16, lift = rep ? 12 : 0;
    // Zacht gespeeld: de breakdown is de rustpunt van het nummer (een zachte vleugel klinkt ook ronder).
    for (const [t, p, d] of mel) notes.push(n(o + t, p + lift, 0.36 + (t % 2 === 0 ? 0.05 : 0), d));
    BREAK.forEach((c, bar) => {
      notes.push(n(o + bar * BAR, c.root + 12, 0.3, 3.8), n(o + bar * BAR, c.root + 24, 0.26, 3.8));
      c.v.slice(0, 3).forEach((p, i) => notes.push(n(o + bar * BAR + 0.5 + i * 0.12, p - 12, 0.22, 3.2)));
    });
  }
  return notes;
}

// ---------- Het nummer ----------

export function demoSong() {
  const p = createProject('Nachtlicht (voorbeeld)');
  p.bpm = 122;
  p.loop = { on: false, start: 128, end: 192 };
  p.masterVolume = 0;
  p.masterInserts = [
    createInsert('eq', { lowCut: 24, lowFreq: 90, low: 0.5, midFreq: 350, mid: -1, midQ: 0.9, highFreq: 10000, high: 1 }),
    createInsert('multiband', { lowX: 160, highX: 4200, threshold: -15, ratio: 1.8, attack: 0.02, release: 0.2, low: 0.5, mid: 0, high: 0.5 }),
    createInsert('maximizer', { gain: 2, ceiling: -1, release: 0.1 }),
  ];
  const [verb, echo] = p.returns;
  verb.inserts = [createInsert('plate', { decay: 0.74, predelay: 0.022, tone: 9500, damping: 6000, mod: 0.55, mix: 1 }), createInsert('eq', { lowCut: 220, highFreq: 9000, high: -2 })];
  echo.inserts = [createInsert('delay', { time: 0.75, feedback: 0.38, tone: 3800, pingpong: true, mix: 1 }), createInsert('eq', { lowCut: 300 })];
  const track = (kind, name, init) => { const t = createTrack(kind, p.tracks.length, name); init(t); p.tracks.push(t); return t; };
  const sends = (t, v, e) => { t.sends = {}; if (v != null) t.sends[verb.id] = v; if (e != null) t.sends[echo.id] = e; };

  // Drums
  track('drums', 'Drums', (t) => {
    t.drums = defaultDrums('909');
    t.volume = -4;
    t.inserts = [
      createInsert('transient', { attack: 0.3, sustain: -0.15, output: 0 }),
      createInsert('comp', { threshold: -16, ratio: 3, attack: 0.012, release: 0.12, makeup: 2.5 }),
      createInsert('sat', { drive: 5, tone: 12000, mix: 0.35, output: -0.5 }),
    ];
    sends(t, -24, null);
    t.clips.push(
      clip('drums', 0, 8, 8, 'Intro', drumIntro()),
      clip('drums', 8, 16, 4, 'Groove', drumGroove(rng(3))),
      clip('drums', 24, 8, 8, 'Opbouw', drumBuild(8, 5)),
      clip('drums', 32, 16, 4, 'Drop', drumGroove(rng(7), { drop: true })),
      clip('drums', 56, 4, 4, 'Opbouw 2', drumBuild(4, 9)),
      clip('drums', 60, 16, 4, 'Drop 2', drumGroove(rng(13), { drop: true })),
      clip('drums', 76, 8, 8, 'Outro', drumOutro()),
    );
  });

  // Percussie met de opgenomen studiokit
  track('drums', 'Percussie', (t) => {
    t.drums = { ...defaultDrums('Studio'), level: 0.8 };
    t.volume = -11;
    t.pan = 0.12;
    t.inserts = [createInsert('eq', { lowCut: 180, highFreq: 8000, high: 1.5 })];
    sends(t, -15, null);
    t.clips.push(
      clip('drums', 8, 16, 4, 'Shaker', percGroove(rng(31))),
      clip('drums', 31, 1, 1, 'Tomroffel', tomFill(1)),
      clip('drums', 32, 1, 1, 'Crash', crash(0.8)),
      clip('drums', 33, 15, 4, 'Shaker', percGroove(rng(33))),
      clip('drums', 48, 1, 1, 'Crash', crash(0.45)),
      clip('drums', 59, 1, 1, 'Tomroffel', tomFill(1)),
      clip('drums', 60, 1, 1, 'Crash', crash(0.85)),
      clip('drums', 61, 15, 4, 'Shaker en ride', percGroove(rng(35), { ride: true })),
      clip('drums', 76, 1, 1, 'Crash', crash(0.6)),
    );
  });

  // Bas
  track('synth', 'Bas', (t) => {
    t.synth = { ...defaultSynth('Bas'), cutoff: 520, envAmt: 1400, reso: 6, drive: 0.25 };
    t.volume = -8;
    t.inserts = [
      createInsert('eq', { lowCut: 32, lowFreq: 70, low: 1.5, midFreq: 600, mid: 1.5, midQ: 1, highFreq: 4000, high: -3 }),
      createInsert('pump', { amount: 0.5, rate: 1, release: 0.55 }),
      createInsert('sat', { drive: 6, tone: 7000, mix: 0.3, output: -1 }),
    ];
    t.clips.push(
      clip('synth', 8, 16, 4, 'Baslijn', bassLine(MAIN, { level: 0.85 })),
      clip('synth', 24, 6, 4, 'Baslijn', bassLine(MAIN, { level: 0.7 })),
      clip('synth', 32, 16, 4, 'Bas drop', bassLine(MAIN, { busy: true })),
      clip('synth', 52, 4, 4, 'Lange bas', BREAK.map((c, bar) => n(bar * BAR, c.root + 12, 0.4, 3.8))),
      clip('synth', 60, 16, 4, 'Bas drop', bassLine(MAIN, { busy: true })),
      clip('synth', 76, 4, 4, 'Baslijn', bassLine(MAIN, { level: 0.75 })),
    );
  });

  // Rhodes-akkoorden (opgenomen elektrische piano)
  track('sampler', 'Rhodes', (t) => {
    t.sampler = { ...defaultSampler('epiano'), release: 0.35 };
    t.volume = -9;
    t.inserts = [
      createInsert('eq', { lowCut: 160, midFreq: 400, mid: -2, midQ: 1, highFreq: 6000, high: 1.5 }),
      createInsert('ensemble', { mode: 1, width: 1, mix: 0.35 }),
      createInsert('pump', { amount: 0.45, rate: 1, release: 0.6 }),
    ];
    sends(t, -12, -20);
    t.clips.push(
      clip('sampler', 8, 16, 4, 'Akkoorden', rhodesComp(MAIN, 0.85)),
      clip('sampler', 24, 8, 4, 'Akkoorden', rhodesComp(MAIN, 0.55)),
      clip('sampler', 32, 16, 4, 'Akkoorden', rhodesComp(MAIN)),
      clip('sampler', 60, 16, 4, 'Akkoorden', rhodesComp(MAIN)),
      clip('sampler', 76, 8, 4, 'Lang', sustained(MAIN, 0, 0.5, 3.9)),
    );
  });

  // Pad
  track('synth', 'Pad', (t) => {
    t.synth = defaultSynth('Warme pad');
    t.volume = -17;
    t.inserts = [createInsert('eq', { lowCut: 220, highFreq: 7000, high: -2 }), createInsert('width', { width: 1.5 }), createInsert('pump', { amount: 0.55, rate: 1, release: 0.7 })];
    sends(t, -9, null);
    t.clips.push(
      clip('synth', 0, 8, 4, 'Pad', sustained(MAIN, 0, 0.55)),
      clip('synth', 24, 8, 4, 'Pad', sustained(MAIN, 0, 0.45)),
      clip('synth', 48, 8, 4, 'Pad', sustained(BREAK, 0, 0.42)),
      clip('synth', 56, 4, 4, 'Pad', sustained(MAIN, 0, 0.45)),
      clip('synth', 60, 16, 4, 'Pad', sustained(MAIN, 12, 0.45)),
      clip('synth', 76, 8, 4, 'Pad', sustained(MAIN, 0, 0.55)),
    );
  });

  // Arpeggio
  track('synth', 'Arpeggio', (t) => {
    t.synth = { ...defaultSynth('Pluk'), cutoff: 1100, envAmt: 4200 };
    t.volume = -16;
    t.pan = -0.15;
    t.inserts = [createInsert('eq', { lowCut: 320 }), createInsert('autofilter', { type: 'lowpass', cutoff: 2600, reso: 2, rate: 8, depth: 0.35 })];
    sends(t, -14, -8);
    t.clips.push(
      clip('synth', 4, 4, 4, 'Arpeggio', arp(MAIN, 41, 0.75)),
      clip('synth', 16, 8, 4, 'Arpeggio', arp(MAIN, 43, 0.9)),
      clip('synth', 32, 16, 4, 'Arpeggio', arp(MAIN, 45)),
      clip('synth', 56, 4, 4, 'Arpeggio', arp(MAIN, 47, 0.5)),
      clip('synth', 60, 16, 4, 'Arpeggio', arp(MAIN, 49)),
    );
  });

  // Lead
  track('synth', 'Lead', (t) => {
    t.synth = { ...defaultSynth('Supersaw'), cutoff: 2800, attack: 0.008, release: 0.25, gain: 0.4 };
    t.volume = -12.5; // de lead speelt alleen in de drops: daar mag hij erbovenop
    t.inserts = [createInsert('eq', { lowCut: 260, midFreq: 2500, mid: -1.5, midQ: 1.2, highFreq: 9000, high: -1 }), createInsert('tape', { drive: 3, bump: 0, tone: 12000, wow: 0.1, flutter: 0.1, mix: 1 })];
    sends(t, -10, -9);
    t.clips.push(
      clip('synth', 32, 16, 8, 'Thema', theme(0)),
      clip('synth', 60, 16, 8, 'Thema in octaven', [...theme(0), ...theme(12, 0.5)]),
    );
  });

  // Vleugel (Salamander)
  track('sampler', 'Vleugel', (t) => {
    t.sampler = { ...defaultSampler('piano'), release: 0.7 };
    t.volume = -9.5; // de breakdown is het rustpunt; de stabs in drop 2 krijgen een hogere aanslag
    t.inserts = [createInsert('eq', { lowCut: 70, midFreq: 300, mid: -1.5, midQ: 1, highFreq: 8000, high: 1 }), createInsert('comp', { threshold: -20, ratio: 2.5, attack: 0.01, release: 0.2, makeup: 2 })];
    sends(t, -8, -22);
    t.clips.push(
      clip('sampler', 48, 8, 8, 'Breakdown', pianoBreakdown()),
      clip('sampler', 56, 4, 4, 'Opbouw', pianoBuild(MAIN)),
      clip('sampler', 60, 16, 4, 'Stabs', pianoStabs(MAIN)),
    );
  });

  // Riser: ruis en zaagtanden met een filter dat langzaam opengaat.
  track('synth', 'Riser', (t) => {
    t.synth = {
      ...defaultSynth('Pad'), wave1: 'sawtooth', unison: 5, uniDetune: 45, uniSpread: 1, mix: 0, noise: 0.85,
      filterType: 'lowpass', slope: 24, cutoff: 160, reso: 4, envAmt: 11000, fAttack: 7.6, fDecay: 0.2, fSustain: 1,
      attack: 6, decay: 0.2, sustain: 1, release: 0.25, lfoTarget: 'amp', lfoAmount: 0, gain: 0.35,
    };
    t.volume = -15;
    t.inserts = [createInsert('eq', { lowCut: 400 }), createInsert('width', { width: 1.8 })];
    sends(t, -6, -14);
    // Vier maten (bijna 8 seconden bij 122 BPM): het filter is net open als de drop begint.
    const swell = [n(0, 69, 0.55, 15.6), n(0, 57, 0.4, 15.6)];
    t.clips.push(clip('synth', 28, 4, 4, 'Riser', swell), clip('synth', 56, 4, 4, 'Riser', swell.map((x) => ({ ...x }))));
  });

  return p;
}
