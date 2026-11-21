import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wsola, vocoder, detectTempo, tempoFromName, fft } from '../js/audio/stretch.js';

const SR = 44100;

// Een klikspoor: korte ruisstoten op elke tel.
function clicks(bpm, beats, sr = SR) {
  const spb = (60 / bpm) * sr;
  const out = new Float32Array(Math.round(spb * beats));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0; b < beats; b++) {
    const at = Math.round(b * spb);
    for (let i = 0; i < 900 && at + i < out.length; i++) out[at + i] = rnd() * Math.exp(-i / 150) * (b % 4 === 0 ? 1 : 0.6);
  }
  return out;
}

function sine(freq, seconds, sr = SR) {
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / sr));
}

// Toonhoogte via nuldoorgangen.
function zeroCrossFreq(x, sr = SR) {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * sr) / x.length;
}

test('FFT en inverse geven het origineel terug', () => {
  const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i / 10), im = new Float64Array(64);
  const orig = re.slice();
  fft(re, im);
  fft(re, im, true);
  for (let i = 0; i < 64; i++) assert.ok(Math.abs(re[i] / 64 - orig[i]) < 1e-9);
});

test('WSOLA en vocoder rekken tot de gevraagde lengte', () => {
  const x = sine(440, 1);
  for (const ratio of [0.5, 0.8, 1.25, 2]) {
    assert.equal(wsola([x], ratio, SR)[0].length, Math.round(x.length * ratio));
    assert.equal(vocoder([x, x], ratio, SR)[1].length, Math.round(x.length * ratio));
  }
});

test('tijdrekken houdt de toonhoogte gelijk', () => {
  const x = sine(440, 1.5);
  const a = wsola([x], 1.5, SR)[0];
  const b = vocoder([x], 0.75, SR)[0];
  const mid = (y) => y.subarray(Math.round(y.length * 0.2), Math.round(y.length * 0.8));
  assert.ok(Math.abs(zeroCrossFreq(mid(a)) - 440) < 8, `wsola ${zeroCrossFreq(mid(a))}`);
  assert.ok(Math.abs(zeroCrossFreq(mid(b)) - 440) < 8, `vocoder ${zeroCrossFreq(mid(b))}`);
  // Niveau blijft ongeveer gelijk.
  const rms = (y) => Math.sqrt(y.reduce((s, v) => s + v * v, 0) / y.length);
  assert.ok(Math.abs(rms(mid(b)) - rms(x)) / rms(x) < 0.2);
});

test('tempo uit de bestandsnaam', () => {
  assert.equal(tempoFromName('Drum Loop 124 BPM.wav'), 124);
  assert.equal(tempoFromName('vocal_bpm_92'), 92);
  assert.equal(tempoFromName('kick_01.wav'), null);
});

test('tempo van een loop en van een klikspoor', () => {
  const loop = clicks(124, 8);
  const r = detectTempo([loop], SR);
  assert.ok(Math.abs(r.bpm - 124) < 0.5, `loop: ${r.bpm}`);
  assert.equal(r.loop, true);
  // Geen heel aantal tellen: dan moet de analyse het tempo vinden.
  const long = clicks(96, 21.5);
  const r2 = detectTempo([long], SR);
  assert.ok(Math.abs(r2.bpm - 96) < 1.5 || Math.abs(r2.bpm - 192) < 3, `analyse: ${r2.bpm}`);
});
