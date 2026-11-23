// Alles wat de app nodig heeft moet in de service worker (offline en snel starten) en in de modulepreload-lijst
// van index.html (alles tegelijk downloaden) staan. Vergeten bestanden zorgen anders voor trage of mislukte starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(join(root, p), 'utf8');

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(relative('.', p).replace(/\\/g, '/'));
  }
  return out;
}

const shell = [...read('sw.js').matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const preload = [...read('index.html').matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
// Bestanden die niet via import in de pagina komen: de AudioWorklet en de worker.
const NOT_IMPORTED = ['js/audio/worklets.js', 'js/audio/stretch-worker.js'];

test('elk JavaScript-bestand staat in de service worker', () => {
  for (const f of jsFiles('js')) assert.ok(shell.includes(f), `${f} ontbreekt in SHELL van sw.js`);
});

test('elke geïmporteerde module wordt vooraf geladen', () => {
  for (const f of jsFiles('js')) {
    if (NOT_IMPORTED.includes(f)) continue;
    assert.ok(preload.includes(f), `${f} ontbreekt als modulepreload in index.html`);
  }
  for (const f of preload) assert.ok(shell.includes(f), `${f} staat wel in index.html maar niet in sw.js`);
});

test('geen externe lettertypes of stylesheets bij het starten', () => {
  const html = read('index.html');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html));
  assert.ok(shell.includes('fonts/archivo-latin.woff2') && shell.includes('fonts/archivo-narrow-latin.woff2'));
});
