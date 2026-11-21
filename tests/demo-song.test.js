import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSong } from '../js/demo-song.js';
import { migrate, projectEnd, eventsInRange, patternOf } from '../js/model.js';

test('voorbeeldnummer: volledig, binnen de clips en bewaarbaar', () => {
  const p = demoSong();
  assert.equal(projectEnd(p), 84 * 4);
  assert.ok(p.tracks.length >= 9);
  for (const t of p.tracks) {
    for (const c of t.clips) {
      const pl = patternOf(c);
      for (const n of c.notes) {
        assert.ok(n.t >= 0 && n.t < pl, `${t.name}/${c.name}: noot op ${n.t} buiten patroon ${pl}`);
        assert.ok(n.p >= 24 && n.p <= 100, `${t.name}: toonhoogte ${n.p}`);
        assert.ok(n.v > 0 && n.v <= 1);
      }
    }
    // Clips op hetzelfde spoor overlappen niet.
    const cs = [...t.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < cs.length; i++) assert.ok(cs[i].start >= cs[i - 1].start + cs[i - 1].length, `${t.name}: clips overlappen`);
  }
  const again = migrate(JSON.parse(JSON.stringify(p)));
  assert.equal(again.tracks.length, p.tracks.length);
  assert.equal(eventsInRange(again, 0, 84 * 4).length, eventsInRange(p, 0, 84 * 4).length);
});

test('voorbeeldnummer: elke sectie heeft wat het nodig heeft', () => {
  const p = demoSong();
  const playing = (from, to) => new Set(eventsInRange(p, from * 4, to * 4).map((e) => e.track.name));
  assert.ok(!playing(48, 56).has('Drums'), 'breakdown zonder drums');
  assert.ok(playing(48, 56).has('Vleugel'));
  for (const name of ['Drums', 'Bas', 'Lead', 'Rhodes', 'Arpeggio']) assert.ok(playing(32, 48).has(name), `drop mist ${name}`);
  assert.ok(playing(0, 8).has('Pad') && !playing(0, 8).has('Bas'), 'intro zonder bas');
  // De laatste tel van elke opbouw is stil (spanning voor de drop).
  const gap = eventsInRange(p, 32 * 4 - 0.75, 32 * 4).filter((e) => e.track.name === 'Drums');
  assert.equal(gap.length, 0);
});
