// Authentication primitives: scrypt password hashing, signed tokens/sessions, RFC 6238 TOTP, rate limiting.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function hashPassword(pw) { const salt = randomBytes(16), N = 16384, r = 8, p = 1; return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${scryptSync(pw, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`; }
export function verifyPassword(pw, stored) {
  try { const [alg, N, r, p, salt, hash] = String(stored).split('$'); if (alg !== 'scrypt') return false; const want = Buffer.from(hash, 'base64url'), got = scryptSync(pw, Buffer.from(salt, 'base64url'), want.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 }); return timingSafeEqual(want, got); } catch { return false; }
}
export const DUMMY_HASH = hashPassword('dummy-password-for-timing');
const COMMON = new Set(['password', 'password1', 'password123', '1234567890', 'qwertyuiop', 'africacdc', 'iloveyou12', 'welcome123', 'admin12345']);
export function passwordProblems(pw, user) {
  const e = []; if (typeof pw !== 'string' || pw.length < 10) e.push('min_length_10'); if (pw.length > 200) e.push('too_long'); if (COMMON.has(String(pw).toLowerCase())) e.push('too_common');
  if (user && pw && (pw.toLowerCase().includes((user.email || '').split('@')[0].toLowerCase()) && (user.email || '').split('@')[0].length > 3)) e.push('contains_email'); if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) e.push('needs_letter_and_digit_or_symbol'); return e;
}
export const sign = (secret, obj) => { const body = Buffer.from(JSON.stringify(obj)).toString('base64url'); return body + '.' + createHmac('sha256', secret).update(body).digest('base64url'); };
export function unsign(secret, tok) { if (typeof tok !== 'string') return null; const [body, mac] = tok.split('.'); if (!body || !mac) return null; const want = createHmac('sha256', secret).update(body).digest(); let got; try { got = Buffer.from(mac, 'base64url'); } catch { return null; } if (want.length !== got.length || !timingSafeEqual(want, got)) return null; try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.exp && o.exp < Date.now() ? null : o; } catch { return null; } }

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const b32 = (buf) => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
export const b32dec = (s) => { let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export const newTotpSecret = () => b32(randomBytes(20));
export function totp(secret, step) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', b32dec(secret)).update(buf).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0'); }
/** Returns the matched time-step (for replay protection) or null. */
export function totpCheck(secret, code, now = Date.now(), lastStep = 0) { const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return null; const s = Math.floor(now / 30000); for (const d of [0, -1, 1]) { const st = s + d; if (st > lastStep && timingSafeEqual(Buffer.from(totp(secret, st)), Buffer.from(c))) return st; } return null; }
export const otpauth = (secret, label, issuer = 'Africa CDC DLP') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

export class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.win = windowMs; this.m = new Map(); }
  hit(key, now = Date.now()) { const a = (this.m.get(key) || []).filter((t) => now - t < this.win); a.push(now); this.m.set(key, a); if (this.m.size > 20000) for (const [k, v] of this.m) if (!v.length || now - v[v.length - 1] > this.win) this.m.delete(k); return a.length > this.max; }
  count(key, now = Date.now()) { return (this.m.get(key) || []).filter((t) => now - t < this.win).length; }
  reset(key) { this.m.delete(key); }
}
