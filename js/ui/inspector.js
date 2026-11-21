// Klankpaneel: de apparatenketen van het geselecteerde spoor (instrument → effecten) of van de master.
import { state, commit, emit, select as selectTrack, selectedTrack } from '../state.js';
import { TRACK_COLORS } from '../model.js';
import { PLUGIN_DEFS, PLUGIN_CATS, createInsert } from '../audio/plugin-defs.js';
import { h, icon } from './dom.js';
import { liveViews, effectDevice, synthDevice, drumsDevice, samplerDevice, audioDevice, masterDevice, returnDevice, pluginDevice } from './devices.js';

export function createInspector(app) {
  const chain = h('div.chain');
  const root = h('div.devices', {}, chain);

  function context(track, master, ret) {
    const p = state.project;
    const go = (m, r) => () => { state.view.inspectMaster = m; state.view.inspectReturn = r; emit('panel'); };
    const seg = h('div.seg', { role: 'tablist', style: { minWidth: '230px' } },
      h('button.seg-btn', { 'aria-selected': String(!master && !ret), disabled: !track, onclick: go(false, null) }, track ? track.name : 'Geen spoor'),
      ...(p.returns || []).map((r) => h('button.seg-btn', { 'aria-selected': String(ret?.id === r.id), onclick: go(false, r.id), title: `Return ${r.letter}: ${r.name}` }, `${r.letter} ${r.name}`)),
      h('button.seg-btn', { 'aria-selected': String(master), onclick: go(true, null) }, 'Master'));
    if (ret) {
      const name = h('input.track-name-input', { value: ret.name, 'aria-label': 'Naam van de return' });
      name.addEventListener('change', () => { const v = name.value.trim(); if (v) commit(() => { ret.name = v; }); });
      const remove = h('button.btn.small.ghost', {
        title: 'Return verwijderen',
        onclick: () => {
          if (!confirm(`Return "${ret.name}" verwijderen? De sends ernaartoe vervallen.`)) return;
          commit(() => { p.returns.splice(p.returns.indexOf(ret), 1); for (const t of p.tracks) delete t.sends?.[ret.id]; });
          state.view.inspectReturn = null;
          emit('panel');
        },
      }, icon('trash', 14), 'Verwijderen');
      return [seg, name, remove];
    }
    if (master || !track) return [seg];
    const name = h('input.track-name-input', { value: track.name, 'aria-label': 'Naam van het spoor' });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) commit(() => { track.name = v; }); });
    const colors = h('div.swatches', {}, TRACK_COLORS.map((c) => h('button.swatch', {
      style: { background: c }, class: c === track.color ? 'on' : null, 'aria-label': `Kleur ${c}`, onclick: () => commit(() => { track.color = c; }),
    })));
    const remove = h('button.btn.small.ghost', {
      title: 'Spoor verwijderen',
      onclick: () => {
        if (track.clips.length && !confirm(`Spoor "${track.name}" met ${track.clips.length} clip(s) verwijderen?`)) return;
        const i = p.tracks.indexOf(track);
        commit(() => p.tracks.splice(i, 1));
        selectTrack(p.tracks[Math.min(i, p.tracks.length - 1)]?.id || null, null);
      },
    }, icon('trash', 14), 'Verwijderen');
    const bounce = h('button.btn.small.ghost', { title: 'Dit spoor met zijn effecten en sends opnemen als audio op een nieuw spoor (het origineel wordt gedempt)', onclick: () => app.bounceTrack(track.id) }, 'Naar audio');
    return [seg, h('span.dev-ctx', { style: { '--tc': track.color } }, h('span.tdot'), name), colors, bounce, remove];
  }

  function addBox(inserts, chainKey) {
    const sel = h('select', { 'aria-label': 'Effect toevoegen' },
      h('option', { value: '' }, 'Kies een effect…'),
      PLUGIN_CATS.map(([cat, types]) => h('optgroup', { label: cat }, types.map((type) => h('option', { value: type }, PLUGIN_DEFS[type].name)))));
    sel.addEventListener('change', () => { if (sel.value) commit(() => inserts.push(createInsert(sel.value))); });
    const box = h('div.add-device', {}, icon('plus', 20), h('span', {}, 'Effect toevoegen'), sel, h('span.lbl', {}, 'of sleep er een uit de browser'));
    box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-pulse')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('drop');
      const data = JSON.parse(e.dataTransfer.getData('application/x-pulse') || 'null');
      if (data?.kind === 'fx') commit(() => inserts.push(createInsert(data.id)));
      if (data?.kind === 'wam' && !data.instrument) app.addWamEffect(data, inserts);
    });
    box.dataset.chain = chainKey;
    return box;
  }

  function render() {
    liveViews.clear();
    const p = state.project;
    const track = selectedTrack();
    const ret = (p.returns || []).find((r) => r.id === state.view.inspectReturn) || null;
    const master = !ret && (state.view.inspectMaster || !track);
    app.setPanelCtx(...context(track, master, ret));
    const inserts = ret ? ret.inserts : master ? p.masterInserts : track.inserts;
    const chainKey = ret ? ret.id : master ? 'master' : track.id;
    const first = ret ? returnDevice(ret) : master ? masterDevice(p)
      : track.kind === 'synth' ? synthDevice(track, app)
        : track.kind === 'drums' ? drumsDevice(track, app)
          : track.kind === 'sampler' ? samplerDevice(track, app)
            : track.kind === 'plugin' ? pluginDevice(track, app)
            : audioDevice(track, app);
    const items = [first];
    inserts.forEach((ins, i) => {
      items.push(h('div.chain-arrow', {}, icon('chevron', 14)));
      items.push(effectDevice(ins, {
        chainKey, app, first: i === 0, last: i === inserts.length - 1,
        onRemove: () => commit(() => inserts.splice(i, 1)),
        onMove: (d) => commit(() => { inserts.splice(i, 1); inserts.splice(i + d, 0, ins); }),
      }));
    });
    items.push(h('div.chain-arrow', {}, icon('chevron', 14)), addBox(inserts, chainKey));
    chain.replaceChildren(...items);
  }

  return { el: root, render };
}
