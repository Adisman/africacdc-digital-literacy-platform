// Safe-by-default templating (auto-escapes), tiny markdown, formatting and toast helpers.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __raw: String(s) });
const val = (v) => (Array.isArray(v) ? v.map(val).join('') : v && v.__raw !== undefined ? v.__raw : v == null || v === false ? '' : esc(v));
export const html = (strs, ...vals) => raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));
export const str = (h) => (h && h.__raw !== undefined ? h.__raw : String(h));
// Markdown subset for lesson bodies: paragraphs, - bullets, 1. lists, **bold**, `code`. Input is escaped first.
export function md(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  return raw(String(src || '').split(/\n\n+/).map((blk) => {
    const lines = blk.split('\n');
    if (lines.every((l) => /^- /.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('') + '</ul>';
    if (lines.every((l) => /^\d+\. /.test(l))) return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('') + '</ol>';
    if (lines.length > 1 && /^- /.test(lines[1])) { const head = lines[0]; const rest = lines.slice(1); return `<p>${inline(head)}</p><ul>` + rest.map((l) => `<li>${inline(l.replace(/^- /, ''))}</li>`).join('') + '</ul>'; }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join(''));
}
export const fmtDate = (ms, lang = 'en') => (ms ? new Date(ms).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const pct = (x) => Math.round((x || 0) * 100) + '%';
export const num = (x) => (typeof x === 'number' ? x.toLocaleString('en-US') : x);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
let toastBox;
export function toast(msg, kind = 'ok') {
  toastBox = toastBox || Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toasts', role: 'status' }); toastBox.setAttribute('aria-live', 'polite');
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; toastBox.appendChild(t); while (toastBox.children.length > 3) toastBox.firstChild.remove(); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4000);
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const download = (name, data, type = 'application/octet-stream') => { const b = data instanceof Blob ? data : new Blob([data], { type }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: name }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
