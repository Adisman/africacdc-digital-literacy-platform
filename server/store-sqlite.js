// SQLite-backed store (node:sqlite, built in to Node >= 22.5). In-memory cache + write-through to disk.
// Personal-data fields are encrypted at the application layer with AES-256-GCM (key from env).
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { MemStore } from '../public/js/store.js';

const PII = { users: ['name', 'email', 'phone'], certs: ['holder'] };
const b64 = (b) => b.toString('base64url');
export function encrypt(key, obj) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`; }
export function decrypt(key, s) { const [v, iv, tag, ct] = s.split('.'); if (v !== 'v1') throw new Error('bad ciphertext'); const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url')); return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')); }

export class SqliteStore extends MemStore {
  constructor(file, { key } = {}) {
    super(); this.key = key || null; this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID;');
    this._put = this.sql.prepare('INSERT OR REPLACE INTO docs (coll,id,json) VALUES (?,?,?)'); this._del = this.sql.prepare('DELETE FROM docs WHERE coll=? AND id=?'); this.depth = 0;
    for (const r of this.sql.prepare('SELECT coll,id,json FROM docs').all()) { let d = JSON.parse(r.json); if (d._pii) { if (!this.key) throw new Error('DB contains encrypted data but DB_ENCRYPTION_KEY is not set'); const { _pii, ...rest } = d; d = { ...rest, ...decrypt(this.key, _pii) }; } this._coll(r.coll).set(r.id, d); }
    this.onChange = (op, coll, d) => { if (op === 'del') this._del.run(coll, String(d.id)); else this._put.run(coll, String(d.id), this._ser(coll, d)); };
  }
  _ser(coll, d) {
    const f = PII[coll]; if (!f || !this.key) return JSON.stringify(d);
    const pii = {}, rest = { ...d }; for (const k of f) if (k in rest) { pii[k] = rest[k]; delete rest[k]; } return JSON.stringify({ ...rest, _pii: encrypt(this.key, pii) });
  }
  batch(fn) { this.sql.exec('BEGIN'); try { const r = fn(); this.sql.exec('COMMIT'); return r; } catch (e) { this.sql.exec('ROLLBACK'); throw e; } }
  backup(dest) { this.sql.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`); }
  close() { this.sql.close(); }
}
