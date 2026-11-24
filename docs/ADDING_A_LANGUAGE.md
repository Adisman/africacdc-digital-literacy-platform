# Adding a language (e.g. Portuguese or Arabic)

The UI and content are language-agnostic; English is the fallback for anything untranslated.

1. Copy `public/locales/en.json` to `public/locales/pt.json` (or `ar.json`) and translate the values. Keep `{placeholders}` unchanged.
2. Register it in `public/locales/index.json`: `"pt": { "name": "Português", "dir": "ltr" }` — use `"dir": "rtl"` for Arabic; the layout uses logical CSS properties and flips automatically.
3. Run `npm run check:i18n` — it fails on missing keys, extra keys or placeholder mismatches.
4. Add `'pt'` to the allowed list in `PATCH /api/me` in `public/js/core.js` (already accepts `en, fr, pt, ar`).
5. Translate content: in `content/`, each text is an object `{ en, fr }`. Add a `pt` key to lessons, quizzes, activities and job aids (the `L()` helper falls back to English per field, so partial translation works). Extend the parity check in `scripts/build-content.js` to require the new language.
6. Add the file to the `SHELL` list in `public/sw.js` so it is available offline.

Status: EN and FR are complete. PT and AR are **not** included (ToR: later phase).
