// Kleine DOM-hulpjes: elementen maken, meldingen en schuifregelaars met ongedaan maken.
import { gesture } from '../state.js';

// h('div.klasse.andere', { attributen, onclick }, ...kinderen)
export function h(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const ICONS = {
  play: 'M7 5v14l12-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  record: 'M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z',
  back: 'M6 5h2v14H6zM20 5v14L9 12z',
  loop: 'M7 7h9l-2-2 1.4-1.4L19.8 8l-4.4 4.4L14 11l2-2H7a2 2 0 0 0-2 2v2H3v-2a4 4 0 0 1 4-4zm10 10H8l2 2-1.4 1.4L4.2 16l4.4-4.4L10 13l-2 2h9a2 2 0 0 0 2-2v-2h2v2a4 4 0 0 1-4 4z',
  metro: 'M10 3h4l4.5 17h-13zM12 6.5 11 10h2zM13 12l5-6 1.4 1.2-5.2 6.2z',
  undo: 'M8 7V3L2 9l6 6v-4h6a4 4 0 0 1 0 8h-3v2h3a6 6 0 0 0 0-12z',
  redo: 'M16 7V3l6 6-6 6v-4h-6a4 4 0 0 0 0 8h3v2h-3a6 6 0 0 1 0-12z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z',
  folder: 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  download: 'M11 4h2v9l3.5-3.5L18 11l-6 6-6-6 1.5-1.5L11 13zM5 19h14v2H5z',
  upload: 'M11 20h2v-9l3.5 3.5L18 13l-6-6-6 6 1.5 1.5L11 11zM5 3h14v2H5z',
  midi: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-4 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 6.5A1.5 1.5 0 1 1 12 9.5 1.5 1.5 0 0 1 12 6.5zm-3.2 1.6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6.4 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 14h-2v-2h2zm2-6.5c-.6 1-1.9 1.4-2 2.5h-2c0-2 1.6-2.5 2.2-3.4.5-.8 0-2.1-1.2-2.1-1 0-1.6.7-1.7 1.6H8.3C8.4 7.2 10 6 12 6c2.6 0 4 2.3 3 4.5z',
};

export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

let toastTimer = null;
export function toast(message, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) document.body.append((el = h('div.toast', { role: 'status' })));
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Schuifregelaar voor een projectwaarde. Slepen is één stap voor ongedaan maken; dubbelklik zet de standaardwaarde terug.
// `curve: 'exp'` geeft een logaritmische schaal (handig voor frequenties en tijden).
export function param({ label, min, max, step = 0.01, get, set, format = (v) => v, def, curve, scope = 'params', vertical = false }) {
  const exp = curve === 'exp';
  const toSlider = (v) => (exp ? Math.log(v / min) / Math.log(max / min) : v);
  const fromSlider = (s) => (exp ? min * (max / min) ** s : s);
  const input = h('input', {
    type: 'range',
    min: exp ? 0 : min,
    max: exp ? 1 : max,
    step: exp ? 0.001 : step,
    'aria-label': label,
    class: vertical ? 'vertical' : null,
  });
  input.value = toSlider(get());
  const out = h('span.val', {}, format(get()));
  let g = null;
  input.addEventListener('input', () => {
    if (!g) g = gesture();
    const v = fromSlider(+input.value);
    g.update(() => set(v), scope);
    out.textContent = format(v);
  });
  input.addEventListener('change', () => { g?.end(scope); g = null; });
  if (def != null) {
    input.addEventListener('dblclick', () => {
      const gg = gesture();
      gg.update(() => set(def), scope);
      gg.end(scope);
      input.value = toSlider(def);
      out.textContent = format(def);
    });
  }
  return h('label.param', { title: def != null ? 'Dubbelklik voor de standaardwaarde' : null }, h('span.lbl', {}, label), input, out);
}

export function select(options, value, onChange, attrs = {}) {
  const el = h('select', attrs, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = String(value);
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, hgt = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hgt * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h: hgt };
}

export function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
