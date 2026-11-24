import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, loadConfig } from '../server/index.js';
import { totp } from '../server/auth.js';
import { permFor } from '../public/js/core.js';

let app, base, dir; const jar = {};
const cookieOf = (name) => jar[name] || '';
async function req(method, path, body, { cookie = 'main', headers = {}, raw = false } = {}) {
  const h = { 'X-Requested-With': 'acdc-dlp', ...headers }; if (body !== undefined) h['Content-Type'] = 'application/json'; if (jar[cookie]) h.Cookie = jar[cookie];
  const r = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) jar[cookie] = sc.split(';')[0];
  if (raw) return r; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j, headers: r.headers };
}
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dlp-'));
  const cfg = loadConfig({ DATA_DIR: dir, QUIET: '1', DEMO_DATA: '1', PORT: '0', ALLOW_LOCAL_KEYS: '1' }); app = createApp(cfg);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
});
test.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test('health + static + security headers + traversal blocked', async () => {
  const h = await req('GET', '/api/health'); assert.equal(h.body.ok, true); assert.equal(h.body.mode, 'server');
  const idx = await req('GET', '/', undefined, { raw: true }); assert.equal(idx.status, 200); assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(idx.headers.get('x-frame-options'), 'DENY'); assert.equal(idx.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await req('GET', '/data/curriculum.json')).body.modules.length, 21);
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/server/index.js', '/.keys.json', '/data-store/.keys.json']) { const r = await req('GET', p, undefined, { raw: true }); assert.ok([404, 400].includes(r.status) || !(await r.clone().text()).includes('"scripts"'), p); }
  assert.equal((await req('GET', '/js/core.js', undefined, { raw: true })).status, 200);
  assert.equal((await req('GET', '/some/spa/route', undefined, { raw: true })).status, 200, 'SPA fallback');
});

test('CSRF header required for state-changing calls; cross-origin rejected', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'acdc-dlp', Origin: 'https://evil.example' }, body: '{}' }); assert.equal(r2.status, 403);
  const r3 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Requested-With': 'acdc-dlp' }, body: '{"a":1}' }); assert.equal(r3.status, 415);
});

test('learner login → learn → pass → CEU; cookie is HttpOnly+SameSite; answers never leak', async () => {
  const bad = await req('POST', '/api/login', { email: 'learner@demo.africacdc.example', password: 'nope' }); assert.equal(bad.status, 401);
  const lg = await req('POST', '/api/login', { email: 'learner@demo.africacdc.example', password: 'Demo#2026' }); assert.equal(lg.status, 200); assert.equal(lg.body.user.pw, undefined);
  const sc = lg.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  const me = await req('GET', '/api/me'); assert.equal(me.body.user.role, 'learner'); assert.equal(me.body.user.pw, undefined); assert.equal(me.body.user.mfaSecret, undefined);
  for (let i = 0; i < 3; i++) await req('POST', '/api/progress', { course: 'm1', lesson: i });
  const s = await req('POST', '/api/quiz/start', { course: 'm1' }); assert.equal(s.status, 200); assert.ok(!/"correct"|"why"/.test(JSON.stringify(s.body)));
  const att = app.db.get('attempts', s.body.attemptId); const answers = s.body.questions.map((q) => permFor(att.seed, q.id).indexOf(0));
  const r = await req('POST', '/api/quiz/submit', { attemptId: att.id, answers }); assert.equal(r.body.passed, true); assert.equal((await req('GET', '/api/me/ceu')).body.total, 1);
  assert.equal((await req('GET', '/api/admin/users')).status, 403);
  const zip = await req('GET', '/api/export/scorm/m1', undefined, { raw: true }); assert.equal(zip.headers.get('content-type'), 'application/zip'); const b = Buffer.from(await zip.arrayBuffer()); assert.equal(b.readUInt32LE(0), 0x04034b50);
  await req('POST', '/api/logout', {}); assert.equal((await req('GET', '/api/me')).status, 401);
});

test('admin MFA: password → TOTP enrolment → login with code; replay and bad codes rejected; recovery code works once', async () => {
  const email = 'admin.mr@demo.africacdc.example';
  const l1 = await req('POST', '/api/login', { email, password: 'Demo#2026' }, { cookie: 'adm' }); assert.equal(l1.body.mfaSetupRequired, true); assert.equal(jar.adm, undefined, 'no session before MFA');
  const st = l1.body.setupToken; const su = await req('POST', '/api/mfa/setup', { setupToken: st }, { cookie: 'adm' }); assert.match(su.body.otpauth, /^otpauth:\/\/totp\//);
  assert.equal((await req('POST', '/api/mfa/confirm', { setupToken: st, code: '000000' }, { cookie: 'adm' })).status, 401);
  const c = await req('POST', '/api/mfa/confirm', { setupToken: st, code: totp(su.body.secret, Math.floor(Date.now() / 30000)) }, { cookie: 'adm' }); assert.equal(c.status, 200); assert.equal(c.body.recoveryCodes.length, 8);
  assert.equal((await req('GET', '/api/admin/users', undefined, { cookie: 'adm' })).status, 200);
  const l2 = await req('POST', '/api/login', { email, password: 'Demo#2026' }, { cookie: 'adm2' }); assert.equal(l2.body.mfaRequired, true);
  const stepNow = Math.floor(Date.now() / 30000); const replay = await req('POST', '/api/login/mfa', { mfaToken: l2.body.mfaToken, code: totp(su.body.secret, stepNow) }, { cookie: 'adm2' }); assert.equal(replay.status, 401, 'same time-step code cannot be replayed');
  const good = await req('POST', '/api/login/mfa', { mfaToken: l2.body.mfaToken, code: totp(su.body.secret, stepNow + 1) }, { cookie: 'adm2' }); assert.equal(good.status, 200);
  const l3 = await req('POST', '/api/login', { email, password: 'Demo#2026' }, { cookie: 'adm3' }); const rc = c.body.recoveryCodes[0];
  assert.equal((await req('POST', '/api/login/mfa', { mfaToken: l3.body.mfaToken, recovery: rc }, { cookie: 'adm3' })).status, 200);
  const l4 = await req('POST', '/api/login', { email, password: 'Demo#2026' }, { cookie: 'adm4' }); assert.equal((await req('POST', '/api/login/mfa', { mfaToken: l4.body.mfaToken, recovery: rc }, { cookie: 'adm4' })).status, 401, 'recovery code is single-use');
});

test('login lockout after 5 failures; generic error; failures are audited without raw email', async () => {
  const email = 'trainer.cf@demo.africacdc.example'; for (let i = 0; i < 5; i++) assert.equal((await req('POST', '/api/login', { email, password: 'x' + i }, { cookie: 'x' })).status, 401);
  assert.equal((await req('POST', '/api/login', { email, password: 'Demo#2026' }, { cookie: 'x' })).status, 429, 'locked even with the right password');
  const fails = app.db.all('audit').filter((a) => a.action === 'auth.login_failed'); assert.ok(fails.length >= 5); assert.ok(!JSON.stringify(fails).includes('trainer.cf'));
});

test('super admin: tenants, analytics, audit verify, exports; MS admin is scoped', async () => {
  // super admin has no MFA yet in this fresh DB: complete enrolment
  const email = 'super@demo.africacdc.example'; const a = await req('POST', '/api/login', { email, password: 'Demo#2026' }, { cookie: 'sa' }); const su = await req('POST', '/api/mfa/setup', { setupToken: a.body.setupToken }, { cookie: 'sa' });
  assert.equal((await req('POST', '/api/mfa/confirm', { setupToken: a.body.setupToken, code: totp(su.body.secret, Math.floor(Date.now() / 30000)) }, { cookie: 'sa' })).status, 200);
  const an = await req('GET', '/api/admin/analytics', undefined, { cookie: 'sa' }); assert.equal(an.body.tenants.length, 55); assert.ok(an.body.totals.learners > 300);
  assert.equal((await req('GET', '/api/admin/audit/verify', undefined, { cookie: 'sa' })).body.ok, true);
  const t = await req('POST', '/api/admin/tenants', { id: 'ZZ', name: 'Testland', admin: { name: 'T Admin', email: 'ta@zz.org' } }, { cookie: 'sa' }); assert.equal(t.status, 201); assert.ok(t.body.admin.tempPassword);
  const exp = await req('GET', '/api/admin/export?tenant=MR', undefined, { cookie: 'sa' }); assert.equal(exp.body.format, 'africacdc-dlp-export/1'); assert.ok(exp.body.users.every((u) => u.tenant === 'MR' && !u.pw));
  const csv = await req('GET', '/api/admin/export.csv?collection=users&tenant=MR', undefined, { cookie: 'sa' }); assert.match(csv.body, /^id,/); assert.ok(!/scrypt\$/.test(csv.body), 'no password hashes in exports');
  const sys = await req('GET', '/api/admin/system', undefined, { cookie: 'sa' }); assert.equal(sys.body.auditChain.ok, true);
  // new tenant admin must change temp password before anything else
  const l = await req('POST', '/api/login', { email: 'ta@zz.org', password: t.body.admin.tempPassword }, { cookie: 'ta' }); const su2 = await req('POST', '/api/mfa/setup', { setupToken: l.body.setupToken }, { cookie: 'ta' });
  const cf = await req('POST', '/api/mfa/confirm', { setupToken: l.body.setupToken, code: totp(su2.body.secret, Math.floor(Date.now() / 30000)) }, { cookie: 'ta' }); assert.equal(cf.body.mustChange, true);
  assert.equal((await req('GET', '/api/admin/users', undefined, { cookie: 'ta' })).body.error, 'password_change_required');
  assert.equal((await req('POST', '/api/password', { current: t.body.admin.tempPassword, password: 'short' }, { cookie: 'ta' })).status, 422);
  assert.equal((await req('POST', '/api/password', { current: t.body.admin.tempPassword, password: 'a-Strong-Passphrase-42' }, { cookie: 'ta' })).status, 200);
  assert.equal((await req('GET', '/api/admin/users', undefined, { cookie: 'ta' })).status, 200);
});

test('personal data is encrypted at rest in SQLite; data survives restart', async () => {
  const { DatabaseSync } = await import('node:sqlite'); const raw = new DatabaseSync(join(dir, 'dlp.sqlite'), { readOnly: true });
  const rows = raw.prepare("SELECT json FROM docs WHERE coll='users' LIMIT 50").all().map((r) => r.json).join('\n'); raw.close();
  assert.ok(!rows.includes('@demo.africacdc.example') && !rows.includes('Aminetou'), 'no plaintext emails or names in the database file'); assert.ok(rows.includes('"_pii":"v1.'));
  const n = app.db.count('users'); await app.close();
  const cfg = loadConfig({ DATA_DIR: dir, QUIET: '1', PORT: '0', ALLOW_LOCAL_KEYS: '1' }); app = createApp(cfg); assert.equal(app.db.count('users'), n);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
  const lg = await req('POST', '/api/login', { email: 'exam@demo.africacdc.example', password: 'Demo#2026' }, { cookie: 'r' }); assert.equal(lg.status, 200); assert.equal((await req('GET', '/api/me', undefined, { cookie: 'r' })).body.summary.completed, 21);
});

test('production refuses to start without secrets / with demo data', () => {
  assert.throws(() => createApp(loadConfig({ NODE_ENV: 'production', DATA_DIR: mkdtempSync(join(tmpdir(), 'p1-')), QUIET: '1' })), /SESSION_SECRET/);
  const ok = { NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), DB_ENCRYPTION_KEY: 'b'.repeat(64), QUIET: '1' };
  assert.throws(() => createApp(loadConfig({ ...ok, DATA_DIR: mkdtempSync(join(tmpdir(), 'p2-')), DEMO_DATA: '1' })), /DEMO_DATA/);
  const x = createApp(loadConfig({ ...ok, DATA_DIR: mkdtempSync(join(tmpdir(), 'p3-')), ADMIN_EMAIL: 'a@b.org', ADMIN_PASSWORD: 'Initial-Passw0rd!' })); assert.equal(x.db.all('users').filter((u) => u.role === 'super_admin').length, 1); x.db.close();
});
