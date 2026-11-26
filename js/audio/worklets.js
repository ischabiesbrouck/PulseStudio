// AudioWorklet-processors voor effecten die niet met de standaard Web Audio-nodes te bouwen zijn.
// Dit bestand draait in de AudioWorkletGlobalScope (eigen audiothread); `sampleRate` is daar een globale.
//
// De binnenste lussen maken geen objecten of arrays aan en zoeken niets op naam op: dat scheelt veel rekentijd
// en de geheugenopruimer kan het geluid niet laten haperen. tests/worklets.test.js bewaakt de klank.
/* global sampleRate, registerProcessor, AudioWorkletProcessor */

const SR = sampleRate;
const dbToGain = (d) => 10 ** (d / 20);
const toDb = (g) => (g <= 1e-9 ? -180 : 20 * Math.log10(g));
const coefFor = (seconds) => (seconds <= 0 ? 0 : Math.exp(-1 / (seconds * SR)));
const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * Math.min(hz, SR * 0.45)) / SR);

// Vertraging met een buffer van een macht van twee; tap(n) = de waarde van n samples geleden.
class Line {
  constructor(n) { let s = 1; while (s < n + 4) s <<= 1; this.b = new Float32Array(s); this.m = s - 1; this.w = 0; }
  write(v) { this.b[this.w] = v; this.w = (this.w + 1) & this.m; }
  tap(n) { return this.b[(this.w - 1 - n) & this.m]; }
  tapF(n) { const i = Math.floor(n), f = n - i; return this.tap(i) * (1 - f) + this.tap(i + 1) * f; }
}

// Filtertoestand onder -600 dB op nul zetten: met zulke (denormale) getallen rekenen processoren honderden keren trager.
function tiny(z) { for (let i = 0; i < z.length; i++) if (z[i] < 1e-30 && z[i] > -1e-30) z[i] = 0; }

// Biquad (RBJ-kookboek), per kanaal een eigen toestand.
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z = [new Float64Array(2), new Float64Array(2)]; }
  set(type, f, q = 0.707, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; } // peaking
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x, c) {
    const z = this.z[c];
    const y = this.b0 * x + z[0];
    z[0] = this.b1 * x - this.a1 * y + z[1];
    z[1] = this.b2 * x - this.a2 * y;
    return y;
  }
  flush() { tiny(this.z[0]); tiny(this.z[1]); }
}

// Basis: parameters als k-rate AudioParams, stoppen via de port, meldingen (bijv. gain reduction) terug,
// en rusten zodra er niets meer te horen is.
class Base extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.blocks = 0;
    this.report = 0;
    this.reportEvery = Math.ceil(SR / 128 / 30);
    this.still = 0; // samples stilte aan de ingang
    this.quiet = 0; // samples stilte aan de uitgang (onder -160 dB)
    this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
  }
  // Stuurt ongeveer 30 keer per seconde de grootste gain reduction (dB) van die periode.
  reduce(db) {
    if (db > this.report) this.report = db;
    if (++this.blocks >= this.reportEvery) { this.port.postMessage(this.report); this.report = 0; this.blocks = 0; }
  }
  // Mag dit blok worden overgeslagen? Pas als de ingang minstens `hold` samples echt nul is
  // en de uitgang (de staart) al een seconde onder -160 dB zit.
  resting(L, R, n, hold) {
    if (L) for (let i = 0; i < n; i++) if (L[i] !== 0 || R[i] !== 0) { this.still = 0; this.quiet = 0; return false; }
    this.still += n;
    return this.still >= hold && this.quiet >= SR;
  }
  // Na het rekenen: hoe lang is de uitgang al stil? (alleen nodig als de ingang stil is)
  listen(oL, oR, n) {
    if (!this.still) return;
    for (let i = 0; i < n; i++) if (oL[i] > 1e-8 || oL[i] < -1e-8 || oR[i] > 1e-8 || oR[i] < -1e-8) { this.quiet = 0; return; }
    this.quiet += n;
  }
}

const P = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });

// ---------- Freeverb (Jezar at Dreampoint, publiek domein) ----------

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

class Freeverb extends Base {
  static get parameterDescriptors() { return [P('room', 0.78, 0, 1), P('damp', 0.45, 0, 1), P('width', 1, 0, 1), P('predelay', 0.01, 0, 0.25), P('mix', 0.3, 0, 1)]; }
  constructor() {
    super();
    const s = SR / 44100;
    const mk = (n) => ({ b: new Float32Array(Math.max(1, Math.round(n * s))), i: 0, f: 0 });
    this.combs = [COMBS.map(mk), COMBS.map((n) => mk(n + SPREAD))];
    this.aps = [ALLPASSES.map(mk), ALLPASSES.map((n) => mk(n + SPREAD))];
    this.pre = new Line(Math.ceil(SR * 0.26));
    this.x = new Float64Array(128);
    this.sum = [new Float64Array(128), new Float64Array(128)];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    if (this.resting(L, R, n, SR * 3)) return this.alive;
    if (this.x.length < n) { this.x = new Float64Array(n); this.sum = [new Float64Array(n), new Float64Array(n)]; }
    const feedback = params.room[0] * 0.28 + 0.7;
    const damp1 = params.damp[0] * 0.4, damp2 = 1 - damp1;
    const m = params.mix[0];
    const wet = Math.sin((m * Math.PI) / 2) * 1.1, dry = Math.cos((m * Math.PI) / 2);
    const w = params.width[0];
    const wet1 = wet * (w / 2 + 0.5), wet2 = wet * ((1 - w) / 2);
    const pd = params.predelay[0] * SR;
    const { pre, x } = this;
    for (let i = 0; i < n; i++) {
      pre.write(((L ? L[i] : 0) + (R ? R[i] : 0)) * 0.015 + 1e-20);
      x[i] = pd > 0.5 ? pre.tapF(pd) : pre.tap(0);
    }
    // Kamfilters en allpassfilters per blok in plaats van per sample: zelfde uitkomst, veel minder heen en weer springen.
    for (let c = 0; c < 2; c++) {
      const s = this.sum[c];
      s.fill(0);
      const combs = this.combs[c];
      for (let k = 0; k < combs.length; k++) {
        const cb = combs[k], b = cb.b, len = b.length;
        let p = cb.i, f = cb.f;
        for (let i = 0; i < n; i++) {
          const y = b[p];
          f = y * damp2 + f * damp1;
          b[p] = x[i] + f * feedback;
          if (++p >= len) p = 0;
          s[i] += y;
        }
        cb.i = p; cb.f = f;
      }
      const aps = this.aps[c];
      for (let k = 0; k < aps.length; k++) {
        const ap = aps[k], b = ap.b, len = b.length;
        let p = ap.i;
        for (let i = 0; i < n; i++) {
          const v = s[i], bo = b[p];
          b[p] = v + bo * 0.5;
          if (++p >= len) p = 0;
          s[i] = bo - v;
        }
        ap.i = p;
      }
    }
    const a = this.sum[0], b = this.sum[1];
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      oL[i] = a[i] * wet1 + b[i] * wet2 + xl * dry;
      oR[i] = b[i] * wet1 + a[i] * wet2 + xr * dry;
    }
    this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-freeverb', Freeverb);

// ---------- Plaatgalm naar Dattorro (1997) ----------
// Lengtes uit het artikel, bij 29761 Hz; hier omgerekend naar de eigen samplefrequentie.

const DS = SR / 29761;
const d = (n) => Math.round(n * DS);
// Aftakpunten voor links en rechts (artikel, tabel 2).
const TL = [266, 2974, 1913, 1996, 1990, 187, 1066].map(d), TR = [353, 3627, 1228, 2673, 2111, 335, 121].map(d);

class Plate extends Base {
  static get parameterDescriptors() { return [P('decay', 0.65, 0, 0.99), P('predelay', 0.01, 0, 0.3), P('tone', 11000, 200, 20000), P('damping', 7000, 200, 20000), P('mod', 0.5, 0, 1), P('mix', 0.3, 0, 1)]; }
  constructor() {
    super();
    this.pre = new Line(Math.ceil(SR * 0.31));
    this.inLen = [142, 107, 379, 277].map(d);
    this.inAp = this.inLen.map((n) => new Line(n));
    this.exc = 16 * DS;
    this.len = { lAp1: d(672), lD1: d(4453), lAp2: d(1800), lD2: d(3720), rAp1: d(908), rD1: d(4217), rAp2: d(2656), rD2: d(3163) };
    this.l = {};
    for (const [k, n] of Object.entries(this.len)) this.l[k] = new Line(n + Math.ceil(this.exc) + 2);
    this.bw = 0; this.dl = 0; this.dr = 0; this.phase = 0;
  }
  static ap(line, x, g, len) { const z = line.tap(len - 1); const w = x + g * z; line.write(w); return z - g * w; }
  static apMod(line, x, g, len) { const z = line.tapF(len - 1); const w = x + g * z; line.write(w); return z - g * w; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    const dph = (2 * Math.PI * 0.9) / SR;
    if (this.resting(L, R, n, SR * 3)) {
      for (let i = 0; i < n; i++) { this.phase += dph; if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI; }
      return this.alive;
    }
    const decay = params.decay[0];
    const dd2 = Math.min(0.5, Math.max(0.25, decay + 0.15));
    const bwA = onePole(params.tone[0]), dA = onePole(params.damping[0]);
    const m = params.mix[0];
    const wet = Math.sin((m * Math.PI) / 2), dry = Math.cos((m * Math.PI) / 2);
    const pd = params.predelay[0] * SR;
    const exc = this.exc * params.mod[0];
    const { lAp1, lD1, lAp2, lD2, rAp1, rD1, rAp2, rD2 } = this.l;
    const nLAp1 = this.len.lAp1, nLD1 = this.len.lD1 - 1, nLAp2 = this.len.lAp2, nLD2 = this.len.lD2 - 1;
    const nRAp1 = this.len.rAp1, nRD1 = this.len.rD1 - 1, nRAp2 = this.len.rAp2, nRD2 = this.len.rD2 - 1;
    const [ap0, ap1, ap2, ap3] = this.inAp, [n0, n1, n2, n3] = this.inLen;
    const [l0, l1, l2, l3, l4, l5, l6] = TL, [r0, r1, r2, r3, r4, r5, r6] = TR;
    const { pre } = this;
    let { bw, dl, dr, phase } = this;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      pre.write((xl + xr) * 0.5 + 1e-20);
      const x = pd > 0.5 ? pre.tapF(pd) : pre.tap(0);
      bw += bwA * (x - bw);
      let s = Plate.ap(ap0, bw, 0.75, n0);
      s = Plate.ap(ap1, s, 0.75, n1);
      s = Plate.ap(ap2, s, 0.625, n2);
      s = Plate.ap(ap3, s, 0.625, n3);
      const fromR = rD2.tap(nRD2), fromL = lD2.tap(nLD2);
      phase += dph;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
      const ml = exc * (1 + Math.sin(phase)) * 0.5, mr = exc * (1 + Math.cos(phase)) * 0.5;
      // Linkerhelft van de tank
      let a = Plate.apMod(lAp1, s + decay * fromR, -0.7, nLAp1 + ml);
      const aOut = lD1.tap(nLD1); lD1.write(a); a = aOut;
      dl += dA * (a - dl);
      lD2.write(Plate.ap(lAp2, dl * decay, dd2, nLAp2));
      // Rechterhelft
      let b = Plate.apMod(rAp1, s + decay * fromL, -0.7, nRAp1 + mr);
      const bOut = rD1.tap(nRD1); rD1.write(b); b = bOut;
      dr += dA * (b - dr);
      rD2.write(Plate.ap(rAp2, dr * decay, dd2, nRAp2));
      const yl = rD1.tap(l0) + rD1.tap(l1) - rAp2.tap(l2) + rD2.tap(l3) - lD1.tap(l4) - lAp2.tap(l5) - lD2.tap(l6);
      const yr = lD1.tap(r0) + lD1.tap(r1) - lAp2.tap(r2) + lD2.tap(r3) - rD1.tap(r4) - rAp2.tap(r5) - rD2.tap(r6);
      oL[i] = xl * dry + yl * 0.6 * wet;
      oR[i] = xr * dry + yr * 0.6 * wet;
    }
    this.bw = bw; this.dl = dl; this.dr = dr; this.phase = phase;
    this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-plate', Plate);

// ---------- Gate ----------

class Gate extends Base {
  static get parameterDescriptors() { return [P('threshold', -40, -100, 0), P('range', 60, 0, 100), P('attack', 0.001, 0.00005, 0.2), P('hold', 0.04, 0, 2), P('release', 0.12, 0.005, 3)]; }
  constructor() { super(); this.env = 0; this.g = 1; this.held = 0; this.envRel = coefFor(0.03); }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    if (this.resting(L, R, n, SR * Math.max(0.5, params.hold[0] + 20 * params.release[0]))) { this.reduce(params.range[0]); return this.alive; }
    const thr = dbToGain(params.threshold[0]);
    const floor = dbToGain(-params.range[0]);
    const att = coefFor(params.attack[0]), rel = coefFor(params.release[0]);
    const { envRel } = this;
    const holdN = params.hold[0] * SR;
    let { env, g, held } = this;
    let minG = 1;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const a = Math.max(Math.abs(xl), Math.abs(xr));
      env = a > env ? a : env * envRel;
      if (env >= thr) held = holdN;
      else if (held > 0) held--;
      const target = env >= thr || held > 0 ? 1 : floor;
      g = target > g ? target + (g - target) * att : target + (g - target) * rel;
      if (g < minG) minG = g;
      oL[i] = xl * g;
      oR[i] = xr * g;
    }
    this.env = env < 1e-30 ? 0 : env; this.g = g; this.held = held;
    this.reduce(-toDb(minG));
    this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-gate', Gate);

// ---------- Transiëntvormer ----------
// Twee envelopes: een snelle en een trage. Waar de snelle boven de trage uitkomt is het een aanslag, daarna is het staart.

const LN_DB = Math.LN10 / 20;

class Transient extends Base {
  static get parameterDescriptors() { return [P('attack', 0, -1, 1), P('sustain', 0, -1, 1), P('output', 0, -24, 24)]; }
  constructor() {
    super();
    this.fast = 0; this.slow = 0; this.g = 1;
    this.fa = coefFor(0.0008); this.fr = coefFor(0.03);
    this.sa = coefFor(0.02); this.sr = coefFor(0.18);
    this.smooth = coefFor(0.0015);
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    // Ruim de tijd: pas rusten als beide envelopes helemaal zijn uitgezakt, anders klinkt de eerste aanslag erna anders.
    if (this.resting(L, R, n, SR * 9)) { this.reduce(0); return this.alive; }
    const at = params.attack[0] * 1.6, su = params.sustain[0] * -1.6, outGain = dbToGain(params.output[0]);
    const { fa, fr, sa, sr, smooth } = this;
    const lo = -24 * LN_DB, hi = 18 * LN_DB;
    let { fast, slow, g } = this;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const a = Math.max(Math.abs(xl), Math.abs(xr)) + 1e-9;
      fast = a > fast ? a + (fast - a) * fa : a + (fast - a) * fr;
      slow = a > slow ? a + (slow - a) * sa : a + (slow - a) * sr;
      // Rekenen met de natuurlijke logaritme in plaats van dB heen en terug: zelfde uitkomst, helft van de machten.
      const k = fast > slow ? at : su;
      let target = 1;
      if (k !== 0) {
        let e = Math.log(fast / slow) * k;
        if (e < lo) e = lo; else if (e > hi) e = hi;
        target = Math.exp(e);
        if (e < 0 ? -e > max : e > max) max = e < 0 ? -e : e;
      }
      g = target + (g - target) * smooth;
      oL[i] = xl * g * outGain;
      oR[i] = xr * g * outGain;
    }
    this.fast = fast; this.slow = slow; this.g = g;
    this.reduce(max / LN_DB);
    this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-transient', Transient);

// ---------- De-esser ----------
// Splitst met een hoogdoorlaat: hoog = HP(x), rest = x - hoog (samen weer precies x); alleen het hoog wordt gedempt.

class Deesser extends Base {
  static get parameterDescriptors() { return [P('freq', 6500, 1000, 16000), P('threshold', -26, -80, 0), P('range', 8, 0, 30)]; }
  constructor() { super(); this.hp = new Biquad(); this.lastF = 0; this.env = 0; this.g = 1; this.att = coefFor(0.001); this.rel = coefFor(0.06); }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    if (this.resting(L, R, n, SR * 2)) { this.reduce(0); return this.alive; }
    const f = params.freq[0];
    if (f !== this.lastF) { this.hp.set('highpass', f, 0.707); this.lastF = f; }
    const thr = params.threshold[0], range = params.range[0], thrGain = dbToGain(thr);
    const { hp, att, rel } = this;
    let { env, g } = this;
    let maxGr = 0;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const hl = hp.run(xl, 0), hr = hp.run(xr, 1);
      const a = Math.max(Math.abs(hl), Math.abs(hr));
      env = a > env ? a + (env - a) * att : a + (env - a) * rel;
      let target = 1;
      if (env > thrGain) { // onder de drempel is er niets te demperen en hoeft er geen dB te worden uitgerekend
        const gr = Math.min(range, (toDb(env) - thr) * 0.75);
        target = dbToGain(-gr);
        if (gr > maxGr) maxGr = gr;
      }
      g = target + (g - target) * 0.995;
      oL[i] = xl - hl + hl * g;
      oR[i] = xr - hr + hr * g;
    }
    this.env = env < 1e-30 ? 0 : env; this.g = g;
    hp.flush();
    this.reduce(maxGr);
    this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-deesser', Deesser);

// ---------- Tape ----------
// Verzadiging (asymmetrisch, dus ook even harmonischen), kop-bump, hoogverlies en toonhoogtewiebels (wow en flutter)
// via een gemoduleerde vertraging. Het droge signaal loopt door dezelfde basisvertraging, zodat mengen niet kamfiltert.

const BIAS = Math.tanh(0.08);

class Tape extends Base {
  static get parameterDescriptors() { return [P('drive', 6, 0, 36), P('bump', 2, 0, 12), P('tone', 14000, 1000, 20000), P('wow', 0.2, 0, 1), P('flutter', 0.2, 0, 1), P('mix', 1, 0, 1)]; }
  constructor() {
    super();
    this.lines = [new Line(Math.ceil(SR * 0.03)), new Line(Math.ceil(SR * 0.03))];
    this.base = SR * 0.008;
    this.bump = new Biquad(); this.lp = new Biquad(); this.hp = new Biquad();
    this.hp.set('highpass', 22, 0.6);
    this.lastBump = NaN; this.lastTone = NaN;
    this.wp = 0; this.fp = 0; this.drift = 0; this.driftT = 0; this.driftTarget = 0;
    this.seed = 12345;
  }
  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 - 0.5; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    const rest = this.resting(L, R, n, SR);
    const bumpDb = params.bump[0], tone = params.tone[0];
    if (bumpDb !== this.lastBump || tone !== this.lastTone) { this.bump.set('peaking', 85, 0.9, bumpDb); this.lp.set('lowpass', tone, 0.6); this.lastBump = bumpDb; this.lastTone = tone; }
    const k = dbToGain(params.drive[0]);
    const norm = 1 / Math.tanh(k * 0.5 + 0.0001) * 0.5;
    const wow = params.wow[0] * SR * 0.0025, flut = params.flutter[0] * SR * 0.00025;
    const m = params.mix[0], im = 1 - m;
    const dw = (2 * Math.PI * 0.6) / SR, df = (2 * Math.PI * 7.3) / SR;
    const { base, bump, lp, hp } = this;
    const l0 = this.lines[0], l1 = this.lines[1];
    let { wp, fp, drift, driftT, driftTarget } = this;
    for (let i = 0; i < n; i++) {
      wp += dw; fp += df;
      if (wp > 6.283) wp -= 6.283;
      if (fp > 6.283) fp -= 6.283;
      if (--driftT <= 0) { driftT = 2048; driftTarget = this.rand(); }
      drift += (driftTarget - drift) * 0.0004;
      if (rest) continue; // de band draait door, maar er staat niets op
      const at = base + (wow * (0.5 + 0.5 * Math.sin(wp)) + flut * (0.5 + 0.5 * Math.sin(fp + drift * 3)) + wow * 0.3 * drift);
      l0.write(L ? L[i] : 0);
      l1.write(R ? R[i] : 0);
      let y = (Math.tanh(k * l0.tapF(at) + 0.08) - BIAS) * norm;
      y = lp.run(bump.run(hp.run(y, 0), 0), 0);
      oL[i] = l0.tapF(base) * im + y * m;
      y = (Math.tanh(k * l1.tapF(at) + 0.08) - BIAS) * norm;
      y = lp.run(bump.run(hp.run(y, 1), 1), 1);
      oR[i] = l1.tapF(base) * im + y * m;
    }
    this.wp = wp; this.fp = fp; this.drift = drift; this.driftT = driftT; this.driftTarget = driftTarget;
    hp.flush(); bump.flush(); lp.flush();
    if (!rest) this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-tape', Tape);

// ---------- Maximizer (limiter met lookahead) ----------
// Benodigde demping per sample → minimum over het lookaheadvenster → traag terugveren → gemiddelde over het venster.
// Omdat het gemiddelde alleen waarden bevat die al laag genoeg zijn, komt de vertraagde piek nooit boven het plafond.

class Maximizer extends Base {
  static get parameterDescriptors() { return [P('gain', 3, 0, 30), P('ceiling', -0.3, -12, 0), P('release', 0.08, 0.002, 2)]; }
  constructor() {
    super();
    this.L = Math.max(8, Math.round(SR * 0.0015));
    this.dl = [new Float32Array(this.L + 1), new Float32Array(this.L + 1)];
    this.box = new Float32Array(this.L).fill(1);
    this.boxSum = this.L;
    this.i = 0; this.bi = 0;
    this.r = 1;
    // Glijdend minimum met een monotone wachtrij: per sample ongeveer één stap in plaats van het hele venster nalopen.
    this.qCap = 128; while (this.qCap < this.L + 2) this.qCap <<= 1;
    this.qv = new Float32Array(this.qCap);
    this.qt = new Float64Array(this.qCap);
    this.qh = 0; this.qn = 0; this.t = 0;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], L = inp[0] || null, R = inp[1] || L, oL = out[0], oR = out[1] || oL, n = oL.length;
    if (this.resting(L, R, n, SR * (0.1 + 20 * params.release[0]))) { this.reduce(0); return this.alive; }
    const pre = dbToGain(params.gain[0]), ceil = dbToGain(params.ceiling[0]);
    const rel = coefFor(params.release[0]);
    const N = this.L + 1, len = this.L, mask = this.qCap - 1;
    const { box, qv, qt } = this, d0 = this.dl[0], d1 = this.dl[1];
    let { boxSum, bi, r, qh, qn, t } = this, idx = this.i;
    let minG = 1;
    for (let s = 0; s < n; s++) {
      const xl = (L ? L[s] : 0) * pre, xr = (R ? R[s] : 0) * pre;
      const peak = Math.max(Math.abs(xl), Math.abs(xr));
      const need = Math.fround(peak > ceil ? ceil / peak : 1);
      d0[idx] = xl; d1[idx] = xr;
      while (qn && qv[(qh + qn - 1) & mask] >= need) qn--;
      const tail = (qh + qn) & mask;
      qv[tail] = need; qt[tail] = t; qn++;
      if (qt[qh] <= t - N) { qh = (qh + 1) & mask; qn--; }
      const hold = qv[qh];
      t++;
      r = hold < r ? hold : hold + (r - hold) * rel;
      boxSum += r - box[bi];
      box[bi] = r;
      if (++bi >= len) bi = 0;
      const g = Math.min(1, boxSum / len);
      const j = idx + 1 >= N ? 0 : idx + 1; // oudste sample = L samples geleden
      let yl = d0[j] * g, yr = d1[j] * g;
      // Vangnet voor afrondingsfouten.
      if (yl > ceil) yl = ceil; else if (yl < -ceil) yl = -ceil;
      if (yr > ceil) yr = ceil; else if (yr < -ceil) yr = -ceil;
      oL[s] = yl; oR[s] = yr;
      if (g < minG) minG = g;
      idx = j;
    }
    this.boxSum = boxSum; this.bi = bi; this.r = r; this.qh = qh; this.qn = qn; this.t = t; this.i = idx;
    this.reduce(-toDb(minG));
    this.listen(oL, oR, n);
    return this.alive;
  }
}
registerProcessor('ps-maximizer', Maximizer);

// ---------- Luidheidsmeter (EBU R128 / ITU-R BS.1770) ----------
// K-weging in twee trappen; stuurt per blok van 100 ms de gemiddelde kwadratensom, de piek en de correlatie.

function kWeighting() {
  let K = Math.tan((Math.PI * 1681.974450955533) / SR);
  const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416, Q1 = 0.7071752369554196;
  let a0 = 1 + K / Q1 + K * K;
  const s1 = { b: [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0] };
  K = Math.tan((Math.PI * 38.13547087602444) / SR);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const s2 = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0] };
  return [s1, s2];
}

class Loudness extends Base {
  constructor() {
    super();
    const [s1, s2] = kWeighting();
    this.b1 = s1.b; this.a1 = s1.a; this.b2 = s2.b; this.a2 = s2.a;
    this.z = [new Float64Array(4), new Float64Array(4)];
    this.block = Math.round(SR * 0.1);
    this.reset();
  }
  reset() { this.cnt = 0; this.sum = 0; this.peak = 0; this.lr = 0; this.ll = 0; this.rr = 0; }
  // Beide trappen voor één sample; geeft de gefilterde waarde terug.
  filt(x, z) {
    const b1 = this.b1, a1 = this.a1, b2 = this.b2, a2 = this.a2;
    const v = b1[0] * x + z[0];
    z[0] = b1[1] * x - a1[0] * v + z[1];
    z[1] = b1[2] * x - a1[1] * v;
    const y = b2[0] * v + z[2];
    z[2] = b2[1] * v - a2[0] * y + z[3];
    z[3] = b2[2] * v - a2[1] * y;
    return y;
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp.length) return this.alive;
    const L = inp[0], R = inp[1] || inp[0], zl = this.z[0], zr = this.z[1];
    for (let i = 0; i < L.length; i++) {
      const l = L[i], r = R[i];
      const fl = this.filt(l, zl), fr = this.filt(r, zr);
      this.sum += fl * fl + fr * fr;
      const a = Math.max(Math.abs(l), Math.abs(r));
      if (a > this.peak) this.peak = a;
      this.lr += l * r; this.ll += l * l; this.rr += r * r;
      if (++this.cnt >= this.block) {
        const den = Math.sqrt(this.ll * this.rr);
        this.port.postMessage({ ms: this.sum / this.cnt, peak: this.peak, corr: den > 1e-12 ? this.lr / den : 1 });
        this.reset();
      }
    }
    tiny(zl); tiny(zr);
    return this.alive;
  }
}
registerProcessor('ps-loudness', Loudness);
