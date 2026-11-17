// Mixer: één kanaalstrook per spoor plus de master, met meters.
import { state, commit, select } from '../state.js';
import { gainToDb, clamp } from '../model.js';
import { h, param } from './dom.js';

const dbText = (v) => (v <= -60 ? '-∞ dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`);
const panText = (v) => (Math.abs(v) < 0.01 ? 'Midden' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`);

export function createMixer(app) {
  const root = h('div.mixer');
  const meters = new Map();
  const held = new Map();

  function strip(track) {
    const meter = h('div.meter', {}, h('div.meter-fill'));
    meters.set(track.id, meter);
    const btn = (label, key, title) => h('button.tbtn', {
      class: track[key] ? `on ${key}` : null, title, 'aria-pressed': String(!!track[key]),
      onclick: () => commit(() => { track[key] = !track[key]; }),
    }, label);
    return h('div.strip', {
      class: state.sel.trackId === track.id ? 'selected' : null,
      style: { '--tc': track.color },
      onpointerdown: () => select(track.id, state.sel.clipId),
      dataset: { id: track.id },
    },
    h('div.strip-name', { title: track.name }, track.name),
    param({ label: 'Pan', min: -1, max: 1, step: 0.01, def: 0, get: () => track.pan, set: (v) => { track.pan = v; }, format: panText }),
    h('div.strip-fader', {},
      meter,
      param({ label: 'Volume', min: -60, max: 6, step: 0.5, def: -6, vertical: true, get: () => track.volume, set: (v) => { track.volume = v; }, format: dbText })),
    h('div.strip-btns', {}, btn('M', 'mute', 'Dempen'), btn('S', 'solo', 'Solo')));
  }

  function render() {
    meters.clear();
    const p = state.project;
    const masterMeter = h('div.meter', {}, h('div.meter-fill'));
    meters.set('master', masterMeter);
    const master = h('div.strip.master', {},
      h('div.strip-name', {}, 'Master'),
      h('div.strip-spacer'),
      h('div.strip-fader', {},
        masterMeter,
        param({ label: 'Volume', min: -60, max: 6, step: 0.5, def: 0, vertical: true, get: () => p.masterVolume, set: (v) => { p.masterVolume = v; }, format: dbText })),
      h('div.strip-btns', {}, h('button.tbtn', { onclick: () => app.showMaster(), title: 'Effecten op de master bewerken' }, 'FX')));
    root.replaceChildren(...p.tracks.map(strip), master);
  }

  function updateSelection() {
    for (const s of root.querySelectorAll('.strip[data-id]')) s.classList.toggle('selected', s.dataset.id === state.sel.trackId);
  }

  // Meters met een korte nagloei, zodat pieken leesbaar blijven.
  function updateMeters(levels) {
    const set = (id, peak) => {
      const el = meters.get(id);
      if (!el) return;
      const pct = clamp((gainToDb(peak) + 60) / 66, 0, 1);
      const prev = held.get(id) || 0;
      const v = Math.max(pct, prev - 0.025);
      held.set(id, v);
      el.firstChild.style.transform = `scaleY(${v})`;
      el.classList.toggle('clip', peak >= 0.99);
    };
    set('master', levels.master);
    for (const [id, peak] of levels.tracks) set(id, peak);
  }

  return { el: root, render, updateSelection, updateMeters };
}
