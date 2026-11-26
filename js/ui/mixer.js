// Mixer: kanaalstroken met inserts, panknop, dB-schaal, stereometers met piekvasthouden en fader; plus een spectrumanalyser.
import { state, commit, gesture, select } from '../state.js';
import { gainToDb, clamp, createReturn } from '../model.js';
import { PLUGIN_DEFS, createInsert } from '../audio/plugin-defs.js';
import { h } from './dom.js';
import { knob } from './knob.js';

const SCALE = [6, 0, -6, -12, -24, -36, -60];
const frac = (db) => clamp((db + 60) / 66, 0, 1);
const dbText = (v) => (v <= -60 ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
const panText = (v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
const KIND_TAG = { synth: 'Synth', drums: 'Drums', sampler: 'Sampler', audio: 'Audio', plugin: 'Plug-in' };

export function createMixer(app) {
  const root = h('div.mixer');
  const meters = new Map();
  const held = new Map();
  const spec = h('canvas');
  const analyzer = h('div.mix-analyzer', {}, h('div.screen', { style: { flex: '1' } }, spec, h('span.screen-lbl', {}, 'Spectrum master')));
  let specData = null;

  function fader(get, set) {
    const input = h('input', { type: 'range', min: -60, max: 6, step: 0.5, 'aria-label': 'Volume' });
    input.value = get();
    let g = null;
    input.addEventListener('input', () => { g ||= gesture(); const v = +input.value; g.update(() => set(v), 'params'); input.closest('.strip')?.querySelector('.rd-vol')?.replaceChildren(dbText(v)); });
    input.addEventListener('change', () => { g?.end('params'); g = null; });
    input.addEventListener('dblclick', () => { const gg = gesture(); gg.update(() => set(0), 'params'); gg.end('params'); input.value = 0; });
    return h('div.fader', { title: 'Volume (dubbelklik = 0 dB)' }, input);
  }

  function meterPair(id) {
    const l = h('div.vbar', {}, h('i'), h('b')), r = h('div.vbar', {}, h('i'), h('b'));
    const peakEl = h('span.rd-peak', {}, '-∞');
    meters.set(id, { l, r, peakEl });
    return [h('div.meters', {}, l, r), peakEl];
  }

  function scale() {
    return h('div.scale', {}, SCALE.map((db) => h('span', { style: { bottom: `${frac(db) * 100}%` } }, db > 0 ? `+${db}` : db)));
  }

  function insertList(inserts, open) {
    const nameOf = (ins) => (ins.type === 'wam' ? ins.wam.name : PLUGIN_DEFS[ins.type].name);
    const shown = inserts.slice(0, 5).map((ins) => h('button.ins', { class: ins.on ? 'on' : null, onclick: open, title: `${nameOf(ins)} (klik om te openen)` }, h('i'), nameOf(ins)));
    if (inserts.length > 5) shown.push(h('button.ins.empty', { onclick: open }, `+${inserts.length - 5} meer`));
    if (!inserts.length) shown.push(h('button.ins.empty', { onclick: open }, '+ effect'));
    return h('div.inserts', {}, shown);
  }

  function strip(track) {
    const [meterEl, peakEl] = meterPair(track.id);
    const btn = (label, key, title) => h('button.tbtn', {
      class: track[key] ? `on ${key}` : null, title, 'aria-pressed': String(!!track[key]),
      onclick: () => commit(() => { track[key] = !track[key]; }),
    }, label);
    const open = () => { select(track.id, state.sel.clipId); app.showPanel('sound'); };
    return h('div.strip', {
      class: state.sel.trackId === track.id ? 'selected' : null,
      style: { '--tc': track.color },
      onpointerdown: (e) => { if (!e.target.closest('button, input, .knob')) select(track.id, state.sel.clipId); },
      dataset: { id: track.id },
    },
    h('div.strip-name', { title: track.name }, h('span', {}, track.name), h('span.tkind', {}, KIND_TAG[track.kind])),
    insertList(track.inserts, open),
    sendKnobs(track),
    knob({ label: 'Pan', min: -1, max: 1, step: 0.01, def: 0, small: true, size: 34, get: () => track.pan, set: (v) => { track.pan = v; }, format: panText }),
    h('div.strip-fader', {}, scale(), meterEl, fader(() => track.volume, (v) => { track.volume = v; })),
    h('div.readouts', {}, peakEl, h('span.rd-vol', {}, dbText(track.volume))),
    h('div.strip-btns', {}, btn('M', 'mute', 'Dempen'), btn('S', 'solo', 'Solo'), btn('●', 'arm', 'Opname aan')));
  }

  // Sends: hoeveel van dit spoor (na de fader) naar elke return gaat.
  function sendKnobs(track) {
    const rs = state.project.returns || [];
    if (!rs.length) return null;
    return h('div.sends', {}, rs.map((r) => knob({
      label: r.letter, min: -60, max: 6, step: 0.5, def: -60, small: true, size: 28,
      title: `Send naar return ${r.letter} (${r.name}): sleep omhoog of omlaag, dubbelklik = uit`,
      get: () => track.sends?.[r.id] ?? -60, set: (v) => { track.sends ||= {}; track.sends[r.id] = v; },
      format: (v) => (v <= -60 ? 'uit' : `${Math.round(v)}`),
    })));
  }

  function returnStrip(r) {
    const [meterEl, peakEl] = meterPair(r.id);
    const open = () => app.showReturn(r.id);
    return h('div.strip.ret', { dataset: { ret: r.id } },
      h('div.strip-name', { title: `Return ${r.letter}: ${r.name}` }, h('span', {}, `${r.letter} · ${r.name}`), h('span.tkind', {}, 'Return')),
      insertList(r.inserts, open),
      knob({ label: 'Pan', min: -1, max: 1, step: 0.01, def: 0, small: true, size: 34, get: () => r.pan, set: (v) => { r.pan = v; }, format: panText }),
      h('div.strip-fader', {}, scale(), meterEl, fader(() => r.volume, (v) => { r.volume = v; })),
      h('div.readouts', {}, peakEl, h('span.rd-vol', {}, dbText(r.volume))),
      h('div.strip-btns', {},
        h('button.tbtn', { class: r.mute ? 'on mute' : null, title: 'Dempen', 'aria-pressed': String(!!r.mute), onclick: () => commit(() => { r.mute = !r.mute; }) }, 'M'),
        h('button.tbtn', { onclick: open, title: 'Effecten op deze return' }, 'FX')));
  }

  function addReturn() {
    const p = state.project;
    p.returns ||= [];
    const used = new Set(p.returns.map((r) => r.letter));
    let i = 0;
    while (used.has(String.fromCharCode(65 + i))) i++;
    const r = createReturn(`Return ${String.fromCharCode(65 + i)}`, [createInsert('freeverb', { mix: 1 })], i);
    commit(() => p.returns.push(r));
    app.showReturn(r.id);
  }

  // Luidheid (EBU R128), piek en correlatie van de master.
  const loudEls = {};
  const loudRow = (key, label, tip) => h('div.loud-row', { title: tip }, h('span.lbl', {}, label), (loudEls[key] = h('span.loud-val', {}, '–')));
  const corrBar = h('div.corr', { title: 'Correlatie: +1 is mono, 0 is breed, onder 0 vallen er bij mono-afspelen dingen weg' }, h('i'));
  const loud = h('div.loud', {},
    h('div.loud-head', {}, h('strong', {}, 'Luidheid'), h('button.tbtn', { title: 'Meting opnieuw beginnen', onclick: () => app.engine.loud.reset() }, 'Reset')),
    loudRow('momentary', 'Momentaan', 'LUFS over de laatste 400 ms'),
    loudRow('shortTerm', 'Korte termijn', 'LUFS over de laatste 3 seconden'),
    loudRow('integrated', 'Geïntegreerd', 'LUFS over alles sinds afspelen (met poorten, zoals streamingdiensten meten). Spotify en YouTube: ongeveer -14'),
    loudRow('peak', 'Piek', 'Hoogste samplewaarde sinds afspelen'),
    h('div.loud-row', {}, h('span.lbl', {}, 'Correlatie'), corrBar));
  analyzer.append(loud);
  const fmtL = (v) => (Number.isFinite(v) && v > -70 ? v.toFixed(1) : '–');
  function drawLoudness(engine) {
    if (!loud.isConnected || !engine?.loudness) return;
    const l = engine.loudness();
    loudEls.momentary.textContent = fmtL(l.momentary);
    loudEls.shortTerm.textContent = fmtL(l.shortTerm);
    loudEls.integrated.textContent = `${fmtL(l.integrated)} LUFS`;
    const pk = gainToDb(l.peak);
    loudEls.peak.textContent = l.peak > 0.001 ? `${pk.toFixed(1)} dB` : '–';
    loudEls.peak.classList.toggle('over', pk > -0.1);
    corrBar.firstChild.style.left = `${((clamp(l.corr, -1, 1) + 1) / 2) * 100}%`;
  }

  function render() {
    meters.clear();
    const p = state.project;
    const [meterEl, peakEl] = meterPair('master');
    const master = h('div.strip.master', {},
      h('div.strip-name', {}, h('span', {}, 'Master'), h('span.tkind', {}, 'Uit')),
      insertList(p.masterInserts, () => app.showMaster()),
      h('div', { style: { height: '58px' } }),
      h('div.strip-fader', {}, scale(), meterEl, fader(() => p.masterVolume, (v) => { p.masterVolume = v; })),
      h('div.readouts', {}, peakEl, h('span.rd-vol', {}, dbText(p.masterVolume))),
      h('div.strip-btns', {}, h('button.tbtn', { onclick: () => app.showMaster(), title: 'Effecten op de master' }, 'FX')));
    const addRet = h('button.add-return', { onclick: addReturn, title: 'Nieuw return-spoor (bijvoorbeeld een tweede galm)' }, '+ Return');
    root.replaceChildren(...p.tracks.map(strip), h('span.mix-sep'), ...(p.returns || []).map(returnStrip), addRet, analyzer, master);
  }

  function updateSelection() {
    for (const s of root.querySelectorAll('.strip[data-id]')) s.classList.toggle('selected', s.dataset.id === state.sel.trackId);
  }

  // Meters met piekvasthouden (1,2 s) en een rode waarschuwing boven 0 dB.
  function updateMeters(levels, engine) {
    const now = performance.now();
    const set = (id, pair) => {
      const m = meters.get(id);
      if (!m) return;
      let hd = held.get(id);
      if (!hd) held.set(id, (hd = { l: 0, r: 0, peak: -60, t: 0 }));
      const db = pair.map((x) => gainToDb(x));
      ['l', 'r'].forEach((side, i) => {
        const f = frac(db[i]);
        hd[side] = Math.max(f, hd[side] - 0.02);
        if (m[side].v !== hd[side]) { m[side].v = hd[side]; m[side].firstChild.style.transform = `scaleY(${hd[side]})`; }
      });
      const top = Math.max(...db);
      if (top > hd.peak || now - hd.t > 1200) { hd.peak = Math.max(top, now - hd.t > 1200 ? top : hd.peak); hd.t = now; }
      if (m.peak !== hd.peak) {
        m.peak = hd.peak;
        for (const side of ['l', 'r']) m[side].lastChild.style.bottom = `${frac(hd.peak) * 100}%`;
        m.peakEl.textContent = dbText(hd.peak);
        m.peakEl.classList.toggle('over', hd.peak > -0.1);
      }
    };
    set('master', levels.master);
    for (const [id, pair] of levels.tracks) set(id, pair);
    drawSpectrum(engine);
    drawLoudness(engine);
  }

  function drawSpectrum(engine) {
    if (!spec.isConnected || !engine?.ctx) return;
    const W = spec.clientWidth, H = spec.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (spec.width !== Math.round(W * dpr) || spec.height !== Math.round(H * dpr)) { spec.width = Math.round(W * dpr); spec.height = Math.round(H * dpr); }
    const g = spec.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    specData ||= new Float32Array(2048);
    if (!engine.spectrum(specData)) return;
    const sr = engine.ctx.sampleRate, bins = specData.length;
    const fxp = (f) => (W * Math.log10(f / 20)) / 3;
    g.font = '500 10px "Archivo Narrow", sans-serif';
    g.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      g.fillStyle = 'rgba(255, 255, 255, 0.06)';
      g.fillRect(Math.round(fxp(f)), 0, 1, H);
      g.fillStyle = 'rgba(255, 255, 255, 0.4)';
      g.fillText(f >= 1000 ? `${f / 1000}k` : f, fxp(f) + 3, H - 5);
    }
    const bands = Math.max(24, Math.floor(W / 7));
    g.fillStyle = 'rgba(242, 154, 46, 0.85)';
    for (let b = 0; b < bands; b++) {
      const f0 = 20 * 1000 ** (b / bands), f1 = 20 * 1000 ** ((b + 1) / bands);
      const i0 = Math.max(1, Math.floor((f0 / (sr / 2)) * bins)), i1 = Math.max(i0 + 1, Math.ceil((f1 / (sr / 2)) * bins));
      let max = -140;
      for (let i = i0; i < i1 && i < bins; i++) max = Math.max(max, specData[i]);
      const v = clamp((max + 90) / 80, 0, 1);
      const x = (b / bands) * W, w = W / bands - 2;
      const hh = v * (H - 30);
      g.fillRect(x + 1, H - 16 - hh, w, hh);
    }
  }

  return { el: root, render, updateSelection, updateMeters };
}
