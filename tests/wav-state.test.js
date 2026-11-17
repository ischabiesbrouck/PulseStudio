import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, computePeaks } from '../js/wav.js';
import { state, setProject, commit, gesture, undo, redo, canUndo, subscribe } from '../js/state.js';
import { createProject } from '../js/model.js';

test('WAV-kop en samples', () => {
  const left = new Float32Array([0, 1, -1, 0.5]);
  const right = new Float32Array([0, -1, 1, 2]);
  const buf = encodeWav([left, right], 44100);
  const v = new DataView(buf);
  const str = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
  assert.equal(str(0), 'RIFF');
  assert.equal(str(8), 'WAVE');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(40, true), 16);
  assert.equal(buf.byteLength, 44 + 16);
  assert.equal(v.getInt16(44 + 4, true), 32767);
  assert.equal(v.getInt16(44 + 6, true), -32768);
  assert.equal(v.getInt16(44 + 14, true), 32767, 'waarden boven 1 worden begrensd');
});

test('piekwaarden', () => {
  const peaks = computePeaks([new Float32Array([0, 0.5, -0.8, 0.1])], 2);
  assert.deepEqual([...peaks].map((x) => Math.round(x * 10) / 10), [0.5, 0.8]);
});

test('ongedaan maken en opnieuw', () => {
  const scopes = [];
  const off = subscribe((s) => scopes.push(s));
  setProject(createProject('Test'));
  assert.equal(canUndo(), false);
  commit((p) => { p.bpm = 90; });
  commit((p) => { p.name = 'Twee'; });
  assert.equal(state.project.name, 'Twee');
  undo();
  assert.equal(state.project.name, 'Test');
  assert.equal(state.project.bpm, 90);
  undo();
  assert.equal(state.project.bpm, 120);
  redo();
  assert.equal(state.project.bpm, 90);
  off();
  assert.ok(scopes.includes('all'));
});

test('slepen telt als één stap', () => {
  setProject(createProject('Gebaar'));
  const g = gesture();
  for (let i = 1; i <= 10; i++) g.update((p) => { p.bpm = 100 + i; });
  g.end();
  assert.equal(state.project.bpm, 110);
  undo();
  assert.equal(state.project.bpm, 120);
  assert.equal(canUndo(), false);
});
