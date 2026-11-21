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
    params: {
      type: { label: 'Ruimte', def: 'zaal', type: 'select', options: [['kamer', 'Kamer'], ['zaal', 'Zaal'], ['plaat', 'Plaat'], ['kerk', 'Kerk']] },
      size: sec('Galmtijd', 2.5, 0.3, 10), predelay: sec('Predelay', 0.02, 0, 0.2, null), damping: pct('Demping', 0.5), mix: pct('Hoeveelheid', 0.3),
    },
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

  // ---------- Studio-effecten (AudioWorklet) en vrije klassiekers ----------
  maximizer: {
    name: 'Maximizer', info: 'Limiter die 1,5 ms vooruitkijkt: luider zonder hoorbare vervorming of overschrijding van het plafond.',
    params: { gain: db('Versterking', 3, 0, 18), ceiling: { ...db('Plafond', -0.3, -6, 0), step: 0.1 }, release: sec('Release', 0.08, 0.005, 1) },
  },
  multiband: {
    name: 'Multiband', info: 'Driebandcompressor: laag, midden en hoog elk apart in toom houden, met Linkwitz-Riley-wissels.',
    params: {
      lowX: hz('Wissel laag', 200, 60, 800), highX: hz('Wissel hoog', 3000, 1000, 10000),
      threshold: db('Drempel', -20, -50, 0), ratio: { label: 'Ratio', def: 3, min: 1, max: 12, step: 0.1, unit: ':1', curve: 'exp' },
      attack: sec('Attack', 0.01, 0.001, 0.2), release: sec('Release', 0.15, 0.03, 1),
      low: db('Laag', 0, -12, 12), mid: db('Midden', 0, -12, 12), high: db('Hoog', 0, -12, 12),
    },
  },
  gate: {
    name: 'Gate', info: 'Sluit het geluid af onder de drempel: ruis, brom en overspraak eruit.',
    params: { threshold: db('Drempel', -40, -80, 0), range: db('Diepte', 60, 6, 80), attack: sec('Attack', 0.001, 0.0001, 0.05), hold: sec('Hold', 0.04, 0.001, 0.5), release: sec('Release', 0.12, 0.01, 1.5) },
  },
  transient: {
    name: 'Transiëntvormer', info: 'Maakt de aanslag harder of zachter, los van de staart. Werkt zonder drempel.',
    params: { attack: pct('Aanslag', 0, -1, 1), sustain: pct('Staart', 0, -1, 1), output: db('Uitgang', 0, -12, 12) },
  },
  deesser: {
    name: 'De-esser', info: 'Tempert scherpe s- en t-klanken door alleen de hoogte te comprimeren.',
    params: { freq: hz('Frequentie', 6500, 2000, 12000), threshold: db('Drempel', -26, -60, 0), range: db('Maximaal', 8, 1, 18) },
  },
  tape: {
    name: 'Tape', info: 'Bandmachine: verzadiging, kop-bump in het laag, gedempte hoogte, wow en flutter.',
    params: { drive: db('Drive', 6, 0, 24), bump: db('Kop-bump', 2, 0, 6), tone: hz('Hoogte', 14000, 3000, 20000), wow: pct('Wow', 0.2), flutter: pct('Flutter', 0.2), mix: pct('Hoeveelheid', 1) },
  },
  ensemble: {
    name: 'Ensemble', info: 'BBD-chorus in de stijl van klassieke polysynths uit de jaren tachtig, met de standen I, II en I+II.',
    params: { mode: { label: 'Stand', def: 1, type: 'select', options: [[1, 'I'], [2, 'II'], [3, 'I+II']] }, width: pct('Breedte', 1), mix: pct('Hoeveelheid', 0.5) },
  },
  freeverb: {
    name: 'Freeverb', info: 'De klassieke vrije galm van Jezar (Dreampoint, 2000, publiek domein): acht kamfilters en vier allpassfilters per kanaal.',
    credit: 'Algoritme van Jezar at Dreampoint, publiek domein',
    params: { room: pct('Ruimte', 0.78), damp: pct('Demping', 0.45), width: pct('Breedte', 1), predelay: sec('Predelay', 0.01, 0, 0.2, null), mix: pct('Hoeveelheid', 0.3) },
  },
  plate: {
    name: 'Plaatgalm 97', info: 'Plaatgalm naar het ontwerp van Jon Dattorro (1997): dicht, glad en helder, met bewegende staart.',
    credit: 'Naar J. Dattorro, "Effect Design Part 1", JAES 1997',
    params: {
      decay: pct('Galmtijd', 0.65, 0.05, 0.98), predelay: sec('Predelay', 0.01, 0, 0.25, null),
      tone: hz('Toon', 11000, 1000, 18000), damping: hz('Demping', 7000, 800, 16000), mod: pct('Beweging', 0.5), mix: pct('Hoeveelheid', 0.3),
    },
  },
};

// Indeling in de browser.
export const PLUGIN_CATS = [
  ['Dynamiek', ['comp', 'multiband', 'limiter', 'maximizer', 'gate', 'transient', 'deesser']],
  ['EQ en filter', ['eq', 'autofilter']],
  ['Kleur', ['sat', 'tape', 'lofi']],
  ['Modulatie', ['chorus', 'ensemble', 'phaser', 'tremolo', 'width']],
  ['Ruimte en tijd', ['plate', 'freeverb', 'reverb', 'delay']],
  ['Ritme', ['pump']],
];

// Kant-en-klare instellingen per effect, als startpunt.
export const PLUGIN_PRESETS = {
  eq: {
    'Warm': { lowCut: 30, lowFreq: 150, low: 2.5, midFreq: 2800, mid: -1.5, midQ: 0.8, highFreq: 9000, high: -2 },
    'Helder en open': { lowCut: 40, lowFreq: 120, low: 0, midFreq: 400, mid: -2, midQ: 1, highFreq: 8000, high: 4 },
    'Modder eruit': { lowCut: 90, lowFreq: 120, low: 0, midFreq: 320, mid: -4, midQ: 1.4, highFreq: 6000, high: 0 },
    'Telefoon': { lowCut: 400, lowFreq: 120, low: -6, midFreq: 1800, mid: 6, midQ: 1.2, highFreq: 4000, high: -15 },
    'Bas met punch': { lowCut: 30, lowFreq: 70, low: 4, midFreq: 700, mid: 2, midQ: 1.2, highFreq: 5000, high: -1 },
  },
  comp: {
    'Zachte lijm': { threshold: -14, ratio: 2, attack: 0.03, release: 0.25, makeup: 1.5 },
    'Drumbus': { threshold: -18, ratio: 4, attack: 0.01, release: 0.12, makeup: 4 },
    'Vocaal': { threshold: -20, ratio: 3, attack: 0.005, release: 0.15, makeup: 4 },
    'Plat en luid': { threshold: -30, ratio: 10, attack: 0.002, release: 0.08, makeup: 10 },
  },
  sat: {
    'Bandwarmte': { drive: 6, tone: 12000, mix: 0.6, output: -1 },
    'Buis': { drive: 14, tone: 9000, mix: 0.8, output: -4 },
    'Grof': { drive: 30, tone: 6000, mix: 1, output: -9 },
  },
  lofi: {
    'Cassette': { bits: 12, tone: 7000, noise: 0.2, mix: 0.8 },
    '8-bit': { bits: 5, tone: 9000, noise: 0, mix: 1 },
    'Oude radio': { bits: 8, tone: 2800, noise: 0.35, mix: 1 },
  },
  chorus: { 'Breed': { rate: 0.4, depth: 0.7, mix: 0.5 }, 'Licht': { rate: 0.9, depth: 0.3, mix: 0.3 }, 'Zeeziek': { rate: 3.5, depth: 1, mix: 0.6 } },
  phaser: { 'Langzaam': { rate: 0.15, depth: 0.8, feedback: 0.5, mix: 0.5 }, 'Snel': { rate: 2.5, depth: 0.6, feedback: 0.7, mix: 0.5 } },
  delay: {
    'Kwartnoot': { time: 1, feedback: 0.35, tone: 5000, pingpong: false, mix: 0.25 },
    'Gestippelde 1/8 pingpong': { time: 0.75, feedback: 0.45, tone: 4500, pingpong: true, mix: 0.3 },
    'Slapback': { time: 0.25, feedback: 0.05, tone: 7000, pingpong: false, mix: 0.3 },
    'Dub': { time: 1.5, feedback: 0.7, tone: 1800, pingpong: true, mix: 0.4 },
  },
  reverb: {
    'Kleine kamer': { type: 'kamer', size: 0.7, predelay: 0.005, damping: 0.6, mix: 0.2 },
    'Concertzaal': { type: 'zaal', size: 2.6, predelay: 0.025, damping: 0.45, mix: 0.28 },
    'Plaat voor zang': { type: 'plaat', size: 1.8, predelay: 0.02, damping: 0.25, mix: 0.25 },
    'Kathedraal': { type: 'kerk', size: 7, predelay: 0.06, damping: 0.55, mix: 0.35 },
    'Ambient': { type: 'zaal', size: 9, predelay: 0.08, damping: 0.3, mix: 0.5 },
  },
  autofilter: {
    'Langzame sweep': { type: 'lowpass', cutoff: 900, reso: 6, rate: 8, depth: 0.8 },
    'Wah op de tel': { type: 'bandpass', cutoff: 1200, reso: 6, rate: 1, depth: 0.7 },
    'Hoogdoorlaat-opbouw': { type: 'highpass', cutoff: 300, reso: 3, rate: 8, depth: 0.6 },
  },
  tremolo: { 'Autopan breed': { mode: 'pan', rate: 2, depth: 0.8 }, 'Vintage tremolo': { mode: 'amp', rate: 0.5, depth: 0.5 } },
  pump: { 'Klassiek': { amount: 0.7, rate: 1, release: 0.6 }, 'Zacht': { amount: 0.4, rate: 1, release: 0.8 }, 'Achtsten': { amount: 0.5, rate: 0.5, release: 0.7 } },
  width: { 'Mono': { width: 0 }, 'Breed': { width: 1.5 }, 'Extra breed': { width: 1.9 } },
  limiter: { 'Transparant': { gain: 0, ceiling: -1 }, 'Luid': { gain: 6, ceiling: -0.5 }, 'Streaming': { gain: 2, ceiling: -1 } },
  maximizer: {
    'Streaming (-14 LUFS)': { gain: 2, ceiling: -1, release: 0.12 },
    'Club': { gain: 6, ceiling: -0.3, release: 0.06 },
    'Maximaal': { gain: 10, ceiling: -0.1, release: 0.03 },
  },
  multiband: {
    'Mixbus-lijm': { lowX: 180, highX: 3500, threshold: -18, ratio: 2, attack: 0.02, release: 0.2, low: 0.5, mid: 0, high: 0.5 },
    'Laag strak': { lowX: 140, highX: 4000, threshold: -24, ratio: 5, attack: 0.008, release: 0.12, low: 2, mid: 0, high: 0 },
    'Plat en dik': { lowX: 220, highX: 2800, threshold: -34, ratio: 8, attack: 0.003, release: 0.08, low: 4, mid: 3, high: 4 },
  },
  gate: { 'Drums strak': { threshold: -30, range: 40, attack: 0.0005, hold: 0.03, release: 0.08 }, 'Zang': { threshold: -48, range: 18, attack: 0.002, hold: 0.08, release: 0.25 } },
  transient: { 'Meer punch': { attack: 0.6, sustain: -0.2, output: -1 }, 'Kamer eruit': { attack: 0.1, sustain: -0.8, output: 1 }, 'Zacht en vol': { attack: -0.6, sustain: 0.5, output: -1 } },
  deesser: { 'Zang': { freq: 6500, threshold: -28, range: 8 }, 'Hoge stem': { freq: 8500, threshold: -30, range: 10 }, 'Hihats temmen': { freq: 9500, threshold: -24, range: 6 } },
  tape: {
    'Warm en rond': { drive: 6, bump: 2.5, tone: 13000, wow: 0.15, flutter: 0.1, mix: 1 },
    'Cassette': { drive: 10, bump: 1, tone: 7000, wow: 0.55, flutter: 0.5, mix: 1 },
    'Kapotte band': { drive: 16, bump: 3, tone: 5000, wow: 1, flutter: 0.9, mix: 1 },
  },
  ensemble: { 'Breed (I)': { mode: 1, width: 1, mix: 0.5 }, 'Dik (II)': { mode: 2, width: 1, mix: 0.55 }, 'Vibrato (I+II)': { mode: 3, width: 0.8, mix: 0.5 } },
  freeverb: {
    'Kleine kamer': { room: 0.45, damp: 0.6, width: 0.8, predelay: 0.004, mix: 0.2 },
    'Hal': { room: 0.82, damp: 0.4, width: 1, predelay: 0.02, mix: 0.3 },
    'Oneindig': { room: 0.98, damp: 0.25, width: 1, predelay: 0.04, mix: 0.45 },
  },
  plate: {
    'Zangplaat': { decay: 0.6, predelay: 0.02, tone: 12000, damping: 8000, mod: 0.4, mix: 0.25 },
    'Snareplaat': { decay: 0.45, predelay: 0.005, tone: 14000, damping: 9000, mod: 0.3, mix: 0.3 },
    'Donker en lang': { decay: 0.88, predelay: 0.03, tone: 6000, damping: 3500, mod: 0.7, mix: 0.35 },
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
