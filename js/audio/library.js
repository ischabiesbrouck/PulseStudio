// Ingebouwde samplebibliotheek. Alle geluiden worden in de browser gegenereerd (OfflineAudioContext),
// dus er zitten geen bestanden van anderen in. Drumloops worden in het tempo van het project gemaakt.
import { synthVoice, drumHit } from './instruments.js';
import { IMPL, noiseBuffer } from './plugins.js';
import { defaultSynth, defaultDrums, midiToFreq } from '../model.js';

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

// Drumpatronen per zestiende, voor één maat; `x` = hard, `o` = zacht.
function drumLoop(ctx, dest, bpm, kit, rows, { swing = 0, bars = 2, rolls = [] } = {}) {
  const spb = 60 / bpm;
  const k = defaultDrums(kit);
  const choke = {};
  const bus = ctx.createGain();
  const comp = IMPL.comp(ctx);
  comp.update({ threshold: -14, ratio: 3, attack: 0.01, release: 0.12, makeup: 2 }, bpm, direct);
  bus.connect(comp.input);
  comp.output.connect(dest);
  for (let bar = 0; bar < bars; bar++) {
    for (const [pitch, pat] of Object.entries(rows)) {
      [...pat].forEach((ch, i) => {
        if (ch === '.') return;
        const beat = bar * 4 + i / 4 + (i % 2 ? swing * 0.25 : 0);
        drumHit(ctx, bus, k, +pitch, ch === 'x' ? 0.95 : 0.55, beat * spb, { choke });
      });
    }
    for (const [step, pitch, count] of rolls) {
      for (let r = 0; r < count; r++) drumHit(ctx, bus, k, pitch, 0.4 + 0.4 * (r / count), (bar * 4 + step / 4 + r * (0.25 / count)) * spb, { choke });
    }
  }
}

export const LIBRARY = [
  // ---------- Drumloops ----------
  { id: 'loop-house', cat: 'Drumloops', name: 'House (909)', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => drumLoop(ctx, d, bpm, '909', { 36: 'x...x...x...x...', 39: '....x.......x...', 42: '..x...x...x...o.', 46: '..............x.', 70: 'o.o.o.o.o.o.o.o.' }) },
  { id: 'loop-techno', cat: 'Drumloops', name: 'Techno (909)', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => drumLoop(ctx, d, bpm, '909', { 36: 'x...x...x...x...', 46: '..x...x...x...x.', 37: '...o..o....o..o.', 51: 'o.o.o.o.o.o.o.o.', 39: '....o.......o...' }) },
  { id: 'loop-hiphop', cat: 'Drumloops', name: 'Hiphop (akoestisch)', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => drumLoop(ctx, d, bpm, 'Akoestisch', { 36: 'x......x..x.....', 38: '....x.......x...', 42: 'x.o.x.o.x.o.x.oo' }, { swing: 0.16 }) },
  { id: 'loop-trap', cat: 'Drumloops', name: 'Trap (808)', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => drumLoop(ctx, d, bpm, '808', { 36: 'x.....x...x.....', 38: '........x.......', 39: '........o.......', 42: 'x.o.x.o.x.o.x...' }, { rolls: [[12, 42, 6], [14, 42, 3]] }) },
  { id: 'loop-break', cat: 'Drumloops', name: 'Breakbeat', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => drumLoop(ctx, d, bpm, 'Akoestisch', { 36: 'x.x.......x.....', 38: '....x..o.o..x..o', 51: 'x.x.x.x.x.x.x.x.' }) },
  { id: 'loop-lofi', cat: 'Drumloops', name: 'Lo-fi', length: (bpm) => barsSec(bpm, 2),
    render: (ctx, d, bpm) => drumLoop(ctx, d, bpm, 'Lo-fi', { 36: 'x.....x..x......', 38: '....x.......x...', 42: 'x.oox.o.x.oox.o.', 70: '..o...o...o...o.' }, { swing: 0.22 }) },

  // ---------- Instrumenten (voor de sampler) ----------
  { id: 'inst-piano', cat: 'Instrumenten', name: 'Piano', root: 60, length: () => 4,
    render: (ctx, d) => pianoNote(ctx, reverbSend(ctx, d, 1.6, 0.15), 60, 0.85, 0, 4) },
  { id: 'inst-guitar', cat: 'Instrumenten', name: 'Gitaarsnaar', root: 48, length: () => 3,
    render: (ctx, d) => { const s = ctx.createBufferSource(); s.buffer = pluckBuffer(ctx, midiToFreq(48), 3); s.connect(filt(ctx, 'lowpass', 6000)).connect(d); s.start(0); } },
  { id: 'inst-strings', cat: 'Instrumenten', name: 'Strijkers', root: 48, loop: [0.35, 0.8], length: () => 3.5,
    render: (ctx, d) => note(ctx, reverbSend(ctx, d, 2.5, 0.25), 'Strijkers', 48, 0.8, 0, 3) },
  { id: 'inst-choir', cat: 'Instrumenten', name: 'Koor "aah"', root: 57, loop: [0.35, 0.8], length: () => 3.5,
    render: (ctx, d) => {
      const out = reverbSend(ctx, d, 3, 0.3);
      const bus = ctx.createGain();
      bus.gain.value = 1.4;
      for (const [f, q, g] of [[750, 6, 1], [1150, 8, 0.5], [2700, 10, 0.25], [3300, 12, 0.12]]) {
        const bp = filt(ctx, 'bandpass', f, q);
        const gg = ctx.createGain();
        gg.gain.value = g;
        bus.connect(bp).connect(gg).connect(out);
      }
      note(ctx, bus, 'Strijkers', 57, 0.8, 0, 3, { unison: 5, uniDetune: 22, mix: 0, cutoff: 9000, envAmt: 0, attack: 0.35, lfoAmount: 0.18, lfoRate: 5 });
    } },
  { id: 'inst-kalimba', cat: 'Instrumenten', name: 'Kalimba', root: 72, length: () => 2.5,
    render: (ctx, d) => note(ctx, reverbSend(ctx, d, 1.5, 0.2), 'Kalimba', 72, 0.9, 0, 1.2) },
  { id: 'inst-bell', cat: 'Instrumenten', name: 'Klokje', root: 72, length: () => 4,
    render: (ctx, d) => note(ctx, reverbSend(ctx, d, 3, 0.3), 'Klok', 72, 0.9, 0, 2.2) },
  { id: 'inst-organ', cat: 'Instrumenten', name: 'Orgel', root: 60, loop: [0.2, 0.8], length: () => 2.5,
    render: (ctx, d) => note(ctx, d, 'Orgel', 60, 0.85, 0, 2.3) },
  { id: 'inst-808', cat: 'Instrumenten', name: '808-bas', root: 36, length: () => 2.5,
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
  { id: 'chord-piano', cat: 'Akkoorden', name: 'Piano-akkoord (Cm7)', root: 60, length: () => 3,
    render: (ctx, d) => { const out = reverbSend(ctx, d, 1.8, 0.2); for (const p of [48, 60, 63, 67, 70]) pianoNote(ctx, out, p, 0.75, 0, 3); } },
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

export const LIBRARY_CATS = ['Drumloops', 'Instrumenten', 'Akkoorden', 'Effecten'];

export async function renderLibraryItem(item, bpm, sampleRate = 44100) {
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
