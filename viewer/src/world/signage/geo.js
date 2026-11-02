import * as THREE from 'three';

// Merged-geometry accumulation for signage. One Batch per material; everything a sign needs
// (faces, frames, brackets, lattice, lamps) is appended as raw triangles so the whole layer
// renders with few draw calls.

export class Batch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; this.vc = 0; }
  get tris() { return this.idx.length / 3; }
  vert(p, n, uv, c) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]);
    return this.vc++;
  }
  /** Quad p0..p3 (counter-clockwise when seen from the side n points to). */
  quad(p0, p1, p2, p3, n, uvs, c) {
    const b = this.vc;
    this.vert(p0, n, uvs[0], c); this.vert(p1, n, uvs[1], c); this.vert(p2, n, uvs[2], c); this.vert(p3, n, uvs[3], c);
    // ensure winding faces n
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  tri(p0, p1, p2, n, uvs, c) {
    const b = this.vc;
    this.vert(p0, n, uvs[0], c); this.vert(p1, n, uvs[1], c); this.vert(p2, n, uvs[2], c);
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(b, b + 1, b + 2); else this.idx.push(b, b + 2, b + 1);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- vector helpers
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  neg: (a) => [-a[0], -a[1], -a[2]],
};

/** sRGB hex -> linear rgb triple for vertex colours. */
export function lin(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/**
 * Oriented box. c = centre, axes X (right), Y (up), Z (normal) unit vectors, half sizes hx,hy,hz.
 * faceCb(name) may return {batch, uv:[u0,v0,u1,v1], color} to override a face (e.g. textured
 * front); otherwise the face goes to `batch` with world-scale UVs and colour `col`.
 * skip: set of face names to omit ('px','nx','py','ny','pz','nz').
 */
export function box(batch, c, X, Y, Z, hx, hy, hz, col, faceCb = null, skip = null) {
  const P = (sx, sy, sz) => [c[0] + X[0] * sx * hx + Y[0] * sy * hy + Z[0] * sz * hz, c[1] + X[1] * sx * hx + Y[1] * sy * hy + Z[1] * sz * hz, c[2] + X[2] * sx * hx + Y[2] * sy * hy + Z[2] * sz * hz];
  const faces = {
    pz: { n: Z, q: [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], w: hx * 2, h: hy * 2 },
    nz: { n: v3.neg(Z), q: [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)], w: hx * 2, h: hy * 2 },
    px: { n: X, q: [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)], w: hz * 2, h: hy * 2 },
    nx: { n: v3.neg(X), q: [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)], w: hz * 2, h: hy * 2 },
    py: { n: Y, q: [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], w: hx * 2, h: hz * 2 },
    ny: { n: v3.neg(Y), q: [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], w: hx * 2, h: hz * 2 },
  };
  for (const k in faces) {
    if (skip && skip.has(k)) continue;
    const f = faces[k];
    const o = faceCb ? faceCb(k) : null;
    if (o) {
      const [u0, v0, u1, v1] = o.uv;
      o.batch.quad(f.q[0], f.q[1], f.q[2], f.q[3], f.n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], o.color || [1, 1, 1]);
    } else {
      batch.quad(f.q[0], f.q[1], f.q[2], f.q[3], f.n, [[0, 0], [f.w, 0], [f.w, f.h], [0, f.h]], col);
    }
  }
}

/** Box between two points (a beam/strut) with square section s (or [sw, sh]). */
export function beam(batch, a, b, s, col, upHint = [0, 1, 0]) {
  const d = v3.sub(b, a); const L = v3.len(d);
  if (L < 1e-4) return;
  const Z = v3.mul(d, 1 / L);
  let X = v3.cross(upHint, Z);
  if (v3.len(X) < 1e-3) X = v3.cross([1, 0, 0], Z);
  X = v3.norm(X);
  const Y = v3.cross(Z, X);
  const [sw, sh] = Array.isArray(s) ? s : [s, s];
  box(batch, v3.mul(v3.add(a, b), 0.5), X, Y, Z, sw / 2, sh / 2, L / 2, col);
}

/** Cylinder from a to b, radius r, segs sides; optional atlas uv rect wraps around. */
export function cylinder(batch, a, b, r, segs, col, uvRect = null, caps = true) {
  const d = v3.sub(b, a); const L = v3.len(d);
  const Z = v3.mul(d, 1 / L);
  let X = v3.cross([0, 1, 0], Z); if (v3.len(X) < 1e-3) X = [1, 0, 0];
  X = v3.norm(X); const Y = v3.cross(Z, X);
  const ring = (t) => Array.from({ length: segs + 1 }, (_, i) => {
    const ang = (i / segs) * Math.PI * 2;
    const nn = v3.add(v3.mul(X, Math.cos(ang)), v3.mul(Y, Math.sin(ang)));
    return { p: v3.add(v3.mad(a, d, t), v3.mul(nn, r)), n: nn, u: i / segs };
  });
  const r0 = ring(0), r1 = ring(1);
  const [u0, v0, u1, v1] = uvRect || [0, 0, Math.PI * 2 * r, L];
  for (let i = 0; i < segs; i++) {
    const A = r0[i], B = r0[i + 1], C = r1[i + 1], D = r1[i];
    const nAvg = v3.norm(v3.add(A.n, B.n));
    const uA = u0 + (u1 - u0) * A.u, uB = u0 + (u1 - u0) * B.u;
    // smooth normals per vertex
    const base = batch.vc;
    batch.vert(A.p, A.n, [uA, v0], col); batch.vert(B.p, B.n, [uB, v0], col); batch.vert(C.p, C.n, [uB, v1], col); batch.vert(D.p, D.n, [uA, v1], col);
    const cr = v3.cross(v3.sub(B.p, A.p), v3.sub(C.p, A.p));
    if (v3.dot(cr, nAvg) >= 0) batch.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else batch.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  if (caps) {
    for (const [rr, cc, nn] of [[r0, a, v3.neg(Z)], [r1, b, Z]]) {
      for (let i = 0; i < segs; i++) batch.tri(cc, rr[i].p, rr[i + 1].p, nn, [[0, 0], [0, 0], [0, 0]], col);
    }
  }
}

/** Textured quad on a plane: centre c, right R, up U (unit), size w×h, uv rect. Normal = R×U. */
export function face(batch, c, R, U, w, h, uv, col = [1, 1, 1]) {
  const n = v3.norm(v3.cross(R, U));
  const hx = v3.mul(R, w / 2), hy = v3.mul(U, h / 2);
  const p0 = v3.sub(v3.sub(c, hx), hy), p1 = v3.sub(v3.add(c, hx), hy), p2 = v3.add(v3.add(c, hx), hy), p3 = v3.add(v3.sub(c, hx), hy);
  const [u0, v0, u1, v1] = uv;
  batch.quad(p0, p1, p2, p3, n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], col);
}
