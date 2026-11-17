// Clip-editor: pianorol voor synthclips, stappenraster voor drumclips, instellingen voor audioclips.
import { state, gesture, commit, selectedClip, trackOfClip } from '../state.js';
import { DRUM_ROWS, BEATS_PER_BAR, noteName, isBlackKey, snap, snapFloor, patternOf, quantizeNotes, clamp } from '../model.js';
import { h, select, fitCanvas, param } from './dom.js';

const RULER_H = 20;
const VEL_H = 60;
const LOW = 21;
const HIGH = 108;
const C = {
  bg: '#141417', row: '#1b1b1f', rowBlack: '#161619', line: '#232328', beat: '#2e2e35', bar: '#45454e',
  text: '#8e8e96', key: '#d6d6db', keyBlack: '#2b2b31', ruler: '#1e1e23', shade: 'rgba(0,0,0,0.45)', accent: '#f2a33a',
};
const GRIDS = [[1, '1/4'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32'], [1 / 3, '1/8 triool'], [1 / 6, '1/16 triool']];

export function createEditor(app) {
  const bar = h('div.ed-bar');
  const cv = h('canvas.ed-canvas');
  const wrap = h('div.ed-wrap', {}, cv);
  const root = h('div.editor', {}, bar, wrap);
  let sx = 0, sy = 0, zx = 56, lastLen = 1, selNote = null, lastClipId = null;

  const info = () => {
    const clip = selectedClip();
    const track = clip ? trackOfClip(clip.id) : null;
    return { clip, track, drums: track?.kind === 'drums' };
  };
  const keysW = (drums) => (drums ? 104 : 52);
  const rowH = (drums) => (drums ? clamp(Math.floor((cv.clientHeight - RULER_H - VEL_H) / DRUM_ROWS.length), 14, 30) : 14);
  const rowCount = (drums) => (drums ? DRUM_ROWS.length : HIGH - LOW + 1);
  const rowToPitch = (r, drums) => (drums ? DRUM_ROWS[r]?.p : r >= 0 && r <= HIGH - LOW ? HIGH - r : undefined);
  const pitchToRow = (p, drums) => (drums ? DRUM_ROWS.findIndex((d) => d.p === p) : HIGH - p);
  const xOf = (b, drums) => keysW(drums) + b * zx - sx;
  const beatOf = (x, drums) => (x - keysW(drums) + sx) / zx;
  const yOf = (r, drums) => RULER_H + r * rowH(drums) - sy;
  const rowOf = (y, drums) => Math.floor((y - RULER_H + sy) / rowH(drums));

  function clampScroll() {
    const { clip, drums } = info();
    if (!clip) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    const gridH = H - RULER_H - VEL_H;
    sy = clamp(sy, 0, Math.max(0, rowCount(drums) * rowH(drums) - gridH));
    sx = clamp(sx, 0, Math.max(0, (patternOf(clip) + 4) * zx - (W - keysW(drums))));
  }

  function centerOn(clip, drums) {
    sx = 0;
    if (drums) { sy = 0; return; }
    const ps = clip.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 60;
    sy = pitchToRow(Math.round(mid), false) * rowH(false) - (cv.clientHeight - RULER_H - VEL_H) / 2;
    const fit = (cv.clientWidth - keysW(drums) - 20) / Math.max(1, patternOf(clip));
    zx = clamp(fit, 14, 120);
  }

  function render() {
    const { clip, track, drums } = info();
    bar.replaceChildren(...toolbar(clip, track, drums));
    wrap.hidden = !clip || track.kind === 'audio';
    if (clip && clip.id !== lastClipId && !wrap.hidden) {
      lastClipId = clip.id;
      selNote = null;
      requestAnimationFrame(() => { centerOn(clip, drums); clampScroll(); draw(); });
    }
    draw();
  }

  function toolbar(clip, track, drums) {
    if (!clip) {
      return [h('p.hint', {}, 'Selecteer een clip om hem te bewerken. Dubbelklik in een synth- of drumspoor om een nieuwe clip te maken.')];
    }
    const name = h('input.clip-name-input', { value: clip.name, placeholder: 'Naam van de clip', 'aria-label': 'Naam van de clip' });
    name.addEventListener('change', () => commit(() => { clip.name = name.value.trim(); }));
    const head = h('span.ed-track', { style: { '--tc': track.color } }, track.name);
    if (track.kind === 'audio') {
      return [head, name,
        param({ label: 'Volume', min: 0, max: 2, step: 0.01, def: 1, get: () => clip.gain ?? 1, set: (v) => { clip.gain = v; }, format: (v) => `${Math.round(v * 100)}%`, scope: 'clip' }),
        param({ label: 'Begin in bestand', min: 0, max: Math.max(0.1, app.buffers.get(clip.audioId)?.duration || 0), step: 0.01, def: 0, get: () => clip.offset || 0, set: (v) => { clip.offset = v; }, format: (v) => `${v.toFixed(2)} s`, scope: 'clip' }),
        h('p.hint', {}, 'Sleep de rechterrand van de clip om hem korter of langer te maken.')];
    }
    const pl = patternOf(clip);
    const bars = [1, 2, 4, 8, 16].map((b) => [b * BEATS_PER_BAR, `${b} ${b === 1 ? 'maat' : 'maten'}`]);
    if (!bars.some(([v]) => v === pl)) bars.unshift([pl, `${pl} tellen`]);
    return [
      head, name,
      h('label.field', {}, 'Patroon', select(bars, pl, (v) => commit(() => { clip.pattern = +v; if (clip.length < +v) clip.length = +v; }))),
      h('label.field', {}, 'Raster', select(GRIDS.map(([v, l]) => [v, l]), state.view.grid, (v) => { state.view.grid = +v; draw(); })),
      h('button.btn', { onclick: () => commit(() => quantizeNotes(clip.notes, state.view.grid), 'notes'), title: 'Zet alle noten op het raster' }, 'Kwantiseer'),
      h('button.btn', { onclick: () => { if (clip.notes.length && confirm('Alle noten in deze clip wissen?')) commit(() => { clip.notes = []; }, 'notes'); } }, 'Wis noten'),
      h('span.ed-zoom', {},
        h('button.tbtn', { onclick: () => { zx = clamp(zx / 1.3, 8, 200); clampScroll(); draw(); }, 'aria-label': 'Uitzoomen' }, '−'),
        h('button.tbtn', { onclick: () => { zx = clamp(zx * 1.3, 8, 200); clampScroll(); draw(); }, 'aria-label': 'Inzoomen' }, '+')),
      h('p.hint', {}, drums
        ? 'Klik om een slag aan of uit te zetten. Sleep onderin om de velocity te veranderen.'
        : 'Klik en sleep om een noot te tekenen. Sleep een noot om hem te verplaatsen, de rand voor de lengte. Rechtsklik wist. Alt+slepen kopieert.'),
    ];
  }

  function draw() {
    if (wrap.hidden || !cv.clientWidth) return;
    const { g, w: W, h: H } = fitCanvas(cv);
    const { clip, track, drums } = info();
    if (!clip) return;
    const kw = keysW(drums), rh = rowH(drums), gridBottom = H - VEL_H;
    const pl = patternOf(clip);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    g.save();
    g.beginPath();
    g.rect(kw, RULER_H, W - kw, gridBottom - RULER_H);
    g.clip();
    const r0 = Math.max(0, rowOf(RULER_H, drums)), r1 = Math.min(rowCount(drums) - 1, rowOf(gridBottom, drums));
    for (let r = r0; r <= r1; r++) {
      const p = rowToPitch(r, drums);
      g.fillStyle = drums ? (r % 2 ? C.row : C.rowBlack) : isBlackKey(p) ? C.rowBlack : C.row;
      g.fillRect(kw, yOf(r, drums), W - kw, rh);
      g.fillStyle = C.line;
      g.fillRect(kw, yOf(r, drums) + rh - 1, W - kw, 1);
    }
    const grid = state.view.grid;
    const b0 = Math.max(0, snapFloor(beatOf(kw, drums), grid)), b1 = beatOf(W, drums);
    for (let b = b0; b <= b1; b += grid) {
      const isBar = Math.abs(b / BEATS_PER_BAR - Math.round(b / BEATS_PER_BAR)) < 1e-6;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      g.fillStyle = isBar ? C.bar : isBeat ? C.beat : C.line;
      g.fillRect(Math.round(xOf(b, drums)), RULER_H, 1, gridBottom - RULER_H);
    }
    g.fillStyle = C.shade;
    g.fillRect(Math.max(kw, xOf(pl, drums)), RULER_H, W, gridBottom - RULER_H);

    for (const n of clip.notes) {
      const r = pitchToRow(n.p, drums);
      if (r < 0 || r >= rowCount(drums)) continue;
      const x = xOf(n.t, drums), y = yOf(r, drums);
      const w = Math.max(3, n.d * zx - 1);
      g.globalAlpha = n.t >= pl ? 0.25 : 0.45 + 0.55 * n.v;
      g.fillStyle = track.color;
      g.fillRect(x + 0.5, y + 1, w, rh - 2);
      g.globalAlpha = 1;
      if (n === selNote) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 1, w, rh - 2); }
    }
    const pos = app.playing() ? app.playhead() : null;
    if (pos != null && pos >= clip.start && pos < clip.start + clip.length) {
      const x = xOf((pos - clip.start) % pl, drums);
      g.fillStyle = C.accent;
      g.fillRect(x, RULER_H, 1.5, gridBottom - RULER_H);
    }
    g.restore();

    // Toetsen of drumnamen
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, kw, gridBottom - RULER_H);
    g.clip();
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let r = r0; r <= r1; r++) {
      const p = rowToPitch(r, drums), y = yOf(r, drums);
      if (drums) {
        g.fillStyle = r % 2 ? '#202025' : '#1b1b20';
        g.fillRect(0, y, kw, rh);
        g.fillStyle = C.key;
        g.fillText(DRUM_ROWS[r].name, 10, y + rh / 2);
      } else {
        const black = isBlackKey(p);
        g.fillStyle = black ? C.keyBlack : C.key;
        g.fillRect(0, y, black ? kw * 0.62 : kw, rh - 1);
        if (p % 12 === 0) { g.fillStyle = '#55555e'; g.fillText(noteName(p), kw - 26, y + rh / 2); }
      }
    }
    g.restore();

    // Liniaal
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, W, RULER_H);
    g.fillStyle = C.text;
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let b = Math.floor(beatOf(kw, drums)); b <= b1; b++) {
      if (b < 0) continue;
      const x = xOf(b, drums);
      if (x < kw) continue;
      if (b % BEATS_PER_BAR === 0) g.fillText(String(b / BEATS_PER_BAR + 1), x + 4, RULER_H / 2);
      g.fillRect(x, b % BEATS_PER_BAR === 0 ? 4 : 13, 1, RULER_H);
    }

    // Velocity
    g.fillStyle = '#18181c';
    g.fillRect(0, gridBottom, W, VEL_H);
    g.fillStyle = C.bar;
    g.fillRect(0, gridBottom, W, 1);
    g.fillStyle = C.text;
    g.fillText('Velocity', 8, gridBottom + 14);
    g.save();
    g.beginPath();
    g.rect(kw, gridBottom, W - kw, VEL_H);
    g.clip();
    g.fillStyle = track.color;
    for (const n of clip.notes) {
      const x = xOf(n.t, drums);
      const hh = n.v * (VEL_H - 10);
      g.globalAlpha = n === selNote ? 1 : 0.75;
      g.fillRect(x, H - hh - 2, 2, hh);
      g.fillRect(x - 2, H - hh - 4, 6, 3);
    }
    g.restore();
    g.globalAlpha = 1;
  }

  const hitNote = (clip, beat, r, drums) => {
    let hit = null;
    for (const n of clip.notes) if (pitchToRow(n.p, drums) === r && beat >= n.t && beat < n.t + Math.max(n.d, 0.1)) hit = n;
    return hit;
  };

  function drag(onMove, onUp) {
    const up = (ev) => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); onUp?.(ev); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    const { clip, track, drums } = info();
    if (!clip || track.kind === 'audio') return;
    app.focus('editor');
    app.ensureAudio();
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const gridBottom = rect.height - VEL_H;
    const pl = patternOf(clip);
    e.preventDefault();

    if (y < RULER_H) { app.seek(clip.start + Math.max(0, beatOf(x, drums))); return; }

    if (y >= gridBottom) {
      const g = gesture();
      const apply = (ev) => {
        const bx = beatOf(ev.clientX - rect.left, drums);
        const v = clamp(1 - (ev.clientY - rect.top - gridBottom - 6) / (VEL_H - 10), 0.05, 1);
        const targets = clip.notes.filter((n) => bx >= n.t - 0.05 && bx < n.t + Math.max(n.d, state.view.grid));
        if (targets.length) g.update(() => { for (const n of targets) n.v = v; }, 'notes');
      };
      apply(e);
      drag(apply, () => g.end('notes'));
      return;
    }

    const r = rowOf(y, drums);
    const pitch = rowToPitch(r, drums);
    if (pitch == null) return;
    if (x < keysW(drums)) { app.audition(track, pitch); return; }

    const beat = beatOf(x, drums);
    const hit = hitNote(clip, beat, r, drums);
    if (e.button === 2) {
      if (hit) { if (hit === selNote) selNote = null; commit(() => clip.notes.splice(clip.notes.indexOf(hit), 1), 'notes'); }
      return;
    }
    if (e.button !== 0) return;
    const grid = state.view.grid;

    let note = hit, g = null, mode, created = false;
    if (hit) {
      mode = !drums && x > xOf(hit.t + hit.d, drums) - 6 ? 'resize' : 'move';
      if (mode === 'move') app.audition(track, hit.p, hit.v);
    } else {
      note = { t: clamp(snapFloor(beat, grid), 0, Math.max(0, pl - grid)), d: drums ? grid : Math.min(lastLen, pl), p: pitch, v: drums ? 0.9 : 0.8 };
      g = gesture();
      g.update(() => clip.notes.push(note), 'notes');
      created = true;
      mode = drums ? 'move' : 'resize';
      app.audition(track, pitch, note.v);
    }
    selNote = note;
    draw();

    const orig = { ...note };
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, copied = false;
    drag((ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      g ||= gesture();
      const gr = ev.shiftKey ? grid / 4 : grid;
      const dx = (ev.clientX - x0) / zx;
      if (e.altKey && !copied && !created) { g.update(() => clip.notes.push({ ...orig }), 'notes'); copied = true; }
      if (mode === 'resize') {
        const d = clamp(snap(orig.t + orig.d + dx, gr) - orig.t, gr, pl - orig.t);
        g.update(() => { note.d = d; }, 'notes');
        lastLen = d;
      } else {
        const t = clamp(snap(orig.t + dx, gr), 0, Math.max(0, pl - gr));
        const row = clamp(pitchToRow(orig.p, drums) + Math.round((ev.clientY - y0) / rowH(drums)), 0, rowCount(drums) - 1);
        const p = rowToPitch(row, drums);
        if (p !== note.p) app.audition(track, p, note.v);
        g.update(() => { note.t = t; note.p = p; }, 'notes');
        if (!drums) lastLen = note.d;
      }
    }, () => {
      if (!moved && drums && !created) {
        selNote = null;
        commit(() => clip.notes.splice(clip.notes.indexOf(note), 1), 'notes');
        return;
      }
      g?.end('notes');
    });
  });

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const { drums } = info();
      const rect = cv.getBoundingClientRect();
      const before = beatOf(e.clientX - rect.left, drums);
      zx = clamp(zx * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 8, 200);
      sx = before * zx - (e.clientX - rect.left - keysW(drums));
    } else if (e.shiftKey) sx += e.deltaY;
    else { sy += e.deltaY * 0.6; sx += e.deltaX; }
    clampScroll();
    draw();
  }, { passive: false });

  new ResizeObserver(() => { clampScroll(); draw(); }).observe(wrap);

  function deleteSelected() {
    const { clip } = info();
    if (!clip || !selNote || !clip.notes.includes(selNote)) return false;
    const n = selNote;
    selNote = null;
    commit(() => clip.notes.splice(clip.notes.indexOf(n), 1), 'notes');
    return true;
  }

  return { el: root, render, draw, deleteSelected };
}
