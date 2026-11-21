// Ingebouwde effecten (Web Audio). Elk effect geeft { input, output, update(p, bpm, set) } terug,
// optioneel met schedule() (voor tempo-gebonden automatisering) en reset().
const dbToGain = (d) => 10 ** (d / 20);

function gain(ctx, v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
function biquad(ctx, type, f = 1000, q = 0.707) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function lfo(ctx, type = 'sine') { const o = ctx.createOscillator(); o.type = type; o.start(); return o; }

// Droog/nat-menging rond een effectpad.
function wetDry(ctx) {
  const input = gain(ctx), output = gain(ctx), dry = gain(ctx), wet = gain(ctx, 0);
  input.connect(dry).connect(output);
  wet.connect(output);
  return { input, output, dry, wet, mix(set, m) { set(dry.gain, Math.cos(m * Math.PI / 2)); set(wet.gain, Math.sin(m * Math.PI / 2)); } };
}

const curveCache = new Map();
function curve(key, fn, size = 4096) {
  if (!curveCache.has(key)) {
    const c = new Float32Array(size);
    for (let i = 0; i < size; i++) c[i] = fn((i / (size - 1)) * 2 - 1);
    curveCache.set(key, c);
  }
  return curveCache.get(key);
}
export const softClip = (k) => curve(`tanh${k.toFixed(2)}`, (x) => Math.tanh(k * x) / Math.tanh(k));
export const crushCurve = (bits) => { const lv = 2 ** (Math.round(bits) - 1); return curve(`crush${Math.round(bits)}`, (x) => Math.round(x * lv) / lv, 16384); };

const noiseCache = new WeakMap();
export function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

// Galm-impulsrespons per ruimtetype: vroege reflecties, opbouw en een staart die steeds donkerder wordt.
const ROOMS = {
  kamer: { er: [0.002, 0.03], taps: 14, build: 0.004, dark: 1.1 },
  zaal: { er: [0.01, 0.08], taps: 10, build: 0.02, dark: 1 },
  plaat: { er: null, taps: 0, build: 0.001, dark: 0.55 },
  kerk: { er: [0.03, 0.16], taps: 8, build: 0.07, dark: 1.25 },
};
const irCache = new WeakMap();
function impulse(ctx, size, damping, type = 'zaal') {
  const room = ROOMS[type] || ROOMS.zaal;
  const key = `${type}:${size.toFixed(1)}:${damping.toFixed(2)}`;
  let map = irCache.get(ctx);
  if (!map) irCache.set(ctx, (map = new Map()));
  if (map.has(key)) return map.get(key);
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * size));
  const buf = ctx.createBuffer(2, len, sr);
  const damp = Math.min(0.98, damping * room.dark);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const tSec = i / sr;
      const t = i / len;
      const a = 1 - damp * 0.97 * Math.sqrt(t);
      y += a * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.exp(-6.9 * t) * (1 - Math.exp(-tSec / room.build));
    }
    // Vroege reflecties: een paar losse echo's van de wanden, per kanaal anders voor ruimtelijkheid.
    if (room.er) {
      for (let k = 0; k < room.taps; k++) {
        const at = Math.floor(sr * (room.er[0] + Math.random() * (room.er[1] - room.er[0])));
        if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.9 - k * 0.04) * (0.6 + Math.random() * 0.4);
      }
    }
  }
  map.set(key, buf);
  return buf;
}

import { createWam } from './wam.js';

const hzOf = (bpm, beats) => bpm / 60 / beats;

// ---------- AudioWorklet ----------

const WORKLET_URL = new URL('./worklets.js', import.meta.url).href;
const loaded = new WeakMap();
const workletOk = new WeakSet();
// Laadt de processors in een (offline) context; zonder AudioWorklet vallen die effecten terug op doorlussen.
export function loadWorklets(ctx) {
  if (!loaded.has(ctx)) {
    loaded.set(ctx, ctx.audioWorklet
      ? ctx.audioWorklet.addModule(WORKLET_URL).then(() => { workletOk.add(ctx); return true; }, (err) => { console.warn('AudioWorklet niet beschikbaar', err); return false; })
      : Promise.resolve(false));
  }
  return loaded.get(ctx);
}
export const hasWorklets = (ctx) => workletOk.has(ctx);

// Effect rond één AudioWorkletNode; de parameters heten hetzelfde als in plugin-defs.js.
function workletFx(ctx, name, extra = {}) {
  if (!workletOk.has(ctx)) {
    const g = gain(ctx);
    return { input: g, output: g, update() {}, fallback: true };
  }
  const node = new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  let gr = 0;
  node.port.onmessage = (e) => { gr = e.data; };
  return {
    input: node, output: node,
    reduction: () => -gr,
    update(p, bpm, set) {
      for (const [k, v] of Object.entries(p)) { const ap = node.parameters.get(k); if (ap && typeof v === 'number') set(ap, v); }
      extra.update?.(p, set);
    },
    dispose() { node.port.postMessage('stop'); },
  };
}

// Linkwitz-Riley-wissel (4e orde): twee keer een Butterworth van de 2e orde.
function lr4(ctx, type) {
  const a = biquad(ctx, type, 1000, Math.SQRT1_2), b = biquad(ctx, type, 1000, Math.SQRT1_2);
  a.connect(b);
  return { input: a, output: b, freq: (set, f) => { set(a.frequency, f); set(b.frequency, f); } };
}

// BBD-chorus: snelheden en dieptes zoals bij de bekende polysynth-chorus (stand I, II en beide).
const ENSEMBLE = { 1: { rate: 0.513, depth: 0.00185 }, 2: { rate: 0.863, depth: 0.00185 }, 3: { rate: 9.75, depth: 0.00032 } };

export const IMPL = {
  eq(ctx) {
    const hp = biquad(ctx, 'highpass', 20);
    const low = biquad(ctx, 'lowshelf', 120);
    const mid = biquad(ctx, 'peaking', 1000);
    const high = biquad(ctx, 'highshelf', 6000);
    hp.connect(low).connect(mid).connect(high);
    return {
      input: hp, output: high,
      update(p, bpm, set) {
        set(hp.frequency, p.lowCut);
        set(low.frequency, p.lowFreq); set(low.gain, p.low);
        set(mid.frequency, p.midFreq); set(mid.gain, p.mid); set(mid.Q, p.midQ);
        set(high.frequency, p.highFreq); set(high.gain, p.high);
      },
    };
  },

  comp(ctx) {
    const c = ctx.createDynamicsCompressor();
    const makeup = gain(ctx);
    c.knee.value = 6;
    c.connect(makeup);
    return {
      input: c, output: makeup,
      reduction: () => c.reduction,
      update(p, bpm, set) {
        set(c.threshold, p.threshold); set(c.ratio, p.ratio); set(c.attack, p.attack); set(c.release, p.release);
        set(makeup.gain, dbToGain(p.makeup));
      },
    };
  },

  sat(ctx) {
    const w = wetDry(ctx);
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '4x';
    const tone = biquad(ctx, 'lowpass', 9000);
    const out = gain(ctx);
    w.input.connect(shaper).connect(tone).connect(out).connect(w.wet);
    let last = null;
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        const k = dbToGain(p.drive);
        if (last !== p.drive) { shaper.curve = softClip(k); last = p.drive; }
        set(tone.frequency, p.tone);
        set(out.gain, dbToGain(p.output));
        w.mix(set, p.mix);
      },
    };
  },

  lofi(ctx) {
    const w = wetDry(ctx);
    const shaper = ctx.createWaveShaper();
    const tone = biquad(ctx, 'lowpass', 4500);
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer(ctx);
    hiss.loop = true;
    const hissGain = gain(ctx, 0);
    const hissTone = biquad(ctx, 'bandpass', 3000, 0.4);
    hiss.connect(hissTone).connect(hissGain).connect(tone);
    hiss.start();
    w.input.connect(shaper).connect(tone).connect(w.wet);
    let last = null;
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        if (last !== Math.round(p.bits)) { shaper.curve = crushCurve(p.bits); last = Math.round(p.bits); }
        set(tone.frequency, p.tone);
        set(hissGain.gain, p.noise * 0.03);
        w.mix(set, p.mix);
      },
      dispose() { try { hiss.stop(); } catch { /* al gestopt */ } },
    };
  },

  chorus(ctx) {
    const w = wetDry(ctx);
    const dl = ctx.createDelay(0.1), dr = ctx.createDelay(0.1);
    dl.delayTime.value = 0.014;
    dr.delayTime.value = 0.019;
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
    pl.pan.value = -0.85;
    pr.pan.value = 0.85;
    const mod = lfo(ctx);
    const ml = gain(ctx), mr = gain(ctx);
    mod.connect(ml).connect(dl.delayTime);
    mod.connect(mr).connect(dr.delayTime);
    w.input.connect(dl).connect(pl).connect(w.wet);
    w.input.connect(dr).connect(pr).connect(w.wet);
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        set(mod.frequency, p.rate);
        set(ml.gain, p.depth * 0.006);
        set(mr.gain, -p.depth * 0.006);
        w.mix(set, p.mix);
      },
      dispose() { mod.stop(); },
    };
  },

  phaser(ctx) {
    const w = wetDry(ctx);
    const stages = [0, 1, 2, 3].map(() => biquad(ctx, 'allpass', 900, 0.6));
    const fb = gain(ctx, 0);
    const mod = lfo(ctx);
    const depth = gain(ctx);
    stages.reduce((a, b) => a.connect(b));
    for (const s of stages) depth.connect(s.frequency);
    mod.connect(depth);
    w.input.connect(stages[0]);
    stages[3].connect(w.wet);
    stages[3].connect(fb).connect(stages[0]);
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        set(mod.frequency, p.rate);
        set(depth.gain, p.depth * 750);
        set(fb.gain, p.feedback);
        w.mix(set, p.mix);
      },
      dispose() { mod.stop(); },
    };
  },

  delay(ctx) {
    const w = wetDry(ctx);
    const dl = ctx.createDelay(6), dr = ctx.createDelay(6);
    const tl = biquad(ctx, 'lowpass', 5000), tr = biquad(ctx, 'lowpass', 5000);
    const selfL = gain(ctx, 0), selfR = gain(ctx, 0), crossLR = gain(ctx, 0), crossRL = gain(ctx, 0);
    const toR = gain(ctx, 0);
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
    w.input.connect(dl);
    w.input.connect(toR).connect(dr);
    dl.connect(tl); dr.connect(tr);
    tl.connect(selfL).connect(dl); tr.connect(selfR).connect(dr);
    tl.connect(crossLR).connect(dr); tr.connect(crossRL).connect(dl);
    tl.connect(pl).connect(w.wet); tr.connect(pr).connect(w.wet);
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        const t = Math.min(5.9, p.time * 60 / bpm);
        set(dl.delayTime, t); set(dr.delayTime, t);
        set(tl.frequency, p.tone); set(tr.frequency, p.tone);
        const pp = !!p.pingpong;
        set(selfL.gain, pp ? 0 : p.feedback); set(selfR.gain, pp ? 0 : p.feedback);
        set(crossLR.gain, pp ? p.feedback : 0); set(crossRL.gain, pp ? p.feedback : 0);
        set(toR.gain, pp ? 0 : 1);
        set(pl.pan, pp ? -1 : -0.2); set(pr.pan, pp ? 1 : 0.2);
        w.mix(set, p.mix);
      },
    };
  },

  reverb(ctx) {
    const w = wetDry(ctx);
    const pre = ctx.createDelay(1);
    const conv = ctx.createConvolver();
    const hp = biquad(ctx, 'highpass', 120);
    w.input.connect(pre).connect(hp).connect(conv).connect(w.wet);
    let key = '';
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        const k = `${p.type}:${p.size.toFixed(1)}:${p.damping.toFixed(2)}`;
        if (k !== key) { conv.buffer = impulse(ctx, p.size, p.damping, p.type); key = k; }
        set(pre.delayTime, p.predelay);
        w.mix(set, p.mix);
      },
    };
  },

  autofilter(ctx) {
    const f = biquad(ctx, 'lowpass', 1200);
    const mod = lfo(ctx);
    const depth = gain(ctx);
    mod.connect(depth).connect(f.detune);
    return {
      input: f, output: f,
      update(p, bpm, set) {
        f.type = p.type;
        set(f.frequency, p.cutoff); set(f.Q, p.reso);
        set(mod.frequency, hzOf(bpm, p.rate));
        set(depth.gain, p.depth * 2400);
      },
      dispose() { mod.stop(); },
    };
  },

  tremolo(ctx) {
    const amp = gain(ctx);
    const pan = ctx.createStereoPanner();
    const mod = lfo(ctx);
    const ampDepth = gain(ctx, 0), panDepth = gain(ctx, 0);
    mod.connect(ampDepth).connect(amp.gain);
    mod.connect(panDepth).connect(pan.pan);
    amp.connect(pan);
    return {
      input: amp, output: pan,
      update(p, bpm, set) {
        set(mod.frequency, hzOf(bpm, p.rate));
        const isAmp = p.mode === 'amp';
        set(amp.gain, isAmp ? 1 - p.depth / 2 : 1);
        set(ampDepth.gain, isAmp ? p.depth / 2 : 0);
        set(panDepth.gain, isAmp ? 0 : p.depth);
      },
      dispose() { mod.stop(); },
    };
  },

  pump(ctx) {
    const g = gain(ctx);
    return {
      input: g, output: g,
      update() {},
      schedule(from, to, time, spb, p) {
        const step = +p.rate;
        for (let b = Math.ceil(from / step - 1e-9) * step; b < to; b += step) {
          const t = time + (b - from) * spb;
          g.gain.setValueAtTime(1 - p.amount, t);
          g.gain.linearRampToValueAtTime(1, t + Math.max(0.02, p.release * step * spb));
        }
      },
      reset() { g.gain.cancelScheduledValues(0); g.gain.value = 1; },
    };
  },

  width(ctx) {
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const ll = gain(ctx), rl = gain(ctx), rr = gain(ctx), lr = gain(ctx);
    split.connect(ll, 0).connect(merge, 0, 0);
    split.connect(rl, 1).connect(merge, 0, 0);
    split.connect(rr, 1).connect(merge, 0, 1);
    split.connect(lr, 0).connect(merge, 0, 1);
    return {
      input: split, output: merge,
      update(p, bpm, set) {
        const same = (1 + p.width) / 2, other = (1 - p.width) / 2;
        set(ll.gain, same); set(rr.gain, same); set(rl.gain, other); set(lr.gain, other);
      },
    };
  },

  limiter(ctx) {
    const pre = gain(ctx);
    const c = ctx.createDynamicsCompressor();
    c.knee.value = 0;
    c.ratio.value = 20;
    c.attack.value = 0.001;
    c.release.value = 0.08;
    const clip = ctx.createWaveShaper();
    clip.oversample = '2x';
    pre.connect(c).connect(clip);
    let last = null;
    return {
      input: pre, output: clip,
      reduction: () => c.reduction,
      update(p, bpm, set) {
        set(pre.gain, dbToGain(p.gain));
        set(c.threshold, p.ceiling - 2);
        if (last !== p.ceiling) {
          const ceil = dbToGain(p.ceiling);
          clip.curve = curve(`ceil${p.ceiling}`, (x) => { const a = Math.abs(x); const s = a < ceil * 0.8 ? a : ceil * 0.8 + (ceil * 0.2) * Math.tanh((a - ceil * 0.8) / (ceil * 0.2)); return Math.sign(x) * s; });
          last = p.ceiling;
        }
      },
    };
  },

  // Externe plug-in (Web Audio Module). Tot hij geladen is (of als laden mislukt) gaat het geluid er onveranderd doorheen.
  wam(ctx, ins) {
    const input = gain(ctx), output = gain(ctx), dry = gain(ctx);
    input.connect(dry).connect(output);
    const fx = { input, output, url: ins.wam.url, inst: null, error: null, gui: null, disposed: false, update() {} };
    fx.ready = createWam(ctx, ins.wam.url, ins.wam.state).then((inst) => {
      if (fx.disposed) { try { inst.audioNode.destroy?.(); } catch { /* al weg */ } return; }
      fx.inst = inst;
      input.connect(inst.audioNode);
      inst.audioNode.connect(output);
      dry.disconnect();
    }, (err) => { fx.error = err; console.warn(`Plug-in "${ins.wam.name}" kon niet laden`, err); });
    fx.dispose = () => {
      fx.disposed = true;
      if (!fx.inst) return;
      try { if (fx.gui) fx.inst.destroyGui?.(fx.gui); } catch { /* geen GUI */ }
      try { fx.inst.audioNode.disconnect(); fx.inst.audioNode.destroy?.(); } catch { /* al weg */ }
    };
    return fx;
  },

  maximizer: (ctx) => workletFx(ctx, 'ps-maximizer'),
  gate: (ctx) => workletFx(ctx, 'ps-gate'),
  transient: (ctx) => workletFx(ctx, 'ps-transient'),
  deesser: (ctx) => workletFx(ctx, 'ps-deesser'),
  tape: (ctx) => workletFx(ctx, 'ps-tape'),
  freeverb: (ctx) => workletFx(ctx, 'ps-freeverb'),
  plate: (ctx) => workletFx(ctx, 'ps-plate'),

  multiband(ctx) {
    const input = gain(ctx), output = gain(ctx);
    const lowLp = lr4(ctx, 'lowpass'), lowHp = lr4(ctx, 'highpass');
    const midLp = lr4(ctx, 'lowpass'), highHp = lr4(ctx, 'highpass');
    const align = biquad(ctx, 'allpass', 3000, Math.SQRT1_2); // fase van het laag gelijk trekken met midden + hoog
    input.connect(lowLp.input);
    input.connect(lowHp.input);
    lowLp.output.connect(align);
    lowHp.output.connect(midLp.input);
    lowHp.output.connect(highHp.input);
    const bands = [align, midLp.output, highHp.output].map((src) => {
      const c = ctx.createDynamicsCompressor();
      c.knee.value = 8;
      const g = gain(ctx);
      src.connect(c).connect(g).connect(output);
      return { c, g };
    });
    return {
      input, output,
      reduction: () => Math.min(...bands.map((b) => b.c.reduction)),
      bands: () => bands.map((b) => b.c.reduction),
      update(p, bpm, set) {
        lowLp.freq(set, p.lowX); lowHp.freq(set, p.lowX);
        const hx = Math.max(p.highX, p.lowX * 1.5);
        midLp.freq(set, hx); highHp.freq(set, hx); set(align.frequency, hx);
        bands.forEach((b, i) => {
          set(b.c.threshold, p.threshold); set(b.c.ratio, p.ratio); set(b.c.attack, p.attack * (i === 0 ? 1.6 : i === 2 ? 0.6 : 1)); set(b.c.release, p.release * (i === 0 ? 1.4 : 1));
          set(b.g.gain, dbToGain([p.low, p.mid, p.high][i]));
        });
      },
    };
  },

  ensemble(ctx) {
    const w = wetDry(ctx);
    const dl = ctx.createDelay(0.05), dr = ctx.createDelay(0.05);
    dl.delayTime.value = dr.delayTime.value = 0.0035;
    const mod = lfo(ctx, 'triangle');
    const ml = gain(ctx), mr = gain(ctx);
    mod.connect(ml).connect(dl.delayTime);
    mod.connect(mr).connect(dr.delayTime);
    // Het BBD-geluid: wat gedempte hoogte en een klein beetje ruis zou erbij horen; de hoogte nemen we mee.
    const tl = biquad(ctx, 'lowpass', 9000, 0.5), tr = biquad(ctx, 'lowpass', 9000, 0.5);
    const merge = ctx.createChannelMerger(2);
    const mono = gain(ctx);
    mono.channelCount = 1; mono.channelCountMode = 'explicit';
    w.input.connect(mono);
    mono.connect(dl).connect(tl).connect(merge, 0, 0);
    mono.connect(dr).connect(tr).connect(merge, 0, 1);
    const width = IMPL.width(ctx);
    merge.connect(width.input);
    width.output.connect(w.wet);
    return {
      input: w.input, output: w.output,
      update(p, bpm, set) {
        const m = ENSEMBLE[p.mode] || ENSEMBLE[1];
        set(mod.frequency, m.rate);
        set(ml.gain, m.depth); set(mr.gain, -m.depth);
        width.update({ width: p.width }, bpm, set);
        w.mix(set, p.mix);
      },
      dispose() { mod.stop(); },
    };
  },
};

// Insert-slot met aan/uit-schakelaar zonder klikken.
export class Slot {
  constructor(ctx, ins) {
    this.id = ins.id;
    this.type = ins.type;
    this.ins = ins;
    this.input = gain(ctx);
    this.output = gain(ctx);
    this.bypass = gain(ctx, 0);
    this.wet = gain(ctx);
    this.fx = IMPL[ins.type](ctx, ins);
    this.input.connect(this.bypass).connect(this.output);
    this.input.connect(this.fx.input);
    this.fx.output.connect(this.wet).connect(this.output);
  }

  update(ins, bpm, set) {
    this.ins = ins;
    set(this.bypass.gain, ins.on ? 0 : 1);
    set(this.wet.gain, ins.on ? 1 : 0);
    this.fx.update(ins.params, bpm, set);
  }

  dispose() {
    this.fx.dispose?.();
    try { this.output.disconnect(); this.input.disconnect(); } catch { /* al losgekoppeld */ }
  }
}
