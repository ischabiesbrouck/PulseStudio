// Browser (zijbalk links): geluiden, instrumenten en effecten zoeken, beluisteren en naar de tijdlijn of de keten slepen.
import { state } from '../state.js';
import { SYNTH_PRESETS, noteName } from '../model.js';
import { PLUGIN_DEFS, PLUGIN_CATS } from '../audio/plugin-defs.js';
import { DRUM_KITS } from '../audio/instruments.js';
import { LIBRARY, LIBRARY_CATS } from '../audio/library.js';
import { INSTRUMENTS } from '../audio/samplelib.js';
import { DRUM_PATTERNS, MELODIC_PATTERNS } from '../audio/patterns.js';
import { h, icon } from './dom.js';
import { wamCatalog, WAM_GROUP_NAMES } from '../audio/wam.js';

const PULSE = 'application/x-pulse';
const TABS = [['sounds', 'Geluiden'], ['patterns', 'Patronen'], ['instruments', 'Instrumenten'], ['fx', 'Effecten'], ['plugins', 'Plug-ins']];

export function createBrowser(app) {
  let tab = 'sounds';
  let query = '';
  // Catalogus van vrije WAM-plug-ins (pas geladen als het tabblad open gaat).
  let wamList = null, wamErr = null, wamLoading = false;
  function loadCatalog() {
    if (wamList || wamLoading) return;
    wamLoading = true;
    wamErr = null;
    wamCatalog().then((l) => { wamList = l; }, (e) => { wamErr = e; }).finally(() => { wamLoading = false; if (tab === 'plugins') renderList(); });
  }
  const search = h('input.br-search', { type: 'search', placeholder: 'Zoeken…', 'aria-label': 'Zoeken in de browser' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderList(); });
  const seg = h('div.seg', { role: 'tablist' });
  const list = h('div.br-list', { role: 'list' });
  const el = h('aside.browser', { 'aria-label': 'Browser' },
    h('div.br-head', {}, h('div.br-title', {}, h('strong', {}, 'Browser'), h('span.lbl', {}, 'Sleep of dubbelklik')), search, seg),
    list,
    h('div.br-foot', {}, h('p.hint', { style: { fontSize: '11px' } }, 'Sleep iets naar een spoor of naar de effectenketen. Dubbelklik voegt het toe aan het geselecteerde spoor.')));

  function groups() {
    if (tab === 'sounds') {
      return LIBRARY_CATS.map((cat) => [cat, LIBRARY.filter((i) => i.cat === cat).map((i) => ({
        kind: 'sound', id: i.id, name: i.name, icon: cat === 'Drumloops' ? 'drum' : cat === 'Effecten' ? 'fx' : 'wave',
        meta: i.root != null ? noteName(i.root) : cat === 'Melodische loops' ? i.role : cat === 'Drumloops' ? `${state.project.bpm}` : `${i.length(state.project.bpm).toFixed(1)}s`,
        tip: `${i.name}: sleep naar een spoor, dubbelklik voor een clip op de afspeelkop${i.root != null ? ', of + voor een samplerspoor' : ''}`,
        sampler: i.root != null,
      }))]);
    }
    if (tab === 'patterns') {
      const melodic = {};
      for (const p of MELODIC_PATTERNS) (melodic[p.role] ||= []).push({
        kind: 'pattern', id: p.id, name: p.name, icon: 'note', meta: p.instrument ? INSTRUMENTS[p.instrument].name.split(' (')[0] : p.preset,
        tip: `${p.name}: bewerkbare noten in A mineur. Sleep op een spoor, of naar een leeg spoor voor een nieuw spoor met ${p.instrument ? INSTRUMENTS[p.instrument].name : p.preset}.`,
      });
      return [
        ['Drumgrooves', DRUM_PATTERNS.map((p) => ({ kind: 'pattern', id: p.id, name: p.name, icon: 'drum', meta: `${p.bpm}`, tip: `${p.name}: bewerkbare drumclip (${DRUM_KITS[p.kit].name}). Sleep op een drumspoor of naar een leeg spoor.` }))],
        ...Object.entries(melodic).map(([role, items]) => [role, items]),
      ];
    }
    if (tab === 'instruments') {
      const cats = {};
      for (const [id, d] of Object.entries(INSTRUMENTS)) (cats[`Opnames: ${d.cat}`] ||= []).push({ kind: 'instrument', id, name: d.name, icon: 'sampler', meta: '', tip: `${d.name}: echte opnames (${d.source === 'salamander' ? 'Salamander Grand Piano' : 'FluidR3'}). Sleep op een samplerspoor of naar een leeg spoor.` });
      const synth = {};
      for (const [n, d] of Object.entries(SYNTH_PRESETS)) (synth[`Synth: ${d.cat}`] ||= []).push({ kind: 'preset', id: n, name: n, icon: 'note', meta: 'Synth', tip: `Synthpreset ${n}: sleep op een synthspoor of naar een leeg spoor` });
      return [
        ['Drumkits', Object.entries(DRUM_KITS).map(([id, d]) => ({ kind: 'kit', id, name: d.name, icon: 'drum', meta: d.sampled ? 'Opnames' : 'Kit', tip: `${d.name}: sleep op een drumspoor of naar een leeg spoor` }))],
        ...Object.entries(cats), ...Object.entries(synth),
      ];
    }
    if (tab === 'plugins') {
      if (!wamList) return [];
      const groups = new Map([['Instrumenten', []]]);
      for (const p of wamList) {
        const g = WAM_GROUP_NAMES[p.group] || p.group;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push({
          kind: 'wam', id: p.id, name: p.name, icon: p.instrument ? 'note' : 'fx', meta: p.vendor,
          tip: `${p.name} (${p.vendor}): ${p.description} Sleep op een spoor of in de keten${p.instrument ? '; een instrument krijgt een eigen spoor' : ''}.`,
          data: { kind: 'wam', url: p.url, name: p.name, vendor: p.vendor, instrument: p.instrument },
        });
      }
      return [...groups].filter(([, items]) => items.length);
    }
    return PLUGIN_CATS.map(([cat, types]) => [cat, types.map((id) => {
      const d = PLUGIN_DEFS[id];
      return { kind: 'fx', id, name: d.name, icon: 'dial', meta: d.credit ? 'Vrij' : '', tip: `${d.name}: ${d.info}${d.credit ? ` ${d.credit}.` : ''} Sleep op een spoor of in de keten.` };
    })]);
  }

  function row(item) {
    const pv = h('span.pv');
    const payload = item.data || { kind: item.kind, id: item.id };
    if (item.kind !== 'fx' && item.kind !== 'wam') pv.append(h('button', { title: 'Beluisteren', 'aria-label': `${item.name} beluisteren`, onclick: (e) => { e.stopPropagation(); app.previewItem(item); } }, icon('play', 11)));
    if (item.sampler) pv.append(h('button', { title: 'Nieuw samplerspoor', 'aria-label': `${item.name} als sampler`, onclick: (e) => { e.stopPropagation(); app.dropItem({ kind: 'sound', id: item.id, asSampler: true }, {}); } }, 'Sampler'));
    pv.append(h('button', { title: 'Toevoegen', 'aria-label': `${item.name} toevoegen`, onclick: (e) => { e.stopPropagation(); app.dropItem(payload, { useSelection: true }); } }, icon('plus', 11)));
    const r = h('div.br-item', { draggable: 'true', tabindex: '0', role: 'listitem', title: item.tip },
      h('span.ic', {}, icon(item.icon)), h('span.nm', {}, item.name), h('span.meta', {}, item.meta), pv);
    r.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(PULSE, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    });
    r.addEventListener('dblclick', () => app.dropItem(payload, { useSelection: true }));
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.dropItem(payload, { useSelection: true }); });
    return r;
  }

  function renderList() {
    const out = [];
    if (tab === 'plugins') {
      loadCatalog();
      out.push(h('div.br-note', {},
        h('p', {}, 'Web Audio Modules (WAM 2.0): de open plug-instandaard voor de browser. Echte VST- en AU-bestanden kunnen in geen enkele browser draaien; WAM-plug-ins zijn de webversie daarvan.'),
        h('button.btn.small', { onclick: () => app.loadWamFromUrl(), title: 'Een WAM-plug-in laden via het adres van zijn index.js' }, icon('plus', 12), 'Plug-in via adres…')));
      if (wamLoading) out.push(h('p.hint', { style: { padding: '10px 14px' } }, 'Catalogus laden…'));
      if (wamErr) out.push(h('p.hint', { style: { padding: '10px 14px' } }, 'De catalogus kon niet worden geladen (geen internet?). ', h('button.btn.small', { onclick: () => { wamErr = null; loadCatalog(); renderList(); } }, 'Opnieuw')));
    }
    for (const [title, items] of groups()) {
      const shown = items.filter((i) => !query || i.name.toLowerCase().includes(query) || title.toLowerCase().includes(query));
      if (!shown.length) continue;
      out.push(h('div.br-group', { dataset: { group: title } }, title), ...shown.map(row));
    }
    if (!out.length || (tab === 'plugins' && wamList && out.length === 1)) out.push(h('p.hint', { style: { padding: '14px' } }, 'Niets gevonden.'));
    list.replaceChildren(...out);
  }

  function render() {
    seg.replaceChildren(...TABS.map(([key, label]) => h('button.seg-btn', {
      role: 'tab', 'aria-selected': String(key === tab), onclick: () => { tab = key; render(); },
    }, label)));
    renderList();
  }

  function openTo(name, group) {
    tab = name;
    render();
    if (group) list.querySelector(`[data-group="${group}"]`)?.scrollIntoView({ block: 'start' });
  }

  return { el, render, openTo };
}
