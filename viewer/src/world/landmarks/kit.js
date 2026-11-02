import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared toolkit for the landmarks module: facade frames, geometry buckets (merged per
// material), code-generated textures (no image files) and a world-space weathering patch.
// Everything is deterministic: randomness comes only from ctx.rng(key) streams.

// ---------------------------------------------------------------- frames

/**
 * Facade frame on an adopted frontage edge a->b (metres, x/z). Local axes:
 *   x = text baseline direction (left->right for a viewer facing the facade),
 *   y = up, z = outward normal (away from the building centroid).
 * Origin: edge midpoint at y = baseY. `xOfT(t)` maps the adopted fraction t (measured from a,
 * as in scripts/build_period_scene.py) to local x.
 */
export function edgeFrame(a, b, centroid, baseY) {
  const W = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / W, (b[1] - a[1]) / W];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let out = [-u[1], u[0]];
  if ((mid[0] - centroid[0]) * out[0] + (mid[1] - centroid[1]) * out[1] < 0) out = [-out[0], -out[1]];
  const baseline = [out[1], -out[0]]; // so that baseline x up = out (right-handed)
  const sign = baseline[0] * u[0] + baseline[1] * u[1] > 0 ? 1 : -1;
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(baseline[0], 0, baseline[1]),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(out[0], 0, out[1]),
  );
  m.setPosition(mid[0], baseY, mid[1]);
  const inv = m.clone().invert();
  return {
    a, b, W, u, mid, out, baseline, baseY, matrix: m, inverse: inv,
    xOfT: (t) => sign * (t - 0.5) * W,
    toWorld: (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m),
    toLocal: (wx, wy, wz) => new THREE.Vector3(wx, wy, wz).applyMatrix4(inv),
  };
}

/** Frame from an explicit origin (x,y,z) with local x axis along dirXZ and z = x-axis cross up. */
export function axisFrame(origin, dirXZ) {
  const d = [dirXZ[0], dirXZ[1]];
  const L = Math.hypot(d[0], d[1]); d[0] /= L; d[1] /= L;
  const z = [-d[1], d[0]];
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(d[0], 0, d[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(z[0], 0, z[1]));
  m.setPosition(origin[0], origin[1], origin[2]);
  return { matrix: m, inverse: m.clone().invert(), x: d, z };
}

// ---------------------------------------------------------------- geometry

/** Keep only position/normal/uv, make indexed, so that everything can be merged. */
export function normGeo(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.clearGroups();
  return g;
}

/** Box with UVs in metres (so textures repeat by physical size). Centered at origin. */
export function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
  }
  return g;
}

/** Box from min/max corners in the current local frame. */
export function boxMinMax(x0, y0, z0, x1, y1, z1) {
  const g = boxGeo(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Quad with given 4 corners (counter-clockwise seen from the front) and uv size. */
export function quadGeo(p0, p1, p2, p3, uvW = 1, uvH = 1, uvOff = [0, 0], want = null) {
  if (want) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { const t = p1; p1 = p3; p3 = t; const tw = uvW; uvW = uvH; uvH = tw; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...p0, ...p1, ...p2, ...p3]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([uvOff[0], uvOff[1], uvOff[0] + uvW, uvOff[1], uvOff[0] + uvW, uvOff[1] + uvH, uvOff[0], uvOff[1] + uvH]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Vertical cylinder (axis y) from y0 to y1, UVs in metres. */
export function cylGeo(r0, r1, y0, y1, seg = 12, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open);
  g.translate(0, (y0 + y1) / 2, 0);
  const uv = g.attributes.uv;
  const circ = Math.PI * (r0 + r1);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * (y1 - y0));
  return g;
}

/** Tube along points with metre UVs (u along length). */
export function tubeGeo(points, radius, tubular = 24, radial = 8, closed = false, curveType = 'centripetal') {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed, curveType);
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
  const L = curve.getLength();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * Math.PI * 2 * radius);
  g.userData.curve = curve;
  return g;
}

/** Collects geometries per material key and merges them into one mesh per key. */
export class Bucket {
  constructor() { this.parts = new Map(); }
  add(key, geo, matrix = null) {
    if (matrix) geo.applyMatrix4(matrix);
    normGeo(geo);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
    return geo;
  }
  /** materials: key -> Material | {material, castShadow, receiveShadow, renderOrder} */
  build(materials, name = 'bucket') {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.parts) {
      let spec = materials[key];
      if (!spec) throw new Error(`landmarks: no material for bucket key ${key}`);
      if (spec.isMaterial) spec = { material: spec };
      // merge in chunks to keep index sizes sane
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`landmarks: merge failed for ${key}`);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, spec.material);
      mesh.name = `${name}:${key}`;
      mesh.castShadow = spec.castShadow !== undefined ? spec.castShadow : true;
      mesh.receiveShadow = spec.receiveShadow !== undefined ? spec.receiveShadow : true;
      if (spec.noShadow) mesh.userData.noShadow = true;
      if (spec.renderOrder) mesh.renderOrder = spec.renderOrder;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    return group;
  }
}

// ---------------------------------------------------------------- noise & textures

/** Periodic value noise (separate integer periods per axis) for tileable textures. */
export function periodicNoise(rand, size = 512) {
  const vals = new Float32Array(size * size);
  for (let i = 0; i < vals.length; i++) vals[i] = rand();
  const s = (t) => t * t * (3 - 2 * t);
  function n2(x, y, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = s(x - xi), yf = s(y - yi);
    const X0 = ((xi % px) + px) % px, X1 = (X0 + 1) % px;
    const Y0 = ((yi % py) + py) % py, Y1 = (Y0 + 1) % py;
    const v = (X, Y) => vals[(Y % size) * size + (X % size)];
    const a = v(X0, Y0), b = v(X1, Y0), c = v(X0, Y1), d = v(X1, Y1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  function fbm(x, y, px, py, oct = 4, gain = 0.5) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * n2(x * f, y * f, px * f, py * f); norm += amp; amp *= gain; f *= 2; }
    return sum / norm;
  }
  return { n2, fbm };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // CPU-backed 2D context: avoids queuing raster work in the (SwiftShader) GPU process, where a
  // later readback would otherwise synchronise with every module's deferred canvas drawing.
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Grey-scale tileable noise canvas (RGBA all = value) for overlay painting. */
export function noiseCanvas(rand, size, cellsX, cellsY, oct = 4, contrast = 1) {
  const N = periodicNoise(rand, 256);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = N.fbm((x / size) * cellsX, (y / size) * cellsY, cellsX, cellsY, oct);
    v = Math.min(1, Math.max(0, 0.5 + (v - 0.5) * contrast));
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Macro texture for the world-space weathering patch.
 * R: low-frequency mottling, G: vertical rain-streak field (thin in x, long in y), B: speckle.
 */
export function macroTexture(rand) {
  const size = 256;
  const N = periodicNoise(rand, 256);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const r = N.fbm(u * 4, v * 4, 4, 4, 5);
    const st = N.fbm(u * 48, v * 3, 48, 3, 3) * 0.75 + N.fbm(u * 96, v * 6, 96, 6, 2) * 0.25;
    const sp = N.n2(u * 128, v * 128, 128, 128);
    const i = (y * size + x) * 4;
    d[i] = Math.round(r * 255); d[i + 1] = Math.round(st * 255); d[i + 2] = Math.round(sp * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, { srgb: false, repeat: [1, 1] });
  return t;
}

/**
 * World-space weathering: large-scale mottling, vertical rain streaks and a dirty splash
 * zone near the ground. Patches a MeshStandardMaterial (non-instanced meshes only).
 * opts: {macro, baseY, dirtH, dirt, streak, mottle, tint:[r,g,b] (streak colour multiplier)}
 */
export function weather(mat, macro, opts = {}) {
  const o = { baseY: -100, dirtH: 0.7, dirt: 0.25, streak: 0.18, mottle: 0.12, streakScale: 1, ...opts };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacro = { value: macro };
    shader.uniforms.uW = { value: new THREE.Vector4(o.baseY, o.dirtH, o.dirt, o.streak) };
    shader.uniforms.uW2 = { value: new THREE.Vector4(o.mottle, o.streakScale, o.topY ?? 1e4, o.topStreak ?? 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPosL = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosL;\nuniform sampler2D uMacro;\nuniform vec4 uW;\nuniform vec4 uW2;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wp = vWPosL;
          float along = wp.x - wp.z;
          float m1 = texture2D(uMacro, vec2(along * 0.017, wp.y * 0.021 + wp.x * 0.007)).r;
          float st = texture2D(uMacro, vec2(along * 0.045 * uW2.y, wp.y * 0.011)).g;
          float sp = texture2D(uMacro, vec2(along * 0.31, wp.y * 0.29)).b;
          float h = wp.y - uW.x;
          float dirt = 1.0 - smoothstep(0.0, uW.y, h);
          float topz = smoothstep(uW2.z - 2.5, uW2.z, wp.y) * uW2.w;
          vec3 c = diffuseColor.rgb;
          c *= mix(1.0 - uW2.x, 1.0 + uW2.x * 0.45, m1);
          c *= 1.0 - (uW.w + topz) * smoothstep(0.5, 0.86, st);
          c *= 1.0 - 0.05 * uW2.x * step(0.82, sp);
          c *= 1.0 - dirt * uW.z;
          diffuseColor.rgb = c;
        }`);
  };
  mat.customProgramCacheKey = () => 'lm-weather';
  return mat;
}

// ---------------------------------------------------------------- painting helpers

export function rgbStr(c, a = 1) { return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`; }

/** Linear (Blender base colour) 0..1 to sRGB 0..255. */
export function lin2srgb(c) {
  return c.map((v) => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s)) * 255);
  });
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Canvas painter for one facade rectangle (metres). Local facade coordinates: x in [x0,x1],
 * y in [y0,y1] (y up). Texture uv: u=(x-x0)/(x1-x0), v=(y-y0)/(y1-y0).
 */
export class FacadePainter {
  constructor(x0, x1, y0, y1, ppm, maxW = 2048) {
    let p = ppm;
    if ((x1 - x0) * p > maxW) p = maxW / (x1 - x0);
    if ((y1 - y0) * p > maxW) p = Math.min(p, maxW / (y1 - y0));
    this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1; this.ppm = p;
    this.w = Math.max(4, Math.round((x1 - x0) * p)); this.h = Math.max(4, Math.round((y1 - y0) * p));
    this.canvas = makeCanvas(this.w, this.h);
    this.g = this.canvas.getContext('2d');
  }
  X(x) { return (x - this.x0) * this.ppm; }
  Y(y) { return (this.y1 - y) * this.ppm; }
  fill(rgb) { this.g.fillStyle = rgbStr(rgb); this.g.fillRect(0, 0, this.w, this.h); }
  rect(x0, y0, x1, y1, style) { const g = this.g; g.fillStyle = style; g.fillRect(this.X(x0), this.Y(y1), (x1 - x0) * this.ppm, (y1 - y0) * this.ppm); }
  /** overlay a tileable noise canvas at a given metre scale using a blend mode */
  noise(nc, metres, alpha, mode = 'overlay', offset = [0, 0]) {
    const g = this.g; g.save();
    g.globalAlpha = alpha; g.globalCompositeOperation = mode;
    const pat = g.createPattern(nc, 'repeat');
    const s = (metres * this.ppm) / nc.width;
    pat.setTransform(new DOMMatrix([s, 0, 0, s, offset[0] * this.ppm, offset[1] * this.ppm]));
    g.fillStyle = pat; g.fillRect(0, 0, this.w, this.h);
    g.restore();
  }
  /** vertical rain streak below (x,y) */
  streak(x, y, len, wid, rgb, a) {
    const g = this.g; const X = this.X(x), Y0 = this.Y(y), Y1 = this.Y(y - len);
    const w = Math.max(1, wid * this.ppm);
    const gr = g.createLinearGradient(0, Y0, 0, Y1);
    gr.addColorStop(0, rgbStr(rgb, a)); gr.addColorStop(0.3, rgbStr(rgb, a * 0.65)); gr.addColorStop(1, rgbStr(rgb, 0));
    g.fillStyle = gr; g.fillRect(X - w / 2, Y0, w, Y1 - Y0);
  }
  /** many thin streaks along a horizontal run (e.g. under a coping or sill) */
  streakRun(rand, x0, x1, y, lenMin, lenMax, density, rgb, a) {
    const n = Math.max(1, Math.round((x1 - x0) * density));
    for (let i = 0; i < n; i++) {
      const x = x0 + rand() * (x1 - x0);
      this.streak(x, y, lenMin + rand() * (lenMax - lenMin), 0.02 + rand() * 0.12, rgb, a * (0.35 + rand() * 0.65));
    }
  }
  /** horizontal gradient band (e.g. splash dirt near ground) */
  band(y0, y1, rgbBottom, aBottom, aTop = 0) {
    const g = this.g; const gr = g.createLinearGradient(0, this.Y(y0), 0, this.Y(y1));
    gr.addColorStop(0, rgbStr(rgbBottom, aBottom)); gr.addColorStop(1, rgbStr(rgbBottom, aTop));
    g.fillStyle = gr; g.fillRect(0, this.Y(y1), this.w, (y1 - y0) * this.ppm);
  }
  line(x0, y0, x1, y1, rgb, a, widthM) {
    const g = this.g; g.strokeStyle = rgbStr(rgb, a); g.lineWidth = Math.max(0.6, widthM * this.ppm);
    g.beginPath(); g.moveTo(this.X(x0), this.Y(y0)); g.lineTo(this.X(x1), this.Y(y1)); g.stroke();
  }
  /** soft blotch */
  blotch(x, y, rx, ry, rgb, a) {
    const g = this.g; const X = this.X(x), Y = this.Y(y);
    const r = Math.max(rx, ry) * this.ppm;
    g.save(); g.translate(X, Y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, rgbStr(rgb, a)); gr.addColorStop(1, rgbStr(rgb, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
  }
  texture(opts) { return toTexture(this.canvas, opts); }
  /** uv for local facade x,y */
  uv(x, y) { return [(x - this.x0) / (this.x1 - this.x0), (y - this.y0) / (this.y1 - this.y0)]; }
}

/** Planar quad in facade-local space (z constant) whose uvs map into a FacadePainter. */
export function facadeQuad(p, x0, y0, x1, y1, z) {
  const [u0, v0] = p.uv(x0, y0); const [u1, v1] = p.uv(x1, y1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * Wall (z = const plane, facing +z) covering rectangle [x0,x1]x[y0,y1] with rectangular holes
 * (each {x0,x1,y0,y1}); triangulated as a THREE.Shape so that openings are real.
 * UVs map into painter p (or metres if p is null).
 */
export function wallWithHoles(x0, y0, x1, y1, holes, z, p = null) {
  const s = new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);
  for (const h of holes) {
    s.holes.push(new THREE.Path([new THREE.Vector2(h.x0, h.y0), new THREE.Vector2(h.x0, h.y1), new THREE.Vector2(h.x1, h.y1), new THREE.Vector2(h.x1, h.y0)]));
  }
  const g = new THREE.ShapeGeometry(s, 1);
  const pos = g.attributes.position; const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, z);
    if (p) { const [u, v] = p.uv(x, y); uv.setXY(i, u, v); } else uv.setXY(i, x, y);
  }
  g.computeVertexNormals();
  return g;
}

/** Reveal (jamb) faces of a rectangular opening between z0 (back) and z1 (front). */
export function revealGeo(h, z0, z1) {
  const parts = [];
  const d = z1 - z0;
  // left jamb faces +x, right jamb faces -x, head faces -y, sill faces +y
  parts.push(quadGeo([h.x0, h.y0, z0], [h.x0, h.y0, z1], [h.x0, h.y1, z1], [h.x0, h.y1, z0], d, h.y1 - h.y0, [0, 0], [1, 0, 0]));
  parts.push(quadGeo([h.x1, h.y0, z1], [h.x1, h.y0, z0], [h.x1, h.y1, z0], [h.x1, h.y1, z1], d, h.y1 - h.y0, [0, 0], [-1, 0, 0]));
  parts.push(quadGeo([h.x0, h.y1, z1], [h.x1, h.y1, z1], [h.x1, h.y1, z0], [h.x0, h.y1, z0], h.x1 - h.x0, d, [0, 0], [0, -1, 0]));
  parts.push(quadGeo([h.x0, h.y0, z0], [h.x1, h.y0, z0], [h.x1, h.y0, z1], [h.x0, h.y0, z1], h.x1 - h.x0, d, [0, 0], [0, 1, 0]));
  return mergeGeometries(parts.map(normGeo), false);
}

/** Prism walls + top cap of a CCW footprint, uv = (perimeter metres, height metres). */
export function prismGeo(footprint, y0, y1, { top = true, bottom = false } = {}) {
  const parts = [];
  let acc = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // CCW in (x,z) with signedArea>0 -> outward normal (dz,-dx): quad order a(bottom), b(bottom), b(top), a(top) seen from outside
    parts.push(quadGeo([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], L, y1 - y0, [acc, y0]));
    acc += L;
  }
  if (top) {
    const s = new THREE.Shape(footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2); g.translate(0, y1, 0);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    parts.push(g);
  }
  if (bottom) {
    const s = new THREE.Shape(footprint.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(Math.PI / 2); g.translate(0, y0, 0);
    parts.push(g);
  }
  // fix winding: verify first wall normal points outward; quadGeo computes normals from winding
  return mergeGeometries(parts.map(normGeo), false);
}

/** Signed area of a ring in (x,z) (positive = CCW as used by core/data.js). */
export function ringArea(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Offset a convex-ish quad footprint edge inwards (used for parapets/copings). */
export function insetRing(ring, d) {
  const n = ring.length; const out = [];
  const ccw = ringArea(ring) > 0;
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
    const e1 = norm2([c[0] - p[0], c[1] - p[1]]), e2 = norm2([q[0] - c[0], q[1] - c[1]]);
    // inward normal for CCW (x,z) with outward (dz,-dx) is (-dz, dx)
    const s = ccw ? 1 : -1;
    const n1 = [-e1[1] * s, e1[0] * s], n2 = [-e2[1] * s, e2[0] * s];
    const bis = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
    const cosh = bis[0] * n1[0] + bis[1] * n1[1];
    const k = d / Math.max(0.2, cosh);
    out.push([c[0] + bis[0] * k, c[1] + bis[1] * k]);
  }
  return out;
}

export function norm2(v) { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; }

/** Point-in-polygon in (x,z). */
export function insidePoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]; const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
