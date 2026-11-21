// Tijdrekken van audioclips: welke buffer en afspeelsnelheid een clip gebruikt, met een cache van gerekte versies.
// Het rekenwerk gebeurt in een worker; tot een versie klaar is, speelt de clip als repitch (zelfde timing, andere toonhoogte).
import { stretch, reverse, detectTempo } from './stretch.js';
import { audioTimeRatio, audioPitch } from '../model.js';

let worker = null;
try { worker = new Worker(new URL('./stretch-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }

let seq = 0;
const waiting = new Map();
if (worker) {
  worker.onmessage = (e) => {
    const job = waiting.get(e.data.id);
    if (!job) return;
    waiting.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else if (e.data.cancelled) job.reject(Object.assign(new Error('geannuleerd'), { cancelled: true }));
    else job.resolve(e.data);
  };
  worker.onerror = () => { worker = null; };
}

const channelsOf = (buf) => Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());

function run(msg) {
  const id = ++seq;
  if (!worker) {
    // Zonder worker: op de hoofdthread, maar pas na het huidige werk.
    return { id, promise: new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (msg.type === 'tempo') resolve({ result: detectTempo(msg.channels, msg.sr, msg.opts) });
        else resolve({ channels: stretch(msg.reverse ? reverse(msg.channels) : msg.channels, msg.ratio, msg.sr, msg.mode) });
      } catch (err) { reject(err); }
    }, 0)) };
  }
  const promise = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  worker.postMessage({ ...msg, id });
  return { id, promise };
}

function toBuffer(channels, sampleRate) {
  const buf = new AudioBuffer({ length: Math.max(1, channels[0].length), numberOfChannels: channels.length, sampleRate });
  channels.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

// ---------- Cache ----------

const ready = new Map();    // sleutel → AudioBuffer
const pending = new Map();  // sleutel → { id, promise }
const MAX_SAMPLES = 48e6;   // ongeveer 190 MB aan gerekte audio
let listeners = new Set();
export const onWarpChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const fn of listeners) fn(pending.size); };

function remember(key, buf) {
  ready.delete(key);
  ready.set(key, buf);
  let total = 0;
  for (const b of ready.values()) total += b.length * b.numberOfChannels;
  for (const [k, b] of ready) {
    if (total <= MAX_SAMPLES || ready.size <= 2) break;
    total -= b.length * b.numberOfChannels;
    ready.delete(k);
  }
}

function touch(key) { const b = ready.get(key); if (b) { ready.delete(key); ready.set(key, b); } return b; }

const keyOf = (audioId, rev, mode, ratio) => `${audioId}|${rev ? 1 : 0}|${mode}|${ratio.toFixed(4)}`;

function reversed(audioId, buf) {
  const key = keyOf(audioId, true, 'rev', 1);
  let b = touch(key);
  if (!b) { b = toBuffer(reverse(channelsOf(buf)), buf.sampleRate); remember(key, b); }
  return b;
}

function request(key, audioId, buf, clip, ratio) {
  if (ready.has(key) || pending.has(key)) return pending.get(key)?.promise;
  const job = run({ type: 'stretch', channels: channelsOf(buf), sr: buf.sampleRate, ratio, mode: clip.mode, reverse: !!clip.reverse });
  const entry = { id: job.id, promise: job.promise.then((res) => {
    remember(key, toBuffer(res.channels, buf.sampleRate));
    pending.delete(key);
    changed();
  }, (err) => { pending.delete(key); changed(); if (!err.cancelled) console.warn('Tijdrekken mislukt', err); }) };
  pending.set(key, entry);
  changed();
  return entry.promise;
}

// Hoe een clip nu klinkt: { buffer, rate, scale, exact }.
//   buffer: de af te spelen AudioBuffer;  rate: playbackRate;  scale: bufferseconden per bronseconde;
//   exact: false zolang de gerekte versie nog wordt berekend.
export function playbackFor(clip, buf, bpm) {
  const T = audioTimeRatio(clip, bpm);
  const base = clip.reverse ? reversed(clip.audioId, buf) : buf;
  if (clip.mode === 'repitch') return { buffer: base, rate: 1 / T, scale: 1, exact: true };
  const p = audioPitch(clip);
  const R = T * p;
  if (Math.abs(R - 1) < 1e-4) return { buffer: base, rate: p, scale: 1, exact: true };
  const key = keyOf(clip.audioId, clip.reverse, clip.mode, R);
  const hit = touch(key);
  if (hit) return { buffer: hit, rate: p, scale: R, exact: true };
  request(key, clip.audioId, buf, clip, R);
  return { buffer: base, rate: 1 / T, scale: 1, exact: false };
}

// Zorgt dat alle gerekte versies van een project (op dit tempo) er komen; annuleert wat niet meer nodig is.
// Met wait=true wacht het tot alles klaar is (exporteren).
export function prepareProject(project, buffers, { wait = false } = {}) {
  const needed = new Set();
  const jobs = [];
  for (const t of project.tracks) {
    if (t.kind !== 'audio') continue;
    for (const c of t.clips) {
      const buf = buffers.get(c.audioId);
      if (!buf || c.mode === 'repitch') continue;
      const R = audioTimeRatio(c, project.bpm) * audioPitch(c);
      if (Math.abs(R - 1) < 1e-4) continue;
      const key = keyOf(c.audioId, c.reverse, c.mode, R);
      needed.add(key);
      if (!ready.has(key)) jobs.push(request(key, c.audioId, buf, c, R));
      else touch(key);
    }
  }
  if (!wait) {
    for (const [key, entry] of pending) {
      if (needed.has(key)) continue;
      if (worker) worker.postMessage({ type: 'cancel', id: entry.id });
    }
  }
  return wait ? Promise.allSettled(jobs) : null;
}

export const warpBusy = () => pending.size;

// Tempo van een bestand, in de worker.
export async function analyseTempo(buf, name) {
  const mono = buf.numberOfChannels > 1
    ? [buf.getChannelData(0).map((v, i) => (v + buf.getChannelData(1)[i]) / 2)]
    : [buf.getChannelData(0).slice()];
  const res = await run({ type: 'tempo', channels: mono, sr: buf.sampleRate, opts: { name, duration: buf.duration } }).promise;
  return res.result;
}
