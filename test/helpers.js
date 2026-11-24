import { readFileSync, readdirSync } from 'node:fs';
import { MemStore } from '../public/js/store.js';
import { makeEnv } from '../public/js/env.js';
import { seedBase } from '../public/js/seed.js';
import { handle, createUser, permFor } from '../public/js/core.js';
const D = new URL('../public/data/', import.meta.url);
export function loadStarter() {
  const cur = JSON.parse(readFileSync(new URL('curriculum.json', D))), modules = {};
  for (const f of readdirSync(new URL('modules/', D))) { const m = JSON.parse(readFileSync(new URL('modules/' + f, D))); modules[m.id] = m; }
  return { cur, modules, pool: JSON.parse(readFileSync(new URL('exam-pool.json', D))) };
}
export function makeWorld() {
  const starter = loadStarter(), db = new MemStore(), env = makeEnv({ secret: 'test-secret', mode: 'test' });
  let t = Date.UTC(2026, 5, 1); env.now = () => t; const tick = (ms = 1000) => { t += ms; };
  seedBase(db, env, { admin: { email: 'root@x.org', password: 'pw', name: 'Root' } });
  const ctxFor = (u) => ({ db, env, starter, user: u ? db.get('users', u.id) : null });
  const call = (u, method, path, body, query) => handle(ctxFor(u), { method, path, body, query });
  const mkUser = (o) => createUser({ db, env, starter, user: null }, { password: 'pw', ...o }).user;
  const root = db.all('users').find((x) => x.role === 'super_admin');
  // tenants: MR (pilot), CF (pilot)
  for (const id of ['MR', 'CF']) { const x = db.get('tenants', id); x.status = 'pilot'; db.put('tenants', x); }
  const fac = (tenant, name) => call(root, 'POST', '/api/admin/facilities', { tenant, name, type: 'health_centre', region: 'R1' }).body.facility;
  const f1 = fac('MR', 'MR Centre'), f2 = fac('MR', 'MR Post'), g1 = fac('CF', 'CF Centre');
  const users = { root, msMR: mkUser({ tenant: 'MR', role: 'ms_admin', email: 'ms@mr.org', name: 'MS Admin MR' }), msCF: mkUser({ tenant: 'CF', role: 'ms_admin', email: 'ms@cf.org', name: 'MS Admin CF' }),
    faMR: mkUser({ tenant: 'MR', facility: f1.id, role: 'facility_admin', email: 'fa@mr.org', name: 'FA MR' }), trMR: mkUser({ tenant: 'MR', facility: f1.id, role: 'trainer', email: 'tr@mr.org', name: 'Trainer MR' }),
    l1: mkUser({ tenant: 'MR', facility: f1.id, role: 'learner', email: 'l1@mr.org', name: 'Aminetou Sow', sex: 'F', ageBand: '25-34', profession: 'nurse' }), l2: mkUser({ tenant: 'MR', facility: f2.id, role: 'learner', email: 'l2@mr.org', name: 'Seydou Ba' }), lCF: mkUser({ tenant: 'CF', facility: g1.id, role: 'learner', email: 'l@cf.org', name: 'Claudine Bangui' }) };
  /** Take a quiz/exam, answering correctly (right=true) or wrongly. Reads the attempt key via the seed (test-only). */
  const take = (u, start, right = true) => { const s = start; if (s.status !== 200) return s; const att = db.get('attempts', s.body.attemptId); const ans = s.body.questions.map((q) => { const p = permFor(att.seed, q.id); const correct = p.indexOf(0); return right ? correct : (correct + 1) % 3; }); return call(u, 'POST', '/api/quiz/submit', { attemptId: att.id, answers: ans }); };
  const study = (u, id) => { const n = starter.modules[id].lessons.length; for (let i = 0; i < n; i++) call(u, 'POST', '/api/progress', { course: id, lesson: i }); };
  const pass = (u, id) => { study(u, id); tick(); return take(u, call(u, 'POST', '/api/quiz/start', { course: id })); };
  return { starter, db, env, tick, call, users, root, f1, f2, g1, take, study, pass, ctxFor };
}
