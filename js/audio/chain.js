// Signaalketen per spoor (en voor de master): ingang → inserts → pan → fader → meter.
import { dbToGain } from '../model.js';
import { Slot } from './plugins.js';

export function readPeak(analyser, scratch) {
  analyser.getFloatTimeDomainData(scratch);
  let max = 0;
  for (let i = 0; i < scratch.length; i++) { const a = Math.abs(scratch[i]); if (a > max) max = a; }
  return max;
}

export class TrackChain {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.post = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.fader = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.input.connect(this.post);
    this.post.connect(this.panner).connect(this.fader);
    this.fader.connect(this.analyser);
    this.fader.connect(dest);
    this.slots = [];
    this.signature = '';
    this.choke = {};
  }

  setInserts(inserts, bpm, set) {
    const signature = inserts.map((i) => `${i.id}:${i.type}`).join('|');
    if (signature !== this.signature) {
      const old = new Map(this.slots.map((s) => [s.id, s]));
      const next = inserts.map((ins) => old.get(ins.id) || new Slot(this.ctx, ins));
      for (const s of this.slots) if (!next.includes(s)) s.dispose();
      this.input.disconnect();
      for (const s of next) s.output.disconnect();
      let node = this.input;
      for (const s of next) { node.connect(s.input); node = s.output; }
      node.connect(this.post);
      this.slots = next;
      this.signature = signature;
    }
    inserts.forEach((ins, i) => this.slots[i].update(ins, bpm, set));
  }

  // `track` mag ook een master-object zijn: { inserts, pan, volume }.
  update(track, bpm, audible, immediate = false) {
    const t = this.ctx.currentTime;
    const set = immediate ? (param, v) => { param.value = v; } : (param, v) => param.setTargetAtTime(v, t, 0.015);
    this.setInserts(track.inserts || [], bpm, set);
    set(this.panner.pan, track.pan || 0);
    set(this.fader.gain, audible ? dbToGain(track.volume) : 0);
  }

  schedule(from, to, time, spb) {
    for (const s of this.slots) if (s.ins.on && s.fx.schedule) s.fx.schedule(from, to, time, spb, s.ins.params);
  }

  reset() {
    for (const s of this.slots) s.fx.reset?.();
  }

  dispose() {
    for (const s of this.slots) s.dispose();
    try { this.fader.disconnect(); this.input.disconnect(); } catch { /* al losgekoppeld */ }
  }
}

export const masterTrack = (p) => ({ inserts: p.masterInserts || [], pan: 0, volume: p.masterVolume });
