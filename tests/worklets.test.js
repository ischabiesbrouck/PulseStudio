// De AudioWorklet-effecten draaien in node met een nagebootste AudioWorkletGlobalScope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SR = 44100, BLK = 128;
function load() {
  const procs = {};
  class AudioWorkletProcessor { constructor() { this.msgs = []; this.port = { onmessage: null, postMessage: (m) => this.msgs.push(m) }; } }
  const src = fs.readFileSync(new URL('../js/audio/worklets.js', import.meta.url), 'utf8');
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', src)(SR, AudioWorkletProcessor, (n, c) => { procs[n] = c; });
  return procs;
}
const P = load();

// Speelt `input` (stereo, Float32Array) door een processor en geeft de uitgang terug.
function run(name, input, over = {}, noRest = false) {
  const C = P[name], p = new C();
  if (noRest) p.resting = () => false;
  const params = {};
  for (const d of C.parameterDescriptors || []) params[d.name] = new Float32Array([over[d.name] ?? d.defaultValue]);
  const n = input[0].length, L = new Float32Array(n), R = new Float32Array(n);
  let skipped = 0;
  for (let o = 0; o < n; o += BLK) {
    const out = [[new Float32Array(BLK), new Float32Array(BLK)]];
    p.process([[input[0].subarray(o, o + BLK), input[1].subarray(o, o + BLK)]], out, params);
    L.set(out[0][0], o); R.set(out[0][1], o);
    if (p.still >= 1 && p.quiet >= SR) skipped++;
  }
  return { L, R, p, skipped };
}
const burst = (seconds, total) => {
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = Math.ceil((total * SR) / BLK) * BLK;
  return [0, 1].map(() => Float32Array.from({ length: n }, (_, i) => (i < seconds * SR ? rnd() * 0.6 * Math.exp(-((i / SR) * 4 % 1) * 4) : 0)));
};

test('maximizer komt nooit boven het plafond', () => {
  const x = burst(2, 2.5);
  for (const ceiling of [-0.3, -1, -6]) {
    const { L, R } = run('ps-maximizer', x, { gain: 18, ceiling, release: 0.05 });
    const lim = 10 ** (ceiling / 20) + 1e-7;
    for (let i = 0; i < L.length; i++) assert.ok(Math.abs(L[i]) <= lim && Math.abs(R[i]) <= lim, `piek ${L[i]} bij plafond ${ceiling}`);
  }
});

test('galm klinkt uit en gaat daarna rusten (niets meer uitrekenen)', () => {
  for (const name of ['ps-plate', 'ps-freeverb']) {
    const { L, skipped } = run(name, burst(0.5, 12), { mix: 1 });
    let tail = 0;
    for (let i = Math.round(1 * SR); i < Math.round(1.5 * SR); i++) tail = Math.max(tail, Math.abs(L[i]));
    assert.ok(tail > 1e-4, `${name}: er moet een galmstaart zijn`);
    let end = 0;
    for (let i = L.length - SR; i < L.length; i++) end = Math.max(end, Math.abs(L[i]));
    assert.equal(end, 0, `${name}: na het rusten is de uitgang stil`);
    assert.ok(skipped > 100, `${name}: rust in stilte (${skipped} blokken overgeslagen)`);
  }
});

test('rusten verandert niets aan het geluid, ook niet bij de eerste aanslag erna', () => {
  // Stoot, 15 s stilte (genoeg om te gaan rusten), weer een stoot; vergelijken met dezelfde processor die nooit rust.
  const one = burst(0.4, 0.8)[0];
  const n = Math.ceil((16.6 * SR) / BLK) * BLK, gap = Math.ceil((15.8 * SR) / BLK) * BLK;
  const x = [new Float32Array(n), new Float32Array(n)];
  for (const c of x) { c.set(one, 0); c.set(one, gap); }
  const settings = { 'ps-transient': { attack: 0.6, sustain: -0.5 }, 'ps-deesser': { threshold: -40 }, 'ps-gate': { threshold: -30 }, 'ps-tape': { wow: 1, flutter: 1 }, 'ps-maximizer': { gain: 12 }, 'ps-plate': { mix: 1 }, 'ps-freeverb': { mix: 1 } };
  for (const [name, over] of Object.entries(settings)) {
    const a = run(name, x, over), b = run(name, x, over, true);
    let d = 0;
    for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(a.L[i] - b.L[i]), Math.abs(a.R[i] - b.R[i]));
    assert.ok(a.skipped > 50, `${name} moet in de stilte rusten`);
    assert.ok(d < 1e-7, `${name}: verschil ${d} (${(20 * Math.log10(d)).toFixed(0)} dB)`);
  }
});

test('geen denormale getallen in stilte (die maken processors honderden keren trager)', () => {
  const { p } = run('ps-loudness', burst(1, 20));
  for (const z of p.z) for (const v of z) assert.ok(v === 0 || Math.abs(v) > 1e-30, `toestand ${v}`);
});
