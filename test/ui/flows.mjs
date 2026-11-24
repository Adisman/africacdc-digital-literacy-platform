// End-to-end UI checks against the static demo build. Usage: NODE_PATH=$(npm root -g) node test/ui/flows.mjs http://127.0.0.1:8099/
import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs'; const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); const base = process.argv[2] || 'http://127.0.0.1:8099/';
const m1 = JSON.parse(readFileSync(new URL('../../public/data/modules/m1.json', import.meta.url)));
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const b = await chromium.launch(); const errs = [];
const mk = async (w = 1280, h = 900) => { const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return { ctx, p }; };
const as = async (p, who) => { await p.goto(base); await p.waitForFunction(() => window.__ready); const id = await p.evaluate(async (w) => { const { api } = await import('./js/api.js'); return api.demoPersonas().find((x) => x.email.startsWith(w + '@')).id; }, who); await p.evaluate((i) => sessionStorage.setItem('dlp-demo-user', i), id); await p.reload(); await p.waitForFunction(() => window.__ready); };
const hash = async (p, r) => { await p.evaluate((r) => { location.hash = '#' + r; }, r); await p.waitForFunction(() => !document.querySelector('.skeleton')); await p.waitForTimeout(250); };

// 1 ── learner completes module 1 (lessons → activity → quiz) and earns CEU
{ const { ctx, p } = await mk(); await as(p, 'learner'); await hash(p, '/course/m1');
  for (let i = 0; i < 12 && !(await p.$('[data-act="quiz-start"]')); i++) { const nx = (await p.$('[data-act="lesson-next"]')) || (await p.$('[data-act="act-check"]')) || (await p.$('[data-act="next"]:not([disabled])')); if (!nx) { // activity: try until check enabled
      const checks = await p.$$('[data-act="act-sort"],select'); void checks; }
    if (await p.$('[data-act="act-check"]')) { await solveActivity(p); } else if (nx) await nx.click(); await p.waitForTimeout(150); if (await p.$('[data-act="next"]:not([disabled])')) await p.click('[data-act="next"]'); }
  ok(!!(await p.$('[data-act="quiz-start"]')), 'learner reaches quiz after lessons + activity');
  await p.click('[data-act="quiz-start"]'); await p.waitForSelector('.opt');
  const total = await p.$eval('body', () => 0); void total;
  for (let n = 0; n < 12; n++) { const q = (await p.$eval('#main', (m) => (m.querySelector('b,h3') || {}).textContent)) || ''; const opts = await p.$$eval('.opt', (e) => e.map((x) => x.textContent.trim())); if (!opts.length) break;
    const stem = await p.$eval('#main', (m) => [...m.querySelectorAll('h2,h3,b,p')].map((x) => x.textContent).join('|')); const item = m1.quiz.find((x) => stem.includes(x.q.en)); const want = item ? item.c.en : null; let idx = opts.findIndex((o) => o.includes(want || '\u0000')); if (idx < 0) idx = 0;
    await p.click(`.opt >> nth=${idx}`); const submit = await p.$('[data-act="quiz-submit"]:not([disabled])'); if (submit) { await submit.click(); break; } await p.click('[data-act="quiz-next"]'); }
  await p.waitForTimeout(400); const txt = await p.$eval('#main', (m) => m.textContent); ok(/Passed!/.test(txt), 'learner passes module 1 quiz'); await ctx.close(); }

// 2 ── authoring workflow: trainer drafts → admin reviews (four-eyes) → publish → share → other Member State sees it
{ const { ctx, p } = await mk(); await as(p, 'trainer.mr'); await hash(p, '/author'); await p.click('[data-act="au-new"]'); await p.fill('#at', 'Handwashing data tools'); await p.fill('#af', 'Outils de données'); await p.click('dialog button.btn:not(.ghost)'); await p.waitForSelector('[data-act="au-save"]');
  await p.fill('[data-path="lessons[0].title.en"]', 'Why data matters'); await p.fill('[data-path="lessons[0].body.en"]', 'Good data saves lives.\n\n- Collect\n- Check');
  for (let i = 0; i < 3; i++) { await p.click('[data-act="au-add"][data-k="quiz"]'); await p.waitForSelector(`[data-path="quiz[${i}].q.en"]`); await p.fill(`[data-path="quiz[${i}].q.en"]`, 'Question ' + i + '?'); await p.fill(`[data-path="quiz[${i}].c.en"]`, 'Right'); await p.fill(`[data-path="quiz[${i}].w[0].en"]`, 'Wrong A'); await p.fill(`[data-path="quiz[${i}].w[1].en"]`, 'Wrong B'); }
  await p.click('[data-act="au-save"]'); await p.waitForTimeout(400); await p.click('[data-act="au-act"][data-a="submit_review"]'); await p.waitForTimeout(500);
  ok(/In review/.test(await p.$eval('h1', (h) => h.textContent)), 'trainer submits course for review');
  const url = p.url(); const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(e.message)); await as(p2, 'admin.mr'); await p2.goto(url); await p2.waitForSelector('[data-form="au-review"]');
  for (const k of ['competency', 'accuracy', 'accessibility', 'branding']) await p2.check(`[name="chk_${k}"]`); await p2.fill('[name=ceu]', '0.5'); await p2.click('[data-d="approve"]'); await p2.waitForTimeout(500);
  ok(/Approved/.test(await p2.$eval('h1', (h) => h.textContent)), 'admin approves with all four checks');
  await p2.click('[data-act="au-act"][data-a="publish"]'); await p2.waitForTimeout(500); ok(/Published/.test(await p2.$eval('h1', (h) => h.textContent)), 'admin publishes');
  await p2.check('[data-form="au-share"] input[value="CF"]'); await p2.click('[data-form="au-share"] button.btn:not(.gold):not(.ghost)'); await p2.waitForTimeout(500);
  await p2.waitForTimeout(1200); ok(/Shared/.test(await p2.$eval('h1', (h) => h.textContent)), 'course shared with named partner (CAR)');
  await as(p2, 'admin.cf'); await hash(p2, '/learn'); await p2.click('[data-tab="library"]'); await p2.waitForTimeout(300); ok(/Handwashing data tools/.test(await p2.$eval('#main', (m) => m.textContent)), 'partner Member State sees the shared course in its library');
  await as(p2, 'admin.mr'); await hash(p2, '/cohorts'); await ctx.close(); }

// 3 ── French UI, no horizontal scroll on mobile, offline simulation
{ const { ctx, p } = await mk(390, 800); await as(p, 'learner'); await p.selectOption('select[data-chg="lang"]', 'fr'); await p.waitForTimeout(500);
  ok(/Bonjour/.test(await p.$eval('h1', (h) => h.textContent)), 'French UI after switching language');
  for (const r of ['/home', '/learn', '/ceu', '/certs', '/offline']) { await hash(p, r); const w = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(w <= 1, `no horizontal scroll on mobile ${r} (${w}px)`); }
  await p.selectOption('select[data-chg="lang"]', 'en'); await p.click('[data-act="toggle-offline"]'); await p.waitForTimeout(300); ok(/Offline/.test(await p.$eval('.sync', (s) => s.textContent)), 'offline simulation shows status'); await ctx.close(); }

// 4 ── public verification page needs no login
{ const { ctx, p } = await mk(); await p.goto(base + '#/verify/ACDC-ZZZZ-ZZZZ-ZZZZ'); await p.waitForFunction(() => window.__ready); await p.waitForSelector('.sbadge, .card'); await p.waitForTimeout(400); ok(/Unknown code/.test(await p.$eval('#main', (m) => m.textContent)), 'verify page works logged-out and rejects unknown codes'); await ctx.close(); }
console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors'); await b.close(); process.exit(fails || errs.length ? 1 : 0);

async function solveActivity(p) { // try every dropdown option / reorder until "Check" turns green, using the module JSON when possible
  const act = m1.activity; void act;
  const sels = await p.$$('select[data-act="act-pick"], select[data-chg], select'); void sels;
  for (let t = 0; t < 30; t++) { await p.click('[data-act="act-check"]'); await p.waitForTimeout(100); if (await p.$('.fb.ok')) break; const picks = await p.$$('select[data-act]'); for (const s of picks) { const n = await s.$$eval('option', (o) => o.length); void n; }
    const ups = await p.$$('[data-act="act-move"][data-d="1"]'); if (ups.length) { await ups[t % ups.length].click(); } else if (picks.length) { const s = picks[t % picks.length]; const n = (await s.$$eval('option', (o) => o.length)); await s.selectOption({ index: 1 + (t % (n - 1)) }); } }
}
