// Small 3D ground features: gutter lids and steel grates, arterial kerb stones and kerb inlets,
// granite edging at plaza/forecourt boundaries, cast-iron covers, and the ladder crosswalk decal.
// All are flush with ctx.data.heightAt (tops 4-30 mm above it) so pedestrians/props placed on
// heightAt by other modules stay grounded. Generic period-plausible designs; no emblems or text.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas } from './util.js';

function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function hashNoise(seed) {
  // cheap deterministic 2D value noise for small canvases
  const h = (x, y) => { let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function noisyFill(g, w, h, base, amp, seed, scale = 6) {
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  const n1 = hashNoise(seed), n2 = hashNoise(seed + 7);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const k = 1 + amp * ((n1(x / scale, y / scale) - 0.5) * 0.8 + (n2(x / (scale * 6), y / (scale * 6)) - 0.5) * 1.2 + (n1(x * 1.7, y * 1.7) - 0.5) * 0.7);
    d[i] = Math.min(255, base[0] * k); d[i + 1] = Math.min(255, base[1] * k); d[i + 2] = Math.min(255, base[2] * k); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function lidTexture() {
  const W = 192, H = 264; // 0.355 x 0.495 m
  const c = makeCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  noisyFill(g, W, H, [150, 146, 138], 0.28, 11, 3);
  // chamfered arris and worn edges
  g.strokeStyle = 'rgba(40,36,32,0.55)'; g.lineWidth = 7; g.strokeRect(0, 0, W, H);
  g.strokeStyle = 'rgba(200,196,186,0.25)'; g.lineWidth = 2; g.strokeRect(6, 6, W - 12, H - 12);
  // two lifting slots
  g.fillStyle = 'rgb(22,20,18)';
  for (const y of [H * 0.18, H * 0.82]) { g.beginPath(); g.roundRect(W * 0.44, y - 5, W * 0.12, 10, 4); g.fill(); }
  // grime streaks and chips
  const n = hashNoise(5);
  g.globalAlpha = 0.3;
  for (let k = 0; k < 70; k++) { g.fillStyle = k % 3 ? '#3a342c' : '#6a6050'; g.beginPath(); g.arc(n(k, 1) * W, n(1, k) * H, 2 + n(k, k) * 10, 0, 6.28); g.fill(); }
  g.globalAlpha = 1;
  return canvasTex(c);
}

function graniteTexture(seed, base) {
  const W = 128, H = 512;
  const c = makeCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  noisyFill(g, W, H, base, 0.2, seed, 2);
  const n = hashNoise(seed + 3);
  for (let k = 0; k < 2200; k++) {
    const x = n(k, 3) * W, y = n(5, k) * H, v = n(k, 9);
    g.fillStyle = v < 0.5 ? 'rgba(40,40,42,0.7)' : v < 0.8 ? 'rgba(225,222,215,0.6)' : 'rgba(150,120,100,0.5)';
    g.fillRect(x, y, 1 + (v * 3 | 0) % 2, 1 + (v * 7 | 0) % 2);
  }
  // weathered darker ends and a slightly polished top band
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, 'rgba(30,28,25,0.35)'); gr.addColorStop(0.15, 'rgba(30,28,25,0)'); gr.addColorStop(0.85, 'rgba(30,28,25,0)'); gr.addColorStop(1, 'rgba(30,28,25,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(25,22,20,0.5)'; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3);
  return canvasTex(c);
}

// Cast-iron cover designs drawn into colour + height canvases (generic patterns, no emblems).
function coverTextures(design) {
  const S = 512;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const gc = col.getContext('2d', { willReadFrequently: true }), gh = hgt.getContext('2d');
  const round = design <= 1;
  noisyFill(gc, S, S, design === 3 ? [58, 54, 50] : [64, 60, 56], 0.35, 40 + design, 5);
  gh.fillStyle = '#404040'; gh.fillRect(0, 0, S, S);
  const C = S / 2;
  const both = (fn) => { fn(gc, true); fn(gh, false); };
  const raised = (g, isCol, a = 1) => { g.fillStyle = isCol ? `rgba(118,112,104,${0.85 * a})` : '#d0d0d0'; };
  if (round) {
    // frame ring (worn steel) and seating gap
    both((g, isCol) => { g.lineWidth = 26; g.strokeStyle = isCol ? 'rgb(112,106,98)' : '#c8c8c8'; g.beginPath(); g.arc(C, C, C - 14, 0, 6.283); g.stroke(); });
    both((g, isCol) => { g.lineWidth = 4; g.strokeStyle = isCol ? 'rgb(18,16,14)' : '#101010'; g.beginPath(); g.arc(C, C, C - 29, 0, 6.283); g.stroke(); });
    if (design === 0) {
      // concentric rings of raised bosses with radial ribs
      for (let ring = 0; ring < 6; ring++) {
        const r = 38 + ring * 34, n = 10 + ring * 7;
        for (let i = 0; i < n; i++) {
          const a = (i + (ring % 2) * 0.5) / n * Math.PI * 2;
          both((g, isCol) => { raised(g, isCol); g.save(); g.translate(C + Math.cos(a) * r, C + Math.sin(a) * r); g.rotate(a); g.fillRect(-9, -5, 18, 10); g.restore(); });
        }
      }
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        both((g, isCol) => { g.strokeStyle = isCol ? 'rgba(110,104,96,0.9)' : '#bdbdbd'; g.lineWidth = 7; g.beginPath(); g.moveTo(C + Math.cos(a) * 22, C + Math.sin(a) * 22); g.lineTo(C + Math.cos(a) * 222, C + Math.sin(a) * 222); g.stroke(); });
      }
      both((g, isCol) => { raised(g, isCol); g.beginPath(); g.arc(C, C, 20, 0, 6.283); g.fill(); });
    } else {
      // square lattice of raised blocks inside the circle
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
        const px = C + x * 34, py = C + y * 34;
        if (Math.hypot(px - C, py - C) > C - 48) continue;
        both((g, isCol) => { raised(g, isCol); g.fillRect(px - 12, py - 12, 24, 24); });
      }
    }
    // pick holes
    for (const a of [0.3, 0.3 + Math.PI]) both((g, isCol) => { g.fillStyle = isCol ? 'rgb(12,11,10)' : '#000'; g.beginPath(); g.ellipse(C + Math.cos(a) * 150, C + Math.sin(a) * 150, 14, 8, a, 0, 6.283); g.fill(); });
  } else if (design === 2) {
    both((g, isCol) => { g.lineWidth = 30; g.strokeStyle = isCol ? 'rgb(108,102,95)' : '#c8c8c8'; g.strokeRect(15, 15, S - 30, S - 30); });
    both((g, isCol) => { g.lineWidth = 4; g.strokeStyle = isCol ? 'rgb(16,14,12)' : '#101010'; g.strokeRect(32, 32, S - 64, S - 64); });
    for (let y = 50; y < S - 50; y += 30) for (let x = 50 + ((y / 30) % 2) * 15; x < S - 50; x += 30) {
      const vert = ((x + y) / 30 | 0) % 2;
      both((g, isCol) => { raised(g, isCol); g.save(); g.translate(x, y); g.rotate(vert ? 0.785 : -0.785); g.fillRect(-11, -3.5, 22, 7); g.restore(); });
    }
  } else {
    // slotted drain grate: dark void between bars
    both((g, isCol) => { g.fillStyle = isCol ? 'rgb(14,13,12)' : '#000'; g.fillRect(40, 40, S - 80, S - 80); });
    for (let x = 40; x < S - 40; x += 36) both((g, isCol) => { g.fillStyle = isCol ? 'rgb(84,78,72)' : '#d0d0d0'; g.fillRect(x, 40, 16, S - 80); });
    both((g, isCol) => { g.lineWidth = 40; g.strokeStyle = isCol ? 'rgb(100,94,86)' : '#c0c0c0'; g.strokeRect(20, 20, S - 40, S - 40); });
  }
  // wear: polish the raised tops in the middle, dirt and rust at the edges
  const gr = gc.createRadialGradient(C, C, S * 0.1, C, C, S * 0.55);
  gr.addColorStop(0, 'rgba(160,150,140,0.12)'); gr.addColorStop(0.7, 'rgba(90,60,40,0.05)'); gr.addColorStop(1, 'rgba(90,55,30,0.35)');
  gc.fillStyle = gr; gc.fillRect(0, 0, S, S);
  const n = hashNoise(77 + design);
  gc.globalAlpha = 0.25;
  for (let k = 0; k < 30; k++) { gc.fillStyle = k % 2 ? 'rgb(105,62,34)' : 'rgb(40,36,30)'; gc.beginPath(); gc.arc(n(k, 2) * S, n(3, k) * S, 6 + n(k, k) * 30, 0, 6.283); gc.fill(); }
  gc.globalAlpha = 1;
  return { map: canvasTex(col), bump: canvasTex(hgt, false) };
}

function grateGeometry(len, wid) {
  const parts = [];
  const fr = 0.03, th = 0.02;
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); parts.push(b); };
  box(wid, th, fr, 0, -th / 2, -len / 2 + fr / 2);
  box(wid, th, fr, 0, -th / 2, len / 2 - fr / 2);
  box(fr, th, len, -wid / 2 + fr / 2, -th / 2, 0);
  box(fr, th, len, wid / 2 - fr / 2, -th / 2, 0);
  const n = Math.max(3, Math.round(len / 0.045));
  for (let i = 1; i < n; i++) box(wid - 2 * fr, 0.018, 0.012, 0, -0.009, -len / 2 + (i * len) / n);
  box(0.012, 0.018, len - 2 * fr, 0, -0.012, 0);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function instanced(geo, mat, items, matrixFn, colorFn) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    matrixFn(it, m);
    mesh.setMatrixAt(i, m);
    if (colorFn) { colorFn(it, col); mesh.setColorAt(i, col); }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildFeatures(ctx, L) {
  const { heightAt } = ctx.data;
  const group = new THREE.Group();
  group.name = 'terrain-features';
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // highest ground under a rotated footprint: keeps tops proud of the TIN on slopes
  const topY = (x, z, ang, hl, hw) => {
    const ux = Math.sin(ang), uz = Math.cos(ang);
    let y = -Infinity;
    for (const [a, b] of [[-hl, -hw], [hl, -hw], [-hl, hw], [hl, hw], [0, 0]]) y = Math.max(y, heightAt(x + ux * a - uz * b, z + uz * a + ux * b));
    return y;
  };
  const counts = {};

  // ---------------------------------------------------------------- gutter lids and grates
  const lids = L.gutters.filter((g) => g.kind === 'lid');
  const grates = L.gutters.filter((g) => g.kind === 'grate');
  if (lids.length) {
    const geo = new THREE.BoxGeometry(0.35, 0.07, 0.482); geo.translate(0, -0.035, 0);
    const mat = new THREE.MeshStandardMaterial({ map: lidTexture(), roughness: 0.9, metalness: 0 });
    const mesh = instanced(geo, mat, lids, (g, m) => {
      const y = topY(g.x, g.z, g.ang, 0.25, 0.18) + 0.007 + (g.broken ? -0.004 : 0);
      e.set(g.broken ? 0.012 : 0, g.ang, 0); q.setFromEuler(e);
      m.compose(p.set(g.x, y, g.z), q, s.set(1, 1, 1));
    }, (g, c) => { const k = 0.5 + g.tone * 0.14; c.setRGB(k, k * 0.96, k * 0.9); });
    mesh.name = 'gutter-lids'; group.add(mesh); counts.lids = lids.length;
  }
  if (grates.length) {
    const geo = grateGeometry(0.47, 0.33);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 0.7, metalness: 0.45 });
    const mesh = instanced(geo, mat, grates, (g, m) => {
      const y = topY(g.x, g.z, g.ang, 0.25, 0.18) + 0.006;
      e.set(0, g.ang, 0); q.setFromEuler(e);
      m.compose(p.set(g.x, y, g.z), q, s.set(1, 1, 1));
    }, (g, c) => { const k = 0.7 + g.tone * 0.25; c.setRGB(k * 1.05, k * 0.9, k * 0.8); });
    mesh.name = 'gutter-grates'; group.add(mesh); counts.grates = grates.length;
  }

  // ---------------------------------------------------------------- kerbs and edging
  const kerbGeo = new THREE.BoxGeometry(0.18, 0.3, 1); kerbGeo.translate(0, -0.15, 0);
  if (L.kerbs.length) {
    const mat = new THREE.MeshStandardMaterial({ map: graniteTexture(21, [168, 166, 160]), roughness: 0.82, metalness: 0 });
    const mesh = instanced(kerbGeo, mat, L.kerbs, (k, m) => {
      const y = topY(k.x, k.z, k.ang, k.len / 2, k.w / 2) + k.h;
      e.set(k.tilt, k.ang, 0); q.setFromEuler(e);
      m.compose(p.set(k.x, y, k.z), q, s.set(k.w / 0.18, 1, k.len));
    }, (k, c) => { const v = 0.86 + k.tone * 0.08; c.setRGB(v, v, v * 0.98); });
    mesh.name = 'arterial-kerb'; group.add(mesh); counts.kerbs = L.kerbs.length;
  }
  if (L.edges.length) {
    const mat = new THREE.MeshStandardMaterial({ map: graniteTexture(33, [178, 172, 162]), roughness: 0.8, metalness: 0 });
    const mesh = instanced(kerbGeo, mat, L.edges, (k, m) => {
      const y = topY(k.x, k.z, k.ang, k.len / 2, k.w / 2) + k.h;
      e.set(k.tilt, k.ang, 0); q.setFromEuler(e);
      m.compose(p.set(k.x, y, k.z), q, s.set(k.w / 0.18, 0.5, k.len));
    }, (k, c) => { const v = 0.52 + k.tone * 0.08; c.setRGB(v * 1.02, v * 0.97, v * 0.9); });
    mesh.name = 'paving-edging'; group.add(mesh); counts.edging = L.edges.length;
  }
  if (L.inlets.length) {
    const geo = grateGeometry(0.86, 0.3);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e3a36, roughness: 0.65, metalness: 0.5 });
    const mesh = instanced(geo, mat, L.inlets, (k, m) => {
      const y = topY(k.x, k.z, k.ang, 0.44, 0.16) + 0.004;
      e.set(0, k.ang, 0); q.setFromEuler(e);
      m.compose(p.set(k.x, y, k.z), q, s.set(1, 1, 1));
    });
    mesh.name = 'kerb-inlets'; group.add(mesh); counts.inlets = L.inlets.length;
  }

  // ---------------------------------------------------------------- covers
  for (let d = 0; d < 4; d++) {
    const items = L.manholes.filter((m) => m.design === d);
    if (!items.length) continue;
    const tx = coverTextures(d);
    const geo = d <= 1 ? new THREE.CylinderGeometry(0.5, 0.5, 0.06, 32) : new THREE.BoxGeometry(1, 0.06, 1);
    geo.translate(0, -0.03, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 1.2, roughness: 0.62, metalness: d === 3 ? 0.3 : 0.4 });
    const mesh = instanced(geo, mat, items, (c, m) => {
      const y = topY(c.x, c.z, c.ang, c.size / 2, c.size / 2) + 0.005;
      e.set(0, c.ang, 0); q.setFromEuler(e);
      m.compose(p.set(c.x, y, c.z), q, s.set(c.size, 1, c.size));
    }, (c, col) => { const r = ctx.rng(`terrain/cover/${c.x.toFixed(2)},${c.z.toFixed(2)}`); const v = r.range(0.85, 1.12); col.setRGB(v, v * 0.97, v * 0.94); });
    mesh.name = `covers-${d}`; group.add(mesh);
    counts[`covers${d}`] = items.length;
  }

  // ---------------------------------------------------------------- road paint decals
  group.add(buildCrosswalk(ctx, L));
  group.add(buildPaintStrips(ctx, L));
  return { group, counts };
}

function buildCrosswalk(ctx, L) {
  const cw = L.crosswalk;
  const res = 0.01;
  const halfW = cw.width / 2 + 0.12;
  const W = Math.ceil((halfW * 2) / res), H = Math.ceil(cw.length / res);
  const data = new Uint8Array(W * H * 4);
  const n1 = hashNoise(901), n2 = hashNoise(902), n3 = hashNoise(903);
  // wheel paths of the two lanes each way wear the paint across the crossing
  const carriage0 = L.sidewalkW + 0.35, carriage1 = L.roadWidth - L.sidewalkW - 0.35, mid = (carriage0 + carriage1) / 2;
  const wheels = [];
  for (const lane of [carriage0 + (mid - carriage0) * 0.25, carriage0 + (mid - carriage0) * 0.75, mid + (carriage1 - mid) * 0.25, mid + (carriage1 - mid) * 0.75]) for (const o of [-0.85, 0.85]) wheels.push(lane + o - cw.start);
  for (let y = 0; y < H; y++) {
    const v = y * res;
    let wheelWear = 0;
    for (const wv of wheels) wheelWear = Math.max(wheelWear, Math.exp(-(((v - wv) / 0.35) ** 2)));
    for (let x = 0; x < W; x++) {
      const u0 = x * res - halfW;
      // ragged paint edges: jitter the sample point by a few millimetres
      const u = u0 + (n1(u0 * 45, v * 45) - 0.5) * 0.008;
      const vv = v + (n1(u0 * 45 + 17, v * 45) - 0.5) * 0.008;
      const au = Math.abs(u);
      const inRail = au > cw.width / 2 - cw.rail && au < cw.width / 2;
      const inBar = au < cw.width / 2 && (vv % (cw.bar + cw.gap)) < cw.bar && vv > 0;
      const paint = inRail || inBar ? 1 : 0;
      if (!paint) continue;
      const wear = 0.6 * wheelWear * (0.6 + 0.8 * n2(u * 3, v * 3)) + 0.45 * Math.max(0, n2(u * 0.9 + 9, v * 0.6) - 0.4) * 2 + 0.3 * (n3(u * 60, v * 60) > 0.68 ? 1 : 0) + 0.15 * n1(u * 9, v * 9);
      const a = Math.max(0, Math.min(1, paint * (0.95 - wear)));
      if (a <= 0.02) continue;
      const i = (y * W + x) * 4;
      const g = 198 + Math.round((n3(u * 25, v * 25) - 0.5) * 30) - Math.round(wheelWear * 30);
      data[i] = g; data[i + 1] = g - 2; data[i + 2] = g - 10; data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8; tex.needsUpdate = true;
  // terrain-following decal grid (u across 3 segments, v every 0.5 m)
  const nu = 4, nv = Math.ceil(cw.length / 0.5);
  const pos = [], uv = [], idx = [];
  const { heightAt } = ctx.data;
  const [ux, uz] = cw.u, [sx, sz] = cw.s;
  const [cx, cz] = cw.centre;
  for (let j = 0; j <= nv; j++) {
    const v = (j / nv) * cw.length;
    for (let i = 0; i <= nu; i++) {
      const u = -halfW + (i / nu) * halfW * 2;
      const x = cx + sx * (cw.start + v) + ux * u, z = cz + sz * (cw.start + v) + uz * u;
      pos.push(x, heightAt(x, z) + 0.004, z);
      uv.push(i / nu, j / nv);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // ensure up-facing
  if (geo.attributes.normal.getY(0) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } geo.setIndex(idx); geo.computeVertexNormals(); }
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.72, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ladder-crosswalk';
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}

// Stop lines, lane lines and the centre line as crisp terrain-following decals (a shared worn
// paint strip texture repeated along each line).
function buildPaintStrips(ctx, L) {
  const W = 64, H = 1024, lenM = 4; // texture spans the line width x 4 m of its length
  const data = new Uint8Array(W * H * 4);
  const n1 = hashNoise(911), n2 = hashNoise(912), n3 = hashNoise(913);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = (y / H) * lenM;
    const edge = Math.min(u, 1 - u) * 64;
    const ragged = edge < 1.5 + 2.5 * n1(x * 0.5, y * 0.05) ? 0 : 1;
    const wear = 0.5 * Math.max(0, n2(u * 3, v * 1.3) - 0.35) * 2 + 0.3 * (n3(x * 0.7, y * 0.7) > 0.7 ? 1 : 0) + 0.15 * n1(u * 20, v * 6);
    const a = Math.max(0, Math.min(1, ragged * (0.9 - wear)));
    const i = (y * W + x) * 4;
    const g = 196 + Math.round((n3(x * 0.3, y * 0.3) - 0.5) * 28);
    data[i] = g; data[i + 1] = g - 2; data[i + 2] = g - 10; data[i + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8; tex.needsUpdate = true;
  const { heightAt } = ctx.data;
  const pos = [], uv = [], idx = [];
  for (const p of L.paint) {
    let [p0, p1, , p3] = p.ring;
    if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < Math.hypot(p3[0] - p0[0], p3[1] - p0[1])) [p1, p3] = [p3, p1]; // length = long side
    const lx = p1[0] - p0[0], lz = p1[1] - p0[1], len = Math.hypot(lx, lz);
    const wx = p3[0] - p0[0], wz = p3[1] - p0[1];
    const n = Math.max(1, Math.ceil(len / 2));
    const vOff = ctx.rng(`terrain/paint/${p0[0].toFixed(1)},${p0[1].toFixed(1)}`)() * lenM;
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= 1; j++) {
      const x = p0[0] + lx * (i / n) + wx * j, z = p0[1] + lz * (i / n) + wz * j;
      pos.push(x, heightAt(x, z) + 0.004, z);
      uv.push(j, (vOff + (len * i) / n) / lenM);
    }
    // winding: front face up (+y). y of (length x width) decides the vertex order per strip
    const up = wz * lx - wx * lz > 0;
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (up) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.72, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'road-paint';
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}
