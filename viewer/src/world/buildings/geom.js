import * as THREE from 'three';

// Geometry accumulation for the buildings module. Everything is merged into a small number of
// BufferGeometries per (material, spatial cell) so the CPU renderer sees few draw calls.

/** Growable float/int buffers. */
class Grow {
  constructor(Type, cap = 1024) { this.T = Type; this.a = new Type(cap); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new this.T(cap); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push1(x) { this.ensure(1); this.a[this.n++] = x; }
  push2(x, y) { this.ensure(2); this.a[this.n++] = x; this.a[this.n++] = y; }
  push3(x, y, z) { this.ensure(3); this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; }
  push4(x, y, z, w) { this.ensure(4); this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; this.a[this.n++] = w; }
  view() { return this.a.slice(0, this.n); }
}

/**
 * A batch of triangles sharing one material. Attributes: position, normal, uv, color, plus
 * optional extras (name -> itemSize), e.g. { aGrime: 2 } or { aWin: 4 }.
 */
export class Batch {
  constructor(extras = {}) {
    this.p = new Grow(Float32Array); this.nr = new Grow(Float32Array); this.uv = new Grow(Float32Array);
    this.c = new Grow(Float32Array); this.i = new Grow(Uint32Array);
    this.extras = extras; this.ex = {};
    for (const k of Object.keys(extras)) this.ex[k] = new Grow(Float32Array);
    this.vc = 0;
  }
  get triCount() { return this.i.n / 3; }
  vert(p, n, uv, col, ex) {
    this.p.push3(p[0], p[1], p[2]); this.nr.push3(n[0], n[1], n[2]);
    this.uv.push2(uv[0], uv[1]); this.c.push3(col[0], col[1], col[2]);
    for (const k in this.ex) {
      const s = this.extras[k]; const v = ex && ex[k];
      if (s === 2) this.ex[k].push2(v ? v[0] : 0, v ? v[1] : 0);
      else if (s === 3) this.ex[k].push3(v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0);
      else this.ex[k].push4(v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0, v ? v[3] : 0);
    }
    return this.vc++;
  }
  /** Quad from 4 world points in cyclic order; winding is fixed so the face points along n. */
  quad(v, n, uvs, col, exs) {
    const b = this.vc;
    for (let k = 0; k < 4; k++) this.vert(v[k], n, uvs[k], col, exs ? exs[k] : null);
    const ax = v[1][0] - v[0][0], ay = v[1][1] - v[0][1], az = v[1][2] - v[0][2];
    const bx = v[2][0] - v[0][0], by = v[2][1] - v[0][1], bz = v[2][2] - v[0][2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) { this.i.push3(b, b + 1, b + 2); this.i.push3(b, b + 2, b + 3); }
    else { this.i.push3(b, b + 2, b + 1); this.i.push3(b, b + 3, b + 2); }
  }
  tri(v, n, uvs, col, exs) {
    const b = this.vc;
    for (let k = 0; k < 3; k++) this.vert(v[k], n, uvs[k], col, exs ? exs[k] : null);
    const ax = v[1][0] - v[0][0], ay = v[1][1] - v[0][1], az = v[1][2] - v[0][2];
    const bx = v[2][0] - v[0][0], by = v[2][1] - v[0][1], bz = v[2][2] - v[0][2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.i.push3(b, b + 1, b + 2); else this.i.push3(b, b + 2, b + 1);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nr.view(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.view(), 3));
    for (const k in this.ex) g.setAttribute(k, new THREE.BufferAttribute(this.ex[k].view(), this.extras[k]));
    g.setIndex(new THREE.BufferAttribute(this.i.view(), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Facade frame: origin a=(ax,az) on the footprint edge, tangent t along the edge, outward normal
 * n = (tz, -tx). Local (u, y, d): u metres along the edge, y world height, d metres outward.
 */
export function makeFrame(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1;
  const tx = dx / L, tz = dz / L;
  return { ax, az, tx, tz, nx: tz, nz: -tx, L };
}
export function W(F, u, y, d) { return [F.ax + F.tx * u + F.nx * d, y, F.az + F.tz * u + F.nz * d]; }
export const nrmN = (F) => [F.nx, 0, F.nz];
export const nrmT = (F) => [F.tx, 0, F.tz];

/**
 * Axis-aligned box in a frame: u0..u1, y0..y1, d0..d1. opts: {skip: Set('back','front','left','right','top','bottom'),
 * uvo: [ou, ov] texture offset, ex: (u,y,d)=>extras}
 */
export function box(B, F, u0, u1, y0, y1, d0, d1, col, opts = {}) {
  const skip = opts.skip || null; const ex = opts.ex || null;
  const ou = opts.uvo ? opts.uvo[0] : 0, ov = opts.uvo ? opts.uvo[1] : 0;
  const P = (u, y, d) => W(F, u, y, d);
  const E = ex ? (u, y, d) => ex(u, y, d) : () => null;
  const n = [F.nx, 0, F.nz], t = [F.tx, 0, F.tz];
  const face = (name, pts, nn, uvf) => {
    if (skip && skip.has(name)) return;
    B.quad(pts.map((q) => P(q[0], q[1], q[2])), nn, pts.map(uvf), col, ex ? pts.map((q) => E(q[0], q[1], q[2])) : null);
  };
  face('front', [[u0, y0, d1], [u1, y0, d1], [u1, y1, d1], [u0, y1, d1]], n, (q) => [q[0] + ou, q[1] + ov]);
  face('back', [[u0, y0, d0], [u1, y0, d0], [u1, y1, d0], [u0, y1, d0]], [-n[0], 0, -n[2]], (q) => [q[0] + ou, q[1] + ov]);
  face('right', [[u1, y0, d0], [u1, y0, d1], [u1, y1, d1], [u1, y1, d0]], t, (q) => [q[2] + ou, q[1] + ov]);
  face('left', [[u0, y0, d0], [u0, y0, d1], [u0, y1, d1], [u0, y1, d0]], [-t[0], 0, -t[2]], (q) => [q[2] + ou, q[1] + ov]);
  face('top', [[u0, y1, d0], [u1, y1, d0], [u1, y1, d1], [u0, y1, d1]], [0, 1, 0], (q) => [q[0] + ou, q[2] + ov]);
  face('bottom', [[u0, y0, d0], [u1, y0, d0], [u1, y0, d1], [u0, y0, d1]], [0, -1, 0], (q) => [q[0] + ou, q[2] + ov]);
}

/** Flat rectangle in a frame plane at depth d facing +n (or -n if back=true). */
export function rectN(B, F, u0, u1, y0, y1, d, col, opts = {}) {
  const n = opts.back ? [-F.nx, 0, -F.nz] : [F.nx, 0, F.nz];
  const pts = [[u0, y0], [u1, y0], [u1, y1], [u0, y1]];
  const uvf = opts.uv || ((q) => [q[0], q[1]]);
  B.quad(pts.map((q) => W(F, q[0], q[1], d)), n, pts.map(uvf), col, opts.ex ? pts.map((q) => opts.ex(q[0], q[1], d)) : null);
}

/** Cylinder between world points p0 and p1. */
export function tube(B, p0, p1, r, seg, col, caps = false) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const a = [ax / len, ay / len, az / len];
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = a[1] * ref[2] - a[2] * ref[1], uy = a[2] * ref[0] - a[0] * ref[2], uz = a[0] * ref[1] - a[1] * ref[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = a[1] * uz - a[2] * uy, vy = a[2] * ux - a[0] * uz, vz = a[0] * uy - a[1] * ux;
  for (let s = 0; s < seg; s++) {
    const t0 = (s / seg) * Math.PI * 2, t1 = ((s + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const n0 = [ux * c0 + vx * s0, uy * c0 + vy * s0, uz * c0 + vz * s0];
    const n1 = [ux * c1 + vx * s1, uy * c1 + vy * s1, uz * c1 + vz * s1];
    const nm = [(n0[0] + n1[0]) / 2, (n0[1] + n1[1]) / 2, (n0[2] + n1[2]) / 2];
    const q = [
      [p0[0] + n0[0] * r, p0[1] + n0[1] * r, p0[2] + n0[2] * r],
      [p0[0] + n1[0] * r, p0[1] + n1[1] * r, p0[2] + n1[2] * r],
      [p1[0] + n1[0] * r, p1[1] + n1[1] * r, p1[2] + n1[2] * r],
      [p1[0] + n0[0] * r, p1[1] + n0[1] * r, p1[2] + n0[2] * r],
    ];
    B.quad(q, nm, [[s / seg, 0], [(s + 1) / seg, 0], [(s + 1) / seg, len], [s / seg, len]], col);
    if (caps) {
      B.tri([p1, q[3], q[2]], a, [[0, 0], [0, 1], [1, 1]], col);
      B.tri([p0, q[1], q[0]], [-a[0], -a[1], -a[2]], [[0, 0], [0, 1], [1, 1]], col);
    }
  }
}

/** World-aligned oriented box: centre (x,z), base y0, height h, half sizes (hu along dir, hd across), dir unit (dx,dz). */
export function obox(B, x, z, y0, h, hu, hd, dx, dz, col, opts = {}) {
  const F = { ax: x, az: z, tx: dx, tz: dz, nx: dz, nz: -dx };
  box(B, F, -hu, hu, y0, y0 + h, -hd, hd, col, opts);
}

/** Triangulated horizontal polygon (ring [[x,z]...]) at height y, facing up (or down). */
export function polygonCap(B, ring, y, col, down = false, uvScale = 1) {
  const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const n = down ? [0, -1, 0] : [0, 1, 0];
  for (const t of tris) {
    const v = t.map((k) => [ring[k][0], y, ring[k][1]]);
    B.tri(v, n, t.map((k) => [ring[k][0] * uvScale, ring[k][1] * uvScale]), col);
  }
}

/**
 * Wall rectangle u0..u1 x y0..y1 at depth 0 with rectangular holes, tessellated on the shared grid
 * of all break lines (no T-junctions). holes: [{u0,u1,y0,y1}] (clipped to the rectangle).
 */
export function wallWithHoles(B, F, u0, u1, y0, y1, holes, col, opts = {}) {
  const us = new Set([u0, u1]), ys = new Set([y0, y1]);
  const hs = [];
  for (const h of holes) {
    const a = Math.max(u0, h.u0), b = Math.min(u1, h.u1), c = Math.max(y0, h.y0), d = Math.min(y1, h.y1);
    if (b - a < 1e-3 || d - c < 1e-3) continue;
    hs.push([a, b, c, d]); us.add(a); us.add(b); ys.add(c); ys.add(d);
  }
  const U = [...us].sort((p, q) => p - q), Y = [...ys].sort((p, q) => p - q);
  const n = [F.nx, 0, F.nz];
  const ou = opts.uvo ? opts.uvo[0] : 0, ov = opts.uvo ? opts.uvo[1] : 0;
  const ex = opts.ex || null;
  // merge cells horizontally when no break line from a hole interrupts them (keeps vertex counts low)
  for (let j = 0; j < Y.length - 1; j++) {
    const ya = Y[j], yb = Y[j + 1];
    if (yb - ya < 1e-4) continue;
    const ym = (ya + yb) / 2;
    let start = null;
    for (let i = 0; i < U.length - 1; i++) {
      const ua = U[i], ub = U[i + 1];
      if (ub - ua < 1e-4) continue;
      const um = (ua + ub) / 2;
      const inHole = hs.some((h) => um > h[0] && um < h[1] && ym > h[2] && ym < h[3]);
      if (!inHole) {
        // emit each grid cell; neighbouring rows share the same vertical break lines so edges match
        const pts = [[ua, ya], [ub, ya], [ub, yb], [ua, yb]];
        B.quad(pts.map((q) => W(F, q[0], q[1], 0)), n, pts.map((q) => [q[0] + ou, q[1] + ov]), col, ex ? pts.map((q) => ex(q[0], q[1], 0)) : null);
      }
    }
    void start;
  }
}

/** Inner faces of a rectangular opening (reveals) from the wall plane to depth -depth. */
export function reveals(B, F, h, depth, col, opts = {}) {
  const { u0, u1, y0, y1 } = h;
  const ex = opts.ex || null; const ou = opts.uvo ? opts.uvo[0] : 0, ov = opts.uvo ? opts.uvo[1] : 0;
  const t = [F.tx, 0, F.tz], mt = [-F.tx, 0, -F.tz];
  const P = (u, y, d) => W(F, u, y, d);
  const add = (pts, nn, uvf) => B.quad(pts.map((q) => P(q[0], q[1], q[2])), nn, pts.map(uvf), col, ex ? pts.map((q) => ex(q[0], q[1], q[2])) : null);
  if (!opts.noSides) {
    add([[u0, y0, 0], [u0, y0, -depth], [u0, y1, -depth], [u0, y1, 0]], t, (q) => [-q[2] + ou, q[1] + ov]);
    add([[u1, y0, 0], [u1, y0, -depth], [u1, y1, -depth], [u1, y1, 0]], mt, (q) => [-q[2] + ou, q[1] + ov]);
  }
  add([[u0, y1, 0], [u1, y1, 0], [u1, y1, -depth], [u0, y1, -depth]], [0, -1, 0], (q) => [q[0] + ou, -q[2] + ov]);
  if (!opts.noBottom) add([[u0, y0, 0], [u1, y0, 0], [u1, y0, -depth], [u0, y0, -depth]], [0, 1, 0], (q) => [q[0] + ou, -q[2] + ov]);
}

export function hexToRgb(hex) {
  const c = new THREE.Color(hex); // converts sRGB hex to linear working space
  return [c.r, c.g, c.b];
}
export function mulCol(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
export function mixCol(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
