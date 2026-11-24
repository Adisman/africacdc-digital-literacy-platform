// Africa CDC Digital Literacy Platform — core business logic.
// Pure, synchronous, storage-agnostic. Runs on the Node server (SQLite-backed store) AND in the
// browser demo (in-memory store persisted to IndexedDB). Same rules in both, so the demo is honest.
import { hmac, sha256hex } from './sha256.js';

export const CONTINENTAL = 'AFRICACDC';
export const ROLES = ['super_admin', 'ms_admin', 'facility_admin', 'trainer', 'learner'];
export const TIER = { super_admin: 1, ms_admin: 2, facility_admin: 3, trainer: 4, learner: 4 };
export const FACILITY_TYPES = ['health_post', 'health_centre', 'district_hospital', 'referral_hospital', 'community', 'admin_office', 'laboratory'];
export const PROFESSIONS = ['nurse', 'midwife', 'clinical_officer', 'physician', 'chw', 'pharmacist', 'lab_tech', 'data_officer', 'public_health', 'other'];
export const AGE_BANDS = ['<25', '25-34', '35-44', '45-54', '55+'];
export const SEXES = ['F', 'M', 'X'];
export const PASS_MARK = 70, MAX_ATTEMPTS = 3, DAY = 86400000;

// ───────────────────────── helpers ─────────────────────────
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const fail = (s, m, x) => { throw new HttpError(s, m, x); };
const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
const tl = (o) => (o && typeof o === 'object' ? { en: clean(o.en, 400), fr: clean(o.fr, 400) } : { en: clean(o, 400), fr: '' });

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedNum = (s) => parseInt(sha256hex(String(s)).slice(0, 8), 16);
export function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const permFor = (seed, qid, n = 3) => shuffle([...Array(n).keys()], mulberry32(seedNum(seed + '|' + qid)));
const pubUser = (u) => { if (!u) return u; const { pw, mfaSecret, mfaPending, ...r } = u; return { ...r, mfa: !!u.mfaEnabled }; };
export const maskName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length < 2 ? (p[0] || '') : `${p[0]} ${p[p.length - 1][0]}.`; };

// ───────────────────────── audit (tamper-evident hash chain) ─────────────────────────
export function audit(ctx, action, target = '', meta = {}, actorOverride) {
  const { db, env } = ctx, head = db.get('meta', 'audit_head') || { id: 'audit_head', seq: 0, hash: 'GENESIS' };
  const a = actorOverride || ctx.user;
  const rec = { id: 'a' + String(head.seq + 1).padStart(9, '0'), seq: head.seq + 1, at: env.now(), actor: a ? a.id : 'system', role: a ? a.role : '-', tenant: a ? a.tenant : '-', action, target: String(target), meta, prev: head.hash };
  rec.hash = sha256hex(rec.prev + '|' + JSON.stringify([rec.seq, rec.at, rec.actor, rec.tenant, rec.action, rec.target, rec.meta]));
  db.put('audit', rec); db.put('meta', { id: 'audit_head', seq: rec.seq, hash: rec.hash }); return rec;
}
export function verifyAudit(db) {
  let prev = 'GENESIS', n = 0; const rows = db.all('audit').sort((a, b) => a.seq - b.seq);
  for (const r of rows) { const h = sha256hex(prev + '|' + JSON.stringify([r.seq, r.at, r.actor, r.tenant, r.action, r.target, r.meta])); if (r.prev !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq, checked: n }; prev = r.hash; n++; }
  return { ok: true, checked: n, head: prev };
}

// ───────────────────────── xAPI ─────────────────────────
const VERBS = { experienced: 'http://adlnet.gov/expapi/verbs/experienced', completed: 'http://adlnet.gov/expapi/verbs/completed', passed: 'http://adlnet.gov/expapi/verbs/passed', failed: 'http://adlnet.gov/expapi/verbs/failed', attempted: 'http://adlnet.gov/expapi/verbs/attempted' };
export function xapi(ctx, user, verb, course, extra = {}) {
  const base = ctx.env.baseUrl || 'https://learn.africacdc.example';
  const st = { id: ctx.env.uid('x'), at: ctx.env.now(), tenant: user.tenant, statement: {
    actor: { objectType: 'Agent', account: { homePage: base, name: user.id } },
    verb: { id: VERBS[verb], display: { 'en-US': verb } },
    object: { objectType: 'Activity', id: `${base}/courses/${course.id}`, definition: { type: 'http://adlnet.gov/expapi/activities/course', name: course.title } },
    timestamp: new Date(ctx.env.now()).toISOString(), ...(extra.result ? { result: extra.result } : {}) } };
  ctx.db.put('xapi', st); return st;
}

// ───────────────────────── course resolution ─────────────────────────
export function getCourse(ctx, id) {
  const s = ctx.starter.modules[id]; if (s) return { ...s, source: 'starter', tenant: CONTINENTAL, status: 'published', visibility: 'core' };
  const c = ctx.db.get('courses', id); return c ? { ...c, source: 'authored' } : null;
}
const visibleTo = (c, u) => c.source === 'starter' || (c.status === 'published' && (c.tenant === u.tenant || c.visibility === 'continental' || (c.sharedWith || []).includes(u.tenant))) || u.role === 'super_admin';
export function allCourseIds(ctx) { return Object.keys(ctx.starter.modules); }

// strip answers: lessons + activity + job are fine to send; quiz becomes a count
function learnerView(c) { const { quiz, history, ...rest } = c; return { ...rest, quizCount: (quiz || []).length }; }

// ───────────────────────── enrolment / progress ─────────────────────────
const eid = (u, c) => `${u}:${c}`;
function ensureEnrol(ctx, user, course) {
  let e = ctx.db.get('enrol', eid(user.id, course.id));
  if (!e) { e = { id: eid(user.id, course.id), user: user.id, tenant: user.tenant, facility: user.facility || null, course: course.id, lessons: [], activity: false, status: 'in_progress', best: null, fails: 0, startedAt: ctx.env.now(), lastAt: ctx.env.now(), completedAt: null }; ctx.db.put('enrol', e); }
  return e;
}
const lessonsTotal = (c) => (c.lessons || []).length;
const lessonsDone = (e, c) => e.lessons.length >= lessonsTotal(c);

function awardCompletion(ctx, user, course, score) {
  const { db, env } = ctx; const out = { ceu: 0, certs: [] };
  const lid = `${user.id}:${course.id}`;
  if (!db.get('ceu', lid)) { const ceu = course.ceu || 0; db.put('ceu', { id: lid, user: user.id, tenant: user.tenant, ref: course.id, kind: course.source === 'starter' ? 'module' : 'course', title: course.title, ceu, at: env.now(), status: 'approved' }); out.ceu = ceu; }
  xapi(ctx, user, 'completed', course, { result: { completion: true, success: true, score: { scaled: score / 100 } } });
  if (course.source === 'starter') {
    const level = course.level, ids = ctx.starter.cur.modules.filter(m => m.level === level).map(m => m.id);
    if (ids.every(id => (db.get('enrol', eid(user.id, id)) || {}).status === 'completed')) { const c = issueCert(ctx, user, { scope: `level-${level}`, type: 'member_state', title: { en: `Digital Literacy — ${ctx.starter.cur.levels[level - 1].title.en}`, fr: `Littératie numérique — ${ctx.starter.cur.levels[level - 1].title.fr}` }, ceu: ids.reduce((a, id) => a + ctx.starter.modules[id].ceu, 0) }); if (c) out.certs.push(c.id); }
  } else { const c = issueCert(ctx, user, { scope: `course:${course.id}`, type: 'member_state', title: course.title, ceu: course.ceu || 0 }); if (c) out.certs.push(c.id); }
  return out;
}

// ───────────────────────── certificates ─────────────────────────
const CODE_ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const mkCode = (env) => { const h = env.randHex(12); let s = ''; for (let i = 0; i < 12; i++) s += CODE_ALPHA[parseInt(h.slice(i * 2, i * 2 + 2), 16) % 32]; return 'ACDC-' + [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12)].join('-'); };
const certPayload = (c) => [c.id, c.user, c.holder, c.type, c.scope, c.issuer, c.issuedAt, c.expiresAt].join('|');
export function issueCert(ctx, user, { scope, type, title, ceu }) {
  const { db, env } = ctx; const existing = db.all('certs').find(c => c.user === user.id && c.scope === scope && !c.revoked && c.expiresAt > env.now());
  if (existing) return null;
  const tenant = db.get('tenants', user.tenant); const issued = env.now();
  const c = { id: mkCode(env), user: user.id, tenant: user.tenant, holder: user.name, type, scope, title, ceu, issuer: type === 'accredited' ? 'Africa CDC' : (tenant ? tenant.name : user.tenant), issuedAt: issued, expiresAt: issued + 2 * 365 * DAY, revoked: false };
  c.sig = hmac(env.secret, certPayload(c)); db.put('certs', c); audit(ctx, 'cert.issue', c.id, { scope, type }, user); return c;
}
export function verifyCert(ctx, code) {
  const c = ctx.db.get('certs', String(code || '').toUpperCase().trim()); if (!c) return { status: 'unknown' };
  const sigOk = hmac(ctx.env.secret, certPayload(c)) === c.sig; const t = ctx.db.get('tenants', c.tenant);
  const status = !sigOk ? 'tampered' : c.revoked ? 'revoked' : c.expiresAt < ctx.env.now() ? 'expired' : 'valid';
  return { status, id: c.id, holder: maskName(c.holder), type: c.type, issuer: c.issuer, country: t ? t.name : '', title: c.title, scope: c.scope, ceu: c.ceu, issuedAt: c.issuedAt, expiresAt: c.expiresAt };
}

// ───────────────────────── quiz / exam ─────────────────────────
function present(items, seed) { return items.map(it => { const opts = [it.c, ...it.w], p = permFor(seed, it.id); return { id: it.id, q: it.q, options: p.map(i => opts[i]) }; }); }
function drawExam(ctx, seed) {
  const pool = ctx.starter.pool, rnd = mulberry32(seedNum(seed)), by = {};
  pool.forEach(q => (by[q.m] = by[q.m] || []).push(q));
  const picked = [], ids = Object.keys(by);
  ids.forEach(m => picked.push(shuffle(by[m], rnd)[0])); // one from every module → full coverage
  const rest = shuffle(pool.filter(q => !picked.includes(q)), rnd); while (picked.length < ctx.starter.cur.exam.questions) picked.push(rest.shift());
  return shuffle(picked, rnd);
}
function itemsOf(ctx, att) {
  if (att.kind === 'exam') { const byId = Object.fromEntries(ctx.starter.pool.map(q => [q.id, q])); return att.items.map(i => byId[i]); }
  const c = getCourse(ctx, att.course); return att.items.map(i => ({ ...c.quiz[i], id: `${c.id}.${i}` }));
}
function startAttempt(ctx, user, course, kind, offline = false) {
  const { db, env } = ctx; const key = eid(user.id, kind === 'exam' ? 'final' : course.id);
  const en = ctx.db.get('enrol', key) || (kind === 'exam' ? { id: key, user: user.id, tenant: user.tenant, facility: user.facility || null, course: 'final', lessons: [], status: 'in_progress', fails: 0, best: null, startedAt: env.now(), lastAt: env.now() } : ensureEnrol(ctx, user, course));
  if (en.status === 'completed') fail(409, 'already_passed');
  if (en.fails >= MAX_ATTEMPTS) fail(423, 'locked_contact_trainer', { fails: en.fails });
  // reuse an open attempt so refresh/offline package doesn't burn attempts
  const open = db.all('attempts').find(a => a.user === user.id && a.course === key.split(':')[1] && a.state === 'open' && a.kind === kind);
  let att = open;
  if (!att) {
    const seed = env.randHex(8); const items = kind === 'exam' ? drawExam(ctx, seed).map(q => q.id) : course.quiz.map((_, i) => i);
    att = { id: env.uid('t'), user: user.id, tenant: user.tenant, course: kind === 'exam' ? 'final' : course.id, kind, seed, items, state: 'open', startedAt: env.now() };
    db.put('attempts', att); db.put('enrol', en);
  }
  return att;
}
function gradeAttempt(ctx, user, att, answers) {
  const items = itemsOf(ctx, att); const res = []; let right = 0;
  items.forEach((it, i) => { const p = permFor(att.seed, it.id); const a = Number.isInteger(answers[i]) ? answers[i] : -1; const ok = a >= 0 && a < 3 && p[a] === 0; if (ok) right++; res.push({ id: it.id, correct: ok, correctIdx: p.indexOf(0), why: it.why }); });
  return { right, total: items.length, score: Math.round((right / items.length) * 1000) / 10, results: res };
}

// ───────────────────────── scoping ─────────────────────────
const inScope = (actor, u) => actor.role === 'super_admin' || (u.tenant === actor.tenant && (actor.role === 'ms_admin' || (actor.role === 'facility_admin' && u.facility === actor.facility) || actor.id === u.id));
const canManage = (actor, target) => {
  if (actor.role === 'super_admin') return true;
  if (target.tenant !== actor.tenant) return false;
  if (actor.role === 'ms_admin') return ['facility_admin', 'trainer', 'learner'].includes(target.role);
  if (actor.role === 'facility_admin') return ['trainer', 'learner'].includes(target.role) && target.facility === actor.facility;
  return false;
};
const creatableRoles = (actor) => ({ super_admin: ROLES, ms_admin: ['facility_admin', 'trainer', 'learner'], facility_admin: ['trainer', 'learner'] }[actor.role] || []);
const needRole = (ctx, ...roles) => { if (!ctx.user) fail(401, 'auth_required'); if (roles.length && !roles.includes(ctx.user.role)) fail(403, 'forbidden'); };

// ───────────────────────── analytics ─────────────────────────
const cnt = (o, k) => { o[k] = (o[k] || 0) + 1; };
export function analytics(ctx, tenantFilter) {
  const { db, env } = ctx, u = ctx.user, now = env.now();
  const tenants = db.all('tenants').filter(t => t.id !== CONTINENTAL && (u.role === 'super_admin' ? (!tenantFilter || t.id === tenantFilter) : t.id === u.tenant));
  const tset = new Set(tenants.map(t => t.id));
  const fac = db.all('facilities').filter(f => tset.has(f.tenant) && (u.role !== 'facility_admin' || f.id === u.facility));
  const users = db.all('users').filter(x => tset.has(x.tenant) && x.role === 'learner' && !x.disabled && (u.role !== 'facility_admin' || x.facility === u.facility));
  const uset = new Set(users.map(x => x.id)), enrol = db.all('enrol').filter(e => uset.has(e.user));
  const modEnrol = enrol.filter(e => e.course !== 'final');
  const certs = db.all('certs').filter(c => uset.has(c.user) && !c.revoked && c.type === 'accredited');
  const ceuRows = db.all('ceu').filter(c => uset.has(c.user) && c.status === 'approved');
  const byUserEn = {}; modEnrol.forEach(e => { (byUserEn[e.user] = byUserEn[e.user] || []).push(e); });
  const facById = Object.fromEntries(fac.map(f => [f.id, f]));
  const rows = tenants.map(t => {
    const tu = users.filter(x => x.tenant === t.id), tf = fac.filter(f => f.tenant === t.id);
    const enrolled = tu.filter(x => (byUserEn[x.id] || []).length).length;
    const active = tu.filter(x => (byUserEn[x.id] || []).some(e => now - e.lastAt < 30 * DAY)).length;
    const completedAny = tu.filter(x => (byUserEn[x.id] || []).some(e => e.status === 'completed')).length;
    const certified = certs.filter(c => c.tenant === t.id).length;
    const covered = new Set(tu.filter(x => x.facility && (byUserEn[x.id] || []).length).map(x => x.facility));
    const ceu = ceuRows.filter(c => c.tenant === t.id).reduce((a, c) => a + c.ceu, 0);
    const enrolRate = tu.length ? enrolled / tu.length : 0, util = enrolled ? active / enrolled : 0;
    return { id: t.id, name: t.name, status: t.status, pilot: !!t.pilot, users: tu.length, enrolled, enrolRate, active30: active, utilization: util, completedAny, certified, ceu: Math.round(ceu * 100) / 100, facilities: tf.length, facilitiesCovered: covered.size, coverage: tf.length ? covered.size / tf.length : 0, index: Math.round(((enrolRate + util) / 2) * 100) };
  });
  rows.sort((a, b) => b.index - a.index || b.enrolled - a.enrolled); rows.forEach((r, i) => { r.rank = i + 1; });
  const demo = { sex: {}, age: {}, facilityType: {}, profession: {} };
  users.forEach(x => { const f = facById[x.facility], started = (byUserEn[x.id] || []).length > 0, done = (byUserEn[x.id] || []).some(e => e.status === 'completed');
    for (const [k, v] of [['sex', x.sex || 'X'], ['age', x.ageBand || '?'], ['facilityType', f ? f.type : 'admin_office'], ['profession', x.profession || 'other']]) { const o = demo[k][v] = demo[k][v] || { n: 0, enrolled: 0, completed: 0 }; o.n++; if (started) o.enrolled++; if (done) o.completed++; } });
  // small-cell suppression (privacy: cells < 5 are not disclosed)
  for (const k in demo) for (const v in demo[k]) if (demo[k][v].n < 5) demo[k][v] = { n: '<5', enrolled: null, completed: null, suppressed: true };
  const regions = {}; fac.forEach(f => { const key = f.tenant + '|' + (f.region || '—'); const r = regions[key] = regions[key] || { tenant: f.tenant, region: f.region || '—', facilities: 0, covered: 0, lat: 0, lon: 0 }; r.facilities++; r.lat += f.lat || 0; r.lon += f.lon || 0; });
  const covF = new Set(users.filter(x => (byUserEn[x.id] || []).length && x.facility).map(x => x.facility)); fac.forEach(f => { if (covF.has(f.id)) regions[f.tenant + '|' + (f.region || '—')].covered++; });
  const modules = ctx.starter.cur.modules.map(m => ({ id: m.id, n: m.n, title: m.title, started: modEnrol.filter(e => e.course === m.id).length, completed: modEnrol.filter(e => e.course === m.id && e.status === 'completed').length }));
  const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const monthly = months.map(m => ({ m, enrolments: modEnrol.filter(e => new Date(e.startedAt).toISOString().slice(0, 7) === m).length, completions: modEnrol.filter(e => e.completedAt && new Date(e.completedAt).toISOString().slice(0, 7) === m).length }));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const facilities = tenants.length === 1 ? fac.map(f => { const fu = users.filter(x => x.facility === f.id); const en = fu.filter(x => (byUserEn[x.id] || []).length); return { id: f.id, name: f.name, type: f.type, region: f.region, lat: f.lat, lon: f.lon, learners: fu.length, enrolled: en.length, completed: fu.filter(x => (byUserEn[x.id] || []).some(e => e.status === 'completed')).length, covered: en.length > 0 }; }) : undefined;
  return { facilities, scope: u.role === 'super_admin' ? (tenantFilter || 'continental') : u.tenant, generatedAt: now, totals: { tenants: tenants.length, activeTenants: tenants.filter(t => t.status === 'live' || t.status === 'pilot').length, facilities: fac.length, learners: users.length, enrolled: sum('enrolled'), active30: sum('active30'), completedAny: sum('completedAny'), certified: certs.length, ceu: Math.round(ceuRows.reduce((a, c) => a + c.ceu, 0) * 10) / 10, completions: modEnrol.filter(e => e.status === 'completed').length }, tenants: rows, modules, monthly, demographics: demo, regions: Object.values(regions).map(r => ({ ...r, lat: r.facilities ? r.lat / r.facilities : 0, lon: r.facilities ? r.lon / r.facilities : 0 })) };
}

// ───────────────────────── authoring ─────────────────────────
export function validateCourse(c) {
  const e = []; const need = (o, p) => { if (!o || !String(o.en || '').trim()) e.push(p); };
  need(c.title, 'title'); if (!(c.lessons || []).length) e.push('lessons'); (c.lessons || []).forEach((l, i) => { need(l.title, `lessons[${i}].title`); need(l.body, `lessons[${i}].body`); });
  if ((c.quiz || []).length < 3) e.push('quiz (min 3 questions)');
  (c.quiz || []).forEach((q, i) => { need(q.q, `quiz[${i}].q`); need(q.c, `quiz[${i}].correct`); if (!q.w || q.w.length !== 2 || q.w.some(w => !String((w && w.en) || '').trim())) e.push(`quiz[${i}] needs exactly 2 wrong options`); });
  return e;
}
function sanitizeCourse(b) {
  const L = (x) => tl(x), tx = (x) => ({ en: clean(x && x.en, 6000), fr: clean(x && x.fr, 6000) });
  return { title: L(b.title), summary: L(b.summary), minutes: Math.min(600, Math.max(5, parseInt(b.minutes) || 30)), ceu: Math.min(10, Math.max(0, Math.round((parseFloat(b.ceu) || 0) * 100) / 100)), level: parseInt(b.level) || null,
    outcomes: (b.outcomes || []).slice(0, 8).map(L),
    lessons: (b.lessons || []).slice(0, 30).map(l => ({ title: L(l.title), body: tx(l.body), key: (l.key || []).slice(0, 6).map(L) })),
    quiz: (b.quiz || []).slice(0, 60).map(q => ({ q: L(q.q), c: L(q.c), w: (q.w || []).slice(0, 2).map(L), why: tx(q.why) })),
    job: b.job ? { title: L(b.job.title), steps: (b.job.steps || []).slice(0, 12).map(L) } : null };
}
const COURSE_STATES = ['draft', 'in_review', 'approved', 'published'];

// ───────────────────────── SCORM 1.2 export ─────────────────────────
export function buildScorm(course) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').split(/\n\n+/).map(p => /^- /.test(p) ? '<ul>' + p.split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('') + '</ul>' : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  const page = (lang) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(course.title[lang] || course.title.en)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 Arial,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#1a1a1a}h1,h2{color:#0F4D26}.q{border:1px solid #D6E4D9;border-radius:10px;padding:10px;margin:10px 0}button{background:#1B7A3D;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:700}#res{font-weight:700;margin-top:10px}</style></head><body>
<h1>${esc(course.title[lang] || course.title.en)}</h1>${course.lessons.map(l => `<h2>${esc(l.title[lang] || l.title.en)}</h2>${md(l.body[lang] || l.body.en)}`).join('')}
<h2>${lang === 'fr' ? 'Quiz' : 'Quiz'}</h2><form id="f">${course.quiz.map((q, i) => { const o = [q.c, ...q.w].map((x, j) => ({ t: x[lang] || x.en, ok: j === 0 })).sort((a, b) => (a.t > b.t ? 1 : -1)); return `<div class="q"><b>${i + 1}. ${esc(q.q[lang] || q.q.en)}</b>${o.map(x => `<label style="display:block"><input type="radio" name="q${i}" value="${x.ok ? 1 : 0}"> ${esc(x.t)}</label>`).join('')}</div>`; }).join('')}<button type="button" onclick="grade()">${lang === 'fr' ? 'Valider' : 'Submit'}</button><div id="res" role="status"></div></form>
<script>var api=null;function find(w){var n=0;while(w&&!w.API&&w.parent&&w.parent!==w&&n<10){w=w.parent;n++}return w&&w.API}api=find(window)||(window.opener&&find(window.opener));
if(api){api.LMSInitialize("");api.LMSSetValue("cmi.core.lesson_status","incomplete")}
function grade(){var n=${course.quiz.length},ok=0;for(var i=0;i<n;i++){var r=document.querySelector('input[name=q'+i+']:checked');if(r&&r.value==="1")ok++}var s=Math.round(ok/n*100);document.getElementById('res').textContent=s+'% — '+(s>=70?'${lang === 'fr' ? 'Réussi' : 'Passed'}':'${lang === 'fr' ? 'Non réussi' : 'Not passed'}');
if(api){api.LMSSetValue("cmi.core.score.raw",String(s));api.LMSSetValue("cmi.core.score.min","0");api.LMSSetValue("cmi.core.score.max","100");api.LMSSetValue("cmi.core.lesson_status",s>=70?"passed":"failed");api.LMSCommit("");api.LMSFinish("")}}</script></body></html>`;
  const id = 'ACDC_' + course.id.replace(/[^A-Za-z0-9]/g, '_');
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
<metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
<organizations default="ORG1"><organization identifier="ORG1"><title>${esc(course.title.en)}</title>
<item identifier="I_EN" identifierref="R_EN"><title>${esc(course.title.en)} (EN)</title></item>
<item identifier="I_FR" identifierref="R_FR"><title>${esc(course.title.fr || course.title.en)} (FR)</title></item></organization></organizations>
<resources><resource identifier="R_EN" type="webcontent" adlcp:scormtype="sco" href="en.html"><file href="en.html"/></resource>
<resource identifier="R_FR" type="webcontent" adlcp:scormtype="sco" href="fr.html"><file href="fr.html"/></resource></resources></manifest>`;
  return { 'imsmanifest.xml': manifest, 'en.html': page('en'), 'fr.html': page('fr'), 'course.json': JSON.stringify(course, null, 2) };
}

// ───────────────────────── router ─────────────────────────
const routes = [];
const R = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:([a-z]+)/g, '(?<$1>[^/]+)') + '$'), fn });
const ok = (body, status = 200) => ({ status, body });

export function handle(ctx, req) {
  try {
    const url = req.path.split('?')[0]; const q = req.query || {};
    for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(url); if (m) return r.fn(ctx, { ...req, params: m.groups || {}, query: q, body: req.body || {} }); }
    return { status: 404, body: { error: 'not_found' } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, ...(e.extra || {}) } };
    console.error(e); return { status: 500, body: { error: 'server_error' } };
  }
}

// ---- public ----
R('GET', '/api/health', (c) => ok({ ok: true, name: 'Africa CDC Digital Literacy Platform', version: c.env.version || '1.0.0', mode: c.env.mode || 'server' }));
R('GET', '/api/curriculum', (c) => ok(c.starter.cur));
R('GET', '/api/verify/:code', (c, r) => ok(verifyCert(c, r.params.code)));

// ---- me ----
function summary(ctx, u) {
  const { db, starter, env } = ctx; const en = db.all('enrol').filter(e => e.user === u.id), by = Object.fromEntries(en.map(e => [e.course, e]));
  const modules = starter.cur.modules.map(m => { const e = by[m.id]; return { id: m.id, n: m.n, level: m.level, ceu: m.ceu, status: e ? e.status : 'new', lessons: e ? e.lessons.length : 0, best: e ? e.best : null, fails: e ? e.fails : 0, locked: !!(e && e.fails >= MAX_ATTEMPTS) }; });
  const done = modules.filter(m => m.status === 'completed').length, ex = by.final;
  const ceu = db.all('ceu').filter(x => x.user === u.id && x.status === 'approved'), total = Math.round(ceu.reduce((a, x) => a + x.ceu, 0) * 100) / 100;
  const window = env.now() - 2 * 365 * DAY, recent = Math.round(ceu.filter(x => x.at >= window).reduce((a, x) => a + x.ceu, 0) * 100) / 100;
  return { modules, completed: done, examStatus: ex ? ex.status : 'new', examFails: ex ? ex.fails : 0, examLocked: !!(ex && ex.fails >= MAX_ATTEMPTS), examEligible: done === modules.length, ceuTotal: total, ceuRecent: recent, renewalTarget: starter.cur.policy.renewalCeu, certs: db.all('certs').filter(x => x.user === u.id).map(x => ({ id: x.id, type: x.type, scope: x.scope, title: x.title, issuedAt: x.issuedAt, expiresAt: x.expiresAt, revoked: x.revoked })) };
}
R('GET', '/api/me', (c) => { needRole(c); const t = c.db.get('tenants', c.user.tenant), f = c.user.facility ? c.db.get('facilities', c.user.facility) : null; return ok({ user: pubUser(c.user), tenant: t, facility: f, summary: summary(c, c.user) }); });
R('PATCH', '/api/me', (c, r) => { needRole(c); const u = { ...c.user }; if (['en', 'fr', 'pt', 'ar'].includes(r.body.lang)) u.lang = r.body.lang; if (r.body.name) u.name = clean(r.body.name, 80) || u.name; c.db.put('users', u); return ok({ user: pubUser(u) }); });

// ---- catalog & content ----
R('GET', '/api/courses', (c) => {
  needRole(c); const en = Object.fromEntries(c.db.all('enrol').filter(e => e.user === c.user.id).map(e => [e.course, e]));
  const starter = c.starter.cur.modules.map(m => ({ ...m, source: 'starter', status: en[m.id] ? en[m.id].status : 'new' }));
  const lib = c.db.all('courses').filter(x => x.status === 'published' && visibleTo({ ...x, source: 'authored' }, c.user)).map(x => ({ id: x.id, title: x.title, summary: x.summary, minutes: x.minutes, ceu: x.ceu, level: x.level, source: 'authored', visibility: x.visibility, tenant: x.tenant, owner: c.db.get('tenants', x.tenant)?.name, status: en[x.id] ? en[x.id].status : 'new' }));
  return ok({ starter, library: lib });
});
R('GET', '/api/courses/:id', (c, r) => { needRole(c); const k = getCourse(c, r.params.id); if (!k || !visibleTo(k, c.user)) fail(404, 'not_found'); const e = c.db.get('enrol', eid(c.user.id, k.id)); return ok({ course: learnerView(k), enrol: e || null }); });
R('POST', '/api/progress', (c, r) => {
  needRole(c); const k = getCourse(c, r.body.course); if (!k || !visibleTo(k, c.user)) fail(404, 'not_found'); const e = ensureEnrol(c, c.user, k);
  if (Number.isInteger(r.body.lesson) && r.body.lesson >= 0 && r.body.lesson < lessonsTotal(k) && !e.lessons.includes(r.body.lesson)) { e.lessons.push(r.body.lesson); xapi(c, c.user, 'experienced', k); }
  if (r.body.activity === true) e.activity = true; e.lastAt = c.env.now(); c.db.put('enrol', e); return ok({ enrol: e });
});

// ---- quizzes & exam ----
R('POST', '/api/quiz/start', (c, r) => {
  needRole(c); const k = getCourse(c, r.body.course); if (!k || !visibleTo(k, c.user)) fail(404, 'not_found'); const e = ensureEnrol(c, c.user, k);
  if (!lessonsDone(e, k)) fail(409, 'finish_lessons_first'); const att = startAttempt(c, c.user, k, 'module');
  return ok({ attemptId: att.id, kind: 'module', passMark: PASS_MARK, questions: present(itemsOf(c, att), att.seed) });
});
R('GET', '/api/exam/start', (c) => {
  needRole(c); const s = summary(c, c.user); if (!s.examEligible) fail(409, 'complete_all_modules_first'); const att = startAttempt(c, c.user, null, 'exam'); const ex = c.starter.cur.exam;
  return ok({ attemptId: att.id, kind: 'exam', passMark: ex.passMark, minutes: ex.minutes, startedAt: att.startedAt, questions: present(itemsOf(c, att), att.seed) });
});
export function submitAttempt(c, user, attemptId, answers) {
  const att = c.db.get('attempts', attemptId); if (!att || att.user !== user.id) fail(404, 'attempt_not_found'); if (att.state !== 'open') fail(409, 'attempt_closed');
  const key = eid(user.id, att.course), en = c.db.get('enrol', key), cur = c.starter.cur;
  if (att.kind === 'exam' && c.env.now() - att.startedAt > (cur.exam.minutes + 5) * 60000) { att.state = 'expired'; c.db.put('attempts', att); fail(410, 'attempt_expired'); }
  const g = gradeAttempt(c, user, att, Array.isArray(answers) ? answers : []); const passed = g.score >= (att.kind === 'exam' ? cur.exam.passMark : PASS_MARK);
  att.state = 'graded'; att.score = g.score; att.passed = passed; att.answers = answers; att.submittedAt = c.env.now(); c.db.put('attempts', att);
  en.best = Math.max(en.best || 0, g.score); en.lastAt = c.env.now(); let award = { ceu: 0, certs: [] };
  if (passed) { en.status = 'completed'; en.completedAt = c.env.now(); } else en.fails += 1;
  c.db.put('enrol', en);
  const crs = att.kind === 'exam' ? { id: 'final', title: cur.exam.title, ceu: cur.exam.ceu, source: 'starter' } : getCourse(c, att.course);
  if (passed) {
    if (att.kind === 'exam') {
      const lid = `${user.id}:final`; if (!c.db.get('ceu', lid)) { c.db.put('ceu', { id: lid, user: user.id, tenant: user.tenant, ref: 'final', kind: 'exam', title: cur.exam.title, ceu: cur.exam.ceu, at: c.env.now(), status: 'approved' }); award.ceu = cur.exam.ceu; }
      xapi(c, user, 'passed', crs, { result: { success: true, completion: true, score: { scaled: g.score / 100 } } });
      const cert = issueCert(c, user, { scope: 'full', type: 'accredited', title: { en: 'Africa CDC Digital Literacy Certification — Primary Health Care', fr: 'Certification Africa CDC en littératie numérique — Soins de santé primaires' }, ceu: 30 }); if (cert) award.certs.push(cert.id);
    } else award = awardCompletion(c, user, crs, g.score);
  } else { xapi(c, user, 'failed', crs, { result: { success: false, completion: true, score: { scaled: g.score / 100 } } }); }
  return { score: g.score, right: g.right, total: g.total, passed, passMark: att.kind === 'exam' ? cur.exam.passMark : PASS_MARK, results: g.results, ceuAwarded: award.ceu, certificates: award.certs, failsLeft: passed ? null : Math.max(0, MAX_ATTEMPTS - en.fails), locked: !passed && en.fails >= MAX_ATTEMPTS };
}
R('POST', '/api/quiz/submit', (c, r) => { needRole(c); return ok(submitAttempt(c, c.user, r.body.attemptId, r.body.answers)); });

// ---- offline package & sync ----
R('POST', '/api/offline/package', (c, r) => {
  needRole(c); const ids = (Array.isArray(r.body.courses) ? r.body.courses : []).slice(0, 25); const pk = [];
  for (const id of ids) { const k = getCourse(c, id); if (!k || !visibleTo(k, c.user)) continue; const e = ensureEnrol(c, c.user, k); let att = null; if (e.status !== 'completed' && !(e.fails >= MAX_ATTEMPTS)) { att = startAttempt(c, c.user, k, 'module'); } pk.push({ course: learnerView(k), attempt: att ? { attemptId: att.id, questions: present(itemsOf(c, att), att.seed) } : null }); }
  return ok({ generatedAt: c.env.now(), packages: pk });
});
R('POST', '/api/sync', (c, r) => {
  needRole(c); const evs = (Array.isArray(r.body.events) ? r.body.events : []).slice(0, 200); const out = [];
  for (const ev of evs) {
    const id = clean(ev.id, 60); if (!id) continue; const seen = c.db.get('sync', c.user.id + ':' + id); if (seen) { out.push({ id, status: 'duplicate', result: seen.result }); continue; }
    let result, status = 'ok';
    try {
      if (ev.type === 'progress') { const res = handle(c, { method: 'POST', path: '/api/progress', body: ev.payload }); result = res.body; if (res.status >= 400) status = 'error'; }
      else if (ev.type === 'quiz_submit') { result = submitAttempt(c, c.user, ev.payload.attemptId, ev.payload.answers); }
      else { status = 'error'; result = { error: 'unknown_type' }; }
    } catch (e) { status = 'error'; result = { error: e instanceof HttpError ? e.message : 'server_error' }; }
    c.db.put('sync', { id: c.user.id + ':' + id, at: c.env.now(), result }); out.push({ id, status, result });
  }
  return ok({ results: out });
});

// ---- CEU ledger & certificates ----
R('GET', '/api/me/ceu', (c) => {
  needRole(c); const rows = c.db.all('ceu').filter(x => x.user === c.user.id).sort((a, b) => b.at - a.at); const s = summary(c, c.user);
  return ok({ entries: rows, total: s.ceuTotal, recent24m: s.ceuRecent, renewalTarget: s.renewalTarget, certValidityYears: 2 });
});
R('POST', '/api/me/ceu', (c, r) => {
  needRole(c); const ceu = Math.round(parseFloat(r.body.ceu) * 100) / 100; if (!(ceu > 0 && ceu <= 10)) fail(400, 'invalid_ceu'); const title = clean(r.body.title, 160); if (!title) fail(400, 'title_required');
  const row = { id: c.env.uid('e'), user: c.user.id, tenant: c.user.tenant, ref: 'external', kind: 'external', title: { en: title, fr: title }, ceu, evidence: clean(r.body.evidence, 300), at: c.env.now(), status: 'pending' }; c.db.put('ceu', row); audit(c, 'ceu.claim', row.id, { ceu }); return ok({ entry: row }, 201);
});
R('POST', '/api/admin/ceu/:id/decision', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const e = c.db.get('ceu', r.params.id); if (!e || e.kind !== 'external') fail(404, 'not_found'); const target = c.db.get('users', e.user); if (!target || !inScope(c.user, target) || c.user.id === e.user) fail(403, 'forbidden');
  e.status = r.body.approve ? 'approved' : 'rejected'; e.decidedBy = c.user.id; c.db.put('ceu', e); audit(c, 'ceu.decision', e.id, { status: e.status }); return ok({ entry: e });
});
R('GET', '/api/admin/ceu/pending', (c) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const us = Object.fromEntries(c.db.all('users').map(u => [u.id, u])); return ok({ items: c.db.all('ceu').filter(e => e.status === 'pending' && us[e.user] && inScope(c.user, us[e.user])).map(e => ({ ...e, holder: us[e.user].name })) }); });
R('GET', '/api/me/certificates', (c) => { needRole(c); return ok({ certificates: c.db.all('certs').filter(x => x.user === c.user.id) }); });
R('GET', '/api/certificates/:code', (c, r) => { needRole(c); const x = c.db.get('certs', r.params.code); if (!x) fail(404, 'not_found'); const holder = c.db.get('users', x.user); if (x.user !== c.user.id && !(holder && inScope(c.user, holder))) fail(403, 'forbidden'); return ok({ certificate: x, verification: verifyCert(c, x.id) }); });
R('POST', '/api/admin/certificates/:code/revoke', (c, r) => { needRole(c, 'super_admin', 'ms_admin'); const x = c.db.get('certs', r.params.code); if (!x) fail(404, 'not_found'); if (c.user.role !== 'super_admin' && (x.tenant !== c.user.tenant || x.type === 'accredited')) fail(403, 'forbidden'); x.revoked = true; x.revokedReason = clean(r.body.reason, 200); c.db.put('certs', x); audit(c, 'cert.revoke', x.id, { reason: x.revokedReason }); return ok({ certificate: x }); });

// ---- tenants, facilities, users, cohorts ----
R('GET', '/api/admin/tenants', (c) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); return ok({ tenants: c.db.all('tenants').filter(t => c.user.role === 'super_admin' || t.id === c.user.tenant) }); });
R('POST', '/api/admin/tenants', (c, r) => {
  needRole(c, 'super_admin'); const id = clean(r.body.id, 8).toUpperCase().replace(/[^A-Z0-9]/g, ''), name = clean(r.body.name, 80); if (!id || !name) fail(400, 'id_and_name_required'); if (c.db.get('tenants', id)) fail(409, 'tenant_exists');
  const t = { id, name, status: 'provisioned', pilot: !!r.body.pilot, languages: ['en', 'fr'], createdAt: c.env.now() }; c.db.put('tenants', t); audit(c, 'tenant.create', id, { name });
  let admin = null; if (r.body.admin && isEmail(clean(r.body.admin.email, 200))) { admin = createUser(c, { tenant: id, role: 'ms_admin', name: clean(r.body.admin.name, 80) || 'Administrator', email: clean(r.body.admin.email, 200).toLowerCase() }); }
  return ok({ tenant: t, admin: admin && { user: pubUser(admin.user), tempPassword: admin.tempPassword } }, 201);
});
R('PATCH', '/api/admin/tenants/:id', (c, r) => { needRole(c, 'super_admin'); const t = c.db.get('tenants', r.params.id); if (!t) fail(404, 'not_found'); if (['provisioned', 'pilot', 'live', 'suspended'].includes(r.body.status)) t.status = r.body.status; if (typeof r.body.pilot === 'boolean') t.pilot = r.body.pilot; c.db.put('tenants', t); audit(c, 'tenant.update', t.id, { status: t.status }); return ok({ tenant: t }); });
R('GET', '/api/admin/facilities', (c, r) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin', 'trainer'); const t = c.user.role === 'super_admin' ? r.query.tenant : c.user.tenant; return ok({ facilities: c.db.all('facilities').filter(f => (!t || f.tenant === t) && (c.user.role !== 'facility_admin' || f.id === c.user.facility)) }); });
R('POST', '/api/admin/facilities', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin'); const tenant = c.user.role === 'super_admin' ? clean(r.body.tenant, 8) : c.user.tenant; if (!c.db.get('tenants', tenant)) fail(400, 'invalid_tenant'); const type = FACILITY_TYPES.includes(r.body.type) ? r.body.type : 'health_centre'; const name = clean(r.body.name, 100); if (!name) fail(400, 'name_required');
  const f = { id: c.env.uid('f'), tenant, name, type, region: clean(r.body.region, 80), lat: Number.isFinite(+r.body.lat) ? +r.body.lat : null, lon: Number.isFinite(+r.body.lon) ? +r.body.lon : null, createdAt: c.env.now() }; c.db.put('facilities', f); audit(c, 'facility.create', f.id, { tenant }); return ok({ facility: f }, 201);
});
export function createUser(c, b) {
  const email = clean(b.email, 200).toLowerCase(); if (!isEmail(email)) fail(400, 'invalid_email'); if (c.db.all('users').some(u => u.email === email)) fail(409, 'email_exists');
  const tenant = c.db.get('tenants', b.tenant); if (!tenant) fail(400, 'invalid_tenant'); if (!ROLES.includes(b.role)) fail(400, 'invalid_role');
  if (b.facility) { const f = c.db.get('facilities', b.facility); if (!f || f.tenant !== b.tenant) fail(400, 'invalid_facility'); }
  const temp = b.password || c.env.newPassword(); const u = { id: c.env.uid('u'), tenant: b.tenant, facility: b.facility || null, role: b.role, name: clean(b.name, 80) || email.split('@')[0], email, phone: clean(b.phone, 30), sex: SEXES.includes(b.sex) ? b.sex : 'X', ageBand: AGE_BANDS.includes(b.ageBand) ? b.ageBand : null, profession: PROFESSIONS.includes(b.profession) ? b.profession : 'other', lang: ['en', 'fr'].includes(b.lang) ? b.lang : 'en', pw: c.env.hashPassword(temp), mustChange: !b.password, createdAt: c.env.now(), disabled: false };
  c.db.put('users', u); return { user: u, tempPassword: b.password ? undefined : temp };
}
R('GET', '/api/admin/users', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'facility_admin', 'trainer'); const q = clean(r.query.q, 60).toLowerCase(), tenant = c.user.role === 'super_admin' ? r.query.tenant : c.user.tenant;
  let list = c.db.all('users').filter(u => (!tenant || u.tenant === tenant) && (c.user.role !== 'facility_admin' || u.facility === c.user.facility) && (!r.query.role || u.role === r.query.role) && (!r.query.facility || u.facility === r.query.facility) && (!q || u.name.toLowerCase().includes(q) || u.email.includes(q)));
  if (c.user.role === 'trainer') { const mine = new Set(c.db.all('cohorts').filter(h => h.trainer === c.user.id).flatMap(h => h.members)); list = list.filter(u => mine.has(u.id)); }
  const total = list.length, off = Math.max(0, parseInt(r.query.offset) || 0), lim = Math.min(200, parseInt(r.query.limit) || 50); const en = c.db.all('enrol');
  const prog = {}; en.forEach(e => { if (e.course !== 'final') { const p = prog[e.user] = prog[e.user] || { started: 0, completed: 0 }; p.started++; if (e.status === 'completed') p.completed++; } });
  return ok({ total, users: list.sort((a, b) => a.name.localeCompare(b.name)).slice(off, off + lim).map(u => ({ ...pubUser(u), progress: prog[u.id] || { started: 0, completed: 0 } })) });
});
R('POST', '/api/admin/users', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const role = r.body.role || 'learner'; if (!creatableRoles(c.user).includes(role)) fail(403, 'role_not_allowed');
  const tenant = c.user.role === 'super_admin' ? r.body.tenant : c.user.tenant; const facility = c.user.role === 'facility_admin' ? c.user.facility : r.body.facility;
  const res = createUser(c, { ...r.body, tenant, facility, role, password: undefined }); audit(c, 'user.create', res.user.id, { role, tenant }); return ok({ user: pubUser(res.user), tempPassword: res.tempPassword }, 201);
});
R('POST', '/api/admin/users/import', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const rows = (Array.isArray(r.body.rows) ? r.body.rows : []).slice(0, 500); const created = [], errors = [];
  const tenant = c.user.role === 'super_admin' ? r.body.tenant : c.user.tenant; const facs = Object.fromEntries(c.db.all('facilities').filter(f => f.tenant === tenant).map(f => [f.name.toLowerCase(), f.id]));
  rows.forEach((row, i) => { try { const role = creatableRoles(c.user).includes(row.role) ? row.role : 'learner'; const facility = c.user.role === 'facility_admin' ? c.user.facility : (facs[String(row.facility || '').toLowerCase()] || null); const x = createUser(c, { ...row, tenant, facility, role, password: undefined }); created.push({ email: x.user.email, name: x.user.name, tempPassword: x.tempPassword }); } catch (e) { errors.push({ row: i + 1, error: e instanceof HttpError ? e.message : 'error' }); } });
  audit(c, 'user.import', tenant, { created: created.length, errors: errors.length }); return ok({ created, errors });
});
R('PATCH', '/api/admin/users/:id', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const u = c.db.get('users', r.params.id); if (!u || !canManage(c.user, u)) fail(403, 'forbidden'); const before = { role: u.role, disabled: u.disabled, facility: u.facility };
  if (r.body.role && r.body.role !== u.role) { if (!creatableRoles(c.user).includes(r.body.role)) fail(403, 'role_not_allowed'); u.role = r.body.role; }
  if (typeof r.body.disabled === 'boolean') { if (u.id === c.user.id) fail(400, 'cannot_disable_self'); u.disabled = r.body.disabled; }
  if (r.body.facility !== undefined) { if (r.body.facility) { const f = c.db.get('facilities', r.body.facility); if (!f || f.tenant !== u.tenant) fail(400, 'invalid_facility'); } u.facility = r.body.facility || null; }
  for (const k of ['sex', 'ageBand', 'profession']) if (r.body[k] !== undefined) u[k] = r.body[k]; if (r.body.name) u.name = clean(r.body.name, 80);
  c.db.put('users', u); audit(c, 'user.update', u.id, { before, after: { role: u.role, disabled: u.disabled, facility: u.facility } }); return ok({ user: pubUser(u) });
});
R('GET', '/api/admin/cohorts', (c) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin', 'trainer'); return ok({ cohorts: c.db.all('cohorts').filter(h => (c.user.role === 'super_admin' || h.tenant === c.user.tenant) && (c.user.role !== 'trainer' || h.trainer === c.user.id) && (c.user.role !== 'facility_admin' || h.facility === c.user.facility)) }); });
R('POST', '/api/admin/cohorts', (c, r) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const tenant = c.user.role === 'super_admin' ? r.body.tenant : c.user.tenant; const name = clean(r.body.name, 80); if (!name || !c.db.get('tenants', tenant)) fail(400, 'invalid'); const h = { id: c.env.uid('h'), tenant, facility: c.user.role === 'facility_admin' ? c.user.facility : (r.body.facility || null), name, trainer: r.body.trainer || null, members: [], createdAt: c.env.now() }; c.db.put('cohorts', h); audit(c, 'cohort.create', h.id); return ok({ cohort: h }, 201); });
R('POST', '/api/admin/cohorts/:id/members', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); const h = c.db.get('cohorts', r.params.id); if (!h || (c.user.role !== 'super_admin' && h.tenant !== c.user.tenant)) fail(404, 'not_found'); const add = (Array.isArray(r.body.users) ? r.body.users : []).filter(id => { const u = c.db.get('users', id); return u && u.tenant === h.tenant && inScope(c.user, u); });
  h.members = [...new Set([...h.members, ...add])]; c.db.put('cohorts', h); if (r.body.course) { const k = getCourse(c, r.body.course); if (k && visibleTo(k, { tenant: h.tenant, role: 'learner' })) h.members.forEach(id => { const u = c.db.get('users', id); if (u) ensureEnrol(c, u, k); }); } audit(c, 'cohort.members', h.id, { added: add.length }); return ok({ cohort: h });
});
R('POST', '/api/admin/unlock', (c, r) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin', 'trainer'); const u = c.db.get('users', r.body.user); if (!u || (c.user.role === 'trainer' ? !c.db.all('cohorts').some(h => h.trainer === c.user.id && h.members.includes(u.id)) : !inScope(c.user, u))) fail(403, 'forbidden'); const e = c.db.get('enrol', eid(u.id, r.body.course)); if (!e) fail(404, 'not_found'); e.fails = 0; c.db.put('enrol', e); audit(c, 'attempts.unlock', e.id, { by: c.user.id }); return ok({ enrol: e }); });

// ---- analytics, audit, exports, xAPI ----
R('GET', '/api/admin/analytics', (c, r) => { needRole(c, 'super_admin', 'ms_admin', 'facility_admin'); return ok(analytics(c, c.user.role === 'super_admin' ? clean(r.query.tenant, 8) || null : null)); });
R('GET', '/api/admin/audit', (c, r) => { needRole(c, 'super_admin', 'ms_admin'); let rows = c.db.all('audit'); if (c.user.role !== 'super_admin') rows = rows.filter(a => a.tenant === c.user.tenant); rows.sort((a, b) => b.seq - a.seq); const lim = Math.min(500, parseInt(r.query.limit) || 100); return ok({ total: rows.length, rows: rows.slice(0, lim) }); });
R('GET', '/api/admin/audit/verify', (c) => { needRole(c, 'super_admin'); return ok(verifyAudit(c.db)); });
R('GET', '/api/admin/export', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin'); const tenant = c.user.role === 'super_admin' ? (r.query.tenant || null) : c.user.tenant; const keep = (x) => !tenant || x.tenant === tenant; const users = c.db.all('users').filter(keep);
  const data = { format: 'africacdc-dlp-export/1', exportedAt: c.env.now(), scope: tenant || 'all', tenants: c.db.all('tenants').filter(t => !tenant || t.id === tenant), facilities: c.db.all('facilities').filter(keep), users: users.map(pubUser), cohorts: c.db.all('cohorts').filter(keep), enrolments: c.db.all('enrol').filter(keep), ceuLedger: c.db.all('ceu').filter(keep), certificates: c.db.all('certs').filter(keep), courses: c.db.all('courses').filter(keep), attempts: c.db.all('attempts').filter(keep).map(({ answers, seed, ...a }) => a), xapi: c.db.all('xapi').filter(keep).map(x => x.statement) };
  audit(c, 'export', data.scope, { users: users.length }); return ok(data);
});
const toCsv = (rows) => { if (!rows.length) return ''; const cols = [...new Set(rows.flatMap(Object.keys))]; const q = (v) => { v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return [cols.join(','), ...rows.map(r => cols.map(k => q(r[k])).join(','))].join('\n'); };
R('GET', '/api/admin/export.csv', (c, r) => { const res = handle(c, { method: 'GET', path: '/api/admin/export', query: { tenant: r.query.tenant } }); if (res.status !== 200) return res; const key = { users: 'users', ceu: 'ceuLedger', enrolments: 'enrolments', certificates: 'certificates' }[r.query.collection] || 'users'; return { status: 200, body: { kind: 'text', filename: `${key}.csv`, contentType: 'text/csv; charset=utf-8', text: toCsv(res.body[key]) } }; });
R('POST', '/api/xapi/statements', (c, r) => {
  needRole(c); const arr = Array.isArray(r.body) ? r.body : r.body && r.body.statements ? r.body.statements : [r.body]; const ids = [];
  for (const s of arr.slice(0, 50)) { if (!s || !s.actor || !s.verb || !s.verb.id || !s.object || !s.object.id) fail(400, 'invalid_statement'); const rec = { id: c.env.uid('x'), at: c.env.now(), tenant: c.user.tenant, statement: { ...s, id: s.id || c.env.uid('s'), timestamp: s.timestamp || new Date(c.env.now()).toISOString() }, external: true }; c.db.put('xapi', rec); ids.push(rec.statement.id); }
  return ok(ids, 200);
});
R('GET', '/api/xapi/statements', (c, r) => { needRole(c, 'super_admin', 'ms_admin'); const rows = c.db.all('xapi').filter(x => c.user.role === 'super_admin' || x.tenant === c.user.tenant).sort((a, b) => b.at - a.at); const lim = Math.min(500, parseInt(r.query.limit) || 50); return ok({ statements: rows.slice(0, lim).map(x => x.statement), more: rows.length > lim }); });

// ---- authoring & federation ----
const myTenantCourses = (c) => c.db.all('courses').filter(x => c.user.role === 'super_admin' || x.tenant === c.user.tenant);
const histo = (c, x, action, extra = {}) => { x.history = [...(x.history || []), { at: c.env.now(), by: c.user.id, byName: c.user.name, action, ...extra }]; };
R('GET', '/api/authoring/courses', (c, r) => { needRole(c, 'super_admin', 'ms_admin', 'trainer'); let list = myTenantCourses(c); if (c.user.role === 'trainer') list = list.filter(x => x.owner === c.user.id || x.status === 'published'); const tn = Object.fromEntries(c.db.all('tenants').map(t => [t.id, t.name])); return ok({ courses: list.map(({ lessons, quiz, ...m }) => ({ ...m, tenantName: tn[m.tenant], lessons: lessons.length, quiz: quiz.length })), tenants: c.db.all('tenants').filter(t => t.id !== CONTINENTAL && t.id !== c.user.tenant).map(t => ({ id: t.id, name: t.name })) }); });
R('POST', '/api/authoring/courses', (c, r) => {
  needRole(c, 'ms_admin', 'trainer'); let base = {}; if (r.body.from) { const s = getCourse(c, r.body.from); if (!s || !visibleTo(s, c.user)) fail(404, 'source_not_found'); const { id, source, tenant, status, visibility, n, level, ...rest } = s; base = JSON.parse(JSON.stringify(rest)); base.title = { en: base.title.en + ' (adapted)', fr: base.title.fr + ' (adapté)' }; base.ceu = 0; }
  else base = { title: tl(r.body.title), summary: tl(r.body.summary), minutes: 30, ceu: 0, lessons: [{ title: { en: '', fr: '' }, body: { en: '', fr: '' }, key: [] }], quiz: [], outcomes: [], job: null };
  const co = { ...sanitizeCourse(base), id: 'c' + c.env.randHex(5), tenant: c.user.tenant, owner: c.user.id, ownerName: c.user.name, status: 'draft', visibility: 'private', sharedWith: [], version: 1, createdAt: c.env.now(), updatedAt: c.env.now(), history: [] }; if (!co.title.en) co.title.en = 'Untitled course'; histo(c, co, 'create', { from: r.body.from || null }); c.db.put('courses', co); audit(c, 'course.create', co.id); return ok({ course: co }, 201);
});
R('GET', '/api/authoring/courses/:id', (c, r) => { needRole(c, 'super_admin', 'ms_admin', 'trainer'); const x = c.db.get('courses', r.params.id); if (!x || !(c.user.role === 'super_admin' || x.tenant === c.user.tenant)) fail(404, 'not_found'); return ok({ course: x, problems: validateCourse(x) }); });
R('PUT', '/api/authoring/courses/:id', (c, r) => {
  needRole(c, 'ms_admin', 'trainer'); const x = c.db.get('courses', r.params.id); if (!x || x.tenant !== c.user.tenant) fail(404, 'not_found'); if (c.user.role === 'trainer' && x.owner !== c.user.id) fail(403, 'forbidden'); if (x.status !== 'draft') fail(409, 'only_drafts_are_editable');
  const upd = { ...x, ...sanitizeCourse({ ...x, ...r.body }), updatedAt: c.env.now() }; c.db.put('courses', upd); return ok({ course: upd, problems: validateCourse(upd) });
});
R('POST', '/api/authoring/courses/:id/:action', (c, r) => {
  needRole(c, 'super_admin', 'ms_admin', 'trainer'); const x = c.db.get('courses', r.params.id); if (!x) fail(404, 'not_found'); const a = r.params.action, u = c.user, own = x.tenant === u.tenant; const admin = u.role === 'ms_admin' && own, supa = u.role === 'super_admin';
  const to = (st) => { x.status = st; x.updatedAt = c.env.now(); c.db.put('courses', x); audit(c, 'course.' + a, x.id, { status: st, visibility: x.visibility }); return ok({ course: x }); };
  switch (a) {
    case 'submit_review': { if (!own || !['draft'].includes(x.status) || (u.role === 'trainer' && x.owner !== u.id)) fail(409, 'invalid_transition'); const p = validateCourse(x); if (p.length) fail(422, 'validation_failed', { problems: p }); histo(c, x, 'submit_review'); return to('in_review'); }
    case 'review': { if (!admin || x.status !== 'in_review') fail(409, 'invalid_transition'); if (x.owner === u.id) fail(403, 'four_eyes_reviewer_must_differ_from_author'); const checks = r.body.checks || {}, all = ['competency', 'accuracy', 'accessibility', 'branding'].every(k => checks[k] === true);
      if (r.body.decision === 'approve') { if (!all) fail(422, 'all_review_checks_required'); x.ceu = Math.min(10, Math.max(0, Math.round((parseFloat(r.body.ceu ?? x.ceu) || 0) * 100) / 100)); histo(c, x, 'approve', { checks, notes: clean(r.body.notes, 500), ceu: x.ceu }); return to('approved'); }
      histo(c, x, 'reject', { checks, notes: clean(r.body.notes, 500) }); return to('draft'); }
    case 'publish': { if (!admin || x.status !== 'approved') fail(409, 'invalid_transition'); x.publishedAt = c.env.now(); x.visibility = 'private'; histo(c, x, 'publish', { version: x.version }); return to('published'); }
    case 'unpublish': { if (!admin || x.status !== 'published') fail(409, 'invalid_transition'); x.visibility = 'private'; x.sharedWith = []; x.continental = null; histo(c, x, 'unpublish'); return to('draft'); }
    case 'share': { if (!admin || x.status !== 'published') fail(409, 'invalid_transition'); const ids = (Array.isArray(r.body.tenants) ? r.body.tenants : []).filter(t => t !== x.tenant && c.db.get('tenants', t)); x.sharedWith = ids; if (x.visibility !== 'continental') x.visibility = ids.length ? 'shared' : 'private'; histo(c, x, 'share', { with: ids }); return to('published'); }
    case 'submit_continental': { if (!admin || x.status !== 'published' || x.continental === 'submitted' || x.visibility === 'continental') fail(409, 'invalid_transition'); x.continental = 'submitted'; histo(c, x, 'submit_continental'); return to('published'); }
    case 'continental_review': { if (!supa || x.continental !== 'submitted') fail(409, 'invalid_transition'); const checks = r.body.checks || {}, all = ['competency', 'accuracy', 'accessibility', 'branding'].every(k => checks[k] === true);
      if (r.body.decision === 'promote') { if (!all) fail(422, 'all_review_checks_required'); x.visibility = 'continental'; x.continental = 'promoted'; histo(c, x, 'promote', { checks, notes: clean(r.body.notes, 500) }); return to('published'); }
      x.continental = 'returned'; histo(c, x, 'return', { checks, notes: clean(r.body.notes, 500) }); return to('published'); }
    case 'new_version': { if (!admin || x.status !== 'published') fail(409, 'invalid_transition'); const nv = { ...JSON.parse(JSON.stringify(x)), id: 'c' + c.env.randHex(5), version: x.version + 1, status: 'draft', visibility: 'private', sharedWith: [], continental: null, supersedes: x.id, owner: u.id, ownerName: u.name, createdAt: c.env.now(), updatedAt: c.env.now(), history: [] }; histo(c, nv, 'create', { from: x.id }); c.db.put('courses', nv); audit(c, 'course.new_version', nv.id, { from: x.id }); return ok({ course: nv }, 201); }
    default: fail(400, 'unknown_action');
  }
});
R('DELETE', '/api/authoring/courses/:id', (c, r) => { needRole(c, 'ms_admin', 'trainer'); const x = c.db.get('courses', r.params.id); if (!x || x.tenant !== c.user.tenant || x.status !== 'draft' || (c.user.role === 'trainer' && x.owner !== c.user.id)) fail(403, 'forbidden'); c.db.del('courses', x.id); audit(c, 'course.delete', x.id); return ok({ deleted: true }); });
R('GET', '/api/export/scorm/:id', (c, r) => { needRole(c); const k = getCourse(c, r.params.id); if (!k || !visibleTo(k, c.user)) fail(404, 'not_found'); const full = k.source === 'starter' ? k : c.db.get('courses', k.id); return ok({ kind: 'zip', filename: `scorm12-${k.id}.zip`, files: buildScorm(full) }); });

export const _internal = { summary, HttpError };
export { canManage, inScope };
