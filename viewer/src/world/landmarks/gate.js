import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Bucket, axisFrame, boxGeo, boxMinMax, cylGeo, tubeGeo, normGeo, makeCanvas, toTexture, rgbStr, hexToRgb, noiseCanvas, weather } from './kit.js';
import { letterGeometry, textNodeMatrix } from './letters.js';

// Ichibangai gate, adopted variant "curved-incandescent" (data/decisions/kabukicho-gate-1976.json).
// All primary dimensions come from the decision parameters; seams, rivets, braces, conduit,
// base plates and wear are period-plausible authored detail.

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function redPaintTexture(rng, hex) {
  // 4 m x 1 m tile at 256 px/m. Painted sheet steel: roller texture, seams with rivets, chips.
  const W = 1024, H = 256, ppm = 256;
  const c = makeCanvas(W, H); const g = c.getContext('2d');
  const base = hexToRgb(hex);
  g.fillStyle = rgbStr(base); g.fillRect(0, 0, W, H);
  const n1 = noiseCanvas(rng, 256, 8, 8, 5, 1.6);
  const n2 = noiseCanvas(rng, 256, 32, 4, 3, 1.4);
  const pat = (nc, sx, sy, a, mode) => { g.save(); g.globalAlpha = a; g.globalCompositeOperation = mode; const p = g.createPattern(nc, 'repeat'); p.setTransform(new DOMMatrix([sx, 0, 0, sy, 0, 0])); g.fillStyle = p; g.fillRect(0, 0, W, H); g.restore(); };
  pat(n1, 2, 1, 0.35, 'overlay');
  pat(n2, 4, 0.5, 0.18, 'soft-light');
  // sun-faded patches (lighter, more orange)
  for (let i = 0; i < 14; i++) {
    const x = rng() * W, y = rng() * H, r = 20 + rng() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(150,40,28,${0.10 + rng() * 0.12})`); gr.addColorStop(1, 'rgba(150,40,28,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // panel seams every 1.0 m with rivets
  for (let k = 0; k < 4; k++) {
    const x = Math.round((k + 0.37) * ppm);
    g.fillStyle = 'rgba(40,8,4,0.55)'; g.fillRect(x - 1, 0, 3, H);
    g.fillStyle = 'rgba(255,170,150,0.18)'; g.fillRect(x + 2, 0, 1, H);
    for (let y = 8; y < H; y += 20) {
      for (const dx of [-9, 9]) {
        g.fillStyle = 'rgba(30,6,3,0.45)'; g.beginPath(); g.arc(x + dx + 0.8, y + 1, 3.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = rgbStr(base.map((v) => v * 1.12)); g.beginPath(); g.arc(x + dx, y, 2.6, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,190,170,0.35)'; g.beginPath(); g.arc(x + dx - 0.8, y - 0.8, 1.1, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // edge rivet rows along both long edges
  for (let x = 6; x < W; x += 22) for (const y of [7, H - 7]) {
    g.fillStyle = 'rgba(30,6,3,0.4)'; g.beginPath(); g.arc(x + 0.8, y + 1, 2.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgbStr(base.map((v) => v * 1.1)); g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
  }
  // paint chips and rust pin-holes
  for (let i = 0; i < 260; i++) {
    const x = rng() * W, y = rng() * H;
    const r = 0.6 + Math.pow(rng(), 3) * 5;
    const kind = rng();
    g.fillStyle = kind < 0.55 ? `rgba(70,26,14,${0.5 + rng() * 0.4})` : kind < 0.85 ? `rgba(120,64,40,${0.45 + rng() * 0.4})` : `rgba(175,168,155,${0.45 + rng() * 0.3})`;
    g.beginPath();
    const pts = 6 + Math.floor(rng() * 4);
    for (let k = 0; k < pts; k++) { const a = (k / pts) * Math.PI * 2; const rr = r * (0.6 + rng() * 0.7); if (k === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
    if (kind < 0.55 && rng() < 0.4) { // rust bleed
      const gr = g.createLinearGradient(0, y, 0, y + 30 + rng() * 40);
      gr.addColorStop(0, 'rgba(110,45,20,0.35)'); gr.addColorStop(1, 'rgba(110,45,20,0)');
      g.fillStyle = gr; g.fillRect(x - r * 0.6, y, r * 1.2, 70);
    }
  }
  const t = toTexture(c, { repeat: [1 / 4, 1] });
  return t;
}

function plateTexture(rng, plateHex, w, h) {
  const ppm = 260;
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const c = makeCanvas(W, H); const g = c.getContext('2d');
  const base = hexToRgb(plateHex);
  g.fillStyle = rgbStr(base); g.fillRect(0, 0, W, H);
  const n1 = noiseCanvas(rng, 256, 6, 6, 5, 1.4);
  g.save(); g.globalAlpha = 0.16; g.globalCompositeOperation = 'multiply';
  const p = g.createPattern(n1, 'repeat'); p.setTransform(new DOMMatrix([3, 0, 0, 1.2, 0, 0])); g.fillStyle = p; g.fillRect(0, 0, W, H); g.restore();
  // grime: bottom edge, top dust, corner shadows
  let gr = g.createLinearGradient(0, H, 0, H * 0.45);
  gr.addColorStop(0, 'rgba(92,80,62,0.42)'); gr.addColorStop(1, 'rgba(92,80,62,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  gr = g.createLinearGradient(0, 0, 0, H * 0.2);
  gr.addColorStop(0, 'rgba(110,100,84,0.3)'); gr.addColorStop(1, 'rgba(110,100,84,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // drips from the top edge
  for (let i = 0; i < 60; i++) {
    const x = rng() * W, len = H * (0.15 + rng() * 0.7), wd = 2 + rng() * 8;
    gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, `rgba(96,84,66,${0.10 + rng() * 0.16})`); gr.addColorStop(1, 'rgba(96,84,66,0)');
    g.fillStyle = gr; g.fillRect(x, 0, wd, len);
  }
  // screws with rust bleed
  const screws = [];
  for (let k = 0; k < 7; k++) { const x = (0.03 + 0.94 * k / 6) * W; screws.push([x, 12], [x, H - 12]); }
  for (const [x, y] of screws) {
    gr = g.createLinearGradient(0, y, 0, y + 40 + rng() * 50);
    gr.addColorStop(0, 'rgba(126,60,26,0.5)'); gr.addColorStop(1, 'rgba(126,60,26,0)');
    g.fillStyle = gr; g.fillRect(x - 2.5, y, 5, 90);
    g.fillStyle = '#6d6a64'; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3c3a36'; g.fillRect(x - 3.5, y - 0.6, 7, 1.2);
  }
  return toTexture(c, { repeat: [1 / w, 1 / h] });
}

function ellipse(a, b, n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push([a * Math.cos(t), b * Math.sin(t)]); }
  return pts;
}

/** Closed strip between two closed polylines A,B (arrays of Vector3) with uv (along, across). */
function stripGeo(A, B, across, flip = false) {
  const n = A.length;
  const pos = new Float32Array((n + 1) * 2 * 3), uv = new Float32Array((n + 1) * 2 * 2);
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const a = A[i % n], b = B[i % n];
    if (i > 0) s += a.distanceTo(A[(i - 1) % n]);
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    uv.set([s, 0, s, across], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a0 = i * 2, b0 = i * 2 + 1, a1 = i * 2 + 2, b1 = i * 2 + 3;
    if (flip) idx.push(a0, a1, b1, a0, b1, b0); else idx.push(a0, b1, a1, a0, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Thin box between two points (square section s x s). */
function barBetween(p, q, s, s2 = s) {
  const d = new THREE.Vector3().subVectors(q, p);
  const L = d.length();
  const g = boxGeo(s, L, s2);
  const quat = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(quat);
  g.translate((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
  return g;
}

function rodBetween(p, q, r, seg = 6) {
  const d = new THREE.Vector3().subVectors(q, p);
  const L = d.length();
  const g = cylGeo(r, r, 0, L, seg, true);
  const quat = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(quat);
  g.translate(p.x, p.y, p.z);
  return g;
}

export function buildGate(ctx, kit) {
  const P = ctx.data.decisions.gate.parameters;
  const rng = ctx.rng('landmarks/gate');
  const group = new THREE.Group(); group.name = 'ichibangai-gate';
  const A = P.anchor_local_m;
  const R = P.right_xz;
  const origin = [A[0] + R[0] * P.center_u_m, A[1], A[2] + R[1] * P.center_u_m];
  const F = axisFrame(origin, R); // x = right, z = south (front, approach side)
  // sanity: frame z must equal -forward
  const fz = F.z; if (fz[0] * P.forward_xz[0] + fz[1] * P.forward_xz[1] > 0) throw new Error('gate frame orientation');

  const B = new Bucket();
  const add = (k, g) => B.add(k, g, F.matrix);
  const a = P.oval_width_m / 2, b = P.oval_height_m / 2, th = P.oval_ring_thickness_m, D = P.body_depth_m / 2;
  const cy = P.oval_center_height_m;

  // ---------------- oval ring cabinet (outer ellipse a,b; inner a-th, b-th as in r03 fixture)
  const N = 192;
  const outer = ellipse(a, b, N), inner = ellipse(a - th, b - th, N);
  const OF = outer.map(([x, y]) => V3(x, cy + y, D)), OB = outer.map(([x, y]) => V3(x, cy + y, -D));
  const IF = inner.map(([x, y]) => V3(x, cy + y, D)), IB = inner.map(([x, y]) => V3(x, cy + y, -D));
  add('red', stripGeo(OF, IF, th, true));    // front face (+z)
  add('red', stripGeo(OB, IB, th));          // back face (-z)
  add('red', stripGeo(OB, OF, 2 * D, true)); // outer skin
  add('red', stripGeo(IB, IF, 2 * D));       // inner skin
  // rolled edge beads on the four cabinet edges
  for (const [pts, z] of [[outer, D], [outer, -D], [inner, D], [inner, -D]]) {
    const step = 2;
    const sub = pts.filter((_, i) => i % step === 0).map(([x, y]) => V3(x, cy + y, z));
    add('red', tubeGeo(sub, 0.016, sub.length, 5, true, 'catmullrom'));
  }

  // ---------------- upturned tails (tube along adopted points, mirrored)
  const tailPts = P.tail_points_right_relative_uh_m;
  const tails = [];
  for (const side of [1, -1]) {
    const pts = tailPts.map(([u, h]) => V3(side * u, h, 0));
    const tg = tubeGeo(pts, P.tail_section_radius_m, 56, 18, false);
    add('red', tg);
    const curve = tg.userData.curve;
    tails.push({ side, curve });
    // spherical joint at the root (merges with ring), rounded tip cap with a small collar
    const s0 = new THREE.SphereGeometry(P.tail_section_radius_m, 18, 12); s0.translate(pts[0].x, pts[0].y, 0); add('red', s0);
    const tip = curve.getPoint(1), tan = curve.getTangent(1);
    const cap = new THREE.SphereGeometry(P.tail_section_radius_m, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), tan)); cap.translate(tip.x, tip.y, tip.z); add('red', cap);
    for (const tt of [0.32, 0.68]) { // welded collar bands
      const p = curve.getPoint(tt), tn = curve.getTangent(tt);
      const band = cylGeo(P.tail_section_radius_m + 0.012, P.tail_section_radius_m + 0.012, -0.02, 0.02, 18, true);
      band.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), tn)); band.translate(p.x, p.y, p.z); add('red', band);
    }
  }

  // ---------------- posts (adopted positions/radii/heights)
  const posts = P.post_positions_local_m.map((pp) => {
    const local = new THREE.Vector3(...pp.position_local_m).applyMatrix4(F.inverse);
    return { x: local.x, y0: local.y, world: pp.position_local_m };
  });
  for (const post of posts) {
    const { x, y0 } = post;
    const yTop = y0 + P.post_height_m;
    // steel base plate and anchor bolts
    add('steel', boxMinMax(x - 0.25, y0 - 0.02, -0.25, x + 0.25, y0 + 0.022, 0.25));
    for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      const nut = cylGeo(0.026, 0.026, y0 + 0.022, y0 + 0.05, 6); nut.translate(x + dx, 0, dz); add('steel', nut);
      const bolt = cylGeo(0.011, 0.011, y0 + 0.05, y0 + 0.085, 6); bolt.translate(x + dx, 0, dz); add('steel', bolt);
    }
    // cast base collar (lathe): radius base 0.17, height 0.32
    const rb = P.post_base_radius_m, hb = P.post_base_height_m, rp = P.post_radius_m;
    const prof = [[0, 0], [rb, 0], [rb, 0.05], [rb * 0.94, 0.07], [rb * 0.94, 0.16], [rb * 0.8, 0.22], [rp * 1.18, hb - 0.03], [rp * 1.12, hb], [0, hb]].map(([r, h]) => new THREE.Vector2(r, h));
    const lathe = new THREE.LatheGeometry(prof, 20); lathe.translate(x, y0 + 0.022, 0); add('red', lathe);
    // shaft
    add('red', (() => { const g = cylGeo(rp, rp, y0 + hb, yTop, 20, true); g.translate(x, 0, 0); return g; })());
    // flange joint and top collar
    for (const [yy, hh, rr] of [[y0 + 2.45, 0.05, rp + 0.025], [yTop - 0.09, 0.09, rp + 0.03]]) {
      const f = cylGeo(rr, rr, yy, yy + hh, 20); f.translate(x, 0, 0); add('red', f);
    }
    // neck from the post head into the upturned tail tube (concealed steel connection)
    const tail = tails.find((t) => Math.sign(t.side) === Math.sign(x));
    let best = null, bd = Infinity;
    for (let i = 0; i <= 80; i++) { const p = tail.curve.getPoint(i / 80); const d = Math.abs(p.x - x * 0.985) + (p.y < yTop ? 10 : 0); if (d < bd) { bd = d; best = p; } }
    const neckTop = best.clone(); neckTop.z = 0;
    const neck = rodBetween(V3(x, yTop - 0.02, 0), neckTop, rp * 0.8, 14); add('red', neck);
    // rear junction box and conduit (bulb circuit)
    const zb = -(rp + 0.07);
    add('grey', boxMinMax(x - 0.11, y0 + 2.1, zb - 0.07, x + 0.11, y0 + 2.42, zb + 0.06));
    add('grey', boxMinMax(x - 0.12, y0 + 2.415, zb - 0.075, x + 0.12, y0 + 2.43, zb + 0.065));
    add('grey', rodBetween(V3(x, y0 + 0.02, -(rp + 0.022)), V3(x, y0 + 2.1, -(rp + 0.022)), 0.016));
    add('grey', rodBetween(V3(x, y0 + 2.42, -(rp + 0.022)), V3(x, yTop - 0.1, -(rp + 0.022)), 0.016));
    add('grey', rodBetween(V3(x, yTop - 0.1, -(rp + 0.022)), V3(neckTop.x, neckTop.y - 0.2, -0.13), 0.016));
    // rear knee brace from the post to the ring underside (concealed steel brace)
    const xr = Math.sign(x) * 3.45;
    const yr = cy - (b - 0.005) * Math.sqrt(Math.max(0, 1 - (xr / a) ** 2));
    void xr; void yr;
    add('red', barBetween(V3(x, yTop - 0.35, -0.06), V3(Math.sign(x) * (a - 0.15), cy - 0.2, -0.16), 0.04, 0.035));
  }

  // ---------------- central plate with red frame and supports
  const pw = P.central_plate_width_m, ph = P.central_plate_height_m, pd = P.central_plate_depth_m;
  const plate = boxGeo(pw, ph, pd); plate.translate(0, cy, 0); add('plate', plate);
  const fr = 0.035, ft = 0.018;
  for (const zs of [1, -1]) {
    const z0 = zs * pd / 2, z1 = zs * (pd / 2 + ft);
    const zz = [Math.min(z0, z1), Math.max(z0, z1)];
    add('red', boxMinMax(-pw / 2 - 0.01, cy + ph / 2 - fr, zz[0], pw / 2 + 0.01, cy + ph / 2 + 0.01, zz[1]));
    add('red', boxMinMax(-pw / 2 - 0.01, cy - ph / 2 - 0.01, zz[0], pw / 2 + 0.01, cy - ph / 2 + fr, zz[1]));
    add('red', boxMinMax(-pw / 2 - 0.01, cy - ph / 2, zz[0], -pw / 2 + fr, cy + ph / 2, zz[1]));
    add('red', boxMinMax(pw / 2 - fr, cy - ph / 2, zz[0], pw / 2 + 0.01, cy + ph / 2, zz[1]));
  }
  const zw = pd / 2 + ft; // red edge caps on the plate's four narrow faces
  add('red', boxMinMax(-pw / 2 - 0.01, cy + ph / 2, -zw, pw / 2 + 0.01, cy + ph / 2 + 0.01, zw));
  add('red', boxMinMax(-pw / 2 - 0.01, cy - ph / 2 - 0.01, -zw, pw / 2 + 0.01, cy - ph / 2, zw));
  add('red', boxMinMax(-pw / 2 - 0.01, cy - ph / 2, -zw, -pw / 2, cy + ph / 2, zw));
  add('red', boxMinMax(pw / 2, cy - ph / 2, -zw, pw / 2 + 0.01, cy + ph / 2, zw));
  for (const s of [1, -1]) {
    add('red', boxMinMax(s > 0 ? pw / 2 : -(a - th) - 0.02, cy - 0.04, -0.035, s > 0 ? a - th + 0.02 : -pw / 2, cy + 0.04, 0.035));
    for (const xx of [1.15, 2.6]) {
      const X = s * xx;
      const yi = (b - th) * Math.sqrt(Math.max(0, 1 - (X / (a - th)) ** 2));
      add('red', rodBetween(V3(X, cy + ph / 2, 0), V3(X, cy + yi + 0.02, 0), 0.016));
      add('red', rodBetween(V3(X, cy - yi - 0.02, 0), V3(X, cy - ph / 2, 0), 0.016));
    }
  }

  // ---------------- 3D red letters on both plate faces (adopted text nodes)
  const nodes = ctx.data.textNodes.filter((t) => t.decision_id === 'kabukicho-gate-1976');
  for (const node of nodes) {
    const L = letterGeometry(node.text, node.height_m, 0.032, { px: 160, weight: 'bold', stroke: 3 });
    const m = textNodeMatrix(node, 0);
    if (L.face) B.add('letter', L.face, m);
    if (L.side) B.add('letterSide', L.side, m);
    ctx.tag({ id: node.id, module: 'landmarks', tier: 'adopted-inferred', note: `${node.text}: dimensional letters at adopted text node (decision ${node.decision_id}); reverse face text inferred` });
  }

  // ---------------- materials
  const redTex = redPaintTexture(ctx.rng('landmarks/gate/paint'), P.body_color_srgb);
  const red = weather(new THREE.MeshStandardMaterial({ map: redTex, color: new THREE.Color(0.8, 0.6, 0.6), roughness: 0.66, metalness: 0.0 }), kit.macro, { baseY: posts[0].y0, dirtH: 0.9, dirt: 0.3, streak: 0.14, mottle: 0.14, streakScale: 2 });
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(ctx.rng('landmarks/gate/plate'), P.plate_color_srgb, pw, ph), roughness: 0.38, metalness: 0.0 });
  const letterMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.letter_color_srgb).multiply(new THREE.Color(0.85, 0.7, 0.7)), roughness: 0.42, metalness: 0.0 });
  const letterSide = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.letter_color_srgb).multiplyScalar(0.8), roughness: 0.5, metalness: 0.1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3936, roughness: 0.62, metalness: 0.55 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x7c7b74, roughness: 0.55, metalness: 0.4 });
  group.add(B.build({ red, plate: plateMat, letter: letterMat, letterSide, steel, grey }, 'gate'));

  // ---------------- incandescent bulbs (instanced): 3 rows x 90 on the oval, 24 per tail
  const bulbR = P.bulb_diameter_m / 2;
  const zFace = D + bulbR + 0.003;
  const positions = [];
  const tailSamples = tails.map((t) => { const a = []; for (let i = 0; i <= 40; i++) a.push(t.curve.getPoint(i / 40)); return a; });
  const clearR = P.tail_section_radius_m + bulbR * 0.8;
  const tailClear = (x, y) => tailSamples.every((ts) => ts.every((p) => Math.hypot(p.x - x, p.y - y) >= clearR));
  const rows = P.bulb_rows;
  for (let r = 0; r < rows; r++) {
    const d = th * (r + 0.5) / rows;
    const ea = a - d, eb = b - d;
    // fine arc sampling, exclude where the tails pass in front of the ring end
    const M = 1200; const samp = []; let s = 0;
    let prev = [ea, 0];
    for (let i = 0; i <= M; i++) {
      const t = (i / M) * Math.PI * 2; const p = [ea * Math.cos(t), eb * Math.sin(t)];
      s += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p;
      samp.push({ s, p, free: tailClear(p[0], cy + p[1]) });
    }
    let freeLen = 0; for (let i = 1; i < samp.length; i++) if (samp[i].free && samp[i - 1].free) freeLen += samp[i].s - samp[i - 1].s;
    const n = P.bulbs_per_oval_row; const step = freeLen / n;
    let acc = step * ((r % 3) / 3 + 0.5); let run = 0; let placed = 0;
    for (let i = 1; i < samp.length && placed < n; i++) {
      if (!(samp[i].free && samp[i - 1].free)) continue;
      run += samp[i].s - samp[i - 1].s;
      while (run >= acc && placed < n) { positions.push(V3(samp[i].p[0], cy + samp[i].p[1], zFace)); placed++; acc += step; }
    }
  }
  for (const t of tails) {
    const n = P.tail_bulbs_per_side;
    for (let i = 0; i < n; i++) {
      const p = t.curve.getPointAt(0.07 + 0.9 * (i / (n - 1)));
      positions.push(V3(p.x, p.y, P.tail_section_radius_m + bulbR + 0.002));
    }
  }
  const bulbGroup = buildBulbs(ctx, kit, positions, bulbR, rng, F.matrix);
  group.add(bulbGroup);

  ctx.tag({ id: 'ichibangai-gate-structure', module: 'landmarks', tier: 'adopted-inferred', note: 'Curved-incandescent gate: posts, oval ring, tails, plate and colours from data/decisions/kabukicho-gate-1976.json (1978 photo extrapolated to 1976; dimensions are reconstruction assumptions).' });
  ctx.tag({ id: 'ichibangai-gate-bulbs', module: 'landmarks', tier: 'adopted-inferred', note: `${positions.length} incandescent bulbs (3x90 oval rows distributed by arc length clear of the tails + 2x24 tail bulbs); authored density, not a counted inventory.` });
  ctx.tag({ id: 'ichibangai-gate-detailing', module: 'landmarks', tier: 'period-plausible-generic', note: 'Seams, rivets, edge beads, base plates/anchor bolts, rear braces, junction boxes, conduit and paint wear are authored detail; rear construction is unseen in any source.' });
  return group;
}

function buildBulbs(ctx, kit, positions, r, rng, matrix) {
  const g = new THREE.Group(); g.name = 'gate-bulbs';
  const night = kit.night;
  const warm = new THREE.Color().setRGB(1.0, 0.56, 0.22); // ~2400 K (linear)
  const n = positions.length;
  const dead = new Set();
  for (let i = 0; i < n; i++) if (rng() < 0.03) dead.add(i);
  const live = positions.map((p, i) => i).filter((i) => !dead.has(i));
  // glass envelope: A-shape lathe (axis +z after rotation)
  const prof = [[0, -r * 0.55], [r * 0.5, -r * 0.55], [r * 0.62, -r * 0.35], [r * 0.95, 0.0], [r, r * 0.3], [r * 0.82, r * 0.78], [r * 0.4, r * 1.02], [0, r * 1.08]].map(([x, y]) => new THREE.Vector2(x, y));
  const glassGeo = new THREE.LatheGeometry(prof, 10); glassGeo.rotateX(Math.PI / 2);
  const coreGeo = new THREE.SphereGeometry(r * 0.5, 8, 6); coreGeo.scale(1, 1, 1.2);
  const sockGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.7, r * 0.6, 8, 1, false); sockGeo.rotateX(Math.PI / 2); sockGeo.translate(0, 0, -r * 0.82);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe9c4, roughness: 0.06, metalness: 0.0, transparent: true, opacity: night ? 0.5 : 0.42, emissive: warm, emissiveIntensity: night ? 1.8 : 0.45, depthWrite: false });
  const deadMat = new THREE.MeshStandardMaterial({ color: 0xcfc8bc, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.7, depthWrite: false });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, emissive: warm, emissiveIntensity: night ? 9.0 : 2.4 });
  coreMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif'); };
  coreMat.customProgramCacheKey = () => 'lm-bulbcore';
  const sockMat = new THREE.MeshStandardMaterial({ color: 0x2a2621, roughness: 0.55, metalness: 0.5 });
  const mk = (geo, mat, idxs) => {
    const im = new THREE.InstancedMesh(geo, mat, idxs.length);
    const m = new THREE.Matrix4();
    idxs.forEach((i, k) => { m.makeTranslation(positions[i].x, positions[i].y, positions[i].z); m.premultiply(matrix); im.setMatrixAt(k, m); });
    im.castShadow = false; im.userData.noShadow = true; im.receiveShadow = false;
    im.instanceMatrix.needsUpdate = true;
    return im;
  };
  const all = positions.map((_, i) => i);
  const socks = mk(sockGeo, sockMat, all); socks.userData.noShadow = true; g.add(socks);
  const core = mk(coreGeo, coreMat, live);
  const col = new THREE.Color();
  live.forEach((i, k) => { const v = 0.75 + rng() * 0.4; col.setRGB(v, v * (0.96 + rng() * 0.06), v * (0.9 + rng() * 0.12)); core.setColorAt(k, col); });
  core.instanceColor.needsUpdate = true;
  g.add(core);
  const glass = mk(glassGeo, glassMat, live); glass.renderOrder = 2; g.add(glass);
  if (dead.size) { const dg = mk(glassGeo, deadMat, [...dead]); dg.renderOrder = 2; g.add(dg); }
  if (night) {
    // a few soft warm point lights to let the bulbs light the plate and nearby facades
    const pl = new THREE.PointLight(0xffa860, 6, 14, 2);
    pl.position.set(0, ctx.data.decisions.gate.parameters.oval_center_height_m, 0.9).applyMatrix4(matrix);
    g.add(pl);
  }
  return g;
}
