// Worker voor tijdrekken en tempodetectie, zodat de interface en het afspelen niet haperen.
import { stretch, reverse, detectTempo } from './stretch.js';

const queue = [];
const cancelled = new Set();
let busy = false;

function next() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  setTimeout(() => {
    try {
      if (cancelled.has(job.id)) { cancelled.delete(job.id); self.postMessage({ id: job.id, cancelled: true }); return; }
      if (job.type === 'stretch') {
        let ch = job.channels;
        if (job.reverse) ch = reverse(ch);
        const out = stretch(ch, job.ratio, job.sr, job.mode);
        self.postMessage({ id: job.id, channels: out }, out.map((c) => c.buffer));
      } else if (job.type === 'tempo') {
        self.postMessage({ id: job.id, result: detectTempo(job.channels, job.sr, job.opts) });
      }
    } catch (err) {
      self.postMessage({ id: job.id, error: String(err?.message || err) });
    } finally {
      busy = false;
      next();
    }
  }, 0);
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') { cancelled.add(m.id); return; }
  queue.push(m);
  next();
};
