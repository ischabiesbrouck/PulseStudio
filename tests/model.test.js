import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, createTrack, createClip, eventsInRange, audioStartsInRange, nextSegment, formatPosition,
  isAudible, projectEnd, clipFromRecording, quantizeNotes, duplicateClip, migrate, demoProject, noteName, midiToFreq,
} from '../js/model.js';

function projectWithClip(notes, { start = 0, length = 4, pattern } = {}) {
  const p = createProject();
  const t = createTrack('synth', 0);
  const c = createClip('synth', start, length, { notes, pattern: pattern ?? length });
  t.clips.push(c);
  p.tracks.push(t);
  return { p, t, c };
}

test('noten in een tijdvenster vinden', () => {
  const { p } = projectWithClip([{ t: 0, d: 1, p: 60, v: 1 }, { t: 2, d: 1, p: 62, v: 1 }], { start: 4 });
  assert.deepEqual(eventsInRange(p, 0, 4), []);
  assert.deepEqual(eventsInRange(p, 4, 6).map((e) => e.beat), [4]);
  assert.deepEqual(eventsInRange(p, 5, 8).map((e) => e.beat), [6]);
});

test('een patroon herhaalt zich tot het einde van de clip', () => {
  const { p } = projectWithClip([{ t: 0, d: 0.5, p: 36, v: 1 }, { t: 1.5, d: 0.5, p: 38, v: 1 }], { length: 8, pattern: 2 });
  const beats = eventsInRange(p, 0, 8).map((e) => e.beat);
  assert.deepEqual(beats, [0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5]);
  assert.deepEqual(eventsInRange(p, 3, 5).map((e) => e.beat), [3.5, 4]);
});

test('noten worden afgekapt aan het einde van de clip', () => {
  const { p } = projectWithClip([{ t: 3, d: 4, p: 60, v: 1 }], { length: 4 });
  assert.equal(eventsInRange(p, 0, 4)[0].dur, 1);
});

test('mute en solo', () => {
  const { p, t } = projectWithClip([{ t: 0, d: 1, p: 60, v: 1 }]);
  const other = createTrack('synth', 1);
  p.tracks.push(other);
  assert.equal(isAudible(t, p.tracks), true);
  other.solo = true;
  assert.equal(isAudible(t, p.tracks), false);
  assert.equal(eventsInRange(p, 0, 4).length, 0);
  other.solo = false;
  t.mute = true;
  assert.equal(eventsInRange(p, 0, 4).length, 0);
});

test('loop springt terug naar het begin', () => {
  const loop = { on: true, start: 4, end: 8 };
  assert.deepEqual(nextSegment(7, 0.5, loop), { from: 7, to: 7.5, next: 7.5, wrapped: false });
  assert.deepEqual(nextSegment(7.5, 0.5, loop), { from: 7.5, to: 8, next: 4, wrapped: true });
  assert.deepEqual(nextSegment(7.75, 0.5, loop), { from: 7.75, to: 8, next: 4, wrapped: true });
  assert.equal(nextSegment(9, 0.5, loop).wrapped, false);
  assert.equal(nextSegment(7.5, 0.5, { ...loop, on: false }).wrapped, false);
});

test('audioclips: start in het venster en lopende clips', () => {
  const p = createProject();
  const t = createTrack('audio', 0);
  t.clips.push(createClip('audio', 2, 8, { audioId: 'a1' }));
  p.tracks.push(t);
  assert.equal(audioStartsInRange(p, 0, 2).length, 0);
  assert.equal(audioStartsInRange(p, 2, 3)[0].offsetBeats, 0);
  assert.equal(audioStartsInRange(p, 5, 6).length, 0);
  assert.equal(audioStartsInRange(p, 5, 6, true)[0].offsetBeats, 3);
});

test('positie en nootnamen', () => {
  assert.equal(formatPosition(0), '1.1.1');
  assert.equal(formatPosition(5.75), '2.2.4');
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(69), 'A4');
  assert.equal(Math.round(midiToFreq(69)), 440);
});

test('projecteinde, dupliceren en kwantiseren', () => {
  const { p, c } = projectWithClip([{ t: 0.13, d: 0.4, p: 60, v: 1 }], { start: 4, length: 4 });
  assert.equal(projectEnd(p), 8);
  const copy = duplicateClip(c);
  assert.equal(copy.start, 8);
  assert.notEqual(copy.id, c.id);
  quantizeNotes(c.notes, 0.25);
  assert.deepEqual([c.notes[0].t, c.notes[0].d], [0.25, 0.5]);
});

test('opname wordt een clip op hele maten', () => {
  const clip = clipFromRecording('synth', 5, 9.5, [{ beat: 5.1, d: 0.5, p: 60, v: 0.8 }, { beat: 9, d: 0.4, p: 64, v: 0.7 }], 0.25);
  assert.equal(clip.start, 4);
  assert.equal(clip.length, 8);
  assert.deepEqual(clip.notes.map((n) => n.t), [1, 5]);
});

test('migrate vult ontbrekende velden aan', () => {
  const p = migrate({ id: 'x', name: 'Oud', bpm: 100, tracks: [{ id: 't', kind: 'synth', name: 'S', clips: [{ id: 'c', start: 0, length: 4, notes: [] }] }] });
  assert.deepEqual(p.tracks[0].inserts, []);
  assert.equal(p.tracks[0].synth.preset, 'Lead');
  assert.equal(p.tracks[0].synth.unison, 1);
  assert.equal(p.loop.on, true);
  assert.equal(p.bpm, 100);
  assert.equal(p.masterInserts.length, 2);
});

test('migrate zet de oude vaste effecten om naar inserts', () => {
  const fx = { eq: { low: 0, mid: 0, high: 0 }, comp: { on: false, threshold: -18, ratio: 4 }, delay: { on: true, time: 0.5, feedback: 0.3, mix: 0.2 }, reverb: { on: true, size: 2, mix: 0.3 } };
  const p = migrate({ id: 'x', name: 'Oud', tracks: [{ id: 't', kind: 'drums', name: 'D', fx, drums: { tune: 2, decay: 1, level: 0.8 }, clips: [] }] });
  const t = p.tracks[0];
  assert.equal(t.fx, undefined);
  assert.deepEqual(t.inserts.map((i) => i.type), ['delay', 'reverb']);
  assert.equal(t.inserts[0].params.time, 0.5);
  assert.equal(t.inserts[0].params.pingpong, false);
  assert.equal(t.drums.kit, '808');
  assert.equal(t.drums.tune, 2);
  assert.deepEqual(t.drums.pads, {});
});

test('het voorbeeldproject is geldig', () => {
  const p = demoProject();
  assert.equal(p.tracks.length, 4);
  assert.ok(eventsInRange(p, 0, 32).length > 100);
  for (const t of p.tracks) for (const c of t.clips) for (const n of c.notes) assert.ok(n.t < c.pattern, `${t.name}: noot buiten patroon`);
});
