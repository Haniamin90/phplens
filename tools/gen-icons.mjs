// Generates all toolbar / state icons as PNGs without any image library.
// Shield shape rasterised with 4x4 supersampling, encoded as RGBA PNG via zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crc32 } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
mkdirSync(OUT, { recursive: true });

const SETS = {
  icon:            { top: [99, 102, 241],  bottom: [67, 56, 202],   mark: 'check' },
  'state-safe':    { top: [34, 197, 94],   bottom: [21, 128, 61],   mark: 'check' },
  'state-caution': { top: [245, 158, 11],  bottom: [194, 120, 3],   mark: 'bang' },
  'state-danger':  { top: [239, 68, 68],   bottom: [185, 28, 28],   mark: 'bang' },
  'state-unknown': { top: [100, 116, 139], bottom: [71, 85, 105],   mark: 'question' }
};
const SIZES = [16, 32, 48, 128];

// ---- geometry helpers (unit square, y down) --------------------------------
function insideShield(u, v, shrink = 0) {
  // scale towards centre to get an inset copy for the outline
  const cu = 0.5 + (u - 0.5) / (1 - shrink);
  const cv = 0.5 + (v - 0.5) / (1 - shrink);
  const halfW = 0.40, top = 0.08, shoulder = 0.52, bottom = 0.97, r = 0.10;
  if (cv < top || cv > bottom) return false;
  const dx = Math.abs(cu - 0.5);
  if (cv <= shoulder) {
    if (dx > halfW) return false;
    // rounded top corners
    if (cv < top + r && dx > halfW - r) {
      const ex = dx - (halfW - r), ey = (top + r) - cv;
      return ex * ex + ey * ey <= r * r;
    }
    return true;
  }
  const t = (cv - shoulder) / (bottom - shoulder);
  const w = halfW * Math.pow(1 - t * t, 0.9);
  return dx <= w;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function insideMark(kind, u, v) {
  if (kind === 'check') {
    const th = 0.075;
    return segDist(u, v, 0.30, 0.52, 0.44, 0.66) <= th || segDist(u, v, 0.44, 0.66, 0.71, 0.37) <= th;
  }
  if (kind === 'bang') {
    return segDist(u, v, 0.5, 0.30, 0.5, 0.60) <= 0.065 || Math.hypot(u - 0.5, v - 0.75) <= 0.075;
  }
  if (kind === 'question') {
    const cx = 0.5, cy = 0.43, r = 0.12, th = 0.06;
    const d = Math.hypot(u - cx, v - cy);
    const ang = Math.atan2(v - cy, u - cx); // -pi..pi, 0 = right, pi/2 = down
    const onArc = Math.abs(d - r) <= th / 2 && !(ang > Math.PI * 0.55 && ang < Math.PI * 0.95);
    const stem = segDist(u, v, 0.5, 0.55, 0.5, 0.64) <= th / 2 + 0.005;
    const dot = Math.hypot(u - 0.5, v - 0.77) <= 0.065;
    return onArc || stem || dot;
  }
  return false;
}

// ---- raster -----------------------------------------------------------------
// Store icons (128 px) get the 16 px transparent margin the Chrome Web Store asks for:
// the artwork is scaled to 96 px and centred.
function render(size, set) {
  const px = new Uint8Array(size * size * 4);
  const SS = 4;
  const scale = size >= 128 ? 0.75 : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fill = 0, edge = 0, mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;
          const v = ((y + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
          if (insideShield(u, v)) {
            fill++;
            if (!insideShield(u, v, 0.09)) edge++;
            else if (insideMark(set.mark, u, v)) mark++;
          }
        }
      }
      const n = SS * SS;
      const a = fill / n;
      if (a === 0) continue;
      const v = Math.min(1, Math.max(0, (y / size - 0.5) / scale + 0.5));
      const base = set.top.map((c, i) => Math.round(c + (set.bottom[i] - c) * v));
      const edgeCol = base.map((c) => Math.round(c * 0.72));
      const markCol = [255, 255, 255];
      const e = edge / fill, m = mark / fill, b = 1 - e - m;
      const col = [0, 1, 2].map((i) => Math.round(base[i] * b + edgeCol[i] * e + markCol[i] * m));
      const o = (y * size + x) * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// ---- PNG encode -------------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let count = 0;
for (const [name, set] of Object.entries(SETS)) {
  for (const size of SIZES) {
    writeFileSync(join(OUT, `${name}-${size}.png`), png(size, render(size, set)));
    count++;
  }
}
console.log(`icons: wrote ${count} PNG files to ${OUT}`);
