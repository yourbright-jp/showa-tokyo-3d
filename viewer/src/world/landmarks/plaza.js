import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Bucket, boxMinMax, cylGeo, normGeo, makeCanvas, toTexture, noiseCanvas, weather, insidePoly, axisFrame, periodicNoise } from './kit.js';

// Plaza furniture: the adopted oval fountain and three multi-globe lamps (positions and
// dimensions from kabukicho-koma-plaza-1976.json / adopted fixtures), plus planters with
// shrubs and benches as labelled estimates outside the walk corridor.

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function bboxOf(f) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const poly of f.polygons) for (const v of poly) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
  return { mn, mx, c: mn.map((v, i) => (v + mx[i]) / 2) };
}

export function buildPlaza(ctx, kit) {
  const D = ctx.data;
  const group = new THREE.Group(); group.name = 'plaza-furniture';
  const fx = Object.fromEntries(D.fixtures.map((f) => [f.id, f]));
  const props = Object.fromEntries(D.decisions.komaPlaza.plaza_props.map((p) => [p.id, p]));
  group.add(buildFountain(ctx, kit, fx, props['plaza-fountain']));
  group.add(buildLamps(ctx, kit, fx, props));
  group.add(buildEstimates(ctx, kit));
  return group;
}

// ------------------------------------------------------------------ fountain

function stoneTexture(rng) {
  // 2 m x 0.6 m tile: granite-terrazzo coping blocks with joints every ~1.0 m
  const W = 512, H = 154; const c = makeCanvas(W, H); const g = c.getContext('2d');
  g.fillStyle = '#8a877e'; g.fillRect(0, 0, W, H);
  // round b: finer, fainter aggregate (the r02 speckle read as a dalmatian pattern) and broader mottling
  for (let i = 0; i < 5200; i++) { const v = rng(); g.fillStyle = v < 0.35 ? 'rgba(70,68,62,0.16)' : v < 0.7 ? 'rgba(170,166,156,0.16)' : 'rgba(110,102,92,0.14)'; g.fillRect(rng() * W, rng() * H, 1 + rng() * 1.2, 1 + rng() * 1.2); }
  const n = noiseCanvas(rng, 128, 4, 4, 4, 1.4);
  g.save(); g.globalAlpha = 0.42; g.globalCompositeOperation = 'overlay'; const p = g.createPattern(n, 'repeat'); g.fillStyle = p; g.fillRect(0, 0, W, H); g.restore();
  for (const x of [0, 256]) { g.fillStyle = 'rgba(50,48,44,0.7)'; g.fillRect(x, 0, 2, H); g.fillStyle = 'rgba(230,226,216,0.3)'; g.fillRect(x + 2, 0, 1, H); }
  return toTexture(c, { repeat: [1 / 2, 1 / 0.6] });
}

function rippleNormal(rng) {
  const N = 256; const c = makeCanvas(N, N); const g = c.getContext('2d');
  const img = g.createImageData(N, N); const d = img.data;
  const P = periodicNoise(rng, 256);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = P.fbm(x / N * 6, y / N * 6, 6, 6, 4) * 0.8 + P.fbm(x / N * 16, y / N * 16, 16, 16, 2) * 0.3;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
    const hy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -hx * 2.2, ny = -hy * 2.2, nz = 1; const L = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4; d[i] = (nx / L * 0.5 + 0.5) * 255; d[i + 1] = (ny / L * 0.5 + 0.5) * 255; d[i + 2] = (nz / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false, repeat: [1 / 2.4, 1 / 2.4] });
}

function buildFountain(ctx, kit, fx, prop) {
  const water = fx['plaza-fountain-water'];
  // centre = water polygon centroid; base (centre ground) = water level - adopted water height
  let cx = 0, cz = 0, wy = 0; const wp = water.polygons[0];
  for (const v of wp) { cx += v[0]; cz += v[2]; wy = v[1]; }
  cx /= wp.length; cz /= wp.length;
  const base = wy - prop.water_height_above_ground_m;
  const rx = prop.radius_east_west_m, rz = prop.radius_north_south_m, ang = THREE.MathUtils.degToRad(prop.rotation_deg_clockwise_from_north);
  const oval = (ax, az, t) => [cx + ax * Math.cos(t) * Math.cos(ang) - az * Math.sin(t) * Math.sin(ang), cz + ax * Math.cos(t) * Math.sin(ang) + az * Math.sin(t) * Math.cos(ang)];
  const N = 120;
  let foundation = Infinity;
  for (let i = 0; i < 48; i++) { const [x, z] = oval(rx, rz, i / 48 * Math.PI * 2); foundation = Math.min(foundation, ctx.data.heightAt(x, z)); }
  foundation -= 0.03;
  const rimH = prop.rim_height_m, rimW = prop.rim_width_m;
  const B = new Bucket();
  // swept rim profile: (inward offset d from the outer ellipse, height above base)
  const prof = [[0.0, foundation - base], [0.0, rimH - 0.1], [-0.035, rimH - 0.09], [-0.035, rimH - 0.02], [-0.0, rimH], [rimW * 0.5, rimH + 0.008], [rimW, rimH], [rimW + 0.035, rimH - 0.02], [rimW + 0.035, rimH - 0.09], [rimW, rimH - 0.1], [rimW, 0.1]];
  const P = prof.length;
  const pos = [], uv = [], idx = [];
  let s = 0; let prev = null;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const o = oval(rx, rz, t);
    if (prev) s += Math.hypot(o[0] - prev[0], o[1] - prev[1]); prev = o;
    let acc = 0;
    for (let k = 0; k < P; k++) {
      const [d, h] = prof[k];
      const [x, z] = oval(rx - d, rz - d, t);
      if (k > 0) acc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
      pos.push(x, base + h, z); uv.push(s, acc);
    }
  }
  // duplicate vertices per profile segment for crisp edges: build quads per segment with own verts
  const pos2 = [], uv2 = [];
  for (let i = 0; i < N; i++) for (let k = 0; k < P - 1; k++) {
    const a = i * P + k, b = (i + 1) * P + k, c = (i + 1) * P + k + 1, d = i * P + k + 1;
    const base0 = pos2.length / 3;
    for (const q of [a, b, c, d]) { pos2.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]); uv2.push(uv[q * 2], uv[q * 2 + 1]); }
    idx.push(base0, base0 + 2, base0 + 1, base0, base0 + 3, base0 + 2);
  }
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3)); rim.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2)); rim.setIndex(idx);
  rim.computeVertexNormals();
  // orientation check: the outer wall at t=0 must face away from the centre
  { const n = rim.attributes.normal; const p = rim.attributes.position; const dx = p.getX(0) - cx, dz = p.getZ(0) - cz; if (n.getX(0) * dx + n.getZ(0) * dz < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } rim.setIndex(idx); rim.computeVertexNormals(); } }
  B.add('stone', rim);
  // basin floor and water
  const shapeAt = (ax, az, y) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 96; i++) { const [x, z] = oval(ax, az, i / 96 * Math.PI * 2); if (i === 0) sh.moveTo(x, -z); else sh.lineTo(x, -z); }
    const g = new THREE.ShapeGeometry(sh, 1); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
    const p = g.attributes.position, u = g.attributes.uv; for (let i = 0; i < p.count; i++) u.setXY(i, p.getX(i), p.getZ(i));
    return g;
  };
  B.add('floor', shapeAt(rx - rimW, rz - rimW, base + 0.1));
  const waterGeo = shapeAt(rx - rimW - 0.01, rz - rimW - 0.01, base + prop.water_height_above_ground_m);
  // jet base, nozzle
  B.add('metal', cylGeo(0.24, 0.2, base + 0.1, base + prop.water_height_above_ground_m + 0.2, 16).translate(cx, 0, cz));
  B.add('metal', cylGeo(0.05, 0.035, base + prop.water_height_above_ground_m + 0.2, base + prop.water_height_above_ground_m + 0.32, 8).translate(cx, 0, cz));
  // drain grille in the floor
  B.add('metal', cylGeo(0.15, 0.15, base + 0.1, base + 0.112, 12).translate(cx + 1.6, 0, cz - 2.2));

  const rng = ctx.rng('landmarks/fountain');
  const stoneTex = stoneTexture(rng);
  const floorTex = (() => {
    const c = makeCanvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#6f8f8c'; g.fillRect(0, 0, 256, 256);
    const n = noiseCanvas(rng, 128, 4, 4, 5, 1.8);
    g.save(); g.globalAlpha = 0.6; g.globalCompositeOperation = 'multiply'; const p = g.createPattern(n, 'repeat'); g.fillStyle = p; g.fillRect(0, 0, 256, 256); g.restore();
    for (let i = 0; i < 40; i++) { const x = rng() * 256, y = rng() * 256, r = 6 + rng() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(52,70,40,0.5)'); gr.addColorStop(1, 'rgba(52,70,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    return toTexture(c, { repeat: [1 / 3, 1 / 3] });
  })();
  const stone = weather(new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.6 }), kit.macro, { baseY: base, dirtH: 0.35, dirt: 0.35, streak: 0.1, mottle: 0.15 });
  const g = new THREE.Group(); g.name = 'fountain';
  g.add(B.build({
    stone,
    floor: { material: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8 }), castShadow: false },
    metal: new THREE.MeshStandardMaterial({ color: 0x5f6058, roughness: 0.4, metalness: 0.7 }),
  }, 'fountain'));
  // r04: the r02 water (normalScale 0.2, env 0.9) mirrored the sky as one flat pale sheet at
  // grazing angles; stronger ripples and a weaker sky term let the dark basin read through.
  // round b: 0.65 / 1.2 m ripples sparkled as white speckle ("snow/granite"); long gentle swell, a
  // dimmer sky term and a darker body so it reads as water
  const wmat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.008, 0.02, 0.018), roughness: 0.16, metalness: 0.0, normalMap: rippleNormal(rng), normalScale: new THREE.Vector2(0.28, 0.28), transparent: true, opacity: 0.9, envMapIntensity: 0.38, depthWrite: false });
  wmat.normalMap.repeat.set(1 / 3.2, 1 / 3.2); // 3.2 m swell period
  const wm = new THREE.Mesh(waterGeo, wmat); wm.castShadow = false; wm.userData.noShadow = true; wm.receiveShadow = true; wm.renderOrder = 1;
  g.add(wm);
  // water jet: column, umbrella sheet, splash ring (translucent, subtle)
  const jy0 = base + prop.water_height_above_ground_m + 0.32, jy1 = base + prop.water_height_above_ground_m + prop.central_jet_height_m;
  const sprayTex = (() => {
    const c = makeCanvas(64, 256); const gg = c.getContext('2d');
    const img = gg.createImageData(64, 256); const d = img.data;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4; const v = 0.55 + 0.45 * Math.sin(x * 0.6 + Math.sin(y * 0.05) * 3) * Math.sin(y * 0.11 + x * 0.2); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, Math.min(255, v * 200)); }
    gg.putImageData(img, 0, 0); return toTexture(c, { srgb: true });
  })();
  sprayTex.wrapS = sprayTex.wrapT = THREE.RepeatWrapping;
  const spray = new THREE.MeshStandardMaterial({ color: 0xf4f8f6, roughness: 0.25, transparent: true, opacity: 0.62, alphaMap: sprayTex, depthWrite: false, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.06 });
  const veil = spray.clone(); veil.opacity = 0.2;
  const H = jy1 - jy0;
  const col = new THREE.Mesh(new THREE.LatheGeometry([[0.03, 0], [0.04, H * 0.5], [0.07, H * 0.9], [0.1, H], [0.02, H + 0.08]].map(([r, y]) => new THREE.Vector2(r, y)), 10).translate(cx, jy0, cz), spray);
  const umb = new THREE.LatheGeometry([[0.08, 0], [0.2, -0.08], [0.3, -0.3], [0.36, -0.7], [0.4, -H - 0.02]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  umb.translate(cx, jy1 + 0.04, cz);
  const um = new THREE.Mesh(umb, veil);
  const foam = new THREE.MeshStandardMaterial({ color: 0xf2f6f4, roughness: 0.7, transparent: true, opacity: 0.55, alphaMap: sprayTex, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.55, 24, 1).rotateX(-Math.PI / 2).translate(cx, base + prop.water_height_above_ground_m + 0.012, cz), foam);
  for (const m of [col, um, ring]) { m.castShadow = false; m.userData.noShadow = true; m.renderOrder = 3; g.add(m); }
  ctx.tag({ id: 'plaza-fountain', module: 'landmarks', tier: 'adopted-inferred', note: 'Oval fountain at adopted centre/radii/rotation/rim/water/jet (aerial-interpreted, not surveyed); coping profile, block joints, algae and spray are authored.' });
  return g;
}

// ------------------------------------------------------------------ lamps

function buildLamps(ctx, kit, fx, props) {
  const B = new Bucket();
  const night = kit.night;
  const g = new THREE.Group(); g.name = 'plaza-lamps';
  const globes = [];
  for (const id of ['plaza-lamp-north', 'plaza-lamp-middle', 'plaza-lamp-south']) {
    const p = props[id];
    const bb = bboxOf(fx[`${id}-base`]); const pole = bboxOf(fx[`${id}-pole`]);
    const x = bb.c[0], z = bb.c[2], y0 = bb.mn[1];
    const poleTop = pole.mx[1];
    const gl = []; for (let i = 0; i < 6; i++) gl.push(bboxOf(fx[`${id}-globe-${i}`]).c);
    const up = bboxOf(fx[`${id}-upper-globe`]).c;
    const gr = p.globe_radius_m;
    // plinth (adopted base radius/height) as an octagonal cast base
    const plinth = new THREE.LatheGeometry([[0, 0], [p.base_radius_m, 0], [p.base_radius_m, 0.06], [p.base_radius_m * 0.92, 0.09], [p.base_radius_m * 0.92, 0.22], [p.base_radius_m * 0.8, 0.28], [0, 0.28]].map(([r, h]) => new THREE.Vector2(r, h)), 8);
    plinth.translate(x, y0, z); B.add('green', plinth);
    // fluted cast lower section with rings
    const low = new THREE.LatheGeometry([[0, 0.28], [0.24, 0.28], [0.25, 0.36], [0.21, 0.42], [0.2, 0.9], [0.23, 0.96], [0.23, 1.02], [0.19, 1.08], [0.185, 1.5], [0.21, 1.55], [0.17, 1.62], [0, 1.62]].map(([r, h]) => new THREE.Vector2(r, h)), 16);
    low.translate(x, y0, z); B.add('green', low);
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; B.add('greenDark', boxMinMax(-0.012, 0.44, 0.195, 0.012, 0.88, 0.215).rotateY(a).translate(x, y0, z)); }
    // tapered shaft
    B.add('green', cylGeo(p.post_radius_m * 0.85, 0.085, y0 + 1.62, poleTop, 14, true).translate(x, 0, z));
    B.add('green', cylGeo(0.12, 0.12, poleTop - 0.42, poleTop - 0.3, 14).translate(x, 0, z));
    // crown arms (scrolls) to globe holders
    for (const c of gl) {
      const dx = c[0] - x, dz = c[2] - z; const R = Math.hypot(dx, dz); const ux = dx / R, uz = dz / R;
      const cupY = c[1] - gr - 0.02;
      const pts = [V3(x + ux * 0.08, poleTop - 0.38, z + uz * 0.08), V3(x + ux * R * 0.35, cupY - 0.05, z + uz * R * 0.35), V3(x + ux * R * 0.75, cupY - 0.1, z + uz * R * 0.75), V3(x + ux * R, cupY - 0.04, z + uz * R)];
      const curve = new THREE.CatmullRomCurve3(pts);
      B.add('green', new THREE.TubeGeometry(curve, 10, 0.028, 6, false));
      const sc = new THREE.CatmullRomCurve3([V3(x + ux * 0.1, poleTop - 0.9, z + uz * 0.1), V3(x + ux * R * 0.3, poleTop - 0.75, z + uz * R * 0.3), V3(x + ux * R * 0.42, cupY - 0.2, z + uz * R * 0.42), V3(x + ux * R * 0.36, cupY - 0.32, z + uz * R * 0.36)]);
      B.add('green', new THREE.TubeGeometry(sc, 10, 0.016, 5, false));
      B.add('green', cylGeo(0.075, 0.095, cupY - 0.06, cupY + 0.03, 10).translate(c[0], 0, c[2]));
      globes.push(c);
    }
    B.add('green', cylGeo(0.08, 0.1, poleTop - 0.02, up[1] - gr + 0.01, 10).translate(up[0], 0, up[2]));
    globes.push(up);
    B.add('green', cylGeo(0.02, 0.01, up[1] + gr - 0.01, up[1] + gr + 0.12, 6).translate(up[0], 0, up[2]));
    if (night) { const L = new THREE.PointLight(0xffe2b8, 9, 18, 2); L.position.set(x, up[1] - 0.5, z); g.add(L); }
    ctx.tag({ id, module: 'landmarks', tier: 'adopted-inferred', note: '7-globe plaza lamp at adopted position/height/radii (style from 1975/1979 photos; placement inferred); cast base, scroll arms and paint are authored.' });
  }
  const greenTex = (() => { const c = makeCanvas(128, 128); const gg = c.getContext('2d'); gg.fillStyle = '#2f4a3b'; gg.fillRect(0, 0, 128, 128); const n = noiseCanvas(ctx.rng('landmarks/lamp/paint'), 128, 8, 8, 4, 1.6); gg.globalAlpha = 0.35; gg.globalCompositeOperation = 'overlay'; gg.drawImage(n, 0, 0); gg.globalAlpha = 1; for (let i = 0; i < 60; i++) { gg.fillStyle = `rgba(${ctx.rng('x' + i)() < 0.5 ? '90,70,50' : '20,28,22'},0.5)`; gg.fillRect((i * 37) % 128, (i * 71) % 128, 2, 3); } return toTexture(c, { repeat: [2, 2] }); })();
  const green = weather(new THREE.MeshStandardMaterial({ map: greenTex, roughness: 0.5, metalness: 0.35 }), kit.macro, { baseY: -2, dirtH: 0.1, dirt: 0, streak: 0.18, mottle: 0.15 });
  g.add(B.build({ green, greenDark: new THREE.MeshStandardMaterial({ color: 0x223429, roughness: 0.55, metalness: 0.35 }) }, 'lamps'));
  // opal globes (instanced)
  const geo = new THREE.SphereGeometry(1, 20, 14);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.35, metalness: 0, emissive: new THREE.Color(1.0, 0.88, 0.7), emissiveIntensity: night ? 3.2 : 0.05, transparent: true, opacity: 0.95 });
  const im = new THREE.InstancedMesh(geo, mat, globes.length);
  const m = new THREE.Matrix4(); const r = props['plaza-lamp-north'].globe_radius_m;
  globes.forEach((c, i) => { m.makeScale(r, r, r).setPosition(c[0], c[1], c[2]); im.setMatrixAt(i, m); });
  im.castShadow = true; g.add(im);
  return g;
}

// ------------------------------------------------------------------ estimates: planters, benches

function shrubGeometry(rng, w, d, h, n = 7) {
  const parts = [];
  const P = periodicNoise(rng, 64);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    const ox = rng() * 10, oy = rng() * 10;
    for (let k = 0; k < p.count; k++) {
      const v = V3(p.getX(k), p.getY(k), p.getZ(k));
      const a = Math.atan2(v.z, v.x), b = v.y;
      const disp = 0.82 + 0.3 * P.fbm((a + 3.2) * 1.3 + ox, (b + 1) * 2 + oy, 64, 64, 3);
      v.multiplyScalar(disp);
      p.setXYZ(k, v.x, v.y, v.z);
    }
    const sx = (0.35 + rng() * 0.25) * Math.min(w, d) * 0.9, sy = h * (0.55 + rng() * 0.35);
    g.scale(sx, sy, sx);
    g.translate((rng() - 0.5) * (w - sx), sy * 0.75, (rng() - 0.5) * (d - sx));
    g.computeVertexNormals();
    parts.push(normGeo(g));
  }
  const blob = mergeGeometries(parts, false);
  // leaf cards scattered over the blob surface (alpha-tested) for a broken, leafy silhouette
  const cards = [];
  const p = blob.attributes.position, nrm = blob.attributes.normal;
  const q = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4();
  for (let k = 0; k < p.count; k += 3) {
    if (rng() < 0.35) continue;
    const sz = 0.16 + rng() * 0.14;
    const c = new THREE.PlaneGeometry(sz, sz);
    e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI); q.setFromEuler(e);
    m.compose(V3(p.getX(k) + nrm.getX(k) * 0.03, p.getY(k) + nrm.getY(k) * 0.03, p.getZ(k) + nrm.getZ(k) * 0.03), q, V3(1, 1, 1));
    c.applyMatrix4(m);
    // normals biased outward (soft foliage shading)
    const cn = c.attributes.normal; for (let i = 0; i < cn.count; i++) cn.setXYZ(i, nrm.getX(k), nrm.getY(k) * 0.8 + 0.2, nrm.getZ(k));
    cards.push(normGeo(c));
  }
  return { blob, cards: cards.length ? mergeGeometries(cards, false) : null };
}

function leafCardTexture(rng) {
  const N = 128; const c = makeCanvas(N, N); const g = c.getContext('2d');
  g.clearRect(0, 0, N, N);
  for (let i = 0; i < 14; i++) {
    const x = 16 + rng() * 96, y = 16 + rng() * 96, r = 9 + rng() * 10, a = rng() * Math.PI;
    const v = rng();
    g.fillStyle = v < 0.3 ? '#1f3a1b' : v < 0.6 ? '#35562a' : v < 0.85 ? '#4a6d32' : '#66853f';
    g.beginPath(); g.ellipse(x, y, r, r * 0.5, a, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,30,15,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke();
  }
  const t = toTexture(c); return t;
}

function leafTexture(rng) {
  const N = 256; const c = makeCanvas(N, N); const g = c.getContext('2d');
  g.fillStyle = '#2d4a24'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 2600; i++) {
    const x = rng() * N, y = rng() * N, r = 2 + rng() * 4.5, a = rng() * Math.PI;
    const v = rng();
    g.fillStyle = v < 0.3 ? '#1d331a' : v < 0.6 ? '#3c5e2c' : v < 0.85 ? '#4f7436' : '#6c8a45';
    g.beginPath(); g.ellipse(x, y, r, r * 0.55, a, 0, Math.PI * 2); g.fill();
  }
  return toTexture(c, { repeat: [3, 3] });
}

function woodTexture(rng) {
  const c = makeCanvas(256, 64); const g = c.getContext('2d');
  g.fillStyle = '#7a5a3c'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(${rng() < 0.5 ? '50,34,22' : '150,120,90'},${0.15 + rng() * 0.25})`; g.lineWidth = 0.5 + rng() * 1.5; g.beginPath(); const y = rng() * 64; g.moveTo(0, y); g.bezierCurveTo(80, y + (rng() - 0.5) * 6, 170, y + (rng() - 0.5) * 6, 256, y + (rng() - 0.5) * 4); g.stroke(); }
  g.fillStyle = 'rgba(160,150,135,0.35)'; g.fillRect(0, 0, 256, 64); // silvered weathering
  return toTexture(c, { repeat: [1 / 1.8, 1 / 0.12] });
}

function buildEstimates(ctx, kit) {
  const D = ctx.data;
  const rng = ctx.rng('landmarks/plaza/estimates');
  const B = new Bucket();
  const plaza = D.plaza.boundary_m.map((p) => [p[0], p[2]]);
  const obstacles = D.obstacles.map((o) => o.footprint_xz);
  const placed = [];
  const ok = (x, z, r, forecourt = false) => {
    if (D.routeDistance(x, z) < 1.2 + 0.6 + r) return false;
    if (!forecourt && !insidePoly(x, z, plaza)) return false;
    for (const o of obstacles) { if (insidePoly(x, z, o)) return false; let md = Infinity; for (const p of o) md = Math.min(md, Math.hypot(p[0] - x, p[1] - z)); if (md < r + 0.5) return false; }
    for (const b of D.buildings) if (insidePoly(x, z, b.footprint)) return false;
    return true;
  };
  const report = [];
  // long tiled planter-benches and round planters (estimates) at candidate spots
  const cands = [
    { kind: 'planter', x: -36.6, z: -59.4, len: 5.6, wid: 1.2, dir: [-0.58, 0.81] },
    { kind: 'planter', x: -44.8, z: -55.2, len: 4.0, wid: 1.1, dir: [-0.98, -0.18] },
    { kind: 'bowl', koma: 0.08 }, { kind: 'bowl', koma: 0.92 },
    { kind: 'bench', x: -50.3, z: -80.2, dir: [0.29, -0.96] },
    { kind: 'bench', x: -49.6, z: -84.3, dir: [0.29, -0.96] },
    { kind: 'bench', x: -36.8, z: -63.8, dir: [-0.58, 0.81] },
    { kind: 'planter', x: -62.6, z: -62.0, len: 3.6, wid: 1.1, dir: [0.56, 0.83] },
  ];
  const koma = D.buildings.find((b) => b.id === 'koma-south-roof-proxy-lower-front-mass');
  for (const c of cands) {
    let { x, z, dir } = c;
    if (c.kind === 'bowl') {
      // flank the Koma entrance span ends, 2.6 m in front of the adopted front line
      const fp = koma.footprint; let best = null;
      for (let i = 0; i < fp.length; i++) { const a = fp[i], b = fp[(i + 1) % fp.length]; const mx = (a[0] + b[0]) / 2; if (!best || mx < best.mx) best = { a, b, mx }; }
      const [sa, sb] = best.a[1] > best.b[1] ? [best.a, best.b] : [best.b, best.a];
      const L = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]); const u = [(sb[0] - sa[0]) / L, (sb[1] - sa[1]) / L];
      let o = [-u[1], u[0]]; if ((koma.centroid[0] - sa[0]) * o[0] + (koma.centroid[1] - sa[1]) * o[1] > 0) o = [-o[0], -o[1]];
      x = sa[0] + u[0] * L * c.koma + o[0] * 2.6; z = sa[1] + u[1] * L * c.koma + o[1] * 2.6; dir = u;
    }
    const r = c.kind === 'planter' ? c.len / 2 : c.kind === 'bench' ? 1.0 : 0.6;
    if (!ok(x, z, c.kind === 'planter' ? c.wid / 2 : r * 0.6, c.kind === 'bowl')) { report.push(`${c.kind}@${x.toFixed(1)},${z.toFixed(1)} rejected`); continue; }
    // check both ends for long items
    if (c.kind !== 'bowl') { const e1 = [x + dir[0] * r, z + dir[1] * r], e2 = [x - dir[0] * r, z - dir[1] * r]; if (!ok(e1[0], e1[1], 0.4) || !ok(e2[0], e2[1], 0.4)) { report.push(`${c.kind}@${x.toFixed(1)},${z.toFixed(1)} rejected(ends)`); continue; } }
    let y = Infinity; for (const [dx, dz] of [[0, 0], [dir[0] * r, dir[1] * r], [-dir[0] * r, -dir[1] * r]]) y = Math.min(y, D.heightAt(x + dx, z + dz));
    const F = axisFrame([x, y, z], dir);
    const add = (k, g) => B.add(k, g, F.matrix);
    if (c.kind === 'planter') {
      const L = c.len, Wd = c.wid, H = 0.46;
      add('tile', boxMinMax(-L / 2, -0.15, -Wd / 2, L / 2, H, Wd / 2));
      add('coping', boxMinMax(-L / 2 - 0.04, H, -Wd / 2 - 0.04, L / 2 + 0.04, H + 0.06, -Wd / 2 + 0.16));
      add('coping', boxMinMax(-L / 2 - 0.04, H, Wd / 2 - 0.16, L / 2 + 0.04, H + 0.06, Wd / 2 + 0.04));
      add('coping', boxMinMax(-L / 2 - 0.04, H, -Wd / 2 + 0.16, -L / 2 + 0.16, H + 0.06, Wd / 2 - 0.16));
      add('coping', boxMinMax(L / 2 - 0.16, H, -Wd / 2 + 0.16, L / 2 + 0.04, H + 0.06, Wd / 2 - 0.16));
      add('soil', boxMinMax(-L / 2 + 0.16, H - 0.06, -Wd / 2 + 0.16, L / 2 - 0.16, H - 0.02, Wd / 2 - 0.16));
      const n = Math.max(2, Math.round(L / 0.9));
      for (let i = 0; i < n; i++) { const sg = shrubGeometry(rng, Math.min(1.1, L / n + 0.3), Wd - 0.3, 0.75 + rng() * 0.35, 5); for (const [k2, gg] of [['leaf', sg.blob], ['leafCard', sg.cards]]) if (gg) { gg.translate(-L / 2 + (i + 0.5) * L / n, H - 0.08, 0); add(k2, gg); } }
    } else if (c.kind === 'bowl') {
      const prof = [[0, 0], [0.42, 0], [0.5, 0.08], [0.6, 0.55], [0.62, 0.62], [0.54, 0.62], [0.5, 0.52], [0, 0.52]].map(([a, b]) => new THREE.Vector2(a, b));
      add('coping', new THREE.LatheGeometry(prof, 20));
      add('soil', cylGeo(0.5, 0.5, 0.5, 0.53, 16));
      const sg = shrubGeometry(rng, 1.0, 1.0, 0.85, 6); for (const [k2, gg] of [['leaf', sg.blob], ['leafCard', sg.cards]]) if (gg) { gg.translate(0, 0.45, 0); add(k2, gg); }
    } else if (c.kind === 'bench') {
      for (const lx of [-0.7, 0.7]) add('coping', boxMinMax(lx - 0.09, -0.1, -0.2, lx + 0.09, 0.36, 0.2));
      for (let k = 0; k < 4; k++) add('wood', boxMinMax(-0.95, 0.36, -0.2 + k * 0.105, 0.95, 0.41, -0.2 + k * 0.105 + 0.085));
      for (const lx of [-0.7, 0.7]) add('steel', boxMinMax(lx - 0.03, 0.33, -0.21, lx + 0.03, 0.36, 0.21));
    }
    placed.push(`${c.kind}@${x.toFixed(1)},${z.toFixed(1)}`);
  }
  ctx.log(`landmarks/plaza estimates placed: ${placed.join(' ')}; ${report.join(' ')}`);
  const tileTex = (() => {
    const c = makeCanvas(256, 128); const g = c.getContext('2d');
    g.fillStyle = '#b9b2a3'; g.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 128; y += 16) for (let x = 0; x < 256; x += 32) { const v = rng(); g.fillStyle = `rgb(${190 + v * 30},${182 + v * 28},${166 + v * 26})`; g.fillRect(x + ((y / 16) % 2) * 16 + 1, y + 1, 30, 14); }
    g.fillStyle = 'rgba(60,54,46,0.35)'; g.fillRect(0, 96, 256, 32);
    return toTexture(c, { repeat: [1 / 1.0, 1 / 0.5] });
  })();
  const g = new THREE.Group(); g.name = 'plaza-estimates';
  if (B.parts.size) g.add(B.build({
    tile: weather(new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.7 }), kit.macro, { baseY: -2, dirtH: 0.3, dirt: 0.0, streak: 0.15, mottle: 0.1 }),
    coping: weather(new THREE.MeshStandardMaterial({ color: 0xa7a398, roughness: 0.85 }), kit.macro, { baseY: -2, dirt: 0, streak: 0.12, mottle: 0.15 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x3b2f24, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ map: leafTexture(rng), roughness: 0.8, color: 0xb8c4a8 }),
    leafCard: { material: new THREE.MeshStandardMaterial({ map: leafCardTexture(rng), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }), castShadow: true },
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(rng), roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3e403c, roughness: 0.6, metalness: 0.5 }),
  }, 'plaza-estimates'));
  ctx.tag({ id: 'plaza-planters-benches', module: 'landmarks', tier: 'period-plausible-generic', note: `Planters with shrubs and benches are labelled estimates (no source for their positions); placed outside the 1.2 m walk corridor + margin and adopted obstacles: ${placed.join(', ')}` });
  return g;
}
