// Verifies locale coverage: every key used in the UI exists in en.json, and every other locale has the same keys.
// Usage: node scripts/check-i18n.js
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../public/', import.meta.url), read = (p) => readFileSync(new URL(p, dir), 'utf8');
const src = readdirSync(new URL('js/', dir)).filter((f) => f.endsWith('.js')).map((f) => read('js/' + f)).join('\n');
const used = new Set([...src.matchAll(/\bt\('([a-zA-Z_][a-zA-Z0-9_.]*)'/g)].map((m) => m[1]).filter((k) => k.includes('.') && !k.endsWith('.') && !k.endsWith('_')));
// keys built dynamically: prefix + enumeration
const dyn = { 'ceu.kind_': ['module', 'course', 'exam', 'external'], 'ceu.st_': ['approved', 'pending', 'rejected'], 'status.t_': ['provisioned', 'pilot', 'live', 'suspended'], 'dash.m_': ['coverage', 'enrolRate', 'utilization'],
  'exp.c_': ['users', 'ceu', 'enrolments', 'certificates'], 'verify.': ['valid', 'revoked', 'expired', 'tampered', 'unknown'], 'wf.': ['draft', 'in_review', 'approved', 'published'], 'vis.': ['private', 'shared', 'continental'],
  'check.': ['competency', 'accuracy', 'accessibility', 'branding'], 'ft.': ['health_post', 'health_centre', 'district_hospital', 'referral_hospital', 'community', 'admin_office', 'laboratory'],
  'prof.': ['nurse', 'midwife', 'clinical_officer', 'physician', 'chw', 'pharmacist', 'lab_tech', 'data_officer', 'public_health', 'other'], 'sex.': ['F', 'M', 'X'],
  'role.': ['super_admin', 'ms_admin', 'facility_admin', 'trainer', 'learner'], 'nav.': ['home', 'learn', 'exam', 'ceu', 'certs', 'offline', 'dash', 'users', 'facilities', 'cohorts', 'tenants', 'author', 'audit', 'exports', 'verify', 'account'] };
for (const [p, vs] of Object.entries(dyn)) vs.forEach((v) => used.add(p + v));
const locales = JSON.parse(read('locales/index.json')); const dicts = Object.fromEntries(Object.keys(locales).map((c) => [c, JSON.parse(read(`locales/${c}.json`))]));
let bad = 0; const en = dicts.en;
for (const k of used) if (!(k in en)) { console.log('MISSING in en:', k); bad++; }
for (const [c, d] of Object.entries(dicts)) { if (c === 'en') continue;
  for (const k of Object.keys(en)) { if (!(k in d)) { console.log(`MISSING in ${c}:`, k); bad++; } else { const a = (en[k].match(/\{\w+\}/g) || []).sort().join(), b = (d[k].match(/\{\w+\}/g) || []).sort().join(); if (a !== b) { console.log(`PLACEHOLDER mismatch in ${c}:`, k); bad++; } } }
  for (const k of Object.keys(d)) if (!(k in en)) { console.log(`EXTRA in ${c}:`, k); bad++; } }
const unused = Object.keys(en).filter((k) => !used.has(k) && !/^err\./.test(k)); if (unused.length && process.argv.includes('--unused')) console.log('unused:', unused.join(' '));
console.log(bad ? `FAIL: ${bad} problem(s)` : `OK: ${used.size} keys used, ${Object.keys(en).length} defined, locales: ${Object.keys(dicts).join(', ')}`); process.exit(bad ? 1 : 0);
