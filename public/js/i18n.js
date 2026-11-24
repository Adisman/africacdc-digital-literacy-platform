// Language framework: JSON locale files; English is the fallback. Add a language by dropping
// public/locales/<code>.json and an entry in public/locales/index.json (dir: "rtl" for Arabic etc.).
let dict = {}, fallback = {}, meta = { en: { name: 'English', dir: 'ltr' } }, cur = 'en';
const load = async (c) => { const r = await fetch(`locales/${c}.json`, { cache: 'no-cache' }); if (!r.ok) throw new Error('locale ' + c); return r.json(); };
export async function initI18n(lang) {
  try { meta = await (await fetch('locales/index.json', { cache: 'no-cache' })).json(); } catch {}
  fallback = await load('en'); return setLang(lang);
}
export async function setLang(lang) {
  if (!meta[lang]) lang = 'en'; cur = lang; dict = lang === 'en' ? fallback : await load(lang).catch(() => ({}));
  document.documentElement.lang = lang; document.documentElement.dir = (meta[lang] && meta[lang].dir) || 'ltr'; try { localStorage.setItem('dlp-lang', lang); } catch {} return lang;
}
export const lang = () => cur;
export const languages = () => meta;
export function t(key, vars) { let s = dict[key] ?? fallback[key] ?? key; if (vars) for (const k in vars) s = s.replaceAll('{' + k + '}', vars[k]); return s; }
/** Pick the content-language variant of a {en, fr, ...} object, falling back to English then any. */
export const L = (o) => (o == null ? '' : typeof o === 'string' ? o : o[cur] || o.en || Object.values(o).find(Boolean) || '');
