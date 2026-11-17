// Apparaten: instrumenten en effecten als hardware-achtige modules met een scherm en draaiknoppen.
import { state, commit, gesture } from '../state.js';
import { SYNTH_PRESETS, BASE_SYNTH, DRUM_ROWS, DRUM_KEYS, defaultSynth, noteName, clamp } from '../model.js';
import { PLUGIN_DEFS, formatParam } from '../audio/plugin-defs.js';
import { DRUM_KITS } from '../audio/instruments.js';
import { h, icon, select } from './dom.js';
import { knob, pick, waveOptions } from './knob.js';
import { ACCENT as ORANGE, ACCENT_FILL, SECOND, GRID, GRID_STRONG, LABEL, font } from './theme.js';

// Schermen die live meebewegen (gain reduction); app.js roept tick() aan zolang het paneel open is.
export const liveViews = new Set();

const MONO = font(9.5);

const pct = (v) => `${Math.round(v * 100)}%`;
const ms = (v) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${v < 10 ? v.toFixed(2) : Math.round(v)}`);
const st = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}st`;
const ct = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}ct`;

// ---------- Schermen ----------

function screen(w, hgt, label, paint) {
  const cv = h('canvas');
  const val = h('span.screen-val');
  const el = h('div.screen', { style: { width: `${w}px`, height: `${hgt}px` } }, cv, label ? h('span.screen-lbl', {}, label) : null, val);
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    paint(g, w, hgt, val);
  };
  requestAnimationFrame(draw);
  return { el, cv, draw, val, w, h: hgt };
}

const fx = (f, W) => (W * Math.log10(f / 20)) / 3;
const xf = (x, W) => 20 * 1000 ** (x / W);

function gridLines(g, W, H, { freqs = false, ys = [], xs = [], yLabels = [] } = {}) {
  g.lineWidth = 1;
  g.font = MONO;
  g.fillStyle = LABEL;
  if (freqs) {
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(fx(f, W)) + 0.5;
      g.strokeStyle = f === 1000 ? GRID_STRONG : GRID;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, H - 4);
    }
  }
  for (const x0 of xs) { const x = Math.round(x0) + 0.5; g.strokeStyle = GRID; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  ys.forEach((y0, i) => {
    const y = Math.round(y0) + 0.5;
    g.strokeStyle = yLabels[i] === '0' ? GRID_STRONG : GRID;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    if (yLabels[i]) g.fillText(yLabels[i], 3, y - 2);
  });
}

// Vlakke lijn in de accentkleur, optioneel gevuld tot `base`.
function glowCurve(g, pts, W, H, base = H) {
  if (!pts.length) return;
  if (base != null) {
    g.beginPath();
    g.moveTo(pts[0][0], base);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(pts[pts.length - 1][0], base);
    g.closePath();
    g.fillStyle = ACCENT_FILL;
    g.fill();
  }
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = ORANGE;
  g.lineWidth = 1.6;
  g.stroke();
}

// Frequentierespons via een (nooit gestarte) OfflineAudioContext.
const FREQS = new Float32Array(180).map((_, i) => 20 * 1000 ** (i / 179));
let rctx = null;
function response(type, f, q = 0.707, gainDb = 0) {
  rctx ||= new OfflineAudioContext(1, 128, 44100);
  const b = rctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = clamp(f, 10, 20000);
  b.Q.value = q;
  b.gain.value = gainDb;
  const mag = new Float32Array(FREQS.length);
  b.getFrequencyResponse(FREQS, mag, new Float32Array(FREQS.length));
  return mag;
}
const toDb = (m) => 20 * Math.log10(Math.max(1e-6, m));

function paintFilter(g, W, H, type, cutoff, reso, slope = 12, band = null) {
  const top = 18, bottom = -36;
  const y = (db) => 6 + ((top - clamp(db, bottom, top)) / (top - bottom)) * (H - 14);
  gridLines(g, W, H, { freqs: true, ys: [y(12), y(0), y(-12), y(-24)], yLabels: ['', '0', '', ''] });
  if (band) {
    g.fillStyle = ACCENT_FILL;
    g.fillRect(fx(band[0], W), 0, fx(band[1], W) - fx(band[0], W), H);
  }
  const mag = response(type, cutoff, reso);
  glowCurve(g, Array.from(FREQS, (f, i) => [fx(f, W), y(toDb(mag[i]) * (slope === 24 ? 2 : 1))]), W, H);
}

function paintEnvelope(g, W, H, amp, filt) {
  const hold = 0.35;
  const total = Math.max(amp.a + amp.d + hold + amp.r, (filt ? filt.a + filt.d + hold + amp.r : 0), 0.4);
  const X = (t) => 6 + (t / total) * (W - 12);
  const Y = (v) => H - 8 - v * (H - 22);
  gridLines(g, W, H, { ys: [Y(0), Y(0.5), Y(1)], xs: [1, 2, 3].map((i) => (i * W) / 4) });
  const shape = (e) => [[X(0), Y(0)], [X(e.a), Y(1)], [X(e.a + e.d), Y(e.s)], [X(e.a + e.d + hold), Y(e.s)], [X(e.a + e.d + hold + amp.r), Y(0)]];
  if (filt) {
    g.beginPath();
    shape(filt).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.setLineDash([3, 3]);
    g.strokeStyle = SECOND;
    g.lineWidth = 1.4;
    g.stroke();
    g.setLineDash([]);
  }
  glowCurve(g, shape(amp), W, H, Y(0));
}

function paintLfo(g, W, H, depth, cycles = 2, label) {
  gridLines(g, W, H, { ys: [H / 2], xs: [W / 4, W / 2, (3 * W) / 4] });
  const pts = [];
  for (let x = 0; x <= W; x += 2) pts.push([x, H / 2 - Math.sin((x / W) * Math.PI * 2 * cycles) * depth * (H / 2 - 12)]);
  glowCurve(g, pts, W, H, null);
  if (label) { g.font = MONO; g.fillStyle = LABEL; g.fillText(label, W - 60, H - 5); }
}

// VU-meter in de stijl van een buizencompressor: de naald toont gain reduction.
function paintVu(g, W, H, gr) {
  const cx = W / 2, cy = H * 1.22, R = H * 1.02;
  const ang = (frac) => (-48 + frac * 96) * (Math.PI / 180);
  const fracOf = (db) => 1 - Math.sqrt(Math.min(db, 20) / 20);
  g.lineWidth = 1.2;
  g.strokeStyle = GRID_STRONG;
  g.beginPath();
  g.arc(cx, cy, R * 0.86, -Math.PI / 2 - (48 * Math.PI) / 180, -Math.PI / 2 + (48 * Math.PI) / 180);
  g.stroke();
  g.font = MONO;
  g.textAlign = 'center';
  for (const db of [20, 10, 6, 3, 1, 0]) {
    const a = ang(fracOf(db));
    const x0 = cx + Math.sin(a) * R * 0.86, y0 = cy - Math.cos(a) * R * 0.86;
    const x1 = cx + Math.sin(a) * R * 0.95, y1 = cy - Math.cos(a) * R * 0.95;
    g.strokeStyle = GRID_STRONG;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.fillStyle = LABEL;
    g.fillText(db ? `-${db}` : '0', cx + Math.sin(a) * R * 1.04, cy - Math.cos(a) * R * 1.04 + 3);
  }
  g.fillStyle = LABEL;
  g.fillText('Gain reduction (dB)', cx, H - 8);
  g.textAlign = 'left';
  const a = ang(fracOf(Math.max(0, gr)));
  g.strokeStyle = ORANGE;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(cx + Math.sin(a) * R * 0.35, cy - Math.cos(a) * R * 0.35);
  g.lineTo(cx + Math.sin(a) * R * 0.98, cy - Math.cos(a) * R * 0.98);
  g.stroke();
}

// ---------- Effectschermen ----------

const VIZ = {
  eq: { w: 250, h: 116, label: 'EQ', paint(g, W, H, p) {
    const y = (db) => H / 2 - (db * (H / 2 - 14)) / 18;
    gridLines(g, W, H, { freqs: true, ys: [y(12), y(6), y(0), y(-6), y(-12)], yLabels: ['+12', '', '0', '', '-12'] });
    const parts = [response('highpass', p.lowCut, 0.707), response('lowshelf', p.lowFreq, 0.707, p.low), response('peaking', p.midFreq, p.midQ, p.mid), response('highshelf', p.highFreq, 0.707, p.high)];
    glowCurve(g, Array.from(FREQS, (f, i) => [fx(f, W), y(toDb(parts.reduce((m, r) => m * r[i], 1)))]), W, H, y(0));
    for (const [k, f, db] of eqNodes(p)) {
      const nx = fx(f, W), ny = k === 'C' ? y(0) : y(db);
      g.beginPath(); g.arc(nx, ny, 6, 0, Math.PI * 2);
      g.fillStyle = '#111113'; g.fill();
      g.strokeStyle = ORANGE; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = ORANGE; g.font = MONO; g.textAlign = 'center'; g.fillText(k, nx, ny + 3); g.textAlign = 'left';
    }
  } },
  comp: { w: 200, h: 116, label: 'Comp', live: true, paint(g, W, H, p, v) { paintVu(g, W, H, v.gr || 0); } },
  limiter: { w: 200, h: 116, label: 'Limiter', live: true, paint(g, W, H, p, v) { paintVu(g, W, H, v.gr || 0); } },
  sat: { w: 150, h: 116, label: 'Curve', paint(g, W, H, p) {
    gridLines(g, W, H, { ys: [H / 2], xs: [W / 2] });
    const k = 10 ** (p.drive / 20);
    g.strokeStyle = GRID_STRONG; g.beginPath(); g.moveTo(6, H - 6); g.lineTo(W - 6, 6); g.stroke();
    const pts = [];
    for (let i = 0; i <= 80; i++) { const x = i / 40 - 1; const yv = p.mix * Math.tanh(k * x) / Math.tanh(k) + (1 - p.mix) * x; pts.push([6 + ((x + 1) / 2) * (W - 12), H / 2 - yv * (H / 2 - 8)]); }
    glowCurve(g, pts, W, H, null);
  } },
  lofi: { w: 150, h: 116, label: 'Bits', paint(g, W, H, p) {
    gridLines(g, W, H, { ys: [H / 2], xs: [W / 2] });
    const lv = Math.min(32, 2 ** (Math.round(p.bits) - 1));
    const pts = [];
    for (let i = 0; i <= 300; i++) { const x = i / 150 - 1; const q = Math.round(x * lv) / lv; const yv = p.mix * q + (1 - p.mix) * x; pts.push([6 + ((x + 1) / 2) * (W - 12), H / 2 - yv * (H / 2 - 8)]); }
    glowCurve(g, pts, W, H, null);
  } },
  chorus: { w: 150, h: 116, label: 'LFO', paint(g, W, H, p) { paintLfo(g, W, H, p.depth, 2); } },
  phaser: { w: 150, h: 116, label: 'LFO', paint(g, W, H, p) { paintLfo(g, W, H, p.depth, 1.5); } },
  tremolo: { w: 150, h: 116, label: 'LFO', paint(g, W, H, p) { paintLfo(g, W, H, p.depth, 4 / p.rate > 8 ? 8 : 4 / p.rate, p.mode === 'pan' ? 'Links en rechts' : 'Volume'); } },
  autofilter: { w: 210, h: 116, label: 'Filter', paint(g, W, H, p) { paintFilter(g, W, H, p.type, p.cutoff, p.reso, 12, [p.cutoff / 4 ** p.depth, p.cutoff * 4 ** p.depth]); } },
  delay: { w: 210, h: 116, label: 'Taps', paint(g, W, H, p) {
    const span = p.time <= 1 ? 4 : 8;
    gridLines(g, W, H, { ys: [H / 2], xs: Array.from({ length: span - 1 }, (_, i) => ((i + 1) * W) / span) });
    for (let n = 0; n < 16; n++) {
      const t = n * p.time;
      if (t > span) break;
      const amp = n === 0 ? 1 : p.feedback ** (n - 1) * p.mix;
      const x = 6 + (t / span) * (W - 12);
      const up = !p.pingpong || n % 2 === 1 || n === 0;
      const len = amp * (H / 2 - 12);
      g.fillStyle = n === 0 ? 'rgba(255, 255, 255, 0.35)' : ORANGE;
      if (p.pingpong && n > 0) g.fillRect(x - 1.5, up ? H / 2 - len : H / 2, 3, len);
      else g.fillRect(x - 1.5, H / 2 - len, 3, len * 2);
    }
    if (p.pingpong) { g.font = MONO; g.fillStyle = LABEL; g.fillText('L', W - 12, 14); g.fillText('R', W - 12, H - 6); }
  } },
  reverb: { w: 210, h: 116, label: 'Decay', paint(g, W, H, p) {
    const span = Math.max(1, p.size * 1.15 + p.predelay);
    const X = (t) => 6 + (t / span) * (W - 12);
    gridLines(g, W, H, { ys: [H - 10], xs: [1, 2, 3].map((i) => (i * W) / 4) });
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.fillRect(X(0) - 1, 12, 2, H - 22);
    const pts = [], dark = [];
    for (let i = 0; i <= 120; i++) {
      const t = p.predelay + (i / 120) * (span - p.predelay);
      const e = Math.exp((-6.9 * (t - p.predelay)) / p.size) * (0.25 + p.mix * 0.75);
      pts.push([X(t), H - 10 - e * (H - 26)]);
      dark.push([X(t), H - 10 - Math.exp((-6.9 * (t - p.predelay)) / (p.size * (1 - p.damping * 0.7))) * (0.25 + p.mix * 0.75) * (H - 26)]);
    }
    glowCurve(g, pts, W, H, H - 10);
    g.beginPath();
    dark.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = SECOND; g.setLineDash([3, 3]); g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
    g.font = MONO; g.fillStyle = LABEL; g.fillText(`${p.size.toFixed(1)} s`, W - 40, 14);
  } },
  pump: { w: 180, h: 116, label: 'Envelope', paint(g, W, H, p) {
    const steps = Math.round(4 / p.rate);
    gridLines(g, W, H, { ys: [12, H - 10], xs: Array.from({ length: steps - 1 }, (_, i) => ((i + 1) * W) / steps) });
    const pts = [];
    for (let s = 0; s < steps; s++) {
      const x0 = 6 + (s / steps) * (W - 12), sw = (W - 12) / steps;
      pts.push([x0, 12], [x0 + 0.5, 12 + p.amount * (H - 22)], [x0 + sw * p.release, 12], [x0 + sw, 12]);
    }
    glowCurve(g, pts.map(([x, y]) => [x, y]), W, H, H - 10);
  } },
  width: { w: 150, h: 116, label: 'Stereo', paint(g, W, H, p) {
    gridLines(g, W, H, { xs: [W / 2], ys: [H / 2] });
    g.save();
    g.translate(W / 2, H / 2 + 4);
    g.beginPath();
    g.ellipse(0, 0, Math.max(1.5, ((W / 2 - 18) * p.width) / 2), H / 2 - 18, 0, 0, Math.PI * 2);
    g.fillStyle = ACCENT_FILL; g.fill();
    g.strokeStyle = ORANGE; g.lineWidth = 1.6; g.stroke();
    g.restore();
    g.font = MONO; g.fillStyle = LABEL; g.fillText('L', 6, H / 2 + 3); g.fillText('R', W - 12, H / 2 + 3);
  } },
};

const eqNodes = (p) => [['C', p.lowCut, 0], ['L', p.lowFreq, p.low], ['M', p.midFreq, p.mid], ['H', p.highFreq, p.high]];

// Banden van de EQ verslepen in het scherm.
function makeEqInteractive(scr, ins, refresh) {
  scr.cv.style.cursor = 'pointer';
  scr.cv.addEventListener('pointerdown', (e) => {
    const r = scr.cv.getBoundingClientRect();
    const W = scr.w, H = scr.h;
    const y = (db) => H / 2 - (db * (H / 2 - 14)) / 18;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, dist = 18;
    for (const [k, f, db] of eqNodes(ins.params)) {
      const d = Math.hypot(fx(f, W) - px, (k === 'C' ? y(0) : y(db)) - py);
      if (d < dist) { dist = d; best = k; }
    }
    if (!best) return;
    e.preventDefault();
    scr.cv.setPointerCapture(e.pointerId);
    const g = gesture();
    const keys = { C: ['lowCut', null], L: ['lowFreq', 'low'], M: ['midFreq', 'mid'], H: ['highFreq', 'high'] }[best];
    const defs = PLUGIN_DEFS.eq.params;
    const move = (ev) => {
      const mx = clamp(ev.clientX - r.left, 0, W), my = clamp(ev.clientY - r.top, 0, H);
      g.update(() => {
        ins.params[keys[0]] = Math.round(clamp(xf(mx, W), defs[keys[0]].min, defs[keys[0]].max));
        if (keys[1]) ins.params[keys[1]] = Math.round(clamp(((H / 2 - my) / (H / 2 - 14)) * 18, -15, 15) * 2) / 2;
      });
      scr.draw();
      refresh();
    };
    const up = () => { scr.cv.removeEventListener('pointermove', move); scr.cv.removeEventListener('pointerup', up); g.end('params'); };
    scr.cv.addEventListener('pointermove', move);
    scr.cv.addEventListener('pointerup', up);
  });
}

// ---------- Behuizing van een apparaat ----------

function frame({ title, on, onPower, tools = [], lead = [], body, cls, info }) {
  const power = onPower ? h('button.power', { class: on ? 'on' : null, 'aria-pressed': String(!!on), 'aria-label': `${title} aan/uit`, title: 'Aan/uit' }, icon('power')) : null;
  const dev = h('div.device', { class: [cls, onPower && !on ? 'off' : null].filter(Boolean).join(' ') || null },
    h('div.dev-head', { title: info || null }, power, h('span.dev-title', {}, title), ...lead, h('span.grow'), ...tools),
    h('div.dev-body', {}, body));
  power?.addEventListener('click', () => {
    const now = !power.classList.contains('on');
    power.classList.toggle('on', now);
    power.setAttribute('aria-pressed', String(now));
    dev.classList.toggle('off', !now);
    onPower(now);
  });
  return dev;
}

const col = (label, ...children) => h('div.dev-col', {}, label ? h('span.dev-sec', {}, label) : null, ...children);
const knobGrid = (cols, knobs) => h('div.knobs', { style: { '--cols': cols } }, knobs);
const fieldSm = (label, control) => h('label.field-sm', {}, h('span', {}, label), control);

// ---------- Effect ----------

export function effectDevice(ins, { chainKey, onRemove, onMove, first, last }) {
  const def = PLUGIN_DEFS[ins.type];
  const viz = VIZ[ins.type];
  const knobs = [];
  const controls = [];
  let scr = null;
  const redraw = () => scr?.draw();
  const refreshKnobs = () => knobs.forEach((k) => k.refresh());
  for (const [key, pd] of Object.entries(def.params)) {
    if (pd.type === 'toggle') {
      controls.push(fieldSm(pd.label, pick([[true, 'Aan'], [false, 'Uit']], ins.params[key], (v) => { commit(() => { ins.params[key] = v; }, 'params'); redraw(); })));
    } else if (pd.type === 'select') {
      const numeric = typeof pd.def === 'number';
      const set = (v) => { commit(() => { ins.params[key] = numeric ? +v : v; }, 'params'); redraw(); };
      controls.push(fieldSm(pd.label, pd.options.length <= 4
        ? pick(pd.options.map(([v, l]) => [v, l, l]), ins.params[key], set)
        : select(pd.options, ins.params[key], set)));
    } else {
      knobs.push(knob({
        label: pd.label, min: pd.min, max: pd.max, step: pd.step ?? 0.01, def: pd.def, curve: pd.curve,
        get: () => ins.params[key], set: (v) => { ins.params[key] = v; }, format: (v) => formatParam(pd, v).replace(' ', ''), onChange: redraw,
      }));
    }
  }
  const liveState = { gr: 0 };
  if (viz) {
    scr = screen(viz.w, viz.h, viz.label, (g, W, H, val) => {
      viz.paint(g, W, H, ins.params, liveState);
      if (viz.live) val.textContent = `${liveState.gr > 0.05 ? '-' : ''}${liveState.gr.toFixed(1)} dB`;
    });
    if (ins.type === 'eq') makeEqInteractive(scr, ins, refreshKnobs);
    if (viz.live) {
      liveViews.add({
        tick(engine) {
          if (!scr.el.isConnected) return;
          const gr = -(engine.reduction(chainKey, ins.id) || 0);
          const next = liveState.gr * 0.7 + Math.max(0, gr) * 0.3;
          if (Math.abs(next - liveState.gr) > 0.02 || (next > 0 && next < 0.05)) { liveState.gr = next < 0.02 ? 0 : next; scr.draw(); }
        },
      });
    }
  }
  const cols = knobs.length > 4 ? Math.ceil(knobs.length / 2) : knobs.length;
  const tools = [
    h('button.tbtn.ic', { disabled: first, onclick: () => onMove(-1), 'aria-label': 'Naar links', title: 'Naar links in de keten' }, icon('chevronLeft', 14)),
    h('button.tbtn.ic', { disabled: last, onclick: () => onMove(1), 'aria-label': 'Naar rechts', title: 'Naar rechts in de keten' }, icon('chevron', 14)),
    h('button.tbtn.ic', { onclick: onRemove, 'aria-label': `${def.name} verwijderen`, title: 'Verwijderen' }, icon('close', 13)),
  ];
  return frame({
    title: def.name, info: def.info, on: ins.on, tools,
    onPower: (on) => commit(() => { ins.on = on; }, 'params'),
    body: [
      scr || controls.length ? col(null, scr?.el, controls.length ? h('div.dev-col', { style: { gap: '6px' } }, controls) : null) : null,
      knobs.length ? col(null, knobGrid(cols, knobs)) : null,
    ],
  });
}

// ---------- Instrumenten ----------

export function synthDevice(track, app) {
  const s = track.synth;
  const P = { ...BASE_SYNTH, ...SYNTH_PRESETS[s.preset] };
  const screens = [];
  const redraw = () => screens.forEach((x) => x.draw());
  const K = (label, key, min, max, step, format, curve, extra = {}) => knob({ label, min, max, step, format, curve, def: P[key], small: true, size: 40, get: () => s[key], set: (v) => { s[key] = v; }, onChange: redraw, ...extra });
  const setP = (key, numeric = false) => (v) => { commit(() => { s[key] = numeric ? +v : v; }, 'params'); redraw(); };

  const filterScr = screen(214, 84, 'Filter', (g, W, H, val) => {
    paintFilter(g, W, H, s.filterType, s.cutoff, s.reso, s.slope);
    val.textContent = `${hz(s.cutoff)}Hz`;
  });
  const envScr = screen(214, 84, 'Envelope', (g, W, H) => paintEnvelope(g, W, H, { a: s.attack, d: s.decay, s: s.sustain, r: s.release }, { a: s.fAttack, d: s.fDecay, s: s.fSustain }));
  screens.push(filterScr, envScr);

  const presetSel = h('select', { 'aria-label': 'Preset' });
  const cats = {};
  for (const [n, d] of Object.entries(SYNTH_PRESETS)) (cats[d.cat] ||= []).push(n);
  for (const [cat, names] of Object.entries(cats)) presetSel.append(h('optgroup', { label: cat }, names.map((n) => h('option', { value: n }, n))));
  presetSel.value = s.preset;
  presetSel.addEventListener('change', () => { commit(() => { track.synth = defaultSynth(presetSel.value); }); app.audition(track, 60, 0.8); });
  const step = (dir) => {
    const names = Object.keys(SYNTH_PRESETS);
    commit(() => { track.synth = defaultSynth(names[(names.indexOf(s.preset) + dir + names.length) % names.length]); });
    app.audition(track, 60, 0.8);
  };

  return frame({
    title: 'Synth', cls: 'instrument', info: 'Subtractieve synth met unison, FM, filter en LFO',
    lead: [
      h('button.tbtn.ic', { onclick: () => step(-1), 'aria-label': 'Vorige preset', title: 'Vorige preset' }, icon('chevronLeft', 14)), presetSel,
      h('button.tbtn.ic', { onclick: () => step(1), 'aria-label': 'Volgende preset', title: 'Volgende preset' }, icon('chevron', 14)),
      h('button.btn.small', { onclick: () => app.audition(track, 60, 0.85) }, icon('play', 12), 'Luister'),
    ],
    body: [
      col('Osc 1', pick(waveOptions(), s.wave1, setP('wave1')),
        knobGrid(3, [K('Unison', 'unison', 1, 7, 1, (v) => `${Math.round(v)}×`), K('Detune', 'uniDetune', 0, 80, 0.5, ct), K('Breedte', 'uniSpread', 0, 1, 0.01, pct)])),
      col('Osc 2', pick(waveOptions(), s.wave2, setP('wave2')),
        pick([[-2, '-2'], [-1, '-1'], [0, '0'], [1, '+1'], [2, '+2']], s.osc2Oct, setP('osc2Oct', true), { label: 'Octaaf' }),
        knobGrid(3, [K('Semi', 'osc2Semi', -12, 12, 1, st), K('Fijn', 'detune', -50, 50, 0.5, ct), K('Mix', 'mix', 0, 1, 0.01, pct)])),
      col('Mod', knobGrid(3, [K('FM', 'fm', 0, 1.5, 0.01, pct), K('FM-verval', 'fmDecay', 0.01, 4, 0.01, ms, 'exp'), K('FM-rest', 'fmSustain', 0, 1, 0.01, pct), K('Sub', 'sub', 0, 1, 0.01, pct), K('Ruis', 'noise', 0, 1, 0.01, pct)])),
      col('Filter', filterScr.el,
        h('div', { style: { display: 'flex', gap: '6px' } },
          pick([['lowpass', 'LP', 'Laagdoorlaat'], ['highpass', 'HP', 'Hoogdoorlaat'], ['bandpass', 'BP', 'Banddoorlaat']], s.filterType, setP('filterType')),
          pick([[12, '12dB'], [24, '24dB']], s.slope, setP('slope', true))),
        knobGrid(5, [K('Cutoff', 'cutoff', 40, 16000, 1, hz, 'exp'), K('Reso', 'reso', 0.1, 20, 0.1, (v) => v.toFixed(1)), K('Env', 'envAmt', 0, 8000, 10, hz), K('Key', 'keyTrack', 0, 1, 0.01, pct), K('Drive', 'drive', 0, 1, 0.01, pct)])),
      col('Envelopes', envScr.el,
        knobGrid(7, [K('Att', 'attack', 0.001, 3, 0.001, ms, 'exp'), K('Dec', 'decay', 0.01, 4, 0.01, ms, 'exp'), K('Sus', 'sustain', 0, 1, 0.01, pct), K('Rel', 'release', 0.01, 5, 0.01, ms, 'exp'),
          K('F-att', 'fAttack', 0.001, 3, 0.001, ms, 'exp', { color: SECOND }), K('F-dec', 'fDecay', 0.01, 4, 0.01, ms, 'exp', { color: SECOND }), K('F-sus', 'fSustain', 0, 1, 0.01, pct, null, { color: SECOND })])),
      col('LFO', pick([['pitch', 'Toon', 'Vibrato'], ['filter', 'Filter', 'Filter'], ['amp', 'Volume', 'Tremolo']], s.lfoTarget, setP('lfoTarget')),
        pick(waveOptions(), s.lfoWave, setP('lfoWave')),
        knobGrid(2, [K('Snelheid', 'lfoRate', 0.05, 20, 0.01, hz, 'exp'), K('Diepte', 'lfoAmount', 0, 1, 0.01, pct)])),
      col('Uit', knobGrid(1, [knob({ label: 'Volume', min: 0, max: 1, step: 0.01, def: P.gain, size: 54, get: () => s.gain, set: (v) => { s.gain = v; }, format: pct })])),
    ],
  });
}

let selPad = 36;
export function drumsDevice(track, app) {
  const k = track.drums;
  const padOf = (p) => k.pads[p] || {};
  const keyOf = (p) => 'AWSEDFTGYHUJ'[DRUM_KEYS.indexOf(p)] || '';
  const editor = h('div.pad-edit');
  const padButtons = DRUM_ROWS.map(({ p, name }) => {
    const b = h('button.pad', { class: [p === selPad ? 'sel' : null, padOf(p).audioId ? 'has-sample' : null].filter(Boolean).join(' ') || null, title: `${name}: klik om te horen en in te stellen` },
      h('span', {}, name), h('small', {}, keyOf(p) ? `toets ${keyOf(p)}` : ''));
    b.addEventListener('pointerdown', () => {
      selPad = p;
      app.audition(track, p, 0.9);
      for (const x of padButtons) x.classList.remove('sel');
      b.classList.add('sel', 'hit');
      setTimeout(() => b.classList.remove('hit'), 110);
      renderEditor();
    });
    return b;
  });
  function renderEditor() {
    const p = selPad;
    const name = DRUM_ROWS.find((r) => r.p === p)?.name || '';
    const pd = padOf(p);
    const PK = (label, key, min, max, step, format, def) => knob({ label, min, max, step, def, format, small: true, size: 40, get: () => padOf(p)[key] ?? def, set: (v) => { (k.pads[p] ||= {})[key] = v; } });
    const sample = pd.audioId
      ? h('div.sample-chip', {}, icon('wave', 14), h('span', {}, pd.sampleName || 'Sample'),
        h('button.tbtn', { onclick: () => commit(() => { delete k.pads[p].audioId; delete k.pads[p].sampleName; }), 'aria-label': 'Sample weghalen' }, icon('close', 13)))
      : h('button.btn.small', { onclick: async () => { const res = await app.pickSample(); if (res) commit(() => { k.pads[p] = { ...padOf(p), audioId: res.id, sampleName: res.name }; }); } }, 'Eigen sample…');
    editor.replaceChildren(h('span.dev-sec', {}, 'Pad'), h('h4', {}, name),
      knobGrid(3, [PK('Volume', 'level', 0, 1.5, 0.01, pct, 1), PK('Stem', 'tune', -12, 12, 0.5, st, 0), PK('Lengte', 'decay', 0.2, 2.5, 0.01, pct, 1)]), sample);
  }
  renderEditor();
  const kitSel = select(Object.entries(DRUM_KITS).map(([id, d]) => [id, d.name]), k.kit, (v) => { commit(() => { k.kit = v; }, 'params'); app.audition(track, 36, 0.9); }, { 'aria-label': 'Kit' });
  return frame({
    title: 'Drumcomputer', cls: 'instrument', info: 'Vier kits met twaalf geluiden; elke pad kan een eigen sample krijgen',
    lead: [kitSel],
    body: [
      col('Kit', knobGrid(1, [
        knob({ label: 'Stemming', min: -12, max: 12, step: 0.5, def: 0, small: true, size: 40, get: () => k.tune, set: (v) => { k.tune = v; }, format: st }),
        knob({ label: 'Lengte', min: 0.3, max: 2.5, step: 0.01, def: 1, small: true, size: 40, get: () => k.decay, set: (v) => { k.decay = v; }, format: pct }),
        knob({ label: 'Volume', min: 0, max: 1, step: 0.01, def: 0.9, small: true, size: 40, get: () => k.level, set: (v) => { k.level = v; }, format: pct }),
      ])),
      col('Pads', h('div.pads', {}, padButtons)),
      h('div.dev-col', {}, editor),
    ],
  });
}

export function samplerDevice(track, app) {
  const s = track.sampler;
  const markers = () => (s.loop ? [['start', 'S'], ['loopStart', 'L'], ['loopEnd', 'E']] : [['start', 'S']]);
  const scr = screen(320, 120, s.sampleName || 'Sample', (g, W, H) => {
    gridLines(g, W, H, { ys: [H / 2], xs: [1, 2, 3].map((i) => (i * W) / 4) });
    const peaks = app.peaks.get(s.audioId);
    if (!peaks) { g.font = MONO; g.fillStyle = LABEL; g.fillText('Kies een bestand of een geluid uit de browser', 14, H / 2 + 3); return; }
    if (s.loop) { g.fillStyle = ACCENT_FILL; g.fillRect(s.loopStart * W, 0, (s.loopEnd - s.loopStart) * W, H); }
    g.fillStyle = ORANGE;
    for (let x = 0; x < W; x += 3) {
      const v = peaks[Math.floor((x / W) * peaks.length)];
      const hh = Math.max(1, v * (H - 26));
      g.globalAlpha = x / W < s.start ? 0.25 : 0.95;
      g.fillRect(x, H / 2 - hh / 2, 2, hh);
    }
    g.globalAlpha = 1;
    g.font = MONO;
    for (const [key, lab] of markers()) {
      const x = s[key] * W;
      g.fillStyle = key === 'start' ? '#fff' : ORANGE;
      g.fillRect(x - 0.5, 0, 1, H);
      g.fillRect(x - 0.5, 0, 12, 11);
      g.fillStyle = '#111113';
      g.fillText(lab, x + 2, 9);
    }
  });
  scr.cv.style.cursor = 'ew-resize';
  scr.cv.addEventListener('pointerdown', (e) => {
    if (!app.peaks.get(s.audioId)) return;
    const r = scr.cv.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    let best = 'start', dist = Infinity;
    for (const [key] of markers()) { const d = Math.abs(s[key] - f); if (d < dist) { dist = d; best = key; } }
    e.preventDefault();
    scr.cv.setPointerCapture(e.pointerId);
    const g = gesture();
    const move = (ev) => {
      const v = clamp((ev.clientX - r.left) / r.width, 0, 1);
      g.update(() => {
        if (best === 'loopStart') s.loopStart = Math.min(v, s.loopEnd - 0.01);
        else if (best === 'loopEnd') s.loopEnd = Math.max(v, s.loopStart + 0.01);
        else s.start = Math.min(v, 0.95);
      });
      scr.draw();
    };
    move(e);
    const up = () => { scr.cv.removeEventListener('pointermove', move); scr.cv.removeEventListener('pointerup', up); g.end('params'); };
    scr.cv.addEventListener('pointermove', move);
    scr.cv.addEventListener('pointerup', up);
  });
  const roots = [];
  for (let n = 24; n <= 96; n++) roots.push([n, noteName(n)]);
  const K = (label, key, min, max, step, format, def, curve) => knob({ label, min, max, step, format, def, curve, small: true, size: 40, get: () => s[key], set: (v) => { s[key] = v; } });
  return frame({
    title: 'Sampler', cls: 'instrument', info: 'Speelt een sample chromatisch af',
    lead: [h('button.btn.small', { onclick: () => app.audition(track, s.root, 0.85) }, icon('play', 12), 'Luister')],
    body: [
      col('Sample', scr.el, h('div', { style: { display: 'flex', gap: '6px' } },
        h('button.btn.small', { onclick: async () => { const res = await app.pickSample(); if (res) commit(() => { s.audioId = res.id; s.sampleName = res.name; }); } }, 'Bestand kiezen…'),
        h('button.btn.small', { onclick: () => app.openBrowser('sounds', 'Instrumenten') }, 'Uit de browser'))),
      col('Toon',
        fieldSm('Grondtoon', select(roots, s.root, (v) => commit(() => { s.root = +v; }, 'params'))),
        fieldSm('Loop', pick([[true, 'Aan'], [false, 'Uit']], s.loop, (v) => { commit(() => { s.loop = v; }, 'params'); scr.draw(); })),
        knobGrid(1, [K('Fijn', 'fine', -100, 100, 1, ct, 0)])),
      col('Envelope', knobGrid(3, [K('Att', 'attack', 0.001, 3, 0.001, ms, 0.003, 'exp'), K('Dec', 'decay', 0.01, 4, 0.01, ms, 0.5, 'exp'), K('Sus', 'sustain', 0, 1, 0.01, pct, 1),
        K('Rel', 'release', 0.01, 5, 0.01, ms, 0.3, 'exp'), K('Filter', 'cutoff', 80, 18000, 1, hz, 18000, 'exp'), K('Volume', 'gain', 0, 1.5, 0.01, pct, 0.8)])),
    ],
  });
}

export function audioDevice(track, app) {
  const clip = track.clips.find((c) => c.id === state.sel.clipId);
  const beats = (v) => `${v.toFixed(2)} tel`;
  const K = (label, key, min, max, step, format, def) => knob({ label, min, max, step, def, format, scope: 'clip', get: () => clip[key] ?? def, set: (v) => { clip[key] = v; } });
  return frame({
    title: 'Audio', cls: 'instrument', info: 'Audiospoor: opnemen of bestanden plaatsen',
    body: [
      col('Spoor',
        h('p.hint', { style: { maxWidth: '260px' } }, 'Zet opname aan (●) en druk op opnemen om via de microfoon op te nemen. Of sleep een bestand of een geluid uit de browser op het spoor.'),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button.btn.small', { onclick: () => app.pickAudio(track.id, null) }, 'Bestand kiezen…'),
          h('button.btn.small', { onclick: () => app.openBrowser('sounds') }, 'Browser'))),
      clip ? col(`Clip · ${clip.name || 'audio'}`, knobGrid(3, [
        K('Volume', 'gain', 0, 2, 0.01, pct, 1),
        K('Fade in', 'fadeIn', 0, Math.max(0.25, clip.length / 2), 0.01, beats, 0),
        K('Fade uit', 'fadeOut', 0, Math.max(0.25, clip.length / 2), 0.01, beats, 0),
      ])) : col('Clip', h('p.hint', { style: { maxWidth: '200px' } }, 'Selecteer een audioclip om volume en fades in te stellen.')),
    ],
  });
}

export function masterDevice(p) {
  return frame({
    title: 'Master', cls: 'instrument', info: 'Alles wat je hoort gaat door de master',
    body: [col('Uitgang',
      knobGrid(1, [knob({ label: 'Volume', min: -60, max: 6, step: 0.5, def: 0, size: 58, get: () => p.masterVolume, set: (v) => { p.masterVolume = v; }, format: (v) => `${v.toFixed(1)}dB` })]),
      h('p.hint', { style: { maxWidth: '170px' } }, 'Standaard: lijmcompressor en limiter, zodat je mix voller klinkt en niet vervormt.'))],
  });
}
