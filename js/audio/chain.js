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
  constructor(ctx, dest, { spectrum = false } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.post = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.fader = ctx.createGain();
    this.input.connect(this.post);
    this.post.connect(this.panner).connect(this.fader);
    this.fader.connect(dest);
    // Stereometers: links en rechts apart meten.
    if (!(ctx instanceof OfflineAudioContext)) {
      const split = ctx.createChannelSplitter(2);
      this.analyserL = ctx.createAnalyser();
      this.analyserR = ctx.createAnalyser();
      this.analyserL.fftSize = this.analyserR.fftSize = 512;
      this.fader.connect(split);
      split.connect(this.analyserL, 0);
      split.connect(this.analyserR, 1);
      if (spectrum) {
        this.spectrum = ctx.createAnalyser();
        this.spectrum.fftSize = 4096;
        this.spectrum.smoothingTimeConstant = 0.82;
        this.fader.connect(this.spectrum);
      }
    }
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

  // `track` mag ook een master- of return-object zijn: { inserts, pan, volume }.
  // `returns`: Map van return-id naar keten; sends gaan na de fader (post-fader) naar die ketens.
  update(track, bpm, audible, immediate = false, returns = null) {
    const t = this.ctx.currentTime;
    const set = immediate ? (param, v) => { param.value = v; } : (param, v) => param.setTargetAtTime(v, t, 0.015);
    this.setInserts(track.inserts || [], bpm, set);
    set(this.panner.pan, track.pan || 0);
    set(this.fader.gain, audible ? dbToGain(track.volume) : 0);
    if (returns) this.setSends(track.sends || {}, returns, set);
  }

  setSends(sends, returns, set) {
    this.sends ||= new Map();
    for (const [id, node] of this.sends) {
      if (!returns.has(id) || node.dest !== returns.get(id)) { try { node.g.disconnect(); } catch { /* al los */ } this.sends.delete(id); }
    }
    for (const [id, chain] of returns) {
      let node = this.sends.get(id);
      const v = sends[id] ?? -60;
      if (!node) {
        if (v <= -60) continue;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        this.fader.connect(g).connect(chain.input);
        this.sends.set(id, (node = { g, dest: chain }));
      }
      set(node.g.gain, dbToGain(v));
    }
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
