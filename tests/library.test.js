import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRUM_PATTERNS, MELODIC_PATTERNS, drumNotes, melodicNotes, findPattern, isDrumPattern } from '../js/audio/patterns.js';
import { PLUGIN_DEFS, PLUGIN_PRESETS } from '../js/audio/plugin-defs.js';
import { INSTRUMENTS, SAMPLE_KITS, CREDITS, noteToMidi, pickZone } from '../js/audio/samplelib.js';
import { rng, seamlessLoop, SVF, Saw } from '../js/audio/dsp.js';
import { DRUM_ROWS, SYNTH_PRESETS } from '../js/model.js';

const drumPitches = new Set(DRUM_ROWS.map((r) => r.p));

test('drumpatronen gebruiken bestaande drumgeluiden en blijven binnen de clip', () => {
  for (const p of DRUM_PATTERNS) {
    const { notes, length } = drumNotes(p);
    assert.ok(notes.length > 8, `${p.id}: te weinig noten`);
    assert.ok([4, 8].includes(length), `${p.id}: lengte ${length}`);
    for (const n of notes) {
      assert.ok(drumPitches.has(n.p), `${p.id}: onbekend drumgeluid ${n.p}`);
      assert.ok(n.t >= 0 && n.t < length, `${p.id}: noot buiten clip op ${n.t}`);
      assert.ok(n.v > 0 && n.v <= 1, `${p.id}: velocity ${n.v}`);
    }
    for (const row of Object.values(p.rows)) assert.ok(row.length % 16 === 0, `${p.id}: rij niet in zestienden`);
    assert.ok(SAMPLE_KITS[p.kit] || ['808', '909'].includes(p.kit), `${p.id}: onbekende kit`);
  }
});

test('humaniseren is voorspelbaar: elke keer dezelfde noten', () => {
  const a = drumNotes(DRUM_PATTERNS[3]).notes, b = drumNotes(DRUM_PATTERNS[3]).notes;
  assert.deepEqual(a, b);
  const flat = drumNotes(DRUM_PATTERNS[3], { humanize: false }).notes;
  assert.ok(flat.every((n) => [1, 0.9, 0.62, 0.3].includes(n.v) || n.p === 49));
});

test('melodische patronen hebben een geldig instrument of preset', () => {
  for (const p of MELODIC_PATTERNS) {
    assert.ok(p.instrument ? INSTRUMENTS[p.instrument] : SYNTH_PRESETS[p.preset], `${p.id}: instrument/preset ontbreekt`);
    const { notes, length } = melodicNotes(p);
    assert.ok(length % 4 === 0 && length >= 4);
    for (const n of notes) assert.ok(n.p >= 21 && n.p <= 108 && n.d > 0, `${p.id}: noot ${n.p}`);
  }
  assert.equal(isDrumPattern(findPattern('house')), true);
  assert.equal(isDrumPattern(findPattern('bass-house')), false);
  assert.equal(findPattern('bestaat-niet'), null);
});

test('effectpresets gebruiken alleen bestaande instellingen binnen bereik', () => {
  for (const [type, presets] of Object.entries(PLUGIN_PRESETS)) {
    const defs = PLUGIN_DEFS[type].params;
    for (const [name, params] of Object.entries(presets)) {
      for (const [k, v] of Object.entries(params)) {
        const d = defs[k];
        assert.ok(d, `${type}/${name}: onbekende instelling ${k}`);
        if (d.type === 'select') assert.ok(d.options.some(([o]) => o === v), `${type}/${name}: ${k}=${v}`);
        else if (d.type === 'toggle') assert.equal(typeof v, 'boolean');
        else assert.ok(v >= d.min && v <= d.max, `${type}/${name}: ${k}=${v} buiten ${d.min}..${d.max}`);
      }
    }
  }
});

test('opgenomen kits: elke laag heeft opnames en adressen zijn geldig', () => {
  for (const [id, kit] of Object.entries(SAMPLE_KITS)) {
    const map = kit.map();
    for (const row of DRUM_ROWS) {
      const layers = map[row.p];
      assert.ok(layers?.length, `${id}: geen opnames voor ${row.name}`);
      for (const files of layers) {
        assert.ok(files.length >= 1);
        for (const url of files) assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/[^ ]+\.(flac|wav)$/);
      }
    }
  }
  assert.ok(CREDITS.length >= 4 && CREDITS.every((c) => c.license && c.url));
});

test('notenamen en de juiste opname kiezen', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A0'), 21);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.equal(noteToMidi('Ds1'), 27);
  assert.equal(noteToMidi('Fs7'), 102);
  const zones = [{ root: 57 }, { root: 60 }, { root: 63 }];
  assert.equal(pickZone(zones, 60).root, 60);
  assert.equal(pickZone(zones, 59).root, 60, 'liever iets omlaag stemmen');
  assert.equal(pickZone(zones, 70).root, 63);
  assert.equal(pickZone(zones, 40).root, 57);
});

test('DSP: voorspelbaar toeval, naadloze loop, filter en zaagtand', () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const d = new Float32Array(1000).map((_, i) => Math.sin(i * 0.37));
  seamlessLoop([d], 400, 900, 100);
  assert.ok(Math.abs(d[899] - Math.sin(399 * 0.37)) < 0.02, 'einde sluit aan op het begin van de loop');
  const f = new SVF(1000, 0.707);
  let out = 0;
  for (let i = 0; i < 2000; i++) out = f.run(1).lp;
  assert.ok(Math.abs(out - 1) < 0.01, 'laagdoorlaat laat gelijkstroom door');
  const s = new Saw();
  let min = 1, max = -1;
  for (let i = 0; i < 1000; i++) { const y = s.next(0.01); min = Math.min(min, y); max = Math.max(max, y); }
  assert.ok(min < -0.9 && max > 0.9 && max <= 1.01);
});
