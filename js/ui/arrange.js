// Arrangeerweergave: tijdlijn met sporen, clips, liniaal, loopgebied en afspeelkop.
import { state, commit, gesture, select, findTrack, findClip } from '../state.js';
import { BEATS_PER_BAR, projectEnd, patternOf, createClip, createTrack, snap, snapFloor, clamp, uid } from '../model.js';
import { h, icon, param, select as selectEl } from './dom.js';

export const HEADER_W = 224;
const KIND_TAG = { synth: 'Synth', drums: 'Drums', sampler: 'Sampler', audio: 'Audio' };
const SNAPS = [[4, 'Maat'], [1, 'Tel'], [0.5, '1/8'], [0.25, '1/16']];
const PULSE = 'application/x-pulse';

export function createArrange(app) {
  const scroll = h('div.arr-scroll', { tabindex: '-1' });
  const inner = h('div.arr-inner');
  const playhead = h('div.arr-playhead');
  const phHandle = h('div.ph-handle');
  const loopShade = h('div.loop-shade');
  const meters = new Map();
  scroll.append(inner);

  const z = () => state.view.zoom;
  const viewBeats = () => {
    const p = state.project;
    const end = Math.max(projectEnd(p), p.loop.end, app.playhead());
    return Math.max(128, Math.ceil((end + 32) / BEATS_PER_BAR) * BEATS_PER_BAR);
  };
  const beatAt = (clientX) => (clientX - inner.getBoundingClientRect().left - HEADER_W) / z();
  const audible = (t) => !t.mute && (!state.project.tracks.some((x) => x.solo) || t.solo);

  function render() {
    const p = state.project;
    const beats = viewBeats();
    meters.clear();
    inner.style.width = `${HEADER_W + beats * z()}px`;
    inner.style.setProperty('--beat', `${z()}px`);
    loopShade.hidden = !p.loop.on;
    loopShade.style.left = `${HEADER_W + p.loop.start * z()}px`;
    loopShade.style.width = `${(p.loop.end - p.loop.start) * z()}px`;
    const rows = p.tracks.map((t, i) => trackRow(t, i));
    const empty = p.tracks.length ? null : h('div.arr-empty', {}, h('p.hint', {}, 'Nog geen sporen. Voeg hieronder een synth, drums, sampler of audiospoor toe, of sleep een geluid uit de browser naar deze plek.'));
    inner.replaceChildren(...[ruler(beats), ...rows, addRow(), loopShade, playhead, empty].filter(Boolean));
    setPlayhead(app.playhead());
  }

  function ruler(beats) {
    const p = state.project;
    const marks = h('div.ruler');
    const every = z() < 9 ? 8 : z() < 16 ? 4 : z() < 26 ? 2 : 1;
    for (let bar = 0; bar * BEATS_PER_BAR < beats; bar += every) {
      marks.append(h('span.bar-mark', { style: { left: `${bar * BEATS_PER_BAR * z()}px` } }, bar + 1));
    }
    marks.append(h('div.loop-region', {
      class: p.loop.on ? 'on' : null,
      style: { left: `${p.loop.start * z()}px`, width: `${(p.loop.end - p.loop.start) * z()}px` },
    }), phHandle);
    marks.title = 'Klik om de afspeelkop te zetten; sleep om het loopgebied te kiezen (Shift: per tel)';
    marks.addEventListener('pointerdown', rulerDrag);
    const zoomBy = (f) => () => { state.view.zoom = clamp(Math.round(z() * f), 6, 140); app.emit('view'); };
    const corner = h('div.arr-corner', {},
      h('span.lbl', {}, 'Raster'),
      selectEl(SNAPS, state.view.arrangeGrid, (v) => { state.view.arrangeGrid = +v; }, { 'aria-label': 'Raster voor clips', title: 'Raster voor het verplaatsen van clips (Shift tijdens slepen = 1/16)' }),
      h('span.zoom', { title: 'In- en uitzoomen (ook met Ctrl + scrollwiel)' },
        h('button.tbtn', { onclick: zoomBy(1 / 1.4), 'aria-label': 'Uitzoomen' }, '−'),
        h('button.tbtn', { onclick: zoomBy(1.4), 'aria-label': 'Inzoomen' }, '+')));
    return h('div.arr-row.ruler-row', {}, corner, marks);
  }

  function rulerDrag(e) {
    const start = snap(Math.max(0, beatAt(e.clientX)), 1);
    const x0 = e.clientX;
    let g = null;
    const move = (ev) => {
      if (!g && Math.abs(ev.clientX - x0) < 4) return;
      g ||= gesture();
      const unit = ev.shiftKey ? 1 : BEATS_PER_BAR;
      const b = snap(Math.max(0, beatAt(ev.clientX)), unit);
      const s = snap(start, unit);
      g.update((p) => {
        p.loop.start = Math.min(s, b);
        p.loop.end = Math.max(s, b) === Math.min(s, b) ? Math.min(s, b) + unit : Math.max(s, b);
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

  function trackRow(track, index) {
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
    const mL = h('div.vbar', {}, h('i')), mR = h('div.vbar', {}, h('i'));
    meters.set(track.id, [mL.firstChild, mR.firstChild]);
    const header = h('div.arr-header', { class: sel ? 'selected' : null, style: { '--tc': track.color }, onpointerdown: () => select(track.id, null) },
      h('span.th-num', {}, String(index + 1).padStart(2, '0')),
      h('div.th-main', {},
        h('div.th-top', {}, name, h('span.tkind', {}, KIND_TAG[track.kind])),
        h('div.th-ctrl', {},
          btn('M', 'mute', 'Dempen'), btn('S', 'solo', 'Solo'), btn('●', 'arm', 'Opname aan voor dit spoor'),
          param({ label: 'Volume', min: -60, max: 6, step: 0.5, def: -6, get: () => track.volume, set: (v) => { track.volume = v; }, format: (v) => (v <= -60 ? '-∞' : `${v.toFixed(1)}`) }))),
      h('div.th-meter', { title: 'Niveau links en rechts' }, mL, mR));

    const lane = h('div.lane', { dataset: { track: track.id }, style: { '--tc': track.color } });
    for (const clip of track.clips) lane.append(clipEl(track, clip));
    lane.addEventListener('pointerdown', (e) => lanePointer(e, track));
    lane.addEventListener('dblclick', (e) => laneDouble(e, track));
    lane.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes(PULSE) || (track.kind === 'audio' && t.includes('Files'))) { e.preventDefault(); lane.classList.add('drop'); }
    });
    lane.addEventListener('dragleave', () => lane.classList.remove('drop'));
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      lane.classList.remove('drop');
      const beat = snapFloor(Math.max(0, beatAt(e.clientX)), state.view.arrangeGrid);
      const data = e.dataTransfer.getData(PULSE);
      if (data) { app.dropItem(JSON.parse(data), { trackId: track.id, beat }); return; }
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('audio') || /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i.test(f.name));
      if (file) app.importAudio(file, track.id, beat);
    });
    return h('div.arr-row.track-row', { class: sel ? 'selected' : null, dataset: { id: track.id } }, header, lane);
  }

  function clipEl(track, clip) {
    const w = Math.max(4, clip.length * z());
    const cv = h('canvas.clip-cv', { width: Math.min(8000, Math.ceil(w * (window.devicePixelRatio || 1))), height: 46 * (window.devicePixelRatio || 1) });
    const reps = track.kind !== 'audio' && patternOf(clip) < clip.length ? `×${Math.ceil(clip.length / patternOf(clip))}` : '';
    const el = h('div.clip', {
      class: [state.sel.clipId === clip.id ? 'selected' : null, audible(track) ? null : 'muted'].filter(Boolean).join(' ') || null,
      dataset: { clip: clip.id },
      style: { left: `${clip.start * z()}px`, width: `${w}px`, '--tc': track.color },
      title: 'Sleep om te verplaatsen, sleep de rechterrand voor de lengte, Alt+slepen kopieert, dubbelklik opent de editor',
    }, h('span.clip-name', {}, clip.name || (track.kind === 'audio' ? 'Audio' : 'Clip'), reps ? h('span.rep', {}, reps) : null), cv, h('span.clip-handle'));
    if (track.kind === 'audio') {
      el.append(
        h('span.fade-h', { dataset: { fade: 'in' }, style: { left: `${Math.max(2, (clip.fadeIn || 0) * z() - 4)}px` }, title: 'Fade in: sleep naar rechts' }),
        h('span.fade-h', { dataset: { fade: 'out' }, style: { right: `${Math.max(2, (clip.fadeOut || 0) * z() - 4)}px` }, title: 'Fade uit: sleep naar links' }));
    }
    requestAnimationFrame(() => drawClip(cv, track, clip));
    return el;
  }

  function drawClip(cv, track, clip) {
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const dpr = window.devicePixelRatio || 1;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255, 255, 255, 0.88)';
    if (track.kind === 'audio') {
      const peaks = app.peaks.get(clip.audioId);
      const buf = app.buffers.get(clip.audioId);
      if (!peaks || !buf) return;
      const spb = 60 / state.project.bpm;
      const secPerPx = (clip.length * spb) / W;
      const step = Math.max(2, Math.round(3 * dpr)), bw = Math.max(1, step - Math.round(dpr));
      for (let x = 0; x < W; x += step) {
        const sec = (clip.offset || 0) + x * secPerPx;
        if (sec >= buf.duration) break;
        const v = peaks[Math.floor((sec / buf.duration) * peaks.length)] * (clip.gain ?? 1);
        const hh = Math.max(dpr, Math.min(1, v) * (H - 6 * dpr));
        g.fillRect(x, (H - hh) / 2, bw, hh);
      }
      // Fades: het deel boven de fadelijn donker maken.
      const pxPerBeat = W / clip.length;
      const fi = (clip.fadeIn || 0) * pxPerBeat, fo = (clip.fadeOut || 0) * pxPerBeat;
      g.fillStyle = 'rgba(8, 8, 10, 0.55)';
      g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      g.lineWidth = dpr;
      if (fi > 1) { g.beginPath(); g.moveTo(0, 0); g.lineTo(fi, 0); g.lineTo(0, H); g.closePath(); g.fill(); g.beginPath(); g.moveTo(0, H); g.lineTo(fi, 0); g.stroke(); }
      if (fo > 1) { g.beginPath(); g.moveTo(W, 0); g.lineTo(W - fo, 0); g.lineTo(W, H); g.closePath(); g.fill(); g.beginPath(); g.moveTo(W - fo, 0); g.lineTo(W, H); g.stroke(); }
      return;
    }
    if (!clip.notes.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const n of clip.notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    const range = Math.max(10, hi - lo + 1);
    const rowH = (H - 6 * dpr) / range;
    const pl = patternOf(clip);
    const pxb = W / clip.length;
    for (let k = 0; k * pl < clip.length; k++) {
      if (k > 0) { g.fillStyle = 'rgba(0, 0, 0, 0.3)'; g.fillRect(k * pl * pxb, 0, dpr, H); g.fillStyle = 'rgba(255, 255, 255, 0.88)'; }
      for (const n of clip.notes) {
        if (n.t >= pl) continue;
        const x = (k * pl + n.t) * pxb;
        if (x >= W) continue;
        const y = 3 * dpr + (hi - n.p + (range - (hi - lo + 1)) / 2) * rowH;
        const w = Math.max(2 * dpr, Math.min(n.d, pl - n.t) * pxb - dpr);
        g.globalAlpha = 0.55 + 0.45 * n.v;
        g.beginPath();
        g.roundRect ? g.roundRect(x, y, w, Math.max(2 * dpr, rowH - dpr), dpr) : g.rect(x, y, w, Math.max(2 * dpr, rowH - dpr));
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function lanePointer(e, track) {
    if (e.button !== 0) return;
    const clipNode = e.target.closest('.clip');
    if (!clipNode) { select(track.id, null); return; }
    const clip = findClip(clipNode.dataset.clip);
    select(track.id, clip.id);
    const fade = e.target.dataset?.fade;
    const x0 = e.clientX, y0 = e.clientY;
    let g = null;
    if (fade) {
      e.stopPropagation();
      const orig = fade === 'in' ? clip.fadeIn || 0 : clip.fadeOut || 0;
      const move = (ev) => {
        g ||= gesture();
        const d = ((ev.clientX - x0) / z()) * (fade === 'in' ? 1 : -1);
        const v = clamp(Math.round((orig + d) * 16) / 16, 0, clip.length - (fade === 'in' ? clip.fadeOut || 0 : clip.fadeIn || 0));
        g.update(() => { if (fade === 'in') clip.fadeIn = v; else clip.fadeOut = v; }, 'arrange');
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); g?.end('all'); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    const rect = clipNode.getBoundingClientRect();
    const resize = e.clientX > rect.right - 8;
    const orig = { start: clip.start, length: clip.length };
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
    if (clipNode) { select(track.id, clipNode.dataset.clip); app.showPanel(track.kind === 'audio' ? 'sound' : 'editor'); return; }
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
    }, icon('plus', 13), label);
    const lane = h('div.lane.empty');
    const row = h('div.arr-row.add-row', {}, h('div.arr-header.add', {}, add('synth', 'Synth'), add('drums', 'Drums'), add('sampler', 'Sampler'), add('audio', 'Audio')), lane);
    row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(PULSE) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); lane.classList.add('drop'); } });
    row.addEventListener('dragleave', () => lane.classList.remove('drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      lane.classList.remove('drop');
      const beat = snapFloor(Math.max(0, beatAt(e.clientX)), state.view.arrangeGrid);
      const data = e.dataTransfer.getData(PULSE);
      if (data) { app.dropItem(JSON.parse(data), { trackId: null, beat }); return; }
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('audio') || /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i.test(f.name));
      if (file) app.importAudio(file, null, beat);
    });
    return row;
  }

  function setPlayhead(beat) {
    playhead.style.transform = `translateX(${HEADER_W + beat * z()}px)`;
    phHandle.style.transform = `translateX(${beat * z()}px)`;
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

  const level = (peak) => clamp((20 * Math.log10(Math.max(peak, 1e-4)) + 60) / 66, 0, 1);
  function updateMeters(m) {
    for (const [id, [l, r]] of meters) {
      const v = m.tracks.get(id) || [0, 0];
      l.style.transform = `scaleY(${level(v[0])})`;
      r.style.transform = `scaleY(${level(v[1])})`;
    }
  }

  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const before = beatAt(e.clientX);
    state.view.zoom = clamp(Math.round(z() * (e.deltaY < 0 ? 1.15 : 1 / 1.15)), 6, 140);
    app.emit('view');
    scroll.scrollLeft += (before * z() + HEADER_W) - (e.clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft);
  }, { passive: false });

  return { el: scroll, render, setPlayhead, follow, updateSelection, updateMeters };
}
