// Signaalketen per spoor: EQ → compressor → (droog + delay + galm) → pan → fader → meter.
import { dbToGain } from '../model.js';

const impulseCache = new WeakMap();
function impulse(ctx, seconds) {
  const key = Math.round(seconds * 10) / 10;
  let map = impulseCache.get(ctx);
  if (!map) impulseCache.set(ctx, (map = new Map()));
  if (map.has(key)) return map.get(key);
  const len = Math.max(1, Math.floor(ctx.sampleRate * key));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  map.set(key, buf);
  return buf;
}

export function readPeak(analyser, scratch) {
  analyser.getFloatTimeDomainData(scratch);
  let max = 0;
  for (let i = 0; i < scratch.length; i++) { const a = Math.abs(scratch[i]); if (a > max) max = a; }
  return max;
}

export class TrackChain {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 220;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.8;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 5000;
    this.comp = ctx.createDynamicsCompressor();
    this.sum = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.feedback = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverbWet = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.fader = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;

    this.input.connect(this.low).connect(this.mid).connect(this.high).connect(this.comp);
    this.comp.connect(this.sum);
    this.comp.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.delayWet).connect(this.sum);
    this.comp.connect(this.reverb);
    this.reverb.connect(this.reverbWet).connect(this.sum);
    this.sum.connect(this.panner).connect(this.fader);
    this.fader.connect(this.analyser);
    this.fader.connect(dest);
    this.reverbSize = 0;
  }

  update(track, bpm, audible, immediate = false) {
    const fx = track.fx;
    const t = this.ctx.currentTime;
    const set = immediate ? (param, v) => { param.value = v; } : (param, v) => param.setTargetAtTime(v, t, 0.015);
    set(this.low.gain, fx.eq.low);
    set(this.mid.gain, fx.eq.mid);
    set(this.high.gain, fx.eq.high);
    this.comp.threshold.value = fx.comp.on ? fx.comp.threshold : 0;
    this.comp.ratio.value = fx.comp.on ? fx.comp.ratio : 1;
    this.comp.knee.value = fx.comp.on ? 6 : 0;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.15;
    set(this.delay.delayTime, Math.min(4, fx.delay.time * 60 / bpm));
    set(this.feedback.gain, fx.delay.on ? Math.min(0.92, fx.delay.feedback) : 0);
    set(this.delayWet.gain, fx.delay.on ? fx.delay.mix : 0);
    if (fx.reverb.on && Math.abs(this.reverbSize - fx.reverb.size) > 0.05) {
      this.reverb.buffer = impulse(this.ctx, fx.reverb.size);
      this.reverbSize = fx.reverb.size;
    }
    set(this.reverbWet.gain, fx.reverb.on ? fx.reverb.mix : 0);
    set(this.panner.pan, track.pan);
    set(this.fader.gain, audible ? dbToGain(track.volume) : 0);
  }

  dispose() {
    try { this.fader.disconnect(); this.input.disconnect(); } catch { /* al losgekoppeld */ }
  }
}

// Masterbus met een zachte begrenzer, zodat een export niet clipt.
export function createMaster(ctx) {
  const input = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  input.connect(limiter).connect(ctx.destination);
  limiter.connect(analyser);
  return { input, analyser, setVolume(db) { input.gain.setTargetAtTime(dbToGain(db), ctx.currentTime, 0.015); } };
}
