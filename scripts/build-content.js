// Validates the curriculum and writes public/data/*.json. Run: node scripts/build-content.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODULES, LEVELS, EXAM, POLICY } from '../content/index.js';

const out = new URL('../public/data/', import.meta.url);
mkdirSync(new URL('modules/', out), { recursive: true });
const errs = [];
const chk = (v, p) => {
  if (v && typeof v === 'object' && 'en' in v && 'fr' in v) {
    for (const l of ['en', 'fr']) if (typeof v[l] !== 'string' || !v[l].trim()) errs.push(`${p}.${l} empty`);
  } else if (Array.isArray(v)) v.forEach((x, i) => chk(x, `${p}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) chk(v[k], `${p}.${k}`);
};
const LV_EXPECT = { 1: 6.75, 2: 4.25, 3: 8.5, 4: 7.0 };
const lv = { 1: 0, 2: 0, 3: 0, 4: 0 };
let total = 0, nq = 0;
MODULES.forEach((m, i) => {
  if (m.n !== i + 1) errs.push(`${m.id} out of order`);
  chk(m, m.id);
  if (m.lessons.length < 3) errs.push(`${m.id} needs >=3 lessons`);
  if (m.quiz.length < 7) errs.push(`${m.id} needs >=7 quiz items`);
  m.quiz.forEach((q, j) => {
    const opts = [q.c.en, ...q.w.map(w => w.en)];
    if (new Set(opts).size !== 3) errs.push(`${m.id}.q${j} duplicate options`);
    nq++;
  });
  lv[m.level] += m.ceu; total += m.ceu;
});
for (const k in LV_EXPECT) if (Math.abs(lv[k] - LV_EXPECT[k]) > 1e-9) errs.push(`level ${k} CEU ${lv[k]} != ${LV_EXPECT[k]}`);
const grand = total + EXAM.ceu;
if (Math.abs(grand - 30) > 1e-9) errs.push(`total CEU ${grand} != 30`);
if (errs.length) { console.error('CONTENT ERRORS:\n' + errs.join('\n')); process.exit(1); }

const meta = MODULES.map(({ id, n, level, minutes, ceu, title, summary, outcomes }) => ({ id, n, level, minutes, ceu, title, summary, outcomes }));
writeFileSync(new URL('curriculum.json', out), JSON.stringify({ levels: LEVELS, modules: meta, exam: EXAM, policy: POLICY, totalCeu: grand }));
for (const m of MODULES) writeFileSync(new URL(`modules/${m.id}.json`, out), JSON.stringify(m));
// Exam pool = every module quiz item, tagged with module id (server draws a balanced paper).
writeFileSync(new URL('exam-pool.json', out), JSON.stringify(MODULES.flatMap(m => m.quiz.map((q, j) => ({ id: `${m.id}.${j}`, m: m.id, ...q })))));
console.log(`OK: ${MODULES.length} modules, ${nq} quiz items, ${grand} CEUs (levels ${JSON.stringify(lv)} + exam ${EXAM.ceu})`);
