// Learner experience: dashboard, catalogue, course player, exam, CEU ledger, certificates, offline, verification.
import { html, raw, md, fmtDate, pct, toast, download } from './ui.js';
import { t, L, lang } from './i18n.js';
import { api } from './api.js';
import { S, ACT, FORM, INPUT, CHG, go, hooks } from './state.js';
import { ring } from './charts.js';
import { toSvg } from './qr.js';

const errText = (c) => t('err.' + c) !== 'err.' + c ? t('err.' + c) : t('err.generic');
export const levelOf = (n) => S.cur.levels[n - 1];
const statusChip = (s) => ({ completed: html`<span class="chip green">${t('status.completed')}</span>`, in_progress: html`<span class="chip gold">${t('status.in_progress')}</span>`, new: html`<span class="chip grey">${t('status.new')}</span>` })[s] || '';
const shuffle = (a, seed) => { let x = seed; const r = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// ───────── home ─────────
export async function home() {
  const s = S.summary, cur = S.cur, tot = cur.totalCeu, next = s.modules.find((m) => m.status !== 'completed');
  const nextM = next && cur.modules.find((m) => m.id === next.id);
  const lv = [1, 2, 3, 4].map((n) => { const ms = s.modules.filter((m) => m.level === n), done = ms.filter((m) => m.status === 'completed').length; return { n, ms, done, all: done === ms.length };
  });
  const ob = api.outbox().length;
  return html`
  <section class="hero">
    <div class="card dark"><h1 style="color:#fff">${t('home.hello', { name: S.user.name.split(' ')[0] })}</h1>
      <p>${S.tenant ? S.tenant.name : ''} ${S.facility ? '· ' + S.facility.name : ''}</p>
      ${nextM ? html`<p>${t('home.next')}</p><h2 style="color:var(--gold)">${nextM.n}. ${L(nextM.title)}</h2><p>${L(nextM.summary)}</p><a class="btn gold" href="#/course/${nextM.id}">${next.status === 'in_progress' ? t('home.continue') : t('home.start')} →</a>`
        : s.examStatus !== 'completed' ? html`<h2 style="color:var(--gold)">${t('home.exam_ready')}</h2><a class="btn gold" href="#/exam">${t('home.take_exam')} →</a>` : html`<h2 style="color:var(--gold)">🎓 ${t('home.certified')}</h2><a class="btn gold" href="#/certs">${t('nav.certs')} →</a>`}
    </div>
    <div class="card"><div class="row" style="flex-wrap:nowrap">${ring((s.ceuTotal / tot) * 100, raw(`<span style="font-size:1.5rem">${s.ceuTotal}</span><small>/ ${tot} CEU</small>`))}
      <div><h3>${t('home.ceu_title')}</h3><p class="small muted">${t('home.renewal', { n: s.renewalTarget })}</p><div class="bar gold" aria-label="${t('home.renewal_progress')}"><i style="width:${Math.min(100, (s.ceuRecent / s.renewalTarget) * 100)}%"></i></div><p class="small">${s.ceuRecent} / ${s.renewalTarget} CEU (24 ${t('common.months')})</p></div></div>
      ${ob ? html`<p class="banner" style="margin:10px 0 0">⏳ ${t('offline.pending', { n: ob })}</p>` : ''}</div>
  </section>
  <h2 style="margin-top:24px">${t('home.path')}</h2>
  ${lv.map((z) => html`<div class="zone ${z.all ? 'done' : ''}"><div class="row between"><b>${L(levelOf(z.n).title)}</b><span class="chip ${z.all ? 'gold' : ''}">${z.done}/${z.ms.length}</span></div>
    <div class="nodes">${z.ms.map((m, i) => html`${i ? html`<span class="link ${m.status === 'completed' ? 'done' : ''}"></span>` : ''}<a class="node ${m.status === 'completed' ? 'done' : m.id === (next && next.id) ? 'next' : ''}" style="display:grid;place-items:center;text-decoration:none" href="#/course/${m.id}" title="${L(cur.modules.find((x) => x.id === m.id).title)}" aria-label="${m.n}. ${L(cur.modules.find((x) => x.id === m.id).title)} — ${t('status.' + m.status)}">${m.n}</a>`)}</div></div>`)}
  <div class="zone ${s.examStatus === 'completed' ? 'done' : ''}"><div class="row between"><b>🎓 ${L(cur.exam.title)}</b><span class="chip ${s.examStatus === 'completed' ? 'gold' : 'grey'}">${s.examStatus === 'completed' ? t('status.completed') : s.examEligible ? t('home.unlocked') : t('home.locked', { n: 21 - s.completed })}</span></div>
    <p class="small muted">${L(cur.exam.summary)}</p>${s.examEligible && s.examStatus !== 'completed' ? html`<a class="btn" href="#/exam">${t('home.take_exam')}</a>` : ''}</div>`;
}

// ───────── catalogue ─────────
export async function learn(tab = 'starter') {
  const r = await api.call('GET', '/api/courses'); const { starter, library } = r.body, cur = S.cur;
  S.catalog = r.body;
  return html`<h1>${t('nav.learn')}</h1>
  <div class="tabs" role="tablist"><button role="tab" aria-selected="${tab === 'starter'}" data-act="tab" data-tab="starter">${t('learn.starter')}</button><button role="tab" aria-selected="${tab === 'library'}" data-act="tab" data-tab="library">${t('learn.library')} (${library.length})</button></div>
  ${tab === 'starter' ? [1, 2, 3, 4].map((n) => html`<h2>${L(levelOf(n).title)}</h2><p class="muted small">${L(levelOf(n).blurb)}</p><div class="grid g3">${starter.filter((m) => m.level === n).map((m) => html`<div class="card mod ${m.status === 'completed' ? 'done' : ''}"><div class="row"><div class="num">${m.n}</div><div><b>${L(m.title)}</b><div class="small muted">${m.minutes} min · ${m.ceu} CEU</div></div></div><p class="small">${L(m.summary)}</p><div class="row between">${statusChip(m.status)}<a class="btn sm" href="#/course/${m.id}">${m.status === 'completed' ? t('learn.review') : m.status === 'in_progress' ? t('home.continue') : t('home.start')}</a></div></div>`)}</div>`)
    : html`${library.length ? html`<div class="grid g3">${library.map((c) => html`<div class="card mod"><b>${L(c.title)}</b><div class="small muted">${c.minutes} min · ${c.ceu} CEU</div><p class="small">${L(c.summary)}</p><div class="row between"><span class="chip ${c.visibility === 'continental' ? 'gold' : ''}">${c.visibility === 'continental' ? '🌍 ' + t('learn.continental') : c.owner}</span><a class="btn sm" href="#/course/${c.id}">${c.status === 'completed' ? t('learn.review') : t('home.start')}</a></div></div>`)}</div>` : html`<div class="card"><p>${t('learn.library_empty')}</p></div>`}`}`;
}
ACT.tab = (el) => { S.tab = el.dataset.tab; hooks.render(); };

// ───────── course player ─────────
const P = { id: null, course: null, enrol: null, step: 0, quiz: null, result: null, act: null, preview: false };
const stepsOf = (c) => ['intro', ...c.lessons.map((_, i) => 'l' + i), ...(c.activity ? ['activity'] : []), 'quiz', 'done'];
export async function course(id, previewCourse) {
  if (P.id !== id || previewCourse) {
    let c, e = null;
    if (previewCourse) { c = previewCourse; }
    else {
      const pk = api.packages()[id];
      if (api.offline && pk) c = pk.course;
      else { const r = await api.call('GET', '/api/courses/' + id); if (r.status === 200) { c = r.body.course; e = r.body.enrol; } else if (pk) c = pk.course; else return html`<div class="card"><h2>${t('err.not_found')}</h2><a class="btn" href="#/learn">${t('nav.learn')}</a></div>`; }
    }
    Object.assign(P, { id, course: c, enrol: e, step: 0, quiz: null, result: null, act: null, preview: !!previewCourse });
    const st = stepsOf(c); if (e && e.lessons.length) P.step = Math.min(e.lessons.length, c.lessons.length) < c.lessons.length ? 1 + e.lessons.length : st.indexOf('quiz') >= 0 ? st.indexOf(e.status === 'completed' ? 'done' : 'quiz') : 0;
  }
  const c = P.course, steps = stepsOf(c), cur = steps[P.step] || 'intro', read = (i) => (P.enrol ? P.enrol.lessons : []).includes(i);
  const nav = html`<div class="stepper" role="list">${steps.map((s, i) => html`<button role="listitem" class="${i < P.step ? 'done' : i === P.step ? 'cur' : ''}" data-act="step" data-i="${i}" aria-label="${i + 1}/${steps.length}" ${i > P.step && !P.preview ? 'disabled' : ''}></button>`)}</div>`;
  let body;
  if (cur === 'intro') body = html`<h1>${L(c.title)}</h1><p class="muted">${c.minutes} min · ${c.ceu} CEU${c.level ? ' · ' + L(levelOf(c.level).title) : ''}</p><p>${L(c.summary)}</p>
    ${(c.outcomes || []).length ? html`<h3>${t('course.outcomes')}</h3><ul>${c.outcomes.map((o) => html`<li>${L(o)}</li>`)}</ul>` : ''}
    <p class="small muted">${t('course.flow', { n: c.lessons.length })}</p><button class="btn" data-act="next">${t('home.start')} →</button>`;
  else if (cur[0] === 'l') { const i = +cur.slice(1), l = c.lessons[i]; body = html`<div class="small muted">${t('course.lesson', { i: i + 1, n: c.lessons.length })}</div><h2>${L(l.title)}</h2><div class="lesson lessonbody">${md(L(l.body))}</div>${(l.key || []).length ? html`<div class="key"><b>💡 ${t('course.key')}</b><ul>${l.key.map((k) => html`<li>${L(k)}</li>`)}</ul></div>` : ''}<div class="row between" style="margin-top:16px"><button class="btn ghost" data-act="prev">← ${t('common.back')}</button><button class="btn" data-act="lesson-next" data-i="${i}">${read(i) || P.preview ? t('common.next') : t('course.mark_read')} →</button></div>`; }
  else if (cur === 'activity') body = activityView(c.activity);
  else if (cur === 'quiz') body = quizView();
  else body = doneView();
  const off = api.offline ? html`<p class="banner">📴 ${t('offline.banner')}</p>` : '';
  return html`${P.preview ? html`<p class="banner">👁 ${t('author.preview_note')}</p>` : ''}${off}<div class="card">${nav}${body}</div>`;
}
ACT.step = (el) => { P.step = +el.dataset.i; hooks.render(); };
ACT.next = () => { P.step++; hooks.render(); };
ACT.prev = () => { P.step = Math.max(0, P.step - 1); hooks.render(); };
ACT['lesson-next'] = async (el) => {
  const i = +el.dataset.i; if (!P.preview && !(P.enrol && P.enrol.lessons.includes(i))) { const r = await api.call('POST', '/api/progress', { course: P.id, lesson: i }); if (r.status === 200) P.enrol = r.body.enrol; else if (r.status === 202) P.enrol = { ...(P.enrol || { lessons: [] }), lessons: [...new Set([...(P.enrol ? P.enrol.lessons : []), i])] }; }
  P.step++; hooks.render(); window.scrollTo(0, 0);
};
// activities (accessible: buttons/selects, no drag-and-drop)
function activityView(a) {
  const A = P.act || (P.act = { checked: false, ok: null, state: null });
  if (!A.state) {
    const seed = hash(P.id + S.user.id);
    if (a.type === 'match') A.state = { opts: shuffle(a.pairs.map((_, i) => i), seed), pick: a.pairs.map(() => -1) };
    else if (a.type === 'order') A.state = { order: shuffle(a.steps.map((_, i) => i), seed) };
    else A.state = { put: a.items.map(() => -1) };
  }
  const st = A.state; let inner;
  if (a.type === 'match') inner = a.pairs.map((p, i) => html`<div class="pair ${A.checked ? (st.pick[i] === i ? 'ok' : 'bad') : ''}"><div><b>${L(p.left)}</b></div><select class="f" data-chg="act-pick" data-i="${i}" aria-label="${L(p.left)}"><option value="-1">— ${t('act.choose')} —</option>${st.opts.map((j) => html`<option value="${j}" ${st.pick[i] === j ? 'selected' : ''}>${L(a.pairs[j].right)}</option>`)}</select></div>`);
  else if (a.type === 'order') inner = html`<p class="small muted">${t('act.order_hint')}</p>${st.order.map((j, pos) => html`<div class="rowline ${A.checked ? (j === pos ? 'ok' : 'bad') : ''}"><span class="chip">${pos + 1}</span><span class="grow">${L(a.steps[j])}</span><button class="iconbtn" data-act="act-move" data-pos="${pos}" data-d="-1" aria-label="${t('act.up')}" ${pos === 0 ? 'disabled' : ''}>↑</button><button class="iconbtn" data-act="act-move" data-pos="${pos}" data-d="1" aria-label="${t('act.down')}" ${pos === st.order.length - 1 ? 'disabled' : ''}>↓</button></div>`)}`;
  else inner = a.items.map((it, i) => html`<div class="rowline ${A.checked ? (st.put[i] === it.bucket ? 'ok' : 'bad') : ''}"><span class="grow">${L(it.text)}</span>${a.buckets.map((b, k) => html`<button class="iconbtn" style="min-width:90px" aria-pressed="${st.put[i] === k}" data-act="act-sort" data-i="${i}" data-k="${k}">${L(b)}</button>`)}</div>`);
  return html`<h2>${t('act.title')}</h2><p>${L(a.prompt)}</p>${inner}${A.checked ? html`<div class="fb ${A.ok ? 'ok' : 'bad'}">${A.ok ? '✅ ' + t('act.right') : '🔁 ' + t('act.retry')}</div>` : ''}
  <div class="row between" style="margin-top:14px"><button class="btn ghost" data-act="prev">← ${t('common.back')}</button><div class="row"><button class="btn gold" data-act="act-check">${t('act.check')}</button><button class="btn" data-act="next" ${A.checked ? '' : 'disabled'}>${t('common.next')} →</button></div></div>`;
}
CHG['act-pick'] = (el) => { P.act.state.pick[+el.dataset.i] = +el.value; P.act.checked = false; };
ACT['act-move'] = (el) => { const o = P.act.state.order, p = +el.dataset.pos, d = +el.dataset.d; [o[p], o[p + d]] = [o[p + d], o[p]]; P.act.checked = false; hooks.render(); };
ACT['act-sort'] = (el) => { P.act.state.put[+el.dataset.i] = +el.dataset.k; P.act.checked = false; hooks.render(); };
ACT['act-check'] = async () => {
  const a = P.course.activity, st = P.act.state; P.act.ok = a.type === 'match' ? st.pick.every((p, i) => p === i) : a.type === 'order' ? st.order.every((j, p) => j === p) : st.put.every((k, i) => k === a.items[i].bucket);
  P.act.checked = true; if (!P.preview) api.call('POST', '/api/progress', { course: P.id, activity: true }); hooks.render();
};

// quiz
function quizView() {
  const c = P.course, q = P.quiz, e = P.enrol || { lessons: [] };
  if (!q) {
    const locked = P.enrol && P.enrol.fails >= 3, need = c.lessons.length - Math.min(c.lessons.length, e.lessons.length);
    if (P.preview) return html`<h2>${t('quiz.title')}</h2><p>${t('author.quiz_preview', { n: c.quiz ? c.quiz.length : c.quizCount })}</p>`;
    return html`<h2>${t('quiz.title')}</h2><p>${t('quiz.intro', { n: c.quizCount, p: 70 })}</p>${need > 0 ? html`<p class="err">${t('err.finish_lessons_first')}</p>` : ''}${locked ? html`<p class="err">${t('err.locked_contact_trainer')}</p>` : ''}${P.enrol && P.enrol.status === 'completed' ? html`<p class="fb ok">✅ ${t('status.completed')} (${P.enrol.best}%)</p>` : ''}
    <div class="row between"><button class="btn ghost" data-act="prev">← ${t('common.back')}</button><button class="btn" data-act="quiz-start" ${need > 0 || locked ? 'disabled' : ''}>${t('quiz.start')}</button></div>`;
  }
  return runner(q, 'quiz');
}
export function runner(q, ns) {
  const i = q.idx, qu = q.questions[i], total = q.questions.length, answered = q.answers.filter((a) => a !== null).length;
  const timer = q.deadline ? html`<span class="chip maroon" id="timer" data-deadline="${q.deadline}">⏱ --:--</span>` : '';
  return html`<div class="row between"><div class="small muted">${t('quiz.q', { i: i + 1, n: total })}</div>${timer}</div><div class="bar" style="margin:6px 0 14px"><i style="width:${(answered / total) * 100}%"></i></div>
  <h3 style="font-size:1.2rem">${L(qu.q)}</h3><div role="radiogroup" aria-label="${L(qu.q)}">${qu.options.map((o, k) => html`<button class="opt" role="radio" aria-checked="${q.answers[i] === k}" style="${q.answers[i] === k ? 'border-color:var(--green);background:var(--tint)' : ''}" data-act="${ns}-pick" data-k="${k}">${L(o)}</button>`)}</div>
  <div class="row between" style="margin-top:12px"><button class="btn ghost" data-act="${ns}-prev" ${i === 0 ? 'disabled' : ''}>← ${t('common.back')}</button>${i < total - 1 ? html`<button class="btn" data-act="${ns}-next" ${q.answers[i] === null ? 'disabled' : ''}>${t('common.next')} →</button>` : html`<button class="btn gold" data-act="${ns}-submit" ${answered < total ? 'disabled' : ''}>${t('quiz.submit')} (${answered}/${total})</button>`}</div>`;
}
const wire = (ns, get, submit) => { ACT[ns + '-pick'] = (el) => { const q = get(); q.answers[q.idx] = +el.dataset.k; hooks.render(); }; ACT[ns + '-next'] = () => { get().idx++; hooks.render(); }; ACT[ns + '-prev'] = () => { get().idx--; hooks.render(); }; ACT[ns + '-submit'] = submit; };
ACT['quiz-start'] = async () => {
  const pk = api.packages()[P.id]; let r;
  if (api.offline) { if (pk && pk.attempt) r = { status: 200, body: pk.attempt }; else return toast(t('offline.need_package'), 'bad'); } else r = await api.call('POST', '/api/quiz/start', { course: P.id });
  if (r.status !== 200) return toast(errText(r.body.error), 'bad');
  P.quiz = { attemptId: r.body.attemptId, questions: r.body.questions, answers: r.body.questions.map(() => null), idx: 0, offline: api.offline }; hooks.render();
};
wire('quiz', () => P.quiz, async () => {
  const r = await api.call('POST', '/api/quiz/submit', { attemptId: P.quiz.attemptId, answers: P.quiz.answers });
  if (r.status === 202) { P.result = { queued: true }; P.quiz.questions = P.quiz.questions; const all = api.packages(); if (all[P.id]) { all[P.id].attempt = null; localStorage.setItem('dlp-offline-pkgs', JSON.stringify(all)); } }
  else if (r.status !== 200) return toast(errText(r.body.error), 'bad'); else { P.result = r.body; P.enrol = { ...(P.enrol || {}), status: r.body.passed ? 'completed' : 'in_progress', fails: r.body.passed ? 0 : 3 - r.body.failsLeft, best: r.body.score, lessons: (P.enrol || { lessons: [] }).lessons }; await hooks.refreshMe(); }
  P.step = stepsOf(P.course).indexOf('done'); hooks.render(); window.scrollTo(0, 0);
});
export function resultView(r, q, { retry, ns }) {
  if (r.queued) return html`<h2>📴 ${t('offline.saved')}</h2><p>${t('offline.saved_msg')}</p><a class="btn" href="#/offline">${t('nav.offline')}</a>`;
  return html`<div class="card ${r.passed ? 'tint' : ''}" style="text-align:center"><div style="font-size:3rem">${r.passed ? '🎉' : '💪'}</div><h2>${r.passed ? t('quiz.passed') : t('quiz.failed')}</h2><div class="stat">${r.score}%</div><p class="muted">${t('quiz.result', { r: r.right, n: r.total, p: r.passMark })}</p>
    ${r.ceuAwarded ? html`<p class="chip gold">+${r.ceuAwarded} CEU</p>` : ''}${r.certificates && r.certificates.length ? html`<p>${r.certificates.map((c) => html`<a class="btn gold sm" href="#/cert/${c}">🎓 ${t('cert.view')}</a> `)}</p>` : ''}
    ${!r.passed ? html`<p>${r.locked ? html`<b class="err">${t('err.locked_contact_trainer')}</b>` : t('quiz.left', { n: r.failsLeft })}</p>${r.locked ? '' : html`<button class="btn" data-act="${ns}-retry">${t('quiz.retry')}</button>`}` : ''}</div>
    <h3 style="margin-top:16px">${t('quiz.review')}</h3>${q.questions.map((qu, i) => { const res = r.results[i]; return html`<div class="zone ${res.correct ? '' : ''}" style="border-color:${res.correct ? 'var(--green)' : 'var(--maroon)'}"><b>${i + 1}. ${L(qu.q)}</b><p class="small">${res.correct ? '✅' : '❌'} ${t('quiz.yours')}: ${L(qu.options[q.answers[i]] || '')}${res.correct ? '' : html`<br>✔ ${t('quiz.correct')}: <b>${L(qu.options[res.correctIdx])}</b>`}</p><p class="small muted">${L(res.why)}</p></div>`; })}`;
}
function doneView() {
  const c = P.course, r = P.result;
  if (P.preview) return html`<h2>${t('course.jobaid')}</h2>${jobAid(c)}`;
  return html`${r ? resultView(r, P.quiz, { ns: 'quiz' }) : P.enrol && P.enrol.status === 'completed' ? html`<div class="fb ok">✅ ${t('status.completed')} · ${P.enrol.best}%</div>` : html`<p>${t('course.finish_first')}</p>`}
  ${c.job ? html`<h3 style="margin-top:18px">${t('course.jobaid')}</h3>${jobAid(c)}` : ''}<div class="row" style="margin-top:14px"><a class="btn" href="#/learn">${t('nav.learn')}</a><button class="btn ghost" data-act="scorm" data-id="${c.id}">⬇ SCORM 1.2</button></div>`;
}
const jobAid = (c) => c.job ? html`<div class="key"><b>${L(c.job.title)}</b><ol>${c.job.steps.map((s) => html`<li>${L(s)}</li>`)}</ol><button class="btn sm ghost noprint" data-act="print">🖨 ${t('common.print')}</button></div>` : '';
ACT['quiz-retry'] = () => { P.quiz = null; P.result = null; P.step = stepsOf(P.course).indexOf('quiz'); hooks.render(); };
ACT.print = () => window.print();
ACT.scorm = async (el) => { const r = await api.call('GET', '/api/export/scorm/' + el.dataset.id); if (r.status !== 200) return toast(errText(r.body.error), 'bad'); download(r.body.filename, r.body.blob); };

// ───────── final exam ─────────
const X = { q: null, res: null };
export async function exam() {
  const s = S.summary, ex = S.cur.exam;
  if (X.res) return html`<div class="card">${resultView(X.res, X.q, { ns: 'exam' })}</div>`;
  if (X.q) return html`<div class="card"><h2>🎓 ${L(ex.title)}</h2>${runner(X.q, 'exam')}</div>`;
  return html`<div class="card"><h1>🎓 ${L(ex.title)}</h1><p>${L(ex.summary)}</p><ul><li>${t('exam.rule_q', { n: ex.questions })}</li><li>${t('exam.rule_t', { n: ex.minutes })}</li><li>${t('exam.rule_p', { n: ex.passMark })}</li><li>${t('exam.rule_a', { n: ex.maxAttempts })}</li><li>${t('exam.rule_c', { n: ex.ceu })}</li></ul>
  ${s.examStatus === 'completed' ? html`<p class="fb ok">✅ ${t('home.certified')}</p><a class="btn" href="#/certs">${t('nav.certs')}</a>` : !s.examEligible ? html`<p class="err">${t('exam.not_eligible', { n: 21 - s.completed })}</p><a class="btn" href="#/learn">${t('nav.learn')}</a>` : s.examLocked ? html`<p class="err">${t('err.locked_contact_trainer')}</p>` : html`<p class="muted small">${t('exam.attempts_used', { n: s.examFails, m: ex.maxAttempts })}</p><button class="btn gold" data-act="exam-start">${t('exam.start')}</button>`}</div>`;
}
ACT['exam-start'] = async () => { if (api.offline) return toast(t('exam.online_only'), 'bad'); const r = await api.call('GET', '/api/exam/start'); if (r.status !== 200) return toast(errText(r.body.error), 'bad'); X.res = null; X.q = { attemptId: r.body.attemptId, questions: r.body.questions, answers: r.body.questions.map(() => null), idx: 0, deadline: r.body.startedAt + r.body.minutes * 60000 }; hooks.render(); };
wire('exam', () => X.q, async () => { const r = await api.call('POST', '/api/quiz/submit', { attemptId: X.q.attemptId, answers: X.q.answers }); if (r.status !== 200) { if (r.body.error === 'attempt_expired') { X.q = null; await hooks.refreshMe(); } return toast(errText(r.body.error), 'bad'), hooks.render(); } X.q.deadline = null; X.res = r.body; await hooks.refreshMe(); hooks.render(); window.scrollTo(0, 0); });
ACT['exam-retry'] = () => { X.q = null; X.res = null; hooks.render(); };
export const examReset = () => { X.q = null; X.res = null; };
setInterval(() => { const el = document.getElementById('timer'); if (!el) return; const left = Math.max(0, +el.dataset.deadline - Date.now()), m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000); el.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`; }, 1000);

// ───────── CEU ledger ─────────
export async function ceu() {
  const r = await api.call('GET', '/api/me/ceu'); const d = r.body, tot = S.cur.totalCeu;
  return html`<h1>${t('nav.ceu')}</h1><div class="grid g3"><div class="kpi"><div class="v">${d.total}</div>${t('ceu.total')} <small class="muted">/ ${tot}</small></div><div class="kpi"><div class="v">${d.recent24m}</div>${t('ceu.recent')}</div><div class="kpi"><div class="v">${d.renewalTarget}</div>${t('ceu.target')}</div></div>
  <div class="card" style="margin-top:16px"><div class="bar gold"><i style="width:${Math.min(100, (d.recent24m / d.renewalTarget) * 100)}%"></i></div><p class="small muted">${t('ceu.policy', { n: d.renewalTarget, y: d.certValidityYears })}</p></div>
  <h2 style="margin-top:20px">${t('ceu.ledger')}</h2><div class="card tw"><table><thead><tr><th>${t('common.date')}</th><th>${t('common.title')}</th><th>${t('common.type')}</th><th class="n">CEU</th><th>${t('common.status')}</th></tr></thead><tbody>${d.entries.length ? d.entries.map((e) => html`<tr><td>${fmtDate(e.at, lang())}</td><td>${L(e.title)}</td><td>${t('ceu.kind_' + e.kind)}</td><td class="n">${e.ceu}</td><td><span class="chip ${e.status === 'approved' ? 'green' : e.status === 'pending' ? 'gold' : 'maroon'}">${t('ceu.st_' + e.status)}</span></td></tr>`) : html`<tr><td colspan="5" class="muted">${t('common.none')}</td></tr>`}</tbody></table></div>
  <h2 style="margin-top:20px">${t('ceu.claim')}</h2><div class="card"><form data-form="ceu-claim"><div class="grid g2"><div><label for="ct">${t('common.title')}</label><input id="ct" name="title" type="text" required maxlength="160"></div><div><label for="cc">CEU</label><input id="cc" name="ceu" type="number" step="0.25" min="0.25" max="10" required></div></div><label for="ce">${t('ceu.evidence')}</label><input id="ce" name="evidence" type="text" maxlength="300"><p class="hint">${t('ceu.claim_hint')}</p><button class="btn" style="margin-top:8px">${t('common.submit')}</button></form></div>`;
}
FORM['ceu-claim'] = async (f, d) => { const r = await api.call('POST', '/api/me/ceu', { title: d.get('title'), ceu: d.get('ceu'), evidence: d.get('evidence') }); if (r.status !== 201) return toast(errText(r.body.error), 'bad'); toast(t('ceu.claim_sent')); hooks.render(); };

// ───────── certificates ─────────
export async function certs() {
  const r = await api.call('GET', '/api/me/certificates'); const list = r.body.certificates.sort((a, b) => b.issuedAt - a.issuedAt);
  return html`<h1>${t('nav.certs')}</h1>${list.length ? html`<div class="grid g3">${list.map((c) => html`<div class="card ${c.type === 'accredited' ? 'tint' : ''}"><span class="chip ${c.type === 'accredited' ? 'gold' : ''}">${c.type === 'accredited' ? '🌍 ' + t('cert.accredited') : t('cert.ms')}</span><h3 style="margin-top:8px">${L(c.title)}</h3><p class="small muted">${t('cert.issued')}: ${fmtDate(c.issuedAt, lang())}<br>${t('cert.expires')}: ${fmtDate(c.expiresAt, lang())}${c.revoked ? html`<br><b class="err">${t('verify.revoked')}</b>` : ''}</p><a class="btn sm" href="#/cert/${c.id}">${t('cert.view')}</a></div>`)}</div>` : html`<div class="card"><p>${t('cert.none')}</p><a class="btn" href="#/learn">${t('nav.learn')}</a></div>`}`;
}
export const verifyUrl = (code) => `${location.origin}${location.pathname}#/verify/${code}`;
export async function cert(code) {
  const r = await api.call('GET', '/api/certificates/' + code); if (r.status !== 200) return html`<div class="card"><h2>${t('err.not_found')}</h2></div>`; const c = r.body.certificate, v = r.body.verification, acc = c.type === 'accredited';
  return html`<div class="cert-wrap"><div class="row noprint" style="margin-bottom:10px"><button class="btn" data-act="print">🖨 ${t('common.print')}</button><a class="btn ghost" href="#/certs">← ${t('nav.certs')}</a><span class="sbadge ${v.status === 'valid' ? 'valid' : 'bad'}">${t('verify.' + v.status)}</span></div>
  <div class="cert ${acc ? 'accredited' : 'ms'}"><img class="lg" src="icons/logo.png" alt="Africa CDC"><div class="tier">${acc ? t('cert.accredited') : t('cert.ms_by', { x: c.issuer })}</div><h2>${L(c.title)}</h2><p>${t('cert.awarded')}</p><div class="nm">${c.holder}</div><p>${t('cert.ceu_line', { n: c.ceu })}</p>
  <div class="foot"><div style="text-align:start">${t('cert.issued')}: ${fmtDate(c.issuedAt, lang())}<br>${t('cert.expires')}: ${fmtDate(c.expiresAt, lang())}<br>${t('cert.issuer')}: <b>${c.issuer}</b><br><span class="mono">${c.id}</span></div><div class="qrbox" aria-label="${t('cert.qr')}">${raw(toSvg(verifyUrl(c.id), { ecc: 'M', scale: 4, title: t('cert.qr') }))}</div></div><p class="small muted" style="margin-top:8px">${t('cert.scan')}</p></div></div>`;
}

// ───────── offline ─────────
export async function offline() {
  const pk = api.packages(), ob = api.outbox(), cat = S.catalog || (await api.call('GET', '/api/courses')).body; S.catalog = cat;
  const all = [...cat.starter, ...cat.library];
  return html`<h1>${t('nav.offline')}</h1><p class="muted">${t('offline.intro')}</p>
  <div class="card"><h3>${t('offline.sync_status')}</h3><p>${api.offline ? '📴 ' + t('offline.state_off') : '🟢 ' + t('offline.state_on')} · ${t('offline.pending', { n: ob.length })}</p><button class="btn" data-act="sync" ${api.offline || !ob.length ? 'disabled' : ''}>🔄 ${t('offline.sync_now')}</button></div>
  <div class="card" style="margin-top:14px"><h3>${t('offline.download')}</h3><form data-form="offline-dl"><div class="grid g3">${all.map((c) => html`<label class="row" style="font-weight:600;margin:4px 0"><input type="checkbox" name="c" value="${c.id}" style="width:20px;height:20px" ${pk[c.id] ? 'checked' : ''}> ${c.n ? c.n + '. ' : ''}${L(c.title)} ${pk[c.id] ? html`<span class="chip green">✓</span>` : ''}</label>`)}</div><div class="row" style="margin-top:10px"><button class="btn" ${api.offline ? 'disabled' : ''}>⬇ ${t('offline.download_btn')}</button><button class="btn ghost" type="button" data-act="offline-clear">${t('offline.clear')}</button></div></form><p class="hint">${t('offline.note')}</p></div>`;
}
FORM['offline-dl'] = async (f, d) => { const ids = d.getAll('c'); if (!ids.length) return toast(t('offline.pick'), 'bad'); const r = await api.downloadPackages(ids); if (r.status !== 200) return toast(errText(r.body.error), 'bad'); toast(t('offline.downloaded', { n: ids.length })); hooks.render(); };
ACT['offline-clear'] = () => { Object.keys(api.packages()).forEach((id) => api.removePackage(id)); toast(t('offline.cleared')); hooks.render(); };
ACT.sync = async () => { const r = await api.flush(); if (r) { const bad = r.filter((x) => x.status === 'error').length; toast(bad ? t('offline.sync_partial', { n: bad }) : t('offline.sync_done'), bad ? 'bad' : 'ok'); await hooks.refreshMe(); } hooks.render(); };

// ───────── public certificate verification ─────────
export async function verify(code) {
  const c = (code || '').toUpperCase(); const r = c ? await api.call('GET', '/api/verify/' + encodeURIComponent(c), undefined, { local: true }) : null; const v = r && r.body;
  return html`<div class="login" style="max-width:640px"><div class="card"><h1>🔎 ${t('verify.title')}</h1><p class="muted">${t('verify.intro')}</p><form data-form="verify" class="row" style="flex-wrap:nowrap"><input type="text" name="code" value="${c}" placeholder="ACDC-XXXX-XXXX-XXXX" aria-label="${t('verify.code')}" style="flex:1" autocomplete="off"><button class="btn">${t('verify.check')}</button></form>
  ${v ? html`<div class="card ${v.status === 'valid' ? 'tint' : ''}" style="margin-top:14px"><span class="sbadge ${v.status === 'valid' ? 'valid' : 'bad'}" style="font-size:.95rem">${v.status === 'valid' ? '✅ ' : '⚠ '}${t('verify.' + v.status)}</span>${v.status === 'unknown' ? html`<p>${t('verify.unknown_msg')}</p>` : html`<h3 style="margin-top:10px">${L(v.title)}</h3><table><tr><th>${t('verify.holder')}</th><td>${v.holder}</td></tr><tr><th>${t('common.type')}</th><td>${v.type === 'accredited' ? '🌍 ' + t('cert.accredited') : t('cert.ms')}</td></tr><tr><th>${t('cert.issuer')}</th><td>${v.issuer}</td></tr><tr><th>CEU</th><td>${v.ceu}</td></tr><tr><th>${t('cert.issued')}</th><td>${fmtDate(v.issuedAt, lang())}</td></tr><tr><th>${t('cert.expires')}</th><td>${fmtDate(v.expiresAt, lang())}</td></tr></table>`}</div>` : ''}
  <p class="hint">${t('verify.privacy')}</p><p><a href="#/">← ${t('nav.home')}</a></p></div></div>`;
}
FORM.verify = (f, d) => go('/verify/' + encodeURIComponent(String(d.get('code') || '').trim()));
