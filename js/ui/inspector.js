// Klankpaneel: instrument- en effectinstellingen van het geselecteerde spoor.
import { state, commit, select as selectTrack, selectedTrack } from '../state.js';
import { SYNTH_PRESETS, TRACK_COLORS, defaultSynth } from '../model.js';
import { h, param, select } from './dom.js';

const WAVES = [['sine', 'Sinus'], ['triangle', 'Driehoek'], ['sawtooth', 'Zaagtand'], ['square', 'Blok']];
const DELAY_TIMES = [[0.25, '1/16'], [0.5, '1/8'], [0.75, '3/16'], [1, '1/4'], [1.5, '3/8'], [2, '1/2']];
const ms = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const pct = (v) => `${Math.round(v * 100)}%`;
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const db = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

function section(title, ...children) {
  return h('section.insp-sec', {}, h('h3', {}, title), ...children);
}

function toggle(label, get, set) {
  const input = h('input', { type: 'checkbox', checked: get() });
  input.addEventListener('change', () => commit(() => set(input.checked), 'params'));
  return h('label.toggle', {}, input, h('span', {}, label));
}

export function createInspector(app) {
  const root = h('div.inspector');

  function render() {
    const track = selectedTrack();
    if (!track) { root.replaceChildren(h('p.hint', {}, 'Voeg een spoor toe of selecteer er een om de klank in te stellen.')); return; }

    const name = h('input.track-name-input', { value: track.name, 'aria-label': 'Naam van het spoor' });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) commit(() => { track.name = v; }); });
    const colors = h('div.swatches', {}, TRACK_COLORS.map((c) => h('button.swatch', {
      style: { background: c }, class: c === track.color ? 'on' : null, 'aria-label': `Kleur ${c}`,
      onclick: () => commit(() => { track.color = c; }),
    })));
    const remove = h('button.btn.danger', {
      onclick: () => {
        if (track.clips.length && !confirm(`Spoor "${track.name}" met ${track.clips.length} clip(s) verwijderen?`)) return;
        const p = state.project;
        const i = p.tracks.indexOf(track);
        commit(() => p.tracks.splice(i, 1));
        selectTrack(p.tracks[Math.min(i, p.tracks.length - 1)]?.id || null, null);
      },
    }, 'Spoor verwijderen');
    const head = h('div.insp-head', { style: { '--tc': track.color } }, h('span.tcolor'), name, colors, remove);

    const fx = track.fx;
    const effects = h('div.insp-fx', {},
      section('EQ',
        param({ label: 'Laag', min: -12, max: 12, step: 0.5, def: 0, get: () => fx.eq.low, set: (v) => { fx.eq.low = v; }, format: db }),
        param({ label: 'Midden', min: -12, max: 12, step: 0.5, def: 0, get: () => fx.eq.mid, set: (v) => { fx.eq.mid = v; }, format: db }),
        param({ label: 'Hoog', min: -12, max: 12, step: 0.5, def: 0, get: () => fx.eq.high, set: (v) => { fx.eq.high = v; }, format: db })),
      section('Compressor',
        toggle('Aan', () => fx.comp.on, (v) => { fx.comp.on = v; }),
        param({ label: 'Drempel', min: -48, max: 0, step: 0.5, def: -18, get: () => fx.comp.threshold, set: (v) => { fx.comp.threshold = v; }, format: db }),
        param({ label: 'Ratio', min: 1, max: 20, step: 0.1, def: 4, get: () => fx.comp.ratio, set: (v) => { fx.comp.ratio = v; }, format: (v) => `${v.toFixed(1)}:1` })),
      section('Delay',
        toggle('Aan', () => fx.delay.on, (v) => { fx.delay.on = v; }),
        h('label.field', {}, 'Tijd', select(DELAY_TIMES, fx.delay.time, (v) => commit(() => { fx.delay.time = +v; }, 'params'))),
        param({ label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0.35, get: () => fx.delay.feedback, set: (v) => { fx.delay.feedback = v; }, format: pct }),
        param({ label: 'Hoeveelheid', min: 0, max: 1, step: 0.01, def: 0.25, get: () => fx.delay.mix, set: (v) => { fx.delay.mix = v; }, format: pct })),
      section('Galm',
        toggle('Aan', () => fx.reverb.on, (v) => { fx.reverb.on = v; }),
        param({ label: 'Ruimte', min: 0.3, max: 6, step: 0.1, def: 2.2, get: () => fx.reverb.size, set: (v) => { fx.reverb.size = v; }, format: (v) => `${v.toFixed(1)} s` }),
        param({ label: 'Hoeveelheid', min: 0, max: 1, step: 0.01, def: 0.25, get: () => fx.reverb.mix, set: (v) => { fx.reverb.mix = v; }, format: pct })));

    root.replaceChildren(head, h('div.insp-body', {}, instrument(track), effects));
  }

  function instrument(track) {
    if (track.kind === 'synth') {
      const s = track.synth;
      const p = (label, key, min, max, step, format, curve) => param({ label, min, max, step, format, curve, def: SYNTH_PRESETS[s.preset]?.[key], get: () => s[key], set: (v) => { s[key] = v; } });
      return h('div.insp-inst', {},
        section('Synth',
          h('label.field', {}, 'Preset', select(Object.keys(SYNTH_PRESETS).map((k) => [k, k]), s.preset, (v) => commit(() => { track.synth = defaultSynth(v); }))),
          h('label.field', {}, 'Oscillator 1', select(WAVES, s.wave1, (v) => commit(() => { s.wave1 = v; }, 'params'))),
          h('label.field', {}, 'Oscillator 2', select(WAVES, s.wave2, (v) => commit(() => { s.wave2 = v; }, 'params'))),
          h('label.field', {}, 'Octaaf osc 2', select([[-1, '−1'], [0, '0'], [1, '+1'], [2, '+2']], s.osc2Oct, (v) => commit(() => { s.osc2Oct = +v; }, 'params'))),
          p('Mix osc 2', 'mix', 0, 1, 0.01, pct),
          p('Ontstemming', 'detune', 0, 50, 0.5, (v) => `${v.toFixed(1)} ct`),
          p('Volume', 'gain', 0, 1, 0.01, pct)),
        section('Filter',
          p('Afsnijding', 'cutoff', 40, 16000, 1, hz, 'exp'),
          p('Resonantie', 'reso', 0.1, 20, 0.1, (v) => v.toFixed(1)),
          p('Envelope', 'envAmt', 0, 8000, 10, hz)),
        section('Envelope',
          p('Attack', 'attack', 0.001, 3, 0.001, ms, 'exp'),
          p('Decay', 'decay', 0.01, 4, 0.01, ms, 'exp'),
          p('Sustain', 'sustain', 0, 1, 0.01, pct),
          p('Release', 'release', 0.01, 5, 0.01, ms, 'exp')),
        h('p.hint', {}, 'Speel op je toetsenbord: A W S E D F T G Y H U J K, met Z en X voor een octaaf lager of hoger. Een MIDI-keyboard werkt ook.'));
    }
    if (track.kind === 'drums') {
      const k = track.drums;
      return h('div.insp-inst', {},
        section('Drumcomputer',
          param({ label: 'Stemming', min: -12, max: 12, step: 0.5, def: 0, get: () => k.tune, set: (v) => { k.tune = v; }, format: (v) => `${v > 0 ? '+' : ''}${v} st` }),
          param({ label: 'Uitklinken', min: 0.3, max: 2.5, step: 0.01, def: 1, get: () => k.decay, set: (v) => { k.decay = v; }, format: pct }),
          param({ label: 'Volume', min: 0, max: 1, step: 0.01, def: 0.9, get: () => k.level, set: (v) => { k.level = v; }, format: pct })),
        h('p.hint', {}, 'Speel live met A (kick), W (snare), S (clap), E (hihat dicht), D (hihat open), F en T (toms), G (crash).'));
    }
    return h('div.insp-inst', {},
      section('Audio',
        h('p.hint', {}, 'Neem op via de microfoon: zet opname aan (●) op dit spoor en druk op de opnameknop. Je kunt ook een audiobestand op het spoor slepen.'),
        h('button.btn', { onclick: () => app.pickAudio(track.id, null) }, 'Audiobestand kiezen…')));
  }

  return { el: root, render };
}
