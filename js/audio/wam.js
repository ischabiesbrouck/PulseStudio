// Plug-ins in de browser: Web Audio Modules 2.0 (WAM), de open standaard voor audioplug-ins op het web.
// Echte VST/AU-bestanden zijn programma's voor Windows of macOS en kunnen niet in een browser draaien;
// WAM-plug-ins worden met dezelfde soort gereedschappen gemaakt (iPlug2, Faust, JUCE-ports) en draaien als AudioWorklet.
import initializeWamHost from '../vendor/wam/initializeWamHost.js';

export const CATALOG_URL = 'https://www.webaudiomodules.com/community/plugins.json';
export const CATALOG_BASE = 'https://www.webaudiomodules.com/community/plugins/';

// Wat niet bij een spoor-effect of instrument hoort (video, MIDI-hulpjes, externe apparaten, audio-ingang).
const SKIP = /^(Video|MIDI)$/;
const SKIP_NAMES = /Audio Input|Audio Track|Envelope Follower|Randomizer|Step Sequencer|Function Sequencer|Piano Roll|Editor$/;

const hosts = new WeakMap();
// Eén WAM-groep per audiocontext.
export function wamHost(ctx) {
  if (!hosts.has(ctx)) hosts.set(ctx, initializeWamHost(ctx).then(([groupId]) => groupId));
  return hosts.get(ctx);
}

const modules = new Map();
export function loadWamModule(url) {
  if (!modules.has(url)) {
    modules.set(url, import(/* webpackIgnore: true */ url).then((m) => {
      if (!m.default?.createInstance) throw new Error('Dit bestand is geen WAM 2.0-plug-in.');
      return m.default;
    }).catch((err) => { modules.delete(url); throw err; }));
  }
  return modules.get(url);
}

// Maakt een plug-in aan in een (offline) audiocontext, met een eerder bewaarde toestand.
export async function createWam(ctx, url, state) {
  const groupId = await wamHost(ctx);
  const WAM = await loadWamModule(url);
  const inst = await WAM.createInstance(groupId, ctx, state ?? undefined);
  if (state != null) { try { await inst.audioNode.setState?.(state); } catch { /* sommige plug-ins zetten de toestand al bij createInstance */ } }
  return inst;
}

// Toestand ophalen als iets dat in JSON past (voor opslaan en ongedaan maken).
export async function wamState(inst) {
  try {
    const s = await inst.audioNode.getState();
    return s == null ? null : JSON.parse(JSON.stringify(s));
  } catch { return null; }
}

// MIDI naar een instrument-plug-in.
export function wamMidi(node, bytes, time) {
  node.scheduleEvents({ type: 'wam-midi', time, data: { bytes } });
}

let catalog = null;
export async function wamCatalog() {
  if (!catalog) {
    catalog = fetch(CATALOG_URL, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`catalogus: ${r.status}`);
      return r.json();
    }).then((list) => list
      .filter((p) => p.path && !SKIP.test(p.category?.[0] || '') && !SKIP_NAMES.test(p.name))
      .map((p) => ({
        id: p.identifier, name: p.name, vendor: p.vendor, description: p.description || '',
        group: p.category?.[0] === 'Instrument' ? 'Instrumenten' : (p.category?.[1] || p.category?.[0] || 'Overig'),
        instrument: p.category?.[0] === 'Instrument',
        url: new URL(p.path, CATALOG_BASE).href,
        website: p.website || '',
      })))
      .catch((err) => { catalog = null; throw err; });
  }
  return catalog;
}

// Vertaalt de Engelse categorieën van de catalogus.
export const WAM_GROUP_NAMES = {
  Instrumenten: 'Instrumenten', Distortion: 'Vervorming', 'Amp Simulator': 'Versterkers', Reverb: 'Galm', Delay: 'Delay',
  Modulation: 'Modulatie', 'Equalizer & Filter': 'EQ en filter', Pitch: 'Toonhoogte', Visualization: 'Meters', Utility: 'Hulpmiddelen', Pedalboard: 'Pedalboards',
};

export const isSafeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.hostname === 'localhost' || x.hostname === '127.0.0.1'; } catch { return false; } };
