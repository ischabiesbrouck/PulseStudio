// Instrumenten: synth (unison, FM, sub, ruis, filter met eigen envelope, LFO), sampler en drumcomputer met vier kits.
// Alles werkt op elke BaseAudioContext, dus ook in een OfflineAudioContext voor exporteren en de bibliotheek.
import { midiToFreq } from '../model.js';
import { noiseBuffer, softClip, crushCurve } from './plugins.js';

function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
}

const silent = (time) => ({ end: time, release() {}, stopNow() {} });

// ---------- Synth ----------

export function synthVoice(ctx, dest, s, pitch, vel, time) {
  const freq = midiToFreq(pitch);
  const sources = [];
  const pitched = [];
  const bus = ctx.createGain();
  const add = (src, level, pan = 0) => {
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(bus);
    } else g.connect(bus);
    sources.push(src);
  };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; pitched.push(o); return o; };

  // Oscillator 1 met unison: meerdere ontstemde kopieën, gespreid over het stereobeeld.
  const voices = Math.max(1, Math.round(s.unison || 1));
  const osc1 = [];
  for (let i = 0; i < voices; i++) {
    const pos = voices === 1 ? 0 : (i / (voices - 1)) * 2 - 1;
    const o = osc(s.wave1, freq);
    o.detune.value = pos * (s.uniDetune || 0) / 2 + (Math.random() - 0.5) * 2;
    add(o, (1 - s.mix) / Math.sqrt(voices), pos * (s.uniSpread ?? 0.7));
    osc1.push(o);
  }

  // Oscillator 2: als tweede klankbron en/of als FM-modulator van oscillator 1.
  if (s.mix > 0 || s.fm > 0) {
    const f2 = freq * 2 ** ((s.osc2Oct || 0) + (s.osc2Semi || 0) / 12);
    const o2 = osc(s.wave2, f2);
    o2.detune.value = s.detune || 0;
    if (s.mix > 0) add(o2, s.mix); else sources.push(o2);
    if (s.fm > 0) {
      const fmG = ctx.createGain();
      const index = s.fm * f2 * 2.5;
      fmG.gain.setValueAtTime(index * (0.5 + vel / 2), time);
      fmG.gain.setTargetAtTime(index * (s.fmSustain ?? 0.3), time, Math.max(0.01, (s.fmDecay ?? 0.4) / 3));
      o2.connect(fmG);
      for (const o of osc1) fmG.connect(o.frequency);
    }
  }
  if (s.sub > 0) add(osc('sine', freq / 2), s.sub);
  if (s.noise > 0) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    add(n, s.noise * 0.4);
  }

  // Filter (12 of 24 dB/oct) met eigen envelope en keytracking.
  const filters = [ctx.createBiquadFilter()];
  if (s.slope === 24) filters.push(ctx.createBiquadFilter());
  const base = Math.min(18000, Math.max(30, s.cutoff * 2 ** (((pitch - 60) / 12) * (s.keyTrack ?? 0.3))));
  const top = Math.min(18000, base + s.envAmt * (0.4 + 0.6 * vel));
  const sus = base + (top - base) * (s.fSustain ?? 0.3);
  filters.forEach((f, i) => {
    f.type = s.filterType || 'lowpass';
    f.Q.value = i === 0 ? s.reso : s.reso * 0.4;
    f.frequency.setValueAtTime(base, time);
    f.frequency.linearRampToValueAtTime(top, time + (s.fAttack ?? 0.005));
    f.frequency.setTargetAtTime(sus, time + (s.fAttack ?? 0.005), Math.max(0.005, (s.fDecay ?? 0.3) / 3));
  });
  let node = bus;
  for (const f of filters) { node.connect(f); node = f; }
  if (s.drive > 0) {
    const sh = ctx.createWaveShaper();
    sh.curve = softClip(1 + s.drive * 8);
    sh.oversample = '2x';
    node.connect(sh);
    node = sh;
  }

  const amp = ctx.createGain();
  const peak = s.gain * 0.8 * (0.3 + 0.7 * vel);
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + s.attack);
  amp.gain.setTargetAtTime(peak * s.sustain, time + s.attack, Math.max(0.005, s.decay / 3));
  node.connect(amp);
  let out = amp;

  // LFO naar toonhoogte (vibrato), filter of volume (tremolo).
  if (s.lfoAmount > 0) {
    const l = ctx.createOscillator();
    l.type = s.lfoWave || 'sine';
    l.frequency.value = s.lfoRate || 5;
    const lg = ctx.createGain();
    l.connect(lg);
    if (s.lfoTarget === 'pitch') { lg.gain.value = s.lfoAmount * 60; for (const o of pitched) lg.connect(o.detune); }
    else if (s.lfoTarget === 'filter') { lg.gain.value = s.lfoAmount * 2400; for (const f of filters) lg.connect(f.detune); }
    else {
      const trem = ctx.createGain();
      trem.gain.value = 1 - s.lfoAmount / 2;
      lg.gain.value = s.lfoAmount / 2;
      lg.connect(trem.gain);
      amp.connect(trem);
      out = trem;
    }
    sources.push(l);
  }
  out.connect(dest);
  for (const src of sources) src.start(time);

  const voice = {
    end: Infinity,
    release(t) {
      const tc = Math.max(0.005, s.release / 4);
      holdAt(amp.gain, t);
      amp.gain.setTargetAtTime(0, t, tc);
      for (const f of filters) { holdAt(f.frequency, t); f.frequency.setTargetAtTime(base, t, tc); }
      voice.end = t + tc * 6 + 0.02;
      for (const src of sources) src.stop(voice.end);
    },
    stopNow() {
      const now = ctx.currentTime;
      holdAt(amp.gain, now);
      amp.gain.setTargetAtTime(0, now, 0.008);
      for (const src of sources) try { src.stop(now + 0.05); } catch { /* al gestopt */ }
      voice.end = now + 0.05;
    },
  };
  return voice;
}

// ---------- Sampler ----------

export function samplerVoice(ctx, dest, s, buffer, pitch, vel, time) {
  if (!buffer) return silent(time);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const rate = 2 ** ((pitch - s.root + (s.fine || 0) / 100) / 12);
  src.playbackRate.value = rate;
  const dur = buffer.duration;
  const offset = Math.min(dur * 0.99, (s.start || 0) * dur);
  if (s.loop) {
    src.loop = true;
    src.loopStart = Math.max(offset, (s.loopStart ?? 0.3) * dur);
    src.loopEnd = Math.max(src.loopStart + 0.01, (s.loopEnd ?? 0.9) * dur);
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = s.cutoff ?? 18000;
  filter.Q.value = 0.7;
  const amp = ctx.createGain();
  const peak = (s.gain ?? 0.8) * (0.3 + 0.7 * vel);
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + Math.max(0.002, s.attack));
  amp.gain.setTargetAtTime(peak * s.sustain, time + Math.max(0.002, s.attack), Math.max(0.005, s.decay / 3));
  src.connect(filter).connect(amp).connect(dest);
  src.start(time, offset);
  const natural = s.loop ? Infinity : time + (dur - offset) / rate;
  const voice = {
    end: natural,
    release(t) {
      const tc = Math.max(0.005, s.release / 4);
      holdAt(amp.gain, t);
      amp.gain.setTargetAtTime(0, t, tc);
      voice.end = Math.min(natural, t + tc * 6 + 0.02);
      src.stop(voice.end);
    },
    stopNow() {
      const now = ctx.currentTime;
      holdAt(amp.gain, now);
      amp.gain.setTargetAtTime(0, now, 0.008);
      try { src.stop(now + 0.05); } catch { /* al gestopt */ }
      voice.end = now + 0.05;
    },
  };
  return voice;
}

// ---------- Drumcomputer ----------

const METAL_808 = [205.3, 304.4, 369.6, 522.7, 540, 800];
const METAL_RIDE = [263, 400, 421, 474, 587, 845];

// Bouwstenen voor één slag; alle tijden worden met `dec` (uitklinken) geschaald.
function kitTools(ctx, out, time, tune, dec) {
  const nodes = [];
  let end = time;
  const env = (peak, len, attack = 0.0015) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, time + attack + len * dec);
    g.connect(out);
    end = Math.max(end, time + attack + len * dec);
    return g;
  };
  const tone = ({ type = 'sine', f0, f1 = f0, bend = 0.05, len, peak = 1, attack, delay = 0 }) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * tune, time + delay);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * tune, time + delay + bend);
    o.connect(env(peak, len, attack));
    o.start(time + delay);
    o.stop(time + delay + len * dec + 0.05);
    nodes.push(o);
  };
  const noise = ({ type = 'highpass', freq = 1000, q = 0.7, len, peak = 1, attack, sweep, delay = 0, chain }) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq * tune, time);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep * tune, time + len * dec);
    f.Q.value = q;
    let n = src.connect(f);
    if (chain) { const f2 = ctx.createBiquadFilter(); f2.type = chain.type; f2.frequency.value = chain.freq * tune; f2.Q.value = chain.q ?? 0.7; n = n.connect(f2); }
    if (delay) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.setValueAtTime(peak, time + delay);
      g.gain.exponentialRampToValueAtTime(0.0005, time + delay + len * dec);
      g.connect(out);
      n.connect(g);
      end = Math.max(end, time + delay + len * dec);
    } else n.connect(env(peak, len, attack));
    src.start(time, Math.random() * 1.5);
    src.stop(time + delay + len * dec + 0.05);
    nodes.push(src);
  };
  const metal = ({ freqs = METAL_808, len, peak = 0.5, bp = 10000, hp = 7000, attack }) => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = bp * tune; bpf.Q.value = 0.8;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = hp * tune;
    bpf.connect(hpf).connect(env(peak, len, attack));
    for (const fr of freqs) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr * tune * 1.4;
      o.connect(bpf);
      o.start(time);
      o.stop(time + len * dec + 0.05);
      nodes.push(o);
    }
  };
  const bursts = (count, gap, freq) => {
    for (let i = 0; i < count; i++) noise({ type: 'bandpass', freq, q: 1.4, len: 0.012, peak: 2.2, delay: i * gap });
  };
  return { tone, noise, metal, bursts, nodes, end: () => end };
}

const RECIPES = {
  808: {
    36: (k) => { k.tone({ f0: 150, f1: 48, bend: 0.07, len: 0.9, peak: 1.15 }); k.tone({ type: 'square', f0: 900, f1: 200, bend: 0.01, len: 0.012, peak: 0.12 }); },
    37: (k) => { k.tone({ type: 'triangle', f0: 1667, len: 0.03, peak: 0.6 }); k.tone({ type: 'triangle', f0: 455, len: 0.04, peak: 0.5 }); },
    38: (k) => { k.tone({ f0: 185, f1: 175, len: 0.17, peak: 0.55 }); k.tone({ f0: 330, f1: 320, len: 0.1, peak: 0.35 }); k.noise({ freq: 1800, len: 0.2, peak: 0.6 }); },
    39: (k) => { k.bursts(3, 0.011, 1100); k.noise({ type: 'bandpass', freq: 1100, q: 1.5, len: 0.28, peak: 2, delay: 0.033 }); },
    42: (k) => k.metal({ len: 0.06, peak: 0.55 }),
    46: (k) => k.metal({ len: 0.5, peak: 0.45 }),
    45: (k) => { k.tone({ f0: 115, f1: 85, bend: 0.2, len: 0.55, peak: 0.95 }); k.noise({ type: 'lowpass', freq: 900, len: 0.04, peak: 0.15 }); },
    50: (k) => { k.tone({ f0: 195, f1: 150, bend: 0.18, len: 0.42, peak: 0.9 }); k.noise({ type: 'lowpass', freq: 1400, len: 0.04, peak: 0.15 }); },
    49: (k) => { k.metal({ len: 1.8, peak: 0.3, hp: 4500, bp: 9000 }); k.noise({ freq: 6500, len: 1.6, peak: 0.22 }); },
    51: (k) => { k.metal({ freqs: METAL_RIDE, len: 1.2, peak: 0.28, bp: 7000, hp: 4000 }); k.tone({ type: 'triangle', f0: 1250, len: 0.6, peak: 0.08 }); },
    56: (k) => { k.tone({ type: 'square', f0: 587, len: 0.3, peak: 0.28 }); k.tone({ type: 'square', f0: 845, len: 0.3, peak: 0.28 }); },
    70: (k) => k.noise({ type: 'bandpass', freq: 7000, q: 1, len: 0.12, peak: 0.45, attack: 0.018 }),
  },
  909: {
    36: (k) => { k.tone({ f0: 240, f1: 52, bend: 0.035, len: 0.42, peak: 1.15 }); k.noise({ type: 'lowpass', freq: 4000, len: 0.012, peak: 0.45 }); },
    37: (k) => { k.tone({ type: 'triangle', f0: 1900, len: 0.02, peak: 0.6 }); k.noise({ type: 'bandpass', freq: 2600, q: 3, len: 0.025, peak: 0.5 }); },
    38: (k) => { k.tone({ type: 'triangle', f0: 230, f1: 180, bend: 0.03, len: 0.12, peak: 0.7 }); k.noise({ freq: 3000, len: 0.28, peak: 0.75, chain: { type: 'lowpass', freq: 11000 } }); },
    39: (k) => { k.bursts(4, 0.009, 1500); k.noise({ type: 'bandpass', freq: 1500, q: 1.2, len: 0.22, peak: 2, delay: 0.036 }); },
    42: (k) => { k.noise({ freq: 8500, len: 0.05, peak: 0.5 }); k.metal({ len: 0.045, peak: 0.25 }); },
    46: (k) => { k.noise({ freq: 8000, len: 0.38, peak: 0.42 }); k.metal({ len: 0.38, peak: 0.2 }); },
    45: (k) => { k.tone({ f0: 160, f1: 95, bend: 0.1, len: 0.4, peak: 0.95 }); k.noise({ type: 'bandpass', freq: 600, len: 0.05, peak: 0.25 }); },
    50: (k) => { k.tone({ f0: 260, f1: 170, bend: 0.1, len: 0.32, peak: 0.9 }); k.noise({ type: 'bandpass', freq: 900, len: 0.05, peak: 0.25 }); },
    49: (k) => { k.noise({ freq: 5000, len: 1.6, peak: 0.4, sweep: 7000 }); k.metal({ len: 1.2, peak: 0.2, hp: 5000 }); },
    51: (k) => { k.metal({ freqs: METAL_RIDE, len: 1.4, peak: 0.25, bp: 8500, hp: 5000 }); k.noise({ freq: 9000, len: 0.9, peak: 0.12 }); },
    56: (k) => { k.tone({ type: 'square', f0: 560, len: 0.22, peak: 0.25 }); k.tone({ type: 'square', f0: 820, len: 0.22, peak: 0.25 }); },
    70: (k) => k.noise({ type: 'bandpass', freq: 8000, q: 0.8, len: 0.1, peak: 0.45, attack: 0.012 }),
  },
  Akoestisch: {
    36: (k) => { k.tone({ f0: 110, f1: 52, bend: 0.045, len: 0.32, peak: 1.1 }); k.noise({ type: 'bandpass', freq: 3200, q: 1, len: 0.018, peak: 0.55 }); k.noise({ type: 'lowpass', freq: 220, len: 0.12, peak: 0.6 }); },
    37: (k) => { k.noise({ type: 'bandpass', freq: 1800, q: 4, len: 0.06, peak: 0.6 }); k.tone({ type: 'triangle', f0: 520, len: 0.05, peak: 0.4 }); },
    38: (k) => { k.tone({ f0: 210, f1: 190, len: 0.1, peak: 0.6 }); k.tone({ f0: 330, len: 0.06, peak: 0.25 }); k.noise({ type: 'bandpass', freq: 4500, q: 0.6, len: 0.3, peak: 0.9 }); k.noise({ freq: 7000, len: 0.18, peak: 0.35 }); },
    39: (k) => { k.bursts(5, 0.008, 1300); k.noise({ type: 'bandpass', freq: 1300, q: 1, len: 0.35, peak: 1.7, delay: 0.04 }); },
    42: (k) => { k.noise({ type: 'bandpass', freq: 10500, q: 0.9, len: 0.055, peak: 0.6, chain: { type: 'highpass', freq: 7000 } }); k.metal({ len: 0.04, peak: 0.12 }); },
    46: (k) => { k.noise({ type: 'bandpass', freq: 9500, q: 0.7, len: 0.7, peak: 0.45, chain: { type: 'highpass', freq: 6000 } }); k.metal({ len: 0.6, peak: 0.12 }); },
    45: (k) => { k.tone({ f0: 105, f1: 88, bend: 0.25, len: 0.7, peak: 0.9 }); k.noise({ type: 'bandpass', freq: 1400, q: 0.8, len: 0.06, peak: 0.3 }); },
    50: (k) => { k.tone({ f0: 175, f1: 150, bend: 0.25, len: 0.55, peak: 0.85 }); k.noise({ type: 'bandpass', freq: 1800, q: 0.8, len: 0.06, peak: 0.3 }); },
    49: (k) => { k.noise({ freq: 3500, len: 2.4, peak: 0.42, sweep: 6000 }); k.metal({ len: 2, peak: 0.16, hp: 3500 }); },
    51: (k) => { k.metal({ freqs: METAL_RIDE, len: 2, peak: 0.22, bp: 6000, hp: 3000 }); k.tone({ type: 'sine', f0: 1180, len: 1.2, peak: 0.1 }); k.noise({ freq: 8000, len: 0.6, peak: 0.08 }); },
    56: (k) => { k.tone({ type: 'triangle', f0: 800, len: 0.18, peak: 0.45 }); k.tone({ type: 'triangle', f0: 1180, len: 0.12, peak: 0.25 }); },
    70: (k) => { k.noise({ type: 'bandpass', freq: 6000, q: 1.2, len: 0.09, peak: 0.4, attack: 0.025 }); },
  },
};

export const DRUM_KITS = {
  808: { name: 'Analoog 808', recipes: '808' },
  909: { name: 'Analoog 909', recipes: '909' },
  Akoestisch: { name: 'Akoestisch', recipes: 'Akoestisch' },
  'Lo-fi': { name: 'Lo-fi tape', recipes: 'Akoestisch', crush: 7, lowpass: 5200, drive: 1.6 },
};

// Eén drumslag. `pitch` volgt General MIDI (36 kick, 38 snare, ...). Een pad kan ook een eigen sample hebben.
export function drumHit(ctx, dest, kit, pitch, vel, time, { buffers, choke } = {}) {
  const def = DRUM_KITS[kit.kit] || DRUM_KITS[808];
  const pad = kit.pads?.[pitch] || {};
  const tuneSt = (kit.tune || 0) + (pad.tune || 0);
  const tune = 2 ** (tuneSt / 12);
  const dec = (kit.decay || 1) * (pad.decay ?? 1);
  const out = ctx.createGain();
  out.gain.value = vel * (kit.level ?? 0.9) * (pad.level ?? 1) * 0.6;

  let node = out;
  if (def.drive) { const sh = ctx.createWaveShaper(); sh.curve = softClip(def.drive); node = node.connect(sh); }
  if (def.crush) { const sh = ctx.createWaveShaper(); sh.curve = crushCurve(def.crush); node = node.connect(sh); }
  if (def.lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = def.lowpass; node = node.connect(f); }
  node.connect(dest);

  let end;
  let nodes;
  const sample = pad.audioId && buffers?.get(pad.audioId);
  if (sample) {
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = tune;
    const g = ctx.createGain();
    const len = (sample.duration / tune) * Math.min(1, dec);
    g.gain.setValueAtTime(1, time);
    g.gain.setTargetAtTime(0, time + len * 0.7, len * 0.1);
    src.connect(g).connect(out);
    src.start(time);
    end = time + len + 0.05;
    src.stop(end);
    nodes = [src];
  } else {
    const k = kitTools(ctx, out, time, tune, dec);
    const recipe = RECIPES[def.recipes][pitch];
    if (recipe) recipe(k);
    else k.tone({ type: 'triangle', f0: midiToFreq(pitch), f1: midiToFreq(pitch) * 0.7, len: 0.2, peak: 0.8, bend: 0.1 });
    end = k.end() + 0.05;
    nodes = k.nodes;
  }

  const voice = {
    end,
    release() {},
    stopNow() {
      const now = ctx.currentTime;
      for (const n of nodes) try { n.stop(now + 0.02); } catch { /* al gestopt */ }
    },
    chokeAt(t) { out.gain.setTargetAtTime(0, t, 0.008); },
  };
  // Een dichte hihat smoort de open hihat, zoals bij een echte drumcomputer.
  if (choke) {
    if (pitch === 42 || pitch === 46) { if (choke.open && choke.open.end > time) choke.open.chokeAt(time); choke.open = null; }
    if (pitch === 46) choke.open = voice;
  }
  return voice;
}
