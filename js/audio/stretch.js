// Tijdrekken en tempodetectie op losse Float32Array-kanalen (geen Web Audio, dus ook in een worker en in node te gebruiken).
//
//   wsola(channels, ratio, sr)    ritmisch: korte stukjes met overlap, op golfvorm uitgelijnd. Houdt aanslagen strak (drums, ritmisch materiaal).
//   vocoder(channels, ratio, sr)  tonaal: phase vocoder met fasevergrendeling rond pieken. Glad voor pads, zang en akkoorden.
//   detectTempo(channels, sr, {name, duration})  tempo uit de bestandsnaam, de looplengte of de aanslagen.
//
// `ratio` is de nieuwe lengte gedeeld door de oude (2 = twee keer zo lang en dus half zo snel).

// ---------- FFT (radix 2, in place) ----------

const fftCache = new Map();
function fftTables(n) {
  let t = fftCache.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  t = { rev, cos, sin };
  fftCache.set(n, t);
  return t;
}

// Complexe FFT; inverse=true geeft de inverse (zonder 1/n, dat doet de aanroeper).
export function fft(re, im, inverse = false) {
  const n = re.length;
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sgn * sin[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const hann = (n) => Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
const pow2 = (x) => 2 ** Math.round(Math.log2(x));

// ---------- WSOLA ----------

export function wsola(channels, ratio, sr = 44100) {
  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen * ratio));
  const N = pow2(sr * 0.023);          // ~23 ms bij 44,1 kHz (1024)
  const Hs = N / 2;
  const Ha = Hs / ratio;
  const tol = N / 4;
  const win = hann(N);
  const mono = new Float32Array(inLen);
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length;
  const at = (i) => (i >= 0 && i < inLen ? mono[i] : 0);
  const out = channels.map(() => new Float32Array(outLen + N));
  // Elk venster ligt met zijn midden op k·Ha (in) en k·Hs (uit), zodat ook de eerste aanslag op volle sterkte klinkt.
  const frames = Math.ceil(outLen / Hs) + 2;
  let prev = -N / 2;
  for (let k = 0; k < frames; k++) {
    const ideal = Math.round(k * Ha) - N / 2;
    let pos = ideal;
    if (k > 0) {
      const nat = prev + Hs;
      const corr = (p, step) => { let s = 0; for (let i = 0; i < N; i += step) s += at(p + i) * at(nat + i); return s; };
      let coarse = ideal, coarseV = -Infinity;
      for (let d = -tol; d <= tol; d += 4) { const v = corr(ideal + d, 4); if (v > coarseV) { coarseV = v; coarse = ideal + d; } }
      let fineV = -Infinity;
      for (let d = -3; d <= 3; d++) { const v = corr(coarse + d, 2); if (v > fineV) { fineV = v; pos = coarse + d; } }
    }
    const o = k * Hs - N / 2;
    channels.forEach((ch, c) => {
      const y = out[c];
      for (let i = 0; i < N; i++) {
        const src = pos + i;
        const t = o + i;
        if (src >= 0 && src < inLen && t >= 0 && t < y.length) y[t] += ch[src] * win[i];
      }
    });
    prev = pos;
  }
  return out.map((y) => y.subarray(0, outLen));
}

// ---------- Phase vocoder ----------

const TWO_PI = 2 * Math.PI;
const wrap = (x) => x - TWO_PI * Math.round(x / TWO_PI);

export function vocoder(channels, ratio, sr = 44100) {
  const stereo = channels.length > 1;
  const L = channels[0], R = stereo ? channels[1] : channels[0];
  const inLen = L.length;
  const outLen = Math.max(1, Math.round(inLen * ratio));
  const N = pow2(sr * 0.093);          // 4096 bij 44,1 kHz
  const Hs = N / 4;
  const Ha = Hs / ratio;
  const bins = N / 2 + 1;
  const win = hann(N);
  const norm = 1 / 1.5;                // som van hann² bij 75% overlap
  const re = new Float64Array(N), im = new Float64Array(N);
  const prevPhase = new Float64Array(bins), synPhase = new Float64Array(bins);
  const magL = new Float64Array(bins), magR = new Float64Array(bins), phL = new Float64Array(bins), phR = new Float64Array(bins);
  const mag = new Float64Array(bins), ph = new Float64Array(bins), rot = new Float64Array(bins);
  const yL = new Float32Array(outLen + N), yR = new Float32Array(outLen + N);
  const frames = Math.ceil(outLen / Hs) + 2;
  let prevPos = 0;
  for (let k = 0; k < frames; k++) {
    const pos = Math.round(k * Ha) - N / 2;
    // L en R tegelijk door één complexe FFT: L als reëel deel, R als imaginair deel.
    for (let i = 0; i < N; i++) {
      const s = pos + i;
      const inside = s >= 0 && s < inLen;
      re[i] = inside ? L[s] * win[i] : 0;
      im[i] = inside ? R[s] * win[i] : 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const nb = (N - b) % N;
      const lr = (re[b] + re[nb]) / 2, li = (im[b] - im[nb]) / 2;
      const rr = (im[b] + im[nb]) / 2, ri = -(re[b] - re[nb]) / 2;
      magL[b] = Math.hypot(lr, li); phL[b] = Math.atan2(li, lr);
      magR[b] = Math.hypot(rr, ri); phR[b] = Math.atan2(ri, rr);
      const mr = lr + rr, mi = li + ri;
      mag[b] = Math.hypot(mr, mi); ph[b] = Math.atan2(mi, mr);
    }
    const hopA = k === 0 ? Ha : pos - prevPos;
    if (k === 0) synPhase.set(ph);
    else {
      // Fase vooruitzetten op de pieken; de bins eromheen volgen hun piek (fasevergrendeling).
      const peaks = [];
      for (let b = 2; b < bins - 2; b++) {
        if (mag[b] > mag[b - 1] && mag[b] >= mag[b + 1] && mag[b] > mag[b - 2] && mag[b] >= mag[b + 2]) peaks.push(b);
      }
      if (!peaks.length) peaks.push(1);
      for (const p of peaks) {
        const omega = (TWO_PI * p) / N;
        const dphi = wrap(ph[p] - prevPhase[p] - omega * hopA);
        synPhase[p] += Hs * (omega + dphi / Math.max(1, hopA));
      }
      let pi = 0;
      for (let b = 0; b < bins; b++) {
        while (pi < peaks.length - 1 && Math.abs(peaks[pi + 1] - b) < Math.abs(peaks[pi] - b)) pi++;
        const p = peaks[pi];
        if (b !== p) synPhase[b] = synPhase[p] + (ph[b] - ph[p]);
      }
    }
    prevPhase.set(ph);
    prevPos = pos;
    for (let b = 0; b < bins; b++) rot[b] = synPhase[b] - ph[b];
    // Zelfde rotatie op L en R, zodat het stereobeeld blijft staan; terug via één inverse FFT.
    re.fill(0); im.fill(0);
    for (let b = 0; b < bins; b++) {
      const aL = phL[b] + rot[b], aR = phR[b] + rot[b];
      const Lr = magL[b] * Math.cos(aL), Li = magL[b] * Math.sin(aL);
      const Rr = magR[b] * Math.cos(aR), Ri = magR[b] * Math.sin(aR);
      // Z = Y_L + i * Y_R, met hermitische aanvulling voor de negatieve frequenties.
      if (b === 0 || b === N / 2) { re[b] = Lr; im[b] = Rr; continue; }
      re[b] = Lr - Ri; im[b] = Li + Rr;
      const nb = N - b;
      re[nb] = Lr + Ri; im[nb] = -Li + Rr;
    }
    fft(re, im, true);
    const o = k * Hs - N / 2;
    for (let i = 0; i < N; i++) {
      const t = o + i;
      if (t < 0 || t >= yL.length) continue;
      yL[t] += (re[i] / N) * win[i] * norm;
      yR[t] += (im[i] / N) * win[i] * norm;
    }
  }
  const outL = yL.subarray(0, outLen), outR = yR.subarray(0, outLen);
  return stereo ? [outL, outR] : [outL];
}

export function stretch(channels, ratio, sr, mode = 'beats') {
  if (Math.abs(ratio - 1) < 1e-4) return channels.map((c) => c.slice());
  return mode === 'tones' ? vocoder(channels, ratio, sr) : wsola(channels, ratio, sr);
}

export const reverse = (channels) => channels.map((c) => c.slice().reverse());

// ---------- Tempodetectie ----------

// Aanslagcurve: positieve toename van de spectrale energie per blok (spectral flux).
export function onsetEnvelope(channels, sr) {
  const N = 1024, hop = 512;
  const len = channels[0].length;
  const frames = Math.max(0, Math.floor((len - N) / hop));
  const win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  let prev = new Float64Array(N / 2), cur = new Float64Array(N / 2);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const ch of channels) s += ch[f * hop + i];
      re[i] = (s / channels.length) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let b = 1; b < N / 2; b++) {
      cur[b] = Math.log1p(100 * Math.hypot(re[b], im[b]));
      const d = cur[b] - prev[b];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    [prev, cur] = [cur, prev];
  }
  return { env, fps: sr / hop };
}

const prior = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);

export function tempoFromName(name = '') {
  const m = /(\d{2,3}(?:[.,]\d+)?)\s*-?_?\s*bpm/i.exec(name) || /bpm\s*-?_?\s*(\d{2,3}(?:[.,]\d+)?)/i.exec(name);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return v >= 50 && v <= 250 ? v : null;
}

// Geeft { bpm, source: 'naam'|'loop'|'analyse'|null, loop, confidence } terug.
export function detectTempo(channels, sr, { name = '', duration } = {}) {
  const dur = duration ?? channels[0].length / sr;
  const fromName = tempoFromName(name);
  if (fromName) {
    const beats = (dur * fromName) / 60;
    return { bpm: fromName, source: 'naam', loop: Math.abs(beats - Math.round(beats)) < 0.08 && Math.round(beats) >= 4, confidence: 1 };
  }
  if (dur < 1.2) return { bpm: null, source: null, loop: false, confidence: 0 };
  const { env, fps } = onsetEnvelope(channels, sr);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length || 1;
  const e = env.map((v) => Math.max(0, v - mean));
  const maxLag = Math.min(e.length - 1, Math.ceil((60 * fps) / 50) * 4);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < e.length; i++) s += e[i] * e[i - lag];
    ac[lag] = s / (e.length - lag);
  }
  const acAt = (lag) => { const i = Math.floor(lag), f = lag - i; return i + 1 < ac.length ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
  // Kamfilter: een tempo scoort hoog als ook de veelvouden van de telafstand pieken.
  const score = (bpm) => {
    const lag = (60 * fps) / bpm;
    let s = 0;
    for (let k = 1; k <= 4; k++) if (lag * k < ac.length - 1) s += acAt(lag * k) / k;
    return s * prior(bpm);
  };
  let best = 120, bestS = -Infinity;
  for (let b = 60; b <= 200; b += 0.5) { const s = score(b); if (s > bestS) { bestS = s; best = b; } }
  for (let b = best - 0.5; b <= best + 0.5; b += 0.05) { const s = score(b); if (s > bestS) { bestS = s; best = b; } }
  let total = 0, count = 0;
  for (let b = 60; b <= 200; b += 2) { total += Math.max(0, score(b)); count++; }
  const confidence = bestS > 0 ? Math.min(1, bestS / (total / count) / 4) : 0;
  // Is het een loop? Dan is de lengte een heel aantal tellen; kies het aantal tellen dat het beste bij de analyse past.
  let loopPick = null;
  for (const beats of [4, 8, 12, 16, 24, 32, 48, 64]) {
    const bpm = (beats * 60) / dur;
    if (bpm < 60 || bpm > 200) continue;
    const s = score(bpm);
    if (!loopPick || s > loopPick.s) loopPick = { bpm, s };
  }
  if (loopPick && loopPick.s >= bestS * 0.6 && dur <= 40) {
    return { bpm: Math.round(loopPick.bpm * 100) / 100, source: 'loop', loop: true, confidence: Math.max(confidence, 0.6) };
  }
  const rounded = Math.abs(best - Math.round(best)) < 0.2 ? Math.round(best) : Math.round(best * 10) / 10;
  return { bpm: rounded, source: confidence > 0.25 ? 'analyse' : null, loop: false, confidence };
}
