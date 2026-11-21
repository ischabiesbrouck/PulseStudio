// Service worker: de app werkt ook offline. Netwerk eerst, met de cache als terugval.
const VERSION = 'pulsestudio-v6';
const FONT_CACHE = 'pulsestudio-fonts';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon.svg',
  './js/app.js', './js/model.js', './js/state.js', './js/store.js', './js/wav.js',
  './js/audio/engine.js', './js/audio/chain.js', './js/audio/instruments.js', './js/audio/recorder.js',
  './js/audio/plugins.js', './js/audio/plugin-defs.js', './js/audio/library.js',
  './js/audio/dsp.js', './js/audio/samplelib.js', './js/audio/patterns.js',
  './js/audio/stretch.js', './js/audio/stretch-worker.js', './js/audio/warp.js', './js/audio/worklets.js', './js/audio/loudness.js', './js/audio/wam.js',
  './js/vendor/wam/initializeWamHost.js', './js/vendor/wam/apiVersion.js', './js/vendor/wam/addFunctionModule.js', './js/vendor/wam/WamEnv.js', './js/vendor/wam/WamGroup.js',
  './js/ui/dom.js', './js/ui/theme.js', './js/ui/knob.js', './js/ui/devices.js', './js/ui/arrange.js', './js/ui/editor.js',
  './js/ui/mixer.js', './js/ui/inspector.js', './js/ui/browser.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== FONT_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Lettertypes (Google Fonts): na de eerste keer uit de cache, zodat de app ook offline zijn typografie houdt.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; } catch { return new Response('', { status: 503 }); }
    })());
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? await cache.match('./index.html') : null)
        || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
