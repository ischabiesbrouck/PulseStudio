// Audio-engine: transport met vooruitplannen (lookahead), live spelen, meters en offline renderen.
import { TrackChain, createMaster, readPeak } from './chain.js';
import { synthVoice, drumHit } from './instruments.js';
import { eventsInRange, audioStartsInRange, nextSegment, isAudible, projectEnd, dbToGain } from '../model.js';

const LOOKAHEAD = 0.15; // seconden vooruit plannen
const STEP = 0.5;       // tellen per planstap

function playEvent(ctx, chain, track, pitch, vel, time, durSec) {
  if (track.kind === 'drums') return drumHit(ctx, chain.input, track.drums, pitch, vel, time);
  const v = synthVoice(ctx, chain.input, track.synth, pitch, vel, time);
  if (durSec != null) v.release(time + durSec);
  return v;
}

// Plant alle noten en audioclips in [from, to), waarbij tel `from` op tijd `time` valt.
function scheduleWindow({ ctx, chains, project, buffers, from, to, time, spb, spanning, voices, sources }) {
  for (const ev of eventsInRange(project, from, to)) {
    const chain = chains.get(ev.track.id);
    if (!chain) continue;
    const t = time + (ev.beat - from) * spb;
    voices.push(playEvent(ctx, chain, ev.track, ev.note.p, ev.note.v, t, ev.dur * spb));
  }
  for (const a of audioStartsInRange(project, from, to, spanning)) {
    const chain = chains.get(a.track.id);
    const buf = buffers.get(a.clip.audioId);
    if (!chain || !buf) continue;
    const offset = (a.clip.offset || 0) + a.offsetBeats * spb;
    if (offset >= buf.duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = a.clip.gain ?? 1;
    src.connect(g).connect(chain.input);
    const t = time + (a.beat - from) * spb;
    const dur = Math.min((a.clip.length - a.offsetBeats) * spb, buf.duration - offset);
    src.start(t, offset, dur);
    sources.push({ src, end: t + dur });
  }
}

export class Engine {
  constructor({ getProject, buffers }) {
    this.getProject = getProject;
    this.buffers = buffers;
    this.ctx = null;
    this.chains = new Map();
    this.voices = [];
    this.sources = [];
    this.live = new Map();
    this.playing = false;
    this.anchors = [];
    this.timer = null;
  }

  async ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = createMaster(this.ctx);
      this.scratch = new Float32Array(1024);
      this.sync();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  // Decodeert een audiobestand; werkt ook vóór de eerste klik (dan via een OfflineAudioContext).
  decode(arrayBuffer) {
    const ctx = this.ctx || new OfflineAudioContext(2, 1, 48000);
    return ctx.decodeAudioData(arrayBuffer);
  }

  // Zorgt dat elke track een keten heeft en dat alle instellingen kloppen.
  sync() {
    if (!this.ctx) return;
    const p = this.getProject();
    const ids = new Set();
    for (const track of p.tracks) {
      ids.add(track.id);
      let chain = this.chains.get(track.id);
      if (!chain) this.chains.set(track.id, (chain = new TrackChain(this.ctx, this.master.input)));
      chain.update(track, p.bpm, isAudible(track, p.tracks));
    }
    for (const [id, chain] of this.chains) if (!ids.has(id)) { chain.dispose(); this.chains.delete(id); }
    this.master.setVolume(p.masterVolume);
  }

  play(fromBeat) {
    if (this.playing) this.stop();
    this.playing = true;
    this.cursorBeat = fromBeat;
    this.cursorTime = this.ctx.currentTime + 0.06;
    this.spanning = true;
    const spb = 60 / this.getProject().bpm;
    this.anchors = [{ time: this.cursorTime, beat: fromBeat, spb }];
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  tick() {
    if (!this.playing) return;
    const p = this.getProject();
    const spb = 60 / p.bpm;
    const now = this.ctx.currentTime;
    while (this.cursorTime < now + LOOKAHEAD) {
      const seg = nextSegment(this.cursorBeat, STEP, p.loop);
      if (!this.anchors.length || this.anchors[this.anchors.length - 1].spb !== spb || this.spanning) {
        this.anchors.push({ time: this.cursorTime, beat: seg.from, spb });
      }
      scheduleWindow({
        ctx: this.ctx, chains: this.chains, project: p, buffers: this.buffers,
        from: seg.from, to: seg.to, time: this.cursorTime, spb, spanning: this.spanning,
        voices: this.voices, sources: this.sources,
      });
      if (p.metronome) this.clicks(seg.from, seg.to, this.cursorTime, spb);
      this.cursorTime += (seg.to - seg.from) * spb;
      this.cursorBeat = seg.next;
      this.spanning = seg.wrapped;
    }
    this.voices = this.voices.filter((v) => v.end > now - 0.1);
    this.sources = this.sources.filter((s) => s.end > now - 0.1);
  }

  clicks(from, to, time, spb) {
    for (let b = Math.ceil(from - 1e-9); b < to; b++) {
      const t = time + (b - from) * spb;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = b % 4 === 0 ? 1600 : 1050;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      o.connect(g).connect(this.master.input);
      o.start(t);
      o.stop(t + 0.05);
    }
  }

  // Huidige afspeelpositie in tellen.
  position() {
    if (!this.playing || !this.anchors.length) return null;
    const now = this.ctx.currentTime;
    let i = this.anchors.length - 1;
    while (i > 0 && this.anchors[i].time > now) i--;
    if (i > 0) this.anchors.splice(0, i);
    const a = this.anchors[0];
    return a.beat + Math.max(0, now - a.time) / a.spb;
  }

  stop() {
    clearInterval(this.timer);
    this.playing = false;
    for (const v of this.voices) v.stopNow();
    for (const s of this.sources) try { s.src.stop(); } catch { /* nog niet gestart */ }
    this.voices = [];
    this.sources = [];
    this.anchors = [];
  }

  noteOn(track, pitch, vel = 0.85) {
    const chain = this.chains.get(track.id);
    if (!chain || track.kind === 'audio') return;
    const key = `${track.id}:${pitch}`;
    this.live.get(key)?.release(this.ctx.currentTime);
    this.live.set(key, playEvent(this.ctx, chain, track, pitch, vel, this.ctx.currentTime, null));
  }

  noteOff(track, pitch) {
    const key = `${track.id}:${pitch}`;
    const v = this.live.get(key);
    if (v) { v.release(this.ctx.currentTime); this.live.delete(key); }
  }

  preview(track, pitch, vel = 0.8, seconds = 0.35) {
    const chain = this.chains.get(track.id);
    if (!chain || track.kind === 'audio') return;
    playEvent(this.ctx, chain, track, pitch, vel, this.ctx.currentTime, seconds);
  }

  meters() {
    const tracks = new Map();
    if (!this.ctx) return { master: 0, tracks };
    for (const [id, chain] of this.chains) tracks.set(id, readPeak(chain.analyser, this.scratch));
    return { master: readPeak(this.master.analyser, this.scratch), tracks };
  }
}

// Rendert het hele project (zonder loop) naar een AudioBuffer.
export async function renderProject(project, buffers, { sampleRate = 44100, tail = 2.5 } = {}) {
  const end = projectEnd(project);
  if (end <= 0) throw new Error('Het project is leeg.');
  const spb = 60 / project.bpm;
  const ctx = new OfflineAudioContext(2, Math.ceil((end * spb + tail) * sampleRate), sampleRate);
  const master = createMaster(ctx);
  master.input.gain.value = dbToGain(project.masterVolume);
  const chains = new Map();
  for (const track of project.tracks) {
    const chain = new TrackChain(ctx, master.input);
    chain.update(track, project.bpm, isAudible(track, project.tracks), true);
    chains.set(track.id, chain);
  }
  scheduleWindow({ ctx, chains, project, buffers, from: 0, to: end, time: 0, spb, spanning: true, voices: [], sources: [] });
  return ctx.startRendering();
}
