// Ingebouwde geluidenbibliotheek, gerenderd in de browser (OfflineAudioContext) in het tempo van het project.
// Loops gebruiken de patronen uit patterns.js en, waar mogelijk, echte opnames uit samplelib.js.
import { synthVoice, samplerVoice, drumHit } from './instruments.js';
import { IMPL, noiseBuffer } from './plugins.js';
import { defaultSynth, defaultDrums, defaultSampler, midiToFreq } from '../model.js';
import { DRUM_PATTERNS, MELODIC_PATTERNS, drumNotes, melodicNotes } from './patterns.js';
import { getInstrument, loadInstrument, pickZone, loadKit, isSampleKit } from './samplelib.js';

const barsSec = (bpm, n) => (n * 4 * 60) / bpm;
const direct = (p, v) => { p.value = v; };

function reverbSend(ctx, dest, size = 2.5, mix = 0.3) {
  const r = IMPL.reverb(ctx);
  r.update({ size, predelay: 0.015, damping: 0.5, mix }, 120, direct);
  r.output.connect(dest);
  return r.input;
}

function note(ctx, dest, preset, pitch, vel, t, dur, over = {}) {
  const v = synthVoice(ctx, dest, { ...defaultSynth(preset), ...over }, pitch, vel, t);
  v.release(t + dur);
}

function noiseSrc(ctx, t, len) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.start(t);
  src.stop(t + len);
  return src;
}

function filt(ctx, type, f, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

// Piano-achtige toon: inharmonische boventonen die elk in hun eigen tempo uitsterven, plus een hamertje.
function pianoNote(ctx, dest, pitch, vel, t, len) {
  const f = midiToFreq(pitch);
  const out = ctx.createGain();
  out.gain.value = 0.22 * vel;
  out.connect(dest);
  for (let n = 1; n <= 12; n++) {
    const fn = f * n * Math.sqrt(1 + 0.0004 * n * n);
    if (fn > 16000) break;
    const o = ctx.createOscillator();
    o.frequency.value = fn;
    o.detune.value = (Math.random() - 0.5) * 3;
    const g = ctx.createGain();
    const amp = (1 / n ** 1.25) * (n === 1 ? 1 : 0.7 + vel * 0.3);
    const decay = Math.min(len, 3.2 / n ** 0.75) * (1 - (pitch - 48) / 120);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay / 3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len);
  }
  const hammer = noiseSrc(ctx, t, 0.05);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.25 * vel, t);
  hg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  hammer.connect(filt(ctx, 'bandpass', f * 4, 1)).connect(hg).connect(out);
}

// Karplus-Strong: een snaar die direct als samples wordt berekend.
function pluckBuffer(ctx, freq, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const N = Math.round(sr / freq);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const y = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = prev * 0.5 + r * 0.5; y[i] = prev; }
  for (let i = N; i < len; i++) y[i] = 0.4985 * (y[i - N] + y[i - N - 1 < 0 ? i - N : i - N - 1]);
  for (let i = 0; i < len; i++) { L[i] = y[i] * 0.6; R[i] = (i > 12 ? y[i - 12] : 0) * 0.6; }
  return buf;
}

function vinylBuffer(ctx, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.08 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * 0.05;
      if (Math.random() < 0.00035) { const amp = 0.1 + Math.random() * 0.5; for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += amp * (Math.random() * 2 - 1) * Math.exp(-k / 6); }
    }
  }
  // Langzame "rotatie"-modulatie van de ruis
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] *= 0.8 + 0.2 * Math.sin((i / sr) * Math.PI * 2 * 0.55); }
  return buf;
}

// Drumloop uit een patroon, gespeeld met de kit van dat patroon (echte opnames waar die er zijn).
function patternDrumLoop(ctx, dest, bpm, pat) {
  const spb = 60 / bpm;
  const k = defaultDrums(pat.kit);
  const choke = {};
  const bus = ctx.createGain();
  const comp = IMPL.comp(ctx);
  comp.update({ threshold: -16, ratio: 3, attack: 0.012, release: 0.12, makeup: 3 }, bpm, direct);
  bus.connect(comp.input);
  comp.output.connect(dest);
  for (const n of drumNotes(pat).notes) drumHit(ctx, bus, k, n.p, n.v, n.t * spb, { choke });
}

// Melodische loop: met een ingebouwd instrument (echte opnames) of met een synthpreset.
function patternMelodicLoop(ctx, dest, bpm, pat) {
  const spb = 60 / bpm;
  const out = reverbSend(ctx, dest, 2.2, 0.18);
  const { notes } = melodicNotes(pat);
  if (pat.instrument) {
    const zones = getInstrument(pat.instrument);
    const s = defaultSampler(pat.instrument);
    for (const n of notes) samplerVoice(ctx, out, s, { ...pickZone(zones, n.p), builtin: true }, n.p, n.v, n.t * spb).release((n.t + n.d) * spb);
  } else {
    for (const n of notes) note(ctx, out, pat.preset, n.p, n.v, n.t * spb, n.d * spb);
  }
}

const KIT_LABEL = { 909: '909', 808: '808', Studio: 'studio', Kamer: 'jazzkit', Cassette: 'cassette' };
const PATTERN_LOOPS = [
  ...DRUM_PATTERNS.map((p) => ({
    id: `loop-${p.id}`, cat: 'Drumloops', name: `${p.name} (${KIT_LABEL[p.kit] || p.kit})`, kit: p.kit,
    prepare: () => (isSampleKit(p.kit) ? loadKit(p.kit) : null),
    length: (bpm) => barsSec(bpm, drumNotes(p).length / 4),
    render: (ctx, d, bpm) => patternDrumLoop(ctx, d, bpm, p),
  })),
  ...MELODIC_PATTERNS.map((p) => ({
    id: `loop-${p.id}`, cat: 'Melodische loops', name: p.name, role: p.role,
    prepare: () => (p.instrument ? loadInstrument(p.instrument) : null),
    length: (bpm) => barsSec(bpm, melodicNotes(p).length / 4),
    render: (ctx, d, bpm) => patternMelodicLoop(ctx, d, bpm, p),
  })),
];

export const LIBRARY = [
  ...PATTERN_LOOPS,

  // ---------- One-shots ----------
  { id: 'inst-guitar', cat: 'One-shots', name: 'Gitaarsnaar (gesynthetiseerd)', root: 48, length: () => 3,
    render: (ctx, d) => { const s = ctx.createBufferSource(); s.buffer = pluckBuffer(ctx, midiToFreq(48), 3); s.connect(filt(ctx, 'lowpass', 6000)).connect(d); s.start(0); } },
  { id: 'inst-808', cat: 'One-shots', name: '808-bas', root: 36, length: () => 2.5,
    render: (ctx, d) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(midiToFreq(43), 0);
      o.frequency.exponentialRampToValueAtTime(midiToFreq(36), 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.9, 0.004);
      g.gain.setTargetAtTime(0, 0.3, 0.6);
      const sat = IMPL.sat(ctx);
      sat.update({ drive: 8, tone: 6000, mix: 0.6, output: -2 }, 120, direct);
      o.connect(g).connect(sat.input);
      sat.output.connect(d);
      o.start(0);
      o.stop(2.5);
    } },

  // ---------- Akkoorden ----------
  { id: 'chord-piano', cat: 'Akkoorden', name: 'Vleugel-akkoord (Cm7)', root: 60, length: () => 4, prepare: () => loadInstrument('piano'),
    render: (ctx, d) => {
      const out = reverbSend(ctx, d, 1.8, 0.18);
      const zones = getInstrument('piano');
      const s = defaultSampler('piano');
      [48, 60, 63, 67, 70].forEach((p, i) => samplerVoice(ctx, out, s, { ...pickZone(zones, p), builtin: true }, p, 0.7, i * 0.012).release(3.4));
    } },
  { id: 'chord-rhodes', cat: 'Akkoorden', name: 'Rhodes-akkoord (Am9)', root: 57, length: () => 3.5, prepare: () => loadInstrument('epiano'),
    render: (ctx, d) => {
      const out = reverbSend(ctx, d, 1.6, 0.16);
      const zones = getInstrument('epiano');
      const s = defaultSampler('epiano');
      [45, 55, 59, 60, 64].forEach((p, i) => samplerVoice(ctx, out, s, { ...pickZone(zones, p), builtin: true }, p, 0.65, i * 0.01).release(2.8));
    } },
  { id: 'chord-stab', cat: 'Akkoorden', name: 'Stab (Cm)', root: 60, length: () => 1.5,
    render: (ctx, d) => { const out = reverbSend(ctx, d, 1.5, 0.25); for (const p of [60, 63, 67, 72]) note(ctx, out, 'Stab', p, 0.9, 0, 0.3); } },
  { id: 'chord-pad', cat: 'Akkoorden', name: 'Pad-akkoord (Am9)', root: 57, length: (bpm) => barsSec(bpm, 2) + 2,
    render: (ctx, d, bpm) => { const out = reverbSend(ctx, d, 4, 0.35); for (const p of [45, 57, 60, 64, 67, 71]) note(ctx, out, 'Warme pad', p, 0.7, 0, barsSec(bpm, 2)); } },
  { id: 'chord-organ', cat: 'Akkoorden', name: 'Orgelakkoord (F)', root: 53, length: () => 2.5,
    render: (ctx, d) => { for (const p of [53, 57, 60, 65]) note(ctx, d, 'Orgel', p, 0.7, 0, 2.2); } },

  // ---------- Effecten ----------
  { id: 'fx-impact', cat: 'Effecten', name: 'Impact', length: () => 4,
    render: (ctx, d) => {
      const out = reverbSend(ctx, d, 4, 0.4);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(75, 0);
      o.frequency.exponentialRampToValueAtTime(28, 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, 0);
      g.gain.exponentialRampToValueAtTime(0.001, 3.5);
      o.connect(g).connect(out);
      o.start(0); o.stop(4);
      const n = noiseSrc(ctx, 0, 3);
      const lp = filt(ctx, 'lowpass', 9000);
      lp.frequency.exponentialRampToValueAtTime(150, 2.5);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.6, 0);
      ng.gain.exponentialRampToValueAtTime(0.001, 2.8);
      n.connect(lp).connect(ng).connect(out);
    } },
  { id: 'fx-riser', cat: 'Effecten', name: 'Riser (2 maten)', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => {
      const len = barsSec(bpm, 2);
      const out = reverbSend(ctx, d, 2.5, 0.3);
      const n = noiseSrc(ctx, 0, len);
      const bp = filt(ctx, 'bandpass', 300, 2);
      bp.frequency.exponentialRampToValueAtTime(9000, len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, 0);
      g.gain.exponentialRampToValueAtTime(0.7, len);
      n.connect(bp).connect(g).connect(out);
      for (const det of [-12, 0, 12]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        o.frequency.setValueAtTime(180, 0);
        o.frequency.exponentialRampToValueAtTime(1500, len);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.001, 0);
        og.gain.exponentialRampToValueAtTime(0.06, len);
        o.connect(filt(ctx, 'lowpass', 5000)).connect(og).connect(out);
        o.start(0); o.stop(len);
      }
    } },
  { id: 'fx-down', cat: 'Effecten', name: 'Downlifter (1 maat)', length: (bpm) => barsSec(bpm, 1) + 1,
    render: (ctx, d, bpm) => {
      const len = barsSec(bpm, 1);
      const out = reverbSend(ctx, d, 2.5, 0.35);
      const n = noiseSrc(ctx, 0, len);
      const hp = filt(ctx, 'highpass', 9000);
      hp.frequency.exponentialRampToValueAtTime(150, len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.6, 0);
      g.gain.exponentialRampToValueAtTime(0.001, len);
      n.connect(hp).connect(g).connect(out);
    } },
  { id: 'fx-subdrop', cat: 'Effecten', name: 'Sub drop', length: () => 3,
    render: (ctx, d) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(95, 0);
      o.frequency.exponentialRampToValueAtTime(26, 2.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.95, 0);
      g.gain.exponentialRampToValueAtTime(0.001, 2.9);
      o.connect(g).connect(d);
      o.start(0); o.stop(3);
    } },
  { id: 'fx-sweep', cat: 'Effecten', name: 'Ruissweep (1 maat)', length: (bpm) => barsSec(bpm, 1),
    render: (ctx, d, bpm) => {
      const len = barsSec(bpm, 1);
      const n = noiseSrc(ctx, 0, len);
      const lp = filt(ctx, 'lowpass', 200, 4);
      lp.frequency.exponentialRampToValueAtTime(12000, len / 2);
      lp.frequency.exponentialRampToValueAtTime(200, len);
      const g = ctx.createGain();
      g.gain.value = 0.35;
      n.connect(lp).connect(g).connect(d);
    } },
  { id: 'fx-revcrash', cat: 'Effecten', name: 'Omgekeerde crash', length: (bpm) => barsSec(bpm, 1),
    render: (ctx, d, bpm) => {
      const len = barsSec(bpm, 1);
      const n = noiseSrc(ctx, 0, len);
      const hp = filt(ctx, 'highpass', 4500);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, 0);
      g.gain.exponentialRampToValueAtTime(0.5, len - 0.01);
      g.gain.linearRampToValueAtTime(0, len);
      n.connect(hp).connect(g).connect(d);
    } },
  { id: 'fx-zap', cat: 'Effecten', name: 'Laser', length: () => 0.6,
    render: (ctx, d) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(3200, 0);
      o.frequency.exponentialRampToValueAtTime(70, 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, 0);
      g.gain.exponentialRampToValueAtTime(0.001, 0.5);
      o.connect(filt(ctx, 'lowpass', 6000)).connect(g).connect(d);
      o.start(0); o.stop(0.6);
    } },
  { id: 'fx-vinyl', cat: 'Effecten', name: 'Vinylkraak (2 maten)', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => { const s = ctx.createBufferSource(); s.buffer = vinylBuffer(ctx, barsSec(bpm, 2)); s.connect(d); s.start(0); } },
];

export const LIBRARY_CATS = ['Drumloops', 'Melodische loops', 'Akkoorden', 'One-shots', 'Effecten'];

export async function renderLibraryItem(item, bpm, sampleRate = 44100) {
  await item.prepare?.();
  const len = item.length(bpm);
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sampleRate), sampleRate);
  item.render(ctx, ctx.destination, bpm);
  const buf = await ctx.startRendering();
  // Normaliseren naar -1 dB, zoals bij een samplepakket.
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) {
    const k = 0.89 / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  return buf;
}
