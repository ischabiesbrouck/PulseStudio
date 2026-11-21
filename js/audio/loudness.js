// Luidheid volgens EBU R128 / ITU-R BS.1770: K-weging, blokken van 400 ms (elke 100 ms) en de twee poorten.
// Pure functies, dus ook in node te testen. De live-meting gebeurt in worklets.js (ps-loudness) met dezelfde filters.

export const lufs = (ms) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

export function kWeighting(sr) {
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416, Q1 = 0.7071752369554196;
  let a0 = 1 + K / Q1 + K * K;
  const s1 = { b: [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0] };
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  return [s1, { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0] }];
}

// Geïntegreerde luidheid uit de gemiddelde kwadratensommen van overlappende blokken van 400 ms.
export function integrated(blocks) {
  const abs = blocks.filter((ms) => lufs(ms) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((s, v) => s + v, 0) / abs.length) - 10;
  const kept = abs.filter((ms) => lufs(ms) > rel);
  return kept.length ? lufs(kept.reduce((s, v) => s + v, 0) / kept.length) : -Infinity;
}

// Live-meter: krijgt elke 100 ms { ms, peak, corr } binnen.
export class LoudnessMeter {
  constructor() { this.reset(); }
  reset() { this.hundreds = []; this.gating = []; this.peak = 0; this.corr = 1; this.maxM = -Infinity; }
  push({ ms, peak, corr }) {
    this.hundreds.push(ms);
    if (this.hundreds.length > 30) this.hundreds.shift();
    if (this.hundreds.length >= 4) this.gating.push(this.mean(4));
    if (this.gating.length > 36000) this.gating.shift(); // maximaal een uur
    this.peak = Math.max(this.peak, peak);
    this.corr = this.corr * 0.8 + corr * 0.2;
    this.maxM = Math.max(this.maxM, this.momentary());
  }
  mean(n) { const a = this.hundreds.slice(-n); return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length); }
  momentary() { return this.hundreds.length >= 4 ? lufs(this.mean(4)) : -Infinity; }
  shortTerm() { return this.hundreds.length >= 30 ? lufs(this.mean(30)) : this.hundreds.length >= 4 ? lufs(this.mean(this.hundreds.length)) : -Infinity; }
  integrated() { return integrated(this.gating); }
}

// Luidheid en piek van een gerenderd nummer.
export function measure(channels, sr) {
  const st = kWeighting(sr);
  const hop = Math.round(sr * 0.1);
  const sums = [];
  let peak = 0;
  const filtered = channels.slice(0, 2).map((x) => {
    const y = new Float32Array(x.length);
    const z = st.map(() => [0, 0]);
    for (let i = 0; i < x.length; i++) {
      let v = x[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      for (let k = 0; k < st.length; k++) {
        const s = st[k], zz = z[k];
        const o = s.b[0] * v + zz[0];
        zz[0] = s.b[1] * v - s.a[0] * o + zz[1];
        zz[1] = s.b[2] * v - s.a[1] * o;
        v = o;
      }
      y[i] = v;
    }
    return y;
  });
  const len = channels[0].length;
  for (let start = 0; start + hop <= len; start += hop) {
    let s = 0;
    for (const y of filtered) for (let i = start; i < start + hop; i++) s += y[i] * y[i];
    sums.push(s / hop);
  }
  const blocks = [];
  for (let i = 3; i < sums.length; i++) blocks.push((sums[i] + sums[i - 1] + sums[i - 2] + sums[i - 3]) / 4);
  return { integrated: integrated(blocks), peak };
}
