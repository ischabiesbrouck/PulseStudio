// Ingebouwde effecten: alleen de beschrijving (parameters en standaardwaarden), zonder Web Audio,
// zodat het projectmodel en de tests er ook mee kunnen werken.

// Ritmische waarden in tellen, voor LFO's en delays die op het tempo lopen.
export const SYNC = [[4, '1 maat'], [2, '1/2'], [1, '1/4'], [0.75, '3/16'], [0.5, '1/8'], [2 / 3, '1/4 triool'], [1 / 3, '1/8 triool'], [0.25, '1/16'], [1.5, '3/8'], [8, '2 maten']];

const db = (label, def = 0, min = -15, max = 15) => ({ label, def, min, max, step: 0.5, unit: 'dB' });
const hz = (label, def, min, max) => ({ label, def, min, max, step: 1, unit: 'Hz', curve: 'exp' });
const pct = (label, def, min = 0, max = 1) => ({ label, def, min, max, step: 0.01, unit: '%' });
const sec = (label, def, min, max, curve = 'exp') => ({ label, def, min, max, step: 0.001, unit: 's', curve });
const sync = (label, def) => ({ label, def, type: 'select', options: SYNC });

export const PLUGIN_DEFS = {
  eq: {
    name: 'EQ', info: 'Parametrische EQ met low cut en drie banden.',
    params: {
      lowCut: hz('Low cut', 20, 20, 1000),
      lowFreq: hz('Laag', 120, 30, 600),
      low: db('Laag dB'),
      midFreq: hz('Mid', 1000, 150, 8000),
      mid: db('Mid dB'),
      midQ: { label: 'Q', def: 0.9, min: 0.2, max: 8, step: 0.1, curve: 'exp' },
      highFreq: hz('Hoog', 6000, 1500, 16000),
      high: db('Hoog dB'),
    },
  },
  comp: {
    name: 'Compressor', info: 'Maakt het verschil tussen hard en zacht kleiner.',
    params: {
      threshold: db('Drempel', -18, -60, 0),
      ratio: { label: 'Ratio', def: 4, min: 1, max: 20, step: 0.1, unit: ':1', curve: 'exp' },
      attack: sec('Attack', 0.01, 0.001, 0.3),
      release: sec('Release', 0.2, 0.02, 1.5),
      makeup: db('Make-up', 0, 0, 24),
    },
  },
  sat: {
    name: 'Verzadiging', info: 'Warme buis- of bandachtige vervorming.',
    params: { drive: db('Drive', 9, 0, 36), tone: hz('Toon', 9000, 500, 18000), mix: pct('Hoeveelheid', 1), output: db('Uitgang', 0, -24, 6) },
  },
  lofi: {
    name: 'Lo-fi', info: 'Minder bits, gedempte hoogte en ruis.',
    params: { bits: { label: 'Bits', def: 8, min: 2, max: 16, step: 1, unit: ' bit' }, tone: hz('Toon', 4500, 300, 16000), noise: pct('Ruis', 0.15), mix: pct('Hoeveelheid', 1) },
  },
  chorus: {
    name: 'Chorus', info: 'Maakt een geluid breder en voller.',
    params: { rate: hz('Snelheid', 0.7, 0.05, 6), depth: pct('Diepte', 0.5), mix: pct('Hoeveelheid', 0.5) },
  },
  phaser: {
    name: 'Phaser', info: 'Zwiepend, draaiend filtereffect.',
    params: { rate: hz('Snelheid', 0.35, 0.03, 8), depth: pct('Diepte', 0.7), feedback: pct('Feedback', 0.5, 0, 0.9), mix: pct('Hoeveelheid', 0.5) },
  },
  delay: {
    name: 'Delay', info: 'Echo op het tempo, ook als pingpong.',
    params: { time: sync('Tijd', 0.75), feedback: pct('Feedback', 0.4, 0, 0.95), tone: hz('Toon', 5000, 400, 16000), pingpong: { label: 'Pingpong', def: true, type: 'toggle' }, mix: pct('Hoeveelheid', 0.3) },
  },
  reverb: {
    name: 'Galm', info: 'Ruimte, van kleine kamer tot grote hal.',
    params: { size: sec('Galmtijd', 2.5, 0.3, 10), predelay: sec('Predelay', 0.02, 0, 0.2, null), damping: pct('Demping', 0.5), mix: pct('Hoeveelheid', 0.3) },
  },
  autofilter: {
    name: 'Autofilter', info: 'Filter dat op het tempo meebeweegt.',
    params: {
      type: { label: 'Type', def: 'lowpass', type: 'select', options: [['lowpass', 'Laagdoorlaat'], ['highpass', 'Hoogdoorlaat'], ['bandpass', 'Banddoorlaat']] },
      cutoff: hz('Frequentie', 1200, 60, 16000),
      reso: { label: 'Resonantie', def: 4, min: 0.1, max: 20, step: 0.1 },
      rate: sync('Snelheid', 4),
      depth: pct('Diepte', 0.6),
    },
  },
  tremolo: {
    name: 'Tremolo / autopan', info: 'Volume of panning die op het tempo golft.',
    params: { mode: { label: 'Soort', def: 'pan', type: 'select', options: [['pan', 'Autopan'], ['amp', 'Tremolo']] }, rate: sync('Snelheid', 1), depth: pct('Diepte', 0.6) },
  },
  pump: {
    name: 'Pomp (sidechain)', info: 'Het bekende pompende effect: duikt op elke tel weg.',
    params: { amount: pct('Diepte', 0.7), rate: { label: 'Elke', def: 1, type: 'select', options: [[2, '1/2'], [1, '1/4'], [0.5, '1/8']] }, release: pct('Terugkeer', 0.6, 0.1, 1) },
  },
  width: {
    name: 'Stereobreedte', info: 'Maakt het stereobeeld smaller of breder.',
    params: { width: pct('Breedte', 1.4, 0, 2) },
  },
  limiter: {
    name: 'Limiter', info: 'Harde grens, zodat niets boven het plafond uitkomt.',
    params: { gain: db('Versterking', 0, 0, 18), ceiling: db('Plafond', -1, -12, 0) },
  },
};

let n = 0;
const fxId = () => `fx${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function defaultParams(type) {
  const params = {};
  for (const [k, d] of Object.entries(PLUGIN_DEFS[type].params)) params[k] = d.def;
  return params;
}

export function createInsert(type, params = {}) {
  return { id: fxId(), type, on: true, params: { ...defaultParams(type), ...params } };
}

export function normalizeInsert(ins) {
  if (!PLUGIN_DEFS[ins.type]) return null;
  return { id: ins.id || fxId(), type: ins.type, on: ins.on !== false, params: { ...defaultParams(ins.type), ...ins.params } };
}

export const defaultMasterInserts = () => [
  createInsert('comp', { threshold: -12, ratio: 2, attack: 0.02, release: 0.25, makeup: 1.5 }),
  createInsert('limiter', { gain: 0, ceiling: -1 }),
];

// Zet de vaste effectenset van versie 0.1 om naar een lijst inserts.
export function fxToInserts(fx) {
  if (!fx) return [];
  const out = [];
  if (fx.eq && (fx.eq.low || fx.eq.mid || fx.eq.high)) out.push(createInsert('eq', { lowFreq: 220, low: fx.eq.low, midFreq: 1200, mid: fx.eq.mid, highFreq: 5000, high: fx.eq.high }));
  if (fx.comp?.on) out.push(createInsert('comp', { threshold: fx.comp.threshold, ratio: fx.comp.ratio }));
  if (fx.delay?.on) out.push(createInsert('delay', { time: fx.delay.time, feedback: fx.delay.feedback, mix: fx.delay.mix, pingpong: false }));
  if (fx.reverb?.on) out.push(createInsert('reverb', { size: fx.reverb.size, mix: fx.reverb.mix }));
  return out;
}

export function formatParam(def, v) {
  switch (def.unit) {
    case 'dB': return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
    case 's': return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case '%': return `${Math.round(v * 100)}%`;
    case ':1': return `${v.toFixed(1)}:1`;
    case ' bit': return `${Math.round(v)} bit`;
    default: return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
  }
}
