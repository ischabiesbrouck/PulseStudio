// Klankpaneel: instrument (synth, drums, sampler, audio) en effectenrack van het geselecteerde spoor, of van de master.
import { state, commit, emit, select as selectTrack, selectedTrack } from '../state.js';
import { SYNTH_PRESETS, BASE_SYNTH, TRACK_COLORS, DRUM_ROWS, defaultSynth, noteName } from '../model.js';
import { PLUGIN_DEFS, createInsert, formatParam } from '../audio/plugin-defs.js';
import { DRUM_KITS } from '../audio/instruments.js';
import { h, param, select } from './dom.js';

const WAVES = [['sine', 'Sinus'], ['triangle', 'Driehoek'], ['sawtooth', 'Zaagtand'], ['square', 'Blok']];
const ms = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const pct = (v) => `${Math.round(v * 100)}%`;
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v < 10 ? v.toFixed(2) : Math.round(v)} Hz`);
const st = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} st`;
const ct = (v) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`;

const collapsed = new Set();

function section(title, ...children) {
  return h('section.insp-sec', {}, h('h3', {}, title), ...children);
}

function toggle(label, get, set) {
  const input = h('input', { type: 'checkbox', checked: get() });
  input.addEventListener('change', () => commit(() => set(input.checked), 'params'));
  return h('label.toggle', {}, input, h('span', {}, label));
}

function field(label, control) { return h('label.field', {}, h('span', {}, label), control); }

export function createInspector(app) {
  const root = h('div.inspector');

  function render() {
    const p = state.project;
    const track = selectedTrack();
    const master = state.view.inspectMaster || !track;
    const tabs = h('div.seg', { role: 'tablist' },
      h('button.seg-btn', { 'aria-selected': String(!master), disabled: !track, onclick: () => { state.view.inspectMaster = false; emit('panel'); } }, track ? `Spoor: ${track.name}` : 'Geen spoor'),
      h('button.seg-btn', { 'aria-selected': String(master), onclick: () => { state.view.inspectMaster = true; emit('panel'); } }, 'Master'));

    if (master) {
      root.replaceChildren(h('div.insp-head', {}, tabs),
        h('div.insp-body', {},
          h('div.insp-inst', {}, section('Master',
            h('p.hint', {}, 'Alles wat je hoort gaat door de master. Standaard staan hier een lichte "lijm"-compressor en een limiter, zodat je mix voller klinkt en nooit vervormt.'),
            param({ label: 'Volume', min: -60, max: 6, step: 0.5, def: 0, get: () => p.masterVolume, set: (v) => { p.masterVolume = v; }, format: (v) => `${v.toFixed(1)} dB` }))),
          rack(p.masterInserts, 'Effecten op de master')));
      return;
    }

    const name = h('input.track-name-input', { value: track.name, 'aria-label': 'Naam van het spoor' });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) commit(() => { track.name = v; }); });
    const colors = h('div.swatches', {}, TRACK_COLORS.map((c) => h('button.swatch', {
      style: { background: c }, class: c === track.color ? 'on' : null, 'aria-label': `Kleur ${c}`,
      onclick: () => commit(() => { track.color = c; }),
    })));
    const remove = h('button.btn.danger', {
      onclick: () => {
        if (track.clips.length && !confirm(`Spoor "${track.name}" met ${track.clips.length} clip(s) verwijderen?`)) return;
        const i = p.tracks.indexOf(track);
        commit(() => p.tracks.splice(i, 1));
        selectTrack(p.tracks[Math.min(i, p.tracks.length - 1)]?.id || null, null);
      },
    }, 'Spoor verwijderen');
    const head = h('div.insp-head', { style: { '--tc': track.color } }, tabs, name, colors, remove);
    root.replaceChildren(head, h('div.insp-body', {}, instrument(track), rack(track.inserts, 'Effecten')));
  }

  // ---------- Instrumenten ----------

  function instrument(track) {
    if (track.kind === 'synth') return synthUI(track);
    if (track.kind === 'drums') return drumsUI(track);
    if (track.kind === 'sampler') return samplerUI(track);
    return h('div.insp-inst', {},
      section('Audio',
        h('p.hint', {}, 'Neem op via de microfoon: zet opname aan (●) op dit spoor en druk op de opnameknop. Je kunt ook een audiobestand op het spoor slepen, of iets uit de Bibliotheek toevoegen.'),
        h('div.row', {},
          h('button.btn', { onclick: () => app.pickAudio(track.id, null) }, 'Audiobestand kiezen…'),
          h('button.btn', { onclick: () => app.showPanel('library') }, 'Naar de bibliotheek'))));
  }

  function synthUI(track) {
    const s = track.synth;
    const preset = { ...BASE_SYNTH, ...SYNTH_PRESETS[s.preset] };
    const sp = (label, key, min, max, step, format, curve) => param({ label, min, max, step, format, curve, def: preset[key], get: () => s[key], set: (v) => { s[key] = v; } });
    const sel = (label, key, options, numeric = false) => field(label, select(options, s[key], (v) => commit(() => { s[key] = numeric ? +v : v; }, 'params')));

    const presetSel = h('select', { 'aria-label': 'Preset' });
    const cats = {};
    for (const [n, def] of Object.entries(SYNTH_PRESETS)) (cats[def.cat] ||= []).push(n);
    for (const [cat, names] of Object.entries(cats)) presetSel.append(h('optgroup', { label: cat }, names.map((n) => h('option', { value: n }, n))));
    presetSel.value = s.preset;
    presetSel.addEventListener('change', () => commit(() => { track.synth = defaultSynth(presetSel.value); }));
    const step = (dir) => {
      const names = Object.keys(SYNTH_PRESETS);
      const next = names[(names.indexOf(s.preset) + dir + names.length) % names.length];
      commit(() => { track.synth = defaultSynth(next); });
      app.audition(track, 60, 0.8);
    };

    return h('div.insp-inst', {},
      section('Preset',
        h('div.row', {}, presetSel,
          h('button.tbtn', { onclick: () => step(-1), 'aria-label': 'Vorige preset' }, '‹'),
          h('button.tbtn', { onclick: () => step(1), 'aria-label': 'Volgende preset' }, '›'),
          h('button.btn', { onclick: () => app.audition(track, 60, 0.8) }, 'Luister')),
        h('p.hint', {}, 'Speel op je toetsenbord: A W S E D F T G Y H U J K, met Z en X voor een octaaf lager of hoger. Een MIDI-keyboard werkt ook.')),
      h('div.insp-grid', {},
        section('Oscillator 1',
          sel('Golfvorm', 'wave1', WAVES),
          sp('Unison', 'unison', 1, 7, 1, (v) => `${Math.round(v)} stemmen`),
          sp('Ontstemming', 'uniDetune', 0, 80, 0.5, ct),
          sp('Stereo', 'uniSpread', 0, 1, 0.01, pct)),
        section('Oscillator 2',
          sel('Golfvorm', 'wave2', WAVES),
          sel('Octaaf', 'osc2Oct', [[-2, '−2'], [-1, '−1'], [0, '0'], [1, '+1'], [2, '+2']], true),
          sp('Halve tonen', 'osc2Semi', -12, 12, 1, st),
          sp('Fijn', 'detune', -50, 50, 0.5, ct),
          sp('Mix', 'mix', 0, 1, 0.01, pct)),
        section('FM, sub en ruis',
          sp('FM', 'fm', 0, 1.5, 0.01, pct),
          sp('FM-verval', 'fmDecay', 0.01, 4, 0.01, ms, 'exp'),
          sp('FM-rest', 'fmSustain', 0, 1, 0.01, pct),
          sp('Sub', 'sub', 0, 1, 0.01, pct),
          sp('Ruis', 'noise', 0, 1, 0.01, pct)),
        section('Filter',
          sel('Type', 'filterType', [['lowpass', 'Laagdoorlaat'], ['highpass', 'Hoogdoorlaat'], ['bandpass', 'Banddoorlaat']]),
          sel('Helling', 'slope', [[12, '12 dB/oct'], [24, '24 dB/oct']], true),
          sp('Afsnijding', 'cutoff', 40, 16000, 1, hz, 'exp'),
          sp('Resonantie', 'reso', 0.1, 20, 0.1, (v) => v.toFixed(1)),
          sp('Keytracking', 'keyTrack', 0, 1, 0.01, pct),
          sp('Drive', 'drive', 0, 1, 0.01, pct)),
        section('Filter-envelope',
          sp('Hoeveelheid', 'envAmt', 0, 8000, 10, hz),
          sp('Attack', 'fAttack', 0.001, 3, 0.001, ms, 'exp'),
          sp('Decay', 'fDecay', 0.01, 4, 0.01, ms, 'exp'),
          sp('Sustain', 'fSustain', 0, 1, 0.01, pct)),
        section('Volume-envelope',
          sp('Attack', 'attack', 0.001, 3, 0.001, ms, 'exp'),
          sp('Decay', 'decay', 0.01, 4, 0.01, ms, 'exp'),
          sp('Sustain', 'sustain', 0, 1, 0.01, pct),
          sp('Release', 'release', 0.01, 5, 0.01, ms, 'exp'),
          sp('Volume', 'gain', 0, 1, 0.01, pct)),
        section('LFO',
          sel('Doel', 'lfoTarget', [['pitch', 'Toonhoogte (vibrato)'], ['filter', 'Filter'], ['amp', 'Volume (tremolo)']]),
          sel('Golfvorm', 'lfoWave', WAVES),
          sp('Snelheid', 'lfoRate', 0.05, 20, 0.01, hz, 'exp'),
          sp('Hoeveelheid', 'lfoAmount', 0, 1, 0.01, pct))));
  }

  function drumsUI(track) {
    const k = track.drums;
    const pad = (p) => k.pads[p] || {};
    const padParam = (p, key, label, min, max, step, format, def) => param({
      label, min, max, step, def, format, get: () => pad(p)[key] ?? def, set: (v) => { (k.pads[p] ||= {})[key] = v; },
    });
    const rows = DRUM_ROWS.map(({ p, name }) => {
      const pd = pad(p);
      const sample = pd.audioId
        ? h('span.pad-sample', { title: pd.sampleName || 'Eigen sample' }, pd.sampleName || 'Sample',
          h('button.tbtn', { 'aria-label': `Sample van ${name} weghalen`, onclick: () => commit(() => { delete k.pads[p].audioId; delete k.pads[p].sampleName; }, 'all') }, '✕'))
        : h('button.btn.small', {
          onclick: async () => {
            const res = await app.pickSample();
            if (res) commit(() => { k.pads[p] = { ...pad(p), audioId: res.id, sampleName: res.name }; }, 'all');
          },
        }, 'Sample…');
      return h('div.pad-row', {},
        h('button.pad-name', { onclick: () => app.audition(track, p, 0.9), title: 'Klik om te horen' }, name),
        padParam(p, 'level', 'Volume', 0, 1.5, 0.01, pct, 1),
        padParam(p, 'tune', 'Stemming', -12, 12, 0.5, st, 0),
        padParam(p, 'decay', 'Lengte', 0.2, 2.5, 0.01, pct, 1),
        sample);
    });
    return h('div.insp-inst', {},
      section('Drumcomputer',
        field('Kit', select(Object.entries(DRUM_KITS).map(([id, d]) => [id, d.name]), k.kit, (v) => { commit(() => { k.kit = v; }, 'params'); app.audition(track, 36, 0.9); })),
        param({ label: 'Stemming', min: -12, max: 12, step: 0.5, def: 0, get: () => k.tune, set: (v) => { k.tune = v; }, format: st }),
        param({ label: 'Uitklinken', min: 0.3, max: 2.5, step: 0.01, def: 1, get: () => k.decay, set: (v) => { k.decay = v; }, format: pct }),
        param({ label: 'Volume', min: 0, max: 1, step: 0.01, def: 0.9, get: () => k.level, set: (v) => { k.level = v; }, format: pct }),
        h('p.hint', {}, 'Speel live met A W S E D F T G Y H U J (kick, snare, clap, rimshot, hihats, toms, crash, ride, cowbell, shaker). Elke pad kan ook een eigen sample krijgen.')),
      section('Pads', h('div.pads', {},
        h('div.pad-row.pad-head', {}, h('span', {}, 'Klik om te horen'), h('span', {}, 'Volume'), h('span', {}, 'Stemming'), h('span', {}, 'Lengte'), h('span', {}, 'Eigen sample')),
        rows)));
  }

  function samplerUI(track) {
    const s = track.sampler;
    const sp = (label, key, min, max, step, format, def, curve) => param({ label, min, max, step, format, def, curve, get: () => s[key], set: (v) => { s[key] = v; } });
    const roots = [];
    for (let n = 24; n <= 96; n++) roots.push([n, noteName(n)]);
    const wave = h('canvas.sample-wave', { width: 600, height: 70 });
    requestAnimationFrame(() => drawSample(wave, s));
    return h('div.insp-inst', {},
      section('Sample',
        h('div.row', {},
          h('strong.sample-name', {}, s.audioId ? (s.sampleName || 'Sample') : 'Nog geen sample'),
          h('button.btn', {
            onclick: async () => {
              const res = await app.pickSample();
              if (res) commit(() => { s.audioId = res.id; s.sampleName = res.name; });
            },
          }, 'Bestand kiezen…'),
          h('button.btn', { onclick: () => app.showPanel('library') }, 'Uit de bibliotheek'),
          h('button.btn', { onclick: () => app.audition(track, s.root, 0.85) }, 'Luister')),
        wave,
        h('p.hint', {}, 'De sampler speelt het geluid chromatisch af over het hele toetsenbord. Kies de grondtoon waarop het sample is opgenomen.')),
      h('div.insp-grid', {},
        section('Toon',
          field('Grondtoon', select(roots, s.root, (v) => commit(() => { s.root = +v; }, 'params'))),
          sp('Fijnstemming', 'fine', -100, 100, 1, ct, 0),
          sp('Begin', 'start', 0, 0.95, 0.005, pct, 0),
          toggle('Loop (aanhouden)', () => s.loop, (v) => { s.loop = v; }),
          sp('Loop begin', 'loopStart', 0, 0.98, 0.005, pct, 0.3),
          sp('Loop eind', 'loopEnd', 0.02, 1, 0.005, pct, 0.9)),
        section('Envelope en filter',
          sp('Attack', 'attack', 0.001, 3, 0.001, ms, 0.003, 'exp'),
          sp('Decay', 'decay', 0.01, 4, 0.01, ms, 0.5, 'exp'),
          sp('Sustain', 'sustain', 0, 1, 0.01, pct, 1),
          sp('Release', 'release', 0.01, 5, 0.01, ms, 0.3, 'exp'),
          sp('Filter', 'cutoff', 80, 18000, 1, hz, 18000, 'exp'),
          sp('Volume', 'gain', 0, 1.5, 0.01, pct, 0.8))));
  }

  function drawSample(cv, s) {
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const peaks = app.peaks.get(s.audioId);
    if (!peaks) return;
    g.fillStyle = 'rgba(242,163,58,0.85)';
    for (let x = 0; x < W; x++) {
      const v = peaks[Math.floor((x / W) * peaks.length)];
      const hh = Math.max(1, v * H * 0.95);
      g.fillRect(x, (H - hh) / 2, 1, hh);
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(s.start * W, 0, 2, H);
    if (s.loop) {
      g.fillStyle = 'rgba(90,169,230,0.25)';
      g.fillRect(s.loopStart * W, 0, (s.loopEnd - s.loopStart) * W, H);
    }
  }

  // ---------- Effectenrack ----------

  function rack(inserts, title) {
    const add = h('select.add-fx', { 'aria-label': 'Effect toevoegen' },
      h('option', { value: '' }, '+ Effect toevoegen'),
      Object.entries(PLUGIN_DEFS).map(([type, d]) => h('option', { value: type }, d.name)));
    add.addEventListener('change', () => {
      if (!add.value) return;
      commit(() => inserts.push(createInsert(add.value)));
    });
    const plugs = inserts.map((ins, i) => plugin(inserts, ins, i));
    return h('div.insp-fx', {},
      h('div.rack-head', {}, h('h3', {}, title), add),
      plugs.length ? h('div.rack', {}, plugs) : h('p.hint', {}, 'Nog geen effecten. Kies er een uit de lijst: EQ, compressor, verzadiging, lo-fi, chorus, phaser, delay, galm, autofilter, tremolo, pomp (sidechain), stereobreedte of limiter.'));
  }

  function plugin(inserts, ins, i) {
    const def = PLUGIN_DEFS[ins.type];
    const open = !collapsed.has(ins.id);
    const on = h('input', { type: 'checkbox', checked: ins.on, 'aria-label': `${def.name} aan/uit` });
    on.addEventListener('change', () => commit(() => { ins.on = on.checked; }, 'params'));
    const move = (d) => commit(() => { inserts.splice(i, 1); inserts.splice(i + d, 0, ins); });
    const head = h('div.plug-head', {},
      on,
      h('button.plug-title', { onclick: () => { if (open) collapsed.add(ins.id); else collapsed.delete(ins.id); render(); }, 'aria-expanded': String(open), title: def.info }, def.name),
      h('button.tbtn', { disabled: i === 0, onclick: () => move(-1), 'aria-label': 'Omhoog' }, '↑'),
      h('button.tbtn', { disabled: i === inserts.length - 1, onclick: () => move(1), 'aria-label': 'Omlaag' }, '↓'),
      h('button.tbtn', { onclick: () => commit(() => inserts.splice(i, 1)), 'aria-label': `${def.name} verwijderen` }, '✕'));
    const controls = Object.entries(def.params).map(([key, pd]) => {
      if (pd.type === 'toggle') return toggle(pd.label, () => ins.params[key], (v) => { ins.params[key] = v; });
      if (pd.type === 'select') {
        const numeric = typeof pd.def === 'number';
        return field(pd.label, select(pd.options, ins.params[key], (v) => commit(() => { ins.params[key] = numeric ? +v : v; }, 'params')));
      }
      return param({ label: pd.label, min: pd.min, max: pd.max, step: pd.step ?? 0.01, def: pd.def, curve: pd.curve, get: () => ins.params[key], set: (v) => { ins.params[key] = v; }, format: (v) => formatParam(pd, v) });
    });
    return h('div.plug', { class: ins.on ? null : 'off' }, head, open ? h('div.plug-params', {}, controls) : null);
  }

  return { el: root, render };
}
