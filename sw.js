// Service worker: na het eerste bezoek start PulseStudio direct uit de cache, ook met een trage of wegvallende verbinding.
//   - De pagina zelf (index.html) haalt hij eerst van het netwerk (maximaal 3 seconden), anders uit de cache.
//   - Code, stijl, lettertypes en iconen komen uit de cache van deze versie. Een nieuwe versie (VERSION ophogen)
//     wordt op de achtergrond geïnstalleerd; de app meldt dan dat herladen de nieuwe versie geeft.
// Houd SHELL gelijk aan de modulepreload-lijst in index.html (tests/shell.test.js controleert dat).
const VERSION = 'pulsestudio-v8';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon.svg',
  './fonts/archivo-latin.woff2', './fonts/archivo-narrow-latin.woff2',
  './js/app.js', './js/model.js', './js/state.js', './js/store.js', './js/wav.js', './js/demo-song.js',
  './js/audio/engine.js', './js/audio/chain.js', './js/audio/instruments.js', './js/audio/recorder.js',
  './js/audio/plugins.js', './js/audio/plugin-defs.js', './js/audio/library.js',
  './js/audio/dsp.js', './js/audio/samplelib.js', './js/audio/patterns.js',
  './js/audio/stretch.js', './js/audio/stretch-worker.js', './js/audio/warp.js', './js/audio/worklets.js', './js/audio/loudness.js', './js/audio/wam.js', './js/audio/pitch.js',
  './js/vendor/wam/initializeWamHost.js', './js/vendor/wam/apiVersion.js', './js/vendor/wam/addFunctionModule.js', './js/vendor/wam/WamEnv.js', './js/vendor/wam/WamGroup.js',
  './js/ui/dom.js', './js/ui/theme.js', './js/ui/knob.js', './js/ui/devices.js', './js/ui/arrange.js', './js/ui/editor.js',
  './js/ui/mixer.js', './js/ui/inspector.js', './js/ui/browser.js',
];

self.addEventListener('install', (e) => {
  // `cache: 'reload'`: altijd de echte nieuwe bestanden, niet een oudere kopie uit de HTTP-cache van de browser.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Oude versies van de app opruimen; de cache met opnames (pulsestudio-samples-…) blijft staan.
    for (const k of await caches.keys()) if (k !== VERSION && (/^pulsestudio-v\d+$/.test(k) || k === 'pulsestudio-fonts')) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(3000)]);
        if (res.ok) cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await cache.match('./index.html')) || (await caches.match('./index.html')) || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
