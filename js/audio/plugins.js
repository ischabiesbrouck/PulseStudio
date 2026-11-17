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

// Galm-impulsrespons: ruis met exponentieel verval en een filter dat steeds donkerder wordt.
const irCache = new WeakMap();
function impulse(ctx, size, damping) {
  const key = `${size.toFixed(1)}:${damping.toFixed(2)}`;
  let map = irCache.get(ctx);
  if (!map) irCache.set(ctx, (map = new Map()));
  if (map.has(key)) return map.get(key);
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * size));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const a = 1 - damping * 0.97 * Math.sqrt(t);
      y += a * ((Math.random() * 2 - 1) - y);
      const early = i < sr * 0.08 && Math.random() < 0.002 ? (Math.random() * 2 - 1) * 3 : 0;
      d[i] = (y + early) * Math.exp(-6.9 * t);
    }
  }
  map.set(key, buf);
  return buf;
}

const hzOf = (bpm, beats) => bpm / 60 / beats;

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
        const k = `${p.size.toFixed(1)}:${p.damping.toFixed(2)}`;
        if (k !== key) { conv.buffer = impulse(ctx, p.size, p.damping); key = k; }
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
    this.fx = IMPL[ins.type](ctx);
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
