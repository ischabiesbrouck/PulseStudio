// Arrangeerweergave: tijdlijn met sporen, clips, liniaal, loopgebied en afspeelkop.
import { state, commit, gesture, select, findTrack, findClip } from '../state.js';
import { BEATS_PER_BAR, KIND_NAMES, projectEnd, patternOf, createClip, createTrack, snap, snapFloor, clamp, uid } from '../model.js';
import { h, icon, param } from './dom.js';

export const HEADER_W = 210;
const LANE_H = 64;

export function createArrange(app) {
  const scroll = h('div.arr-scroll', { tabindex: '-1' });
  const inner = h('div.arr-inner');
  const playhead = h('div.arr-playhead');
  scroll.append(inner);

  const z = () => state.view.zoom;
  const viewBeats = () => {
    const p = state.project;
    const end = Math.max(projectEnd(p), p.loop.end, app.playhead());
    return Math.max(96, Math.ceil((end + 32) / BEATS_PER_BAR) * BEATS_PER_BAR);
  };
  const beatAt = (clientX) => (clientX - inner.getBoundingClientRect().left - HEADER_W) / z();

  function render() {
    const p = state.project;
    const beats = viewBeats();
    inner.style.width = `${HEADER_W + beats * z()}px`;
    inner.style.setProperty('--beat', `${z()}px`);
    inner.replaceChildren(ruler(beats), ...p.tracks.map(trackRow), addRow(), playhead);
    setPlayhead(app.playhead());
  }

  function ruler(beats) {
    const p = state.project;
    const marks = h('div.ruler');
    const every = z() < 10 ? 4 : z() < 20 ? 2 : 1;
    for (let bar = 0; bar * BEATS_PER_BAR < beats; bar += every) {
      marks.append(h('span.bar-mark', { style: { left: `${bar * BEATS_PER_BAR * z()}px` } }, bar + 1));
    }
    const region = h('div.loop-region', {
      class: p.loop.on ? 'on' : null,
      style: { left: `${p.loop.start * z()}px`, width: `${(p.loop.end - p.loop.start) * z()}px` },
      title: 'Loopgebied: sleep in de liniaal om het te verplaatsen of te veranderen',
    });
    marks.append(region);
    marks.addEventListener('pointerdown', (e) => rulerDrag(e));
    const zoomBy = (f) => () => { state.view.zoom = clamp(Math.round(z() * f), 6, 120); app.emit('view'); };
    const corner = h('div.arr-corner', { title: 'In- en uitzoomen (ook met Ctrl + scrollwiel)' },
      h('span.lbl', {}, 'Zoom'),
      h('button.tbtn', { onclick: zoomBy(1 / 1.4), 'aria-label': 'Uitzoomen' }, '−'),
      h('button.tbtn', { onclick: zoomBy(1.4), 'aria-label': 'Inzoomen' }, '+'));
    return h('div.arr-row.ruler-row', {}, corner, marks);
  }

  function rulerDrag(e) {
    const start = snap(Math.max(0, beatAt(e.clientX)), 1);
    const x0 = e.clientX;
    let g = null;
    const move = (ev) => {
      if (!g && Math.abs(ev.clientX - x0) < 4) return;
      g ||= gesture();
      const b = snap(Math.max(0, beatAt(ev.clientX)), ev.shiftKey ? 1 : BEATS_PER_BAR);
      const s = snap(start, ev.shiftKey ? 1 : BEATS_PER_BAR);
      g.update((p) => {
        p.loop.start = Math.min(s, b);
        p.loop.end = Math.max(s, b) === Math.min(s, b) ? Math.min(s, b) + BEATS_PER_BAR : Math.max(s, b);
        p.loop.on = true;
      }, 'loop');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (g) g.end('all');
      else app.seek(start);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function trackRow(track) {
    const sel = state.sel.trackId === track.id;
    const btn = (label, key, title) => h('button.tbtn', {
      class: track[key] ? `on ${key}` : null, title, 'aria-pressed': String(!!track[key]),
      onclick: (e) => { e.stopPropagation(); commit(() => { track[key] = !track[key]; }); },
    }, label);
    const name = h('span.tname', { title: 'Dubbelklik om de naam te wijzigen' }, track.name);
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = h('input.tname-edit', { value: track.name });
      name.replaceWith(input);
      input.focus();
      input.select();
      const done = () => { const v = input.value.trim(); if (v && v !== track.name) commit(() => { track.name = v; }); else render(); };
      input.addEventListener('blur', done, { once: true });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = track.name; input.blur(); } });
    });
    const kind = KIND_NAMES[track.kind];
    const header = h('div.arr-header', { class: sel ? 'selected' : null, onpointerdown: () => select(track.id, null) },
      h('span.tcolor', { style: { background: track.color } }),
      h('div.tmain', {},
        h('div.trow', {}, name, h('span.tkind', {}, kind)),
        h('div.trow', {},
          btn('M', 'mute', 'Dempen'), btn('S', 'solo', 'Solo'), btn('●', 'arm', 'Opname aan voor dit spoor'),
          param({ label: 'Volume', min: -60, max: 6, step: 0.5, def: -6, get: () => track.volume, set: (v) => { track.volume = v; }, format: (v) => (v <= -60 ? '-∞' : `${v.toFixed(1)}`) }))));

    const lane = h('div.lane', { dataset: { track: track.id }, style: { '--tc': track.color } });
    for (const clip of track.clips) lane.append(clipEl(track, clip));
    lane.addEventListener('pointerdown', (e) => lanePointer(e, track));
    lane.addEventListener('dblclick', (e) => laneDouble(e, track));
    lane.addEventListener('dragover', (e) => { if (track.kind === 'audio') { e.preventDefault(); lane.classList.add('drop'); } });
    lane.addEventListener('dragleave', () => lane.classList.remove('drop'));
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      lane.classList.remove('drop');
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('audio') || /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i.test(f.name));
      if (file) app.importAudio(file, track.id, snapFloor(Math.max(0, beatAt(e.clientX)), state.view.arrangeGrid));
    });
    return h('div.arr-row.track-row', { class: sel ? 'selected' : null, dataset: { id: track.id } }, header, lane);
  }

  function clipEl(track, clip) {
    const w = Math.max(4, clip.length * z());
    const cv = h('canvas.clip-cv', { width: Math.min(8000, Math.ceil(w)), height: LANE_H - 22 });
    const el = h('div.clip', {
      class: state.sel.clipId === clip.id ? 'selected' : null,
      dataset: { clip: clip.id },
      style: { left: `${clip.start * z()}px`, width: `${w}px`, '--tc': track.color },
      title: 'Sleep om te verplaatsen, sleep de rechterrand voor de lengte, Alt+slepen kopieert, dubbelklik opent de editor',
    }, h('span.clip-name', {}, clip.name || (track.kind === 'audio' ? 'Audio' : 'Clip')), cv, h('span.clip-handle'));
    drawClip(cv, track, clip);
    return el;
  }

  function drawClip(cv, track, clip) {
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    if (track.kind === 'audio') {
      const peaks = app.peaks.get(clip.audioId);
      const buf = app.buffers.get(clip.audioId);
      if (!peaks || !buf) return;
      const spb = 60 / state.project.bpm;
      const secPerPx = (clip.length * spb) / W;
      for (let x = 0; x < W; x++) {
        const sec = (clip.offset || 0) + x * secPerPx;
        if (sec >= buf.duration) break;
        const v = peaks[Math.floor((sec / buf.duration) * peaks.length)] * (clip.gain ?? 1);
        const hh = Math.max(1, v * H);
        g.fillRect(x, (H - hh) / 2, 1, hh);
      }
      return;
    }
    if (!clip.notes.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const n of clip.notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    const range = Math.max(8, hi - lo + 1);
    const rowH = H / range;
    const pl = patternOf(clip);
    const pxb = W / clip.length;
    for (let k = 0; k * pl < clip.length; k++) {
      if (k > 0) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(k * pl * pxb, 0, 1, H); g.fillStyle = 'rgba(255,255,255,0.85)'; }
      for (const n of clip.notes) {
        if (n.t >= pl) continue;
        const x = (k * pl + n.t) * pxb;
        if (x >= W) continue;
        const y = H - (n.p - lo + 1 + (range - (hi - lo + 1)) / 2) * rowH;
        g.fillRect(x, y, Math.max(2, Math.min(n.d, pl - n.t) * pxb - 1), Math.max(2, rowH - 1));
      }
    }
  }

  function lanePointer(e, track) {
    if (e.button !== 0) return;
    const clipNode = e.target.closest('.clip');
    if (!clipNode) { select(track.id, null); return; }
    const clip = findClip(clipNode.dataset.clip);
    select(track.id, clip.id);
    const rect = clipNode.getBoundingClientRect();
    const resize = e.clientX > rect.right - 8;
    const x0 = e.clientX, y0 = e.clientY;
    const orig = { start: clip.start, length: clip.length };
    let g = null;
    let current = track;
    const move = (ev) => {
      if (!g && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      if (!g) {
        g = gesture();
        if (ev.altKey && !resize) g.update(() => current.clips.push({ ...structuredClone(clip), id: uid('c') }), 'arrange');
      }
      const grid = ev.shiftKey ? 0.25 : state.view.arrangeGrid;
      const dx = (ev.clientX - x0) / z();
      if (resize) {
        const len = Math.max(grid, snap(orig.length + dx, grid));
        g.update(() => { clip.length = len; }, 'arrange');
        return;
      }
      const start = Math.max(0, snap(orig.start + dx, grid));
      const laneNode = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lane');
      const target = laneNode ? findTrack(laneNode.dataset.track) : null;
      g.update(() => {
        clip.start = start;
        if (target && target !== current && target.kind === current.kind) {
          current.clips.splice(current.clips.indexOf(clip), 1);
          target.clips.push(clip);
          current = target;
          state.sel.trackId = target.id;
        }
      }, 'arrange');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      g?.end('all');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function laneDouble(e, track) {
    const clipNode = e.target.closest('.clip');
    if (clipNode) { select(track.id, clipNode.dataset.clip); app.showPanel('editor'); return; }
    const beat = snapFloor(Math.max(0, beatAt(e.clientX)), BEATS_PER_BAR);
    if (track.kind === 'audio') { app.pickAudio(track.id, beat); return; }
    const clip = createClip(track.kind, beat, BEATS_PER_BAR);
    commit(() => { track.clips.push(clip); });
    select(track.id, clip.id);
    app.showPanel('editor');
  }

  function addRow() {
    const add = (kind, label) => h('button.btn', {
      onclick: () => {
        const p = state.project;
        const t = createTrack(kind, p.tracks.length);
        commit(() => { p.tracks.push(t); });
        select(t.id, null);
        app.showPanel('sound');
      },
    }, icon('plus', 14), label);
    return h('div.arr-row.add-row', {}, h('div.arr-header.add', {}, add('synth', 'Synth'), add('drums', 'Drums'), add('sampler', 'Sampler'), add('audio', 'Audio')), h('div.lane.empty'));
  }

  function setPlayhead(beat) {
    playhead.style.transform = `translateX(${HEADER_W + beat * z()}px)`;
  }

  function follow(beat) {
    const x = HEADER_W + beat * z();
    const left = scroll.scrollLeft + HEADER_W, right = scroll.scrollLeft + scroll.clientWidth;
    if (x > right - 40 || x < left) scroll.scrollLeft = Math.max(0, x - HEADER_W - 60);
  }

  function updateSelection() {
    for (const row of inner.querySelectorAll('.track-row')) {
      const on = row.dataset.id === state.sel.trackId;
      row.classList.toggle('selected', on);
      row.querySelector('.arr-header').classList.toggle('selected', on);
    }
    for (const c of inner.querySelectorAll('.clip')) c.classList.toggle('selected', c.dataset.clip === state.sel.clipId);
  }

  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const before = beatAt(e.clientX);
    state.view.zoom = clamp(Math.round(z() * (e.deltaY < 0 ? 1.15 : 1 / 1.15)), 6, 120);
    app.emit('view');
    scroll.scrollLeft += (before * z() + HEADER_W) - (e.clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft);
  }, { passive: false });

  return { el: scroll, render, setPlayhead, follow, updateSelection };
}
