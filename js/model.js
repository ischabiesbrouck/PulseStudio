// Projectmodel: pure functies zonder browser-API's, zodat ze met node --test te testen zijn.
// Tijd wordt overal in tellen (kwartnoten) uitgedrukt; een maat is 4 tellen (4/4).
import { createInsert, normalizeInsert, defaultMasterInserts, fxToInserts } from './audio/plugin-defs.js';

export const BEATS_PER_BAR = 4;
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const TRACK_COLORS = ['#e0a23b', '#5aa9e6', '#7bc47f', '#d9677a', '#a98ee6', '#4fc1b6', '#e6865a', '#c9c15a'];

// Rijen van de drumcomputer, van boven naar beneden, met General MIDI-nootnummers.
export const DRUM_ROWS = [
  { p: 49, name: 'Crash' },
  { p: 51, name: 'Ride' },
  { p: 46, name: 'Hihat open' },
  { p: 42, name: 'Hihat dicht' },
  { p: 70, name: 'Shaker' },
  { p: 56, name: 'Cowbell' },
  { p: 50, name: 'Tom hoog' },
  { p: 45, name: 'Tom laag' },
  { p: 37, name: 'Rimshot' },
  { p: 39, name: 'Clap' },
  { p: 38, name: 'Snare' },
  { p: 36, name: 'Kick' },
];

// Alle synth-instellingen met hun standaardwaarde; presets overschrijven alleen wat anders is.
export const BASE_SYNTH = {
  wave1: 'sawtooth', unison: 1, uniDetune: 20, uniSpread: 0.7,
  wave2: 'square', osc2Oct: 0, osc2Semi: 0, detune: 7, mix: 0.4,
  fm: 0, fmDecay: 0.4, fmSustain: 0.3, sub: 0, noise: 0,
  filterType: 'lowpass', slope: 12, cutoff: 1800, reso: 2, envAmt: 3000, keyTrack: 0.3,
  fAttack: 0.005, fDecay: 0.3, fSustain: 0.3, drive: 0,
  attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.2,
  lfoWave: 'sine', lfoTarget: 'pitch', lfoRate: 5, lfoAmount: 0,
  gain: 0.5,
};

export const SYNTH_PRESETS = {
  Bas: { cat: 'Bas', wave1: 'sawtooth', wave2: 'sine', osc2Oct: -1, detune: 4, mix: 0.5, cutoff: 420, reso: 8, envAmt: 1600, fDecay: 0.18, fSustain: 0.1, attack: 0.002, decay: 0.18, sustain: 0.35, release: 0.08, gain: 0.7 },
  'Sub-bas': { cat: 'Bas', wave1: 'sine', mix: 0, sub: 0.3, cutoff: 400, reso: 0.5, envAmt: 200, sustain: 1, release: 0.12, drive: 0.2, gain: 0.5 },
  'Reese-bas': { cat: 'Bas', wave1: 'sawtooth', unison: 3, uniDetune: 30, uniSpread: 0.3, wave2: 'sawtooth', osc2Oct: -1, mix: 0.4, slope: 24, cutoff: 700, reso: 3, envAmt: 400, sustain: 1, release: 0.15, lfoTarget: 'filter', lfoRate: 0.3, lfoAmount: 0.25, drive: 0.3, gain: 0.55 },
  'Acid-bas': { cat: 'Bas', wave1: 'sawtooth', mix: 0, cutoff: 300, reso: 16, envAmt: 3500, fDecay: 0.22, fSustain: 0, decay: 0.3, sustain: 0.6, release: 0.05, drive: 0.5, keyTrack: 0.5, gain: 0.5 },
  'FM-bas': { cat: 'Bas', wave1: 'sine', wave2: 'sine', mix: 0, fm: 0.8, fmDecay: 0.25, fmSustain: 0.1, sub: 0.3, cutoff: 2500, envAmt: 1000, sustain: 0.8, release: 0.1, gain: 0.45 },
  Lead: { cat: 'Lead', wave1: 'sawtooth', wave2: 'square', detune: 12, mix: 0.4, cutoff: 1800, reso: 6, envAmt: 3500, fDecay: 0.25, fSustain: 0.4, attack: 0.005, decay: 0.25, sustain: 0.6, release: 0.18, gain: 0.5 },
  Supersaw: { cat: 'Lead', wave1: 'sawtooth', unison: 7, uniDetune: 35, uniSpread: 0.9, wave2: 'square', osc2Oct: 1, mix: 0.15, cutoff: 3500, reso: 1, envAmt: 3000, fDecay: 0.5, fSustain: 0.5, attack: 0.01, sustain: 0.8, release: 0.3, gain: 0.45 },
  'Blok-lead': { cat: 'Lead', wave1: 'square', wave2: 'square', osc2Semi: 7, mix: 0.25, cutoff: 2200, reso: 3, envAmt: 2000, release: 0.15, lfoTarget: 'pitch', lfoRate: 5.5, lfoAmount: 0.25, gain: 0.45 },
  Fluit: { cat: 'Lead', wave1: 'sine', wave2: 'triangle', osc2Oct: 1, mix: 0.15, noise: 0.06, cutoff: 3000, reso: 0.7, envAmt: 500, attack: 0.06, sustain: 0.9, release: 0.25, lfoRate: 5, lfoAmount: 0.2, gain: 0.5 },
  Pad: { cat: 'Pad', wave1: 'sawtooth', unison: 3, uniDetune: 18, wave2: 'sawtooth', detune: 22, mix: 0.5, cutoff: 1200, reso: 1, envAmt: 900, fAttack: 0.6, fDecay: 1.2, fSustain: 0.6, attack: 0.6, decay: 1.2, sustain: 0.8, release: 1.4, gain: 0.35 },
  'Warme pad': { cat: 'Pad', wave1: 'sawtooth', unison: 5, uniDetune: 25, wave2: 'triangle', osc2Oct: -1, mix: 0.3, cutoff: 900, reso: 1, envAmt: 800, fAttack: 1.2, fDecay: 2, fSustain: 0.6, attack: 1, decay: 1.5, sustain: 0.85, release: 2, lfoTarget: 'filter', lfoRate: 0.2, lfoAmount: 0.15, gain: 0.35 },
  Strijkers: { cat: 'Pad', wave1: 'sawtooth', unison: 4, uniDetune: 18, uniSpread: 0.8, wave2: 'sawtooth', detune: 9, mix: 0.4, cutoff: 2200, reso: 0.7, envAmt: 500, fAttack: 0.4, attack: 0.35, sustain: 0.9, release: 0.7, lfoRate: 5.2, lfoAmount: 0.12, gain: 0.4 },
  Glaspad: { cat: 'Pad', wave1: 'triangle', unison: 3, uniDetune: 12, wave2: 'sine', osc2Oct: 2, mix: 0.35, fm: 0.15, fmSustain: 0.6, cutoff: 5000, envAmt: 0, attack: 0.8, sustain: 0.8, release: 2.5, lfoTarget: 'amp', lfoRate: 3, lfoAmount: 0.2, gain: 0.4 },
  Keys: { cat: 'Keys', wave1: 'triangle', wave2: 'sine', osc2Oct: 1, detune: 3, mix: 0.3, cutoff: 2600, reso: 0.7, envAmt: 1500, fDecay: 0.6, fSustain: 0.2, attack: 0.004, decay: 0.9, sustain: 0.3, release: 0.35, gain: 0.55 },
  'E-piano': { cat: 'Keys', wave1: 'sine', wave2: 'sine', mix: 0, fm: 0.9, fmDecay: 0.6, fmSustain: 0.1, cutoff: 6000, envAmt: 0, attack: 0.002, decay: 1.8, sustain: 0.15, release: 0.4, lfoTarget: 'amp', lfoRate: 4.5, lfoAmount: 0.12, gain: 0.6 },
  Orgel: { cat: 'Keys', wave1: 'sine', wave2: 'sine', osc2Oct: 1, mix: 0.45, sub: 0.35, cutoff: 7000, envAmt: 0, attack: 0.005, sustain: 1, release: 0.05, lfoRate: 6.5, lfoAmount: 0.08, drive: 0.15, gain: 0.45 },
  Klok: { cat: 'Keys', wave1: 'sine', wave2: 'sine', osc2Oct: 1, osc2Semi: 6, mix: 0, fm: 0.7, fmDecay: 2, fmSustain: 0.2, cutoff: 9000, envAmt: 0, attack: 0.001, decay: 2.5, sustain: 0, release: 1.5, gain: 0.45 },
  Marimba: { cat: 'Keys', wave1: 'sine', wave2: 'sine', osc2Oct: 2, mix: 0.2, fm: 0.2, fmDecay: 0.08, fmSustain: 0, cutoff: 5000, envAmt: 0, attack: 0.001, decay: 0.45, sustain: 0, release: 0.3, gain: 0.6 },
  Pluk: { cat: 'Pluk', wave1: 'square', wave2: 'triangle', osc2Oct: 1, detune: 6, mix: 0.35, cutoff: 900, reso: 4, envAmt: 5000, fDecay: 0.22, fSustain: 0, attack: 0.001, decay: 0.22, sustain: 0, release: 0.2, gain: 0.5 },
  Kalimba: { cat: 'Pluk', wave1: 'triangle', wave2: 'sine', osc2Oct: 2, mix: 0.25, fm: 0.1, cutoff: 4000, envAmt: 2000, fDecay: 0.2, fSustain: 0, attack: 0.001, decay: 0.7, sustain: 0, release: 0.5, gain: 0.55 },
  Stab: { cat: 'Pluk', wave1: 'sawtooth', unison: 3, uniDetune: 15, wave2: 'square', mix: 0.3, cutoff: 1200, reso: 5, envAmt: 5000, fDecay: 0.15, fSustain: 0, attack: 0.002, decay: 0.25, sustain: 0, release: 0.15, gain: 0.5 },
  Koperblazers: { cat: 'Pluk', wave1: 'sawtooth', unison: 2, uniDetune: 8, wave2: 'sawtooth', detune: 5, mix: 0.4, cutoff: 700, reso: 1.5, envAmt: 3500, fAttack: 0.06, fDecay: 0.4, fSustain: 0.45, attack: 0.04, decay: 0.3, sustain: 0.8, release: 0.2, lfoRate: 5, lfoAmount: 0.08, gain: 0.45 },
};

let counter = 0;
export function uid(prefix = 'x') {
  return prefix + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const noteName = (p) => NOTE_NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
export const midiToFreq = (p) => 440 * 2 ** ((p - 69) / 12);
export const dbToGain = (db) => (db <= -60 ? 0 : 10 ** (db / 20));
export const gainToDb = (g) => (g <= 0.001 ? -60 : 20 * Math.log10(g));
export const secondsPerBeat = (bpm) => 60 / bpm;
export const snap = (beat, grid) => Math.round(beat / grid) * grid;
export const snapFloor = (beat, grid) => Math.floor(beat / grid + 1e-9) * grid;
export const isBlackKey = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);

// "maat.tel.zestiende", zoals in de meeste DAW's.
export function formatPosition(beat) {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / BEATS_PER_BAR) + 1;
  const tel = Math.floor(b % BEATS_PER_BAR) + 1;
  const sixteenth = Math.floor((b % 1) * 4 + 1e-9) + 1;
  return `${bar}.${tel}.${sixteenth}`;
}

export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function defaultSynth(preset = 'Lead') {
  const name = SYNTH_PRESETS[preset] ? preset : 'Lead';
  const { cat, ...params } = SYNTH_PRESETS[name];
  return { preset: name, ...BASE_SYNTH, ...params };
}
export const defaultDrums = (kit = '808') => ({ kit, tune: 0, decay: 1, level: 0.9, pads: {} });
export const defaultSampler = () => ({
  audioId: null, sampleName: '', root: 60, fine: 0, start: 0, loop: false, loopStart: 0.3, loopEnd: 0.9,
  attack: 0.003, decay: 0.5, sustain: 1, release: 0.3, cutoff: 18000, gain: 0.8,
});

export const KIND_NAMES = { synth: 'Synth', drums: 'Drums', sampler: 'Sampler', audio: 'Audio' };

export function createTrack(kind, index = 0, name) {
  const t = {
    id: uid('t'),
    kind,
    name: name || `${KIND_NAMES[kind]} ${index + 1}`,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    volume: kind === 'drums' ? -3 : -6,
    pan: 0,
    mute: false,
    solo: false,
    arm: false,
    inserts: [],
    clips: [],
  };
  if (kind === 'synth') t.synth = defaultSynth();
  if (kind === 'drums') t.drums = defaultDrums();
  if (kind === 'sampler') t.sampler = defaultSampler();
  return t;
}

export function createClip(kind, start, length = BEATS_PER_BAR, extra = {}) {
  if (kind === 'audio') return { id: uid('c'), start, length, name: '', audioId: null, offset: 0, gain: 1, ...extra };
  return { id: uid('c'), start, length, pattern: length, name: '', notes: [], ...extra };
}

export function createProject(name = 'Nieuw project') {
  const now = Date.now();
  return { id: uid('p'), version: 2, name, bpm: 120, loop: { on: true, start: 0, end: 16 }, metronome: false, masterVolume: 0, masterInserts: defaultMasterInserts(), tracks: [], created: now, updated: now };
}

export const clipEnd = (c) => c.start + c.length;
export const patternOf = (c) => (c.pattern > 0 ? c.pattern : c.length);

export function projectEnd(project) {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function isAudible(track, tracks) {
  const anySolo = tracks.some((t) => t.solo);
  return !track.mute && (!anySolo || track.solo);
}

// Alle noten die in [from, to) beginnen. Een clip herhaalt zijn patroon tot het einde van de clip.
export function eventsInRange(project, from, to) {
  const out = [];
  for (const track of project.tracks) {
    if (track.kind === 'audio' || !isAudible(track, project.tracks)) continue;
    for (const clip of track.clips) {
      const cs = clip.start, ce = clipEnd(clip);
      if (ce <= from || cs >= to) continue;
      const pl = patternOf(clip);
      for (let k = Math.max(0, Math.floor((from - cs) / pl)); cs + k * pl < Math.min(to, ce); k++) {
        for (const note of clip.notes) {
          if (note.t >= pl) continue;
          const beat = cs + k * pl + note.t;
          if (beat < from || beat >= to || beat >= ce) continue;
          out.push({ track, clip, note, beat, dur: Math.min(note.d, ce - beat) });
        }
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

// Audioclips die in [from, to) beginnen; met spanning=true ook clips die op `from` al bezig zijn
// (na het starten midden in een clip of na het terugspringen van een loop).
export function audioStartsInRange(project, from, to, spanning = false) {
  const out = [];
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || !isAudible(track, project.tracks)) continue;
    for (const clip of track.clips) {
      if (!clip.audioId) continue;
      if (clip.start >= from && clip.start < to) out.push({ track, clip, beat: clip.start, offsetBeats: 0 });
      else if (spanning && clip.start < from && clipEnd(clip) > from) out.push({ track, clip, beat: from, offsetBeats: from - clip.start });
    }
  }
  return out;
}

// Volgend stuk om in te plannen vanaf `beat`; springt bij het loopeinde terug naar het loopbegin.
export function nextSegment(beat, step, loop) {
  if (loop && loop.on && loop.end > loop.start && beat < loop.end && beat + step >= loop.end) {
    return { from: beat, to: loop.end, next: loop.start, wrapped: true };
  }
  return { from: beat, to: beat + step, next: beat + step, wrapped: false };
}

export function quantizeNotes(notes, grid) {
  for (const n of notes) {
    n.t = Math.max(0, snap(n.t, grid));
    n.d = Math.max(grid, snap(n.d, grid));
  }
  return notes;
}

export function duplicateClip(clip) {
  const copy = structuredClone(clip);
  copy.id = uid('c');
  copy.start = clipEnd(clip);
  return copy;
}

// Zet een in de vorm van een opname losse noten (absolute tellen) om naar een clip.
export function clipFromRecording(kind, startBeat, endBeat, events, grid = 0) {
  const start = snapFloor(startBeat, BEATS_PER_BAR);
  const end = Math.max(start + BEATS_PER_BAR, Math.ceil(endBeat / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR);
  const clip = createClip(kind, start, end - start);
  clip.notes = events
    .filter((e) => e.beat >= start && e.beat < end)
    .map((e) => ({ t: e.beat - start, d: Math.max(0.05, e.d), p: e.p, v: e.v }));
  if (grid) quantizeNotes(clip.notes, grid);
  return clip;
}

// Vult ontbrekende velden aan in projecten van oudere versies.
export function migrate(project) {
  const p = { ...createProject(project.name), ...project, version: 2 };
  p.loop = { ...createProject().loop, ...project.loop };
  p.masterInserts = project.masterInserts ? project.masterInserts.map(normalizeInsert).filter(Boolean) : defaultMasterInserts();
  p.tracks = (project.tracks || []).map((t, i) => {
    const { fx, ...rest } = t;
    const track = { ...createTrack(t.kind, i), ...rest };
    track.inserts = t.inserts ? t.inserts.map(normalizeInsert).filter(Boolean) : fxToInserts(fx);
    if (t.kind === 'synth') track.synth = { ...defaultSynth(t.synth?.preset), ...t.synth };
    if (t.kind === 'drums') track.drums = { ...defaultDrums(), ...t.drums, pads: { ...t.drums?.pads } };
    if (t.kind === 'sampler') track.sampler = { ...defaultSampler(), ...t.sampler };
    track.clips = (t.clips || []).map((c) => ({ ...createClip(t.kind, 0), ...c }));
    return track;
  });
  return p;
}

// Een klein voorbeeldnummer, zodat er bij de eerste start meteen iets te horen is.
export function demoProject() {
  const p = createProject('Eerste beat');
  p.bpm = 118;
  p.loop = { on: true, start: 0, end: 32 };

  const drums = createTrack('drums', 0, 'Drums');
  drums.drums = defaultDrums('909');
  drums.inserts = [createInsert('comp', { threshold: -16, ratio: 3, attack: 0.015, release: 0.12, makeup: 2 }), createInsert('sat', { drive: 6, mix: 0.4 })];
  const beat = createClip('drums', 0, 32, { pattern: 4, name: 'Groove' });
  for (let i = 0; i < 4; i++) beat.notes.push({ t: i, d: 0.25, p: 36, v: 0.95 });
  for (const t of [1, 3]) beat.notes.push({ t, d: 0.25, p: 38, v: 0.8 }, { t, d: 0.25, p: 39, v: 0.6 });
  for (let i = 0; i < 4; i++) beat.notes.push({ t: i + 0.5, d: 0.25, p: i === 3 ? 46 : 42, v: 0.7 });
  for (let i = 0; i < 16; i++) beat.notes.push({ t: i * 0.25, d: 0.25, p: 70, v: i % 4 === 2 ? 0.55 : 0.3 });
  drums.clips.push(beat);

  const bass = createTrack('synth', 1, 'Bas');
  bass.synth = defaultSynth('Bas');
  bass.inserts = [createInsert('pump', { amount: 0.6 })];
  const bassline = createClip('synth', 0, 32, { pattern: 16, name: 'Baslijn' });
  const roots = [45, 41, 48, 43]; // A, F, C, G
  roots.forEach((root, bar) => {
    for (const [t, d, o] of [[0, 0.5, 0], [0.75, 0.25, 0], [1.5, 0.5, 12], [2.5, 0.5, 0], [3.25, 0.5, 7]]) {
      bassline.notes.push({ t: bar * 4 + t, d, p: root + o - 12, v: 0.85 });
    }
  });
  bass.clips.push(bassline);

  const pad = createTrack('synth', 2, 'Akkoorden');
  pad.synth = defaultSynth('Warme pad');
  pad.inserts = [createInsert('chorus', { mix: 0.35 }), createInsert('pump', { amount: 0.75 }), createInsert('reverb', { size: 3.5, mix: 0.3 })];
  const chords = createClip('synth', 0, 32, { pattern: 16, name: 'Akkoorden' });
  const voicings = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
  voicings.forEach((v, bar) => v.forEach((pitch) => chords.notes.push({ t: bar * 4, d: 3.9, p: pitch, v: 0.7 })));
  pad.clips.push(chords);

  const lead = createTrack('synth', 3, 'Melodie');
  lead.synth = defaultSynth('Kalimba');
  lead.inserts = [createInsert('delay', { time: 0.75, feedback: 0.4, mix: 0.28 }), createInsert('reverb', { size: 2.2, mix: 0.22 })];
  const melody = createClip('synth', 16, 16, { pattern: 16, name: 'Melodie' });
  const line = [[0, 76], [0.5, 72], [1, 69], [2, 72], [2.5, 74], [4, 72], [4.5, 69], [5, 65], [6, 69], [6.5, 72], [8, 72], [8.5, 76], [9, 79], [10, 76], [12, 74], [12.5, 71], [13, 67], [14, 71]];
  for (const [t, pch] of line) melody.notes.push({ t, d: 0.45, p: pch, v: 0.8 });
  lead.clips.push(melody);

  p.tracks.push(drums, bass, pad, lead);
  return p;
}
