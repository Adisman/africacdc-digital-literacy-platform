// API facade. Server mode → fetch (cookie session + CSRF header + offline outbox).
// Demo mode (GitHub Pages / no server) → runs the SAME core.js in the browser on a local store.
import { MemStore } from './store.js';
import { makeEnv } from './env.js';
import { seedBase, seedDemo } from './seed.js';
import { handle } from './core.js';
import { zip } from './zip.js';

const json = async (p) => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
const IDB = 'dlp-demo', KEY = 'snapshot-v3';
const idb = () => new Promise((ok, bad) => { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
const idbGet = async (k) => { try { const d = await idb(); return await new Promise((ok) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } catch { return null; } };
const idbPut = async (k, v) => { try { const d = await idb(); d.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch {} };
const idbDel = async (k) => { try { const d = await idb(); d.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch {} };
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const api = {
  mode: 'demo', starter: null, forcedOffline: false, listeners: new Set(),
  get offline() { return this.forcedOffline || (this.mode === 'server' && navigator.onLine === false); },
  on(fn) { this.listeners.add(fn); }, emit() { this.listeners.forEach((f) => f()); },

  async init() {
    try { const r = await fetch('api/health', { cache: 'no-cache', signal: AbortSignal.timeout(2500) }); const j = await r.json(); if (r.ok && j.ok && j.mode === 'server') this.mode = 'server'; } catch {}
    if (this.mode === 'server') { this.starter = null; window.addEventListener('online', () => this.flush()); return this.mode; }
    const [cur, pool] = await Promise.all([json('data/curriculum.json'), json('data/exam-pool.json')]);
    const modules = Object.fromEntries((await Promise.all(cur.modules.map((m) => json(`data/modules/${m.id}.json`)))).map((m) => [m.id, m]));
    this.starter = { cur, modules, pool }; this.env = makeEnv({ secret: 'DEMO-ONLY-NOT-A-SECRET', mode: 'demo' });
    let snap = await idbGet(KEY); this.db = new MemStore(() => this._dirty());
    if (snap) this.db.load(snap); else { const db0 = this.db; db0.onChange = null; seedBase(db0, this.env); seedDemo(db0, this.env, this.starter); db0.onChange = () => this._dirty(); this._save(); }
    return this.mode;
  },
  _dirty() { clearTimeout(this._t); this._t = setTimeout(() => this._save(), 600); },
  _save() { idbPut(KEY, this.db.dump()); },
  async resetDemo() { await idbDel(KEY); sessionStorage.removeItem('dlp-demo-user'); lsSet('dlp-outbox', []); location.reload(); },

  // ── session ──
  demoUser() { const id = sessionStorage.getItem('dlp-demo-user'); const u = id && this.db.get('users', id); return u && !u.disabled ? u : null; },
  demoPersonas() { const by = (e) => this.db.all('users').find((u) => u.email === e + '@demo.africacdc.example'); return ['learner', 'exam', 'trainer.mr', 'facility.mr', 'admin.mr', 'admin.cf', 'super'].map(by).filter(Boolean); },
  demoLogin(id) { sessionStorage.setItem('dlp-demo-user', id); },
  demoLogout() { sessionStorage.removeItem('dlp-demo-user'); },

  // ── calls ──
  async call(method, path, body, opts = {}) {
    const [p, qs] = path.split('?'); const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
    const queueable = method === 'POST' && (p === '/api/progress' || p === '/api/quiz/submit');
    if (this.offline && !opts.local) { if (queueable) return this.enqueue(p, body); return { status: 0, body: { error: 'offline' } }; }
    if (this.mode === 'demo') {
      const user = this.demoUser(); const r = handle({ db: this.db, env: this.env, starter: this.starter, user }, { method, path: p, query, body: body || {} });
      if (r.body && r.body.kind === 'zip' && !opts.raw) { r.body = { ...r.body, blob: new Blob([zip(r.body.files)], { type: 'application/zip' }) }; delete r.body.files; }
      return r;
    }
    try {
      const r = await fetch(path, { method, headers: { 'X-Requested-With': 'acdc-dlp', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('zip') || ct.startsWith('text/csv')) return { status: r.status, body: { kind: 'file', blob: await r.blob(), filename: (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'download' } };
      return { status: r.status, body: await r.json() };
    } catch (e) { if (queueable) return this.enqueue(p, body); return { status: 0, body: { error: 'network' } }; }
  },

  // ── offline outbox (idempotent; replayed through POST /api/sync) ──
  outbox() { return lsGet('dlp-outbox', []); },
  enqueue(p, body) { const ob = this.outbox(); ob.push({ id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), type: p === '/api/progress' ? 'progress' : 'quiz_submit', payload: body, ts: Date.now() }); lsSet('dlp-outbox', ob); this.emit(); return { status: 202, body: { queued: true } }; },
  async flush() {
    const ob = this.outbox(); if (!ob.length || this.offline) return null; const r = await this.call('POST', '/api/sync', { events: ob }); if (r.status !== 200) return null;
    const done = new Set(r.body.results.filter((x) => x.status !== 'error' || true).map((x) => x.id)); lsSet('dlp-outbox', ob.filter((e) => !done.has(e.id))); this.emit(); return r.body.results;
  },
  // offline course packages (lessons + prepared quiz attempts) kept on the device
  packages() { return lsGet('dlp-offline-pkgs', {}); },
  async downloadPackages(ids) { const r = await this.call('POST', '/api/offline/package', { courses: ids }, { local: true }); if (r.status !== 200) return r; const all = this.packages(); r.body.packages.forEach((p) => { all[p.course.id] = { ...p, savedAt: Date.now() }; }); lsSet('dlp-offline-pkgs', all); return r; },
  removePackage(id) { const all = this.packages(); delete all[id]; lsSet('dlp-offline-pkgs', all); },
};
