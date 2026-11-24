// Application shell: bootstrap, router, role navigation, login (demo personas · password + MFA), account, sync status.
import { html, raw, str, $, $$, toast, debounce } from './ui.js';
import { t, L, initI18n, setLang, lang, languages } from './i18n.js';
import { api } from './api.js';
import { S, ACT, FORM, INPUT, CHG, hooks, go } from './state.js';
import { toSvg } from './qr.js';
import * as learner from './learner.js';
import * as admin from './admin.js';
import * as author from './author.js';

const errText = (c) => (t('err.' + c) !== 'err.' + c ? t('err.' + c) : t('err.generic'));
const NAV = {
  learner: [['home', '/home', '🏠'], ['learn', '/learn', '📚'], ['exam', '/exam', '🎓'], ['ceu', '/ceu', '⭐'], ['certs', '/certs', '📜'], ['offline', '/offline', '📥']],
  trainer: [['home', '/home', '🏠'], ['learn', '/learn', '📚'], ['author', '/author', '✍️'], ['cohorts', '/cohorts', '👥'], ['ceu', '/ceu', '⭐'], ['certs', '/certs', '📜'], ['offline', '/offline', '📥']],
  facility_admin: [['dash', '/dash', '📊'], ['users', '/users', '👤'], ['cohorts', '/cohorts', '👥'], ['exports', '/exports', '⬇️'], ['learn', '/learn', '📚'], ['ceu', '/ceu', '⭐']],
  ms_admin: [['dash', '/dash', '📊'], ['users', '/users', '👤'], ['facilities', '/facilities', '🏥'], ['cohorts', '/cohorts', '👥'], ['author', '/author', '✍️'], ['audit', '/audit', '🛡'], ['exports', '/exports', '⬇️'], ['learn', '/learn', '📚'], ['ceu', '/ceu', '⭐']],
  super_admin: [['dash', '/dash', '📊'], ['tenants', '/tenants', '🌍'], ['users', '/users', '👤'], ['facilities', '/facilities', '🏥'], ['author', '/author', '✍️'], ['audit', '/audit', '🛡'], ['exports', '/exports', '⬇️'], ['learn', '/learn', '📚']],
};
const homeFor = (r) => (['learner', 'trainer'].includes(r) ? '/home' : '/dash');
const L0 = { phase: 'boot', login: { step: 'creds' } };
const $app = () => $('#app');

// ───────── routing ─────────
const ROUTES = [
  [/^\/home$/, () => learner.home(), 'learner'], [/^\/learn$/, () => learner.learn(S.tab || 'starter')], [/^\/course\/([^/]+)$/, (m) => learner.course(m[1])],
  [/^\/exam$/, () => learner.exam()], [/^\/ceu$/, () => learner.ceu()], [/^\/certs$/, () => learner.certs()], [/^\/cert\/([^/]+)$/, (m) => learner.cert(m[1])], [/^\/offline$/, () => learner.offline()],
  [/^\/dash$/, () => admin.dash()], [/^\/users$/, () => admin.users()], [/^\/facilities$/, () => admin.facilities()], [/^\/cohorts$/, () => admin.cohorts()], [/^\/tenants$/, () => admin.tenants()],
  [/^\/audit$/, () => admin.audit()], [/^\/exports$/, () => admin.exports()], [/^\/author$/, () => author.list()], [/^\/author\/([^/]+)$/, (m) => author.detail(m[1])],
  [/^\/author-preview\/([^/]+)$/, async (m) => { const r = await api.call('GET', '/api/authoring/courses/' + m[1]); return r.status === 200 ? learner.course('preview-' + m[1], r.body.course) : html`<p class="err">${errText(r.body.error)}</p>`; }],
  [/^\/account$/, () => account()],
];
const route = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
const allowed = (p) => { const r = S.user.role; if (/^\/(dash|users|facilities|cohorts|tenants|audit|exports)/.test(p)) return NAV[r].some((n) => p.startsWith(n[1])); if (p.startsWith('/author')) return ['ms_admin', 'trainer', 'super_admin'].includes(r); if (/^\/(exam|certs|cert|offline|home)/.test(p)) return ['learner', 'trainer'].includes(r) || p.startsWith('/cert/'); return true; };

async function render() {
  const p = route(), my = ++S.rt, app = $app();
  const vm = /^\/verify\/(.*)$/.exec(p); if (vm) { app.innerHTML = shell(null, html`<div class="skeleton" aria-busy="true"></div>`).__raw; app.innerHTML = shell(null, await learner.verify(decodeURIComponent(vm[1]))).__raw; return after(); }
  if (L0.phase === 'login' || !S.user) { app.innerHTML = loginView().__raw; return after(); }
  if (S.user.mustChange) { app.innerHTML = shell(S.user, forcePw(), true).__raw; return after(); }
  if (p === '/' || p === '') return go(homeFor(S.user.role));
  if (!allowed(p)) return go(homeFor(S.user.role));
  S.route = p; app.innerHTML = shell(S.user, html`<div class="skeleton" aria-busy="true">${t('common.loading')}</div>`).__raw;
  let view = null; for (const [re, fn] of ROUTES) { const m = re.exec(p); if (m) { try { view = await fn(m); } catch (e) { console.error(e); view = html`<div class="card"><p class="err">${errText('generic')}</p></div>`; } break; } }
  if (my !== S.rt) return; if (!view) view = html`<div class="card"><h1>404</h1><a class="btn" href="#${homeFor(S.user.role)}">←</a></div>`;
  const main = $('#main'); if (main) { main.innerHTML = str(view); } else app.innerHTML = shell(S.user, view).__raw;
  after();
}
const after = () => { const h = $('#main h1'); if (h) { h.setAttribute('tabindex', '-1'); if (!S.keep) h.focus({ preventScroll: true }); } S.keep = false; };
hooks.render = () => { S.keep = true; return render(); };
hooks.refreshMe = async () => { const r = await api.call('GET', '/api/me'); if (r.status === 200) { Object.assign(S, { user: r.body.user, tenant: r.body.tenant, facility: r.body.facility, summary: r.body.summary }); } return r; };
window.addEventListener('hashchange', () => { S.keep = false; window.scrollTo(0, 0); render(); });

// ───────── layout ─────────
function syncPill() {
  const q = api.outbox().length;
  return html`<span class="sync ${api.offline ? 'off' : q ? 'q' : ''}" role="status">${api.offline ? '⚠ ' + t('sync.offline') : q ? '⏳ ' + t('sync.pending', { n: q }) : '● ' + t('sync.online')}</span>`;
}
function langSelect() { return html`<label class="ctl"><span class="sr">${t('common.language')}</span><select data-chg="lang" aria-label="${t('common.language')}">${Object.entries(languages()).map(([c, m]) => html`<option value="${c}" ${lang() === c ? 'selected' : ''}>${m.name}</option>`)}</select></label>`; }
function shell(user, body, bare) {
  const nav = user && !bare ? NAV[user.role] : null;
  return html`<a class="skip" href="#main">${t('common.skip')}</a>
  <header class="top"><a class="brand" href="#/" aria-label="${t('app.name')}"><span class="logo"><img src="icons/logo-sm.png" alt="" width="40" height="40"></span><b>${t('app.short')}<small style="display:block;font-weight:400;font-size:.7rem;opacity:.8">${t('app.sub')}</small></b></a><span style="flex:1"></span>
    ${syncPill()}${user ? html`<label class="row small" style="margin:0;color:#fff;gap:6px">${t('sync.simulate')} <button class="switch" role="switch" aria-pressed="${api.forcedOffline}" aria-label="${t('sync.simulate')}" data-act="toggle-offline"></button></label>` : ''}
    ${langSelect()}${user ? html`<a class="pill" href="#/account" aria-label="${t('nav.account')}"><span class="avatar" style="width:26px;height:26px;font-size:.75rem">${user.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>${user.name.split(' ')[0]}</a><button class="pill gold" data-act="logout">${t('auth.logout')}</button>` : html`<a class="pill gold" href="#/">${t('auth.login')}</a>`}</header>
  ${api.mode === 'demo' ? html`<div class="banner" style="margin:0;border-radius:0;text-align:center">🧪 ${t('demo.banner')} <button class="btn sm ghost" data-act="demo-reset" style="margin-inline-start:8px">${t('demo.reset')}</button></div>` : ''}
  ${nav ? html`<nav class="mob" aria-label="${t('nav.main')}">${nav.map(([k, p, i]) => html`<button data-act="nav" data-to="${p}" ${S.route.startsWith(p) ? 'aria-current="page"' : ''}>${i} ${t('nav.' + k)}</button>`)}</nav>` : ''}
  <div class="layout">${nav ? html`<nav class="side" aria-label="${t('nav.main')}"><div class="sep">${t('role.' + user.role)}</div>${nav.map(([k, p, i]) => html`<button data-act="nav" data-to="${p}" ${S.route.startsWith(p) ? 'aria-current="page"' : ''}>${i} ${t('nav.' + k)}</button>`)}<div class="sep">${t('nav.verify')}</div><button data-act="nav" data-to="/verify/">🔎 ${t('nav.verify')}</button></nav>` : ''}
  <main id="main" tabindex="-1">${body}</main></div>
  <footer>${t('app.footer')} · v${'1.0.0'} · ${api.mode === 'server' ? t('app.mode_server') : t('app.mode_demo')} · <a href="https://github.com/" id="gh" rel="noopener" hidden></a></footer>`;
}
ACT.nav = (el) => go(el.dataset.to);
ACT['toggle-offline'] = async () => { api.forcedOffline = !api.forcedOffline; if (!api.forcedOffline) { const r = await api.flush(); if (r && r.length) { toast(t('sync.synced', { n: r.length })); await hooks.refreshMe(); } } api.emit(); render(); };
api.on(() => { const s = $('.sync'); if (s) s.outerHTML = str(syncPill()); });
CHG.lang = async (el) => { await setLang(el.value); if (S.user && api.mode === 'server') api.call('PATCH', '/api/me', { lang: el.value }); render(); };
ACT['demo-reset'] = () => { if (confirm(t('demo.reset_confirm'))) api.resetDemo(); };
ACT.logout = async () => { if (api.mode === 'server') await api.call('POST', '/api/logout', {}); else api.demoLogout(); Object.assign(S, { user: null, tenant: null, facility: null, summary: null }); L0.phase = 'login'; L0.login = { step: 'creds' }; location.hash = '#/'; render(); };

// ───────── login ─────────
const qrBox = (text) => raw(`<div class="qrbox" style="width:200px;max-width:100%;margin:8px auto" role="img" aria-label="QR">${toSvg(text, { margin: 2, cls: 'qr' })}</div>`);
function loginView() {
  const st = L0.login, demo = api.mode === 'demo';
  let inner;
  if (demo && st.step === 'creds') inner = html`<h2>${t('auth.demo_title')}</h2><p class="small muted">${t('auth.demo_help')}</p>${api.demoPersonas().map((u) => html`<button class="persona" data-act="persona" data-id="${u.id}"><span class="avatar">${u.name[0]}</span><span><b>${u.name}</b><br><span class="small muted">${t('role.' + u.role)} · ${u.tenant}</span></span></button>`)}`;
  else if (st.step === 'creds') inner = html`<h2>${t('auth.login')}</h2><form data-form="login"><label for="le">Email</label><input id="le" name="email" type="email" autocomplete="username" value="${st.email || ''}" required><label for="lp">${t('auth.password')}</label><input id="lp" name="password" type="password" autocomplete="current-password" required>${st.err ? html`<p class="err" role="alert">${st.err}</p>` : ''}<button class="btn" style="margin-top:14px;width:100%">${t('auth.login')}</button></form>`;
  else if (st.step === 'mfa') inner = html`<h2>🔐 ${t('auth.mfa_title')}</h2><p class="small">${t('auth.mfa_help')}</p><form data-form="mfa"><label for="mc">${st.recovery ? t('auth.recovery_code') : t('auth.code')}</label><input id="mc" name="code" inputmode="${st.recovery ? 'text' : 'numeric'}" autocomplete="one-time-code" required ${st.recovery ? '' : 'pattern="[0-9]{6}" maxlength="6"'}>${st.err ? html`<p class="err" role="alert">${st.err}</p>` : ''}<button class="btn" style="margin-top:14px;width:100%">${t('auth.verify')}</button></form><button class="btn ghost sm" style="margin-top:8px" data-act="mfa-recovery">${st.recovery ? t('auth.use_code') : t('auth.use_recovery')}</button>`;
  else if (st.step === 'setup') inner = html`<h2>🔐 ${t('auth.mfa_setup')}</h2><p class="small">${t('auth.mfa_setup_help')}</p>${qrBox(st.otpauth)}<p class="small">${t('auth.mfa_manual')}: <span class="mono">${st.secret}</span></p><form data-form="mfa-confirm"><label for="mc">${t('auth.code')}</label><input id="mc" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>${st.err ? html`<p class="err" role="alert">${st.err}</p>` : ''}<button class="btn" style="margin-top:14px;width:100%">${t('auth.enable')}</button></form>`;
  else if (st.step === 'codes') inner = html`<h2>✅ ${t('auth.recovery_title')}</h2><p class="small">${t('auth.recovery_help')}</p><pre class="mono card tint">${st.codes.join('\n')}</pre><div class="row"><button class="btn ghost" data-act="codes-dl">⬇ ${t('auth.download')}</button><button class="btn" data-act="codes-done">${t('auth.saved_continue')}</button></div>`;
  return shell(null, html`<div class="login"><div class="card"><div style="text-align:center"><img src="icons/logo.png" alt="Africa CDC" width="165" height="76" style="max-width:60%;height:auto"></div><h1 style="text-align:center;font-size:1.3rem">${t('app.name')}</h1>${inner}</div>
  <p style="text-align:center"><a href="#/verify/">🔎 ${t('nav.verify')}</a></p></div>`);
}
ACT.persona = async (el) => { api.demoLogin(el.dataset.id); await enter(); };
const enter = async () => { const r = await hooks.refreshMe(); if (r.status !== 200) { L0.phase = 'login'; return render(); } L0.phase = 'app'; if (S.user.lang && languages()[S.user.lang] && S.user.lang !== lang()) await setLang(S.user.lang); location.hash = '#' + homeFor(S.user.role); render(); };
FORM.login = async (f, d) => {
  const r = await api.call('POST', '/api/login', { email: d.get('email'), password: d.get('password') }); const b = r.body;
  if (r.status === 200 && b.mfaRequired) L0.login = { step: 'mfa', token: b.mfaToken }; else if (r.status === 200 && b.mfaSetupRequired) { const s = await api.call('POST', '/api/mfa/setup', { setupToken: b.setupToken }); if (s.status !== 200) L0.login = { step: 'creds', err: errText(s.body.error) }; else L0.login = { step: 'setup', token: b.setupToken, secret: s.body.secret, otpauth: s.body.otpauth }; }
  else if (r.status === 200) return enter(); else L0.login = { step: 'creds', err: errText(b.error), email: d.get('email') };
  render();
};
ACT['mfa-recovery'] = () => { L0.login.recovery = !L0.login.recovery; L0.login.err = ''; render(); };
FORM.mfa = async (f, d) => { const r = await api.call('POST', '/api/login/mfa', { mfaToken: L0.login.token, ...(L0.login.recovery ? { recovery: d.get('code') } : { code: d.get('code') }) }); if (r.status === 200) return enter(); L0.login.err = errText(r.body.error); render(); };
FORM['mfa-confirm'] = async (f, d) => { const r = await api.call('POST', '/api/mfa/confirm', { setupToken: L0.login.token, code: d.get('code') }); if (r.status === 200) { L0.login = { step: 'codes', codes: r.body.recoveryCodes }; return render(); } L0.login.err = errText(r.body.error); render(); };
ACT['codes-dl'] = () => import('./ui.js').then((u) => u.download('africacdc-dlp-recovery-codes.txt', L0.login.codes.join('\n') + '\n', 'text/plain'));
ACT['codes-done'] = () => enter();

// ───────── account / forced password change ─────────
const pwForm = (forced) => html`<form data-form="pw"><label for="pc">${t('auth.current_password')}</label><input id="pc" name="current" type="password" autocomplete="current-password" required><label for="pn">${t('auth.new_password')}</label><input id="pn" name="password" type="password" autocomplete="new-password" minlength="10" required><p class="hint">${t('auth.pw_rules')}</p><label for="pn2">${t('auth.confirm_password')}</label><input id="pn2" name="again" type="password" autocomplete="new-password" required><button class="btn" style="margin-top:12px">${t('common.save')}</button></form>`;
const forcePw = () => html`<div class="login"><div class="card"><h2>🔑 ${t('auth.must_change')}</h2><p class="small">${t('auth.must_change_help')}</p>${pwForm(true)}</div></div>`;
FORM.pw = async (f, d) => { if (d.get('password') !== d.get('again')) return toast(t('auth.pw_mismatch'), 'bad'); const r = await api.call('POST', '/api/password', { current: d.get('current'), password: d.get('password') }); if (r.status !== 200) return toast(r.body.problems ? t('auth.pw_weak') + ': ' + r.body.problems.join(', ') : errText(r.body.error), 'bad'); S.user.mustChange = false; toast(t('common.saved')); f.reset(); await hooks.refreshMe(); render(); };
async function account() {
  const u = S.user;
  return html`<h1>${t('nav.account')}</h1><div class="grid g2"><div class="card"><h3>${u.name}</h3><p class="small muted">${u.email}</p><p>${t('role.' + u.role)} · ${S.tenant ? S.tenant.name : ''}${S.facility ? ' · ' + S.facility.name : ''}</p><p class="small">${u.mfa ? '🔐 ' + t('account.mfa_on') : t('account.mfa_off')}</p></div>
  ${api.mode === 'server' ? html`<div class="card"><h3>${t('auth.change_password')}</h3>${pwForm(false)}</div>` : html`<div class="card"><p class="small muted">${t('account.demo_note')}</p></div>`}
  <div class="card"><h3>${t('account.privacy')}</h3><p class="small">${t('account.privacy_text')}</p>${['learner', 'trainer'].includes(u.role) ? html`<button class="btn ghost sm" data-act="my-export">⬇ ${t('account.export_mine')}</button>` : ''}</div></div>`;
}
ACT['my-export'] = async () => { const [a, b, c] = await Promise.all([api.call('GET', '/api/me'), api.call('GET', '/api/me/ceu'), api.call('GET', '/api/me/certificates')]); (await import('./ui.js')).download('my-data.json', JSON.stringify({ profile: a.body, ceu: b.body, certificates: c.body }, null, 2), 'application/json'); };

// ───────── event delegation (CSP-safe: no inline handlers) ─────────
const inDlg = (e) => e.target.closest && e.target.closest('dialog#dlg');
document.addEventListener('click', (e) => { if (inDlg(e)) return; const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) { if (el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault(); const r = ACT[el.dataset.act](el, e); if (r && r.catch) r.catch((x) => { console.error(x); toast(errText('generic'), 'bad'); }); } });
document.addEventListener('submit', (e) => { if (inDlg(e)) return; const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); const h = FORM[f.dataset.form]; if (h) Promise.resolve(h(f, new FormData(f))).catch((x) => { console.error(x); toast(errText('generic'), 'bad'); }); });
document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el && INPUT[el.dataset.in]) INPUT[el.dataset.in](el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) Promise.resolve(CHG[el.dataset.chg](el, e)).catch(console.error); });

// ───────── boot ─────────
(async function boot() {
  const saved = (() => { try { return localStorage.getItem('dlp-lang'); } catch { return null; } })();
  await initI18n(saved || (navigator.language || 'en').slice(0, 2));
  document.title = t('app.name');
  try { await api.init(); } catch (e) { $app().innerHTML = `<p style="padding:24px">Could not load platform data. ${e.message}</p>`; return; }
  if (api.mode === 'server') { const c = await api.call('GET', '/api/curriculum'); S.cur = c.body; } else S.cur = api.starter.cur;
  const mine = await (api.mode === 'server' ? api.call('GET', '/api/me') : api.demoUser() ? hooks.refreshMe() : { status: 401 });
  if (api.mode === 'server' && mine.status === 200) Object.assign(S, { user: mine.body.user, tenant: mine.body.tenant, facility: mine.body.facility, summary: mine.body.summary });
  L0.phase = S.user ? 'app' : 'login';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__ready = true; render();
})();
