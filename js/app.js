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
};

// ---------- Opbouw van de interface ----------

const arrange = createArrange(app);
const editor = createEditor(app);
const mixer = createMixer(app);
const inspector = createInspector(app);
const panels = { editor, mixer, sound: inspector };
const PANEL_NAMES = { editor: 'Editor', mixer: 'Mixer', sound: 'Klank' };

const iconBtn = (name, label, onclick, extra = {}) => h('button.ibtn', { 'aria-label': label, title: label, onclick, ...extra }, icon(name));
const ui = {};
ui.back = iconBtn('back', 'Naar het begin (Home)', () => app.seek(0));
ui.play = iconBtn('play', 'Afspelen / pauze (spatie)', () => togglePlay());
ui.stop = iconBtn('stop', 'Stop en terug naar het startpunt', () => stopAndReturn());
ui.rec = iconBtn('record', 'Opnemen (R)', () => toggleRecord(), { class: 'rec' });
ui.pos = h('span.pos-beat', {}, '1.1.1');
ui.time = h('span.pos-time', {}, '0:00.0');
ui.bpm = h('input.bpm', { type: 'number', min: 30, max: 300, step: 1, 'aria-label': 'Tempo in BPM' });
ui.bpm.addEventListener('change', () => {
  const v = clamp(Math.round(+ui.bpm.value || 120), 30, 300);
  commit((p) => { p.bpm = v; });
});
ui.loop = iconBtn('loop', 'Loop aan/uit (L)', () => commit((p) => { p.loop.on = !p.loop.on; }, 'loop'));
ui.metro = iconBtn('metro', 'Metronoom aan/uit (M)', () => commit((p) => { p.metronome = !p.metronome; }, 'transport'));
ui.undo = iconBtn('undo', 'Ongedaan maken (Ctrl+Z)', () => undo());
ui.redo = iconBtn('redo', 'Opnieuw (Ctrl+Shift+Z)', () => redo());
ui.name = h('input.project-name', { 'aria-label': 'Naam van het project' });
ui.name.addEventListener('change', () => { const v = ui.name.value.trim(); if (v) commit((p) => { p.name = v; }, 'transport'); });
ui.saved = h('span.saved', {}, '');
ui.midi = iconBtn('midi', 'MIDI-keyboard koppelen', () => connectMidi());
const filePicker = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });

const topbar = h('header.topbar', {},
  h('div.brand', {}, h('span.logo', { 'aria-hidden': 'true' }), 'PulseStudio'),
  h('div.transport', {}, ui.back, ui.play, ui.stop, ui.rec,
    h('div.position', { title: 'Positie (maat.tel.zestiende) en tijd' }, ui.pos, ui.time),
    h('label.bpm-field', {}, ui.bpm, h('span', {}, 'BPM')),
    ui.loop, ui.metro),
  h('div.history', {}, ui.undo, ui.redo),
  h('div.project', {}, ui.name, ui.saved),
  h('div.actions', {},
    h('button.btn', { onclick: () => showProjects(), title: 'Projecten openen, maken en verwijderen' }, icon('folder', 16), 'Projecten'),
    h('button.btn', { onclick: () => pickAudio(null, null), title: 'Audiobestand importeren' }, icon('upload', 16), 'Importeren'),
    h('button.btn.primary', { onclick: () => exportWav(), title: 'Het hele nummer als WAV-bestand opslaan' }, icon('download', 16), 'Exporteren'),
    ui.midi,
    iconBtn('help', 'Sneltoetsen en uitleg', () => showHelp())),
  filePicker);

const tabs = h('nav.tabs', { role: 'tablist' }, Object.entries(PANEL_NAMES).map(([key, label]) =>
  h('button.tab', { role: 'tab', dataset: { panel: key }, onclick: () => app.showPanel(key) }, label)));
const panelBody = h('div.panel-body');
const splitter = h('div.splitter', { role: 'separator', 'aria-label': 'Paneelhoogte aanpassen', title: 'Sleep om het onderpaneel groter of kleiner te maken' });
const panel = h('section.panel', {}, tabs, panelBody);
document.getElementById('app').replaceChildren(topbar, h('main.arrange-wrap', {}, arrange.el), splitter, panel);
arrange.el.addEventListener('pointerdown', () => app.focus('arrange'));

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
  const name = state.view.panel;
  for (const t of tabs.children) t.setAttribute('aria-selected', String(t.dataset.panel === name));
  const p = panels[name];
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
  document.title = `${p.name} · PulseStudio`;
}

function renderAll() {
  updateTransport();
  arrange.render();
  renderPanel();
}

function drawPlayhead() {
  const pos = app.playhead();
  arrange.setPlayhead(pos);
  ui.pos.textContent = formatPosition(pos);
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
    case 'select': arrange.updateSelection(); mixer.updateSelection(); if (state.view.panel !== 'mixer') renderPanel(); break;
    case 'params': engine.sync(); break;
    case 'notes': arrange.render(); editor.draw(); break;
    case 'arrange': case 'clip': case 'view': arrange.render(); break;
    case 'loop': arrange.render(); updateTransport(); break;
    case 'transport': engine.sync(); updateTransport(); break;
    case 'panel': renderPanel(); break;
    default: engine.sync(); renderAll();
  }
  if (!['select', 'view', 'panel'].includes(scope)) scheduleSave();
  ui.undo.disabled = !canUndo();
  ui.redo.disabled = !canRedo();
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
    if (state.view.panel === 'mixer' && engine.ctx) mixer.updateMeters(engine.meters());
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
      if (track) added.push([track, createClip('audio', rec.startBeat, buf.duration / spb, { audioId: id, name: 'Opname' })]);
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
const DRUM_KEYS = [36, 38, 39, 42, 46, 45, 50, 49];
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
  const clip = createClip('audio', beat ?? snapFloor(playhead, BEATS_PER_BAR), buf.duration / (60 / p.bpm), { audioId: id, name });
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

// ---------- Exporteren ----------

let exporting = false;
async function exportWav() {
  if (exporting) return;
  const p = state.project;
  if (projectEnd(p) <= 0) { toast('Er staat nog niets in het project om te exporteren.'); return; }
  exporting = true;
  toast('Exporteren… dit kan even duren.', 60000);
  try {
    const buf = await renderProject(p, buffers);
    const wav = encodeWav(channelsOf(buf), buf.sampleRate);
    const safe = p.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'PulseStudio';
    download(new Blob([wav], { type: 'audio/wav' }), `${safe}.wav`);
    toast(`Klaar: "${safe}.wav" staat in je downloads.`, 4000);
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
}

function dialog(title, ...content) {
  const dlg = h('dialog.dlg', {},
    h('div.dlg-head', {}, h('h2', {}, title), h('button.ibtn', { 'aria-label': 'Sluiten', onclick: () => dlg.close() }, '✕')),
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
    ['Ctrl+Z / Ctrl+Shift+Z', 'Ongedaan maken / opnieuw'], ['Ctrl+D', 'Clip dupliceren'], ['Delete', 'Clip of noot wissen'],
    ['Dubbelklik in een spoor', 'Nieuwe clip (of audio kiezen)'], ['Slepen in de liniaal', 'Loopgebied kiezen (Shift: per tel)'],
    ['Ctrl + scrollwiel', 'In- en uitzoomen'], ['Shift tijdens slepen', 'Fijner raster'], ['Dubbelklik op een schuif', 'Standaardwaarde'],
  ];
  dialog('Sneltoetsen',
    h('table.keys', {}, rows.map(([key, what]) => h('tr', {}, h('th', {}, key), h('td', {}, what)))),
    h('p.hint', {}, 'Alles wordt automatisch in deze browser opgeslagen. Gebruik Exporteren om je nummer als WAV-bestand te bewaren.'));
}

// ---------- Start ----------

const resume = () => engine.ensure().catch(() => {});
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
