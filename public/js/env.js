// Runtime environment injected into core (clock, randomness, secrets, password hashing).
import { hmac } from './sha256.js';
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const PW = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeEnv(o = {}) {
  const rb = (n) => { const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return a; };
  return {
    now: o.now || (() => Date.now()), randHex: (n) => hex(rb(n)), uid: (p) => p + hex(rb(5)),
    secret: o.secret || 'DEMO-ONLY-NOT-A-SECRET', baseUrl: o.baseUrl || '', version: o.version || '1.0.0', mode: o.mode || 'demo',
    newPassword: () => { const b = rb(14); let s = ''; for (let i = 0; i < 14; i++) s += PW[b[i] % PW.length]; return s.slice(0, 4) + '-' + s.slice(4, 9) + '-' + s.slice(9, 14); },
    hashPassword: o.hashPassword || ((p) => 'demo:' + hmac('demo', p).slice(0, 16)),
    verifyPassword: o.verifyPassword || ((p, h) => h === 'demo:' + hmac('demo', p).slice(0, 16)),
  };
}
