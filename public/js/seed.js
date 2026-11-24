// Seed data. seedBase(): the 55 tenant spaces + continental space (+ super admin on request).
// seedDemo(): clearly-labelled SYNTHETIC people and learning activity so dashboards are populated.
import { COUNTRIES, PILOTS } from './countries.js';
import { CONTINENTAL, issueCert, FACILITY_TYPES, PROFESSIONS, AGE_BANDS, DAY, audit, xapi } from './core.js';
import { mulberry32 } from './core.js';

export function seedBase(db, env, { admin } = {}) {
  if (!db.get('tenants', CONTINENTAL)) db.put('tenants', { id: CONTINENTAL, name: 'Africa CDC', status: 'live', languages: ['en', 'fr'], createdAt: env.now() });
  for (const [code, name] of COUNTRIES) if (!db.get('tenants', code)) db.put('tenants', { id: code, name, status: 'provisioned', pilot: PILOTS.includes(code), languages: ['en', 'fr'], createdAt: env.now() });
  let sa = null;
  if (admin && !db.all('users').some(u => u.role === 'super_admin')) { sa = { id: env.uid('u'), tenant: CONTINENTAL, facility: null, role: 'super_admin', name: admin.name || 'Africa CDC Administrator', email: admin.email.toLowerCase(), phone: '', sex: 'X', ageBand: null, profession: 'public_health', lang: 'en', pw: env.hashPassword(admin.password), mustChange: !!admin.mustChange, createdAt: env.now(), disabled: false }; db.put('users', sa); audit({ db, env, user: sa }, 'system.bootstrap', sa.id); }
  return sa;
}

const FIRST = { F: ['Aminetou', 'Fatima', 'Mariam', 'Khadija', 'Esperance', 'Claudine', 'Josiane', 'Aicha', 'Nadine', 'Aline', 'Grace', 'Sarah', 'Hawa', 'Chantal', 'Rose', 'Beatrice', 'Zainab', 'Salimata'], M: ['Mohamed', 'Seydou', 'Ibrahim', 'Cheikh', 'Jean-Pierre', 'Emmanuel', 'Prosper', 'Gaspard', 'Moussa', 'David', 'Samuel', 'Oumar', 'Abdoulaye', 'Evariste', 'Joseph', 'Pascal', 'Boubacar', 'Daniel'] };
const LAST = ['Ould Brahim', 'Sow', 'Diallo', 'Ndayishimiye', 'Niyonkuru', 'Nzeyimana', 'Bangui', 'Yakoité', 'Mbaïkoua', 'Kane', 'Ba', 'Fall', 'Mahamat', 'Habimana', 'Ouedraogo', 'Mensah', 'Banda', 'Njoroge', 'Camara', 'Ahmed', 'Traoré', 'Koné', 'Nkurunziza', 'Zoungrana'];
const REGIONS = { MR: ['Nouakchott', 'Hodh Ech Chargui', 'Assaba', 'Gorgol', 'Trarza'], CF: ['Bangui', 'Ombella-M’Poko', 'Lobaye', 'Ouham', 'Nana-Mambéré'], BI: ['Bujumbura', 'Gitega', 'Ngozi', 'Kayanza', 'Makamba'], SN: ['Dakar', 'Thiès', 'Saint-Louis', 'Kaolack'], RW: ['Kigali', 'Northern', 'Southern', 'Western'], KE: ['Nairobi', 'Kisumu', 'Mombasa', 'Nakuru'], GH: ['Greater Accra', 'Ashanti', 'Northern', 'Volta'], ZM: ['Lusaka', 'Copperbelt', 'Southern', 'Eastern'], MG: ['Analamanga', 'Atsinanana', 'Boeny', 'Vakinankaratra'], CI: ['Abidjan', 'Bouaké', 'Korhogo', 'Daloa'] };
const FT_W = [['health_post', 4], ['health_centre', 5], ['community', 2], ['district_hospital', 2], ['referral_hospital', 1], ['admin_office', 1], ['laboratory', 1]];
const PR_W = [['nurse', 6], ['midwife', 3], ['clinical_officer', 2], ['physician', 1.5], ['chw', 4], ['pharmacist', 1], ['lab_tech', 1.2], ['data_officer', 2], ['public_health', 1.5], ['other', 1]];
const AG_W = [['<25', 1.2], ['25-34', 4], ['35-44', 3.2], ['45-54', 1.6], ['55+', .6]];
const pick = (rnd, w) => { const t = w.reduce((a, x) => a + x[1], 0); let r = rnd() * t; for (const [v, k] of w) { if ((r -= k) <= 0) return v; } return w[0][0]; };

export function seedDemo(db, env, starter, { scale = 1 } = {}) {
  const rnd = mulberry32(20261124), now = env.now(), cur = starter.cur, mods = cur.modules;
  const plan = [['MR', 90, 14, 'pilot'], ['CF', 70, 10, 'pilot'], ['BI', 80, 12, 'pilot'], ['SN', 36, 7, 'live'], ['RW', 34, 7, 'live'], ['KE', 30, 6, 'live'], ['GH', 24, 6, 'live'], ['ZM', 18, 5, 'live'], ['MG', 14, 5, 'live'], ['CI', 10, 4, 'live']];
  const pwh = env.hashPassword('Demo#2026'); const out = { tenants: {} };
  const mk = (o) => { const u = { id: env.uid('u'), facility: null, phone: '', sex: 'X', ageBand: null, profession: 'other', lang: 'en', pw: pwh, mustChange: false, createdAt: now - 300 * DAY, disabled: false, demo: true, ...o }; db.put('users', u); return u; };
  const sa = mk({ tenant: CONTINENTAL, role: 'super_admin', name: 'Dr. Demo Continental', email: 'super@demo.africacdc.example', profession: 'public_health' });
  for (const [code, n0, nf0, status] of plan) {
    const n = Math.round(n0 * scale), nf = Math.max(3, Math.round(nf0 * scale)), t = db.get('tenants', code); t.status = status; db.put('tenants', t);
    const regs = REGIONS[code] || ['Capital', 'North', 'South', 'East']; const facs = [];
    for (let i = 0; i < nf; i++) { const type = pick(rnd, FT_W), [, , la, lo] = COUNTRIES.find(c => c[0] === code); const f = { id: env.uid('f'), tenant: code, name: `${regs[i % regs.length]} ${({ health_post: 'Health Post', health_centre: 'Health Centre', community: 'Community Site', district_hospital: 'District Hospital', referral_hospital: 'Referral Hospital', admin_office: 'District Office', laboratory: 'Laboratory' })[type]} ${i + 1}`, type, region: regs[i % regs.length], lat: la + (rnd() - .5) * 5, lon: lo + (rnd() - .5) * 5, createdAt: now - 320 * DAY }; db.put('facilities', f); facs.push(f); }
    const email = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    const ms = mk({ tenant: code, role: 'ms_admin', name: `Admin ${db.get('tenants', code).name}`, email: `admin.${code.toLowerCase()}@demo.africacdc.example`, profession: 'public_health', lang: ['MR', 'CF', 'BI', 'SN', 'CI', 'MG'].includes(code) ? 'fr' : 'en' });
    const fa = mk({ tenant: code, role: 'facility_admin', facility: facs[0].id, name: `Facility Lead ${code}`, email: `facility.${code.toLowerCase()}@demo.africacdc.example`, profession: 'nurse' });
    const tr = mk({ tenant: code, role: 'trainer', facility: facs[1 % facs.length].id, name: `Trainer ${code}`, email: `trainer.${code.toLowerCase()}@demo.africacdc.example`, profession: 'public_health' });
    const cohort = { id: env.uid('h'), tenant: code, facility: null, name: `${code} Cohort 1`, trainer: tr.id, members: [], createdAt: now - 200 * DAY }; const learners = [];
    const engagement = status === 'pilot' ? 0.72 : 0.5;
    for (let i = 0; i < n; i++) {
      const sex = rnd() < 0.58 ? 'F' : 'M', f = facs[Math.floor(rnd() * facs.length)], nm = `${FIRST[sex][Math.floor(rnd() * FIRST[sex].length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
      const u = mk({ tenant: code, role: 'learner', facility: f.id, name: nm, email: `${email(nm)}.${code.toLowerCase()}${i}@demo.africacdc.example`, sex, ageBand: pick(rnd, AG_W), profession: pick(rnd, PR_W), lang: ['MR', 'CF', 'BI', 'SN', 'CI', 'MG'].includes(code) ? 'fr' : 'en' }); learners.push(u); cohort.members.push(u.id);
      if (rnd() > engagement) continue; // never started
      const r = rnd(); const k = r < .30 ? 0 : r < .62 ? 1 + Math.floor(rnd() * 5) : r < .86 ? 6 + Math.floor(rnd() * 10) : r < .96 ? 16 + Math.floor(rnd() * 5) : 21;
      const start = now - Math.floor((20 + rnd() * 240) * DAY); let t0 = start;
      for (let j = 0; j < Math.min(21, k + (k < 21 ? 1 : 0)); j++) {
        const m = mods[j], done = j < k; t0 += Math.floor((1 + rnd() * 9) * DAY); if (t0 > now) t0 = now - Math.floor(rnd() * 5 * DAY);
        const e = { id: `${u.id}:${m.id}`, user: u.id, tenant: code, facility: f.id, course: m.id, lessons: done ? [0, 1, 2].slice(0, starter.modules[m.id].lessons.length).map((_, x) => x) : [0], activity: done, status: done ? 'completed' : 'in_progress', best: done ? Math.round(70 + rnd() * 30) : null, fails: done && rnd() < .15 ? 1 : 0, startedAt: t0 - 2 * DAY, lastAt: t0, completedAt: done ? t0 : null };
        if (!done && rnd() < .6) e.lastAt = now - Math.floor(rnd() * 25 * DAY); db.put('enrol', e);
        if (done) db.put('ceu', { id: `${u.id}:${m.id}`, user: u.id, tenant: code, ref: m.id, kind: 'module', title: m.title, ceu: m.ceu, at: t0, status: 'approved' });
      }
      const ctx = { db, env: { ...env, now: () => t0 }, user: u };
      for (const lv of [1, 2, 3, 4]) { const ids = mods.filter(m => m.level === lv).map(m => m.n - 1); if (ids.every(ix => ix < k)) { const lvl = cur.levels[lv - 1]; issueCert(ctx, u, { scope: `level-${lv}`, type: 'member_state', title: { en: `Digital Literacy — ${lvl.title.en}`, fr: `Littératie numérique — ${lvl.title.fr}` }, ceu: mods.filter(m => m.level === lv).reduce((a, m) => a + m.ceu, 0) }); } }
      if (k === 21 && rnd() < .8) { db.put('enrol', { id: `${u.id}:final`, user: u.id, tenant: code, facility: f.id, course: 'final', lessons: [], status: 'completed', best: Math.round(72 + rnd() * 25), fails: 0, startedAt: t0, lastAt: t0, completedAt: t0 }); db.put('ceu', { id: `${u.id}:final`, user: u.id, tenant: code, ref: 'final', kind: 'exam', title: cur.exam.title, ceu: cur.exam.ceu, at: t0, status: 'approved' }); issueCert(ctx, u, { scope: 'full', type: 'accredited', title: { en: 'Africa CDC Digital Literacy Certification — Primary Health Care', fr: 'Certification Africa CDC en littératie numérique — Soins de santé primaires' }, ceu: 30 }); }
    }
    db.put('cohorts', cohort); out.tenants[code] = { learners: n, facilities: nf };
  }
  // two hand-held demo learners
  const mr = db.all('facilities').filter(f => f.tenant === 'MR'); const fresh = mk({ tenant: 'MR', role: 'learner', facility: mr[0].id, name: 'Aminetou Demo (new learner)', email: 'learner@demo.africacdc.example', sex: 'F', ageBand: '25-34', profession: 'nurse', lang: 'fr' });
  const near = mk({ tenant: 'MR', role: 'learner', facility: mr[1].id, name: 'Seydou Demo (ready for exam)', email: 'exam@demo.africacdc.example', sex: 'M', ageBand: '35-44', profession: 'clinical_officer', lang: 'en' });
  mods.forEach((m) => { const t = now - (30 - m.n) * DAY; db.put('enrol', { id: `${near.id}:${m.id}`, user: near.id, tenant: 'MR', facility: mr[1].id, course: m.id, lessons: starter.modules[m.id].lessons.map((_, i) => i), activity: true, status: 'completed', best: 88, fails: 0, startedAt: t - DAY, lastAt: t, completedAt: t }); db.put('ceu', { id: `${near.id}:${m.id}`, user: near.id, tenant: 'MR', ref: m.id, kind: 'module', title: m.title, ceu: m.ceu, at: t, status: 'approved' }); });
  audit({ db, env, user: sa }, 'system.demo_seed', 'demo', { learners: db.all('users').filter(u => u.role === 'learner').length });
  return out;
}
