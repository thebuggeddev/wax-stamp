import './style.css';
import * as THREE from 'three/webgpu';

const $ = s => document.querySelector(s);
const gpuEl = $('#gpu'), countEl = $('#count'), monoEl = $('#mono');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- small math ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t;
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash3(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967295;
}
function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi, s), b = hash3(xi + 1, yi, zi, s), c = hash3(xi, yi + 1, zi, s), d = hash3(xi + 1, yi + 1, zi, s);
  const e = hash3(xi, yi, zi + 1, s), f = hash3(xi + 1, yi, zi + 1, s), g = hash3(xi, yi + 1, zi + 1, s), h = hash3(xi + 1, yi + 1, zi + 1, s);
  const x0 = a + (b - a) * u, x1 = c + (d - c) * u, x2 = e + (f - e) * u, x3 = g + (h - g) * u;
  const y0 = x0 + (x1 - x0) * v, y1 = x2 + (x3 - x2) * v;
  return y0 + (y1 - y0) * w;
}
function fbm3(x, y, z, s = 0) { let a = 0, amp = .5, f = 1; for (let i = 0; i < 4; i++) { a += amp * noise3(x * f, y * f, z * f, s + i * 17); f *= 2.03; amp *= .5; } return a / .9375; }

/* ---------- procedural walnut grain ---------- */
function makeWoodTexture() {
  const W = 512, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const L = [156, 102, 62], M = [104, 63, 36], Dk = [50, 29, 16];
  for (let py = 0; py < H; py++) {
    const v = py / H * 2.4;
    for (let px = 0; px < W; px++) {
      // sample on a cylinder so the grain wraps around the handle without a seam
      const an = px / W * Math.PI * 2, cx = Math.cos(an), sy = Math.sin(an);
      const warp = fbm3(cx * 1.3 + 3, sy * 1.3, v * 1.5, 3);
      const s = cx * 1.2 + warp * 1.7 + v * .12;
      const band = Math.pow(.5 + .5 * Math.sin(s * Math.PI * 2 * 4.6), 2.4);
      const pore = Math.pow(noise3(cx * 30, sy * 30, v * 5.5, 9), 5);
      const fine = noise3(cx * 72, sy * 72, v * 1.4, 21);
      const t = clamp(band * .58 + warp * .36 + fine * .14 - .14, 0, 1);
      const k = 1 - pore * .4, i = (py * W + px) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const col = t < .5 ? lerp(L[ch], M[ch], t * 2) : lerp(M[ch], Dk[ch], (t - .5) * 2);
        d[i + ch] = col * k;
      }
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8;
  return tex;
}

function boxBlur(src, N, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), inv = 1 / (2 * r + 1);
  for (let y = 0; y < N; y++) {
    const row = y * N; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, N - 1)];
    for (let x = 0; x < N; x++) { tmp[row + x] = acc * inv; acc += src[row + Math.min(N - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, N - 1) * N + x];
    for (let y = 0; y < N; y++) { out[y * N + x] = acc * inv; acc += tmp[Math.min(N - 1, y + r + 1) * N + x] - tmp[Math.max(0, y - r) * N + x]; }
  }
  return out;
}

/* ---------- die designs ----------
   Each design is drawn white on black in a 1000 unit square, radius 500 is the die edge.
   White is metal left standing on the die face, which becomes raised wax on the seal.
   Black strokes drawn over white cut grooves (feather barbs, leaf veins, jewel holes). */
const TAU = Math.PI * 2;
const FONT = { black: '"UnifrakturMaguntia", "Old English Text MT", serif', roman: '"Cinzel", "Trajan Pro", Georgia, serif', script: '"Pinyon Script", "Snell Roundhand", cursive' };
const W_ = '#fff', B_ = '#000';
function ring(g, r, w) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
function beads(g, r, n, rad) { for (let i = 0; i < n; i++) { const a = i / n * TAU; g.beginPath(); g.arc(Math.sin(a) * r, -Math.cos(a) * r, rad, 0, TAU); g.fill(); } }
function starAt(g, x, y, R, r, n, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const rr = i % 2 ? r : R, a = rot + i * Math.PI / n; g.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr); }
  g.closePath(); g.fill();
}
function arcText(g, s, r, mid, size, family, bottom = false, track = 0, weight = '600') {
  g.font = `${weight} ${size}px ${family}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const chars = [...s], ws = chars.map(c => g.measureText(c).width + track);
  const tot = ws.reduce((a, b) => a + b, 0);
  let a = bottom ? mid + tot / r / 2 : mid - tot / r / 2;
  for (let i = 0; i < chars.length; i++) {
    const w = ws[i], ac = bottom ? a - w / 2 / r : a + w / 2 / r;
    g.save(); g.rotate(ac); g.translate(0, -r); if (bottom) g.rotate(Math.PI); g.fillText(chars[i], 0, 0); g.restore();
    a = bottom ? a - w / r : a + w / r;
  }
}
function fitText(g, s, family, maxW, maxH, weight = '400', start = 400) {
  let size = start; g.font = `${weight} ${size}px ${family}`;
  const m = g.measureText(s), h = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || size * .75;
  size *= Math.min(1, maxW / Math.max(1, m.width), maxH / h);
  g.font = `${weight} ${size}px ${family}`;
  const m2 = g.measureText(s);
  return { size, dy: (m2.actualBoundingBoxAscent - m2.actualBoundingBoxDescent) / 2 };
}
function centerText(g, s, family, x, y, maxW, maxH, weight = '400') {
  if (!s) return;
  const f = fitText(g, s, family, maxW, maxH, weight);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(s, x, y + f.dy);
}
function leaf(g, x, y, ang, len, wid) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * .45, -wid, len, 0); g.quadraticCurveTo(len * .45, wid, 0, 0); g.fill();
  g.strokeStyle = B_; g.lineWidth = Math.max(2, wid * .14); g.beginPath(); g.moveTo(len * .12, 0); g.lineTo(len * .8, 0); g.stroke();
  g.restore();
}
function branch(g, P, n, len0, wid0, stemW) {
  g.lineWidth = stemW; g.lineCap = 'round'; g.beginPath();
  for (let i = 0; i <= 40; i++) { const [x, y] = P(i / 40); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  for (let i = 0; i < n; i++) {
    const t = .06 + i / n * .88, [x, y] = P(t), [x2, y2] = P(t + .01);
    const tang = Math.atan2(y2 - y, x2 - x), sc = 1 - t * .4, side = i % 2 ? 1 : -1;
    leaf(g, x, y, tang + side * .62, len0 * sc, wid0 * sc);
  }
  const [x, y] = P(1), [x0, y0] = P(.98);
  leaf(g, x, y, Math.atan2(y - y0, x - x0), len0 * .6, wid0 * .6);
}
const arcP = (r, a0, a1) => t => { const a = a0 + (a1 - a0) * t; return [Math.sin(a) * r, -Math.cos(a) * r]; };
function heartPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * .9);
  g.bezierCurveTo(x - s * 1.45, y + s * .05, x - s * .85, y - s * 1.05, x, y - s * .38);
  g.bezierCurveTo(x + s * .85, y - s * 1.05, x + s * 1.45, y + s * .05, x, y + s * .9);
  g.closePath();
}

const DIES = [
  { id: 'mono', name: 'Monogram', text: true },
  { id: 'quill', name: 'Quill and sun', text: false },
  { id: 'crown', name: 'Crown', text: true },
  { id: 'hearts', name: 'Hearts', text: true },
  { id: 'compass', name: 'Air mail', text: false },
  { id: 'notary', name: 'Notary', text: false }
];
const DIE_DRAW = {
  mono(g, txt) {
    beads(g, 476, 72, 7); ring(g, 452, 6); ring(g, 360, 7);
    // scroll vine running round the band
    const rm = 406, n = 14;
    g.lineWidth = 7; g.lineCap = 'round'; g.beginPath();
    for (let i = 0; i <= 720; i++) { const a = i / 720 * TAU, r = rm + 17 * Math.sin(n * a); const x = Math.sin(a) * r, y = -Math.cos(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    for (let k = 0; k < n; k++) {
      const a = (Math.PI / 2 + TAU * k) / n / 1, side = 1;
      for (const s of [1, -1]) {
        const ac = s > 0 ? a : a + Math.PI / n, rc = rm + s * 10;
        const cx = Math.sin(ac + .09) * rc, cy = -Math.cos(ac + .09) * rc;
        g.lineWidth = 5.5; g.beginPath();
        for (let u = 0; u <= 30; u++) { const q = u / 30, ang = ac * 3 + q * 4.6 * side, rad = 17 * (1 - q * .8); const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad; u ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
        const al = ac - .1, rl = rm - s * 14;
        leaf(g, Math.sin(al) * rl, -Math.cos(al) * rl, al + (s > 0 ? Math.PI : 0), 26, 9);
      }
    }
    centerText(g, txt || 'WD', FONT.black, 0, -18, 540, 360);
    starAt(g, 0, 268, 36, 12, 8);
    for (const s of [-1, 1]) { g.lineWidth = 9; g.beginPath(); g.arc(s * 92, 250, 22, s > 0 ? Math.PI * .1 : Math.PI * .5, s > 0 ? Math.PI * .5 : Math.PI * .9 + .5); g.stroke(); }
  },
  quill(g) {
    ring(g, 472, 9); ring(g, 352, 6);
    arcText(g, 'BY HAND · BY HEART · BY WAX', 374, 0, 62, FONT.roman, false, 5);
    arcText(g, 'SEALED', 446, Math.PI, 60, FONT.roman, true, 14);
    starAt(g, Math.sin(1.95) * 404, -Math.cos(1.95) * 404, 15, 6, 4); starAt(g, Math.sin(-1.95) * 404, -Math.cos(-1.95) * 404, 15, 6, 4);
    // the sun rising behind
    const sx = -40, sy = -20;
    for (let i = 0; i < 17; i++) {
      const th = -Math.PI + .2 + i / 16 * (Math.PI - .4), L = i % 2 ? 175 : 265, w = i % 2 ? 7 : 11;
      const ux = Math.cos(th), uy = Math.sin(th), px = -uy, py = ux;
      g.beginPath(); g.moveTo(sx + ux * 98 + px * w, sy + uy * 98 + py * w); g.lineTo(sx + ux * L, sy + uy * L); g.lineTo(sx + ux * 98 - px * w, sy + uy * 98 - py * w); g.fill();
    }
    g.beginPath(); g.arc(sx, sy, 84, 0, TAU); g.fill();
    // laurel sprig, lower right
    branch(g, t => { const u = 1 - t; return [u * u * -10 + 2 * u * t * 210 + t * t * 270, u * u * 270 + 2 * u * t * 230 + t * t * -10]; }, 10, 74, 22, 8);
    // the quill, cut free from what lies behind it
    const ax = -205, ay = 250, bx = 215, by = -190, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const vane = side => { const pts = []; for (let i = 0; i <= 40; i++) { const t = .3 + i / 40 * .7, w = Math.pow(Math.sin(Math.PI * (t - .3) / .7 * .5 + Math.PI * .5 * (t > .85 ? (t - .85) / .15 : 0)), .7) * (side > 0 ? 62 : 46) * (t > .9 ? (1 - t) / .1 : 1); pts.push([ax + dx * t + nx * w * side, ay + dy * t + ny * w * side]); } return pts; };
    const outline = [...vane(1), ...vane(-1).reverse()];
    g.strokeStyle = B_; g.lineWidth = 20; g.beginPath(); outline.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
    g.lineWidth = 26; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + dx * .32, ay + dy * .32); g.stroke();
    g.fillStyle = W_; g.beginPath(); outline.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
    g.strokeStyle = B_; g.lineWidth = 3.2;
    for (let t = .34; t < .97; t += .028) for (const side of [1, -1]) {
      const x0 = ax + dx * t, y0 = ay + dy * t, len = side > 0 ? 70 : 52;
      g.beginPath(); g.moveTo(x0 + nx * 6 * side, y0 + ny * 6 * side); g.lineTo(x0 + (nx * side * .82 + ux * .55) * len, y0 + (ny * side * .82 + uy * .55) * len); g.stroke();
    }
    g.strokeStyle = W_; g.lineWidth = 10; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + dx * .99, ay + dy * .99); g.stroke();
  },
  crown(g, txt) {
    beads(g, 476, 64, 8); ring(g, 450, 6); ring(g, 350, 6);
    arcText(g, 'BY ORDER OF THE CROWN', 370, 0, 60, FONT.roman, false, 4);
    for (const a of [-.32, 0, .32]) starAt(g, Math.sin(Math.PI + a) * 400, -Math.cos(Math.PI + a) * 400, a ? 16 : 24, a ? 6 : 9, 5);
    branch(g, arcP(292, Math.PI + .22, Math.PI + 1.62), 9, 70, 21, 8);
    branch(g, arcP(292, Math.PI - .22, Math.PI - 1.62), 9, 70, 21, 8);
    const oy = -70;
    const pts = [[-150, 40], [-168, -70], [-110, -12], [-76, -118], [-38, -28], [0, -152], [38, -28], [76, -118], [110, -12], [168, -70], [150, 40]];
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y + oy) : g.moveTo(x, y + oy)); g.closePath(); g.fill();
    g.fillRect(-158, 36 + oy, 316, 54);
    for (const [x, y] of [pts[1], pts[3], pts[5], pts[7], pts[9]]) { g.beginPath(); g.arc(x, y + oy - 14, 17, 0, TAU); g.fill(); }
    g.fillRect(-7, -210 + oy, 14, 48); g.fillRect(-24, -194 + oy, 48, 14);
    g.fillStyle = B_;
    for (const x of [-100, 0, 100]) { g.beginPath(); g.arc(x, 63 + oy, x ? 11 : 15, 0, TAU); g.fill(); }
    g.fillRect(-158, 33 + oy, 316, 5); g.fillRect(-158, 88 + oy, 316, 5);
    for (const x of [-76, 0, 76]) { g.beginPath(); g.arc(x, (x ? -60 : -80) + oy, 9, 0, TAU); g.fill(); }
    g.fillStyle = W_;
    centerText(g, txt || 'WD', FONT.roman, 0, 150, 300, 110, '600');
  },
  hearts(g, txt) {
    ring(g, 472, 9); ring(g, 444, 5); ring(g, 350, 6);
    arcText(g, 'AMOR VINCIT OMNIA', 370, 0, 64, FONT.roman, false, 7);
    for (const a of [-.3, 0, .3]) { heartPath(g, Math.sin(Math.PI + a) * 397, -Math.cos(Math.PI + a) * 397 - 4, a ? 15 : 21); g.fill(); }
    // the arrow passes behind the heart
    const ax = -255, ay = 200, bx = 250, by = -200;
    g.lineWidth = 13; g.lineCap = 'butt'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx - 30, by + 24); g.stroke();
    g.beginPath(); g.moveTo(bx + 12, by - 10); g.lineTo(bx - 58, by + 8); g.lineTo(bx - 22, by + 52); g.closePath(); g.fill();
    for (let i = 0; i < 3; i++) { const t = i * 26; g.lineWidth = 9; g.beginPath(); g.moveTo(ax + 18 + t * .78, ay - 14 - t * .62); g.lineTo(ax - 14 + t * .78, ay - 48 - t * .62); g.moveTo(ax + 18 + t * .78, ay - 14 - t * .62); g.lineTo(ax + 50 + t * .78, ay + 18 - t * .62); g.stroke(); }
    heartPath(g, 0, -6, 205); g.strokeStyle = B_; g.lineWidth = 50; g.stroke(); g.fillStyle = B_; g.fill();
    heartPath(g, 0, -6, 205); g.strokeStyle = W_; g.lineWidth = 20; g.stroke(); g.fillStyle = W_;
    heartPath(g, 0, -6, 172); g.strokeStyle = W_; g.lineWidth = 5; g.stroke();
    centerText(g, txt || 'WD', FONT.script, 0, -14, 250, 150);
    branch(g, t => [-40 - t * 180, 290 - t * 70 - Math.sin(t * 3) * 14], 7, 52, 16, 6);
    branch(g, t => [40 + t * 180, 290 - t * 70 - Math.sin(t * 3) * 14], 7, 52, 16, 6);
  },
  compass(g) {
    ring(g, 472, 9); ring(g, 436, 4); ring(g, 352, 6);
    arcText(g, 'PAR AVION', 374, 0, 70, FONT.roman, false, 20);
    arcText(g, 'BY AIR MAIL', 446, Math.PI, 60, FONT.roman, true, 12);
    starAt(g, 404, 0, 16, 6, 4); starAt(g, -404, 0, 16, 6, 4);
    const kite = (a, R, rb, half) => { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a - half) * rb, -Math.cos(a - half) * rb); g.lineTo(Math.sin(a) * R, -Math.cos(a) * R); g.lineTo(Math.sin(a + half) * rb, -Math.cos(a + half) * rb); g.closePath(); };
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + TAU / 16; kite(a, 175, 46, .5); g.fill(); }
    g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.stroke();
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; kite(a, 312, 70, .38); g.strokeStyle = B_; g.lineWidth = 12; g.stroke(); g.fill(); }
    g.strokeStyle = B_; g.lineWidth = 4;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * (i % 2 ? 175 : 312), -Math.cos(a) * (i % 2 ? 175 : 312)); g.stroke(); }
    g.strokeStyle = W_;
    g.fillStyle = B_; g.beginPath(); g.arc(0, 0, 36, 0, TAU); g.fill(); g.fillStyle = W_; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill();
  },
  notary(g) {
    beads(g, 476, 76, 6); ring(g, 452, 5); ring(g, 352, 6);
    arcText(g, 'NOTARY PUBLIC', 374, 0, 66, FONT.roman, false, 12);
    arcText(g, 'SEAL OF OFFICE', 446, Math.PI, 56, FONT.roman, true, 8);
    starAt(g, 404, 0, 18, 7, 5); starAt(g, -404, 0, 18, 7, 5);
    g.fillRect(-13, -175, 26, 380);
    g.beginPath(); g.moveTo(-90, 245); g.lineTo(90, 245); g.lineTo(55, 205); g.lineTo(-55, 205); g.closePath(); g.fill();
    g.beginPath(); g.arc(0, -200, 26, 0, TAU); g.fill();
    g.lineWidth = 15; g.lineCap = 'round'; g.beginPath(); g.moveTo(-220, -130); g.quadraticCurveTo(0, -175, 220, -130); g.stroke();
    for (const s of [-1, 1]) {
      const hx = s * 215, hy = -130;
      g.lineWidth = 5; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - 78, 50); g.moveTo(hx, hy); g.lineTo(hx + 78, 50); g.stroke();
      g.beginPath(); g.moveTo(hx - 95, 48); g.quadraticCurveTo(hx, 140, hx + 95, 48); g.closePath(); g.fill();
      g.beginPath(); g.arc(hx, hy, 11, 0, TAU); g.fill();
    }
    branch(g, t => [-30 - t * 150, 300 - t * 40], 6, 46, 15, 6);
    branch(g, t => [30 + t * 150, 300 - t * 40], 6, 46, 15, 6);
  }
};
function drawDie(g, id, txt, size) {
  g.save();
  g.setTransform(size / 1000, 0, 0, size / 1000, size / 2, size / 2);
  g.fillStyle = W_; g.strokeStyle = W_; g.lineCap = 'round'; g.lineJoin = 'round';
  (DIE_DRAW[id] || DIE_DRAW.mono)(g, txt);
  g.restore();
}

/* ---------- emblem pipeline: one drawing, four textures and a height field ---------- */
const EMB_N = 768;
const embCache = new Map();
const dieUsesText = id => (DIES.find(d => d.id === id) || DIES[0]).text;
const embKey = (id, txt) => id + '|' + (dieUsesText(id) ? txt : '');
function getEmblem(key) {
  if (embCache.has(key)) return embCache.get(key);
  const [id, txt] = key.split('|');
  const N = EMB_N, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = B_; g.fillRect(0, 0, N, N);
  drawDie(g, id, txt, N);
  const img = g.getImageData(0, 0, N, N).data;
  let raw = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) raw[i] = img[i * 4] / 255;
  const Hs = boxBlur(boxBlur(raw, N, 1), N, 1);          // crisp: drives the normal maps
  const Hg = boxBlur(boxBlur(Hs, N, 5), N, 4);           // soft: drives the wax geometry
  // seal textures: raised relief, lighter where the wax stands up
  const nc = document.createElement('canvas'), tc = document.createElement('canvas');
  nc.width = nc.height = tc.width = tc.height = N;
  const ng = nc.getContext('2d'), tg = tc.getContext('2d');
  const ni = ng.createImageData(N, N), ti = tg.createImageData(N, N);
  const h = (x, y) => Hs[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)];
  const s = 5.6, half = N / 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let nx = -(h(x + 1, y) - h(x - 1, y)) * s, ny = (h(x, y + 1) - h(x, y - 1)) * s;
    const l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
    ni.data[i] = (nx / l * .5 + .5) * 255; ni.data[i + 1] = (ny / l * .5 + .5) * 255; ni.data[i + 2] = (1 / l * .5 + .5) * 255; ni.data[i + 3] = 255;
    const inside = Math.hypot(x - half, y - half) < half * .995;
    const shade = inside ? .7 + .32 * Hs[y * N + x] - .08 * Math.max(0, Hg[y * N + x] - Hs[y * N + x]) : 1;
    ti.data[i] = ti.data[i + 1] = ti.data[i + 2] = shade * 255; ti.data[i + 3] = 255;
  }
  ng.putImageData(ni, 0, 0); tg.putImageData(ti, 0, 0);
  const normal = new THREE.CanvasTexture(nc); normal.colorSpace = THREE.NoColorSpace; normal.anisotropy = 8;
  const tone = new THREE.CanvasTexture(tc); tone.colorSpace = THREE.NoColorSpace; tone.anisotropy = 8;
  const e = { key, id, txt, N, Hs, Hg, normal, tone };
  embCache.set(key, e);
  return e;
}
function sampleEmb(e, x, y, Rd) {
  const N = e.N, fx = (.5 + x / (2 * Rd)) * N - .5, fy = (.5 - y / (2 * Rd)) * N - .5;
  if (fx < 0 || fy < 0 || fx >= N - 1 || fy >= N - 1) return 0;
  const xi = fx | 0, yi = fy | 0, tx = fx - xi, ty = fy - yi, H = e.Hg, i = yi * N + xi;
  const a = H[i] + (H[i + 1] - H[i]) * tx, b = H[i + N] + (H[i + N + 1] - H[i + N]) * tx;
  return a + (b - a) * ty;
}
// die face: the same drawing, mirrored and cut into the brass
function makeDieTextures(e) {
  const N = e.N;
  const nc = document.createElement('canvas'), cc = document.createElement('canvas');
  nc.width = nc.height = cc.width = cc.height = N;
  const ng = nc.getContext('2d'), cg = cc.getContext('2d');
  const ni = ng.createImageData(N, N), ci = cg.createImageData(N, N);
  const h = (x, y) => e.Hs[clamp(y, 0, N - 1) * N + (N - 1 - clamp(x, 0, N - 1))];
  const s = 4.2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * s, dy = (h(x, y + 1) - h(x, y - 1)) * s;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    ni.data[i] = (dx / l * .5 + .5) * 255; ni.data[i + 1] = (-dy / l * .5 + .5) * 255; ni.data[i + 2] = (1 / l * .5 + .5) * 255; ni.data[i + 3] = 255;
    const v = 255 * (1 - .55 * h(x, y));
    ci.data[i] = v; ci.data[i + 1] = v * .97; ci.data[i + 2] = v * .92; ci.data[i + 3] = 255;
  }
  ng.putImageData(ni, 0, 0); cg.putImageData(ci, 0, 0);
  const normal = new THREE.CanvasTexture(nc); normal.colorSpace = THREE.NoColorSpace;
  const color = new THREE.CanvasTexture(cc); color.colorSpace = THREE.SRGBColorSpace;
  normal.anisotropy = color.anisotropy = 8;
  return { normal, color };
}
// small previews for the die picker
function dieThumb(id, txt, hex = '#5C0A12', S = 132) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const bg = rgb.map(v => Math.round(v * .62)), fg = rgb.map(v => Math.round(v + (255 - v) * .62));
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  drawDie(g, id, txt, S);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${fg.map((v, i) => Math.max(0, v - bg[i])).join(',')})`; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgb(${bg.join(',')})`; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.fill();
  return c.toDataURL();
}

/* ---------- wax seal geometry ---------- */
// Units are CSS pixels. Die radius 48px. Pressed floor 3.3px, raised design +1.1px (fine detail comes from the normal map), wax rim 6.2px.
// spread > 1 is a longer press: the outline grows and the body thins, roughly keeping the wax volume.
function buildSealGeometry(emb, seed, k, spread = 1) {
  const rnd = mulberry32(seed);
  const Rd = DIE_R * k, Rc = Rd + 3.2 * k, Rb = Rd + (16 + rnd() * 5) * k;
  const scal = 7 + Math.floor(rnd() * 3), sp0 = rnd() * 6.283;
  const p = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const lobes = [];
  const nl = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < nl; i++) lobes.push({ a: rnd() * Math.PI * 2, w: .14 + rnd() * .26, amp: (1 + rnd() * 5) * k });
  const ox = rnd() * 200, oy = rnd() * 200;
  const Hp = 3.3 * k, rel = 1.1 * k, Hb = 6.2 * k * (1 - .32 * (spread - 1)), lipA = 1.6 * k;
  const NS = 288, NRi = 60, NRo = 44, NR = NRi + NRo;
  const count = 1 + NR * NS;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let Rmax = 0;
  const height = (x, y, r, Rt) => {
    let inner = 0;
    if (r < Rd + .5 * k) inner = Hp + rel * sampleEmb(emb, x, y, Rd);
    const ro = Math.max(r, Rd);
    const t = (ro - Rd) / (Rt - Rd);
    const edge = t < .32 ? .9 + .1 * Math.sin(t / .32 * Math.PI / 2) : Math.pow(Math.max(0, 1 - Math.pow((t - .32) / .68, 2)), .6);
    const lip = lipA * Math.exp(-Math.pow((ro - Rd - 1.4 * k) / (2.7 * k), 2));
    const wob = (noise3(x / k * .07 + ox, y / k * .07 + oy, 0, 5) - .5) * .9 * k + (noise3(x / k * .45, y / k * .45, oy, 8) - .5) * .1 * k;
    const outer = (Hb + lip + wob) * edge;
    const bl = smooth(Rd - 1.1 * k, Rd + .7 * k, r);
    return inner * (1 - bl) + outer * bl;
  };
  // tone: slow mottling through the wax, and thin edges that let more light through
  const tone = (x, y, r, Rt) => {
    const m = 1 + (noise3(x / k * .045 + ox, y / k * .045 + oy, 3, 11) - .5) * .16;
    const t = r > Rd ? (r - Rd) / (Rt - Rd) : 0;
    return m * (1 + .26 * smooth(.72, 1, t));
  };
  const setV = (o, x, y, z, c) => { pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; col[o] = col[o + 1] = col[o + 2] = c; const u = o / 3 * 2; uv[u] = .5 + x / (2 * Rd); uv[u + 1] = .5 + y / (2 * Rd); };
  setV(0, 0, 0, height(0, 0, 0, Rb), tone(0, 0, 0, Rb));
  for (let j = 0; j < NS; j++) {
    const th = j / NS * Math.PI * 2;
    let Rt = Rb * (1 + .03 * Math.sin(scal * th + sp0) + .025 * Math.sin(3 * th + p[0]) + .018 * Math.sin(5 * th + p[1]) + .01 * Math.sin(11 * th + p[2]) + .006 * Math.sin(17 * th + p[3]));
    for (const L of lobes) { const da = Math.atan2(Math.sin(th - L.a), Math.cos(th - L.a)); Rt += L.amp * Math.exp(-((da / L.w) ** 2)); }
    Rt = Rd + (Rt - Rd) * spread + (spread - 1) * 6 * k;
    Rmax = Math.max(Rmax, Rt);
    const c = Math.cos(th), s = Math.sin(th);
    for (let i = 1; i <= NR; i++) {
      const r = i <= NRi ? Rc * i / NRi : Rc + (Rt - Rc) * (i - NRi) / NRo;
      const x = r * c, y = r * s;
      setV((1 + (i - 1) * NS + j) * 3, x, y, i === NR ? 0 : height(x, y, r, Rt), tone(x, y, r, Rt));
    }
  }
  const idx = new Uint32Array(NS * 3 + (NR - 1) * NS * 6);
  let q = 0;
  for (let j = 0; j < NS; j++) { idx[q++] = 0; idx[q++] = 1 + j; idx[q++] = 1 + (j + 1) % NS; }
  for (let i = 1; i < NR; i++) for (let j = 0; j < NS; j++) {
    const j2 = (j + 1) % NS;
    const a = 1 + (i - 1) * NS + j, b = 1 + (i - 1) * NS + j2, c = 1 + i * NS + j2, d = 1 + i * NS + j;
    idx[q++] = a; idx[q++] = d; idx[q++] = c; idx[q++] = a; idx[q++] = c; idx[q++] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, Rmax, top: Hb + lipA };
}

/* ---------- wax colors ---------- */
const DIE_R = 48;
const WAXES = [
  { id: 'oxblood', name: 'Oxblood', hex: '#5C0A12', metal: 0, rough: .36 },
  { id: 'navy', name: 'Navy', hex: '#16224A', metal: 0, rough: .36 },
  { id: 'forest', name: 'Forest', hex: '#153A27', metal: 0, rough: .38 },
  { id: 'gold', name: 'Gold', hex: '#C49A3E', metal: .8, rough: .3 },
  { id: 'black', name: 'Black', hex: '#0A0A0C', metal: 0, rough: .46 },
  { id: 'ivory', name: 'Ivory', hex: '#E2D5B8', metal: 0, rough: .42 }
];

/* ---------- state ---------- */
let W = innerWidth, H = innerHeight, D = 1;
const FOV = 28;
const stampK = () => (Math.min(W, H) < 560 ? .72 : 1);
let dieId = 'mono', initials = 'WD', stampType = 'walnut';
const curKey = () => embKey(dieId, initials);
let waxId = 'oxblood';
let soundOn = true;
const seals = [];   // { mesh, shadow, data, born, mat, shared, spread, hot }
const dying = [];
const PREFS_V = 2;
const STORE = 'waxdie.seals.v4', PREFS = 'waxdie.prefs.v2';
const MAX_SEALS = 140;

try {
  const pr = JSON.parse(localStorage.getItem(PREFS) || 'null');
  if (pr) { if (typeof pr.initials === 'string') initials = pr.initials.slice(0, 3); if (DIES.some(d => d.id === pr.die)) dieId = pr.die; if (WAXES.some(w => w.id === pr.wax)) waxId = pr.wax; if (['walnut', 'crystal', 'rosewood'].includes(pr.stamp)) stampType = pr.stamp; if (pr.sound === false) soundOn = false; }
} catch (e) {}
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify({ initials, die: dieId, wax: waxId, stamp: stampType, sound: soundOn })); } catch (e) {} };
const saveSeals = () => { try { localStorage.setItem(STORE, JSON.stringify(seals.map(s => s.data))); } catch (e) {} };

/* ---------- wax swatches: the dock and the studio stay in sync ---------- */
const waxesEl = $('#waxes'), waxPanelEl = $('#waxPanel');
const waxButtons = [];
for (const w of WAXES) {
  const a = document.createElement('button');
  a.className = 'sw'; a.style.setProperty('--c', w.hex); a.setAttribute('aria-label', `${w.name} wax`); a.title = `${w.name} wax`;
  const b = document.createElement('button');
  b.innerHTML = `<i style="--c:${w.hex}"></i>${w.name}`; b.setAttribute('aria-label', `${w.name} wax`);
  for (const el of [a, b]) el.addEventListener('click', () => setWax(w.id));
  waxesEl.appendChild(a); waxPanelEl.appendChild(b); waxButtons.push([w.id, a, b]);
}
function paintWax() { for (const [id, a, b] of waxButtons) { a.setAttribute('aria-pressed', String(id === waxId)); b.setAttribute('aria-pressed', String(id === waxId)); } }
function setWax(id) { waxId = id; paintWax(); savePrefs(); if (typeof paintDies === 'function') paintDies(); }
paintWax();
monoEl.value = initials;
if (matchMedia('(pointer: coarse)').matches) $('#hint').textContent = 'Tap anywhere to seal it. Hold longer for a wider seal. Tap the stamp below to change the handle, die and initials.';
const soundBtn = $('#sound');
const paintSound = () => { soundBtn.setAttribute('aria-pressed', String(soundOn)); soundBtn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off'); $('#waves').style.opacity = soundOn ? 1 : .15; };
paintSound();
soundBtn.addEventListener('click', () => { soundOn = !soundOn; paintSound(); savePrefs(); });
const paintCount = () => { const n = seals.length; countEl.textContent = `${n} seal${n === 1 ? '' : 's'}`; };

/* ---------- sound: a short wooden thock ---------- */
let actx = null;
function thock() {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const o = actx.createOscillator(), og = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + .13);
    og.gain.setValueAtTime(.0001, t); og.gain.exponentialRampToValueAtTime(.55, t + .005); og.gain.exponentialRampToValueAtTime(.0001, t + .2);
    o.connect(og).connect(actx.destination); o.start(t); o.stop(t + .22);
    const len = Math.floor(actx.sampleRate * .06), buf = actx.createBuffer(1, len, actx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const n = actx.createBufferSource(); n.buffer = buf;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = .9;
    const ng = actx.createGain(); ng.gain.value = .22;
    n.connect(bp).connect(ng).connect(actx.destination); n.start(t);
  } catch (e) {}
}

// the wax letting go of the die as it lifts
function peel() {
  if (!soundOn || !actx) return;
  try {
    const t = actx.currentTime, len = Math.floor(actx.sampleRate * .09);
    const buf = actx.createBuffer(1, len, actx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const e = i / len; ch[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * e) * (1 - e); }
    const n = actx.createBufferSource(); n.buffer = buf;
    const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = actx.createGain(); g.gain.value = .07;
    n.connect(hp).connect(g).connect(actx.destination); n.start(t);
  } catch (e) {}
}

/* ---------- renderer ---------- */
let renderer;
try {
  renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.id = 'stage';
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const webgpu = renderer.backend && renderer.backend.isWebGPUBackend;
  gpuEl.innerHTML = webgpu ? 'Rendering with <b>WebGPU</b>' : 'WebGPU is not available here, so this runs on <b>WebGL 2</b>';
} catch (err) {
  gpuEl.textContent = 'The 3D stamp could not start in this browser.';
  throw err;
}

// the dies are drawn with web fonts, so wait for them (but never forever)
try {
  await Promise.race([
    Promise.all(['400 100px "UnifrakturMaguntia"', '600 100px "Cinzel"', '400 100px "Pinyon Script"'].map(f => document.fonts.load(f))),
    new Promise(r => setTimeout(r, 2500))
  ]);
} catch (e) {}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, W / H, 20, 5000);

// A small photo studio for reflections, built for a camera looking straight down at a desk.
// Directly overhead is a soft, dim diffuser, so flat glossy wax reflects very little.
// The bright softbox sits off to the upper left, where only slopes facing it catch a highlight.
function makeStudioEnv() {
  const sc = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 64, 32);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / 100;
    const v = z >= 0 ? lerp(.42, .26, z) : lerp(.42, .05, Math.min(1, -z * 1.6));
    col[i * 3] = v * .96; col[i * 3 + 1] = v * .99; col[i * 3 + 2] = v * 1.04;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sc.add(new THREE.Mesh(geo, new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, vertexColors: true })));
  const panel = (dir, w, h, power, tint) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(tint).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.copy(dir.normalize().multiplyScalar(70)); m.lookAt(0, 0, 0); sc.add(m);
  };
  panel(new THREE.Vector3(-.62, .72, .85), 46, 30, 5, '#fff2e2');
  panel(new THREE.Vector3(.75, -.55, .5), 40, 16, 1.3, '#e6eeff');
  panel(new THREE.Vector3(0, 0, 1), 64, 64, .55, '#ffffff');
  return sc;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(makeStudioEnv(), .02, .1, 400).texture;
scene.environmentIntensity = 1;

scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x55606c, .6));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
const LIGHT_DIR = new THREE.Vector3(-.42, .52, 1.25).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10; sun.shadow.camera.far = 2600;
sun.shadow.bias = -.0006; sun.shadow.normalBias = .35; sun.shadow.radius = 3;
scene.add(sun, sun.target);

const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowNodeMaterial({ color: 0x0b1a33, opacity: .3, depthWrite: false }));
catcher.receiveShadow = true; catcher.position.z = -.4; catcher.renderOrder = 0;
scene.add(catcher);

const sealLayer = new THREE.Group();
scene.add(sealLayer);

const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(8,16,32,.75)'); gr.addColorStop(.62, 'rgba(8,16,32,.6)'); gr.addColorStop(.8, 'rgba(8,16,32,.16)'); gr.addColorStop(1, 'rgba(8,16,32,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const shadowGeo = new THREE.PlaneGeometry(1, 1);
const shadowMat = new THREE.MeshBasicNodeMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: .42 });

// node material clone() does not carry every property across, so wax materials are always built from their recipe
const waxDef = id => WAXES.find(w => w.id === id) || WAXES[0];
function makeWax(id, extra = {}) {
  const w = waxDef(id);
  return new THREE.MeshPhysicalNodeMaterial({
    color: w.hex, metalness: w.metal, roughness: w.rough, vertexColors: true,
    clearcoat: w.metal ? .2 : .28, clearcoatRoughness: .3,
    sheen: w.metal ? 0 : .08, sheenRoughness: .6, sheenColor: new THREE.Color(w.hex).lerp(new THREE.Color('#ffffff'), .35),
    ...extra
  });
}
// one material per wax color and die design: the die's relief arrives as a normal map and a tone map
const sealMats = new Map();
const reliefOf = key => { const e = getEmblem(key); return { map: e.tone, normalMap: e.normal, normalScale: new THREE.Vector2(.8, .8) }; };
function sealMat(c, key) {
  const k = c + '#' + key;
  if (!sealMats.has(k)) sealMats.set(k, makeWax(c, reliefOf(key)));
  return sealMats.get(k);
}
// molten wax: same color, smoother surface. It only ever gets glossier, never lighter.
function makeHotMat(id, key) {
  const shared = sealMat(id, key);
  return makeWax(id, { ...reliefOf(key), roughness: Math.max(.12, shared.roughness * .4), clearcoat: Math.min(.6, shared.clearcoat + .2), clearcoatRoughness: .1 });
}

// the drip of molten wax that pools before the die lands
const puddleGeo = (() => {
  const pts = [];
  for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a), Math.pow(Math.sin(a), .55))); }
  const g = new THREE.LatheGeometry(pts, 72); g.rotateX(Math.PI / 2);
  const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(1);
  for (let i = 0; i < n; i++) { const r = Math.hypot(g.attributes.position.getX(i), g.attributes.position.getY(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 1 + .22 * smooth(.7, 1, r); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const uvs = g.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, .001, .001);
  return g;
})();

/* ---------- the stamp ---------- */
const woodTex = makeWoodTexture();
const brassMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xc9a14f, metalness: 1, roughness: .28 });
const woodMat = new THREE.MeshPhysicalNodeMaterial({ map: woodTex, roughness: .5, clearcoat: .45, clearcoatRoughness: .26 });
let dieTex = makeDieTextures(getEmblem(curKey()));
const faceMat = new THREE.MeshPhysicalNodeMaterial({ map: dieTex.color, normalMap: dieTex.normal, color: 0xc9a14f, metalness: 1, roughness: .32 });

/* Cut crystal. The page behind is HTML, not part of the scene, so there is no real refraction to sample.
   Instead every flat facet mirrors a different part of the studio, giving the light and dark mosaic of cut glass,
   and a little transparency lets the page and the brass tang show through. */
const crystalMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xF4F8FF, metalness: .74, roughness: .03, clearcoat: 1, clearcoatRoughness: .02, iridescence: .45, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 520], flatShading: true, transparent: true, opacity: .8 });
const rosewoodMat = new THREE.MeshPhysicalNodeMaterial({ map: woodTex, color: 0xC56C55, roughness: .34, clearcoat: .75, clearcoatRoughness: .14 });
const silkMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xA3202A, roughness: .55, sheen: 1, sheenRoughness: .35, sheenColor: new THREE.Color(0xE8828A) });
const threadMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xC9A14F, metalness: .6, roughness: .45 });

const stamp = new THREE.Group();
const stampAxis = new THREE.Group(); stampAxis.rotation.x = Math.PI / 2;
const stampTwist = new THREE.Group();
stamp.add(stampAxis); stampAxis.add(stampTwist); scene.add(stamp);

/* Every stamp is modelled standing up, with the die face at y = 0 and the handle rising along +y.
   The die face itself is shared, so recutting the die works the same for all three. */
const STAMPS = [
  { id: 'walnut', name: 'Walnut', note: 'Turned handle, brass die' },
  { id: 'crystal', name: 'Crystal', note: 'Cut glass, brass core' },
  { id: 'rosewood', name: 'Rosewood', note: 'Fluted, silk tassel' }
];
const V2 = pts => pts.map(([r, y]) => new THREE.Vector2(r, y));
const lathe = (pts, mat, seg = 112) => new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat);
const turned = (start, ctrl, n = 180) => [new THREE.Vector2(...start), ...new THREE.SplineCurve(V2(ctrl)).getPoints(n)];
function brassFoot() {
  const R = DIE_R + .7;
  return lathe(V2([[R - 1.4, 0], [R - .3, .7], [R, 2], [R, 9.6], [R - .8, 11.2], [R - 4, 12.6], [R - 12, 13.8], [30, 15.2], [26, 17.4], [23.6, 21], [22.7, 26], [22.7, 30], [24, 31.4], [24, 35.6], [22.2, 37.2], [20.2, 37.8]]), brassMat);
}
const tasselAnchor = new THREE.Object3D();
const BUILD = {
  walnut() {
    const wood = lathe(turned([0, 34], [
      [20.6, 34], [20.3, 41], [17, 53], [14.2, 66], [13.7, 78], [16, 92], [21.5, 110], [25, 126], [25.6, 138], [22.6, 152],
      [16.6, 162], [13.3, 169], [13.3, 173.5], [16.6, 180.5], [22, 190], [24.6, 200], [23.6, 210], [19.2, 217.5], [11.5, 223], [5, 225.2], [0, 225.6]]), woodMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(13.9, 1.7, 16, 96), brassMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 171.2;
    return [brassFoot(), wood, ring];
  },
  crystal() {
    // an octagonal cut crystal: straight segments between profile points, so each band is a flat facet
    const prof = [[0, 36], [19.6, 36], [16.6, 44], [19, 55], [13.6, 73], [12.2, 92], [15.2, 112], [21.6, 133], [26.2, 153], [24.8, 173], [18, 189], [8.6, 200], [0, 203]];
    const outer = new THREE.LatheGeometry(V2(prof), 12).toNonIndexed(); outer.computeVertexNormals();
    const glass = new THREE.Mesh(outer, crystalMat); glass.renderOrder = 5;
    glass.userData.noShadow = true;   // clear glass lets most light through, so only the brass inside it casts a shadow
    const tang = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 86, 20), brassMat); tang.position.y = 36 + 43;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(19.4, 1.6, 12, 64), brassMat); collar.rotation.x = Math.PI / 2; collar.position.y = 37;
    return [brassFoot(), tang, collar, glass];
  },
  rosewood() {
    const body = new THREE.LatheGeometry(turned([0, 34], [
      [20.6, 34], [21.2, 40], [18.4, 46], [15.4, 52], [14.8, 60], [17.2, 68], [15.6, 76], [15.8, 84], [16.4, 112], [15.9, 144],
      [18, 151], [20, 157], [16.4, 164], [13, 170], [15.2, 177], [20.4, 185], [22.4, 195], [20.6, 205], [15, 211], [13.4, 213.5], [0, 214]], 200), 160);
    // reed the column: fourteen shallow flutes cut along its length
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r < 1) continue;
      const f = smooth(84, 92, y) * (1 - smooth(136, 144, y));
      if (!f) continue;
      const th = Math.atan2(z, x), k = 1 - .085 * f * (.5 + .5 * Math.cos(14 * th));
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    body.computeVertexNormals();
    const wood = new THREE.Mesh(body, rosewoodMat);
    const cap = lathe(V2([[13.2, 212], [15.4, 213], [15.8, 216.5], [12.6, 220.5], [6, 222.6], [0, 223]]), brassMat);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(5.2, 1.5, 12, 40), brassMat); eye.position.y = 228;
    const band1 = new THREE.Mesh(new THREE.TorusGeometry(16.6, 1.3, 12, 80), brassMat); band1.rotation.x = Math.PI / 2; band1.position.y = 86;
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(16.6, 1.3, 12, 80), brassMat); band2.rotation.x = Math.PI / 2; band2.position.y = 142;
    tasselAnchor.position.set(0, 230, 0);
    return [brassFoot(), wood, cap, eye, band1, band2, tasselAnchor];
  }
};
function buildStamp(type) {
  for (const m of [...stampTwist.children]) { stampTwist.remove(m); if (m !== dieFace && m.geometry) m.geometry.dispose(); }
  const parts = (BUILD[type] || BUILD.walnut)();
  for (const m of [dieFace, ...parts]) { m.castShadow = !m.userData.noShadow; m.receiveShadow = true; stampTwist.add(m); }
  tassel.visible = type === 'rosewood'; tasselReset = true;
}
const dieFace = new THREE.Mesh(new THREE.CircleGeometry(DIE_R + .65, 128), faceMat);
dieFace.rotation.x = Math.PI / 2;

/* ---------- the silk tassel: a cord, a wrapped head and a skirt of threads, hanging from the eyelet ---------- */
const tassel = new THREE.Group();
{
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 10), silkMat); cord.position.y = -15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(6.4, 28, 18), threadMat); head.scale.y = 1.35; head.position.y = -35;
  const neck = new THREE.Mesh(new THREE.TorusGeometry(5.6, 1.3, 10, 32), threadMat); neck.rotation.x = Math.PI / 2; neck.position.y = -42;
  const skirtG = new THREE.LatheGeometry(V2([[0, -43], [5.6, -43], [7.2, -49], [9.4, -66], [11.2, -82], [10.6, -85], [0, -85.4]]), 96);
  const sp = skirtG.attributes.position;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), z = sp.getZ(i), th = Math.atan2(z, x), k = 1 - .12 * (.5 + .5 * Math.cos(48 * th)); sp.setX(i, x * k); sp.setZ(i, z * k); }
  skirtG.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtG, silkMat);
  for (const m of [cord, head, neck, skirt]) { m.castShadow = true; m.receiveShadow = true; tassel.add(m); }
}
tassel.visible = false;
scene.add(tassel);
const TASSEL_L = 58;                        // pivot to centre of mass, in px before scaling
const tPivot = new THREE.Vector3(), tTip = new THREE.Vector3(), tPrev = new THREE.Vector3(), tAxis = new THREE.Vector3(), tQ = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0), GRAV = new THREE.Vector3(0, 0, -1500);
let tasselReset = true;
// Verlet pendulum: the tip keeps its momentum while the eyelet moves, so the tassel swings when the stamp travels
function stepTassel(dt, k) {
  if (!tassel.visible) return;
  stamp.updateMatrixWorld(true);
  tasselAnchor.getWorldPosition(tPivot);
  const L = TASSEL_L * k * 1.35;
  if (tasselReset) { tTip.copy(tPivot).add(new THREE.Vector3(0, 0, -L)); tPrev.copy(tTip); tasselReset = false; }
  tAxis.set(0, 1, 0).applyQuaternion(stampTwist.getWorldQuaternion(tQ));
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n, d = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.copy(tTip).sub(tPrev).multiplyScalar(.992);
    tPrev.copy(tTip);
    tTip.add(v).addScaledVector(GRAV, h * h);
    d.copy(tTip).sub(tPivot);
    // keep the tassel outside the handle and above the paper
    const along = d.dot(tAxis);
    if (along < 6 * k) {
      const radial = d.clone().addScaledVector(tAxis, -along), rmin = 26 * k;
      if (radial.length() < rmin) { if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0); radial.setLength(rmin); d.copy(radial).addScaledVector(tAxis, along); }
    }
    d.setLength(L);
    tTip.copy(tPivot).add(d);
    if (tTip.z < 4 * k) tTip.z = 4 * k;
  }
  tassel.position.copy(tPivot);
  tassel.quaternion.setFromUnitVectors(DOWN, d.copy(tTip).sub(tPivot).normalize());
  tassel.scale.setScalar(k * 1.35);
}
buildStamp(stampType);


const S = { x: 0, y: 0, z: 46, a: .74, b: .36, va: 0, vb: 0, tw: 0, vx: 0, vy: 0 };
const T = { x: 0, y: 0 };
let press = null, inspect = null;
let lastTime = performance.now();

function layout() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  D = (H / 2) / Math.tan(FOV * Math.PI / 360);
  camera.position.set(0, 0, D); camera.far = D + 3000; camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  catcher.scale.set(W * 3, H * 3, 1);
  const e = 360 * stampK();
  Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e });
  sun.shadow.camera.updateProjectionMatrix();
  for (const s of seals) placeSeal(s);
}
function placeSeal(s) {
  const d = s.data;
  s.mesh.position.set(d.x, H / 2 - d.py, d.z);
  s.shadow.position.set(d.x + 3 * d.k, H / 2 - d.py - 4.5 * d.k, -.2);
}
function parkStamp() {
  const r = $('#sealTarget').getBoundingClientRect();
  if (r.width && r.top < H && r.bottom > 0) { T.x = r.left + r.width / 2 - W / 2; T.y = H / 2 - (r.top + r.height / 2); }
  else { T.x = W * .2; T.y = 0; }
  S.x = T.x; S.y = T.y;
}

/* ---------- seals ---------- */
let prepared = null;
function prepareNext() {
  const k = stampK(), key = curKey(), seed = (Math.random() * 2 ** 31) | 0;
  setTimeout(() => { if (key !== curKey()) return; prepared = { key, k, seed, ...buildSealGeometry(getEmblem(key), seed, k, 1) }; }, 60);
}
function makeSeal(data, hotMat) {
  let g;
  const key = embKey(data.d, data.t);
  if (hotMat && prepared && prepared.key === key && prepared.k === data.k) { g = prepared; data.s = prepared.seed; prepared = null; }
  else g = buildSealGeometry(getEmblem(key), data.s, data.k, data.sp || 1);
  const shared = sealMat(data.c, key);
  const mat = hotMat || shared;
  const mesh = new THREE.Mesh(g.geo, mat);
  mesh.receiveShadow = true; mesh.rotation.z = data.r; mesh.renderOrder = 2;
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.scale.setScalar(g.Rmax * 2.2); shadow.renderOrder = 1;
  const s = { mesh, shadow, data, born: performance.now(), mat, shared, top: g.top, R: g.Rmax, hot: !!hotMat, spread: 1 };
  if (hotMat) mesh.scale.set(.55, .55, 1);
  placeSeal(s);
  sealLayer.add(shadow, mesh);
  seals.push(s);
  return s;
}
function stackHeight(x, py, k) {
  let z = 0;
  for (const s of seals) {
    const d = Math.hypot(s.data.x - x, s.data.py - py), reach = s.R + 30 * k;
    if (d < reach) z = Math.max(z, s.data.z + s.top * clamp(1 - d / reach, 0, 1) * 1.1);
  }
  return Math.min(z, 40);
}
function spawnSeal(pr) {
  const k = pr.k;
  const data = { x: pr.x, py: pr.py, k, c: pr.wax, d: pr.die, t: dieUsesText(pr.die) ? pr.txt : '', s: (Math.random() * 2 ** 31) | 0, r: pr.rot, z: pr.z, sp: 1 };
  const s = makeSeal(data, pr.hot);
  while (seals.length > MAX_SEALS) killSeal(seals[0]);
  paintCount(); prepareNext();
  thock();
  if (navigator.vibrate) try { navigator.vibrate(14); } catch (e) {}
  return s;
}
function finishSeal(s, sp) {
  // a long press spread the wax: rebuild the seal at its final size, still hidden under the die
  if (sp > 1.015) {
    const g = buildSealGeometry(getEmblem(embKey(s.data.d, s.data.t)), s.data.s, s.data.k, sp);
    s.mesh.geometry.dispose(); s.mesh.geometry = g.geo;
    s.R = g.Rmax; s.top = g.top; s.shadow.scale.setScalar(g.Rmax * 2.2);
    s.data.sp = Math.round(sp * 1000) / 1000;
  }
  s.spread = 1;
  saveSeals();
}
function killSeal(s) {
  const i = seals.indexOf(s); if (i >= 0) seals.splice(i, 1);
  dying.push({ s, t: 0 });
}
$('#clear').addEventListener('click', () => { for (const s of [...seals]) killSeal(s); saveSeals(); paintCount(); });

/* ---------- input ---------- */
const noStamp = el => el && el.closest && el.closest('[data-nostamp]');
addEventListener('pointermove', e => {
  if (noStamp(e.target)) return;
  if (e.pointerType !== 'mouse' && !press) return;
  if (press && press.phase !== 'up') return;
  T.x = e.clientX - W / 2; T.y = H / 2 - e.clientY;
}, { passive: true });
addEventListener('pointerdown', e => {
  if (noStamp(e.target)) return;
  if (panelOpen()) { closePanel(); return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  T.x = e.clientX - W / 2; T.y = H / 2 - e.clientY;
  startPress(e.clientX, e.clientY);
  if (press && e.pointerType !== 'mouse') press.touch = true;
});
const release = () => { if (press) press.held = false; };
addEventListener('pointerup', release);
addEventListener('pointercancel', () => {
  // the browser took the touch for scrolling: call off a press whose die has not landed
  if (press && press.touch && press.phase === 'down') {
    sealLayer.remove(press.puddle); press.hot.dispose(); press = null; S.va = S.vb = 0;
  } else release();
});
addEventListener('blur', release);
addEventListener('contextmenu', e => { if (!noStamp(e.target)) e.preventDefault(); });

function startPress(cx, cy) {
  if (press && press.phase !== 'up') return;
  inspect = null;
  const k = stampK();
  const tx = cx - W / 2, ty = H / 2 - cy, far = Math.hypot(tx - S.x, ty - S.y);
  const py = cy + scrollY;
  const hot = makeHotMat(waxId, curKey());
  const z = stackHeight(tx, py, k);
  const rot = (Math.random() - .5) * .12;
  const puddle = new THREE.Mesh(puddleGeo, hot);
  puddle.position.set(tx, H / 2 - py, z); puddle.scale.setScalar(.001); puddle.rotation.z = Math.random() * 6.28;
  puddle.receiveShadow = true; puddle.renderOrder = 2;
  sealLayer.add(puddle);
  press = {
    phase: 'down', t: 0, hold: 0, held: true, k,
    fx: S.x, fy: S.y, fz: S.z, fa: S.a, fb: S.b, ftw: S.tw,
    tx, ty, x: tx, py, z, rot, touch: false, wax: waxId, die: dieId, txt: initials, hot, puddle, pa: .9 + Math.random() * .2,
    down: far > 60 ? .34 : .26, up: .34, seal: null, sp: 1
  };
}
function startInspect() { if (press) return; inspect = { t: 0, fa: S.a, fb: S.b, fz: S.z }; }

/* ---------- stamp type ---------- */
const STAMP_ICONS = {
  walnut: '<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M11 30h8l1-6c2-4 3-7 2-10-1-2-3-3-1-6 1-2 1-4-1-5-1-1-3-1-4-1s-3 0-4 1c-2 1-2 3-1 5 2 3 0 4-1 6-1 3 0 6 2 10z" fill="#8A5530"/><rect x="6" y="30" width="18" height="7" rx="1.5" fill="#C9A14F"/></svg>',
  crystal: '<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 2 21 8 19 18 13 18 11 8z" fill="#DDEBF7" stroke="#7E98B3" stroke-width="1"/><path d="M13 18h4l1 5-1 5h-4l-1-5z" fill="#E9F2FA" stroke="#7E98B3" stroke-width="1"/><path d="M15 2v26M11 8h10" stroke="#9FB6CC" stroke-width=".8"/><rect x="6" y="30" width="18" height="7" rx="1.5" fill="#C9A14F"/></svg>',
  rosewood: '<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M12 30h6l.6-4c1.4-1 1.4-2 0-3V12c1.6-1.6 2.4-3.4 1.4-5.4-.8-1.6-2.4-2.6-5-2.6s-4.2 1-5 2.6c-1 2 -.2 3.8 1.4 5.4v11c-1.4 1-1.4 2 0 3z" fill="#9A4632"/><path d="M14 14v8M16 14v8" stroke="#6E2E20" stroke-width=".9"/><path d="M19.5 6c3 2 4 6 3.4 10" fill="none" stroke="#8A1A22" stroke-width="1.2"/><path d="M21.6 15.6h2.6l1 6.4h-4.6z" fill="#8A1A22"/><circle cx="22.9" cy="15.6" r="1.6" fill="#C9A14F"/><rect x="6" y="30" width="18" height="7" rx="1.5" fill="#C9A14F"/></svg>'
};
const kindsEl = $('#kinds');
const kindButtons = STAMPS.map(k => {
  const b = document.createElement('button');
  b.innerHTML = `${STAMP_ICONS[k.id]}<span>${k.name}<small>${k.note}</small></span>`;
  b.addEventListener('click', () => setStamp(k.id));
  kindsEl.appendChild(b);
  return b;
});
function paintStamps() { STAMPS.forEach((k, i) => kindButtons[i].setAttribute('aria-pressed', String(k.id === stampType))); }
function setStamp(id) { if (id === stampType) return; stampType = id; buildStamp(id); paintStamps(); savePrefs(); startInspect(); }
paintStamps();

/* Picker thumbnails are rendered from the real stamp models, so they match what you see on the page.
   A small separate renderer draws each stamp once on its own canvas, then it is thrown away.
   Until that finishes, or if it fails, the simple drawn icons stay in place. */
async function makeStampThumbs() {
  let r2 = null;
  try {
    const W = 132, H = 180;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    r2 = new THREE.WebGPURenderer({ canvas: cv, antialias: true, alpha: true, forceWebGL: true });
    r2.setPixelRatio(1); r2.setSize(W, H, false); r2.setClearColor(0x000000, 0);
    r2.toneMapping = THREE.NeutralToneMapping;
    await r2.init();
    const sc = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r2);
    sc.environment = pm.fromScene(makeStudioEnv(), .02, .1, 400).texture;
    sc.add(new THREE.HemisphereLight(0xf2f6ff, 0x8a96a2, .8));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4); key.position.set(-320, 520, 420); sc.add(key);
    const cam = new THREE.PerspectiveCamera(24, W / H, 10, 3000);
    cam.position.set(0, 205, 575); cam.lookAt(0, 120, 0);
    for (let i = 0; i < STAMPS.length; i++) {
      const id = STAMPS[i].id;
      const g = new THREE.Group(); g.rotation.set(0, .55, -.06);
      const parts = BUILD[id]().filter(m => m !== tasselAnchor);
      g.add(dieFace.clone(), ...parts);
      if (id === 'rosewood') {
        // the tassel hangs at rest beside the handle
        const t = tassel.clone(); t.visible = true; t.position.set(0, 230, 0); t.rotation.z = .42; t.scale.setScalar(1.35); g.add(t);
      }
      sc.add(g);
      r2.render(sc, cam);
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const o = out.getContext('2d');
      const sh = o.createRadialGradient(W / 2, H - 12, 2, W / 2, H - 12, 46);
      sh.addColorStop(0, 'rgba(27,42,65,.36)'); sh.addColorStop(1, 'rgba(27,42,65,0)');
      o.save(); o.translate(0, H - 12); o.scale(1, .2); o.translate(0, -(H - 12)); o.fillStyle = sh; o.fillRect(0, 0, W, H); o.restore();
      o.drawImage(cv, 0, 0);
      const url = out.toDataURL();
      sc.remove(g);
      for (const m of parts) if (m.geometry) m.geometry.dispose();
      const holder = kindButtons[i].querySelector('svg');
      if (holder) { const img = new Image(); img.alt = ''; img.src = url; holder.replaceWith(img); }
    }
    pm.dispose();
  } catch (e) {
    console.warn('Stamp thumbnails fell back to icons', e);
  } finally {
    if (r2) r2.dispose();
  }
}
makeStampThumbs();

/* ---------- dies and initials ---------- */
const ALLOWED = /^[\p{L}\p{N}&]$/u;
const studio = $('#studio'), dieBtn = $('#dieBtn'), diesEl = $('#dies');
const panelOpen = () => studio.classList.contains('open');
function openPanel() { studio.classList.add('open'); dieBtn.setAttribute('aria-expanded', 'true'); const cur = diesEl.querySelector('[aria-pressed="true"]'); if (cur) cur.focus({ preventScroll: true }); }
function closePanel() { if (!panelOpen()) return; studio.classList.remove('open'); dieBtn.setAttribute('aria-expanded', 'false'); if (!monoEl.value) monoEl.value = initials; }
dieBtn.addEventListener('click', () => panelOpen() ? closePanel() : openPanel());
$('#closeStudio').addEventListener('click', () => { closePanel(); dieBtn.focus(); });
$('#showDie').addEventListener('click', () => { closePanel(); startInspect(); });
const dieButtons = DIES.map(d => {
  const b = document.createElement('button');
  b.innerHTML = `<img alt=""><span>${d.name}</span>`;
  b.addEventListener('click', () => setDie(d.id));
  diesEl.appendChild(b);
  return b;
});
const sanitize = v => [...v].filter(c => ALLOWED.test(c)).join('').toUpperCase().slice(0, 3);
function paintDies() {
  const hex = waxDef(waxId).hex, cur = DIES.find(d => d.id === dieId), wax = waxDef(waxId).name;
  DIES.forEach((d, i) => { dieButtons[i].querySelector('img').src = dieThumb(d.id, initials, hex); dieButtons[i].setAttribute('aria-pressed', String(d.id === dieId)); });
  $('#dieImg').src = dieThumb(dieId, initials, hex);
  $('#bigPreview').src = dieThumb(dieId, initials, hex, 220);
  $('#dieName').textContent = cur.name;
  $('#dieSub').textContent = cur.text ? `${initials} in ${wax.toLowerCase()}` : `${wax} wax`;
  $('#summary').textContent = `${cur.name} die${cur.text ? ` with ${initials}` : ''} in ${wax.toLowerCase()} wax`;
  $('#monoNote').textContent = cur.text
    ? 'One to three letters or numbers. They appear on the Monogram, Crown and Hearts dies.'
    : `The ${cur.name} die has no initials. Yours are kept for the Monogram, Crown and Hearts dies.`;
  monoEl.classList.toggle('dim', !cur.text);
}
function recut() {
  const old = dieTex; dieTex = makeDieTextures(getEmblem(curKey()));
  faceMat.map = dieTex.color; faceMat.normalMap = dieTex.normal; faceMat.needsUpdate = true;
  old.color.dispose(); old.normal.dispose();
  prepared = null; prepareNext(); savePrefs(); paintDies(); startInspect();
}
function setDie(id) { if (id === dieId) return; dieId = id; recut(); }
let recutTimer = 0;
function commitInitials(v) {
  if (!v || v === initials) return;
  initials = v;
  paintDies();
  clearTimeout(recutTimer);
  recutTimer = setTimeout(() => { if (dieUsesText(dieId)) recut(); else savePrefs(); }, 420);
}
// the field may be empty while you type; the die keeps its last initials until there is something new
monoEl.value = initials;
monoEl.addEventListener('input', () => {
  const v = sanitize(monoEl.value);
  if (monoEl.value !== v) monoEl.value = v;
  commitInitials(v);
});
monoEl.addEventListener('blur', () => { if (!monoEl.value) monoEl.value = initials; });
monoEl.addEventListener('keydown', e => { if (e.key === 'Enter') { monoEl.blur(); closePanel(); } });
$('#clearMono').addEventListener('click', () => { monoEl.value = ''; monoEl.focus(); });

// typing anywhere on the page also recuts: keys in quick succession build up to three initials
let lastKey = 0;
addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePanel(); return; }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === 'Backspace' && initials.length > 1) { e.preventDefault(); const v = initials.slice(0, -1); monoEl.value = v; commitInitials(v); return; }
  if (e.key.length === 1 && ALLOWED.test(e.key)) {
    const now = performance.now();
    const v = sanitize(now - lastKey < 1500 && initials.length < 3 ? initials + e.key : e.key);
    lastKey = now; monoEl.value = v; commitInitials(v);
  }
});
paintDies();

/* ---------- restore saved seals a few per frame ---------- */
let restoreQueue = [];
try { restoreQueue = (JSON.parse(localStorage.getItem(STORE) || '[]') || []).filter(d => d && typeof d.x === 'number' && typeof d.py === 'number').slice(-MAX_SEALS); } catch (e) {}
for (const d of restoreQueue) { d.k = d.k || 1; d.c = d.c || 'oxblood'; d.d = DIES.some(x => x.id === d.d) ? d.d : 'mono'; d.t = typeof d.t === 'string' ? d.t.slice(0, 3) : ''; d.r = d.r || 0; d.z = d.z || 0; d.s = d.s | 0; d.sp = d.sp || 1; }

addEventListener('resize', layout);
layout(); parkStamp(); paintCount(); prepareNext();
if (!reduceMotion) startInspect();

/* ---------- frame ---------- */
const HOVER = 46;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(.05, (now - lastTime) / 1000); lastTime = now;
  const k = stampK();

  for (let n = 0; n < 1 && restoreQueue.length; n++) { makeSeal(restoreQueue.shift(), null); if (!restoreQueue.length) paintCount(); }

  const px = S.x, py = S.y;
  if (!press) {
    const f = 1 - Math.exp(-dt * 26);
    S.x += (T.x - S.x) * f; S.y += (T.y - S.y) * f;
  }
  const ivx = (S.x - px) / Math.max(dt, 1e-3), ivy = (S.y - py) / Math.max(dt, 1e-3);
  S.vx += (ivx - S.vx) * .25; S.vy += (ivy - S.vy) * .25;

  const restA = .74 + clamp(S.vy * .0002, -.3, .3);
  const restB = .36 + clamp(-S.vx * .0002, -.32, .32);
  const bob = reduceMotion ? 0 : Math.sin(now * .0016) * 2.2;

  if (press) {
    const P = press, contact = 3.3 * P.k + P.z;
    if (P.phase === 'down') {
      P.t += dt;
      const u = Math.min(1, P.t / P.down), e = easeInOut(u);
      S.x = lerp(P.fx, P.tx, e); S.y = lerp(P.fy, P.ty, e);
      S.z = lerp(P.fz, contact, easeIn(u));
      S.a = lerp(P.fa, 0, easeOut(Math.min(1, u * 1.3))); S.b = lerp(P.fb, 0, easeOut(Math.min(1, u * 1.3)));
      S.tw = lerp(P.ftw, 0, u);
      // the drip lands first and pools while the die comes down
      const g = easeOut(Math.min(1, u * 1.15)), R = 44 * P.k * g;
      P.puddle.scale.set(R * P.pa, R / P.pa, 6.2 * P.k * (.45 + .55 * g));
      if (u >= 1) {
        sealLayer.remove(P.puddle);
        P.seal = spawnSeal(P);
        P.phase = 'hold'; P.hold = 0;
      }
    } else if (P.phase === 'hold') {
      P.hold += dt;
      P.sp = 1 + .3 * smooth(0, 1.6, Math.max(0, P.hold - .15));
      P.seal.spread = P.sp;
      S.x = P.tx; S.y = P.ty; S.a = 0; S.b = 0;
      S.z = contact - (.5 + 1.4 * (P.sp - 1)) * P.k * Math.min(1, P.hold / .08);
      S.tw = P.hold < .26 ? .07 * Math.sin(Math.PI * 2 * P.hold / .26) : .012 * Math.sin(P.hold * 9);
      if ((!P.held && P.hold >= .24) || P.hold > 2.8) {
        finishSeal(P.seal, P.sp);
        P.phase = 'up'; P.t = 0; P.fz = S.z;
        peel();
      }
    } else {
      P.t += dt;
      const u = Math.min(1, P.t / P.up), e = easeOut(u);
      S.z = lerp(P.fz, HOVER, e);
      S.a = lerp(0, restA, e); S.b = lerp(0, restB, e); S.tw *= .8;
      const f = 1 - Math.exp(-dt * 10 * u);
      S.x += (T.x - S.x) * f; S.y += (T.y - S.y) * f;
      if (u >= 1) { press = null; S.va = S.vb = 0; }
    }
  } else if (inspect) {
    inspect.t += dt;
    const t = inspect.t, inT = .5, holdT = 1.5, outT = .5;
    const flipA = 2.45, flipB = .1, flipZ = 200 * k;
    if (t < inT) { const e = easeInOut(t / inT); S.a = lerp(inspect.fa, flipA, e); S.b = lerp(inspect.fb, flipB, e); S.z = lerp(inspect.fz, flipZ, e); }
    else if (t < inT + holdT) { S.a = flipA + Math.sin((t - inT) * 2) * .04; S.b = flipB; S.z = flipZ; }
    else {
      const e = easeInOut(Math.min(1, (t - inT - holdT) / outT));
      S.a = lerp(flipA, restA, e); S.b = lerp(flipB, restB, e); S.z = lerp(flipZ, HOVER + bob, e);
      if (t >= inT + holdT + outT) { inspect = null; S.va = S.vb = 0; }
    }
    S.tw *= .9;
  } else {
    const K = 95, C = 13, n = Math.ceil(dt * 240), h = dt / n;
    for (let i = 0; i < n; i++) {
      S.va += (K * (restA - S.a) - C * S.va) * h; S.a += S.va * h;
      S.vb += (K * (restB - S.b) - C * S.vb) * h; S.b += S.vb * h;
    }
    S.z += (HOVER + bob - S.z) * (1 - Math.exp(-dt * 12));
    S.tw *= .9;
  }

  const pf = (D - S.z) / D;
  stamp.position.set(S.x * pf, S.y * pf, S.z);
  stamp.rotation.set(S.a, S.b, 0);
  stampTwist.rotation.y = S.tw;
  stamp.scale.setScalar(k);
  stepTassel(dt, k);

  sun.target.position.set(stamp.position.x, stamp.position.y, 0);
  sun.position.copy(sun.target.position).addScaledVector(LIGHT_DIR, 1400);

  // fresh wax spreads out under the die, then loses its wet gloss as it sets
  for (const s of seals) {
    if (!s.hot) continue;
    const age = (now - s.born) / 1000;
    const sp = easeOut(Math.min(1, age / .22)), sc = (.55 + .45 * sp) * s.spread;
    s.mesh.scale.set(sc, sc, 1);
    const cool = smooth(.4, 3.2, age);
    s.mat.roughness = lerp(Math.max(.12, s.shared.roughness * .4), s.shared.roughness, cool);
    s.mat.clearcoatRoughness = lerp(.1, s.shared.clearcoatRoughness, cool);
    s.mat.clearcoat = lerp(Math.min(.6, s.shared.clearcoat + .2), s.shared.clearcoat, cool);
    if (age > 3.3 && s.spread === 1) { s.mesh.material = s.shared; s.mat.dispose(); s.mat = s.shared; s.hot = false; s.mesh.scale.set(1, 1, 1); }
  }
  for (let i = dying.length - 1; i >= 0; i--) {
    const d = dying[i]; d.t += dt;
    const e = 1 - easeIn(Math.min(1, d.t / .28));
    d.s.mesh.scale.set(e, e, Math.max(.001, e)); d.s.shadow.scale.setScalar(d.s.R * 2.2 * e);
    if (d.t >= .28) {
      sealLayer.remove(d.s.mesh, d.s.shadow); d.s.mesh.geometry.dispose();
      if (d.s.mat !== d.s.shared) d.s.mat.dispose();
      dying.splice(i, 1);
    }
  }

  sealLayer.position.y = scrollY;
  renderer.render(scene, camera);
});
