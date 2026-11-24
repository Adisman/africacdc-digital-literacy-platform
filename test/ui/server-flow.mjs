// Real-server UI flow: first admin login → MFA enrolment → forced password change → dashboard. Starts its own server.
import { createRequire } from 'node:module'; import { spawn } from 'node:child_process'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os';
import { totp } from '../../server/auth.js'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const dir = mkdtempSync(tmpdir() + '/dlp-'); const port = 8123, base = `http://127.0.0.1:${port}/`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: port, HOST: '127.0.0.1', DATA_DIR: dir, ADMIN_EMAIL: 'root@example.org', ADMIN_PASSWORD: 'Initial-Pass-2026!', ALLOW_LOCAL_KEYS: '1', QUIET: '1' }, stdio: 'ignore' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + 'healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const b = await chromium.launch(); const p = await (await b.newContext()).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base); await p.waitForFunction(() => window.__ready); ok(!(await p.$('.persona')), 'server mode shows credential login, not demo personas');
  await p.fill('#le', 'root@example.org'); await p.fill('#lp', 'wrong-password'); await p.click('form[data-form=login] button'); await p.waitForSelector('.err'); ok(/incorrect/.test(await p.textContent('.err')), 'wrong password is rejected');
  await p.fill('#lp', 'Initial-Pass-2026!'); await p.click('form[data-form=login] button'); await p.waitForSelector('[data-form="mfa-confirm"]'); ok(true, 'admin is forced into MFA enrolment');
  const secret = (await p.textContent('.mono')).trim(); await p.fill('#mc', totp(secret, Math.floor(Date.now() / 30000))); await p.click('[data-form="mfa-confirm"] button'); await p.waitForSelector('[data-act="codes-done"]'); ok(true, 'MFA confirmed, recovery codes shown');
  await p.click('[data-act="codes-done"]'); await p.waitForSelector('[data-form=pw]'); ok(true, 'temporary password forces a change');
  await p.fill('#pc', 'Initial-Pass-2026!'); await p.fill('#pn', 'Brand-New-Secret-77'); await p.fill('#pn2', 'Brand-New-Secret-77'); await p.click('[data-form=pw] button'); await p.waitForSelector('.kpis', { timeout: 8000 }); ok(true, 'dashboard opens after password change');
  const csp = (await fetch(base)).headers.get('content-security-policy') || ''; ok(/script-src 'self'/.test(csp), 'CSP forbids inline scripts');
  await p.click('[data-act="logout"]'); await p.waitForSelector('#le'); ok(true, 'sign out returns to login');
  ok(!errs.length, 'no page errors ' + errs.join(';')); await b.close();
} finally { srv.kill(); }
process.exit(fails ? 1 : 0);
