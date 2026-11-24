import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base); await p.waitForFunction(() => window.__ready); await p.waitForSelector('.persona');
const personas = await p.$$eval('.persona', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
console.log('personas', personas);
const routesFor = { 'learner': ['/home', '/learn', '/course/m1', '/exam', '/ceu', '/certs', '/offline', '/account'], 'admin.mr': ['/dash', '/users', '/facilities', '/cohorts', '/author', '/audit', '/exports', '/account'], 'super': ['/dash', '/tenants', '/users', '/facilities', '/author', '/audit', '/exports'], 'trainer.mr': ['/home', '/author', '/cohorts'], 'facility.mr': ['/dash', '/users', '/cohorts', '/exports'] };
for (const [who, routes] of Object.entries(routesFor)) {
  await p.goto(base); await p.waitForFunction(() => window.__ready); await p.evaluate(() => sessionStorage.clear()); await p.reload(); await p.waitForSelector('.persona');
  const idx = personas.findIndex((x, i) => true); // click by email via evaluate
  const id = await p.evaluate(async (w) => { const { api } = await import('./js/api.js'); const u = api.demoPersonas().find((x) => x.email.startsWith(w + '@')); return u && u.id; }, who);
  await p.evaluate((i) => sessionStorage.setItem('dlp-demo-user', i), id); await p.reload(); await p.waitForFunction(() => window.__ready);
  for (const r of routes) {
    await p.evaluate((r) => { location.hash = '#' + r; }, r); await p.waitForTimeout(400); await p.waitForFunction(() => !document.querySelector('.skeleton'), null, { timeout: 5000 }).catch(() => errs.push('STUCK ' + who + r));
    const h = await p.$eval('#main', (m) => (m.querySelector('h1') || m).textContent.trim().slice(0, 50)).catch(() => '?'); const err = await p.$$eval('#main .err', (e) => e.map((x) => x.textContent)).catch(() => []);
    console.log(who.padEnd(12), r.padEnd(14), h, err.length ? 'ERR:' + err : '');
  }
}
console.log(errs.length ? errs.join('\n') : 'no console errors'); await b.close();
