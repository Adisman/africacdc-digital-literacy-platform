// Dependency-free QR Code encoder (byte mode, ECC L/M, versions 1-10). Output: boolean matrix / SVG.
// Algorithm follows ISO/IEC 18004; verified by decoding with OpenCV in test/qr.test.js.
const EC = { // [total, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]
  L: [null, [26, 7, 1, 19, 0, 0], [44, 10, 1, 34, 0, 0], [70, 15, 1, 55, 0, 0], [100, 20, 1, 80, 0, 0], [134, 26, 1, 108, 0, 0], [172, 18, 2, 68, 0, 0], [196, 20, 2, 78, 0, 0], [242, 24, 2, 97, 0, 0], [292, 30, 2, 116, 0, 0], [346, 18, 2, 68, 2, 69]],
  M: [null, [26, 10, 1, 16, 0, 0], [44, 16, 1, 28, 0, 0], [70, 26, 1, 44, 0, 0], [100, 18, 2, 32, 0, 0], [134, 24, 2, 43, 0, 0], [172, 16, 4, 27, 0, 0], [196, 18, 4, 31, 0, 0], [242, 22, 2, 38, 2, 39], [292, 22, 3, 36, 2, 37], [346, 26, 4, 43, 1, 44]],
};
const FMT = { L: 1, M: 0 };
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// GF(256) arithmetic, primitive polynomial 0x11D
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
function rsRem(data, n) { const g = rsGen(n), r = new Array(n).fill(0); for (const b of data) { const f = b ^ r.shift(); r.push(0); if (f) for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f); } return r; }

function bits(val, len, out) { for (let i = len - 1; i >= 0; i--) out.push((val >>> i) & 1); }
function bchFmt(d) { let r = d << 10; for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10); return ((d << 10) | r) ^ 0x5412; }
function bchVer(v) { let r = v << 12; for (let i = 17; i >= 12; i--) if ((r >>> i) & 1) r ^= 0x1f25 << (i - 12); return (v << 12) | r; }

export function encode(text, ecc = 'M') {
  const data = new TextEncoder().encode(text);
  let ver = 0;
  for (let v = 1; v <= 10; v++) { const e = EC[ecc][v], cap = e[2] * e[3] + e[4] * e[5]; if (4 + (v < 10 ? 8 : 16) + data.length * 8 <= cap * 8) { ver = v; break; } }
  if (!ver) throw new Error('QR: text too long (max ~213 bytes at ECC M)');
  const [total, ecLen, b1, d1, b2, d2] = EC[ecc][ver], capBytes = b1 * d1 + b2 * d2;
  const bb = []; bits(4, 4, bb); bits(data.length, ver < 10 ? 8 : 16, bb); data.forEach(b => bits(b, 8, bb));
  bits(0, Math.min(4, capBytes * 8 - bb.length), bb); while (bb.length % 8) bb.push(0);
  const cw = []; for (let i = 0; i < bb.length; i += 8) cw.push(parseInt(bb.slice(i, i + 8).join(''), 2));
  for (let p = 0xec; cw.length < capBytes; p ^= 0xec ^ 0x11) cw.push(p);
  // split into blocks, add EC, interleave
  const blocks = []; let k = 0;
  for (let i = 0; i < b1 + b2; i++) { const n = i < b1 ? d1 : d2; const d = cw.slice(k, k + n); k += n; blocks.push({ d, e: rsRem(d, ecLen) }); }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
  if (out.length !== total) throw new Error('QR: internal size mismatch');

  const N = ver * 4 + 17, M = Array.from({ length: N }, () => new Array(N).fill(null)), fn = Array.from({ length: N }, () => new Array(N).fill(false));
  const set = (r, c, v) => { if (r >= 0 && r < N && c >= 0 && c < N) { M[r][c] = v; fn[r][c] = true; } };
  const finder = (r, c) => { for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) { const in_ = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6; const dark = in_ && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)); set(r + dr, c + dc, dark); } };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const ap = ALIGN[ver];
  for (const r of ap) for (const c of ap) { if ((r === 6 && c === 6) || (r === 6 && c === ap[ap.length - 1]) || (r === ap[ap.length - 1] && c === 6)) continue; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); }
  const drawFmt = (mask) => {
    const f = bchFmt((FMT[ecc] << 3) | mask), g = i => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(i, 8, g(i)); set(7, 8, g(6)); set(8, 8, g(7)); set(8, 7, g(8)); for (let i = 9; i < 15; i++) set(8, 14 - i, g(i));
    for (let i = 0; i < 8; i++) set(8, N - 1 - i, g(i)); for (let i = 8; i < 15; i++) set(N - 15 + i, 8, g(i));
    set(N - 8, 8, true);
  };
  drawFmt(0);
  if (ver >= 7) { const v = bchVer(ver); for (let i = 0; i < 18; i++) { const bit = ((v >>> i) & 1) === 1, a = N - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, bit); set(b, a, bit); } }
  // place data bits (zig-zag)
  const stream = []; out.forEach(b => bits(b, 8, stream));
  let bi = 0;
  for (let right = N - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let v = 0; v < N; v++) for (let j = 0; j < 2; j++) { const c = right - j, up = ((right + 1) & 2) === 0, r = up ? N - 1 - v : v; if (!fn[r][c] && bi < stream.length) M[r][c] = stream[bi++] === 1; else if (!fn[r][c]) M[r][c] = false; } }
  const MASK = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
  const penalty = (m) => {
    let p = 0;
    for (let r = 0; r < N; r++) for (const lines of [0, 1]) { let run = 1, prev = null; for (let c = 0; c < N; c++) { const v = lines ? m[c][r] : m[r][c]; if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = v; } } }
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
    const pat = [true, false, true, true, true, false, true, false, false, false, false], pat2 = [...pat].reverse();
    for (let r = 0; r < N; r++) for (let c = 0; c <= N - 11; c++) for (const lines of [0, 1]) { let a = true, b = true; for (let k = 0; k < 11; k++) { const v = lines ? m[c + k][r] : m[r][c + k]; if (v !== pat[k]) a = false; if (v !== pat2[k]) b = false; } if (a) p += 40; if (b) p += 40; }
    let dark = 0; for (const row of m) for (const v of row) if (v) dark++; p += Math.floor(Math.abs((dark * 100) / (N * N) - 50) / 5) * 10;
    return p;
  };
  let best = null, bestP = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const t = M.map(r => r.slice());
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!fn[r][c] && MASK[mk](r, c)) t[r][c] = !t[r][c];
    // apply format info for this mask on the trial matrix
    const save = M.map(r => r.slice()); for (let r = 0; r < N; r++) M[r] = t[r]; drawFmt(mk); const p = penalty(M);
    if (p < bestP) { bestP = p; best = M.map(r => r.slice()); }
    for (let r = 0; r < N; r++) M[r] = save[r];
  }
  return best;
}

export function toSvg(text, { ecc = 'M', scale = 4, margin = 4, fg = '#000', bg = '#fff', title = 'QR code' } = {}) {
  const m = encode(text, ecc), n = m.length, s = n + margin * 2; let d = '';
  for (let r = 0; r < n; r++) { let c = 0; while (c < n) { if (m[r][c]) { let e = c; while (e < n && m[r][e]) e++; d += `M${c + margin} ${r + margin}h${e - c}v1h${c - e}z`; c = e; } else c++; } }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s * scale}" height="${s * scale}" role="img" aria-label="${title}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
