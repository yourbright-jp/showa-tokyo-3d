// Top-down "macro" surface maps baked with the 2D canvas API in world coordinates.
// Each tile produces two RGBA data textures (linear, uploaded without premultiplication):
//   T1: R = paving weight, G = ground/concrete weight (asphalt = remainder),
//       B = sub-type (asphalt: sidewalk fineness; paving: >0.5 forecourt), A = grime (1 clean .. 0 dark)
//   T2: R = value (0.5 neutral, <0.5 stains, >0.5 dust/wear), G = road paint, B = tar / gloss,
//       A = fresh-patch amount (newer asphalt reinstatement)
// Layers are painted on opaque canvases with channel-separable blend modes (darken / lighten with
// 255 or 0 in the untouched channels) and packed afterwards. All features come from the
// world-space layout, so overlapping tiles agree at their seam.
import * as THREE from 'three';
import { makeCanvas, bbox } from './util.js';

function ctx2d(c) { return c.getContext('2d', { alpha: false, willReadFrequently: true }); }

function path(g, ring) {
  g.beginPath();
  ring.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  g.closePath();
}

function intersects(bb, t, m = 2) { return !(bb[2] < t.x0 - m || bb[0] > t.x1 + m || bb[3] < t.z0 - m || bb[1] > t.z1 + m); }

function dataTex(arr, w, h, aniso) {
  const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Paint the class layer (shared by detailed tiles and the coarse far map). */
function paintClasses(g, L, t, coarse) {
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgb(0,255,0)';
  g.fillRect(t.x0 - 5, t.z0 - 5, t.x1 - t.x0 + 10, t.z1 - t.z0 + 10);
  g.fillStyle = 'rgb(0,0,0)';
  for (const r of L.roadRings) if (intersects(bbox(r), t)) { path(g, r); g.fill(); }
  if (!coarse) {
    g.globalCompositeOperation = 'lighten';
    g.fillStyle = 'rgb(0,0,140)';
    path(g, L.sidewalkRing); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgb(0,255,0)';
    path(g, L.lGutterRing); g.fill();
  }
  g.fillStyle = 'rgb(255,0,0)';
  for (const r of [L.plazaRing, ...L.connectorRings]) { path(g, r); g.fill(); }
  if (L.forecourtRing) { g.fillStyle = 'rgb(255,0,255)'; path(g, L.forecourtRing); g.fill(); }
}

function strokeRings(g, rings, t, width, style, blurPx) {
  g.filter = blurPx > 0.3 ? `blur(${blurPx.toFixed(2)}px)` : 'none';
  g.strokeStyle = style; g.lineWidth = width; g.lineJoin = 'round';
  g.beginPath();
  for (const r of rings) {
    if (!intersects(bbox(r), t, width + 2)) continue;
    r.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
  }
  g.stroke();
  g.filter = 'none';
}

function strokeLines(g, lines, width, style, blurPx) {
  g.filter = blurPx > 0.3 ? `blur(${blurPx.toFixed(2)}px)` : 'none';
  g.strokeStyle = style; g.lineWidth = width; g.lineCap = 'butt';
  g.beginPath();
  for (const [a, b] of lines) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
  g.stroke();
  g.filter = 'none';
}

function blob(g, x, z, r, style0, style1) {
  const gr = g.createRadialGradient(x, z, 0, x, z, r);
  gr.addColorStop(0, style0); gr.addColorStop(1, style1);
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill();
}

export function paintMacroTile(ctx, L, t) {
  const W = Math.ceil((t.x1 - t.x0) / t.res), H = Math.ceil((t.z1 - t.z0) / t.res);
  const px = 1 / t.res; // canvas pixels per metre
  const setT = (g) => g.setTransform(px, 0, 0, px, -t.x0 * px, -t.z0 * px);
  const c1 = makeCanvas(W, H), c2 = makeCanvas(W, H), c3 = makeCanvas(W, H);
  const g1 = ctx2d(c1), g2 = ctx2d(c2), g3 = ctx2d(c3);
  [g1, g2, g3].forEach(setT);

  const T = { t0: performance.now() }; let tl = performance.now(); const mark = (k, g) => { if (g) g.getImageData(0, 0, 1, 1); const n = performance.now(); T[k] = Math.round(n - tl); tl = n; };
  // ------------------------------------------------------------ C1 classes
  paintClasses(g1, L, t, false);
  mark('classes', g1);

  // ------------------------------------------------------------ C3: grime (R), fresh patch (G)
  g3.fillStyle = 'rgb(255,0,0)'; g3.fillRect(t.x0 - 5, t.z0 - 5, t.x1 - t.x0 + 10, t.z1 - t.z0 + 10);
  g3.globalCompositeOperation = 'darken';
  strokeRings(g3, L.buildingRings, t, 1.6, 'rgb(170,255,255)', 0.45 * px);
  strokeRings(g3, L.buildingRings, t, 0.5, 'rgb(105,255,255)', 0.12 * px);
  strokeRings(g3, L.steps, t, 0.7, 'rgb(150,255,255)', 0.2 * px);
  mark('bldgGrime', g3);
  // dirt line on the road side of every gutter run, and along both kerb faces
  const gl = L.gutterLines.map((s) => [[s.a[0] - s.nx * 0.2, s.a[1] - s.nz * 0.2], [s.b[0] - s.nx * 0.2, s.b[1] - s.nz * 0.2]]);
  strokeLines(g3, gl, 0.16, 'rgb(150,255,255)', 0.05 * px);
  const gu = L.gutterLines.map((s) => [s.a, s.b]);
  strokeLines(g3, gu, 0.44, 'rgb(70,255,255)', 0); // under the lids: dark channel shows in the gaps
  const kt0 = L.along(-127, 60) - 40, kt1 = L.along(-44, 82) + 40;
  strokeLines(g3, [[L.linePt(kt0, L.sidewalkW + 0.12), L.linePt(kt1, L.sidewalkW + 0.12)]], 0.08, 'rgb(130,255,255)', 0.03 * px);
  strokeLines(g3, [[L.linePt(kt0, L.sidewalkW - 0.12), L.linePt(kt1, L.sidewalkW - 0.12)]], 0.1, 'rgb(175,255,255)', 0.04 * px);
  strokeLines(g3, [[L.linePt(kt0, -0.05), L.linePt(kt1, -0.05)]], 0.9, 'rgb(150,255,255)', 0.3 * px);
  mark('lineGrime', g3);
  // void below steel grates / inlets
  g3.fillStyle = 'rgb(14,255,255)';
  const rect = (x, z, ang, hl, hw) => {
    const ux = Math.sin(ang), uz = Math.cos(ang);
    return [[x - ux * hl - uz * hw, z - uz * hl + ux * hw], [x + ux * hl - uz * hw, z + uz * hl + ux * hw], [x + ux * hl + uz * hw, z + uz * hl - ux * hw], [x - ux * hl + uz * hw, z - uz * hl - ux * hw]];
  };
  for (const gtr of L.gutters) if (gtr.kind === 'grate') { path(g3, rect(gtr.x, gtr.z, gtr.ang, 0.23, 0.15)); g3.fill(); }
  for (const inl of L.inlets) { path(g3, rect(inl.x, inl.z, inl.ang, 0.42, 0.14)); g3.fill(); }
  for (const m of L.manholes) if (m.design === 3) { path(g3, rect(m.x, m.z, m.ang, m.size * 0.42, m.size * 0.42)); g3.fill(); }
  // fresh patches
  g3.globalCompositeOperation = 'lighten';
  for (const p of L.patches) {
    if (!intersects(bbox(p.ring), t)) continue;
    const v = Math.round(p.age * 255);
    g3.fillStyle = `rgb(0,${v},0)`; path(g3, p.ring); g3.fill();
  }

  mark('patches', g3);
  // ------------------------------------------------------------ C2: value (R), paint (G), tar (B)
  g2.fillStyle = 'rgb(128,0,0)'; g2.fillRect(t.x0 - 5, t.z0 - 5, t.x1 - t.x0 + 10, t.z1 - t.z0 + 10);
  g2.globalCompositeOperation = 'lighten';
  // dust drifts at wall bases, along gutters and the kerb
  strokeRings(g2, L.buildingRings, t, 0.7, 'rgb(146,0,0)', 0.25 * px);
  strokeLines(g2, gl, 0.35, 'rgb(150,0,0)', 0.12 * px);
  strokeLines(g2, [[L.linePt(kt0, L.sidewalkW + 0.3), L.linePt(kt1, L.sidewalkW + 0.3)]], 0.5, 'rgb(150,0,0)', 0.15 * px);
  mark('dust', g2);
  // per-frontage apron tone, painted on quarter-resolution layers (bilinear upscaling softens
  // the edges; a blur filter over the full tile was too slow)
  {
    const q = 4, w4 = Math.ceil(W / q), h4 = Math.ceil(H / q);
    const dk = makeCanvas(w4, h4), lt = makeCanvas(w4, h4);
    const gd = ctx2d(dk), gl4 = ctx2d(lt);
    gd.fillStyle = '#fff'; gd.fillRect(0, 0, w4, h4);
    gl4.fillStyle = '#000'; gl4.fillRect(0, 0, w4, h4);
    for (const g of [gd, gl4]) { g.setTransform(px / q, 0, 0, px / q, -t.x0 * px / q, -t.z0 * px / q); g.globalCompositeOperation = g === gd ? 'darken' : 'lighten'; }
    for (const fr of L.frontages) {
      if (!intersects(bbox(fr.ring), t)) continue;
      const v = Math.round(fr.v);
      const g = v < 128 ? gd : gl4;
      g.fillStyle = v < 128 ? `rgba(${v},255,255,${fr.a})` : `rgba(${v},0,0,${fr.a})`;
      path(g, fr.ring); g.fill();
    }
    g2.save();
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    g2.globalCompositeOperation = 'darken'; g2.drawImage(dk, 0, 0, w4 * q, h4 * q);
    g2.globalCompositeOperation = 'lighten'; g2.drawImage(lt, 0, 0, w4 * q, h4 * q);
    g2.restore();
  }
  mark('frontage', g2);
  // large soft tone variations
  L.tones.forEach((tn) => {
    if (tn.x < t.x0 - 8 || tn.x > t.x1 + 8 || tn.z < t.z0 - 8 || tn.z > t.z1 + 8) return;
    const v = Math.round(tn.v);
    g2.globalCompositeOperation = v < 128 ? 'darken' : 'lighten';
    const other = v < 128 ? '255,255' : '0,0';
    blob(g2, tn.x, tn.z, tn.r, `rgba(${v},${other},${tn.a})`, `rgba(${v},${other},0)`);
  });
  mark('tones', g2);
  g2.globalCompositeOperation = 'lighten';
  // worn walking line along the route (subtle polish) and wheel paths on the arterial
  g2.filter = `blur(${(1.2 * px).toFixed(1)}px)`;
  g2.strokeStyle = 'rgb(141,0,0)'; g2.lineWidth = 2.6; g2.lineJoin = 'round'; g2.lineCap = 'round';
  g2.beginPath(); L.route.forEach(([x, z], i) => (i ? g2.lineTo(x, z) : g2.moveTo(x, z))); g2.stroke();
  g2.filter = 'none';
  const carriage0 = L.sidewalkW + 0.35, carriage1 = L.roadWidth - L.sidewalkW - 0.35, mid = (carriage0 + carriage1) / 2;
  const wheel = [];
  for (const lane of [carriage0 + (mid - carriage0) * 0.25, carriage0 + (mid - carriage0) * 0.75, mid + (carriage1 - mid) * 0.25, mid + (carriage1 - mid) * 0.75]) {
    for (const o of [-0.85, 0.85]) wheel.push([L.linePt(kt0, lane + o), L.linePt(kt1, lane + o)]);
  }
  strokeLines(g2, wheel, 0.55, 'rgb(139,0,0)', 0.25 * px);
  g2.globalCompositeOperation = 'darken';
  const dripBands = [];
  for (const lane of [carriage0 + (mid - carriage0) * 0.25, carriage0 + (mid - carriage0) * 0.75, mid + (carriage1 - mid) * 0.25, mid + (carriage1 - mid) * 0.75]) dripBands.push([L.linePt(kt0, lane), L.linePt(kt1, lane)]);
  strokeLines(g2, dripBands, 0.5, 'rgb(112,255,255)', 0.25 * px);
  mark('wear', g2);
  // stains
  L.stains.forEach((s, i) => {
    if (s.x < t.x0 - 3 || s.x > t.x1 + 3 || s.z < t.z0 - 3 || s.z > t.z1 + 3) return;
    const r = ctx.rng(`terrain/stainblob/${i}`);
    const n = s.k === 'oil' ? 2 + r.int(0, 3) : 3 + r.int(0, 3);
    for (let k = 0; k < n; k++) {
      const ox = s.x + r.normal() * s.r * 0.45, oz = s.z + r.normal() * s.r * 0.45;
      const rr = s.r * r.range(0.35, 0.9);
      const a = s.a * r.range(0.6, 1);
      if (s.k === 'oil') blob(g2, ox, oz, rr, `rgba(38,255,255,${a})`, 'rgba(38,255,255,0)');
      else if (s.k === 'damp') blob(g2, ox, oz, rr, `rgba(78,255,255,${a})`, 'rgba(78,255,255,0)');
      else if (s.k === 'rust') blob(g2, ox, oz, rr, `rgba(92,255,255,${a})`, 'rgba(92,255,255,0)');
      else blob(g2, ox, oz, rr, `rgba(96,255,255,${a})`, 'rgba(96,255,255,0)');
    }
    if (s.k === 'oil' || s.k === 'damp') {
      g2.globalCompositeOperation = 'lighten';
      blob(g2, s.x, s.z, s.r * 0.8, `rgba(128,0,${s.k === 'oil' ? 55 : 35},${s.a})`, 'rgba(128,0,0,0)');
      g2.globalCompositeOperation = 'darken';
    }
  });
  mark('stains', g2);
  // splash-darkened paving around the working fountain (downwind arc)
  if (L.fountain) {
    const f = L.fountain;
    g2.save();
    g2.translate(f.x, f.z); g2.scale(1, f.rz / f.rx);
    const gr = g2.createRadialGradient(0, 0, f.rx * 0.95, 0, 0, f.rx + 0.9);
    gr.addColorStop(0, 'rgba(86,255,255,0.75)'); gr.addColorStop(1, 'rgba(86,255,255,0)');
    g2.fillStyle = gr; g2.beginPath(); g2.arc(0, 0, f.rx + 0.9, 0, Math.PI * 2); g2.fill();
    g2.restore();
  }
  // tar seams: patch outlines, the L-gutter joint and gutter-lid road edge
  g2.globalCompositeOperation = 'lighten';
  g2.strokeStyle = 'rgb(0,0,215)'; g2.lineJoin = 'miter';
  for (const p of L.patches) {
    if (!p.seam || !intersects(bbox(p.ring), t)) continue;
    g2.lineWidth = 0.045; path(g2, p.ring); g2.stroke();
  }
  strokeLines(g2, [[L.linePt(kt0, L.sidewalkW + 0.43), L.linePt(kt1, L.sidewalkW + 0.43)]], 0.03, 'rgb(0,0,170)', 0);
  strokeLines(g2, L.gutterLines.map((s) => [[s.a[0] - s.nx * 0.2, s.a[1] - s.nz * 0.2], [s.b[0] - s.nx * 0.2, s.b[1] - s.nz * 0.2]]), 0.03, 'rgb(0,0,150)', 0);
  // road paint is drawn as crisp decals (features.js), not baked here

  mark('seams', g2);
  // ------------------------------------------------------------ pack
  const d1 = g1.getImageData(0, 0, W, H).data, d2 = g2.getImageData(0, 0, W, H).data, d3 = g3.getImageData(0, 0, W, H).data;
  const n = W * H;
  const a1 = new Uint8Array(n * 4), a2 = new Uint8Array(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    a1[j] = d1[j]; a1[j + 1] = d1[j + 1]; a1[j + 2] = d1[j + 2]; a1[j + 3] = d3[j];
    a2[j] = d2[j]; a2[j + 1] = d2[j + 1]; a2[j + 2] = d2[j + 2]; a2[j + 3] = d3[j + 1];
  }
  c1.width = c2.width = c3.width = 1; // release canvas memory
  mark('pack');
  return { t1: dataTex(a1, W, H, 4), t2: dataTex(a2, W, H, 4), W, H, T };
}

/** Coarse class + grime map for the far TIN (default 0.5 m per texel). */
export function paintCoarse(ctx, L, t) {
  const W = Math.ceil((t.x1 - t.x0) / t.res), H = Math.ceil((t.z1 - t.z0) / t.res);
  const px = 1 / t.res;
  const c1 = makeCanvas(W, H), c3 = makeCanvas(W, H);
  const g1 = ctx2d(c1), g3 = ctx2d(c3);
  [g1, g3].forEach((g) => g.setTransform(px, 0, 0, px, -t.x0 * px, -t.z0 * px));
  paintClasses(g1, L, t, true);
  g3.fillStyle = 'rgb(255,0,0)'; g3.fillRect(t.x0 - 5, t.z0 - 5, t.x1 - t.x0 + 10, t.z1 - t.z0 + 10);
  g3.globalCompositeOperation = 'darken';
  strokeRings(g3, L.buildingRings, t, 1.4, 'rgb(150,255,255)', 0.8);
  const d1 = g1.getImageData(0, 0, W, H).data, d3 = g3.getImageData(0, 0, W, H).data;
  const a1 = new Uint8Array(W * H * 4);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { a1[j] = d1[j]; a1[j + 1] = d1[j + 1]; a1[j + 2] = d1[j + 2]; a1[j + 3] = d3[j]; }
  c1.width = c3.width = 1;
  return { t1: dataTex(a1, W, H, 2), W, H };
}
