import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, trimSilence } from '../js/audio/pitch.js';

const SR = 44100;
const tone = (freq, secs, harmonics = [1], sr = SR) => Float32Array.from({ length: Math.round(secs * sr) }, (_, i) => {
  const env = Math.min(1, i / (sr * 0.01)) * Math.exp(-i / (sr * 1.5));
  return harmonics.reduce((s, a, h) => s + a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / sr), 0) * 0.4 * env;
});

test('grondtoon van een sinus en van een rijke klank (zoals een Rhodes)', () => {
  assert.equal(detectPitch([tone(261.63, 1.5)], SR).note, 60);
  // Zaagtandachtig met veel boventonen: geen octaaffout.
  const rich = detectPitch([tone(110, 1.5, [1, 0.5, 0.33, 0.25, 0.2, 0.17])], SR);
  assert.equal(rich.note, 45);
  // Iets te hoog gestemd: centen worden gemeld.
  const sharp = detectPitch([tone(440 * 2 ** (0.3 / 12), 1.2)], SR);
  assert.equal(sharp.note, 69);
  assert.ok(Math.abs(sharp.cents - 30) <= 3, `${sharp.cents}`);
  // Stereo en 48 kHz.
  const t48 = tone(196, 1, [1, 0.3], 48000);
  assert.equal(detectPitch([t48, t48], 48000).note, 55);
});

test('ruis en stilte geven geen toonhoogte', () => {
  let seed = 3;
  const noise = Float32Array.from({ length: SR }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
  assert.equal(detectPitch([noise], SR), null);
  assert.equal(detectPitch([new Float32Array(SR)], SR), null);
});

test('stilte bijsnijden', () => {
  const x = new Float32Array(1000);
  x.fill(0.2, 300, 600);
  assert.deepEqual(trimSilence([x]), [300, 600]);
  assert.deepEqual(trimSilence([x], 0.0005, 10, 20), [290, 620]);
});
