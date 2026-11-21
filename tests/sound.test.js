import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLUGIN_DEFS, createInsert, normalizeInsert, formatParam, defaultMasterInserts } from '../js/audio/plugin-defs.js';
import { SYNTH_PRESETS, BASE_SYNTH, DRUM_ROWS, defaultSynth, createTrack, demoProject } from '../js/model.js';

test('alle effectparameters hebben een geldige standaardwaarde', () => {
  for (const [type, def] of Object.entries(PLUGIN_DEFS)) {
    for (const [key, p] of Object.entries(def.params)) {
      if (p.type === 'select') assert.ok(p.options.some(([v]) => v === p.def), `${type}.${key}: standaard niet in de lijst`);
      else if (p.type === 'toggle') assert.equal(typeof p.def, 'boolean');
      else assert.ok(p.def >= p.min && p.def <= p.max, `${type}.${key}: ${p.def} buiten ${p.min}..${p.max}`);
      if (p.curve === 'exp') assert.ok(p.min > 0, `${type}.${key}: exp-schaal heeft min > 0 nodig`);
    }
  }
});

test('inserts maken en aanvullen', () => {
  const ins = createInsert('delay', { mix: 0.5 });
  assert.equal(ins.on, true);
  assert.equal(ins.params.mix, 0.5);
  assert.equal(ins.params.pingpong, true);
  const norm = normalizeInsert({ id: 'a', type: 'reverb', params: { size: 4 } });
  assert.equal(norm.params.size, 4);
  assert.equal(norm.params.damping, 0.5);
  assert.equal(normalizeInsert({ type: 'bestaat-niet' }), null);
  assert.deepEqual(defaultMasterInserts().map((i) => i.type), ['comp', 'limiter']);
  assert.notEqual(createInsert('eq').id, createInsert('eq').id);
});

test('waarden netjes weergeven', () => {
  assert.equal(formatParam({ unit: 'dB' }, 3), '+3.0 dB');
  assert.equal(formatParam({ unit: 'Hz' }, 1500), '1.50 kHz');
  assert.equal(formatParam({ unit: 's' }, 0.25), '250 ms');
  assert.equal(formatParam({ unit: '%' }, 0.4), '40%');
});

test('synthpresets gebruiken alleen bekende instellingen', () => {
  const cats = new Set();
  for (const [name, preset] of Object.entries(SYNTH_PRESETS)) {
    cats.add(preset.cat);
    for (const key of Object.keys(preset)) if (key !== 'cat') assert.ok(key in BASE_SYNTH, `${name}: onbekende instelling ${key}`);
    const s = defaultSynth(name);
    assert.equal(s.preset, name);
    assert.equal(s.cat, undefined);
  }
  assert.ok(Object.keys(SYNTH_PRESETS).length >= 20);
  assert.deepEqual([...cats].sort(), ['Bas', 'Keys', 'Lead', 'Pad', 'Pluk']);
  assert.equal(defaultSynth('bestaat-niet').preset, 'Lead');
});

test('drumrijen en samplerspoor', () => {
  assert.equal(DRUM_ROWS.length, 12);
  assert.equal(new Set(DRUM_ROWS.map((r) => r.p)).size, 12);
  const s = createTrack('sampler', 0);
  assert.equal(s.name, 'Sampler 1');
  assert.equal(s.sampler.root, 60);
  assert.deepEqual(s.inserts, []);
});

test('het voorbeeldproject gebruikt de nieuwe effecten', () => {
  const p = demoProject();
  const types = p.tracks.flatMap((t) => t.inserts.map((i) => i.type));
  assert.ok(types.includes('pump'));
  assert.ok(types.includes('ensemble') && types.includes('tape'));
  assert.ok(p.returns.some((r) => r.inserts.some((i) => i.type === 'plate')), 'galm via een return');
  assert.equal(p.tracks[0].drums.kit, '909');
});
