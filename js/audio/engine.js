// Audio-engine: transport met vooruitplannen (lookahead), live spelen, meters en offline renderen.
import { TrackChain, masterTrack, readPeak } from './chain.js';
import { synthVoice, samplerVoice, drumHit } from './instruments.js';
import { eventsInRange, audioStartsInRange, nextSegment, isAudible, projectEnd, audioGainEnvelope } from '../model.js';

const LOOKAHEAD = 0.15; // seconden vooruit plannen
const STEP = 0.5;       // tellen per planstap

function playEvent(ctx, chain, track, pitch, vel, time, durSec, buffers) {
  if (track.kind === 'drums') return drumHit(ctx, chain.input, track.drums, pitch, vel, time, { buffers, choke: chain.choke });
  const v = track.kind === 'sampler'
    ? samplerVoice(ctx, chain.input, track.sampler, buffers.get(track.sampler.audioId), pitch, vel, time)
    : synthVoice(ctx, chain.input, track.synth, pitch, vel, time);
  if (durSec != null) v.release(time + durSec);
  return v;
}

// Plant alle noten, audioclips en tempo-effecten in [from, to), waarbij tel `from` op tijd `time` valt.
function scheduleWindow({ ctx, chains, master, project, buffers, from, to, time, spb, spanning, voices, sources }) {
  for (const ev of eventsInRange(project, from, to)) {
    const chain = chains.get(ev.track.id);
    if (!chain) continue;
    const t = time + (ev.beat - from) * spb;
    voices.push(playEvent(ctx, chain, ev.track, ev.note.p, ev.note.v, t, ev.dur * spb, buffers));
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
    src.connect(g).connect(chain.input);
    const t = time + (a.beat - from) * spb;
    audioGainEnvelope(a.clip, a.offsetBeats, spb).forEach(([dt, gain], i) => {
      if (i === 0) g.gain.setValueAtTime(gain, t);
      else g.gain.linearRampToValueAtTime(gain, t + dt);
    });
    const dur = Math.min((a.clip.length - a.offsetBeats) * spb, buf.duration - offset);
    src.start(t, offset, dur);
    sources.push({ src, end: t + dur });
  }
  for (const chain of chains.values()) chain.schedule(from, to, time, spb);
  master.schedule(from, to, time, spb);
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
      this.master = new TrackChain(this.ctx, this.ctx.destination, { spectrum: true });
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
    this.master.update(masterTrack(p), p.bpm, true);
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
        ctx: this.ctx, chains: this.chains, master: this.master, project: p, buffers: this.buffers,
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
      o.connect(g).connect(this.ctx.destination);
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
    for (const chain of this.chains.values()) chain.reset();
    this.master?.reset();
    this.voices = [];
    this.sources = [];
    this.anchors = [];
  }

  noteOn(track, pitch, vel = 0.85) {
    const chain = this.chains.get(track.id);
    if (!chain || track.kind === 'audio') return;
    const key = `${track.id}:${pitch}`;
    this.live.get(key)?.release(this.ctx.currentTime);
    this.live.set(key, playEvent(this.ctx, chain, track, pitch, vel, this.ctx.currentTime, null, this.buffers));
  }

  noteOff(track, pitch) {
    const key = `${track.id}:${pitch}`;
    const v = this.live.get(key);
    if (v) { v.release(this.ctx.currentTime); this.live.delete(key); }
  }

  preview(track, pitch, vel = 0.8, seconds = 0.35) {
    const chain = this.chains.get(track.id);
    if (!chain || track.kind === 'audio') return;
    playEvent(this.ctx, chain, track, pitch, vel, this.ctx.currentTime, seconds, this.buffers);
  }

  // Speelt een losse buffer af via de master (voorbeluisteren in de bibliotheek).
  previewBuffer(buf) {
    this.previewSrc?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master.input);
    src.start();
    this.previewSrc = src;
    src.onended = () => { if (this.previewSrc === src) this.previewSrc = null; };
  }

  stopPreview() { try { this.previewSrc?.stop(); } catch { /* al gestopt */ } this.previewSrc = null; }

  // Speelt een synthpreset of een drumkit los af (voorbeluisteren in de browser).
  previewSynth(params, pitch = 60) {
    for (const p of [pitch, pitch + 4, pitch + 7]) synthVoice(this.ctx, this.master.input, params, p, 0.75, this.ctx.currentTime + 0.02).release(this.ctx.currentTime + 0.7);
  }

  previewKit(kit) {
    const t = this.ctx.currentTime + 0.03;
    const choke = {};
    [[36, 0], [42, 0.25], [38, 0.5], [42, 0.75], [36, 1], [36, 1.25], [38, 1.5], [46, 1.75]].forEach(([p, b]) => drumHit(this.ctx, this.master.input, kit, p, 0.9, t + b * 0.25, { choke }));
  }

  // Stereo piekniveaus [L, R] per spoor en voor de master.
  meters() {
    const tracks = new Map();
    if (!this.ctx) return { master: [0, 0], tracks };
    const stereo = (chain) => [readPeak(chain.analyserL, this.scratch), readPeak(chain.analyserR, this.scratch)];
    for (const [id, chain] of this.chains) tracks.set(id, stereo(chain));
    return { master: stereo(this.master), tracks };
  }

  // Gain reduction (dB, negatief) van een compressor of limiter in een keten.
  reduction(chainKey, insId) {
    const chain = chainKey === 'master' ? this.master : this.chains.get(chainKey);
    return chain?.slots.find((s) => s.id === insId)?.fx.reduction?.() ?? 0;
  }

  spectrum(out) {
    if (!this.master?.spectrum) return false;
    this.master.spectrum.getFloatFrequencyData(out);
    return true;
  }
}

// Rendert het hele project (zonder loop) naar een AudioBuffer.
export async function renderProject(project, buffers, { sampleRate = 44100, tail = 3 } = {}) {
  const end = projectEnd(project);
  if (end <= 0) throw new Error('Het project is leeg.');
  const spb = 60 / project.bpm;
  const ctx = new OfflineAudioContext(2, Math.ceil((end * spb + tail) * sampleRate), sampleRate);
  const master = new TrackChain(ctx, ctx.destination);
  master.update(masterTrack(project), project.bpm, true, true);
  const chains = new Map();
  for (const track of project.tracks) {
    const chain = new TrackChain(ctx, master.input);
    chain.update(track, project.bpm, isAudible(track, project.tracks), true);
    chains.set(track.id, chain);
  }
  scheduleWindow({ ctx, chains, master, project, buffers, from: 0, to: end, time: 0, spb, spanning: true, voices: [], sources: [] });
  return ctx.startRendering();
}
