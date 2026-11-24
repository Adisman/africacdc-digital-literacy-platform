// Document store with clone-on-read semantics (so behaviour matches a real database).
// Persistence is pluggable: SQLite write-through on the server, IndexedDB snapshot in the browser demo.
const clone = (x) => (x === undefined ? x : structuredClone(x));
export class MemStore {
  constructor(onChange) { this.c = Object.create(null); this.onChange = onChange || null; }
  _coll(n) { return (this.c[n] = this.c[n] || new Map()); }
  all(n) { return Array.from(this._coll(n).values(), clone); }
  get(n, id) { return clone(this._coll(n).get(id)); }
  put(n, doc) { if (!doc || doc.id == null) throw new Error('doc.id required'); const d = clone(doc); this._coll(n).set(String(d.id), d); if (this.onChange) this.onChange('put', n, d); return doc; }
  del(n, id) { this._coll(n).delete(String(id)); if (this.onChange) this.onChange('del', n, { id }); }
  count(n) { return this._coll(n).size; }
  load(snapshot) { for (const [n, rows] of Object.entries(snapshot || {})) { const m = this._coll(n); for (const d of rows) m.set(String(d.id), d); } }
  dump() { const o = {}; for (const [n, m] of Object.entries(this.c)) o[n] = Array.from(m.values()); return o; }
}
