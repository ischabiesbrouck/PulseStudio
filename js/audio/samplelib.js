// Echte opnames uit vrij te gebruiken samplebibliotheken, op afroep geladen en in de browser bewaard.
//   Virtuosity Drums en VCSL (Versilian Studios): CC0, geen naamsvermelding verplicht.
//   Salamander Grand Piano (Alexander Holm): CC BY 3.0.
//   FluidR3_GM (Frank Wen), via midi-js-soundfonts (Benjamin Gleitzman): CC BY 3.0.
import { seamlessLoop } from './dsp.js';

const VD = 'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/';
const VCSL = 'https://raw.githubusercontent.com/sgossner/VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/';
const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const FLUID = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
const CACHE = 'pulsestudio-samples-v1';

export const CREDITS = [
  { name: 'Virtuosity Drums', by: 'Versilian Studios', license: 'CC0 1.0', url: 'https://github.com/sfzinstruments/virtuosity_drums', use: 'akoestische drumkits en percussie' },
  { name: 'Versilian Community Sample Library (VCSL)', by: 'Versilian Studios', license: 'CC0 1.0', url: 'https://github.com/sgossner/VCSL', use: 'handklappen' },
  { name: 'Salamander Grand Piano V3', by: 'Alexander Holm', license: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/', use: 'vleugel' },
  { name: 'FluidR3_GM', by: 'Frank Wen (via midi-js-soundfonts van Benjamin Gleitzman)', license: 'CC BY 3.0', url: 'https://github.com/gleitz/midi-js-soundfonts', use: 'overige instrumenten' },
];

const path = (base, p) => base + p.split('/').map(encodeURIComponent).join('/');

// ---------- Laden met cache ----------

async function fetchBytes(url) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* geen Cache API (bijvoorbeeld file://) */ }
  const hit = cache && await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Laden mislukt (${res.status})`);
  if (cache) cache.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

let decoder = null;
function decode(bytes) {
  decoder ||= new OfflineAudioContext(2, 1, 44100);
  return decoder.decodeAudioData(bytes);
}

const bufferCache = new Map();
export function loadBuffer(url) {
  if (!bufferCache.has(url)) bufferCache.set(url, fetchBytes(url).then(decode).catch((err) => { bufferCache.delete(url); throw err; }));
  return bufferCache.get(url);
}

// Voert taken uit met beperkte gelijktijdigheid en meldt de voortgang.
async function pool(tasks, limit, onProgress) {
  let done = 0, next = 0;
  const results = new Array(tasks.length);
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      onProgress?.(++done / tasks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ---------- Akoestische drumkits ----------

const range = (a, b, step = 1) => { const out = []; for (let v = a; v <= b; v += step) out.push(v); return out; };

// Eén drumgeluid = lagen van zacht naar hard; elke laag heeft één of meer opnames (round robin).
function vdKit(mic, { kickMic = mic, snareMic = mic } = {}) {
  const m = (folder, file, useMic = mic) => path(VD, `${useMic}/${folder}/${useMic}_${file}.flac`);
  return {
    36: range(1, 4).map((v) => [1, 2, 3].map((r) => m('kick', `kick_snoff_vl${v}_rr${r}`, kickMic))),
    38: [6, 12, 18, 24, 30, 36].map((v) => [v, v - 1, v - 2].map((x) => m('snare', `snare_center_vl${x}`, snareMic))),
    37: [6, 11, 16].map((v) => [m('snare', `snare_crossstick_vl${v}`, snareMic)]),
    39: [range(1, 6).map((r) => path(VCSL, `Idiophones/Struck Idiophones/Claps/Clap_rr${r}.wav`))],
    42: range(1, 4).map((v) => [1, 2, 3].map((r) => m('hh', `hh_closed_vl${v}_rr${r}`))),
    46: [[m('hh', 'hh_open_vl3_rr1'), m('hh', 'hh_open_vl3_rr2')], [m('hh', 'hh_open_vl4_rr1'), m('hh', 'hh_open_vl4_rr2')]],
    45: [5, 10, 16].map((v) => [m('ltom', `ltom_center_vl${v}`), m('ltom', `ltom_center_vl${v - 1}`)]),
    50: [5, 10, 16].map((v) => [m('htom', `htom_center_vl${v}`), m('htom', `htom_center_vl${v - 1}`)]),
    49: [[m('crash', 'crash_crash_vl2_rr1')], [m('crash', 'crash_crash_vl3_rr1'), m('crash', 'crash_crash_vl3_rr2')]],
    51: [[m('ride', 'ride_ride_vl2_rr1'), m('ride', 'ride_ride_vl2_rr2')], [m('ride', 'ride_ride_vl3_rr1'), m('ride', 'ride_ride_vl3_rr2')]],
    56: [1, 2, 3].map((v) => [1, 2, 3].map((r) => path(VD, `perc/close/cowbell/Cowbell1_Normal_v${v}_rr${r}_Close.wav`))),
    70: [range(1, 6).map((r) => path(VD, `perc/close/shaker/LShaker_Shake1D_rr${r}_Close.wav`))],
  };
}

export const SAMPLE_KITS = {
  Studio: { name: 'Studio akoestisch', map: () => vdKit('oh', { kickMic: 'kickmic', snareMic: 'snaremic' }), size: '11 MB' },
  Kamer: { name: 'Jazz in de kamer', map: () => vdKit('room'), size: '16 MB' },
  Cassette: { name: 'Cassette (lo-fi)', map: () => vdKit('lofi'), size: '9 MB' },
};

const kits = new Map();
const kitLoads = new Map();

// Gewenste piekniveaus per drumgeluid bij de hardste laag, zodat opnames uit verschillende bronnen in balans zijn.
const PAD_TARGET = { 36: 0.85, 38: 0.7, 37: 0.42, 39: 0.55, 42: 0.38, 46: 0.42, 45: 0.6, 50: 0.55, 49: 0.42, 51: 0.32, 56: 0.32, 70: 0.3 };

export function peakOf(buf) {
  let max = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > max) max = a; }
  }
  return max;
}

export const getKit = (id) => kits.get(id) || null;
export const isSampleKit = (id) => !!SAMPLE_KITS[id];

export function loadKit(id, onProgress) {
  if (kits.has(id)) return Promise.resolve(kits.get(id));
  if (!kitLoads.has(id)) {
    const map = SAMPLE_KITS[id].map();
    const entries = Object.entries(map);
    const urls = entries.flatMap(([, layers]) => layers.flat());
    const p = pool(urls.map((u) => () => loadBuffer(u)), 6, onProgress).then(() => Promise.all(entries.map(async ([pitch, layers]) =>
      [pitch, await Promise.all(layers.map((files) => Promise.all(files.map(loadBuffer))))]))).then((pairs) => {
      const kit = Object.fromEntries(pairs);
      // Eén correctiefactor per geluid (gemeten op de hardste laag); de verschillen tussen lagen blijven zo behouden.
      kit.gain = {};
      for (const [pitch, layers] of pairs) {
        const top = layers[layers.length - 1];
        const pk = Math.max(...top.map(peakOf));
        kit.gain[pitch] = pk > 0 ? (PAD_TARGET[pitch] ?? 0.5) / pk : 1;
      }
      kits.set(id, kit);
      return kit;
    }).catch((err) => { kitLoads.delete(id); throw err; });
    kitLoads.set(id, p);
  }
  return kitLoads.get(id);
}

// ---------- Instrumenten ----------

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteToMidi(name) {
  const m = name.match(/^([A-G])(b|s|#)?(-?\d)$/);
  if (!m) return null;
  return (+m[3] + 1) * 12 + NOTE_INDEX[m[1]] + (m[2] === 'b' ? -1 : m[2] ? 1 : 0);
}

// `loop`: aanhoudende instrumenten krijgen een naadloze loop (fracties van de samplelengte).
export const INSTRUMENTS = {
  piano: { name: 'Vleugel (Salamander)', cat: 'Piano en toetsen', source: 'salamander' },
  epiano: { name: 'Elektrische piano', cat: 'Piano en toetsen', gm: 'electric_piano_1' },
  dxpiano: { name: 'FM-piano', cat: 'Piano en toetsen', gm: 'electric_piano_2' },
  clavinet: { name: 'Clavinet', cat: 'Piano en toetsen', gm: 'clavinet' },
  organ: { name: 'Drawbar-orgel', cat: 'Piano en toetsen', gm: 'drawbar_organ', loop: [0.3, 0.85] },
  churchorgan: { name: 'Kerkorgel', cat: 'Piano en toetsen', gm: 'church_organ', loop: [0.3, 0.85] },
  vibes: { name: 'Vibrafoon', cat: 'Mallets', gm: 'vibraphone' },
  marimba: { name: 'Marimba', cat: 'Mallets', gm: 'marimba' },
  celesta: { name: 'Celesta', cat: 'Mallets', gm: 'celesta' },
  musicbox: { name: 'Speeldoos', cat: 'Mallets', gm: 'music_box' },
  nylon: { name: 'Nylon gitaar', cat: 'Gitaar en bas', gm: 'acoustic_guitar_nylon' },
  steel: { name: 'Staalsnarige gitaar', cat: 'Gitaar en bas', gm: 'acoustic_guitar_steel' },
  cleangtr: { name: 'Elektrische gitaar', cat: 'Gitaar en bas', gm: 'electric_guitar_clean' },
  upright: { name: 'Contrabas', cat: 'Gitaar en bas', gm: 'acoustic_bass' },
  fingerbass: { name: 'Basgitaar', cat: 'Gitaar en bas', gm: 'electric_bass_finger' },
  synthbass: { name: 'Synthbas', cat: 'Gitaar en bas', gm: 'synth_bass_1' },
  strings: { name: 'Strijkorkest', cat: 'Orkest', gm: 'string_ensemble_1', loop: [0.35, 0.85] },
  violin: { name: 'Viool', cat: 'Orkest', gm: 'violin', loop: [0.35, 0.85] },
  cello: { name: 'Cello', cat: 'Orkest', gm: 'cello', loop: [0.35, 0.85] },
  harp: { name: 'Harp', cat: 'Orkest', gm: 'orchestral_harp' },
  pizz: { name: 'Pizzicato', cat: 'Orkest', gm: 'pizzicato_strings' },
  choir: { name: 'Koor', cat: 'Orkest', gm: 'choir_aahs', loop: [0.35, 0.85] },
  brass: { name: 'Koperblazers', cat: 'Blazers', gm: 'brass_section', loop: [0.35, 0.85] },
  trumpet: { name: 'Trompet', cat: 'Blazers', gm: 'trumpet', loop: [0.35, 0.85] },
  sax: { name: 'Altsax', cat: 'Blazers', gm: 'alto_sax', loop: [0.35, 0.85] },
  flute: { name: 'Fluit', cat: 'Blazers', gm: 'flute', loop: [0.35, 0.85] },
  warmpad: { name: 'Warme pad', cat: 'Synth', gm: 'pad_2_warm', loop: [0.3, 0.85] },
  newage: { name: 'Glinsterpad', cat: 'Synth', gm: 'pad_1_new_age' },
  squarelead: { name: 'Blokgolf-lead', cat: 'Synth', gm: 'lead_1_square', loop: [0.3, 0.85] },
  kalimba: { name: 'Kalimba', cat: 'Wereld', gm: 'kalimba' },
  steeldrum: { name: 'Steeldrum', cat: 'Wereld', gm: 'steel_drums' },
  sitar: { name: 'Sitar', cat: 'Wereld', gm: 'sitar' },
};

const instruments = new Map();
const instLoads = new Map();
export const getInstrument = (id) => instruments.get(id) || null;

// Salamander staat in stappen van een kleine terts (A, C, D#, F#) van A0 tot C8.
const SALAMANDER_NOTES = (() => {
  const out = [];
  for (let m = 21; m <= 108; m += 3) {
    const oct = Math.floor(m / 12) - 1;
    const name = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][m % 12];
    out.push([m, `${name}${oct}`]);
  }
  return out;
})();

function withLoop(buf, loop) {
  if (!loop) return { buffer: buf };
  const ls = Math.floor(loop[0] * buf.length), le = Math.floor(loop[1] * buf.length);
  const copy = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = new Float32Array(buf.getChannelData(c)); chans.push(d); }
  seamlessLoop(chans, ls, le, Math.floor(buf.sampleRate * 0.12));
  chans.forEach((d, c) => copy.copyToChannel(d, c));
  return { buffer: copy, loop: [ls / buf.sampleRate, le / buf.sampleRate] };
}

export function loadInstrument(id, onProgress) {
  if (instruments.has(id)) return Promise.resolve(instruments.get(id));
  if (!instLoads.has(id)) {
    const def = INSTRUMENTS[id];
    let p;
    if (def.source === 'salamander') {
      p = pool(SALAMANDER_NOTES.map(([root, name]) => async () => ({ root, buffer: await loadBuffer(`${SALAMANDER}${name}.mp3`) })), 6, onProgress);
    } else {
      // FluidR3: één JS-bestand met alle 88 noten als base64-MP3; we decoderen elke derde noot.
      p = fetchBytes(`${FLUID}${def.gm}-mp3.js`).then(async (bytes) => {
        const text = new TextDecoder().decode(bytes);
        const notes = [...text.matchAll(/"([A-G]b?\d)":\s*"data:audio\/mp3;base64,([^"]+)"/g)]
          .map(([, name, b64]) => [noteToMidi(name), b64])
          .filter(([m]) => m != null && (m - 21) % 3 === 0);
        return pool(notes.map(([root, b64]) => async () => {
          const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
          return { root, ...withLoop(await decode(bin.buffer), def.loop) };
        }), 4, onProgress);
      });
    }
    p = p.then((zones) => {
      zones.sort((a, b) => a.root - b.root);
      // Instrumenten op gelijk niveau brengen: één noot piekt rond -6 dB, zodat akkoorden ruimte houden
      // (één factor, dus het verloop tussen registers blijft).
      const max = Math.max(...zones.map((z) => peakOf(z.buffer)));
      const gain = max > 0 ? 0.5 / max : 1;
      for (const z of zones) z.gain = gain;
      instruments.set(id, zones);
      return zones;
    })
      .catch((err) => { instLoads.delete(id); throw err; });
    instLoads.set(id, p);
  }
  return instLoads.get(id);
}

// Dichtstbijzijnde opname bij een toonhoogte (liefst één die iets hoger ligt: omlaag stemmen klinkt natuurlijker).
export function pickZone(zones, pitch) {
  let best = zones[0], dist = Infinity;
  for (const z of zones) {
    const d = z.root - pitch;
    const score = d >= 0 ? d : -d * 1.2;
    if (score < dist) { dist = score; best = z; }
  }
  return best;
}
