// Clip-editor: pianorol voor synthclips, stappenraster voor drumclips, instellingen voor audioclips.
import { state, gesture, commit, selectedClip, trackOfClip } from '../state.js';
import { DRUM_ROWS, BEATS_PER_BAR, noteName, isBlackKey, snap, snapFloor, patternOf, quantizeNotes, clamp } from '../model.js';
import { h, select, fitCanvas } from './dom.js';
import { knob } from './knob.js';

const RULER_H = 22;
const VEL_H = 60;
const LOW = 21;
const HIGH = 108;
const C = {
  bg: '#161618', row: '#1c1c1f', rowBlack: '#18181b', line: 'rgba(255,255,255,0.035)', beat: 'rgba(255,255,255,0.075)', bar: 'rgba(255,255,255,0.17)',
  text: '#8a8a96', key: '#d9d9df', keyBlack: '#1c1c22', ruler: '#101013', shade: 'rgba(0,0,0,0.55)', accent: '#f29a2e',
};
const MONO = '"Archivo Narrow", "Archivo", system-ui, sans-serif';
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
      const K = (label, key, min, max, step, format, def) => knob({ label, min, max, step, def, format, scope: 'clip', get: () => clip[key] ?? def, set: (v) => { clip[key] = v; } });
      const beats = (v) => `${v.toFixed(2)} tel`;
      return [head, name,
        h('div.ed-knobs', {},
          K('Volume', 'gain', 0, 2, 0.01, (v) => `${Math.round(v * 100)}%`, 1),
          K('Begin', 'offset', 0, Math.max(0.1, app.buffers.get(clip.audioId)?.duration || 0), 0.01, (v) => `${v.toFixed(2)}s`, 0),
          K('Fade in', 'fadeIn', 0, Math.max(0.25, clip.length / 2), 0.01, beats, 0),
          K('Fade uit', 'fadeOut', 0, Math.max(0.25, clip.length / 2), 0.01, beats, 0)),
        h('p.hint', {}, 'Sleep de rechterrand van de clip voor de lengte, en de witte blokjes bovenin voor fades.')];
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
    g.fillStyle = 'rgba(255,255,255,0.016)';
    for (let bar = 1; bar * BEATS_PER_BAR <= b1; bar += 2) g.fillRect(xOf(bar * BEATS_PER_BAR, drums), RULER_H, BEATS_PER_BAR * zx, gridBottom - RULER_H);
    for (let b = b0; b <= b1; b += grid) {
      const isBar = Math.abs(b / BEATS_PER_BAR - Math.round(b / BEATS_PER_BAR)) < 1e-6;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      g.fillStyle = isBar ? C.bar : isBeat ? C.beat : C.line;
      g.fillRect(Math.round(xOf(b, drums)), RULER_H, 1, gridBottom - RULER_H);
    }
    g.fillStyle = C.shade;
    g.fillRect(Math.max(kw, xOf(pl, drums)), RULER_H, W, gridBottom - RULER_H);

    g.font = `600 9px ${MONO}`;
    g.textBaseline = 'middle';
    for (const n of clip.notes) {
      const r = pitchToRow(n.p, drums);
      if (r < 0 || r >= rowCount(drums)) continue;
      const x = xOf(n.t, drums) + 0.5, y = yOf(r, drums) + 1;
      const w = Math.max(4, n.d * zx - 1.5), nh = rh - 2;
      const rad = Math.min(3, nh / 2);
      g.globalAlpha = n.t >= pl ? 0.25 : 0.5 + 0.5 * n.v;
      g.fillStyle = track.color;
      if (n === selNote) { }
      g.beginPath();
      g.roundRect ? g.roundRect(x, y, w, nh, rad) : g.rect(x, y, w, nh);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + rad, y + 0.5, Math.max(0, w - rad * 2), 1);
      g.strokeStyle = n === selNote ? '#fff' : 'rgba(0,0,0,0.45)';
      g.lineWidth = n === selNote ? 1.5 : 1;
      g.stroke();
      if (!drums && w > 30 && nh >= 11) { g.fillStyle = 'rgba(10,10,12,0.75)'; g.fillText(noteName(n.p), x + 4, y + nh / 2 + 0.5); }
    }
    const pos = app.playing() ? app.playhead() : null;
    if (pos != null && pos >= clip.start && pos < clip.start + clip.length) {
      const x = xOf((pos - clip.start) % pl, drums);
      g.fillStyle = '#fff';
      g.fillRect(x, RULER_H, 1, gridBottom - RULER_H);
    }
    g.restore();

    // Toetsen of drumnamen
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, kw, gridBottom - RULER_H);
    g.clip();
    g.textBaseline = 'middle';
    for (let r = r0; r <= r1; r++) {
      const p = rowToPitch(r, drums), y = yOf(r, drums);
      if (drums) {
        g.fillStyle = r % 2 ? '#17171c' : '#131317';
        g.fillRect(0, y, kw, rh);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(0, y + rh - 1, kw, 1);
        g.fillStyle = C.key;
        g.font = `600 12px ${MONO}`;
        g.fillText(DRUM_ROWS[r].name, 12, y + rh / 2);
      } else {
        const black = isBlackKey(p);
        g.fillStyle = C.key;
        g.fillRect(0, y, kw, rh - 1);
        if (black) { g.fillStyle = C.keyBlack; g.fillRect(0, y - 1, kw * 0.62, rh + 1); }
        if (p % 12 === 0) { g.fillStyle = '#55555e'; g.font = `600 10px ${MONO}`; g.fillText(noteName(p), kw - 25, y + rh / 2); }
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(kw - 1, RULER_H, 1, gridBottom - RULER_H);
    g.restore();

    // Liniaal
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, W, RULER_H);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(0, RULER_H - 1, W, 1);
    g.font = `500 10px ${MONO}`;
    g.textBaseline = 'middle';
    for (let b = Math.floor(beatOf(kw, drums)); b <= b1; b++) {
      if (b < 0) continue;
      const x = xOf(b, drums);
      if (x < kw) continue;
      g.fillStyle = b % BEATS_PER_BAR === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
      g.fillRect(Math.round(x), b % BEATS_PER_BAR === 0 ? 4 : 15, 1, RULER_H);
      if (b % BEATS_PER_BAR === 0) { g.fillStyle = C.text; g.fillText(String(b / BEATS_PER_BAR + 1), x + 5, RULER_H / 2); }
    }
    if (pl * zx + kw - sx < W) { g.fillStyle = C.accent; g.fillRect(xOf(pl, drums) - 1, 0, 2, RULER_H); }

    // Velocity
    g.fillStyle = '#0f0f12';
    g.fillRect(0, gridBottom, W, VEL_H);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(0, gridBottom, W, 1);
    g.fillStyle = C.text;
    g.font = `600 9px ${MONO}`;
    g.fillText('Velocity', 10, gridBottom + 14);
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
