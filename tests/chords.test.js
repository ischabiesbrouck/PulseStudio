import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRESSIONS, RHYTHMS, VOICINGS, EXTENSIONS, buildProgression, chordNames, parseNumeral, parseProgression } from '../js/chords.js';

const names = (s) => chordNames({ rhythm: 'sustain', ...s }).split(' ');

test('bekende progressies in de juiste akkoorden', () => {
  assert.deepEqual(names({ root: 9, progression: 'epic' }), ['Am', 'F', 'C', 'G']);
  assert.deepEqual(names({ root: 0, progression: 'pop' }), ['C', 'G', 'Am', 'F']);
  assert.deepEqual(names({ root: 7, progression: 'pop' }), ['G', 'D', 'Em', 'C']);
  assert.deepEqual(names({ root: 9, progression: 'andalusian' }), ['Am', 'G', 'F', 'E']); // V in mineur is groot
  assert.deepEqual(names({ root: 2, progression: 'jazz' }), ['Em7', 'A7', 'Dmaj7', 'Dmaj7']);
  assert.deepEqual(names({ root: 0, progression: 'rock' }), ['C', 'B♭', 'F', 'C']); // geleende ♭VII
  assert.deepEqual(names({ root: 0, progression: 'soul' }), ['C', 'Em', 'F', 'Fm']); // geleende iv
  assert.deepEqual(names({ root: 2, progression: 'epic' }), ['Dm', 'B♭', 'F', 'C']); // D mineur spelt met mollen
});

test('uitbreidingen volgen de toonladder', () => {
  assert.deepEqual(names({ root: 0, progression: 'pop', extension: '7' }), ['Cmaj7', 'G7', 'Am7', 'Fmaj7']);
  assert.deepEqual(names({ root: 9, progression: 'epic', extension: '7' }), ['Am7', 'Fmaj7', 'Cmaj7', 'G7']);
  const nine = names({ root: 0, progression: 'pop', extension: '9' });
  assert.deepEqual(nine, ['Cmaj9', 'G9', 'Am9', 'Fmaj9']);
  assert.equal(names({ root: 9, progression: 'lofi' })[0], 'Bm7♭5');
});

test('elke progressie, elk ritme en elke voicing levert geldige noten binnen de clip', () => {
  for (const p of PROGRESSIONS) for (const [rhythm] of RHYTHMS) for (const [voicing] of VOICINGS) for (const [extension] of EXTENSIONS) {
    const r = buildProgression({ root: 4, progression: p.id, rhythm, voicing, extension, bars: 1 });
    assert.ok(r && r.notes.length, `${p.id}/${rhythm}`);
    assert.equal(r.length, r.chords.length * 4);
    for (const n of r.notes) {
      assert.ok(n.t >= 0 && n.t + n.d <= r.length + 1e-9, `${p.id}/${rhythm}: noot ${n.t}+${n.d} buiten ${r.length}`);
      assert.ok(n.p >= 28 && n.p <= 96 && n.v > 0 && n.v <= 1, `${p.id}/${rhythm}/${voicing}: ${n.p} ${n.v}`);
    }
  }
});

test('stemvoering: opeenvolgende akkoorden liggen dicht bij elkaar', () => {
  const r = buildProgression({ root: 0, progression: 'canon', voicing: 'close', bass: false });
  for (let i = 1; i < r.chords.length; i++) {
    const a = r.chords[i - 1].notes, b = r.chords[i].notes;
    const move = b.reduce((s, n) => s + Math.min(...a.map((x) => Math.abs(x - n))), 0);
    assert.ok(move <= 6, `${r.chords[i - 1].name} → ${r.chords[i].name}: ${move} halve tonen`);
  }
});

test('eigen reeks ontleden', () => {
  assert.deepEqual(parseNumeral('♭VIImaj7'), { acc: -1, degree: 6, minor: false, suffix: 'maj7', slash: null });
  assert.equal(parseNumeral('xyz'), null);
  assert.equal(parseProgression('vi IV I V').length, 4);
  assert.equal(parseProgression('vi IV Q V'), null);
  assert.deepEqual(names({ root: 9, progression: 'custom', custom: 'i iv v VI', customMode: 'minor' }), ['Am', 'Dm', 'Em', 'F']);
  assert.equal(buildProgression({ progression: 'custom', custom: 'onzin' }), null);
});

test('akkoorden van twee maten en arpeggio', () => {
  const r = buildProgression({ root: 9, progression: 'epic', bars: 2, rhythm: 'arp' });
  assert.equal(r.length, 32);
  assert.ok(r.notes.filter((n) => n.t < 8).length > 16);
});
