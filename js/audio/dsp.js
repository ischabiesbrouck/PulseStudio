// DSP-hulpjes om geluid rechtstreeks per sample te berekenen (drums en ingebouwde instrumenten).
// Puur rekenwerk op Float32Arrays, zodat het ook in node te testen is.
export const SR = 44100;
export const TAU = Math.PI * 2;

// Voorspelbare toevalsgenerator (mulberry32): elke keer exact hetzelfde geluid.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const softclip = (x, k = 1) => Math.tanh(k * x) / Math.tanh(k);

// State-variable filter (Simper/Cytomic): laagdoorlaat, banddoorlaat en hoogdoorlaat tegelijk.
export class SVF {
  constructor(f = 1000, q = 0.707, sr = SR) { this.sr = sr; this.ic1 = 0; this.ic2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const g = Math.tan((Math.PI * Math.min(f, this.sr * 0.49)) / this.sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  // Geeft [laag, band, hoog] terug.
  run(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
    return this;
  }
}

// Bandbegrensde zaagtand met polyBLEP (geen aliasing-gekraak bij hoge tonen).
export class Saw {
  constructor(phase = 0) { this.p = phase; }
  next(inc) {
    this.p += inc;
    if (this.p >= 1) this.p -= 1;
    let y = 2 * this.p - 1;
    const t = this.p;
    if (t < inc) { const x = t / inc; y -= x + x - x * x - 1; }
    else if (t > 1 - inc) { const x = (t - 1) / inc; y -= x * x + x + x + 1; }
    return y;
  }
}

export function normalize(channels, peak = 0.89) {
  let max = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > max) max = a; }
  if (max > 0) { const k = peak / max; for (const d of channels) for (let i = 0; i < d.length; i++) d[i] *= k; }
  return channels;
}

// Korte fade aan het eind, zodat een sample nooit met een tik eindigt.
export function fadeTail(channels, seconds = 0.02, sr = SR) {
  const n = Math.min(Math.floor(seconds * sr), channels[0].length);
  for (const d of channels) for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n;
  return channels;
}

// Maakt het stuk tussen ls en le naadloos herhaalbaar: het einde loopt via een crossfade over in wat vóór ls staat.
export function seamlessLoop(channels, ls, le, xf) {
  xf = Math.min(xf, ls, le - ls);
  for (const d of channels) {
    for (let i = 0; i < xf; i++) {
      const t = i / xf;
      const a = Math.cos(t * Math.PI / 2), b = Math.sin(t * Math.PI / 2);
      d[le - xf + i] = d[le - xf + i] * a + d[ls - xf + i] * b;
    }
  }
  return channels;
}

export function toBuffer(channels, sr = SR) {
  const buf = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: sr });
  channels.forEach((d, i) => buf.copyToChannel(d, i));
  return buf;
}
