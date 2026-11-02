import * as THREE from 'three';
import { MAT, lin, jitter, mat4, mul, mixc, prim, scalec } from './kit.js';
import { ATLAS } from './materials.js';

// Generic shop-front and street clutter of 1970s Tokyo (period-plausible-generic): phone booth,
// boxy vending machines (no brands; generic words たばこ / ジュース only), concrete and plastic
// bins, beer crates with bottles, cardboard, potted plants, stools, buckets, brooms, propane
// cylinders, ash-tray stands. All builders use a local frame with +z facing the street and the
// origin on the ground at the footprint centre.

const CHROME = lin('#c5c8c8');

// ---- phone booth ----------------------------------------------------------------------------
export function buildPhoneBooth(kit, W, rng) {
  const { B, BS, BA, BG } = kit;
  const frame = jitter(lin('#d9d3c2'), rng, 0.04);
  const roof = jitter(lin('#b8392a'), rng, 0.05);
  const w = 0.86, h = 2.16;
  B.box(W, 0, 0.04, 0, w + 0.06, 0.08, w + 0.06, lin('#8d8a83'), MAT.concrete);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(W, sx * (w / 2 - 0.025), 0.08 + h / 2, sz * (w / 2 - 0.025), 0.05, h, 0.05, frame, MAT.metalPaint);
  for (const [nx, nz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
    const cx = nx * (w / 2 - 0.02), cz = nz * (w / 2 - 0.02);
    // lower kick panel, rails, glass
    B.box(W, cx, 0.5, cz, nx ? 0.03 : w - 0.06, 0.82, nz ? 0.03 : w - 0.06, frame, MAT.metalPaint);
    B.box(W, cx * 1.01, 0.93, cz * 1.01, nx ? 0.04 : w - 0.04, 0.05, nz ? 0.04 : w - 0.04, frame, MAT.metalPaint);
    B.box(W, cx * 1.01, 2.2, cz * 1.01, nx ? 0.04 : w - 0.04, 0.06, nz ? 0.04 : w - 0.04, frame, MAT.metalPaint);
    BG.box(W, cx, 1.56, cz, nx ? 0.008 : w - 0.08, 1.2, nz ? 0.008 : w - 0.08, [1, 1, 1], MAT.glassDark);
  }
  // door handle (front)
  B.rod(W, [w / 2 - 0.12, 0.95, w / 2 + 0.01], [w / 2 - 0.12, 1.3, w / 2 + 0.01], 0.012, CHROME, MAT.chrome, 5);
  // roof + sign box with 電話 on four faces
  B.box(W, 0, 2.27, 0, w + 0.12, 0.07, w + 0.12, roof, MAT.metalPaint);
  B.box(W, 0, 2.43, 0, w - 0.1, 0.25, w - 0.1, lin('#efe9d6'), MAT.plastic, 0, 0, 0, { emit: [0.9, 0.0] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    BA.quad(mul(W, mat4(0, 0, 0, a)), 0, 2.43, (w - 0.1) / 2 + 0.004, w - 0.16, 0.2, ATLAS.phoneSign, [1, 1, 1], MAT.plastic, 0, 0, { emit: [0.9, 0.0] });
  }
  B.box(W, 0, 2.58, 0, w - 0.04, 0.05, w - 0.04, roof, MAT.metalPaint);
  // interior: shelf, yellow phone, directory, ceiling lamp
  BS.box(W, 0, 0.98, -w / 2 + 0.17, w - 0.12, 0.03, 0.28, lin('#7a6a54'), MAT.wood);
  BS.box(W, 0.02, 1.1, -w / 2 + 0.15, 0.24, 0.2, 0.22, lin('#e3b52e'), MAT.plastic);
  BS.box(W, 0.02, 1.25, -w / 2 + 0.13, 0.22, 0.06, 0.08, lin('#d9a822'), MAT.plastic);
  BS.box(W, -0.24, 1.03, -w / 2 + 0.18, 0.18, 0.06, 0.24, lin('#2b2b2b'), MAT.cardboard);
  BS.box(W, 0, 2.15, 0, 0.3, 0.03, 0.1, lin('#fff6e4'), MAT.lens, 0, 0, 0, { emit: [2.0, 0.0] });
}

// ---- vending machines ----------------------------------------------------------------------
export function buildVending(kit, W, rng, type) {
  const { B, BA } = kit;
  const cig = type === 'cig';
  const w = cig ? 0.82 : 0.92, h = cig ? 1.72 : 1.8, d = cig ? 0.56 : 0.68;
  const body = cig ? jitter(lin('#e3dccb'), rng, 0.04) : type === 'drinkRed' ? jitter(lin('#c3322b'), rng, 0.05) : jitter(lin('#2c5ba3'), rng, 0.05);
  B.box(W, 0, 0.05, 0, w - 0.02, 0.1, d - 0.04, lin('#2a2a28'), MAT.metalPaint);
  B.box(W, 0, 0.1 + (h - 0.1) / 2, 0, w, h - 0.1, d, body, MAT.metalPaint);
  B.box(W, 0, h + 0.02, 0.02, w + 0.03, 0.05, d + 0.06, mixc(body, [0, 0, 0], 0.15), MAT.metalPaint);
  const reg = cig ? ATLAS.vendCig : type === 'drinkRed' ? ATLAS.vendDrinkRed : ATLAS.vendDrinkBlue;
  BA.quad(W, 0, 0.12 + (h - 0.16) / 2, d / 2 + 0.004, w - 0.04, h - 0.18, reg, [1, 1, 1], MAT.paintGloss, 0, 0, { emit: [0.55, 0.06] });
  // coin return / button trim and a slim chrome frame
  B.box(W, 0, 0.12 + (h - 0.16) / 2, d / 2 + 0.002, w + 0.004, h - 0.14, 0.004, CHROME, MAT.chrome);
  // side vents, side graphic band and kick plate
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) B.box(W, s * (w / 2 + 0.002), 0.35 + i * 0.05, -d / 4, 0.004, 0.02, d * 0.35, mixc(body, [0, 0, 0], 0.35), MAT.metalPaint);
    const band = cig ? lin('#b52a22') : lin('#efe9dc');
    B.box(W, s * (w / 2 + 0.003), h * 0.72, 0.02, 0.004, 0.12, d - 0.06, band, MAT.paintGloss);
    B.box(W, s * (w / 2 + 0.003), h * 0.72 - 0.11, 0.02, 0.004, 0.03, d - 0.06, band, MAT.paintGloss);
    B.box(W, s * (w / 2 + 0.003), 0.16, 0, 0.004, 0.1, d - 0.02, lin('#3a3a36'), MAT.metalPaint);
  }
}

// ---- bins ------------------------------------------------------------------------------------
export function buildBin(kit, W, rng, type) {
  const { B, BA } = kit;
  if (type === 'concreteBox') {
    const c = jitter(lin('#77736c'), rng, 0.06);
    B.box(W, 0, 0.38, 0, 0.6, 0.76, 0.6, c, MAT.concrete);
    B.box(W, 0, 0.765, 0, 0.44, 0.02, 0.44, lin('#151412'), MAT.rubber);
    BA.quad(W, 0, 0.6, 0.302, 0.42, 0.14, ATLAS.binLabel, [1, 1, 1], MAT.concrete);
  } else if (type === 'concreteCyl') {
    const c = jitter(lin('#7b7871'), rng, 0.06);
    B.cyl(W, 0, 0, 0, 0.3, 0.72, c, MAT.concrete, 16);
    B.cyl(W, 0, 0.705, 0, 0.25, 0.02, lin('#141312'), MAT.rubber, 16);
    B.cyl(W, 0, 0.5, 0, 0.305, 0.07, lin('#2b2b29'), MAT.metalPaint, 16);
  } else if (type === 'poly') {
    const c = jitter(lin(rng.pick(['#2f6fb3', '#3a7ec2', '#4f8a3a', '#3b3f45', '#2a5f9e'])), rng, 0.06);
    const r = rng.range(0.22, 0.28), hh = rng.range(0.52, 0.68);
    B.cyl(W, 0, 0, 0, r * 0.88, hh, c, MAT.plastic, 16, 1 / 0.88);
    B.torus(W, mat4(0, hh * 0.55, 0, 0, Math.PI / 2), r * 0.97, 0.03, c, MAT.plastic, 4, 16);
    if (rng.chance(0.8)) {
      B.cyl(W, 0, hh, 0, r + 0.015, 0.04, c, MAT.plastic, 16);
      B.box(W, 0, hh + 0.05, 0, r * 0.9, 0.025, 0.05, c, MAT.plastic);
    }
    for (const s of [-1, 1]) B.box(W, s * r * 1.0, hh - 0.08, 0, 0.04, 0.03, 0.12, c, MAT.plastic);
  } else {
    // galvanised dustbin with ribs and lid
    const c = jitter(lin('#a3a7a5'), rng, 0.06);
    const r = 0.27, hh = 0.62;
    B.cyl(W, 0, 0, 0, r * 0.92, hh, c, MAT.galv, 16, 1 / 0.92);
    for (const y of [0.15, 0.32, 0.5]) B.torus(W, mat4(0, y, 0, 0, Math.PI / 2), r * (0.93 + y * 0.12), 0.025, c, MAT.galv, 4, 16);
    if (rng.chance(0.75)) {
      B.lathe(W, 0, hh, 0, [[r + 0.02, 0], [r + 0.02, 0.025], [r * 0.7, 0.06], [0, 0.07]], c, MAT.galv, 16);
      B.torus(W, mat4(0, hh + 0.08, 0, 0, 0, 0), 0.06, 0.15, c, MAT.galv, 4, 10, Math.PI);
    }
  }
}

// ---- beer crates -------------------------------------------------------------------------------
const CRATE_COLS = ['#d9a62a', '#c23a2e', '#2c5aa3', '#3d7a43', '#7a4a2a', '#d9a62a', '#c23a2e'];
const BOTTLE = lin('#3e2510');

function crate(kit, W, x, y, z, ry, col, bottles, rng) {
  const { B, BS, BA } = kit;
  const w = 0.46, d = 0.36, h = 0.3;
  const M = mul(W, mat4(x, y, z, ry));
  B.box(M, 0, h / 2, 0, w, h, d, col, MAT.plastic);
  for (const [px, pz, a, sw] of [[0, d / 2 + 0.002, 0, w], [0, -d / 2 - 0.002, Math.PI, w], [w / 2 + 0.002, 0, Math.PI / 2, d], [-w / 2 - 0.002, 0, -Math.PI / 2, d]]) {
    BA.quad(M, px, h / 2, pz, sw - 0.01, h - 0.01, ATLAS.crateSide, col, MAT.plastic, a);
  }
  B.box(M, 0, h + 0.001, 0, w - 0.04, 0.004, d - 0.04, scalec(col, 0.25), MAT.plastic);
  if (bottles) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      if (rng.chance(0.06)) continue;
      const bx = -w / 2 + 0.05 + i * 0.09, bz = -d / 2 + 0.05 + j * 0.087;
      BS.cyl(M, bx, h - 0.06, bz, 0.03, 0.08, BOTTLE, MAT.glassDark, 6, 0.45);
      BS.cyl(M, bx, h + 0.02, bz, 0.0135, 0.07, BOTTLE, MAT.glassDark, 6);
      BS.cyl(M, bx, h + 0.09, bz, 0.016, 0.012, lin(rng.pick(['#c9b25a', '#b8b8b0', '#c24030'])), MAT.steel, 6);
    }
  }
}

export function buildCrateStack(kit, W, rng, cols = 2) {
  const col0 = jitter(lin(rng.pick(CRATE_COLS)), rng, 0.08);
  for (let c = 0; c < cols; c++) {
    const n = rng.int(1, 5);
    const col = rng.chance(0.7) ? col0 : jitter(lin(rng.pick(CRATE_COLS)), rng, 0.08);
    for (let k = 0; k < n; k++) {
      crate(kit, W, (c - (cols - 1) / 2) * 0.47 + rng.range(-0.02, 0.02), k * 0.3, rng.range(-0.02, 0.02), rng.range(-0.05, 0.05), col, k === n - 1 && rng.chance(0.75), rng);
    }
  }
}

// ---- cardboard ---------------------------------------------------------------------------------
function cardBox(kit, M, sx, sy, sz, rng) {
  const { B, BA } = kit;
  const tint = jitter([1, 1, 1], rng, 0.08);
  B.box(M, 0, sy / 2, 0, sx, sy, sz, mixc(lin('#a87f52'), [0, 0, 0], 0.1), MAT.cardboard);
  for (const [px, pz, a, w] of [[0, sz / 2 + 0.002, 0, sx], [0, -sz / 2 - 0.002, Math.PI, sx], [sx / 2 + 0.002, 0, Math.PI / 2, sz], [-sx / 2 - 0.002, 0, -Math.PI / 2, sz]]) {
    BA.quad(M, px, sy / 2, pz, w, sy, ATLAS.cardboard, tint, MAT.cardboard, a);
  }
  BA.quad(M, 0, sy + 0.002, 0, sx, sz, ATLAS.cardboard, tint, MAT.cardboard, 0, -Math.PI / 2);
}

export function buildCardboard(kit, W, rng) {
  const n = rng.int(1, 4);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const sx = rng.range(0.35, 0.6), sy = rng.range(0.2, 0.42), sz = rng.range(0.3, 0.45);
    cardBox(kit, mul(W, mat4(rng.range(-0.06, 0.06), y, rng.range(-0.05, 0.05), rng.range(-0.2, 0.2))), sx, sy, sz, rng);
    y += sy;
    if (y > 1.0) break;
  }
  // flattened boxes leaning on the wall behind
  if (rng.chance(0.6)) {
    const { B } = kit;
    for (let i = 0; i < rng.int(2, 5); i++) B.box(W, rng.range(-0.15, 0.15), 0.45, -0.25 + i * 0.012, rng.range(0.6, 0.85), 0.9, 0.01, jitter(lin('#a47b4e'), rng, 0.1), MAT.cardboard, rng.range(-0.05, 0.05), -0.18);
  }
}

// ---- plants --------------------------------------------------------------------------------------
const LEAF = ['#3d6a2c', '#4f7c35', '#2f5a28', '#5c8040', '#45722f', '#6b8a3a'];
function leafColor(base, rng) {
  return (x, y, z) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const f = h - Math.floor(h);
    return [base[0] * (0.7 + 0.6 * f), base[1] * (0.75 + 0.5 * f), base[2] * (0.7 + 0.5 * f)];
  };
}
function bush(kit, W, x, y, z, r, rng, big = false) {
  // crossed alpha-tested leaf cards in a rough dome, plus a dark core so it never looks hollow
  const base = jitter(lin(rng.pick(['#9fbf8a', '#a9c48f', '#b6c99a', '#93b47f'])), rng, 0.08);
  const n = big ? rng.int(7, 10) : rng.int(9, 14);
  kit.BF.add(prim.ico(1), mul(W, mat4(x, y + r * 0.4, z, 0, 0, 0, r * 0.42, r * 0.36, r * 0.42)), lin('#34532a'), MAT.leaf);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), rr = rng.range(0, r * 0.45);
    const s = r * rng.range(1.1, 1.6);
    const tint = jitter(base, rng, 0.12);
    kit.BA.add(prim.plane(), mul(W, mat4(x + Math.cos(a) * rr, y + rng.range(0.15, 0.9) * r, z + Math.sin(a) * rr, rng.range(0, Math.PI), rng.range(-0.9, 0.9), rng.range(-0.5, 0.5), s, s, 1)), tint, MAT.leaf, { uvRect: big ? ATLAS.leafBig : ATLAS.leafSmall });
  }
}
export function buildPlants(kit, W, rng, count = 3) {
  const { B } = kit;
  let x = -((count - 1) * 0.42) / 2;
  for (let i = 0; i < count; i++) {
    const kind = rng.pick(['terracotta', 'terracotta', 'glazed', 'styro', 'plastic']);
    const r = rng.range(0.13, 0.24);
    let top;
    if (kind === 'styro') {
      B.box(W, x, 0.12, 0, 0.5, 0.24, 0.32, jitter(lin('#e8e6df'), rng, 0.04), MAT.plastic);
      B.box(W, x, 0.235, 0, 0.44, 0.01, 0.26, lin('#3a2a1c'), MAT.soil);
      top = 0.24;
      for (let k = -1; k <= 1; k++) bush(kit, W, x + k * 0.14, top, 0, 0.13, rng);
      x += 0.55;
      continue;
    }
    const col = kind === 'terracotta' ? jitter(lin('#a6583a'), rng, 0.08) : kind === 'glazed' ? jitter(lin(rng.pick(['#2f4f7a', '#3f6a5a', '#6a3a2a'])), rng, 0.08) : jitter(lin('#e6e3da'), rng, 0.05);
    const ph = r * rng.range(1.0, 1.5);
    B.lathe(W, x, 0, 0, [[r * 0.7, 0], [r * 0.72, 0.02], [r * 0.95, ph * 0.9], [r * 1.05, ph * 0.92], [r * 1.05, ph], [r * 0.9, ph], [0, ph - 0.02]], col, kind === 'glazed' ? MAT.paintGloss : MAT.concrete, 14);
    top = ph;
    if (rng.chance(0.3)) {
      // tall rubber plant: trunk with leaf clusters
      B.rod(W, [x, top, 0], [x + rng.range(-0.05, 0.05), top + 0.9, 0], 0.015, lin('#5a4630'), MAT.wood, 5);
      for (let k = 0; k < 3; k++) bush(kit, W, x + rng.range(-0.1, 0.1), top + 0.35 + k * 0.25, rng.range(-0.08, 0.08), 0.22, rng, true);
    } else {
      bush(kit, W, x, top - 0.02, 0, r * rng.range(1.1, 1.8), rng);
    }
    x += Math.max(0.36, r * 2 + 0.06);
  }
}

// ---- small clutter --------------------------------------------------------------------------------
export function buildStool(kit, W, rng) {
  const { B } = kit;
  const c = jitter(lin(rng.pick(['#8a6a44', '#b23a2c', '#2f5a8a', '#7a7a72'])), rng, 0.08);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.rod(W, [sx * 0.12, 0, sz * 0.12], [sx * 0.1, 0.43, sz * 0.1], 0.013, CHROME, MAT.steel, 4);
  B.cyl(W, 0, 0.43, 0, 0.17, 0.05, c, MAT.plastic, 14);
}
export function buildBucket(kit, W, rng) {
  const { B } = kit;
  const metal = rng.chance(0.6);
  const c = metal ? jitter(lin('#a8aca9'), rng, 0.06) : jitter(lin(rng.pick(['#d24a2a', '#3a6fb0', '#e0b02a'])), rng, 0.06);
  B.lathe(W, 0, 0, 0, [[0.12, 0], [0.125, 0.01], [0.16, 0.28], [0.165, 0.29], [0.155, 0.29], [0.115, 0.02], [0, 0.02]], c, metal ? MAT.galv : MAT.plastic, 14);
  B.torus(W, mat4(0, 0.29, 0, 0, 0, 0.6), 0.16, 0.03, CHROME, MAT.steel, 3, 10, Math.PI);
}
export function buildBroom(kit, W, rng) {
  const { B } = kit;
  const lean = rng.range(0.12, 0.22);
  B.rod(W, [0, 0.12, 0.05], [0, 1.25, 0.05 - lean], 0.012, lin('#a88a5a'), MAT.wood, 5);
  B.box(W, 0, 0.1, 0.055, 0.25, 0.2, 0.05, lin('#8a6a3a'), MAT.wood, 0, -0.15);
}
export function buildGasCylinders(kit, W, rng) {
  const { B } = kit;
  for (const sx of [-0.18, 0.18]) {
    const c = jitter(lin('#9aa09e'), rng, 0.05);
    B.cyl(W, sx, 0.03, 0, 0.16, 0.95, c, MAT.metalPaint, 14);
    B.sphere(W, sx, 0.98, 0, 0.16, 0.08, 0.16, c, MAT.metalPaint, 14, 5);
    B.cyl(W, sx, 1.04, 0, 0.05, 0.1, lin('#6c6f6c'), MAT.steel, 8);
    B.torus(W, mat4(sx, 0.02, 0, 0, Math.PI / 2), 0.16, 0.1, lin('#3a3a38'), MAT.metalPaint, 4, 14);
  }
  B.rod(W, [-0.38, 0.7, -0.14], [0.38, 0.7, -0.14], 0.006, lin('#6b6b66'), MAT.steel, 3);
}
export function buildAshtray(kit, W, rng) {
  const { B } = kit;
  const c = jitter(lin(rng.pick(['#8a8f8d', '#2f5a8a', '#3d6a4a', '#9a9a92'])), rng, 0.06);
  B.cyl(W, 0, 0, 0, 0.17, 0.04, lin('#3a3a38'), MAT.metalPaint, 14);
  B.cyl(W, 0, 0.04, 0, 0.12, 0.6, c, MAT.metalPaint, 14);
  B.lathe(W, 0, 0.64, 0, [[0.12, 0], [0.17, 0.04], [0.17, 0.07], [0.13, 0.06], [0, 0.05]], CHROME, MAT.chrome, 14);
}
export function buildWoodCrates(kit, W, rng) {
  const { B } = kit;
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) {
    const c = jitter(lin('#b39268'), rng, 0.1);
    const y = k * 0.27;
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) B.box(W, 0, y + 0.04 + i * 0.09, s * 0.19, 0.55, 0.06, 0.015, c, MAT.wood, rng.range(-0.01, 0.01));
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) B.box(W, s * 0.27, y + 0.04 + i * 0.09, 0, 0.015, 0.06, 0.38, c, MAT.wood);
    B.box(W, 0, y + 0.01, 0, 0.55, 0.02, 0.38, c, MAT.wood);
    if (k === n - 1 && rng.chance(0.6)) for (let i = 0; i < 8; i++) B.sphere(W, rng.range(-0.2, 0.2), y + 0.24, rng.range(-0.13, 0.13), 0.05, 0.045, 0.05, lin(rng.pick(['#c84a28', '#e0a030', '#6a8a2a', '#d8c070'])), MAT.plastic, 7, 5);
  }
}
export function buildIceBox(kit, W, rng) {
  const { B } = kit;
  const c = jitter(lin(rng.pick(['#e8e6de', '#3f78b4', '#d9d2c0'])), rng, 0.05);
  B.box(W, 0, 0.21, 0, 0.62, 0.4, 0.38, c, MAT.plastic);
  B.box(W, 0, 0.43, 0, 0.64, 0.05, 0.4, mixc(c, lin('#ffffff'), 0.2), MAT.plastic);
  B.box(W, 0, 0.47, 0, 0.3, 0.03, 0.04, lin('#d8d8d0'), MAT.plastic);
}

// ---- round red postbox (Showa cylindrical type; no postal mark is drawn) ----
export function buildPostbox(kit, W, rng) {
  const { B, BA } = kit;
  const red = jitter(lin('#c22a1d'), rng, 0.04);
  B.box(W, 0, 0.05, 0, 0.5, 0.1, 0.5, lin('#8d8a83'), MAT.concrete);
  B.cyl(W, 0, 0.1, 0, 0.2, 0.08, mixc(red, [0, 0, 0], 0.25), MAT.metalPaint, 18);
  B.cyl(W, 0, 0.18, 0, 0.19, 0.92, red, MAT.paintGloss, 18);
  B.torus(W, mat4(0, 1.1, 0, 0, Math.PI / 2), 0.205, 0.09, red, MAT.paintGloss, 5, 18);
  B.add(prim.hemi(16, 5), mul(W, mat4(0, 1.1, 0, 0, 0, 0, 0.2, 0.09, 0.2)), red, MAT.paintGloss);
  B.sphere(W, 0, 1.2, 0, 0.03, 0.025, 0.03, red, MAT.paintGloss, 8, 5);
  // slot with hood on the front, and the collection-time plate below it
  B.box(W, 0, 0.9, 0.19, 0.2, 0.035, 0.03, lin('#141414'), MAT.rubber);
  B.box(W, 0, 0.935, 0.2, 0.24, 0.02, 0.06, red, MAT.paintGloss, 0, 0.25);
  B.box(W, 0, 0.6, 0.188, 0.14, 0.17, 0.012, lin('#e8e4d8'), MAT.enamel);
  for (let i = 0; i < 4; i++) B.box(W, 0, 0.66 - i * 0.035, 0.195, 0.1, 0.008, 0.004, lin('#333'), MAT.enamel);
  // rear door seam
  B.box(W, 0, 0.6, -0.191, 0.22, 0.5, 0.006, mixc(red, [0, 0, 0], 0.3), MAT.paintGloss);
}
