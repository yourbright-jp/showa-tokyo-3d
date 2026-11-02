// Shared helpers for the terrain module: polygon tests, fast tileable noise grids and colour
// conversion. Everything is deterministic (callers pass keyed ctx.rng streams).

export const ringXZ = (poly) => poly.map((p) => (p.length >= 3 ? [p[0], p[2]] : [p[0], p[1]]));

export function bbox(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
}

export function pip(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function signedArea(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

export function ringDist(x, z, r) {
  let best = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1]));
  }
  return best;
}

/** A set of rings with bounding boxes on a coarse grid for fast point queries. */
export class RingSet {
  constructor(rings, cell = 16) {
    this.items = rings.filter((r) => r && r.length >= 3).map((r) => ({ r, bb: bbox(r) }));
    this.cell = cell;
    this.grid = new Map();
    for (const it of this.items) {
      const [x0, z0, x1, z1] = it.bb;
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
        for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) {
          const k = gx * 100003 + gz;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(it);
        }
    }
  }
  _cands(x, z) { return this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell)) || []; }
  has(x, z) {
    for (const it of this._cands(x, z)) {
      const b = it.bb;
      if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && pip(x, z, it.r)) return true;
    }
    return false;
  }
  /** distance to the nearest ring edge among rings whose bbox is within `reach` */
  near(x, z, reach) {
    let best = Infinity;
    for (const it of this.items) {
      const b = it.bb;
      if (x < b[0] - reach || x > b[2] + reach || z < b[1] - reach || z > b[3] + reach) continue;
      best = Math.min(best, pip(x, z, it.r) ? 0 : ringDist(x, z, it.r));
    }
    return best;
  }
}

// ---------------------------------------------------------------- noise grids
// Tileable smooth value noise evaluated on a size x size grid with `cells` lattice cells per side.
export function latticeGrid(rand, size, cells) {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  const ix0 = new Int32Array(size), ix1 = new Int32Array(size), fx = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const u = (x * cells) / size; const i = Math.floor(u); const t = u - i;
    ix0[x] = i % cells; ix1[x] = (i + 1) % cells; fx[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < size; y++) {
    const v = (y * cells) / size; const j = Math.floor(v); let t = v - j; t = t * t * (3 - 2 * t);
    const r0 = (j % cells) * cells, r1 = ((j + 1) % cells) * cells;
    const o = y * size;
    for (let x = 0; x < size; x++) {
      const a = lat[r0 + ix0[x]], b = lat[r0 + ix1[x]], c = lat[r1 + ix0[x]], d = lat[r1 + ix1[x]];
      const s = fx[x];
      const top = a + (b - a) * s, bot = c + (d - c) * s;
      out[o + x] = top + (bot - top) * t;
    }
  }
  return out;
}

export function fbmGrid(rand, size, baseCells, octaves = 4, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves && cells <= size; o++) {
    const g = latticeGrid(rand, size, cells);
    for (let i = 0; i < out.length; i++) out[i] += g[i] * amp;
    norm += amp; amp *= gain; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Stretch values to roughly 0..1 using the observed range. */
export function normalise(arr) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = hi > lo ? 1 / (hi - lo) : 1;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * k;
  return arr;
}

/** Separable box blur (wrapping, tileable) of a Float32 grid. */
export function boxBlurWrap(src, size, radius) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const n = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    const o = y * size; let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[o + ((k % size) + size) % size];
    for (let x = 0; x < size; x++) {
      tmp[o + x] = acc / n;
      acc += src[o + ((x + radius + 1) % size)] - src[o + ((x - radius) % size + size) % size];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[(((k % size) + size) % size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc / n;
      acc += tmp[((y + radius + 1) % size) * size + x] - tmp[(((y - radius) % size + size) % size) * size + x];
    }
  }
  return out;
}

export function linToSrgb8(v) {
  v = v <= 0 ? 0 : v >= 1 ? 1 : v;
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

// lookup table for faster sRGB encoding of linear values in 0..1 (4096 steps)
const LUT = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) LUT[i] = linToSrgb8(i / 4096);
export const srgb8 = (v) => LUT[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0];

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
