import * as THREE from 'three';

// Geometry kit for street props: every prop is assembled from cached unit primitives that are
// transformed and appended into a few merged batches (one per material), so the CPU renderer
// sees a handful of draw calls. Per-vertex attributes carry the PBR response and weathering:
//   color  (linear RGB, AO-darkened near the prop's ground contact)
//   aPbr   (roughness, metalness, wear, unused)
//   aEmit  (night emission, day emission) multiplied with the vertex colour.

class Grow {
  constructor(Type, cap = 4096) { this.T = Type; this.a = new Type(cap); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new this.T(cap); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  view() { return this.a.slice(0, this.n); }
}

/** Material response presets (roughness, metalness, wear). */
export const MAT = {
  paint: [0.52, 0.0, 0.7],
  paintGloss: [0.32, 0.0, 0.45],
  carPaint: [0.28, 0.12, 0.35],
  metalPaint: [0.48, 0.3, 0.8],
  chrome: [0.14, 1.0, 0.3],
  steel: [0.38, 0.9, 0.55],
  galv: [0.5, 0.75, 0.65],
  rust: [0.85, 0.2, 1.0],
  rubber: [0.86, 0.0, 0.25],
  tyre: [0.8, 0.0, 0.4],
  plastic: [0.5, 0.0, 0.45],
  concrete: [0.95, 0.0, 1.0],
  wood: [0.82, 0.0, 0.85],
  porcelain: [0.22, 0.0, 0.2],
  glassDark: [0.05, 0.0, 0.12],
  lens: [0.12, 0.0, 0.1],
  cardboard: [0.95, 0.0, 0.45],
  cloth: [0.92, 0.0, 0.5],
  leaf: [0.62, 0.0, 0.15],
  soil: [1.0, 0.0, 0.3],
  enamel: [0.3, 0.0, 0.55],
};

const _c = new THREE.Color();
/** sRGB hex -> linear [r,g,b]. */
export function lin(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
export function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function scalec(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
/** Jitter a linear colour by a multiplicative amount in value and a small hue/sat drift. */
export function jitter(col, rng, amt = 0.12) {
  const k = 1 + (rng() - 0.5) * 2 * amt;
  const d = (rng() - 0.5) * amt * 0.5;
  return [Math.max(0, col[0] * k * (1 + d)), Math.max(0, col[1] * k), Math.max(0, col[2] * k * (1 - d))];
}

// ---- cached unit primitives -------------------------------------------------------------
const cache = new Map();
function cached(key, make) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    if (!g.index) g = toIndexed(g);
    if (!g.attributes.normal) g.computeVertexNormals();
    cache.set(key, g);
  }
  return g;
}
function toIndexed(g) {
  const n = g.attributes.position.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
export const prim = {
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (n = 8, rt = 1, open = false) => cached(`cyl${n}:${rt.toFixed(3)}:${open}`, () => new THREE.CylinderGeometry(rt, 1, 1, n, 1, open)),
  sphere: (w = 10, h = 7) => cached(`sph${w}:${h}`, () => new THREE.SphereGeometry(1, w, h)),
  hemi: (w = 10, h = 4) => cached(`hemi${w}:${h}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI / 2)),
  torus: (tube = 0.1, rs = 6, ts = 16, arc = Math.PI * 2) => cached(`tor${tube.toFixed(3)}:${rs}:${ts}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc)),
  ico: (detail = 1) => cached(`ico${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),
  plane: () => cached('plane', () => new THREE.PlaneGeometry(1, 1)),
  circle: (n = 16) => cached(`circ${n}`, () => new THREE.CircleGeometry(1, n)),
};

// ---- transforms ---------------------------------------------------------------------------
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
/** Matrix from position, Euler (YXZ order: heading first), scale. */
export function mat4(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
export function mul(a, b) { return new THREE.Matrix4().multiplyMatrices(a, b); }

// ---- batch ---------------------------------------------------------------------------------
export class Batch {
  constructor({ uv = false } = {}) {
    this.useUv = uv;
    this.p = new Grow(Float32Array); this.n = new Grow(Float32Array); this.c = new Grow(Float32Array);
    this.pbr = new Grow(Float32Array); this.em = new Grow(Float32Array); this.i = new Grow(Uint32Array);
    if (uv) this.uv = new Grow(Float32Array);
    this.vc = 0;
    // contact-AO state, set per prop: vertices below groundY+aoH get darkened
    this.groundY = -1e9; this.aoH = 0.3; this.aoMin = 0.55;
    this.emit = [0, 0];
  }
  get triCount() { return this.i.n / 3; }
  setGround(y, aoH = 0.3, aoMin = 0.55) { this.groundY = y; this.aoH = aoH; this.aoMin = aoMin; }

  /**
   * Append geometry transformed by matrix m. col: linear [r,g,b] or a function (x,y,z,nx,ny,nz)
   * returning one. pbr: [rough, metal, wear]. opts.uvRect=[u0,v0,u1,v1] remaps 0..1 uvs.
   */
  add(geo, m, col, pbr = MAT.paint, opts = {}) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uvA = geo.attributes.uv;
    const idx = geo.index;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const e = m.elements, ne = nm.elements;
    const cnt = pos.count;
    const base = this.vc;
    this.p.ensure(cnt * 3); this.n.ensure(cnt * 3); this.c.ensure(cnt * 3); this.pbr.ensure(cnt * 4); this.em.ensure(cnt * 2);
    if (this.useUv) this.uv.ensure(cnt * 2);
    const P = this.p.a, N = this.n.a, C = this.c.a, R = this.pbr.a, E = this.em.a;
    const emit = opts.emit || this.emit;
    const flip = opts.flipNormals ? -1 : 1;
    const gy = this.groundY, aoH = this.aoH, aoMin = this.aoMin;
    const fn = typeof col === 'function';
    const uvr = opts.uvRect;
    const ao = opts.ao !== false;
    for (let k = 0; k < cnt; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      let nx = 0, ny = 1, nz = 0;
      if (nor) {
        const ax = nor.getX(k), ay = nor.getY(k), az = nor.getZ(k);
        nx = ne[0] * ax + ne[3] * ay + ne[6] * az;
        ny = ne[1] * ax + ne[4] * ay + ne[7] * az;
        nz = ne[2] * ax + ne[5] * ay + ne[8] * az;
        const l = Math.hypot(nx, ny, nz) || 1; nx *= flip / l; ny *= flip / l; nz *= flip / l;
      }
      const o3 = this.p.n;
      P[o3] = wx; P[o3 + 1] = wy; P[o3 + 2] = wz;
      N[o3] = nx; N[o3 + 1] = ny; N[o3 + 2] = nz;
      let cr, cg, cb;
      if (fn) { const cc = col(wx, wy, wz, nx, ny, nz, x, y, z); cr = cc[0]; cg = cc[1]; cb = cc[2]; } else { cr = col[0]; cg = col[1]; cb = col[2]; }
      if (ao) {
        const h = wy - gy;
        if (h < aoH) { const t = Math.max(0, h / aoH); const f = aoMin + (1 - aoMin) * t * t * (3 - 2 * t); cr *= f; cg *= f; cb *= f; }
        // undersides are darker (sky occlusion)
        if (ny < -0.5) { cr *= 0.7; cg *= 0.7; cb *= 0.7; }
      }
      C[o3] = cr; C[o3 + 1] = cg; C[o3 + 2] = cb;
      this.p.n += 3; this.n.n += 3; this.c.n += 3;
      const o4 = this.pbr.n;
      R[o4] = pbr[0]; R[o4 + 1] = pbr[1]; R[o4 + 2] = pbr[2]; R[o4 + 3] = 0;
      this.pbr.n += 4;
      const o2 = this.em.n;
      E[o2] = emit[0]; E[o2 + 1] = emit[1];
      this.em.n += 2;
      if (this.useUv) {
        let u = uvA ? uvA.getX(k) : 0, v = uvA ? uvA.getY(k) : 0;
        if (uvr) { u = uvr[0] + (uvr[2] - uvr[0]) * u; v = uvr[1] + (uvr[3] - uvr[1]) * v; }
        this.uv.a[this.uv.n++] = u; this.uv.a[this.uv.n++] = v;
      }
    }
    this.vc += cnt;
    const ic = idx.count;
    this.i.ensure(ic);
    const I = this.i.a;
    if (opts.flipNormals) {
      for (let k = 0; k < ic; k += 3) { I[this.i.n++] = base + idx.getX(k); I[this.i.n++] = base + idx.getX(k + 2); I[this.i.n++] = base + idx.getX(k + 1); }
    } else {
      for (let k = 0; k < ic; k++) I[this.i.n++] = base + idx.getX(k);
    }
    // mirror transforms invert winding
    if (m.determinant() < 0) {
      for (let k = this.i.n - ic; k < this.i.n; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
    }
    return this;
  }

  // ---- convenience primitives (W: parent/world matrix; local placement in W's frame) ----
  /** Box centred at (x,y,z) with size (sx,sy,sz), rotated by (ry,rx,rz). */
  box(W, x, y, z, sx, sy, sz, col, pbr, ry = 0, rx = 0, rz = 0, opts) {
    return this.add(prim.box(), mul(W, mat4(x, y, z, ry, rx, rz, sx, sy, sz)), col, pbr, opts);
  }
  /** Vertical cylinder: base centre (x,y,z), radius r (bottom), height h, top radius ratio rt. */
  cyl(W, x, y, z, r, h, col, pbr, n = 8, rt = 1, ry = 0, rx = 0, rz = 0, opts) {
    const m = mul(W, mul(mat4(x, y, z, ry, rx, rz), mat4(0, h / 2, 0, 0, 0, 0, r, h, r)));
    return this.add(prim.cyl(n, rt, opts && opts.open), m, col, pbr, opts);
  }
  /** Cylinder between two local points a,b (arrays), radius r. */
  rod(W, a, b, r, col, pbr, n = 6, rt = 1, opts) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return this;
    const dir = new THREE.Vector3(dx / L, dy / L, dz / L);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(r, L, r));
    return this.add(prim.cyl(n, rt, opts && opts.open), mul(W, m), col, pbr, opts);
  }
  sphere(W, x, y, z, rx, ry, rz, col, pbr, w = 10, h = 7, opts) {
    return this.add(prim.sphere(w, h), mul(W, mat4(x, y, z, 0, 0, 0, rx, ry, rz)), col, pbr, opts);
  }
  /** Torus in its local XY plane, major radius R, tube ratio t (tube radius = R*t). */
  torus(W, m, R, t, col, pbr, rs = 6, ts = 16, arc = Math.PI * 2, opts) {
    return this.add(prim.torus(t, rs, ts, arc), mul(W, mul(m, mat4(0, 0, 0, 0, 0, 0, R, R, R))), col, pbr, opts);
  }
  /**
   * Sweep a circle (n sides, radius r or r(i)) along a polyline of local points. Used for
   * wires, bent tubes, handlebars, cables.
   */
  tube(W, pts, r, col, pbr, n = 4, opts = {}) {
    if (pts.length < 2) return this;
    const pos = [], nor = [], idx = [];
    const up = new THREE.Vector3(0, 1, 0), alt = new THREE.Vector3(1, 0, 0);
    const T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3();
    let prevN = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      if (prevN) {
        // parallel transport: remove tangent component from previous normal
        Nn.copy(prevN).addScaledVector(T, -prevN.dot(T));
        if (Nn.lengthSq() < 1e-8) Nn.crossVectors(T, Math.abs(T.y) < 0.9 ? up : alt);
        Nn.normalize();
      } else {
        Nn.crossVectors(T, Math.abs(T.y) < 0.9 ? up : alt).normalize();
      }
      prevN = Nn.clone();
      B.crossVectors(T, Nn).normalize();
      const rr = typeof r === 'function' ? r(i, pts.length) : r;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const cx = Math.cos(ang), sx = Math.sin(ang);
        const ox = Nn.x * cx + B.x * sx, oy = Nn.y * cx + B.y * sx, oz = Nn.z * cx + B.z * sx;
        pos.push(pts[i][0] + ox * rr, pts[i][1] + oy * rr, pts[i][2] + oz * rr);
        nor.push(ox, oy, oz);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < n; k++) {
        const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + k, d = (i + 1) * n + ((k + 1) % n);
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return this.add(g, W, col, pbr, opts);
  }
  /** Lathe around local Y from profile [[r,y],...]. */
  lathe(W, x, y, z, profile, col, pbr, segs = 12, opts) {
    const key = `lathe:${segs}:${profile.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(';')}`;
    const g = cached(key, () => new THREE.LatheGeometry(profile.map(([r, yy]) => new THREE.Vector2(r, yy)), segs));
    return this.add(g, mul(W, mat4(x, y, z)), col, pbr, opts);
  }
  /** Extrude a 2D profile (in local XY) along local Z by depth, centred on z. */
  extrude(W, shapePts, depth, m, col, pbr, opts = {}) {
    const key = `ext:${depth.toFixed(3)}:${opts.bevel || 0}:${shapePts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(';')}`;
    const g = cached(key, () => {
      const sh = new THREE.Shape(shapePts.map(([a, b]) => new THREE.Vector2(a, b)));
      const bev = opts.bevel || 0;
      const geo = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * bev, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 4 });
      geo.translate(0, 0, -(depth - 2 * bev) / 2);
      geo.computeVertexNormals();
      return geo;
    });
    return this.add(g, mul(W, m), col, pbr, opts);
  }
  /** Textured quad (atlas): centre (x,y,z), size (w,h), facing local +Z after rotation ry. */
  quad(W, x, y, z, w, h, uvRect, col, pbr, ry = 0, rx = 0, opts = {}) {
    return this.add(prim.plane(), mul(W, mat4(x, y, z, ry, rx, 0, w, h, 1)), col, pbr, { ...opts, uvRect });
  }

  toMesh(material, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.n.view(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.view(), 3));
    g.setAttribute('aPbr', new THREE.BufferAttribute(this.pbr.view(), 4));
    g.setAttribute('aEmit', new THREE.BufferAttribute(this.em.view(), 2));
    if (this.useUv) g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
    g.setIndex(new THREE.BufferAttribute(this.i.view(), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name || 'streetprops-batch';
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** Catenary-like sagging wire between two world points, sampled into n points. */
export function sagWire(a, b, sag, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}
