// Instrumenten: een subtractieve synth (2 oscillatoren, filter, ADSR) en een gesynthetiseerde drumcomputer.
// Alles werkt op elke BaseAudioContext, dus ook in een OfflineAudioContext voor het exporteren.
import { midiToFreq } from '../model.js';

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
}

// Start een synthnoot op `time`. Geeft een stem terug met release(t) en stopNow().
export function synthVoice(ctx, dest, s, pitch, vel, time) {
  const freq = midiToFreq(pitch);
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = s.wave1;
  o2.type = s.wave2;
  o1.frequency.value = freq;
  o2.frequency.value = freq * 2 ** (s.osc2Oct || 0);
  o1.detune.value = -s.detune / 2;
  o2.detune.value = s.detune / 2;
  const g1 = ctx.createGain();
  const g2 = ctx.createGain();
  g1.gain.value = 1 - s.mix;
  g2.gain.value = s.mix;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = s.reso;
  const base = Math.max(30, s.cutoff);
  const top = Math.min(18000, base + s.envAmt * (0.5 + vel / 2));
  const sus = base + (top - base) * s.sustain;
  filter.frequency.setValueAtTime(base, time);
  filter.frequency.linearRampToValueAtTime(top, time + s.attack);
  filter.frequency.setTargetAtTime(sus, time + s.attack, Math.max(0.005, s.decay / 3));

  const amp = ctx.createGain();
  const peak = vel * s.gain * 0.8;
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + s.attack);
  amp.gain.setTargetAtTime(peak * s.sustain, time + s.attack, Math.max(0.005, s.decay / 3));

  o1.connect(g1).connect(filter);
  o2.connect(g2).connect(filter);
  filter.connect(amp).connect(dest);
  o1.start(time);
  o2.start(time);

  const voice = {
    end: Infinity,
    release(t) {
      const tc = Math.max(0.005, s.release / 4);
      holdAt(amp.gain, t);
      amp.gain.setTargetAtTime(0, t, tc);
      holdAt(filter.frequency, t);
      filter.frequency.setTargetAtTime(base, t, tc);
      voice.end = t + tc * 6 + 0.02;
      o1.stop(voice.end);
      o2.stop(voice.end);
    },
    stopNow() {
      const now = ctx.currentTime;
      holdAt(amp.gain, now);
      amp.gain.setTargetAtTime(0, now, 0.008);
      try { o1.stop(now + 0.05); o2.stop(now + 0.05); } catch { /* al gestopt */ }
      voice.end = now + 0.05;
    },
  };
  return voice;
}

function oneShot(ctx, nodes, end) {
  return {
    end,
    release() {},
    stopNow() {
      const now = ctx.currentTime;
      for (const n of nodes) try { n.stop(now + 0.02); } catch { /* al gestopt */ }
    },
  };
}

// Eén drumslag. `pitch` volgt General MIDI (36 kick, 38 snare, ...).
export function drumHit(ctx, dest, kit, pitch, vel, time) {
  const tune = 2 ** ((kit.tune || 0) / 12);
  const dec = kit.decay || 1;
  const level = vel * (kit.level ?? 0.9) * 0.6;
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(dest);

  const env = (len, peak = 1) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0008, time + len * dec);
    g.connect(out);
    return g;
  };
  const noise = (len, type, freq, q = 0.8, peak = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * tune;
    f.Q.value = q;
    src.connect(f).connect(env(len, peak));
    src.start(time, Math.random() * 1.5);
    src.stop(time + len * dec + 0.05);
    return src;
  };
  const tone = (len, f0, f1, type = 'sine', peak = 1, bend = 0.08) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * tune, time);
    o.frequency.exponentialRampToValueAtTime(f1 * tune, time + bend);
    o.connect(env(len, peak));
    o.start(time);
    o.stop(time + len * dec + 0.05);
    return o;
  };

  const nodes = [];
  let len = 0.3;
  switch (pitch) {
    case 36: len = 0.5; nodes.push(tone(0.5, 160, 42, 'sine', 1.2, 0.11), tone(0.02, 1200, 200, 'square', 0.25, 0.02)); break;
    case 38: len = 0.25; nodes.push(tone(0.12, 240, 170, 'triangle', 0.7, 0.05), noise(0.22, 'highpass', 1400, 0.7, 0.8)); break;
    case 39: {
      len = 0.3;
      for (const [d, p] of [[0, 0.7], [0.012, 0.6], [0.024, 0.8]]) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1400 * tune; f.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(p, time + d);
        g.gain.exponentialRampToValueAtTime(0.001, time + d + (d < 0.02 ? 0.012 : 0.22 * dec));
        src.connect(f).connect(g).connect(out);
        src.start(time + d, Math.random());
        src.stop(time + 0.35 * dec);
        nodes.push(src);
      }
      break;
    }
    case 42: len = 0.06; nodes.push(noise(0.06, 'highpass', 7500, 0.6, 0.6)); break;
    case 46: len = 0.4; nodes.push(noise(0.4, 'highpass', 7000, 0.6, 0.5)); break;
    case 45: len = 0.4; nodes.push(tone(0.4, 150, 90, 'sine', 1, 0.2)); break;
    case 50: len = 0.32; nodes.push(tone(0.32, 260, 170, 'sine', 0.9, 0.18)); break;
    case 49: len = 1.4; nodes.push(noise(1.4, 'highpass', 4500, 0.4, 0.45)); break;
    default: nodes.push(tone(0.2, midiToFreq(pitch), midiToFreq(pitch) * 0.7, 'triangle', 0.8, 0.1));
  }
  return oneShot(ctx, nodes, time + len * dec + 0.06);
}
