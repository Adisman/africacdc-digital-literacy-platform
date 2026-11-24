// Authoring helpers for the starter curriculum. Every text is bilingual: t(en, fr).
export const t = (en, fr) => ({ en, fr });
// Lesson: title, body (markdown subset), key points
export const L = (tEn, tFr, bEn, bFr, kEn, kFr) => ({
  title: t(tEn, tFr), body: t(bEn, bFr), key: kEn.map((k, i) => t(k, kFr[i])),
});
// Quiz item: question, correct option, two distractors, explanation
export const qz = (qEn, qFr, c, w1, w2, wEn, wFr) => ({ q: t(qEn, qFr), c: t(...c), w: [t(...w1), t(...w2)], why: t(wEn, wFr) });
// Activities (accessible: no drag needed)
export const match = (pEn, pFr, pairs) => ({ type: 'match', prompt: t(pEn, pFr), pairs: pairs.map(([a, b, c, d]) => ({ left: t(a, b), right: t(c, d) })) });
export const order = (pEn, pFr, steps) => ({ type: 'order', prompt: t(pEn, pFr), steps: steps.map(([a, b]) => t(a, b)) });
export const sort = (pEn, pFr, buckets, items) => ({ type: 'sort', prompt: t(pEn, pFr), buckets: buckets.map(([a, b]) => t(a, b)), items: items.map(([a, b, k]) => ({ text: t(a, b), bucket: k })) });
export const job = (tEn, tFr, steps) => ({ title: t(tEn, tFr), steps: steps.map(([a, b]) => t(a, b)) });
export const mod = (o) => o;
