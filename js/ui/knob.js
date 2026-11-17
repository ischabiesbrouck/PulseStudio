// Draaiknop (SVG): ring met streepjes, gloeiende waardeboog en wijzer.
// Slepen omhoog/omlaag (Shift = fijn), scrollwiel, pijltjestoetsen; dubbelklik zet de standaardwaarde terug.
import { gesture } from '../state.js';
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let defs = false;
function ensureDefs() {
  if (defs) return;
  defs = true;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = '<defs><radialGradient id="knobGrad" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#3a3a44"/><stop offset="70%" stop-color="#1d1d23"/><stop offset="100%" stop-color="#141418"/></radialGradient></defs>';
  document.body.append(svg);
}

const pt = (c, r, a) => [c + r * Math.sin((a * Math.PI) / 180), c - r * Math.cos((a * Math.PI) / 180)];
function arc(c, r, a0, a1) {
  const [x0, y0] = pt(c, r, a0);
  const [x1, y1] = pt(c, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function knob({ label, min, max, step = 0.01, get, set, format = (v) => v, def, curve, scope = 'params', size = 44, color, small = false, onChange, title }) {
  ensureDefs();
  const exp = curve === 'exp' && min > 0;
  const toFrac = (v) => clamp(exp ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min), 0, 1);
  const fromFrac = (f) => {
    f = clamp(f, 0, 1);
    let v = exp ? min * (max / min) ** f : min + f * (max - min);
    if (!exp && step) v = Math.round(v / step) * step;
    return +clamp(v, min, max).toFixed(6);
  };
  const bipolar = !exp && min < 0 && max > 0;
  const c = size / 2;
  const r = c - 6;
  const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  for (let i = 0; i <= 10; i++) {
    const [x, y] = pt(c, c - 1.2, -135 + i * 27);
    svg.append(el('circle', { cx: x, cy: y, r: i % 5 === 0 ? 1.1 : 0.7, class: 'k-tick' }));
  }
  const w = small ? 2.4 : 2.8;
  svg.append(el('path', { d: arc(c, r, -135, 135), class: 'k-track', 'stroke-width': w }));
  const valArc = el('path', { class: 'k-val', 'stroke-width': w });
  svg.append(valArc);
  svg.append(el('circle', { cx: c, cy: c, r: r - 4.5, class: 'k-body' }));
  const ind = el('line', { class: 'k-ind', 'stroke-width': 1.8 });
  svg.append(ind);

  const val = h('span.knob-val');
  const root = h('div.knob', {
    class: small ? 'small' : null, tabindex: '0', role: 'slider', 'aria-label': label,
    'aria-valuemin': min, 'aria-valuemax': max, title: title || `${label}: sleep omhoog of omlaag (Shift = fijn), dubbelklik = standaard`,
    style: color ? { '--kc': color } : null,
  }, svg, val, h('span.knob-lbl', {}, label));

  function draw(v) {
    const f = toFrac(v);
    const a = -135 + f * 270;
    const a0 = bipolar ? -135 + toFrac(0) * 270 : -135;
    const lo = Math.min(a0, a), hi = Math.max(a0, a);
    valArc.setAttribute('d', hi - lo < 0.5 ? '' : arc(c, r, lo, hi));
    const [x0, y0] = pt(c, (r - 4.5) * 0.25, a);
    const [x1, y1] = pt(c, r - 7, a);
    ind.setAttribute('x1', x0); ind.setAttribute('y1', y0); ind.setAttribute('x2', x1); ind.setAttribute('y2', y1);
    val.textContent = format(v);
    root.setAttribute('aria-valuenow', v);
    root.setAttribute('aria-valuetext', format(v));
  }

  const apply = (g, v) => { g.update(() => set(v), scope); draw(v); onChange?.(v); };

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    root.focus();
    root.setPointerCapture(e.pointerId);
    let y0 = e.clientY;
    let f0 = toFrac(get());
    let g = null;
    const move = (ev) => {
      const fine = ev.shiftKey;
      const f = f0 + (y0 - ev.clientY) / (fine ? 700 : 170);
      if (f < 0 || f > 1) { f0 = clamp(f, 0, 1); y0 = ev.clientY; }
      g ||= gesture();
      apply(g, fromFrac(f));
    };
    const up = () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      g?.end(scope);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });

  // Scrollwiel en toetsen: korte reeksen tellen als één stap voor ongedaan maken.
  let nudgeG = null, nudgeT = null;
  const nudge = (delta) => {
    nudgeG ||= gesture();
    apply(nudgeG, fromFrac(toFrac(get()) + delta));
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => { nudgeG?.end(scope); nudgeG = null; }, 450);
  };
  root.addEventListener('wheel', (e) => { e.preventDefault(); nudge((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.005 : 0.025)); }, { passive: false });
  root.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    nudge(d * (e.shiftKey ? 0.005 : 0.02));
  });
  if (def != null) {
    root.addEventListener('dblclick', () => { const g = gesture(); apply(g, def); g.end(scope); });
  }

  draw(get());
  root.refresh = () => draw(get());
  return root;
}

// Gesegmenteerde keuze (bijvoorbeeld golfvorm of filtertype).
export function pick(options, value, onChange, { label } = {}) {
  const wrap = h('div.pick', { role: 'radiogroup', 'aria-label': label });
  for (const [v, content, tip] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(String(v) === String(value)), class: String(v) === String(value) ? 'on' : null, title: tip || null }, content);
    b.addEventListener('click', () => {
      for (const x of wrap.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); }
      b.classList.add('on');
      b.setAttribute('aria-checked', 'true');
      onChange(v);
    });
    wrap.append(b);
  }
  return wrap;
}

const WAVE_PATHS = {
  sine: 'M1 6C3.5 0 6.5 0 9 6S14.5 12 17 6',
  triangle: 'M1 6L5 1.5L13 10.5L17 6',
  sawtooth: 'M1 10.5L9 1.5V10.5L17 1.5V10.5',
  square: 'M1 10.5V1.5H9V10.5H17V1.5',
};
export function waveIcon(type) {
  const svg = el('svg', { viewBox: '0 0 18 12', fill: 'none' });
  svg.append(el('path', { d: WAVE_PATHS[type], stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return svg;
}
export const waveOptions = () => [['sine', waveIcon('sine'), 'Sinus'], ['triangle', waveIcon('triangle'), 'Driehoek'], ['sawtooth', waveIcon('sawtooth'), 'Zaagtand'], ['square', waveIcon('square'), 'Blok']];
