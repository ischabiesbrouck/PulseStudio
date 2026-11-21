// PulseStudio: verbindt de toestand, de audio-engine en de interface.
import { state, subscribe, emit, setProject, commit, undo, redo, canUndo, canRedo, select, selectedTrack, selectedClip, findTrack, trackOfClip } from './state.js';
import { migrate, demoProject, createProject, createTrack, createClip, projectEnd, formatPosition, formatTime, snapFloor, clipFromRecording, duplicateClip, BEATS_PER_BAR, uid, clamp } from './model.js';
import { Engine, renderProject } from './audio/engine.js';
import { MicRecorder } from './audio/recorder.js';
import { encodeWav, computePeaks } from './wav.js';
import * as store from './store.js';
import { h, icon, toast, download } from './ui/dom.js';
import { createArrange } from './ui/arrange.js';
import { createEditor } from './ui/editor.js';
import { createMixer } from './ui/mixer.js';
import { createInspector } from './ui/inspector.js';
import { createBrowser } from './ui/browser.js';
import { liveViews } from './ui/devices.js';
import { renderLibraryItem, LIBRARY } from './audio/library.js';
import { createInsert, PLUGIN_DEFS } from './audio/plugin-defs.js';
import { defaultSynth, defaultDrums, defaultSampler, DRUM_KEYS, gainToDb } from './model.js';
import { INSTRUMENTS, CREDITS, loadInstrument, loadKit, isSampleKit } from './audio/samplelib.js';
import { DRUM_KITS } from './audio/instruments.js';
import { findPattern, isDrumPattern, drumNotes, melodicNotes } from './audio/patterns.js';
import { preloadProject } from './audio/engine.js';
import { analyseTempo, onWarpChange } from './audio/warp.js';
import { splitClip, audioTimeRatio } from './model.js';
import { zipFiles } from './wav.js';
import { measure } from './audio/loudness.js';
import { CATALOG_BASE, loadWamModule, isSafeUrl } from './audio/wam.js';
import { createWamInsert } from './audio/plugin-defs.js';

const buffers = new Map();
const peaks = new Map();
const engine = new Engine({ getProject: () => state.project, buffers });
const mic = new MicRecorder();
let playhead = 0;
let playStart = 0;
let recording = null;
let focusArea = 'arrange';

const app = {
  buffers, peaks, engine, emit,
  playhead: () => (engine.playing ? engine.position() ?? playhead : playhead),
  playing: () => engine.playing,
  seek(beat) {
    playhead = Math.max(0, beat);
    if (engine.playing && !recording) { playStart = playhead; engine.play(playhead); }
    drawPlayhead();
  },
  showPanel(name) { state.view.panel = name; emit('panel'); },
  focus(area) { focusArea = area; },
  ensureAudio: () => engine.ensure(),
  audition(track, pitch, vel = 0.8) { engine.ensure().then(() => engine.preview(track, pitch, vel)); },
  pickAudio,
  importAudio,
  pickSample,
  dropItem,
  previewItem,
  showMaster() { state.view.inspectMaster = true; state.view.inspectReturn = null; app.showPanel('sound'); },
  showReturn(id) { state.view.inspectMaster = false; state.view.inspectReturn = id; app.showPanel('sound'); },
  say(text) { ui.info.textContent = text || DEFAULT_INFO; },
  splitSelected: () => splitSelected(),
  bounceTrack: (id) => bounceTrack(id),
  openBrowser(tab, group) { setBrowser(true); browser.openTo(tab, group); },
  setPanelCtx: (...nodes) => panelCtx.replaceChildren(...nodes.filter(Boolean)),
};

// ---------- Opbouw van de interface ----------

const arrange = createArrange(app);
const editor = createEditor(app);
const mixer = createMixer(app);
const inspector = createInspector(app);
const browser = createBrowser(app);
const panels = { sound: inspector, editor, mixer };
const PANEL_NAMES = { sound: 'Klank', editor: 'Editor', mixer: 'Mixer' };
const PANEL_ICONS = { sound: 'dial', editor: 'piano', mixer: 'faders' };

const iconBtn = (name, label, onclick, extra = {}) => h('button.ibtn', { 'aria-label': label, title: label, onclick, ...extra }, icon(name));
const ui = {};
ui.back = iconBtn('back', 'Naar het begin (Home)', () => app.seek(0));
ui.play = iconBtn('play', 'Afspelen of pauzeren (spatie)', () => togglePlay(), { class: 'play' });
ui.stop = iconBtn('stop', 'Stoppen en terug naar het startpunt', () => stopAndReturn());
ui.rec = iconBtn('record', 'Opnemen (R)', () => toggleRecord(), { class: 'rec' });
ui.pos = h('span.lcd-main', {}, '001.1.1');
ui.time = h('span', {}, '0:00.0');
ui.sig = h('span', {}, '4/4');
ui.bpm = h('input.bpm', { type: 'number', min: 30, max: 300, step: 1, 'aria-label': 'Tempo in BPM', title: 'Tempo in BPM (typ een waarde of scroll)' });
ui.bpm.addEventListener('change', () => {
  const v = clamp(Math.round(+ui.bpm.value || 120), 30, 300);
  commit((p) => { p.bpm = v; });
});
ui.bpm.addEventListener('wheel', (e) => { e.preventDefault(); ui.bpm.value = clamp(+ui.bpm.value + (e.deltaY < 0 ? 1 : -1), 30, 300); ui.bpm.dispatchEvent(new Event('change')); }, { passive: false });
ui.loop = iconBtn('loop', 'Loop aan of uit (L)', () => commit((p) => { p.loop.on = !p.loop.on; }, 'loop'));
ui.metro = iconBtn('metro', 'Metronoom aan of uit (M)', () => commit((p) => { p.metronome = !p.metronome; }, 'transport'));
ui.undo = iconBtn('undo', 'Ongedaan maken (Ctrl+Z)', () => undo());
ui.redo = iconBtn('redo', 'Opnieuw (Ctrl+Shift+Z)', () => redo());
ui.name = h('input.project-name', { 'aria-label': 'Naam van het project', title: 'Naam van het project' });
ui.name.addEventListener('change', () => { const v = ui.name.value.trim(); if (v) commit((p) => { p.name = v; }, 'transport'); });
ui.saved = h('span', {}, 'Opgeslagen');
ui.midi = iconBtn('midi', 'MIDI-keyboard koppelen', () => connectMidi());
ui.mmL = h('div.mmeter-fill');
ui.mmR = h('div.mmeter-fill');
ui.info = h('span.status-info', {}, '');
ui.rate = h('span', {}, '');
const filePicker = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });

const topbar = h('header.topbar', {},
  h('div.brand', {}, h('span.logo', { 'aria-hidden': 'true' }), h('span', {}, 'PulseStudio')),
  h('div.crumb', {}, h('button.crumb-link', { onclick: () => showProjects(), title: 'Alle projecten' }, 'Projecten'), h('span.crumb-sep', {}, '/'), ui.name),
  h('div.transport', {}, ui.back, ui.play, ui.stop, ui.rec, h('span.tsep'),
    h('div.lcd', { title: 'Positie (maat, tel, zestiende), tijd en maatsoort' }, ui.pos, h('span.lcd-sub', {}, ui.time, ui.sig)),
    h('label.bpm-box', {}, ui.bpm, h('span', {}, 'BPM')),
    h('span.tsep'), ui.loop, ui.metro),
  h('div.topright', {},
    h('div.mmeter', { title: 'Masterniveau links en rechts' }, h('div.mmeter-bar', {}, ui.mmL), h('div.mmeter-bar', {}, ui.mmR)),
    ui.undo, ui.redo,
    h('button.btn', { onclick: () => pickAudio(null, null), title: 'Audiobestand importeren' }, icon('upload', 15), h('span', {}, 'Importeren')),
    h('button.btn.primary', { onclick: () => exportWav(), title: 'Het hele nummer als WAV-bestand opslaan' }, icon('download', 15), h('span', {}, 'Exporteren'))),
  filePicker);

const railPanels = Object.entries(PANEL_NAMES).map(([key, label]) => iconBtn(PANEL_ICONS[key], `${label} (onderpaneel)`, () => app.showPanel(key), { dataset: { panel: key } }));
const railBrowser = iconBtn('browser', 'Browser tonen of verbergen (B)', () => setBrowser(!browserOpen));
const rail = h('nav.rail', { 'aria-label': 'Weergaven' }, railBrowser, h('span.rail-sep'), ...railPanels, h('span.rail-fill'),
  ui.midi, iconBtn('folder', 'Projecten', () => showProjects()), iconBtn('help', 'Sneltoetsen en uitleg', () => showHelp()));

const tabs = h('nav.tabs', { role: 'tablist' }, Object.entries(PANEL_NAMES).map(([key, label]) =>
  h('button.tab', { role: 'tab', dataset: { panel: key }, onclick: () => app.showPanel(key) }, label)));
const panelCtx = h('div.panel-ctx');
const panelBody = h('div.panel-body');
const splitter = h('div.splitter', { role: 'separator', 'aria-label': 'Paneelhoogte aanpassen', title: 'Sleep om het onderpaneel groter of kleiner te maken' });
const panel = h('section.panel', {}, h('div.panel-top', {}, tabs, panelCtx), panelBody);
const center = h('div.center', {}, h('main.arrange-wrap', {}, arrange.el), splitter, panel);
const workspace = h('div.workspace', {}, rail, browser.el, center);
const statusbar = h('footer.statusbar', {}, ui.info, ui.rate, ui.saved);
document.getElementById('app').replaceChildren(topbar, workspace, statusbar);
arrange.el.addEventListener('pointerdown', () => app.focus('arrange'));

let browserOpen = true;
function setBrowser(open) {
  browserOpen = open;
  workspace.classList.toggle('no-browser', !open);
  railBrowser.classList.toggle('on', open);
  try { localStorage.setItem('pulsestudio.browser', open ? '1' : '0'); } catch { /* geen opslag */ }
  requestAnimationFrame(() => editor.draw());
}
try { setBrowser(localStorage.getItem('pulsestudio.browser') !== '0' && window.innerWidth > 1100); } catch { setBrowser(window.innerWidth > 1100); }

// Infobalk onderin: toont uitleg bij waar de muis staat, zoals de infoweergave in professionele DAW's.
const DEFAULT_INFO = 'Spatie speelt af, R neemt op, B toont de browser. Dubbelklik in een spoor voor een clip, of sleep een geluid uit de browser.';
ui.info.textContent = DEFAULT_INFO;
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest?.('[title], [aria-label]');
  ui.info.textContent = el?.getAttribute('title') || el?.getAttribute('aria-label') || DEFAULT_INFO;
});

try { const ph = localStorage.getItem('pulsestudio.panelH'); if (ph) document.body.style.setProperty('--panel-h', `${ph}px`); } catch { /* geen opslag */ }
splitter.addEventListener('pointerdown', (e) => {
  const y0 = e.clientY, h0 = panel.getBoundingClientRect().height;
  const move = (ev) => document.body.style.setProperty('--panel-h', `${clamp(h0 - (ev.clientY - y0), 140, window.innerHeight - 220)}px`);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    try { localStorage.setItem('pulsestudio.panelH', Math.round(panel.getBoundingClientRect().height)); } catch { /* geen opslag */ }
    editor.draw();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// Knoppen verliezen na een muisklik de focus, zodat de spatiebalk niet nog eens "klikt".
document.addEventListener('click', (e) => { if (e.detail > 0) e.target.closest('button')?.blur(); });

// ---------- Tekenen ----------

function renderPanel() {
  if (!panels[state.view.panel]) state.view.panel = 'sound';
  const name = state.view.panel;
  for (const t of tabs.children) t.setAttribute('aria-selected', String(t.dataset.panel === name));
  for (const b of railPanels) b.classList.toggle('on', b.dataset.panel === name);
  const p = panels[name];
  panelCtx.replaceChildren();
  if (panelBody.firstChild !== p.el) panelBody.replaceChildren(p.el);
  p.render();
}

function updateTransport() {
  const p = state.project;
  ui.play.replaceChildren(icon(engine.playing ? 'pause' : 'play'));
  ui.play.classList.toggle('on', engine.playing);
  ui.rec.classList.toggle('on', !!recording);
  ui.loop.classList.toggle('on', p.loop.on);
  ui.loop.setAttribute('aria-pressed', String(p.loop.on));
  ui.metro.classList.toggle('on', p.metronome);
  ui.metro.setAttribute('aria-pressed', String(p.metronome));
  if (document.activeElement !== ui.bpm) ui.bpm.value = p.bpm;
  if (document.activeElement !== ui.name) ui.name.value = p.name;
  ui.undo.disabled = !canUndo();
  ui.redo.disabled = !canRedo();
  ui.rate.textContent = `${engine.ctx ? `${(engine.ctx.sampleRate / 1000).toFixed(1)} kHz, ` : ''}${p.bpm} BPM, 4/4, ${p.tracks.length} sporen`;
  document.title = `${p.name} - PulseStudio`;
}

function renderAll() {
  updateTransport();
  arrange.render();
  renderPanel();
  browser.render();
}

function drawPlayhead() {
  const pos = app.playhead();
  arrange.setPlayhead(pos);
  const [bar, beat, six] = formatPosition(pos).split('.');
  ui.pos.textContent = `${bar.padStart(3, '0')}.${beat}.${six}`;
  ui.time.textContent = formatTime(pos * 60 / state.project.bpm);
}

let saveTimer = null;
function scheduleSave() {
  ui.saved.textContent = 'Opslaan…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!state.project) return;
  try {
    // Instellingen die in de interface van een plug-in zijn veranderd, gaan mee in het project.
    await engine.collectWamStates(state.project).catch(() => {});
    await store.saveProject(state.project);
    await store.setMeta('last', state.project.id);
    ui.saved.textContent = 'Opgeslagen';
  } catch (err) {
    ui.saved.textContent = 'Niet opgeslagen';
    console.error(err);
  }
}

subscribe((scope) => {
  switch (scope) {
    case 'select': state.view.inspectMaster = false; state.view.inspectReturn = null; arrange.updateSelection(); mixer.updateSelection(); if (state.view.panel !== 'mixer') renderPanel(); break;
    case 'params': engine.sync(); break;
    case 'notes': arrange.render(); editor.draw(); break;
    case 'arrange': case 'clip': arrange.render(); syncSoon(); break;
    case 'view': arrange.render(); break;
    case 'loop': arrange.render(); updateTransport(); break;
    case 'transport': engine.sync(); updateTransport(); break;
    case 'panel': renderPanel(); break;
    case 'plugin': break; // knoppen van een plug-in: de plug-in houdt zelf zijn waarde bij
    default: engine.sync(); renderAll();
  }
  if (!['select', 'view', 'panel'].includes(scope)) scheduleSave();
  ui.undo.disabled = !canUndo();
  ui.redo.disabled = !canRedo();
});

// Na slepen of draaien aan een clip: even wachten en dan pas de gerekte versies laten uitrekenen.
let syncTimer = null;
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(() => engine.sync(), 350); }

// Wat je in de eigen interface van een plug-in verandert, ziet PulseStudio niet; daarom regelmatig ophalen en zo nodig opslaan.
setInterval(async () => {
  const p = state.project;
  if (!p || !engine.ctx) return;
  const has = p.tracks.some((t) => t.kind === 'plugin' || t.inserts.some((i) => i.type === 'wam'))
    || p.masterInserts.some((i) => i.type === 'wam') || (p.returns || []).some((r) => r.inserts.some((i) => i.type === 'wam'));
  if (has && await engine.collectWamStates(p).catch(() => false)) scheduleSave();
}, 8000);

// Melding in de infobalk zolang er audio op tempo wordt gerekt.
let warpWasBusy = false;
onWarpChange((n) => {
  if (n > 0) { ui.rate.textContent = `Tijdrekken… (${n})`; warpWasBusy = true; }
  else if (warpWasBusy) { warpWasBusy = false; updateTransport(); }
});

function frame() {
  if (state.project) {
    if (engine.playing) {
      const pos = engine.position();
      const p = state.project;
      if (!recording && !p.loop.on && pos > Math.max(projectEnd(p), 1) + 0.25) stopAndReturn();
      else {
        drawPlayhead();
        arrange.follow(pos);
        if (state.view.panel === 'editor') editor.draw();
      }
    }
    if (engine.ctx) {
      const m = engine.meters();
      arrange.updateMeters(m);
      const lvl = (x) => clamp((gainToDb(x) + 60) / 66, 0, 1);
      ui.mmL.style.transform = `scaleX(${lvl(m.master[0])})`;
      ui.mmR.style.transform = `scaleX(${lvl(m.master[1])})`;
      if (state.view.panel === 'mixer') mixer.updateMeters(m, engine);
      if (state.view.panel === 'sound') for (const v of liveViews) v.tick(engine);
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Transport ----------

async function togglePlay() {
  await engine.ensure();
  if (engine.playing) {
    if (recording) { await finishRecording(); return; }
    playhead = engine.position();
    engine.stop();
  } else {
    playStart = playhead;
    engine.play(playhead);
  }
  updateTransport();
  drawPlayhead();
}

async function stopAndReturn() {
  if (recording) { await finishRecording(); return; }
  if (engine.playing) { engine.stop(); playhead = playStart; }
  else playhead = 0;
  updateTransport();
  drawPlayhead();
  editor.draw();
}

// ---------- Opnemen ----------

async function toggleRecord() {
  if (recording) { await finishRecording(); return; }
  await engine.ensure();
  const p = state.project;
  let armed = p.tracks.filter((t) => t.arm);
  if (!armed.length) {
    const t = selectedTrack();
    if (!t) { toast('Voeg eerst een spoor toe.'); return; }
    commit(() => { t.arm = true; });
    armed = [t];
  }
  const audioTrack = armed.find((t) => t.kind === 'audio');
  if (audioTrack) {
    try { await mic.start(); } catch (err) { toast(`Geen toegang tot de microfoon (${err.message}).`, 4000); return; }
  }
  if (engine.playing) engine.stop();
  recording = { startBeat: playhead, audioTrackId: audioTrack?.id || null, events: new Map() };
  playStart = playhead;
  engine.play(playhead);
  updateTransport();
  toast(audioTrack ? 'Opname loopt via de microfoon.' : 'Opname loopt: speel op je toetsenbord of MIDI-keyboard.');
}

async function finishRecording() {
  const rec = recording;
  recording = null;
  for (const [key, held] of heldNotes) if (held.rec) releaseNote(key);
  if (engine.playing) engine.stop();
  playhead = rec.startBeat;
  const blob = rec.audioTrackId ? await mic.stop() : null;
  const p = state.project;
  const spb = 60 / p.bpm;
  const added = [];

  for (const [trackId, events] of rec.events) {
    const track = findTrack(trackId);
    if (!track || !events.length) continue;
    const first = Math.min(rec.startBeat, ...events.map((e) => e.beat));
    const last = Math.max(...events.map((e) => e.beat + e.d));
    const clip = clipFromRecording(track.kind, first, last, events);
    clip.name = 'Opname';
    added.push([track, clip]);
  }
  if (blob) {
    try {
      const buf = await engine.decode(await blob.arrayBuffer());
      const id = uid('a');
      await store.saveAudio({ id, projectId: p.id, name: 'Opname', blob });
      registerAudio(id, buf);
      const track = findTrack(rec.audioTrackId);
      // Opgenomen op het projecttempo, dus kan meteen meelopen als het tempo later verandert.
      if (track) added.push([track, createClip('audio', rec.startBeat, buf.duration / spb, { audioId: id, name: 'Opname', warp: true, srcBpm: p.bpm, mode: 'tones' })]);
    } catch (err) {
      toast('De opname kon niet worden verwerkt.');
      console.error(err);
    }
  }
  if (added.length) {
    commit(() => { for (const [track, clip] of added) track.clips.push(clip); });
    const [track, clip] = added[added.length - 1];
    select(track.id, clip.id);
    toast(`Opname toegevoegd (${added.length} clip${added.length > 1 ? 's' : ''}).`);
  } else {
    toast('Er is niets opgenomen.');
  }
  updateTransport();
  drawPlayhead();
}

// ---------- Live spelen: toetsenbord en MIDI ----------

const PIANO_KEYS = 'awsedftgyhujkolp';
const heldNotes = new Map();

function liveTarget() {
  const sel = selectedTrack();
  if (sel && sel.kind !== 'audio') return sel;
  return state.project.tracks.find((t) => t.arm && t.kind !== 'audio') || null;
}

async function pressNote(key, track, pitch, vel) {
  await engine.ensure();
  if (heldNotes.has(key)) releaseNote(key);
  engine.noteOn(track, pitch, vel);
  const rec = recording && track.arm && engine.playing;
  heldNotes.set(key, { track, pitch, vel, rec, beat: rec ? engine.position() : 0 });
}

function releaseNote(key) {
  const held = heldNotes.get(key);
  if (!held) return;
  heldNotes.delete(key);
  engine.noteOff(held.track, held.pitch);
  if (held.rec && recording) {
    const end = engine.position() ?? held.beat;
    const d = end > held.beat ? end - held.beat : 0.25;
    if (!recording.events.has(held.track.id)) recording.events.set(held.track.id, []);
    recording.events.get(held.track.id).push({ beat: held.beat, d: held.track.kind === 'drums' ? 0.25 : d, p: held.pitch, v: held.vel });
  }
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) { toast('Deze browser ondersteunt geen Web MIDI. Probeer Chrome of Edge.', 4000); return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = () => {
      let n = 0;
      for (const input of access.inputs.values()) {
        n++;
        input.onmidimessage = (e) => {
          const [status, d1, d2] = e.data;
          const cmd = status & 0xf0;
          const track = liveTarget();
          if (cmd === 0x90 && d2 > 0) { if (track) pressNote(`midi:${d1}`, track, d1, d2 / 127); }
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) releaseNote(`midi:${d1}`);
        };
      }
      return n;
    };
    const n = hook();
    access.onstatechange = hook;
    ui.midi.classList.toggle('on', n > 0);
    toast(n ? `MIDI gekoppeld (${n} ingang${n > 1 ? 'en' : ''}).` : 'Geen MIDI-apparaat gevonden. Sluit er een aan en probeer opnieuw.', 3500);
  } catch {
    toast('Geen toestemming voor MIDI.');
  }
}

const isTyping = (el) => el?.matches?.('input:not([type=range]):not([type=checkbox]), select, textarea, [contenteditable]');

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (k === 'e') { e.preventDefault(); splitSelected(); }
    else if (k === 's') { e.preventDefault(); saveNow(); toast('Opgeslagen.'); }
    return;
  }
  if (e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'Home') { e.preventDefault(); app.seek(0); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (!(focusArea === 'editor' && state.view.panel === 'editor' && editor.deleteSelected())) deleteSelectedClip();
    return;
  }
  if (k === 'r' && !e.repeat) { toggleRecord(); return; }
  if (k === 'l' && !e.repeat) { commit((p) => { p.loop.on = !p.loop.on; }, 'loop'); return; }
  if (k === 'm' && !e.repeat) { commit((p) => { p.metronome = !p.metronome; }, 'transport'); return; }
  if (k === 'b' && !e.repeat) { setBrowser(!browserOpen); return; }
  if (k === 'z' || k === 'x') {
    state.view.octave = clamp(state.view.octave + (k === 'z' ? -1 : 1), 0, 8);
    toast(`Octaaf ${state.view.octave}`, 900);
    return;
  }
  const i = PIANO_KEYS.indexOf(k);
  if (i >= 0) {
    e.preventDefault();
    if (e.repeat) return;
    const track = liveTarget();
    if (!track) return;
    const pitch = track.kind === 'drums' ? DRUM_KEYS[i] : (state.view.octave + 1) * 12 + i;
    if (pitch != null) pressNote(`key:${k}`, track, pitch, 0.85);
  }
});

window.addEventListener('keyup', (e) => releaseNote(`key:${e.key.toLowerCase()}`));
window.addEventListener('blur', () => { for (const key of [...heldNotes.keys()]) releaseNote(key); });

function deleteSelectedClip() {
  const clip = selectedClip();
  if (!clip) return;
  const track = trackOfClip(clip.id);
  commit(() => track.clips.splice(track.clips.indexOf(clip), 1));
  select(track.id, null);
}

// Splitst de geselecteerde clip op de afspeelkop.
function splitSelected() {
  const clip = selectedClip();
  if (!clip) { toast('Selecteer eerst een clip.'); return; }
  const track = trackOfClip(clip.id);
  const p = state.project;
  const at = app.playhead();
  const audio = track.kind === 'audio';
  const buf = audio ? buffers.get(clip.audioId) : null;
  const parts = splitClip(clip, at, { audio, spb: 60 / p.bpm, srcDur: buf ? buf.duration : Infinity, bpm: p.bpm });
  if (!parts) { toast('Zet de afspeelkop binnen de clip om te splitsen.'); return; }
  commit(() => { track.clips.splice(track.clips.indexOf(clip), 1, ...parts); });
  select(track.id, parts[1].id);
}

// Rendert een spoor (met effecten en sends) naar audio op een nieuw spoor en dempt het origineel.
async function bounceTrack(trackId) {
  const p = state.project;
  const track = findTrack(trackId);
  if (!track || !track.clips.length) { toast('Dit spoor heeft nog geen clips.'); return; }
  toast(`"${track.name}" wordt naar audio omgezet…`, 60000);
  try {
    await engine.collectWamStates(p);
    const first = Math.min(...track.clips.map((c) => c.start));
    const end = Math.max(...track.clips.map((c) => c.start + c.length));
    const buf = await renderProject(p, buffers, { only: track.id, end, tail: 2, sampleRate: engine.ctx?.sampleRate || 44100 });
    // Alles vóór de eerste clip wegknippen.
    const spb = 60 / p.bpm;
    const skip = Math.floor(first * spb * buf.sampleRate);
    const trimmed = new AudioBuffer({ length: Math.max(1, buf.length - skip), numberOfChannels: 2, sampleRate: buf.sampleRate });
    for (let c = 0; c < 2; c++) trimmed.copyToChannel(buf.getChannelData(c).subarray(skip), c);
    const name = `${track.name} (audio)`;
    const blob = new Blob([encodeWav(channelsOf(trimmed), trimmed.sampleRate, 24)], { type: 'audio/wav' });
    const id = await storeAudio(blob, name, trimmed);
    const t = createTrack('audio', p.tracks.length, name);
    t.color = track.color;
    t.clips.push(createClip('audio', first, end - first, { audioId: id, name, warp: true, srcBpm: p.bpm, mode: 'tones' }));
    commit(() => { p.tracks.splice(p.tracks.indexOf(track) + 1, 0, t); track.mute = true; });
    select(t.id, t.clips[0].id);
    toast(`Klaar: "${name}" staat eronder; het origineel is gedempt.`, 4000);
  } catch (err) {
    toast(`Omzetten is mislukt: ${err.message}`, 4000);
    console.error(err);
  }
}

function duplicateSelected() {
  const clip = selectedClip();
  if (!clip) return;
  const track = trackOfClip(clip.id);
  const copy = duplicateClip(clip);
  commit(() => track.clips.push(copy));
  select(track.id, copy.id);
}

// ---------- Audio importeren ----------

const channelsOf = (buf) => Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
function registerAudio(id, buf) {
  buffers.set(id, buf);
  peaks.set(id, computePeaks(channelsOf(buf)));
}

let pickTarget = { trackId: null, beat: null };
function pickAudio(trackId, beat) {
  pickTarget = { trackId, beat };
  filePicker.value = '';
  filePicker.click();
}
filePicker.addEventListener('change', async () => {
  let { trackId, beat } = pickTarget;
  for (const file of filePicker.files) {
    const clip = await importAudio(file, trackId, beat);
    if (clip) { trackId = trackOfClip(clip.id)?.id; beat = clip.start + clip.length; }
  }
});

async function importAudio(file, trackId, beat) {
  let buf;
  try {
    buf = await engine.decode(await file.arrayBuffer());
  } catch {
    toast(`"${file.name}" kan niet worden gelezen als audio.`, 3500);
    return null;
  }
  const p = state.project;
  const id = uid('a');
  await store.saveAudio({ id, projectId: p.id, name: file.name, blob: file });
  registerAudio(id, buf);
  const name = file.name.replace(/\.[^.]+$/, '');
  // Tempo bepalen: loops en bestanden met een tempo in de naam gaan meteen het projecttempo volgen.
  let warp = {};
  let tempo = null;
  try { tempo = await analyseTempo(buf, file.name); } catch { tempo = null; }
  if (tempo?.bpm && (tempo.source === 'naam' || tempo.source === 'loop')) {
    warp = { warp: true, srcBpm: tempo.bpm, loop: !!tempo.loop, mode: 'beats' };
  } else if (tempo?.bpm) {
    warp = { srcBpm: tempo.bpm };
  }
  const len = (buf.duration * (warp.warp ? warp.srcBpm / p.bpm : 1)) / (60 / p.bpm);
  const clip = createClip('audio', beat ?? snapFloor(playhead, BEATS_PER_BAR), warp.loop ? Math.round(len) || len : len, { audioId: id, name, ...warp });
  if (warp.warp) toast(`"${name}": ${warp.srcBpm} BPM${tempo.source === 'naam' ? ' (uit de naam)' : ''}. Volgt nu het projecttempo; met de randen verleng of rek je hem.`, 4500);
  let track = findTrack(trackId);
  commit(() => {
    if (!track || track.kind !== 'audio') {
      track = createTrack('audio', p.tracks.length, name);
      p.tracks.push(track);
    }
    track.clips.push(clip);
  });
  select(track.id, clip.id);
  return clip;
}

// Bewaart een AudioBuffer of bestand als audio van dit project en geeft het id terug.
async function storeAudio(blob, name, buf) {
  const id = uid('a');
  await store.saveAudio({ id, projectId: state.project.id, name, blob });
  registerAudio(id, buf);
  return id;
}

// Laat de gebruiker een sample kiezen (voor de sampler of een drumpad).
const samplePicker = h('input', { type: 'file', accept: 'audio/*', hidden: true });
document.body.append(samplePicker);
function pickSample() {
  return new Promise((resolve) => {
    samplePicker.value = '';
    samplePicker.onchange = async () => {
      const file = samplePicker.files[0];
      if (!file) return resolve(null);
      try {
        const buf = await engine.decode(await file.arrayBuffer());
        const name = file.name.replace(/\.[^.]+$/, '');
        resolve({ id: await storeAudio(file, name, buf), name });
      } catch {
        toast(`"${file.name}" kan niet worden gelezen als audio.`, 3500);
        resolve(null);
      }
    };
    samplePicker.click();
  });
}

// ---------- Bibliotheek ----------

const libCache = new Map();
async function libraryBuffer(item) {
  const key = `${item.id}@${state.project.bpm}`;
  if (!libCache.has(key)) libCache.set(key, await renderLibraryItem(item, state.project.bpm));
  return libCache.get(key);
}

// Voorbeeldweergave vanuit de browser: geluid, synthpreset of drumkit.
async function previewItem(item) {
  await engine.ensure();
  try {
    if (item.kind === 'sound') {
      ui.info.textContent = 'Geluid wordt gemaakt…';
      engine.previewBuffer(await libraryBuffer(LIBRARY.find((i) => i.id === item.id)));
    } else if (item.kind === 'preset') engine.previewSynth(defaultSynth(item.id), 60);
    else if (item.kind === 'kit') {
      if (isSampleKit(item.id)) await withProgress(DRUM_KITS[item.id].name, (cb) => loadKit(item.id, cb));
      engine.previewKit(defaultDrums(item.id));
    } else if (item.kind === 'instrument') {
      const zones = await withProgress(INSTRUMENTS[item.id].name, (cb) => loadInstrument(item.id, cb));
      engine.previewInstrument(item.id, zones);
    } else if (item.kind === 'pattern') {
      const pat = findPattern(item.id);
      const loop = LIBRARY.find((i) => i.id === `loop-${pat.id}`);
      if (loop) engine.previewBuffer(await libraryBuffer(loop));
    }
  } catch {
    toast('Dit geluid kon niet worden geladen. Controleer de internetverbinding.', 3500);
  }
}

// Laadt opnames met voortgang in de infobalk.
async function withProgress(name, load) {
  ui.info.textContent = `${name} laden…`;
  const res = await load((f) => { ui.info.textContent = `${name} laden… ${Math.round(f * 100)}%`; });
  ui.info.textContent = `${name} geladen.`;
  return res;
}

// Iets uit de browser plaatsen: op een spoor (slepen), of op het geselecteerde spoor (dubbelklik of plusknop).
async function dropItem(data, { trackId = null, beat = null, useSelection = false } = {}) {
  const p = state.project;
  let target = trackId ? findTrack(trackId) : null;
  if (useSelection && !state.view.inspectMaster) target = selectedTrack();
  const at = beat ?? snapFloor(app.playhead(), BEATS_PER_BAR);
  const newTrack = (kind, name, init) => {
    const t = createTrack(kind, p.tracks.length, name);
    init?.(t);
    commit(() => p.tracks.push(t));
    select(t.id, null);
    return t;
  };
  if (data.kind === 'sound') {
    const item = LIBRARY.find((i) => i.id === data.id);
    if (!item) return;
    ui.info.textContent = `"${item.name}" wordt gemaakt…`;
    const buf = await libraryBuffer(item);
    const blob = new Blob([encodeWav(channelsOf(buf), buf.sampleRate)], { type: 'audio/wav' });
    const id = await storeAudio(blob, item.name, buf);
    const sampleProps = { audioId: id, sampleName: item.name, root: item.root ?? 60, loop: !!item.loop, ...(item.loop ? { loopStart: item.loop[0], loopEnd: item.loop[1], release: 0.6 } : {}) };
    if (data.asSampler || target?.kind === 'sampler') {
      if (target?.kind === 'sampler') { commit(() => Object.assign(target.sampler, sampleProps)); select(target.id, null); }
      else newTrack('sampler', item.name, (t) => Object.assign(t.sampler, sampleProps));
      app.showPanel('sound');
      toast(`Sampler met "${item.name}". Speel op je toetsenbord of dubbelklik in het spoor voor een clip.`, 3800);
      return;
    }
    let track = target?.kind === 'audio' ? target : null;
    // Gemaakt op het huidige tempo: loops en tempo-effecten volgen voortaan het projecttempo.
    const loopish = item.cat === 'Drumloops' || item.cat === 'Melodische loops';
    const warp = loopish || item.cat === 'Effecten' || item.cat === 'Akkoorden'
      ? { warp: true, srcBpm: p.bpm, loop: loopish, mode: item.cat === 'Drumloops' ? 'beats' : 'tones' } : {};
    const beats = buf.duration / (60 / p.bpm);
    const clip = createClip('audio', at, loopish ? Math.round(beats * 64) / 64 : beats, { audioId: id, name: item.name, ...warp });
    commit(() => {
      if (!track) { track = createTrack('audio', p.tracks.length, item.name); p.tracks.push(track); }
      track.clips.push(clip);
    });
    select(track.id, clip.id);
    toast(`"${item.name}" staat op maat ${Math.floor(clip.start / BEATS_PER_BAR) + 1}.`);
    return;
  }
  if (data.kind === 'preset') {
    if (target?.kind === 'synth') { commit(() => { target.synth = defaultSynth(data.id); }); select(target.id, null); app.audition(target, 60, 0.8); }
    else newTrack('synth', data.id, (t) => { t.synth = defaultSynth(data.id); });
    app.showPanel('sound');
    return;
  }
  if (data.kind === 'kit') {
    if (isSampleKit(data.id)) withProgress(DRUM_KITS[data.id].name, (cb) => loadKit(data.id, cb)).catch(() => toast('De opnames konden niet worden geladen.'));
    if (target?.kind === 'drums') { commit(() => { target.drums.kit = data.id; }, 'params'); select(target.id, null); app.audition(target, 36, 0.9); }
    else newTrack('drums', 'Drums', (t) => { t.drums = defaultDrums(data.id); });
    app.showPanel('sound');
    return;
  }
  if (data.kind === 'instrument') {
    const def = INSTRUMENTS[data.id];
    withProgress(def.name, (cb) => loadInstrument(data.id, cb)).catch(() => toast('De opnames konden niet worden geladen.'));
    if (target?.kind === 'sampler') { commit(() => { Object.assign(target.sampler, { instrument: data.id, sampleName: def.name }); }); select(target.id, null); }
    else newTrack('sampler', def.name.split(' (')[0], (t) => { t.sampler = defaultSampler(data.id); t.sampler.sampleName = def.name; });
    app.showPanel('sound');
    return;
  }
  if (data.kind === 'pattern') {
    const pat = findPattern(data.id);
    if (!pat) return;
    const drums = isDrumPattern(pat);
    const { notes, length } = drums ? drumNotes(pat) : melodicNotes(pat);
    const fits = drums ? target?.kind === 'drums' : target && ['synth', 'sampler'].includes(target.kind);
    let track = fits ? target : null;
    if (!track) {
      track = createTrack(drums ? 'drums' : pat.instrument ? 'sampler' : 'synth', p.tracks.length, pat.name);
      if (drums) track.drums = defaultDrums(pat.kit);
      else if (pat.instrument) track.sampler = defaultSampler(pat.instrument);
      else track.synth = defaultSynth(pat.preset);
      if (drums && isSampleKit(pat.kit)) loadKit(pat.kit).catch(() => {});
      if (pat.instrument) loadInstrument(pat.instrument).catch(() => {});
    }
    const clip = createClip(track.kind, at, Math.max(length, 4 * BEATS_PER_BAR), { pattern: length, name: pat.name, notes });
    commit(() => { if (!p.tracks.includes(track)) p.tracks.push(track); track.clips.push(clip); });
    select(track.id, clip.id);
    app.showPanel('editor');
    toast(`"${pat.name}" staat op maat ${Math.floor(at / BEATS_PER_BAR) + 1}. Je kunt de noten aanpassen in de editor.`, 3500);
    return;
  }
  if (data.kind === 'wam') {
    if (!data.url || !(data.trusted || await trustPlugin(data))) return;
    if (data.instrument) {
      const plugin = { url: data.url, name: data.name, vendor: data.vendor || '', state: null };
      if (target?.kind === 'plugin') { commit(() => { target.plugin = plugin; }); select(target.id, null); }
      else newTrack('plugin', data.name, (t) => { t.plugin = plugin; });
      app.showPanel('sound');
      toast(`${data.name} wordt geladen. Speel op je toetsenbord (A W S E D…) of teken noten in de editor.`, 4000);
      return;
    }
    if (useSelection && state.view.inspectMaster) { addWamEffect(data, p.masterInserts); app.showMaster(); return; }
    const ret = useSelection && (p.returns || []).find((r) => r.id === state.view.inspectReturn);
    if (ret) { addWamEffect(data, ret.inserts); app.showReturn(ret.id); return; }
    if (!target) { toast('Sleep een plug-in op een spoor, of in de keten in het Klank-paneel.'); return; }
    addWamEffect(data, target.inserts);
    select(target.id, null);
    app.showPanel('sound');
    return;
  }
  if (data.kind === 'fx') {
    if (useSelection && state.view.inspectMaster) { commit(() => p.masterInserts.push(createInsert(data.id))); app.showMaster(); return; }
    const ret = useSelection && (p.returns || []).find((r) => r.id === state.view.inspectReturn);
    if (ret) { commit(() => ret.inserts.push(createInsert(data.id, ['plate', 'freeverb', 'reverb', 'delay', 'chorus', 'ensemble'].includes(data.id) ? { mix: 1 } : {}))); app.showReturn(ret.id); return; }
    if (!target) { toast('Sleep een effect op een spoor, of in de keten in het Klank-paneel.'); return; }
    commit(() => target.inserts.push(createInsert(data.id)));
    select(target.id, null);
    app.showPanel('sound');
    toast(`${PLUGIN_DEFS[data.id].name} toegevoegd aan "${target.name}".`);
  }
}

// ---------- Plug-ins (Web Audio Modules) ----------

// Een plug-in is code van een andere maker die in PulseStudio draait. Eén keer uitleggen voor de catalogus;
// voor een eigen adres altijd vragen.
async function trustPlugin(data) {
  let ok = false;
  try { ok = localStorage.getItem('pulsestudio.wamOk') === '1'; } catch { ok = false; }
  const fromCatalog = data.url.startsWith(CATALOG_BASE);
  if (ok && fromCatalog) return true;
  const msg = fromCatalog
    ? `"${data.name}" is een plug-in van ${data.vendor || 'een andere maker'} uit de WAM-community-catalogus. Plug-ins zijn programma's van andere makers die binnen PulseStudio draaien en worden van internet geladen. Doorgaan?`
    : `Plug-in laden van ${new URL(data.url).host}?\n\nEen plug-in is een programma dat binnen PulseStudio draait en bij je projecten kan. Laad alleen plug-ins van makers die je vertrouwt.`;
  if (!confirm(msg)) return false;
  if (fromCatalog) { try { localStorage.setItem('pulsestudio.wamOk', '1'); } catch { /* geen opslag */ } }
  return true;
}

function addWamEffect(data, inserts) {
  commit(() => inserts.push(createWamInsert(data)));
  toast(`${data.name} wordt geladen…`, 2500);
}
app.addWamEffect = (data, inserts) => { trustPlugin(data).then((ok) => { if (ok) addWamEffect(data, inserts); }); };

async function loadWamFromUrl() {
  const url = (prompt('Adres van de plug-in (het index.js-bestand van een WAM 2.0-plug-in):', 'https://') || '').trim();
  if (!url || url === 'https://') return;
  if (!isSafeUrl(url)) { toast('Gebruik een https-adres.', 3500); return; }
  const name = decodeURIComponent(url.split('/').slice(-2, -1)[0] || 'Plug-in');
  const data = { kind: 'wam', url, name, vendor: new URL(url).host };
  // Eerst toestemming, dan pas de code laden.
  if (!(await trustPlugin(data))) return;
  toast('Plug-in controleren…', 10000);
  try { await loadWamModule(url); } catch (err) { toast(`Dit is geen bruikbare plug-in: ${err.message}`, 5000); return; }
  data.instrument = confirm(`Is "${name}" een instrument (speelt noten)?\n\nOK = instrument op een eigen spoor, Annuleren = effect op het geselecteerde spoor.`);
  dropItem({ ...data, trusted: true }, { useSelection: true });
}
app.loadWamFromUrl = loadWamFromUrl;

// ---------- Exporteren ----------

let exporting = false;
const exportOpts = { what: 'mix', bits: 24, rate: 44100 };
try { Object.assign(exportOpts, JSON.parse(localStorage.getItem('pulsestudio.export') || '{}')); } catch { /* geen opslag */ }

function exportWav() {
  const p = state.project;
  if (projectEnd(p) <= 0) { toast('Er staat nog niets in het project om te exporteren.'); return; }
  const pickRow = (label, key, options) => h('div.exp-row', {}, h('span.lbl', {}, label),
    h('div.pick', { role: 'radiogroup', 'aria-label': label }, options.map(([v, text, tip]) => {
      const b = h('button', { type: 'button', role: 'radio', title: tip || null, class: exportOpts[key] === v ? 'on' : null, 'aria-checked': String(exportOpts[key] === v) }, text);
      b.addEventListener('click', () => {
        exportOpts[key] = v;
        for (const x of b.parentNode.children) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }
      });
      return b;
    })));
  const go = h('button.btn.primary', { onclick: () => { dlg.close(); runExport(); } }, icon('download', 15), 'Exporteren');
  const dlg = dialog('Exporteren',
    h('div.exp', {},
      pickRow('Wat', 'what', [['mix', 'Mix (stereo)', 'Het hele nummer via de master'], ['stems', 'Stems (zip)', 'Elk spoor apart, even lang, met zijn effecten en sends maar zonder masterketen']]),
      pickRow('Bitdiepte', 'bits', [[16, '16 bit', 'Cd-kwaliteit, met dither'], [24, '24 bit', 'Studiokwaliteit, voor verder mixen of masteren']]),
      pickRow('Samplefrequentie', 'rate', [[44100, '44,1 kHz'], [48000, '48 kHz', 'Standaard voor video']]),
      h('p.hint', {}, 'Na het exporteren zie je de luidheid (LUFS) en de piek. Streamingdiensten spelen af rond -14 LUFS; luider maakt het daar niet harder.')),
    h('div.dlg-actions', { style: { justifyContent: 'flex-end', paddingBottom: '16px' } }, h('button.btn', { onclick: () => dlg.close() }, 'Annuleren'), go));
}

async function runExport() {
  if (exporting) return;
  const p = state.project;
  try { localStorage.setItem('pulsestudio.export', JSON.stringify(exportOpts)); } catch { /* geen opslag */ }
  exporting = true;
  const safe = p.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'PulseStudio';
  const { bits, rate } = exportOpts;
  try {
    await engine.collectWamStates(p);
    if (exportOpts.what === 'stems') {
      const end = projectEnd(p);
      const files = [];
      const tracks = p.tracks.filter((t) => t.clips.length);
      for (const [i, t] of tracks.entries()) {
        toast(`Stems exporteren… ${i + 1} van ${tracks.length}: ${t.name}`, 60000);
        const buf = await renderProject(p, buffers, { only: t.id, end, sampleRate: rate });
        files.push({ name: `${String(i + 1).padStart(2, '0')} ${t.name.replace(/[\\/:*?"<>|]+/g, '')}.wav`, data: encodeWav(channelsOf(buf), buf.sampleRate, bits) });
      }
      download(zipFiles(files), `${safe} - stems.zip`);
      toast(`Klaar: ${files.length} stems in "${safe} - stems.zip".`, 4500);
    } else {
      toast('Exporteren… dit kan even duren.', 60000);
      const buf = await renderProject(p, buffers, { sampleRate: rate });
      const ch = channelsOf(buf);
      download(new Blob([encodeWav(ch, buf.sampleRate, bits)], { type: 'audio/wav' }), `${safe}.wav`);
      const m = measure(ch, buf.sampleRate);
      const lufsText = Number.isFinite(m.integrated) ? `${m.integrated.toFixed(1)} LUFS` : 'stil';
      toast(`Klaar: "${safe}.wav" (${bits} bit, ${rate / 1000} kHz). Luidheid ${lufsText}, piek ${gainToDb(m.peak).toFixed(1)} dB.`, 6000);
    }
  } catch (err) {
    toast(`Exporteren is mislukt: ${err.message}`, 4000);
    console.error(err);
  } finally {
    exporting = false;
  }
}

// ---------- Projecten ----------

async function openProject(raw) {
  if (engine.playing) engine.stop();
  playhead = 0;
  playStart = 0;
  const p = migrate(raw);
  buffers.clear();
  peaks.clear();
  try {
    for (const rec of await store.audioForProject(p.id)) {
      try { registerAudio(rec.id, await engine.decode(await rec.blob.arrayBuffer())); } catch { /* onleesbaar bestand overslaan */ }
    }
  } catch (err) { console.error(err); }
  setProject(p);
  drawPlayhead();
  // Opnames die dit project gebruikt alvast op de achtergrond laden.
  preloadProject(p, (f) => { ui.info.textContent = `Opnames laden… ${Math.round(f * 100)}%`; })
    .then((res) => { if (res.length) ui.info.textContent = res.some((r) => r.status === 'rejected') ? 'Niet alle opnames konden worden geladen (geen internet?).' : 'Opnames geladen.'; });
}

function dialog(title, ...content) {
  const dlg = h('dialog.dlg', {},
    h('div.dlg-head', {}, h('h2', {}, title), h('button.ibtn', { 'aria-label': 'Sluiten', onclick: () => dlg.close() }, icon('close', 16))),
    ...content);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

async function showProjects() {
  await saveNow();
  const list = await store.listProjects();
  const fmt = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' });
  const startNew = async (project) => { dlg.close(); await openProject(project); await saveNow(); };
  const rows = list.map((item) => h('li.proj', { class: item.id === state.project.id ? 'current' : null },
    h('div.proj-info', {}, h('strong', {}, item.name), h('span', {}, `${fmt.format(item.updated)} · ${item.tracks} sporen · ${item.bpm} BPM`)),
    h('button.btn', { disabled: item.id === state.project.id, onclick: async () => { dlg.close(); await openProject(await store.loadProject(item.id)); } }, item.id === state.project.id ? 'Geopend' : 'Openen'),
    h('button.btn.danger', {
      onclick: async () => {
        if (!confirm(`"${item.name}" definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
        await store.deleteProject(item.id);
        dlg.close();
        if (item.id === state.project.id) {
          const rest = await store.listProjects();
          await openProject(rest.length ? await store.loadProject(rest[0].id) : demoProject());
        }
        showProjects();
      },
    }, 'Verwijderen')));
  const dlg = dialog('Projecten',
    h('div.dlg-actions', {},
      h('button.btn.primary', {
        onclick: () => {
          const p = createProject();
          p.tracks.push(createTrack('drums', 0, 'Drums'), createTrack('synth', 1, 'Synth'));
          startNew(p);
        },
      }, icon('plus', 16), 'Nieuw project'),
      h('button.btn', { onclick: () => startNew(demoProject()) }, 'Nieuw voorbeeldproject')),
    h('ul.proj-list', {}, rows));
}

function showHelp() {
  const rows = [
    ['Spatie', 'Afspelen / pauze'], ['Home', 'Naar het begin'], ['R', 'Opnemen'], ['L', 'Loop aan/uit'], ['M', 'Metronoom'],
    ['A W S E D F T G Y H U J K', 'Noten spelen op het geselecteerde spoor'], ['Z / X', 'Octaaf lager / hoger'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Ongedaan maken / opnieuw'], ['Ctrl+D', 'Clip dupliceren'], ['Ctrl+E', 'Clip splitsen op de afspeelkop'], ['Delete', 'Clip of noot wissen'],
    ['Rand van een clip slepen', 'Korter of langer maken (audio met loop herhaalt)'], ['Hoekje rechtsonder of Alt + rechterrand', 'Rekken: het geluid of de noten gaan mee'],
    ['Dubbelklik in een spoor', 'Nieuwe clip (of audio kiezen)'], ['Slepen in de liniaal', 'Loopgebied kiezen (Shift: per tel)'],
    ['Ctrl + scrollwiel', 'In- en uitzoomen'], ['Shift tijdens slepen', 'Fijner raster'], ['Dubbelklik op een schuif', 'Standaardwaarde'],
  ];
  dialog('Sneltoetsen en bronnen',
    h('table.keys', {}, rows.map(([key, what]) => h('tr', {}, h('th', {}, key), h('td', {}, what)))),
    h('p.hint', {}, 'Alles wordt automatisch in deze browser opgeslagen. Gebruik Exporteren om je nummer als WAV-bestand te bewaren.'),
    h('h3.credits-title', {}, 'Opnames'),
    h('p.hint', {}, 'PulseStudio gebruikt vrij te gebruiken opnames. Ze worden geladen zodra je ze nodig hebt en daarna in deze browser bewaard, zodat ze ook offline werken.'),
    h('ul.credits', {}, CREDITS.map((c) => h('li', {},
      h('strong', {}, c.name), ` door ${c.by}, `, h('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.license), `. Gebruikt voor: ${c.use}.`))),
    h('h3.credits-title', {}, 'Plug-ins'),
    h('p.hint', {}, 'Onder Plug-ins in de browser staan Web Audio Modules (WAM 2.0) uit de ',
      h('a', { href: 'https://www.webaudiomodules.com/community/', target: '_blank', rel: 'noopener' }, 'WAM-community-catalogus'),
      '. Elke plug-in heeft zijn eigen maker en licentie en wordt van internet geladen. PulseStudio gebruikt het host-deel van de WAM-SDK (MIT-licentie).'));
}

// ---------- Start ----------

// Na de eerste klik of toets start de audio; dan kunnen ook de interfaces van plug-ins getoond worden.
const resume = () => engine.ensure().then(() => { if (state.view.panel === 'sound') renderPanel(); }).catch(() => {});
window.addEventListener('pointerdown', resume, { once: true, capture: true });
window.addEventListener('keydown', resume, { once: true, capture: true });
window.addEventListener('pagehide', () => saveNow());

async function boot() {
  let project = null;
  try {
    const last = await store.getMeta('last');
    if (last) project = await store.loadProject(last);
  } catch (err) { console.error(err); }
  await openProject(project || demoProject());
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
