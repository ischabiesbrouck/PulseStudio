// Opslag in IndexedDB: projecten, audiobestanden (per project) en wat losse instellingen.
const DB_NAME = 'pulsestudio';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const saveProject = (p) => run('projects', 'readwrite', (s) => s.put(p));
export const loadProject = (id) => run('projects', 'readonly', (s) => s.get(id));
export const listProjects = async () => {
  const all = await run('projects', 'readonly', (s) => s.getAll());
  return all.map(({ id, name, updated, bpm, tracks }) => ({ id, name, updated, bpm, tracks: tracks.length })).sort((a, b) => b.updated - a.updated);
};

export async function deleteProject(id) {
  await run('projects', 'readwrite', (s) => s.delete(id));
  const ids = await run('audio', 'readonly', (s) => s.index('projectId').getAllKeys(id));
  await run('audio', 'readwrite', (s) => { for (const k of ids) s.delete(k); });
}

export const saveAudio = (rec) => run('audio', 'readwrite', (s) => s.put(rec));
export const audioForProject = (projectId) => run('audio', 'readonly', (s) => s.index('projectId').getAll(projectId));

export const getMeta = (key) => run('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key, value) => run('meta', 'readwrite', (s) => s.put(value, key));
