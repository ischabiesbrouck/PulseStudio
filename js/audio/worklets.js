// AudioWorklet-processors voor effecten die niet met de standaard Web Audio-nodes te bouwen zijn.
// Dit bestand draait in de AudioWorkletGlobalScope (eigen audiothread); `sampleRate` is daar een globale.
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

// Biquad (RBJ-kookboek), per kanaal een eigen toestand.
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z = [[0, 0], [0, 0]]; }
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
}

// Basis: parameters als k-rate AudioParams, stoppen via de port, en meldingen (bijv. gain reduction) terug.
class Base extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.blocks = 0;
    this.report = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
  }
  // Stuurt ongeveer 30 keer per seconde de grootste gain reduction (dB) van die periode.
  reduce(db) {
    this.report = Math.max(this.report, db);
    if (++this.blocks >= Math.ceil(SR / 128 / 30)) { this.port.postMessage(this.report); this.report = 0; this.blocks = 0; }
  }
}

const P = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
const io = (inputs, outputs) => {
  const inp = inputs[0], out = outputs[0];
  const L = inp[0] || null, R = inp[1] || inp[0] || null;
  return { L, R, oL: out[0], oR: out[1] || out[0], n: out[0].length };
};

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
  }
  process(inputs, outputs, params) {
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const feedback = params.room[0] * 0.28 + 0.7;
    const damp1 = params.damp[0] * 0.4, damp2 = 1 - damp1;
    const m = params.mix[0];
    const wet = Math.sin((m * Math.PI) / 2) * 1.1, dry = Math.cos((m * Math.PI) / 2);
    const w = params.width[0];
    const wet1 = wet * (w / 2 + 0.5), wet2 = wet * ((1 - w) / 2);
    const pd = params.predelay[0] * SR;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      this.pre.write((xl + xr) * 0.015 + 1e-20);
      const x = pd > 0.5 ? this.pre.tapF(pd) : this.pre.tap(0);
      const out = [0, 0];
      for (let c = 0; c < 2; c++) {
        let s = 0;
        for (const cb of this.combs[c]) {
          const y = cb.b[cb.i];
          cb.f = y * damp2 + cb.f * damp1;
          cb.b[cb.i] = x + cb.f * feedback;
          if (++cb.i >= cb.b.length) cb.i = 0;
          s += y;
        }
        for (const ap of this.aps[c]) {
          const bo = ap.b[ap.i];
          const y = bo - s;
          ap.b[ap.i] = s + bo * 0.5;
          if (++ap.i >= ap.b.length) ap.i = 0;
          s = y;
        }
        out[c] = s;
      }
      oL[i] = out[0] * wet1 + out[1] * wet2 + xl * dry;
      oR[i] = out[1] * wet1 + out[0] * wet2 + xr * dry;
    }
    return this.alive;
  }
}
registerProcessor('ps-freeverb', Freeverb);

// ---------- Plaatgalm naar Dattorro (1997) ----------
// Lengtes uit het artikel, bij 29761 Hz; hier omgerekend naar de eigen samplefrequentie.

const DS = SR / 29761;
const d = (n) => Math.round(n * DS);

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
    this.tapsL = [['rD1', 266, 1], ['rD1', 2974, 1], ['rAp2', 1913, -1], ['rD2', 1996, 1], ['lD1', 1990, -1], ['lAp2', 187, -1], ['lD2', 1066, -1]].map(([k, n, s]) => [k, d(n), s]);
    this.tapsR = [['lD1', 353, 1], ['lD1', 3627, 1], ['lAp2', 1228, -1], ['lD2', 2673, 1], ['rD1', 2111, -1], ['rAp2', 335, -1], ['rD2', 121, -1]].map(([k, n, s]) => [k, d(n), s]);
    this.bw = 0; this.dl = 0; this.dr = 0; this.phase = 0;
  }
  static ap(line, x, g, len) { const z = line.tap(len - 1); const w = x + g * z; line.write(w); return z - g * w; }
  static apMod(line, x, g, len) { const z = line.tapF(len - 1); const w = x + g * z; line.write(w); return z - g * w; }
  process(inputs, outputs, params) {
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const decay = params.decay[0];
    const dd2 = Math.min(0.5, Math.max(0.25, decay + 0.15));
    const bwA = onePole(params.tone[0]), dA = onePole(params.damping[0]);
    const m = params.mix[0];
    const wet = Math.sin((m * Math.PI) / 2), dry = Math.cos((m * Math.PI) / 2);
    const pd = params.predelay[0] * SR;
    const exc = this.exc * params.mod[0];
    const dph = (2 * Math.PI * 0.9) / SR;
    const { l, len } = this;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      this.pre.write((xl + xr) * 0.5 + 1e-20);
      const x = pd > 0.5 ? this.pre.tapF(pd) : this.pre.tap(0);
      this.bw += bwA * (x - this.bw);
      let s = this.bw;
      s = Plate.ap(this.inAp[0], s, 0.75, this.inLen[0]);
      s = Plate.ap(this.inAp[1], s, 0.75, this.inLen[1]);
      s = Plate.ap(this.inAp[2], s, 0.625, this.inLen[2]);
      s = Plate.ap(this.inAp[3], s, 0.625, this.inLen[3]);
      const fromR = l.rD2.tap(len.rD2 - 1), fromL = l.lD2.tap(len.lD2 - 1);
      this.phase += dph;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      const ml = exc * (1 + Math.sin(this.phase)) * 0.5, mr = exc * (1 + Math.cos(this.phase)) * 0.5;
      // Linkerhelft van de tank
      let a = Plate.apMod(l.lAp1, s + decay * fromR, -0.7, len.lAp1 + ml);
      const aOut = l.lD1.tap(len.lD1 - 1); l.lD1.write(a); a = aOut;
      this.dl += dA * (a - this.dl);
      a = Plate.ap(l.lAp2, this.dl * decay, dd2, len.lAp2);
      l.lD2.write(a);
      // Rechterhelft
      let b = Plate.apMod(l.rAp1, s + decay * fromL, -0.7, len.rAp1 + mr);
      const bOut = l.rD1.tap(len.rD1 - 1); l.rD1.write(b); b = bOut;
      this.dr += dA * (b - this.dr);
      b = Plate.ap(l.rAp2, this.dr * decay, dd2, len.rAp2);
      l.rD2.write(b);
      let yl = 0, yr = 0;
      for (const [k, t, sg] of this.tapsL) yl += sg * l[k].tap(t);
      for (const [k, t, sg] of this.tapsR) yr += sg * l[k].tap(t);
      oL[i] = xl * dry + yl * 0.6 * wet;
      oR[i] = xr * dry + yr * 0.6 * wet;
    }
    return this.alive;
  }
}
registerProcessor('ps-plate', Plate);

// ---------- Gate ----------

class Gate extends Base {
  static get parameterDescriptors() { return [P('threshold', -40, -100, 0), P('range', 60, 0, 100), P('attack', 0.001, 0.00005, 0.2), P('hold', 0.04, 0, 2), P('release', 0.12, 0.005, 3)]; }
  constructor() { super(); this.env = 0; this.g = 1; this.held = 0; }
  process(inputs, outputs, params) {
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const thr = dbToGain(params.threshold[0]);
    const floor = dbToGain(-params.range[0]);
    const att = coefFor(params.attack[0]), rel = coefFor(params.release[0]);
    const envRel = coefFor(0.03);
    const holdN = params.hold[0] * SR;
    let minG = 1;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const a = Math.max(Math.abs(xl), Math.abs(xr));
      this.env = a > this.env ? a : this.env * envRel;
      if (this.env >= thr) this.held = holdN;
      else if (this.held > 0) this.held--;
      const target = this.env >= thr || this.held > 0 ? 1 : floor;
      this.g = target > this.g ? target + (this.g - target) * att : target + (this.g - target) * rel;
      if (this.g < minG) minG = this.g;
      oL[i] = xl * this.g;
      oR[i] = xr * this.g;
    }
    this.reduce(-toDb(minG));
    return this.alive;
  }
}
registerProcessor('ps-gate', Gate);

// ---------- Transiëntvormer ----------
// Twee envelopes: een snelle en een trage. Waar de snelle boven de trage uitkomt is het een aanslag, daarna is het staart.

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
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const at = params.attack[0], su = params.sustain[0], out = dbToGain(params.output[0]);
    let maxDb = 0;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const a = Math.max(Math.abs(xl), Math.abs(xr)) + 1e-9;
      this.fast = a > this.fast ? a + (this.fast - a) * this.fa : a + (this.fast - a) * this.fr;
      this.slow = a > this.slow ? a + (this.slow - a) * this.sa : a + (this.slow - a) * this.sr;
      const diff = toDb(this.fast / this.slow);
      let gDb = diff > 0 ? at * diff * 1.6 : su * -diff * 1.6;
      gDb = Math.max(-24, Math.min(18, gDb));
      const target = dbToGain(gDb);
      this.g = target + (this.g - target) * this.smooth;
      if (Math.abs(gDb) > Math.abs(maxDb)) maxDb = gDb;
      oL[i] = xl * this.g * out;
      oR[i] = xr * this.g * out;
    }
    this.reduce(Math.abs(maxDb));
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
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const f = params.freq[0];
    if (f !== this.lastF) { this.hp.set('highpass', f, 0.707); this.lastF = f; }
    const thr = params.threshold[0], range = params.range[0];
    let maxGr = 0;
    for (let i = 0; i < n; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const hl = this.hp.run(xl, 0), hr = this.hp.run(xr, 1);
      const a = Math.max(Math.abs(hl), Math.abs(hr));
      this.env = a > this.env ? a + (this.env - a) * this.att : a + (this.env - a) * this.rel;
      const over = toDb(this.env) - thr;
      const gr = over > 0 ? Math.min(range, over * 0.75) : 0;
      const target = dbToGain(-gr);
      this.g = target + (this.g - target) * 0.995;
      if (gr > maxGr) maxGr = gr;
      oL[i] = xl - hl + hl * this.g;
      oR[i] = xr - hr + hr * this.g;
    }
    this.reduce(maxGr);
    return this.alive;
  }
}
registerProcessor('ps-deesser', Deesser);

// ---------- Tape ----------
// Verzadiging (asymmetrisch, dus ook even harmonischen), kop-bump, hoogverlies en toonhoogtewiebels (wow en flutter)
// via een gemoduleerde vertraging. Het droge signaal loopt door dezelfde basisvertraging, zodat mengen niet kamfiltert.

class Tape extends Base {
  static get parameterDescriptors() { return [P('drive', 6, 0, 36), P('bump', 2, 0, 12), P('tone', 14000, 1000, 20000), P('wow', 0.2, 0, 1), P('flutter', 0.2, 0, 1), P('mix', 1, 0, 1)]; }
  constructor() {
    super();
    this.lines = [new Line(Math.ceil(SR * 0.03)), new Line(Math.ceil(SR * 0.03))];
    this.base = SR * 0.008;
    this.bump = new Biquad(); this.lp = new Biquad(); this.hp = new Biquad();
    this.hp.set('highpass', 22, 0.6);
    this.last = '';
    this.wp = 0; this.fp = 0; this.drift = 0; this.driftT = 0;
    this.seed = 12345;
  }
  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 - 0.5; }
  process(inputs, outputs, params) {
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const key = `${params.bump[0]}:${params.tone[0]}`;
    if (key !== this.last) { this.bump.set('peaking', 85, 0.9, params.bump[0]); this.lp.set('lowpass', params.tone[0], 0.6); this.last = key; }
    const k = dbToGain(params.drive[0]);
    const norm = 1 / Math.tanh(k * 0.5 + 0.0001) * 0.5;
    const wow = params.wow[0] * SR * 0.0025, flut = params.flutter[0] * SR * 0.00025;
    const m = params.mix[0];
    const dw = (2 * Math.PI * 0.6) / SR, df = (2 * Math.PI * 7.3) / SR;
    for (let i = 0; i < n; i++) {
      this.wp += dw; this.fp += df;
      if (this.wp > 6.283) this.wp -= 6.283;
      if (this.fp > 6.283) this.fp -= 6.283;
      if (--this.driftT <= 0) { this.driftT = 2048; this.driftTarget = this.rand(); }
      this.drift += ((this.driftTarget || 0) - this.drift) * 0.0004;
      const mod = wow * (0.5 + 0.5 * Math.sin(this.wp)) + flut * (0.5 + 0.5 * Math.sin(this.fp + this.drift * 3)) + wow * 0.3 * this.drift;
      const xs = [L ? L[i] : 0, R ? R[i] : 0];
      for (let c = 0; c < 2; c++) {
        const line = this.lines[c];
        line.write(xs[c]);
        const wetIn = line.tapF(this.base + mod);
        const dryIn = line.tapF(this.base);
        let y = Math.tanh(k * wetIn + 0.08) - Math.tanh(0.08);
        y *= norm;
        y = this.lp.run(this.bump.run(this.hp.run(y, c), c), c);
        const o = dryIn * (1 - m) + y * m;
        if (c === 0) oL[i] = o; else oR[i] = o;
      }
    }
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
    this.need = new Float32Array(this.L + 1).fill(1);
    this.box = new Float32Array(this.L).fill(1);
    this.boxSum = this.L;
    this.i = 0; this.bi = 0;
    this.r = 1;
  }
  process(inputs, outputs, params) {
    const { L, R, oL, oR, n } = io(inputs, outputs);
    const pre = dbToGain(params.gain[0]), ceil = dbToGain(params.ceiling[0]);
    const rel = coefFor(params.release[0]);
    const N = this.L + 1;
    let minG = 1;
    for (let s = 0; s < n; s++) {
      const xl = (L ? L[s] : 0) * pre, xr = (R ? R[s] : 0) * pre;
      const peak = Math.max(Math.abs(xl), Math.abs(xr));
      this.need[this.i] = peak > ceil ? ceil / peak : 1;
      this.dl[0][this.i] = xl; this.dl[1][this.i] = xr;
      let hold = 1;
      for (let k = 0; k < N; k++) if (this.need[k] < hold) hold = this.need[k];
      this.r = hold < this.r ? hold : hold + (this.r - hold) * rel;
      this.boxSum += this.r - this.box[this.bi];
      this.box[this.bi] = this.r;
      this.bi = (this.bi + 1) % this.L;
      const g = Math.min(1, this.boxSum / this.L);
      const j = (this.i + 1) % N; // oudste sample = L samples geleden
      let yl = this.dl[0][j] * g, yr = this.dl[1][j] * g;
      // Vangnet voor afrondingsfouten.
      if (yl > ceil) yl = ceil; else if (yl < -ceil) yl = -ceil;
      if (yr > ceil) yr = ceil; else if (yr < -ceil) yr = -ceil;
      oL[s] = yl; oR[s] = yr;
      if (g < minG) minG = g;
      this.i = j;
    }
    this.reduce(-toDb(minG));
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
    this.st = kWeighting();
    this.z = [0, 1].map(() => this.st.map(() => [0, 0]));
    this.block = Math.round(SR * 0.1);
    this.reset();
  }
  reset() { this.cnt = 0; this.sum = 0; this.peak = 0; this.lr = 0; this.ll = 0; this.rr = 0; }
  filt(x, c) {
    let v = x;
    this.st.forEach((s, k) => {
      const z = this.z[c][k];
      const y = s.b[0] * v + z[0];
      z[0] = s.b[1] * v - s.a[0] * y + z[1];
      z[1] = s.b[2] * v - s.a[1] * y;
      v = y;
    });
    return v;
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp.length) return this.alive;
    const L = inp[0], R = inp[1] || inp[0];
    for (let i = 0; i < L.length; i++) {
      const fl = this.filt(L[i], 0), fr = this.filt(R[i], 1);
      this.sum += fl * fl + fr * fr;
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (a > this.peak) this.peak = a;
      this.lr += L[i] * R[i]; this.ll += L[i] * L[i]; this.rr += R[i] * R[i];
      if (++this.cnt >= this.block) {
        const den = Math.sqrt(this.ll * this.rr);
        this.port.postMessage({ ms: this.sum / this.cnt, peak: this.peak, corr: den > 1e-12 ? this.lr / den : 1 });
        this.reset();
      }
    }
    return this.alive;
  }
}
registerProcessor('ps-loudness', Loudness);
