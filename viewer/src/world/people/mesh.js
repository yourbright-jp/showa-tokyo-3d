// Low-level geometry writer for the procedural pedestrians.
//
// Parts are emitted in PERSON-LOCAL coordinates (x = the person's left, y = up from the
// ground under the person, z = the direction the person faces) and rotated about Y and
// translated into world space as they are written. Everything is written into growable
// typed arrays so a whole spatial chunk of people becomes one draw call.
//
// Per-vertex attributes:
//   position, normal
//   color  (vec3, linear)  primary cloth/skin colour
//   col2   (vec3, linear)  secondary colour used by two-colour fabric patterns
//   pat    (vec4)          (u, v) surface coords in metres, layer+tile size (-1 = none),
//                          fold level (integer part) + roughness (fraction)

export class MeshWriter {
  constructor(vcap = 1 << 15) {
    this.nv = 0;
    this.ni = 0;
    this._allocV(vcap);
    this.idx = new Uint32Array(vcap * 3);
    this.setTransform(0, 0, 0, 0);
    this.aoH = 1.7;
  }

  _allocV(cap) {
    const grow = (old, n) => { const a = new Float32Array(cap * n); if (old) a.set(old.subarray(0, this.nv * n)); return a; };
    this.pos = grow(this.pos, 3);
    this.nrm = grow(this.nrm, 3);
    this.col = grow(this.col, 3);
    this.col2 = grow(this.col2, 3);
    this.pat = grow(this.pat, 4);
    this.vcap = cap;
  }

  setTransform(yaw, x, y, z) {
    this.c = Math.cos(yaw); this.s = Math.sin(yaw);
    this.tx = x; this.ty = y; this.tz = z;
  }

  /** Write one vertex. style = {col, col2, layer, scale, rough}; (u, v) in metres. */
  vert(x, y, z, nx, ny, nz, u, v, style, colOverride) {
    if (this.nv >= this.vcap) this._allocV(this.vcap * 2);
    const i = this.nv++;
    const o3 = i * 3, o4 = i * 4;
    const c = this.c, s = this.s;
    this.pos[o3] = c * x + s * z + this.tx;
    this.pos[o3 + 1] = y + this.ty;
    this.pos[o3 + 2] = -s * x + c * z + this.tz;
    this.nrm[o3] = c * nx + s * nz;
    this.nrm[o3 + 1] = ny;
    this.nrm[o3 + 2] = -s * nx + c * nz;
    // gentle height-based occlusion: lower legs/feet sit in more ambient shadow than shoulders
    const h = Math.min(1, Math.max(0, y / (0.62 * this.aoH)));
    const ao = 0.76 + 0.24 * Math.sqrt(h);
    const col = colOverride || style.col;
    this.col[o3] = col[0] * ao; this.col[o3 + 1] = col[1] * ao; this.col[o3 + 2] = col[2] * ao;
    const c2 = style.col2 || col;
    this.col2[o3] = c2[0] * ao; this.col2[o3 + 1] = c2[1] * ao; this.col2[o3 + 2] = c2[2] * ao;
    // pat: (u, v) in metres; z = layer + tile size (m) or -1; w = fold level + roughness
    const sc = Math.min(0.99, style.scale || 0.1);
    const layer = style.layer === undefined ? -1 : style.layer;
    this.pat[o4] = u; this.pat[o4 + 1] = v;
    this.pat[o4 + 2] = layer < 0 ? -1 : layer + sc;
    this.pat[o4 + 3] = (style.fold || 0) + Math.min(0.99, style.rough === undefined ? 0.85 : style.rough);
    return i;
  }

  /** Triangle with winding chosen so its face normal agrees with the vertex normals. */
  tri(a, b, c) {
    const P = this.pos, N = this.nrm;
    const a3 = a * 3, b3 = b * 3, c3 = c * 3;
    const ux = P[b3] - P[a3], uy = P[b3 + 1] - P[a3 + 1], uz = P[b3 + 2] - P[a3 + 2];
    const vx = P[c3] - P[a3], vy = P[c3 + 1] - P[a3 + 1], vz = P[c3 + 2] - P[a3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = N[a3] + N[b3] + N[c3], ny = N[a3 + 1] + N[b3 + 1] + N[c3 + 1], nz = N[a3 + 2] + N[b3 + 2] + N[c3 + 2];
    if (this.ni + 3 > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n; }
    if (fx * nx + fy * ny + fz * nz >= 0) { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
    else { this.idx[this.ni++] = a; this.idx[this.ni++] = c; this.idx[this.ni++] = b; }
  }

  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  toGeometry(THREE) {
    const g = new THREE.BufferGeometry();
    const n = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    g.setAttribute('col2', new THREE.BufferAttribute(this.col2.slice(0, n * 3), 3));
    g.setAttribute('pat', new THREE.BufferAttribute(this.pat.slice(0, n * 4), 4));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------- small vector helpers
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const rotY = (p, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Rotation basis from yaw (about Y) then pitch (about the rotated X), roll ignored. */
export function basisYawPitch(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ex = [cy, 0, -sy];
  const ez = [sy * cp, -sp, cy * cp];
  const ey = cross(ez, ex);
  return [ex, ey, ez];
}

/** Two-bone IK: returns the middle joint for root S, target T, bone lengths l1/l2 and a pole hint. */
export function ik2(S, T, l1, l2, pole) {
  let d = sub(T, S);
  let dist = len(d);
  const maxD = (l1 + l2) * 0.9995, minD = Math.abs(l1 - l2) + 1e-3;
  const u = dist > 1e-6 ? mul(d, 1 / dist) : [0, -1, 0];
  dist = clamp(dist, minD, maxD);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub(pole, mul(u, dot(pole, u)));
  if (len(p) < 1e-6) p = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  p = nrm(p);
  return { mid: add(add(S, mul(u, a)), mul(p, h)), end: add(S, mul(u, dist)) };
}

// ---------------------------------------------------------------- primitives

/**
 * Tube along a polyline with circular/elliptical rings and optional hemispherical caps.
 * pts: [[x,y,z]...], radii: [r...] or [[rx, ry]...]. opts.ref: initial "v" reference vector.
 */
export function tubePath(w, pts, radii, seg, style, opts = {}) {
  const n = pts.length;
  const capSeg = opts.capSeg ?? 3;
  const rr = radii.map((r) => (Array.isArray(r) ? r : [r, r]));
  const tans = pts.map((p, i) => nrm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  const ref = opts.ref || (Math.abs(tans[0][2]) < 0.85 ? [0, 0, 1] : [1, 0, 0]);
  const frames = [];
  let v = sub(ref, mul(tans[0], dot(ref, tans[0])));
  for (let i = 0; i < n; i++) {
    const t = tans[i];
    v = sub(v, mul(t, dot(v, t)));
    if (len(v) < 1e-5) v = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    v = nrm(v);
    frames.push([cross(t, v), v, t]); // u, v, a  (u = a x v keeps outward winding)
  }
  const capRings = (iEnd, dir) => {
    const [rx, ry] = rr[iEnd];
    const f = frames[iEnd];
    const out = [];
    for (let k = capSeg; k >= 1; k--) { // pole first, then towards the equator
      const al = (k / capSeg) * Math.PI / 2;
      out.push({ c: madd(pts[iEnd], f[2], dir * Math.sin(al) * Math.min(rx, ry) * (opts.capFlat ?? 1)), rx: rx * Math.cos(al), ry: ry * Math.cos(al), f });
    }
    return out;
  };
  const rings = [];
  if (opts.capStart) rings.push(...capRings(0, -1));
  for (let i = 0; i < n; i++) rings.push({ c: pts[i], rx: rr[i][0], ry: rr[i][1], f: frames[i] });
  if (opts.capEnd) rings.push(...capRings(n - 1, 1).reverse());
  sweepRings(w, rings, seg, style, opts);
}

/**
 * Generic ring sweep. rings: [{c, rx, ry, f:[u,v,a]}]; point = c + u*sin(phi)*rx + v*cos(phi)*ry.
 * opts: phi0/phi1 open arc, twoSided, rfn(phi, k) radius multiplier, capTop/capBottom flat fan
 * caps, colFn(phi, k, p) colour override, ptx(p, n) -> [p, n] point transform.
 */
export function sweepRings(w, rings, seg, style, opts = {}) {
  const nR = rings.length;
  if (nR < 2) return;
  const phi0 = opts.phi0 ?? 0, phi1 = opts.phi1 ?? Math.PI * 2;
  const s = [0];
  for (let k = 1; k < nR; k++) s.push(s[k - 1] + len(sub(rings[k].c, rings[k - 1].c)) + 1e-6);
  const meanR = (k) => (rings[k].rx + rings[k].ry) / 2;
  const cols = seg + 1;
  // local-space points and normals
  const LP = new Array(nR * cols), LN = new Array(nR * cols), LC = new Array(nR * cols);
  for (let k = 0; k < nR; k++) {
    const R = rings[k];
    const [u, v, a] = R.f;
    const kp = Math.max(0, k - 1), kn = Math.min(nR - 1, k + 1);
    const slope = (meanR(kn) - meanR(kp)) / Math.max(1e-6, s[kn] - s[kp]);
    for (let j = 0; j <= seg; j++) {
      const phi = phi0 + (phi1 - phi0) * (j / seg);
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const m = opts.rfn ? opts.rfn(phi, k) : 1;
      const rx = R.rx * m, ry = R.ry * m;
      let p = [R.c[0] + u[0] * sp * rx + v[0] * cp * ry, R.c[1] + u[1] * sp * rx + v[1] * cp * ry, R.c[2] + u[2] * sp * rx + v[2] * cp * ry];
      const gx = sp / Math.max(rx, 1e-5), gy = cp / Math.max(ry, 1e-5);
      const gl = Math.hypot(gx, gy) || 1;
      let nn = [(u[0] * gx + v[0] * gy) / gl - a[0] * slope, (u[1] * gx + v[1] * gy) / gl - a[1] * slope, (u[2] * gx + v[2] * gy) / gl - a[2] * slope];
      nn = nrm(nn);
      if (opts.ptx) { const r = opts.ptx(p, nn); p = r[0]; nn = r[1]; }
      const idx = k * cols + j;
      LP[idx] = p; LN[idx] = nn;
      LC[idx] = opts.colFn ? opts.colFn(phi, k, p) : null;
    }
  }
  const sides = opts.twoSided ? [1, -1] : [1];
  for (const side of sides) {
    const b0 = w.nv;
    for (let k = 0; k < nR; k++) {
      for (let j = 0; j <= seg; j++) {
        const idx = k * cols + j;
        const p = LP[idx], nn = LN[idx];
        const phi = phi0 + (phi1 - phi0) * (j / seg);
        const col = LC[idx];
        w.vert(p[0], p[1], p[2], nn[0] * side, nn[1] * side, nn[2] * side, phi * meanR(k), s[k], style,
          side < 0 ? (col || style.col).map((x) => x * 0.6) : col);
      }
    }
    for (let k = 0; k < nR - 1; k++) {
      for (let j = 0; j < seg; j++) {
        const a = b0 + k * cols + j;
        w.quad(a, a + 1, a + cols + 1, a + cols);
      }
    }
  }
  const fan = (k, dirSign) => {
    const R = rings[k];
    let cpt = R.c.slice(), nn = mul(R.f[2], dirSign);
    if (opts.ptx) { const r = opts.ptx(cpt, nn); cpt = r[0]; nn = r[1]; }
    const ci = w.vert(cpt[0], cpt[1], cpt[2], nn[0], nn[1], nn[2], 0, 0, style, opts.capCol || null);
    const r0 = w.nv;
    for (let j = 0; j <= seg; j++) {
      const p = LP[k * cols + j];
      w.vert(p[0], p[1], p[2], nn[0], nn[1], nn[2], p[0], p[2], style, opts.capCol || null);
    }
    for (let j = 0; j < seg; j++) w.tri(ci, r0 + j, r0 + j + 1);
  };
  if (opts.capBottom) fan(0, -1);
  if (opts.capTop) fan(nR - 1, 1);
}

/**
 * Ellipsoid (or partial cap) with basis B = [ex, ey, ez]. Latitude theta from +ey (0) to -ey (PI),
 * longitude phi from +ez toward +ex. opts: thetaMax(phi) for caps, theta0, rfn(lx,ly,lz,phi,th)
 * radial multiplier, phi0/phi1 longitudinal range, colFn, twoSided.
 */
export function ellipsoid(w, c, B, rx, ry, rz, su, sv, style, opts = {}) {
  const [ex, ey, ez] = B || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cols = su + 1;
  const phi0 = opts.phi0 ?? 0, phi1 = opts.phi1 ?? Math.PI * 2;
  const th0 = opts.theta0 ?? 0;
  const sides = opts.twoSided ? [1, -1] : [1];
  for (const side of sides) {
    const b0 = w.nv;
    for (let i = 0; i <= sv; i++) {
      for (let j = 0; j <= su; j++) {
        const phi = phi0 + (phi1 - phi0) * (j / su);
        const tmax = opts.thetaMax ? opts.thetaMax(phi) : Math.PI;
        const th = th0 + (tmax - th0) * (i / sv);
        const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(phi), cp = Math.cos(phi);
        const lx = st * sp, ly = ct, lz = st * cp;
        const m = opts.rfn ? opts.rfn(lx, ly, lz, phi, th) : 1;
        const x = lx * rx * m, y = ly * ry * m, z = lz * rz * m;
        let nx = lx / rx, ny = ly / ry, nz = lz / rz;
        const nl = (Math.hypot(nx, ny, nz) || 1) * side; nx /= nl; ny /= nl; nz /= nl;
        const px = c[0] + ex[0] * x + ey[0] * y + ez[0] * z;
        const py = c[1] + ex[1] * x + ey[1] * y + ez[1] * z;
        const pz = c[2] + ex[2] * x + ey[2] * y + ez[2] * z;
        let col = opts.colFn ? opts.colFn(lx, ly, lz, phi, th) : null;
        if (side < 0) col = (col || style.col).map((q) => q * 0.55);
        w.vert(px, py, pz, ex[0] * nx + ey[0] * ny + ez[0] * nz, ex[1] * nx + ey[1] * ny + ez[1] * nz, ex[2] * nx + ey[2] * ny + ez[2] * nz,
          phi * (rx + rz) * 0.5, th * ry, style, col);
      }
    }
    for (let i = 0; i < sv; i++) {
      for (let j = 0; j < su; j++) {
        const a = b0 + i * cols + j;
        w.quad(a, a + 1, a + cols + 1, a + cols);
      }
    }
  }
}

/** Oriented box with flat-shaded faces. B = [ex, ey, ez] unit axes, h* = half sizes. */
export function box(w, c, B, hx, hy, hz, style, colTop) {
  const [ex, ey, ez] = B || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const F = [
    { n: ex, p: ez, q: ey, hn: hx, hp: hz, hq: hy },
    { n: mul(ex, -1), p: ez, q: ey, hn: hx, hp: hz, hq: hy },
    { n: ey, p: ex, q: ez, hn: hy, hp: hx, hq: hz, top: true },
    { n: mul(ey, -1), p: ex, q: ez, hn: hy, hp: hx, hq: hz },
    { n: ez, p: ex, q: ey, hn: hz, hp: hx, hq: hy },
    { n: mul(ez, -1), p: ex, q: ey, hn: hz, hp: hx, hq: hy },
  ];
  for (const f of F) {
    const cc = madd(c, f.n, f.hn);
    const idx = [];
    for (const [sp, sq] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = madd(madd(cc, f.p, sp * f.hp), f.q, sq * f.hq);
      idx.push(w.vert(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2], sp * f.hp, sq * f.hq, style, f.top && colTop ? colTop : null));
    }
    w.quad(idx[0], idx[1], idx[2], idx[3]);
  }
}
