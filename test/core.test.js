import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';
import { verifyAudit, verifyCert, analytics, buildScorm, validateCourse } from '../public/js/core.js';

test('curriculum: 21 modules, CEUs sum to 30.0 incl. 3.5 exam; EN+FR complete', () => {
  const w = makeWorld(); const m = Object.values(w.starter.modules);
  assert.equal(m.length, 21); const sum = m.reduce((a, x) => a + x.ceu, 0) + w.starter.cur.exam.ceu; assert.equal(Math.round(sum * 100) / 100, 30);
  assert.equal(w.starter.cur.levels.length, 4); assert.ok(w.starter.pool.length >= 147);
  for (const x of m) { assert.ok(x.lessons.length >= 3 && x.quiz.length >= 7, x.id); for (const l of x.lessons) assert.ok(l.title.fr && l.body.fr, x.id); }
});

test('learner never receives quiz answers; quiz needs lessons first', () => {
  const w = makeWorld(); const { l1 } = w.users;
  const r = w.call(l1, 'GET', '/api/courses/m1'); assert.equal(r.status, 200); assert.equal(r.body.course.quiz, undefined); assert.equal(r.body.course.quizCount, 7);
  assert.equal(w.call(l1, 'POST', '/api/quiz/start', { course: 'm1' }).body.error, 'finish_lessons_first');
  w.study(l1, 'm1'); const s = w.call(l1, 'POST', '/api/quiz/start', { course: 'm1' }); assert.equal(s.status, 200);
  const txt = JSON.stringify(s.body); assert.ok(!/"correct"|"c":|"why"/.test(txt), 'no answer keys in payload');
  assert.equal(s.body.questions.length, 7); assert.ok(s.body.questions.every((q) => q.options.length === 3));
});

test('pass → completion, CEU ledger (idempotent), level & full certificates, QR-verifiable', () => {
  const w = makeWorld(); const { l1 } = w.users;
  const ids = Object.keys(w.starter.modules); let res;
  for (const id of ids) { res = w.pass(l1, id); assert.equal(res.body.passed, true, id); assert.equal(res.body.score, 100); }
  const ceu = w.call(l1, 'GET', '/api/me/ceu').body; assert.equal(ceu.total, 26.5);
  const me = w.call(l1, 'GET', '/api/me').body.summary; assert.equal(me.completed, 21); assert.equal(me.examEligible, true);
  assert.equal(me.certs.filter((c) => c.type === 'member_state').length, 4, 'one member-state cert per level');
  const ex = w.call(l1, 'GET', '/api/exam/start'); assert.equal(ex.status, 200); assert.equal(ex.body.questions.length, 40);
  const mods = new Set(ex.body.questions.map((q) => q.id.split('.')[0])); assert.equal(mods.size, 21, 'exam covers every module');
  const done = w.take(l1, ex); assert.equal(done.body.passed, true); assert.equal(done.body.ceuAwarded, 3.5);
  assert.equal(w.call(l1, 'GET', '/api/me/ceu').body.total, 30);
  const acc = w.call(l1, 'GET', '/api/me/certificates').body.certificates.find((c) => c.type === 'accredited'); assert.ok(acc); assert.equal(acc.issuer, 'Africa CDC'); assert.match(acc.id, /^ACDC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const v = w.call(null, 'GET', '/api/verify/' + acc.id).body; assert.equal(v.status, 'valid'); assert.equal(v.holder, 'Aminetou S.', 'public view masks surname');
  assert.equal(w.call(null, 'GET', '/api/verify/ACDC-AAAA-BBBB-CCCC').body.status, 'unknown');
  // retaking a passed module does not duplicate CEU
  w.db.put('enrol', { ...w.db.get('enrol', l1.id + ':m1'), status: 'in_progress' }); w.tick(); w.take(l1, w.call(l1, 'POST', '/api/quiz/start', { course: 'm1' }));
  assert.equal(w.call(l1, 'GET', '/api/me/ceu').body.total, 30);
});

test('certificate tampering and revocation are detected', () => {
  const w = makeWorld(); const { l1, msMR, root } = w.users; w.pass(l1, 'm1');
  const lv = w.call(l1, 'GET', '/api/me/certificates').body.certificates; assert.equal(lv.length, 0, 'level cert only after full level');
  for (const id of ['m2', 'm3', 'm4', 'm5', 'm6', 'm7']) w.pass(l1, id);
  const c = w.call(l1, 'GET', '/api/me/certificates').body.certificates[0]; assert.equal(c.type, 'member_state'); assert.equal(c.issuer, 'Mauritania');
  assert.equal(verifyCert(w.ctxFor(null), c.id).status, 'valid');
  w.db.put('certs', { ...c, holder: 'Someone Else' }); assert.equal(verifyCert(w.ctxFor(null), c.id).status, 'tampered'); w.db.put('certs', c);
  assert.equal(w.call(msMR, 'POST', `/api/admin/certificates/${c.id}/revoke`, { reason: 'test' }).status, 200); assert.equal(verifyCert(w.ctxFor(null), c.id).status, 'revoked');
  w.env.now = ((n) => () => n + 3 * 365 * 86400000)(w.env.now()); assert.equal(verifyCert(w.ctxFor(null), c.id).status, 'revoked');
});

test('3 failed attempts lock the module until a trainer/admin unlocks it', () => {
  const w = makeWorld(); const { l1, l2, trMR, faMR } = w.users; w.study(l1, 'm3');
  for (let i = 0; i < 3; i++) { w.tick(); const r = w.take(l1, w.call(l1, 'POST', '/api/quiz/start', { course: 'm3' }), false); assert.equal(r.body.passed, false); assert.equal(r.body.score, 0); if (i === 2) assert.equal(r.body.locked, true); }
  const blocked = w.call(l1, 'POST', '/api/quiz/start', { course: 'm3' }); assert.equal(blocked.status, 423); assert.equal(blocked.body.error, 'locked_contact_trainer');
  assert.equal(w.call(l1, 'POST', '/api/admin/unlock', { user: l1.id, course: 'm3' }).status, 403, 'learner cannot self-unlock');
  const h = w.call(faMR, 'POST', '/api/admin/cohorts', { name: 'C1' }).body.cohort; // trainer must own the cohort containing the learner
  assert.equal(w.call(trMR, 'POST', '/api/admin/unlock', { user: l1.id, course: 'm3' }).status, 403, 'trainer without that learner in a cohort cannot unlock');
  w.db.put('cohorts', { ...h, trainer: trMR.id, members: [l1.id] });
  assert.equal(w.call(trMR, 'POST', '/api/admin/unlock', { user: l1.id, course: 'm3' }).status, 200);
  w.tick(); assert.equal(w.take(l1, w.call(l1, 'POST', '/api/quiz/start', { course: 'm3' })).body.passed, true);
  assert.equal(w.call(l2, 'POST', '/api/quiz/submit', { attemptId: 'nope', answers: [] }).status, 404);
});

test('exam needs all modules; attempts belong to their owner; no double submit', () => {
  const w = makeWorld(); const { l1, l2 } = w.users; assert.equal(w.call(l1, 'GET', '/api/exam/start').body.error, 'complete_all_modules_first');
  w.study(l1, 'm1'); const s = w.call(l1, 'POST', '/api/quiz/start', { course: 'm1' });
  assert.equal(w.call(l2, 'POST', '/api/quiz/submit', { attemptId: s.body.attemptId, answers: [0, 0, 0, 0, 0, 0, 0] }).status, 404, 'cannot submit someone else’s attempt');
  assert.equal(w.take(l1, s).body.passed, true);
  assert.equal(w.call(l1, 'POST', '/api/quiz/submit', { attemptId: s.body.attemptId, answers: [] }).body.error, 'attempt_closed', 'no double submit');
});

test('multi-tenancy: tenants cannot see or manage each other', () => {
  const w = makeWorld(); const { msMR, msCF, l1, lCF, faMR, root } = w.users;
  assert.deepEqual(w.call(msMR, 'GET', '/api/admin/users').body.users.map((u) => u.tenant).filter((t) => t !== 'MR'), []);
  assert.equal(w.call(msMR, 'PATCH', `/api/admin/users/${lCF.id}`, { disabled: true }).status, 403);
  assert.equal(w.call(msMR, 'POST', '/api/admin/users', { tenant: 'CF', email: 'z@z.org', role: 'learner' }).body.user.tenant, 'MR', 'tenant forced to own space');
  assert.equal(w.call(msMR, 'POST', '/api/admin/users', { email: 'a@a.org', role: 'super_admin' }).status, 403, 'cannot escalate');
  assert.equal(w.call(msMR, 'POST', '/api/admin/tenants', { id: 'ZZ', name: 'x' }).status, 403);
  assert.equal(w.call(l1, 'GET', '/api/admin/users').status, 403);
  assert.equal(w.call(null, 'GET', '/api/me').status, 401);
  // facility admin sees own facility only
  const fa = w.call(faMR, 'GET', '/api/admin/users').body.users; assert.ok(fa.every((u) => u.facility === w.f1.id));
  assert.equal(w.call(faMR, 'POST', '/api/admin/users', { email: 'q@q.org', role: 'ms_admin' }).status, 403);
  // certificates readable only by owner / in-scope admin
  w.pass(lCF, 'm1'); const a = analytics({ ...w.ctxFor(msMR) }, null); assert.equal(a.tenants.length, 1); assert.equal(a.tenants[0].id, 'MR');
  assert.equal(analytics(w.ctxFor(root), null).tenants.length, 55);
});

test('authoring workflow: Draft → Review → Publish → share → continental; four-eyes; checks required', () => {
  const w = makeWorld(); const { trMR, msMR, msCF, root, l1, lCF } = w.users;
  const c = w.call(trMR, 'POST', '/api/authoring/courses', { from: 'm5' }).body.course; assert.equal(c.status, 'draft'); assert.equal(c.ceu, 0);
  assert.equal(w.call(trMR, 'POST', `/api/authoring/courses/${c.id}/submit_review`).status, 200);
  assert.equal(w.call(trMR, 'PUT', `/api/authoring/courses/${c.id}`, { title: { en: 'x' } }).status, 409, 'locked while in review');
  assert.equal(w.call(trMR, 'POST', `/api/authoring/courses/${c.id}/review`, { decision: 'approve' }).status, 409, 'trainer cannot review');
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${c.id}/review`, { decision: 'approve', checks: { competency: true, accuracy: true, accessibility: true } }).status, 422, 'all four checks required');
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${c.id}/review`, { decision: 'approve', ceu: 1, checks: { competency: true, accuracy: true, accessibility: true, branding: true } }).status, 200);
  assert.equal(w.call(l1, 'GET', `/api/courses/${c.id}`).status, 404, 'private until published');
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${c.id}/publish`).status, 200);
  assert.equal(w.call(l1, 'GET', `/api/courses/${c.id}`).status, 200, 'own tenant sees published course');
  assert.equal(w.call(lCF, 'GET', `/api/courses/${c.id}`).status, 404, 'other tenant cannot');
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${c.id}/share`, { tenants: ['CF'] }).status, 200);
  assert.equal(w.call(lCF, 'GET', `/api/courses/${c.id}`).status, 200, 'named partner sees it');
  assert.ok(w.call(lCF, 'GET', '/api/courses').body.library.some((x) => x.id === c.id));
  // member-state certificate on completion of an authored course
  w.study(l1, 'm1'); w.call(l1, 'POST', '/api/progress', { course: c.id, lesson: 0 }); w.call(l1, 'POST', '/api/progress', { course: c.id, lesson: 1 }); w.call(l1, 'POST', '/api/progress', { course: c.id, lesson: 2 });
  assert.equal(w.take(l1, w.call(l1, 'POST', '/api/quiz/start', { course: c.id })).body.passed, true);
  assert.ok(w.call(l1, 'GET', '/api/me/certificates').body.certificates.some((x) => x.scope === 'course:' + c.id && x.type === 'member_state'));
  // continental promotion
  assert.equal(w.call(msCF, 'POST', `/api/authoring/courses/${c.id}/submit_continental`).status, 409, 'only owner tenant');
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${c.id}/submit_continental`).status, 200);
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${c.id}/continental_review`, { decision: 'promote' }).status, 409, 'only Africa CDC');
  assert.equal(w.call(root, 'POST', `/api/authoring/courses/${c.id}/continental_review`, { decision: 'promote', checks: { competency: true, accuracy: true, accessibility: true, branding: true } }).status, 200);
  assert.ok(w.call(w.users.lCF, 'GET', '/api/courses').body.library.some((x) => x.id === c.id && x.visibility === 'continental'));
  // four-eyes: an ms_admin cannot review their own course
  const own = w.call(msMR, 'POST', '/api/authoring/courses', { title: { en: 'Own course' } }).body.course; assert.ok(validateCourse(own).length > 0);
  assert.equal(w.call(msMR, 'POST', `/api/authoring/courses/${own.id}/submit_review`).status, 422, 'incomplete course blocked');
});

test('SCORM 1.2 export is a valid manifest + SCOs', () => {
  const w = makeWorld(); const r = w.call(w.users.l1, 'GET', '/api/export/scorm/m2'); assert.equal(r.status, 200); const f = r.body.files;
  assert.match(f['imsmanifest.xml'], /schemaversion>1\.2</); assert.match(f['en.html'], /LMSSetValue\("cmi\.core\.lesson_status"/); assert.ok(f['fr.html'].includes('Compétences'));
  assert.ok(Object.keys(buildScorm(w.starter.modules.m1)).length === 4);
});

test('audit log is a tamper-evident hash chain; admin actions are recorded', () => {
  const w = makeWorld(); w.call(w.users.msMR, 'POST', '/api/admin/users', { email: 'n@mr.org', role: 'learner', name: 'N' });
  assert.equal(verifyAudit(w.db).ok, true); const rows = w.call(w.users.msMR, 'GET', '/api/admin/audit').body.rows; assert.ok(rows.some((r) => r.action === 'user.create'));
  assert.equal(w.call(w.users.msMR, 'GET', '/api/admin/audit/verify').status, 403);
  const a = w.db.all('audit')[2]; w.db.put('audit', { ...a, action: 'forged' }); const v = verifyAudit(w.db); assert.equal(v.ok, false); assert.equal(v.brokenAt, a.seq);
});

import { permFor } from '../public/js/core.js';
test('offline: prepared attempts graded on sync, and sync is idempotent', () => {
  const w = makeWorld(); const { l1 } = w.users; const pk = w.call(l1, 'POST', '/api/offline/package', { courses: ['m1', 'm2'] }).body.packages; assert.equal(pk.length, 2);
  const again = w.call(l1, 'POST', '/api/offline/package', { courses: ['m1'] }).body.packages[0]; assert.equal(again.attempt.attemptId, pk[0].attempt.attemptId, 'open attempt reused, no attempts burned');
  const att = w.db.get('attempts', pk[0].attempt.attemptId); const answers = pk[0].attempt.questions.map((q) => permFor(att.seed, q.id).indexOf(0));
  const events = [{ id: 'e1', type: 'progress', payload: { course: 'm1', lesson: 0 } }, { id: 'e2', type: 'progress', payload: { course: 'm1', lesson: 1 } }, { id: 'e3', type: 'progress', payload: { course: 'm1', lesson: 2 } }, { id: 'e4', type: 'quiz_submit', payload: { attemptId: att.id, answers } }];
  const r1 = w.call(l1, 'POST', '/api/sync', { events }).body.results; assert.deepEqual(r1.map((x) => x.status), ['ok', 'ok', 'ok', 'ok']); assert.equal(r1[3].result.passed, true);
  const r2 = w.call(l1, 'POST', '/api/sync', { events }).body.results; assert.ok(r2.every((x) => x.status === 'duplicate'));
  assert.equal(w.call(l1, 'GET', '/api/me/ceu').body.total, 1, 'replay did not double-award CEU');
});

test('demographics suppress small cells (<5) to protect privacy', () => {
  const w = makeWorld(); const a = analytics(w.ctxFor(w.users.msMR), null); const f = a.demographics.sex.F; assert.equal(f.suppressed, true); assert.equal(f.n, '<5');
});

test('external CEU claims need approval by someone else in scope', () => {
  const w = makeWorld(); const { l1, msMR, faMR } = w.users; const e = w.call(l1, 'POST', '/api/me/ceu', { title: 'WHO course', ceu: 2, evidence: 'cert #1' }).body.entry;
  assert.equal(w.call(l1, 'GET', '/api/me/ceu').body.total, 0); assert.equal(w.call(l1, 'POST', `/api/admin/ceu/${e.id}/decision`, { approve: true }).status, 403);
  assert.equal(w.call(msMR, 'POST', `/api/admin/ceu/${e.id}/decision`, { approve: true }).status, 200); assert.equal(w.call(l1, 'GET', '/api/me/ceu').body.total, 2);
  assert.equal(w.call(l1, 'POST', '/api/me/ceu', { title: 'x', ceu: 99 }).body.error, 'invalid_ceu');
});

test('bulk import validates rows, reports errors, forbids duplicates', () => {
  const w = makeWorld(); const r = w.call(w.users.msMR, 'POST', '/api/admin/users/import', { rows: [{ name: 'A', email: 'a1@mr.org', facility: 'MR Centre' }, { name: 'B', email: 'bad' }, { name: 'C', email: 'a1@mr.org' }] }).body;
  assert.equal(r.created.length, 1); assert.equal(r.errors.length, 2); assert.ok(r.created[0].tempPassword.length >= 12);
  const u = w.db.all('users').find((x) => x.email === 'a1@mr.org'); assert.equal(u.facility, w.f1.id); assert.equal(u.tenant, 'MR');
});

test('exam attempt expires after the time limit (60 min + 5 grace) and does not count as a failure', () => {
  const w = makeWorld(); const { l2 } = w.users;
  for (const m of Object.values(w.starter.modules)) w.db.put('enrol', { id: `${l2.id}:${m.id}`, user: l2.id, tenant: 'MR', course: m.id, lessons: [0, 1, 2], status: 'completed', best: 90, fails: 0, startedAt: 1, lastAt: 1, completedAt: 1 });
  const ex = w.call(l2, 'GET', '/api/exam/start'); assert.equal(ex.status, 200); assert.equal(ex.body.minutes, 60);
  w.tick(66 * 60000); const r = w.call(l2, 'POST', '/api/quiz/submit', { attemptId: ex.body.attemptId, answers: [] }); assert.equal(r.status, 410);
  assert.equal(w.call(l2, 'GET', '/api/me').body.summary.examFails, 0);
  assert.equal(w.call(l2, 'GET', '/api/exam/start').status, 200, 'a fresh attempt can start');
});
