// Bibliotheek-paneel: ingebouwde geluiden beluisteren en toevoegen als clip of als sampler.
import { state } from '../state.js';
import { noteName } from '../model.js';
import { LIBRARY, LIBRARY_CATS } from '../audio/library.js';
import { h } from './dom.js';

export function createLibrary(app) {
  const root = h('div.library');

  function meta(item) {
    const bits = [];
    if (item.cat === 'Drumloops') bits.push(`2 maten · ${state.project.bpm} BPM`);
    else bits.push(`${item.length(state.project.bpm).toFixed(1)} s`);
    if (item.root != null) bits.push(`grondtoon ${noteName(item.root)}`);
    return bits.join(' · ');
  }

  function card(item) {
    const busy = (btn, fn) => async () => {
      btn.disabled = true;
      try { await fn(); } finally { btn.disabled = false; }
    };
    const play = h('button.tbtn.play', { 'aria-label': `${item.name} beluisteren`, title: 'Beluisteren' }, '▶');
    play.addEventListener('click', busy(play, () => app.previewLibrary(item)));
    const clip = h('button.btn.small', { title: 'Als audioclip op de afspeelkop zetten' }, '+ Clip');
    clip.addEventListener('click', busy(clip, () => app.addLibrary(item, 'clip')));
    const sampler = item.root != null ? h('button.btn.small', { title: 'Nieuw samplerspoor met dit geluid, speelbaar op elke toonhoogte' }, '+ Sampler') : null;
    sampler?.addEventListener('click', busy(sampler, () => app.addLibrary(item, 'sampler')));
    return h('div.lib-card', {}, play, h('div.lib-info', {}, h('strong', {}, item.name), h('span', {}, meta(item))), h('div.lib-actions', {}, clip, sampler));
  }

  function render() {
    root.replaceChildren(
      h('p.hint', {}, 'Alle geluiden worden in je browser gemaakt, dus je mag ze vrij gebruiken. Drumloops passen zich aan het tempo van je project aan. Met "+ Sampler" speel je een instrument op elke toonhoogte.'),
      ...LIBRARY_CATS.map((cat) => h('section.lib-cat', {}, h('h3', {}, cat), h('div.lib-grid', {}, LIBRARY.filter((i) => i.cat === cat).map(card)))));
  }

  return { el: root, render };
}
