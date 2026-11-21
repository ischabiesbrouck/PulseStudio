// Audio-engine: transport met vooruitplannen (lookahead), live spelen, meters en offline renderen.
import { TrackChain, masterTrack, readPeak } from './chain.js';
import { synthVoice, samplerVoice, drumHit } from './instruments.js';
import { eventsInRange, audioStartsInRange, nextSegment, isAudible, projectEnd, audioGainEnvelope, audioSegments } from '../model.js';
import { getInstrument, loadInstrument, pickZone, loadKit, isSampleKit } from './samplelib.js';
import { loadWorklets, hasWorklets } from './plugins.js';
import { playbackFor, prepareProject } from './warp.js';
import { LoudnessMeter } from './loudness.js';
import { wamMidi, wamState } from './wam.js';

const LOOKAHEAD = 0.15; // seconden vooruit plannen
const STEP = 0.5;       // tellen per planstap

// Welke opname de sampler voor deze noot gebruikt: een eigen sample, of de dichtstbijzijnde van een ingebouwd instrument.
export function samplerZone(s, pitch, buffers) {
  if (s.instrument) {
    const zones = getInstrument(s.instrument);
    if (!zones) { loadInstrument(s.instrument).catch(() => {}); return null; }
    return { ...pickZone(zones, pitch), builtin: true };
  }
  return { buffer: buffers.get(s.audioId), root: s.root };
}

// Laadt alle opnames die een project nodig heeft (voor exporteren en vooraf laden).
export function preloadProject(project, onProgress) {
  const jobs = [];
  for (const t of project.tracks) {
    if (t.kind === 'drums' && isSampleKit(t.drums.kit)) jobs.push(loadKit(t.drums.kit, onProgress));
    if (t.kind === 'sampler' && t.sampler.instrument) jobs.push(loadInstrument(t.sampler.instrument, onProgress));
  }
  return Promise.allSettled(jobs);
}

// Noot naar een instrument-plug-in: MIDI note on/off met tijdstempel.
function pluginVoice(ctx, chain, pitch, vel, time) {
  const node = chain.instrument?.inst?.audioNode;
  const voice = { end: Infinity, released: false, release() {}, stopNow() {} };
  if (!node) { voice.end = time; return voice; }
  wamMidi(node, [0x90, pitch & 127, Math.max(1, Math.min(127, Math.round(vel * 127)))], time);
  voice.release = (t) => {
    if (voice.released) return;
    voice.released = true;
    voice.end = Math.max(t, time + 0.005);
    wamMidi(node, [0x80, pitch & 127, 0], voice.end);
  };
  voice.stopNow = () => voice.release(ctx.currentTime);
  return voice;
}

function playEvent(ctx, chain, track, pitch, vel, time, durSec, buffers) {
  if (track.kind === 'drums') return drumHit(ctx, chain.input, track.drums, pitch, vel, time, { buffers, choke: chain.choke });
  if (track.kind === 'plugin') {
    const v = pluginVoice(ctx, chain, pitch, vel, time);
    if (durSec != null) v.release(time + durSec);
    return v;
  }
  const v = track.kind === 'sampler'
    ? samplerVoice(ctx, chain.input, track.sampler, samplerZone(track.sampler, pitch, buffers), pitch, vel, time)
    : synthVoice(ctx, chain.input, track.synth, pitch, vel, time);
  if (durSec != null) v.release(time + durSec);
  return v;
}

// Plant één audioclip vanaf `offsetBeats`: gerekt (of als repitch zolang de gerekte versie er nog niet is), met loop en fades.
function scheduleAudio(ctx, dest, clip, buf, offsetBeats, t, spb, bpm, sources) {
  const pb = playbackFor(clip, buf, bpm);
  const segs = audioSegments(clip, offsetBeats, spb, buf.duration, bpm);
  if (!segs.length) return;
  const g = ctx.createGain();
  g.connect(dest);
  audioGainEnvelope(clip, offsetBeats, spb).forEach(([dt, gain], i) => {
    if (i === 0) g.gain.setValueAtTime(gain, t);
    else g.gain.linearRampToValueAtTime(gain, t + dt);
  });
  const F = 0.002; // korte fades tegen klikken op naden en bij instappen midden in het bestand
  for (const s of segs) {
    const off = s.src * pb.scale;
    if (off >= pb.buffer.duration - 1e-4) continue;
    const src = ctx.createBufferSource();
    src.buffer = pb.buffer;
    src.playbackRate.value = pb.rate;
    const sg = ctx.createGain();
    const t0 = t + s.at, t1 = t0 + s.dur;
    const cutStart = s.src > 0.001, cutEnd = s.src + s.dur * (pb.rate / pb.scale) < buf.duration - 0.003;
    sg.gain.setValueAtTime(cutStart ? 0 : 1, t0);
    if (cutStart) sg.gain.linearRampToValueAtTime(1, t0 + F);
    if (cutEnd && s.dur > 2 * F) { sg.gain.setValueAtTime(1, t1 - F); sg.gain.linearRampToValueAtTime(0, t1); }
    src.connect(sg).connect(g);
    src.start(t0, off);
    src.stop(t1);
    sources.push({ src, end: t1 });
  }
}

// Plant alle noten, audioclips en tempo-effecten in [from, to), waarbij tel `from` op tijd `time` valt.
function scheduleWindow({ ctx, chains, returns, master, project, buffers, from, to, time, spb, spanning, voices, sources }) {
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
    scheduleAudio(ctx, chain.input, a.clip, buf, a.offsetBeats, time + (a.beat - from) * spb, spb, project.bpm, sources);
  }
  for (const chain of chains.values()) chain.schedule(from, to, time, spb);
  for (const chain of returns.values()) chain.schedule(from, to, time, spb);
  master.schedule(from, to, time, spb);
}

export class Engine {
  constructor({ getProject, buffers }) {
    this.getProject = getProject;
    this.buffers = buffers;
    this.ctx = null;
    this.chains = new Map();
    this.returns = new Map();
    this.voices = [];
    this.sources = [];
    this.live = new Map();
    this.playing = false;
    this.anchors = [];
    this.timer = null;
    this.loud = new LoudnessMeter();
    this.starting = null;
  }

  async ensure() {
    if (!this.ctx) {
      this.starting ||= (async () => {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        await loadWorklets(ctx);
        this.master = new TrackChain(ctx, ctx.destination, { spectrum: true });
        this.scratch = new Float32Array(1024);
        // Luidheidsmeter (LUFS) achter de master.
        if (hasWorklets(ctx)) {
          const meter = new AudioWorkletNode(ctx, 'ps-loudness', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
          meter.port.onmessage = (e) => this.loud.push(e.data);
          const mute = ctx.createGain();
          mute.gain.value = 0;
          this.master.fader.connect(meter).connect(mute).connect(ctx.destination);
        }
        this.ctx = ctx;
        this.sync();
      })();
      await this.starting;
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
    const rids = new Set();
    for (const r of p.returns || []) {
      rids.add(r.id);
      let chain = this.returns.get(r.id);
      if (!chain) this.returns.set(r.id, (chain = new TrackChain(this.ctx, this.master.input)));
      chain.update(r, p.bpm, !r.mute);
    }
    for (const [id, chain] of this.returns) if (!rids.has(id)) { chain.dispose(); this.returns.delete(id); }
    const ids = new Set();
    for (const track of p.tracks) {
      ids.add(track.id);
      let chain = this.chains.get(track.id);
      if (!chain) this.chains.set(track.id, (chain = new TrackChain(this.ctx, this.master.input)));
      chain.update(track, p.bpm, isAudible(track, p.tracks), false, this.returns);
      if (track.kind === 'plugin') chain.setInstrument(track.plugin);
    }
    for (const [id, chain] of this.chains) if (!ids.has(id)) { chain.dispose(); this.chains.delete(id); }
    this.master.update(masterTrack(p), p.bpm, true);
    prepareProject(p, this.buffers);
  }

  chainFor(key) { return key === 'master' ? this.master : this.chains.get(key) || this.returns.get(key); }

  // De geladen plug-in (WAM) van een insert of van een instrumentspoor: { inst, error, ready, gui }.
  wam(chainKey, insId = null) {
    const chain = this.chainFor(chainKey);
    if (!chain) return null;
    return insId ? chain.slots.find((s) => s.id === insId)?.fx || null : chain.instrument || null;
  }

  // Zet de actuele toestand van alle plug-ins in het project (vóór opslaan en exporteren).
  async collectWamStates(p) {
    if (!this.ctx) return false;
    const jobs = [];
    let changed = false;
    const take = (holder, target) => {
      if (!holder?.inst) return;
      jobs.push(wamState(holder.inst).then((s) => {
        if (s != null && JSON.stringify(s) !== JSON.stringify(target.state)) { target.state = s; changed = true; }
      }));
    };
    const scan = (key, inserts) => { for (const ins of inserts || []) if (ins.type === 'wam') take(this.wam(key, ins.id), ins.wam); };
    for (const t of p.tracks) {
      scan(t.id, t.inserts);
      if (t.kind === 'plugin' && t.plugin) take(this.wam(t.id), t.plugin);
    }
    for (const r of p.returns || []) scan(r.id, r.inserts);
    scan('master', p.masterInserts);
    await Promise.all(jobs);
    return changed;
  }

  play(fromBeat) {
    if (this.playing) this.stop();
    this.playing = true;
    this.cursorBeat = fromBeat;
    this.cursorTime = this.ctx.currentTime + 0.06;
    this.spanning = true;
    const spb = 60 / this.getProject().bpm;
    this.anchors = [{ time: this.cursorTime, beat: fromBeat, spb }];
    this.loud.reset();
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
        ctx: this.ctx, chains: this.chains, returns: this.returns, master: this.master, project: p, buffers: this.buffers,
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
    // Instrument-plug-ins: alle noten uit (ook noten die al vooruit gepland waren).
    for (const chain of this.chains.values()) {
      const node = chain.instrument?.inst?.audioNode;
      if (node) { const t = this.ctx.currentTime + LOOKAHEAD + 0.03; wamMidi(node, [0xb0, 123, 0], t); wamMidi(node, [0xb0, 120, 0], t); }
    }
    for (const chain of this.chains.values()) chain.reset();
    for (const chain of this.returns.values()) chain.reset();
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

  // Speelt een kort akkoordje op een ingebouwd instrument.
  previewInstrument(id, zones) {
    const s = { fine: 0, attack: 0.003, decay: 1, sustain: 1, release: 0.4, cutoff: 18000, gain: 0.8 };
    const t = this.ctx.currentTime + 0.02;
    [[60, 0], [64, 0.05], [67, 0.1], [72, 0.15]].forEach(([p, dt]) => {
      samplerVoice(this.ctx, this.master.input, s, { ...pickZone(zones, p), builtin: true }, p, 0.75, t + dt).release(t + 1.6);
    });
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
    for (const [id, chain] of this.returns) tracks.set(id, stereo(chain));
    return { master: stereo(this.master), tracks };
  }

  // Het effect zelf (voor schermen die meer willen weten, zoals de multiband).
  fx(chainKey, insId) { return this.chainFor(chainKey)?.slots.find((s) => s.id === insId)?.fx || null; }

  // Gain reduction (dB, negatief) van een compressor of limiter in een keten.
  reduction(chainKey, insId) { return this.fx(chainKey, insId)?.reduction?.() ?? 0; }

  loudness() {
    const l = this.loud;
    return { momentary: l.momentary(), shortTerm: l.shortTerm(), integrated: l.integrated(), peak: l.peak, corr: l.corr };
  }

  spectrum(out) {
    if (!this.master?.spectrum) return false;
    this.master.spectrum.getFloatFrequencyData(out);
    return true;
  }
}

// Rendert het hele project (zonder loop) naar een AudioBuffer.
//   only: alleen dit spoor (met zijn sends via de returns, zonder masterketen): voor stems en bouncen.
//   end:  vaste lengte in tellen, zodat alle stems even lang zijn.
export async function renderProject(project, buffers, { sampleRate = 44100, tail = 3, only = null, end = null } = {}) {
  const last = end ?? projectEnd(project);
  if (last <= 0) throw new Error('Het project is leeg.');
  await preloadProject(project);
  await prepareProject(project, buffers, { wait: true });
  const spb = 60 / project.bpm;
  const ctx = new OfflineAudioContext(2, Math.ceil((last * spb + tail) * sampleRate), sampleRate);
  await loadWorklets(ctx);
  const master = new TrackChain(ctx, ctx.destination);
  master.update(only ? { inserts: [], pan: 0, volume: 0 } : masterTrack(project), project.bpm, true, true);
  const returns = new Map();
  for (const r of project.returns || []) {
    const chain = new TrackChain(ctx, master.input);
    chain.update(r, project.bpm, !r.mute, true);
    returns.set(r.id, chain);
  }
  const tracks = only ? project.tracks.map((t) => ({ ...t, mute: t.id !== only, solo: false })) : project.tracks;
  const p = only ? { ...project, tracks } : project;
  const chains = new Map();
  for (const track of tracks) {
    if (only && track.id !== only) continue;
    const chain = new TrackChain(ctx, master.input);
    chain.update(track, project.bpm, isAudible(track, tracks), true, returns);
    if (track.kind === 'plugin') chain.setInstrument(track.plugin);
    chains.set(track.id, chain);
  }
  // Plug-ins (WAM) laden asynchroon; pas plannen als alles klaar is.
  await Promise.all([master, ...returns.values(), ...chains.values()].map((c) => c.ready()));
  scheduleWindow({ ctx, chains, returns, master, project: p, buffers, from: 0, to: last, time: 0, spb, spanning: true, voices: [], sources: [] });
  return ctx.startRendering();
}
