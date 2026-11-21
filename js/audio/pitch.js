// Toonhoogte van een sample bepalen (YIN, de Cheveigné en Kawahara 2002), zodat een sampler weet
// welke toets het geluid op zijn eigen hoogte speelt. Pure functies, ook in node te testen.

// YIN op één stukje signaal. Geeft { freq, clarity } of null.
export function yin(x, sr, { minF = 40, maxF = 2000, threshold = 0.12 } = {}) {
  const W = x.length >> 1;
  const tauMin = Math.max(2, Math.floor(sr / maxF));
  const tauMax = Math.min(W - 1, Math.ceil(sr / minF));
  if (tauMax <= tauMin) return null;
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    d[tau] = s;
  }
  // Cumulatief genormaliseerd verschil: voorkomt dat de octaaf eronder wint.
  const c = new Float64Array(tauMax + 2);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; c[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (c[t] < threshold) { while (t + 1 <= tauMax && c[t + 1] < c[t]) t++; tau = t; break; }
  }
  if (tau < 0) {
    let m = Infinity;
    for (let t = tauMin; t <= tauMax; t++) if (c[t] < m) { m = c[t]; tau = t; }
    if (m > 0.3) return null;
  }
  const a = c[tau - 1], b = c[tau], e = c[tau + 1];
  const den = a - 2 * b + e;
  const shift = den !== 0 ? Math.max(-1, Math.min(1, (0.5 * (a - e)) / den)) : 0;
  return { freq: sr / (tau + shift), clarity: 1 - b };
}

// Toonhoogte van een heel sample: een paar metingen net na de aanslag, daarvan de mediaan.
// Geeft { midi, note, cents, freq } of null (bij ruis, drums of akkoorden zonder duidelijke grondtoon).
export function detectPitch(channels, sr) {
  const len = channels[0].length;
  const mono = new Float32Array(Math.min(len, Math.round(sr * 4)));
  for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length;
  const N = 4096 * Math.max(1, Math.round(sr / 48000));
  if (mono.length < N) return null;
  // Waar is het geluid het sterkst? Daar (iets erna) meten.
  let best = 0, bestE = 0;
  for (let s = 0; s + N <= mono.length; s += N >> 2) {
    let e = 0;
    for (let i = s; i < s + N; i += 4) e += mono[i] * mono[i];
    if (e > bestE) { bestE = e; best = s; }
  }
  if (bestE / (N / 4) < 1e-7) return null;
  const freqs = [];
  const step = Math.round(sr * 0.035);
  for (let k = 0; k < 7; k++) {
    const s = best + Math.round(sr * 0.02) + k * step;
    if (s + N > mono.length) break;
    const r = yin(mono.subarray(s, s + N), sr);
    if (r && r.clarity > 0.75) freqs.push(r.freq);
  }
  if (freqs.length < 2) return null;
  freqs.sort((a, b) => a - b);
  const f = freqs[freqs.length >> 1];
  const midi = 69 + 12 * Math.log2(f / 440);
  const note = Math.round(midi);
  return { midi, note, cents: Math.round((midi - note) * 100), freq: f };
}

// Stilte aan begin en eind weghalen; geeft [start, eind] in samples.
export function trimSilence(channels, threshold = 0.0005, padStart = 0, padEnd = 0) {
  const len = channels[0].length;
  const loud = (i) => channels.some((c) => Math.abs(c[i]) > threshold);
  let a = 0, b = len - 1;
  while (a < len && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  return [Math.max(0, a - padStart), Math.min(len, b + 1 + padEnd)];
}
