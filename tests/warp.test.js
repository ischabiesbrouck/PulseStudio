import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, createClip, createProject, migrate, demoProject, audioTimeRatio, audioSegments, audioSourceAt, splitClip } from '../js/model.js';
import { integrated, measure, lufs } from '../js/audio/loudness.js';
import { crc32, zipFiles, encodeWav } from '../js/wav.js';
import { PLUGIN_DEFS, PLUGIN_CATS, createWamInsert } from '../js/audio/plugin-defs.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('tijdverhouding volgt het projecttempo en de rek', () => {
  const c = createClip('audio', 0, 8, { warp: true, srcBpm: 100 });
  near(audioTimeRatio(c, 100), 1);
  near(audioTimeRatio(c, 125), 0.8);
  c.stretch = 2;
  near(audioTimeRatio(c, 100), 2);
  near(audioTimeRatio({ ...c, warp: false }, 140), 2, 1e-9);
});

test('segmenten zonder en met loop', () => {
  const spb = 0.5; // 120 BPM
  // Bestand van 2 s op 120 BPM = 4 tellen; clip van 8 tellen.
  const c = createClip('audio', 0, 8, { warp: true, srcBpm: 120 });
  const one = audioSegments(c, 0, spb, 2, 120);
  assert.equal(one.length, 1);
  near(one[0].dur, 2);
  c.loop = true;
  const looped = audioSegments(c, 0, spb, 2, 120);
  assert.equal(looped.length, 2);
  near(looped[1].at, 2);
  near(looped[1].src, 0);
  // Midden in de tweede herhaling instappen.
  const mid = audioSegments(c, 5, spb, 2, 120);
  near(mid[0].src, 0.5);
  near(mid[0].dur, 1.5);
  near(audioSourceAt(c, 6, spb, 2, 120), 1);
});

test('rekken maakt de segmenten langer', () => {
  const c = createClip('audio', 0, 8, { warp: true, srcBpm: 120, stretch: 2 });
  const s = audioSegments(c, 0, 0.5, 2, 120);
  near(s[0].dur, 4);
});

test('audioclip splitsen houdt de bron op zijn plek', () => {
  const c = createClip('audio', 4, 8, { offset: 0.25, warp: true, srcBpm: 120 });
  const [l, r] = splitClip(c, 6, { audio: true, spb: 0.5, srcDur: 10, bpm: 120 });
  assert.equal(l.length, 2);
  assert.equal(r.start, 6);
  assert.equal(r.length, 6);
  near(r.offset, 1.25);
  assert.notEqual(l.id, r.id);
  assert.equal(splitClip(c, 3, { audio: true }), null);
});

test('MIDI-clip splitsen schrijft herhalingen uit', () => {
  const c = createClip('synth', 0, 8, { pattern: 4, notes: [{ t: 0, d: 1, p: 60, v: 1 }, { t: 3, d: 2, p: 62, v: 1 }] });
  const [l, r] = splitClip(c, 5);
  assert.equal(l.notes.length, 3); // 0, 3, 4
  assert.equal(r.notes.length, 1); // 7 → 2
  near(r.notes[0].t, 2);
  near(l.notes.find((n) => n.t === 4).d, 1);
});

test('returns en sends in nieuwe en oude projecten', () => {
  const p = createProject();
  assert.equal(p.returns.length, 2);
  assert.equal(p.returns[0].inserts[0].type, 'plate');
  const old = migrate({ name: 'oud', tracks: [{ kind: 'synth', clips: [] }] });
  assert.equal(old.returns.length, 2);
  assert.deepEqual(old.tracks[0].sends, {});
  const demo = demoProject();
  assert.ok(Object.keys(demo.tracks[3].sends).length === 2);
  const again = migrate(JSON.parse(JSON.stringify(demo)));
  assert.equal(again.returns[0].id, demo.returns[0].id);
});

test('plug-ins (WAM) blijven bewaard bij opslaan en openen', () => {
  const p = createProject();
  const t = createTrack('plugin', 0, 'Synth-101');
  t.plugin = { url: 'https://example.org/synth/index.js', name: 'Synth-101', vendor: 'X', state: { cutoff: 0.4 } };
  t.inserts.push(createWamInsert({ url: 'https://example.org/fx/index.js', name: 'Big Muff', vendor: 'Y' }, { drive: 3 }));
  t.inserts.push({ id: 'kapot', type: 'wam', on: true, params: {} }); // zonder adres: valt weg
  p.tracks.push(t);
  const back = migrate(JSON.parse(JSON.stringify(p)));
  const bt = back.tracks[0];
  assert.equal(bt.kind, 'plugin');
  assert.deepEqual(bt.plugin.state, { cutoff: 0.4 });
  assert.equal(bt.inserts.length, 1);
  assert.equal(bt.inserts[0].wam.name, 'Big Muff');
  assert.deepEqual(bt.inserts[0].wam.state, { drive: 3 });
  assert.equal(migrate({ tracks: [{ kind: 'plugin', clips: [] }] }).tracks[0].plugin, null);
});

test('alle effecten staan in een browsercategorie', () => {
  const listed = PLUGIN_CATS.flatMap(([, types]) => types);
  assert.deepEqual([...listed].sort(), Object.keys(PLUGIN_DEFS).filter((k) => !PLUGIN_DEFS[k].external).sort());
});

test('luidheid: sinus van 1 kHz op -20 dBFS is ongeveer -20 LUFS (per kanaal -23 + 3)', () => {
  const sr = 48000;
  const a = 10 ** (-20 / 20);
  const x = Float32Array.from({ length: sr * 5 }, (_, i) => a * Math.sin((2 * Math.PI * 1000 * i) / sr));
  const m = measure([x, x], sr);
  // Stereo, beide kanalen gelijk: -3.01 (sinus) + 3.01 (twee kanalen) + kleine K-weging bij 1 kHz.
  assert.ok(Math.abs(m.integrated - -20) < 0.6, `${m.integrated}`);
  near(m.peak, a, 1e-4);
  assert.equal(integrated([]), -Infinity);
  assert.equal(lufs(0), -Infinity);
});

test('ZIP: CRC32 en opbouw', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const blob = zipFiles([{ name: 'a.wav', data: encodeWav([new Float32Array([0, 0.5])], 44100, 24) }]);
  assert.ok(blob.size > 30 + 5 + 44 + 46 + 22);
});

test('24-bit WAV', () => {
  const buf = encodeWav([new Float32Array([0, 1, -1])], 48000, 24);
  const v = new DataView(buf);
  assert.equal(v.getUint16(34, true), 24);
  assert.equal(v.getUint32(40, true), 9);
  const s = (o) => { const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); return x & 0x800000 ? x - 0x1000000 : x; };
  assert.equal(s(47), 8388607);
  assert.equal(s(50), -8388607);
});
