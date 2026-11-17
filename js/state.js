// Centrale toestand met ongedaan maken / opnieuw. Geen DOM, zodat het ook in node te testen is.
// Elke wijziging meldt een "scope"; onderdelen tekenen zich alleen opnieuw als die scope hen aangaat:
//   'all'     alles opnieuw tekenen
//   'params'  alleen klankinstellingen (geen DOM opnieuw opbouwen, wel de audio bijwerken)
//   'select'  alleen de selectie veranderde
//   'view'    zoom, paneel of iets anders dat niet in het project staat

export const state = {
  project: null,
  sel: { trackId: null, clipId: null },
  view: { zoom: 28, panel: 'editor', grid: 0.25, arrangeGrid: 1, octave: 4 },
};

const listeners = new Set();
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 150;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(scope = 'all') { for (const fn of listeners) fn(scope); }

export function setProject(project) {
  state.project = project;
  undoStack = [];
  redoStack = [];
  const first = project.tracks[0];
  state.sel = { trackId: first?.id || null, clipId: first?.clips[0]?.id || null };
  emit('all');
}

function pushUndo(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

// Eenmalige wijziging die in één stap ongedaan te maken is.
export function commit(mutator, scope = 'all') {
  pushUndo(JSON.stringify(state.project));
  mutator(state.project);
  state.project.updated = Date.now();
  emit(scope);
}

// Doorlopende wijziging (slepen, schuifregelaar): tussenstappen tellen niet als aparte stap.
export function gesture() {
  const before = JSON.stringify(state.project);
  let changed = false;
  return {
    update(mutator, scope = 'params') { mutator(state.project); changed = true; emit(scope); },
    end(scope = 'all') {
      if (changed && JSON.stringify(state.project) !== before) {
        pushUndo(before);
        state.project.updated = Date.now();
      }
      emit(scope);
    },
  };
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

function restore(json) {
  state.project = JSON.parse(json);
  const t = findTrack(state.sel.trackId);
  if (!t) state.sel.trackId = state.project.tracks[0]?.id || null;
  if (!findClip(state.sel.clipId)) state.sel.clipId = null;
  emit('all');
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(state.project));
  restore(undoStack.pop());
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(state.project));
  restore(redoStack.pop());
  return true;
}

export function select(trackId, clipId = null) {
  state.sel = { trackId, clipId };
  emit('select');
}

export const findTrack = (id) => state.project?.tracks.find((t) => t.id === id) || null;

export function findClip(id) {
  if (!id || !state.project) return null;
  for (const t of state.project.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

export const trackOfClip = (id) => state.project?.tracks.find((t) => t.clips.some((c) => c.id === id)) || null;
export const selectedTrack = () => findTrack(state.sel.trackId);
export const selectedClip = () => findClip(state.sel.clipId);
