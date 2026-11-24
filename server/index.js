// Africa CDC Digital Literacy Platform — zero-dependency Node server (Node >= 22.5).
// Serves the PWA and the REST API. Business rules live in public/js/core.js (shared with the browser demo).
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, readdirSync, chmodSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SqliteStore } from './store-sqlite.js';
import { hashPassword, verifyPassword, DUMMY_HASH, passwordProblems, sign, unsign, newTotpSecret, totpCheck, otpauth, RateLimiter } from './auth.js';
import { makeEnv } from '../public/js/env.js';
import { handle, audit, createUser, canManage, verifyAudit } from '../public/js/core.js';
import { seedBase, seedDemo } from '../public/js/seed.js';
import { zip } from '../public/js/zip.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.geojson': 'application/geo+json' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.geojson']);

export function loadStarter(dir = join(PUBLIC, 'data')) {
  const cur = JSON.parse(readFileSync(join(dir, 'curriculum.json'))), modules = {};
  for (const f of readdirSync(join(dir, 'modules'))) { const m = JSON.parse(readFileSync(join(dir, 'modules', f))); modules[m.id] = m; }
  return { cur, modules, pool: JSON.parse(readFileSync(join(dir, 'exam-pool.json'))) };
}

export function loadConfig(e = process.env) {
  const production = e.NODE_ENV === 'production';
  const cfg = { port: +(e.PORT || 8080), host: e.HOST || '0.0.0.0', dataDir: resolve(e.DATA_DIR || join(ROOT, 'data-store')), production,
    secret: e.SESSION_SECRET || '', encKey: e.DB_ENCRYPTION_KEY || '', adminEmail: e.ADMIN_EMAIL || '', adminPassword: e.ADMIN_PASSWORD || '', demo: e.DEMO_DATA === '1',
    baseUrl: e.BASE_URL || '', trustProxy: e.TRUST_PROXY === '1', mfaRoles: (e.MFA_REQUIRED_ROLES === undefined ? 'super_admin,ms_admin,facility_admin' : e.MFA_REQUIRED_ROLES).split(',').filter(Boolean), allowLocalKeys: e.ALLOW_LOCAL_KEYS === '1', quiet: e.QUIET === '1' };
  return cfg;
}
function resolveKeys(cfg) {
  mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 }); const f = join(cfg.dataDir, '.keys.json');
  if (cfg.secret && cfg.encKey) return;
  if (cfg.production && !cfg.allowLocalKeys) throw new Error('Production requires SESSION_SECRET and DB_ENCRYPTION_KEY (64 hex chars). Generate with: openssl rand -hex 32');
  let k = {}; if (existsSync(f)) k = JSON.parse(readFileSync(f, 'utf8'));
  if (!k.secret) k.secret = randomBytes(32).toString('hex'); if (!k.encKey) k.encKey = randomBytes(32).toString('hex'); writeFileSync(f, JSON.stringify(k), { mode: 0o600 }); try { chmodSync(f, 0o600); } catch {}
  cfg.secret ||= k.secret; cfg.encKey ||= k.encKey; if (!cfg.quiet) console.warn('[warn] Using locally generated keys in ' + f + ' — fine for development; use a secrets manager in production.');
}

export function createApp(cfg) {
  resolveKeys(cfg); if (!/^[0-9a-f]{64}$/i.test(cfg.encKey)) throw new Error('DB_ENCRYPTION_KEY must be 64 hex characters');
  const starter = loadStarter(), db = new SqliteStore(join(cfg.dataDir, 'dlp.sqlite'), { key: Buffer.from(cfg.encKey, 'hex') });
  const env = makeEnv({ secret: cfg.secret, mode: 'server', baseUrl: cfg.baseUrl, hashPassword, verifyPassword: (p, h) => verifyPassword(p, h), version: JSON.parse(readFileSync(join(ROOT, 'package.json'))).version });
  const mfaOn = (u) => cfg.mfaRoles.includes(u.role);
  db.batch(() => {
    seedBase(db, env, cfg.adminEmail && cfg.adminPassword ? { admin: { email: cfg.adminEmail, password: cfg.adminPassword, name: 'Africa CDC Administrator', mustChange: true } } : {});
    if (cfg.demo) { if (cfg.production && process.env.ALLOW_DEMO_IN_PRODUCTION !== '1') throw new Error('DEMO_DATA=1 refused in production (demo accounts share a public password).'); if (!db.all('users').some(u => u.demo)) seedDemo(db, env, starter); }
  });
  const loginIp = new RateLimiter(30, 15 * 60000), loginFail = new RateLimiter(5, 15 * 60000), apiIp = new RateLimiter(600, 60000), mfaFail = new RateLimiter(6, 15 * 60000);
  const ctx = (user = null) => ({ db, env, starter, user });
  const log = (o) => { if (!cfg.quiet) console.log(JSON.stringify({ t: new Date().toISOString(), ...o })); };
  const H = (https) => ({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", ...(https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) });
  const isHttps = (req) => !!req.socket.encrypted || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const ipOf = (req) => (cfg.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';

  // Sessions: 8 h absolute lifetime (never extended), 30 min idle timeout (refreshed on activity).
  const sessionCookie = (req, user, prev) => { const now = Date.now(), exp = prev ? prev.exp : now + 8 * 3600000; const tok = sign(cfg.secret, { k: 's', uid: user.id, sv: user.sv || 0, iat: prev ? prev.iat : now, la: now, exp }); return `acdc_s=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(1, Math.floor((exp - now) / 1000))}${isHttps(req) ? '; Secure' : ''}`; };
  const clearCookie = (req) => `acdc_s=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
  const cookie = (req, n) => { const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(n + '=')); return m ? m.slice(n.length + 1) : null; };
  function sessionUser(req) {
    const t = unsign(cfg.secret, cookie(req, 'acdc_s')); if (!t || t.k !== 's') return null; if (Date.now() - t.la > 30 * 60000) return null; // 30-min idle timeout
    const u = db.get('users', t.uid); if (!u || u.disabled || (u.sv || 0) !== t.sv) return null; return { user: u, token: t };
  }
  const send = (res, req, status, body, extra = {}) => { const s = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...H(isHttps(req)), ...extra }); res.end(s); };
  const anon = { id: 'anon', role: '-', tenant: '-' };
  const readBody = (req, max = 2 * 1024 * 1024) => new Promise((ok, bad) => { const ch = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { bad(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); } else ch.push(c); }); req.on('end', () => { if (!n) return ok({}); try { ok(JSON.parse(Buffer.concat(ch).toString('utf8'))); } catch { bad(Object.assign(new Error('invalid_json'), { status: 400 })); } }); req.on('error', bad); });
  const emailKey = (e) => createHash('sha256').update(String(e).toLowerCase()).digest('hex').slice(0, 12);
  const findByEmail = (e) => db.all('users').find((u) => u.email === String(e || '').toLowerCase().trim());
  const publicUser = (u) => { const { pw, mfaSecret, mfaPending, recovery, mfaStep, ...r } = u; return { ...r, mfa: !!u.mfaEnabled }; };

  async function api(req, res, url) {
    const ip = ipOf(req), path = url.pathname, method = req.method;
    if (apiIp.hit(ip)) return send(res, req, 429, { error: 'rate_limited' }, { 'Retry-After': '60' });
    if (path === '/api/health' && method === 'GET') return send(res, req, 200, handle(ctx(), { method, path, query: {} }).body);
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers['x-requested-with'] !== 'acdc-dlp') return send(res, req, 403, { error: 'csrf_header_required' });
      const o = req.headers.origin; if (o) { try { if (new URL(o).host !== req.headers.host) return send(res, req, 403, { error: 'bad_origin' }); } catch { return send(res, req, 403, { error: 'bad_origin' }); } }
      if (!/^application\/json/i.test(req.headers['content-type'] || '') && Number(req.headers['content-length'] || 0) > 0) return send(res, req, 415, { error: 'json_required' });
    }
    const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);
    const query = Object.fromEntries(url.searchParams);
    // ── authentication endpoints (server-only) ──
    if (path === '/api/login' && method === 'POST') {
      const email = String(body.email || '').toLowerCase().trim(), key = 'e:' + email; if (loginIp.hit(ip) || loginFail.count(key) >= 5) return send(res, req, 429, { error: 'too_many_attempts' }, { 'Retry-After': '900' });
      const u = findByEmail(email), okpw = verifyPassword(String(body.password || ''), u ? u.pw : DUMMY_HASH);
      if (!u || !okpw || u.disabled) { loginFail.hit(key); audit(ctx(anon), 'auth.login_failed', emailKey(email), { ip: createHash('sha256').update(ip).digest('hex').slice(0, 8) }, anon); return send(res, req, 401, { error: 'invalid_credentials' }); }
      loginFail.reset(key);
      if (u.mfaEnabled) return send(res, req, 200, { mfaRequired: true, mfaToken: sign(cfg.secret, { k: 'mfa', uid: u.id, exp: Date.now() + 5 * 60000 }) });
      if (mfaOn(u)) return send(res, req, 200, { mfaSetupRequired: true, setupToken: sign(cfg.secret, { k: 'setup', uid: u.id, exp: Date.now() + 15 * 60000 }) });
      audit(ctx(u), 'auth.login', u.id, {}); return send(res, req, 200, { user: publicUser(u), mustChange: !!u.mustChange }, { 'Set-Cookie': sessionCookie(req, u) });
    }
    if (path === '/api/login/mfa' && method === 'POST') {
      const t = unsign(cfg.secret, body.mfaToken); if (!t || t.k !== 'mfa') return send(res, req, 401, { error: 'invalid_token' }); if (mfaFail.count('m:' + t.uid) >= 6) return send(res, req, 429, { error: 'too_many_attempts' });
      const u = db.get('users', t.uid); if (!u || u.disabled || !u.mfaEnabled) return send(res, req, 401, { error: 'invalid_token' });
      let good = false; const step = totpCheck(u.mfaSecret, body.code, Date.now(), u.mfaStep || 0);
      if (step) { u.mfaStep = step; good = true; } else if (body.recovery) { const h = createHash('sha256').update(String(body.recovery).trim().toLowerCase()).digest('hex'); if ((u.recovery || []).includes(h)) { u.recovery = u.recovery.filter((x) => x !== h); good = true; audit(ctx(u), 'auth.recovery_code_used', u.id, { left: u.recovery.length }); } }
      if (!good) { mfaFail.hit('m:' + t.uid); audit(ctx(anon), 'auth.mfa_failed', u.id, {}, anon); return send(res, req, 401, { error: 'invalid_code' }); }
      mfaFail.reset('m:' + t.uid); db.put('users', u); audit(ctx(u), 'auth.login', u.id, { mfa: true }); return send(res, req, 200, { user: publicUser(u), mustChange: !!u.mustChange }, { 'Set-Cookie': sessionCookie(req, u) });
    }
    if (path === '/api/mfa/setup' && method === 'POST') {
      const t = unsign(cfg.secret, body.setupToken); if (!t || t.k !== 'setup') return send(res, req, 401, { error: 'invalid_token' }); const u = db.get('users', t.uid); if (!u || u.disabled) return send(res, req, 401, { error: 'invalid_token' });
      u.mfaPending = newTotpSecret(); db.put('users', u); return send(res, req, 200, { secret: u.mfaPending, otpauth: otpauth(u.mfaPending, u.email) });
    }
    if (path === '/api/mfa/confirm' && method === 'POST') {
      const t = unsign(cfg.secret, body.setupToken); if (!t || t.k !== 'setup') return send(res, req, 401, { error: 'invalid_token' }); const u = db.get('users', t.uid); if (!u || !u.mfaPending) return send(res, req, 400, { error: 'setup_not_started' });
      const step = totpCheck(u.mfaPending, body.code, Date.now(), 0); if (!step) return send(res, req, 401, { error: 'invalid_code' });
      const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex')); u.mfaSecret = u.mfaPending; delete u.mfaPending; u.mfaEnabled = true; u.mfaStep = step; u.recovery = codes.map((c) => createHash('sha256').update(c).digest('hex')); db.put('users', u);
      audit(ctx(u), 'auth.mfa_enrolled', u.id, {}); return send(res, req, 200, { user: publicUser(u), recoveryCodes: codes, mustChange: !!u.mustChange }, { 'Set-Cookie': sessionCookie(req, u) });
    }
    const sess = sessionUser(req);
    if (path === '/api/logout' && method === 'POST') { if (sess) audit(ctx(sess.user), 'auth.logout', sess.user.id, {}); return send(res, req, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) }); }
    if (!sess) { const r = handle(ctx(null), { method, path, query, body }); return send(res, req, r.status, r.body); }
    const user = sess.user;
    if (path === '/api/password' && method === 'POST') {
      if (!verifyPassword(String(body.current || ''), user.pw)) return send(res, req, 403, { error: 'wrong_password' }); const pr = passwordProblems(body.password, user); if (pr.length) return send(res, req, 422, { error: 'weak_password', problems: pr });
      user.pw = hashPassword(body.password); user.mustChange = false; user.sv = (user.sv || 0) + 1; db.put('users', user); audit(ctx(user), 'auth.password_changed', user.id, {}); return send(res, req, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, user) });
    }
    if (user.mustChange && !(path === '/api/me' && method === 'GET')) return send(res, req, 403, { error: 'password_change_required' });
    let m;
    if ((m = /^\/api\/admin\/users\/([^/]+)\/(reset-password|reset-mfa)$/.exec(path)) && method === 'POST') {
      const t = db.get('users', m[1]); if (!t || !canManage(user, t) || t.id === user.id) return send(res, req, 403, { error: 'forbidden' });
      if (m[2] === 'reset-password') { const temp = env.newPassword(); t.pw = hashPassword(temp); t.mustChange = true; t.sv = (t.sv || 0) + 1; db.put('users', t); audit(ctx(user), 'user.reset_password', t.id, {}); return send(res, req, 200, { tempPassword: temp }); }
      t.mfaEnabled = false; delete t.mfaSecret; delete t.mfaPending; t.recovery = []; t.sv = (t.sv || 0) + 1; db.put('users', t); audit(ctx(user), 'user.reset_mfa', t.id, {}); return send(res, req, 200, { ok: true });
    }
    if (path === '/api/admin/backup' && method === 'POST' && user.role === 'super_admin') { const f = join(cfg.dataDir, `backup-${Date.now()}.sqlite`); db.backup(f); audit(ctx(user), 'system.backup', f.split(sep).pop(), {}); return send(res, req, 200, { file: f.split(sep).pop(), note: 'Encrypted-at-rest copy written to DATA_DIR; move it off-site.' }); }
    if (path === '/api/admin/system' && method === 'GET' && user.role === 'super_admin') { const a = verifyAudit(db); return send(res, req, 200, { node: process.version, uptimeSec: Math.round(process.uptime()), docs: Object.fromEntries(Object.keys(db.c).map((k) => [k, db.count(k)])), auditChain: a, encryptionAtRest: 'AES-256-GCM (PII fields)', mfaRoles: cfg.mfaRoles, tls: isHttps(req) }); }
    // refresh idle timer
    const out = {}; if (Date.now() - sess.token.la > 60000) out['Set-Cookie'] = sessionCookie(req, user, sess.token);
    const r = handle(ctx(user), { method, path, query, body });
    if (r.body && r.body.kind === 'zip') { const buf = Buffer.from(zip(r.body.files)); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${r.body.filename}"`, 'Cache-Control': 'no-store', ...H(isHttps(req)), ...out }); return res.end(buf); }
    if (r.body && r.body.kind === 'text') { res.writeHead(200, { 'Content-Type': r.body.contentType, 'Content-Disposition': `attachment; filename="${r.body.filename}"`, 'Cache-Control': 'no-store', ...H(isHttps(req)), ...out }); return res.end(r.body.text); }
    if (r.status === 200 && path === '/api/me') r.body.user = { ...r.body.user, mustChange: !!user.mustChange };
    return send(res, req, r.status, r.body, out);
  }

  const gz = new Map();
  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html'; const file = resolve(PUBLIC, '.' + p);
    const https = isHttps(req); let target = file;
    const bad = !file.startsWith(PUBLIC + sep) && file !== PUBLIC || p.split('/').some((s) => s.startsWith('.'));
    if (bad) { res.writeHead(404, H(https)); return res.end('Not found'); }
    if (!existsSync(target) || !statSync(target).isFile()) { if (extname(p)) { res.writeHead(404, { 'Content-Type': 'text/plain', ...H(https) }); return res.end('Not found'); } target = join(PUBLIC, 'index.html'); }
    const st = statSync(target), ext = extname(target).toLowerCase(), etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Cache-Control': ['.html', '.webmanifest'].includes(ext) || target.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600', ...H(https) };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    let data = readFileSync(target);
    if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { let c = gz.get(target); if (!c || c.etag !== etag) { c = { etag, buf: gzipSync(data, { level: 6 }) }; gz.set(target, c); } data = c.buf; headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
    res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
      if (url.pathname.startsWith('/api/')) await api(req, res, url); else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url); else { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); }
    } catch (e) { const s = e.status || 500; if (s === 500) console.error(e); if (!res.headersSent) send(res, req, s, { error: s === 500 ? 'server_error' : e.message }); else res.end(); }
    finally { log({ m: req.method, p: String(req.url).split('?')[0], s: res.statusCode, ms: Date.now() - t0 }); }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  return { server, db, ctx, cfg, close: () => new Promise((r) => { server.close(() => { try { db.close(); } catch {} r(); }); server.closeAllConnections?.(); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig(); const app = createApp(cfg);
  app.server.listen(cfg.port, cfg.host, () => { console.log(`Africa CDC Digital Literacy Platform listening on http://${cfg.host}:${cfg.port}  (data: ${cfg.dataDir})`); if (!app.db.all('users').some((u) => u.role === 'super_admin')) console.warn('[warn] No super administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (or DEMO_DATA=1 for a demo) and restart.'); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
