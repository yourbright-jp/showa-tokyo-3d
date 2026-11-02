import * as THREE from 'three';
import { MAT, lin, jitter, mat4, mul, mixc, prim, scalec } from './kit.js';
import { ATLAS } from './materials.js';

// Generic 1970s Japanese vehicles, no badges or brands (period-plausible-generic):
//  - utility bicycles (step-through and diamond frames, baskets, carriers, double stands)
//  - step-through 50 cc motorbikes with leg shields and rear carriers
//  - boxy sedans, taxis (roof lamp without lettering), one-box vans and light trucks
// Local frames: +x forward, +y up, +z to the vehicle's left; origin on the ground.

const CHROME = lin('#c4c7c8');
const TYRE = lin('#1b1b1a');
const BLACK = lin('#161616');

const BIKE_FRAME = ['#1a1a1a', '#1a1a1a', '#22301f', '#4a1d1d', '#1f2738', '#8f9493', '#d7cfb8', '#2f4f6a', '#6d2a35'];

function wheel(B, W, x, y, r, rng, { spokes = 18, tyreW = 0.022, rimCol = CHROME, hub = 0.03 } = {}) {
  // wheel in the local XY plane at (x,y)
  const M = mul(W, mat4(x, y, 0));
  B.torus(M, mat4(), r - tyreW * 0.6, tyreW / (r - tyreW * 0.6), TYRE, MAT.tyre, 6, 28);
  B.torus(M, mat4(), r - tyreW * 1.7, 0.009 / (r - tyreW * 1.7), rimCol, MAT.chrome, 4, 24);
  B.cyl(M, 0, 0, -0.045, hub, 0.09, CHROME, MAT.chrome, 8, 1, 0, Math.PI / 2);
  const rr = r - tyreW * 1.8;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + rng() * 0.05;
    const side = i % 2 ? 0.03 : -0.03;
    B.rod(M, [Math.cos(a + 0.2) * hub, Math.sin(a + 0.2) * hub, side], [Math.cos(a) * rr, Math.sin(a) * rr, 0], 0.0022, CHROME, MAT.steel, 3);
  }
}

/** Utility bicycle. o.stepThrough, o.basket, o.carrier, o.col (linear) */
export function buildBicycle(B, BA, W, rng, o = {}) {
  const frame = o.col || jitter(lin(rng.pick(BIKE_FRAME)), rng, 0.08);
  const step = o.stepThrough ?? rng.chance(0.55);
  const R = 0.33;
  const rear = [-0.54, R], front = [0.55, R];
  wheel(B, W, rear[0], rear[1], R, rng);
  wheel(B, W, front[0], front[1], R, rng);
  const bb = [-0.07, 0.28], st = [-0.24, 0.84], ht = [0.4, 0.86], hb = [0.45, 0.68];
  const tr = 0.017;
  const P = (p, z = 0) => [p[0], p[1], z];
  // seat tube, down tube, stays
  B.rod(W, P(bb), P(st), tr, frame, MAT.paintGloss, 6);
  if (step) {
    // twin curved down tubes (mixte / ladies frame)
    const curve = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6; curve.push([ht[0] + (bb[0] + 0.05 - ht[0]) * t - Math.sin(t * Math.PI) * 0.05, ht[1] + (bb[1] + 0.02 - ht[1]) * t - Math.sin(t * Math.PI) * 0.12, 0]); }
    B.tube(W, curve, tr * 1.1, frame, MAT.paintGloss, 6);
  } else {
    B.rod(W, P(st), P(ht), tr, frame, MAT.paintGloss, 6);
    B.rod(W, P(bb), P(hb), tr * 1.15, frame, MAT.paintGloss, 6);
  }
  for (const z of [-0.045, 0.045]) {
    B.rod(W, P(bb, z * 0.5), P(rear, z), 0.011, frame, MAT.paintGloss, 5);
    B.rod(W, P(st, z * 0.3), P(rear, z), 0.01, frame, MAT.paintGloss, 5);
  }
  // head tube + fork
  B.rod(W, P(hb), P(ht), 0.022, frame, MAT.paintGloss, 6);
  for (const z of [-0.04, 0.04]) B.rod(W, [hb[0], hb[1], z * 0.6], [front[0], front[1], z], 0.011, frame, MAT.paintGloss, 5);
  // saddle (sprung) + seat post
  B.rod(W, P(st), [st[0] - 0.03, st[1] + 0.1, 0], 0.012, CHROME, MAT.chrome, 6);
  const sc = rng.chance(0.7) ? BLACK : lin(rng.pick(['#5a3a24', '#3c2a20']));
  B.sphere(W, st[0] - 0.05, st[1] + 0.135, 0, 0.13, 0.045, 0.1, sc, MAT.rubber, 10, 6);
  B.sphere(W, st[0] + 0.07, st[1] + 0.13, 0, 0.07, 0.03, 0.04, sc, MAT.rubber, 8, 5);
  for (const z of [-0.05, 0.05]) B.torus(W, mat4(st[0] - 0.1, st[1] + 0.08, z, Math.PI / 2), 0.025, 0.25, CHROME, MAT.chrome, 4, 8);
  // stem + swept-back handlebar with grips and bell
  const stemTop = [ht[0] - 0.02, ht[1] + 0.16, 0];
  B.rod(W, P(ht), stemTop, 0.013, CHROME, MAT.chrome, 6);
  const hbar = [[-0.16, 0.0, -0.29], [-0.1, 0.02, -0.25], [-0.02, 0.02, -0.12], [0.02, 0.0, 0], [-0.02, 0.02, 0.12], [-0.1, 0.02, 0.25], [-0.16, 0.0, 0.29]].map(([a, b, c]) => [stemTop[0] + a, stemTop[1] + b, c]);
  B.tube(W, hbar, 0.011, CHROME, MAT.chrome, 5);
  for (const z of [-0.27, 0.27]) B.rod(W, [stemTop[0] - 0.13, stemTop[1] + 0.01, z], [stemTop[0] - 0.19, stemTop[1] - 0.005, z * 1.05], 0.017, BLACK, MAT.rubber, 6);
  B.sphere(W, stemTop[0] - 0.05, stemTop[1] + 0.04, 0.17, 0.028, 0.02, 0.028, CHROME, MAT.chrome, 8, 5);
  // fenders (chrome or frame colour)
  const fc = rng.chance(0.6) ? CHROME : frame;
  const fm = fc === CHROME ? MAT.chrome : MAT.paintGloss;
  B.add(prim.torus(0.07, 4, 14, Math.PI * 1.05), mul(W, mat4(rear[0], rear[1], 0, 0, 0, -0.15, R + 0.03, R + 0.03, (R + 0.03) * 0.5)), fc, fm);
  B.add(prim.torus(0.07, 4, 12, Math.PI * 0.95), mul(W, mat4(front[0], front[1], 0, 0, 0, 0.45, R + 0.03, R + 0.03, (R + 0.03) * 0.5)), fc, fm);
  // chain guard + crank + pedals
  B.box(W, (bb[0] + rear[0]) / 2, (bb[1] + rear[1]) / 2 + 0.02, -0.075, 0.5, 0.1, 0.01, frame, MAT.paintGloss, 0, 0, Math.atan2(rear[1] - bb[1], rear[0] - bb[0]) + Math.PI);
  B.cyl(W, bb[0], bb[1], -0.085, 0.09, 0.012, CHROME, MAT.chrome, 14, 1, 0, Math.PI / 2);
  const ca = rng.range(0, Math.PI * 2);
  for (const s of [-1, 1]) {
    const px = bb[0] + Math.cos(ca) * 0.16 * s, py = bb[1] + Math.sin(ca) * 0.16 * s;
    B.rod(W, [bb[0], bb[1], s * 0.09], [px, py, s * 0.1], 0.012, CHROME, MAT.chrome, 4);
    B.box(W, px, py, s * 0.15, 0.1, 0.025, 0.09, BLACK, MAT.rubber);
  }
  // rear carrier
  if (o.carrier ?? rng.chance(0.75)) {
    const cy = R + 0.4;
    for (const z of [-0.07, 0.07]) {
      B.rod(W, [rear[0] - 0.18, cy, z], [st[0] + 0.02, cy - 0.02, z * 0.6], 0.008, CHROME, MAT.chrome, 4);
      B.rod(W, [rear[0] - 0.05, cy, z], [rear[0], rear[1], z * 0.9], 0.007, CHROME, MAT.chrome, 4);
    }
    for (const x of [-0.7, -0.6, -0.5, -0.4]) B.rod(W, [x, cy, -0.075], [x, cy, 0.075], 0.006, CHROME, MAT.chrome, 4);
  }
  // front basket (wire mesh from the atlas, tinted)
  if (o.basket ?? rng.chance(0.65)) {
    const bx = front[0] + 0.12, by = 0.95, sx = 0.3, sy = 0.24, sz = 0.36;
    const bc = rng.chance(0.7) ? [0.85, 0.86, 0.86] : scalec(frame, 1.2);
    BA.quad(W, bx + sx / 2, by, 0, sz, sy, ATLAS.basket, bc, MAT.chrome, Math.PI / 2);
    BA.quad(W, bx - sx / 2, by, 0, sz, sy, ATLAS.basket, bc, MAT.chrome, Math.PI / 2);
    BA.quad(W, bx, by, sz / 2, sx, sy, ATLAS.basket, bc, MAT.chrome);
    BA.quad(W, bx, by, -sz / 2, sx, sy, ATLAS.basket, bc, MAT.chrome);
    BA.quad(W, bx, by - sy / 2, 0, sx, sz, ATLAS.basket, bc, MAT.chrome, 0, -Math.PI / 2);
    B.rod(W, [bx - sx / 2, by - 0.1, 0], [hb[0] + 0.05, hb[1] - 0.02, 0], 0.008, CHROME, MAT.chrome, 4);
    if (rng.chance(0.3)) B.box(W, bx, by - 0.05, 0.02, 0.2, 0.12, 0.22, lin(rng.pick(['#d9cfb8', '#8b6b4a', '#4b5f7a', '#e8e4dc'])), MAT.cloth, rng.range(-0.3, 0.3));
  }
  // dynamo lamp on the fork
  B.cyl(W, front[0] - 0.03, 0.66, 0.06, 0.035, 0.08, CHROME, MAT.chrome, 8, 0.9, 0, 0, -Math.PI / 2);
  // double stand (down)
  for (const z of [-0.07, 0.07]) B.rod(W, [rear[0], rear[1], z], [rear[0] - 0.22, 0.01, z * 1.6], 0.008, CHROME, MAT.steel, 4);
  B.rod(W, [rear[0] - 0.22, 0.012, -0.11], [rear[0] - 0.22, 0.012, 0.11], 0.008, CHROME, MAT.steel, 4);
}

let LEG = null;
function legShieldGeo() {
  if (LEG) return LEG;
  const pos = [], idx = [];
  const nu = 8, nv = 10;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = -1 + (2 * j) / nv;
    const x = 0.4 + (0.24 - 0.4) * u + 0.09 * v * v - 0.03 * Math.sin(u * Math.PI);
    const y = 0.9 + (0.34 - 0.9) * u;
    const z = v * (0.2 + 0.03 * Math.sin(u * Math.PI));
    pos.push(x, y, z);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  LEG = new THREE.BufferGeometry();
  LEG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  LEG.setIndex(idx);
  LEG.computeVertexNormals();
  return LEG;
}

const CUB_BODY = ['#2e5c9a', '#b3302a', '#2f6b4f', '#2b3b5c', '#8c2f2a', '#3d7a8a', '#c9a23a'];

/** Step-through 50 cc motorbike, generic. */
export function buildMotorbike(B, W, rng, o = {}) {
  const body = o.col || jitter(lin(rng.pick(CUB_BODY)), rng, 0.08);
  const shield = rng.chance(0.75) ? jitter(lin('#e9e6dc'), rng, 0.04) : body;
  const R = 0.28;
  const rear = [-0.6, R], front = [0.6, R];
  for (const p of [rear, front]) {
    wheel(B, W, p[0], p[1], R, rng, { spokes: 24, tyreW: 0.04, hub: 0.06 });
  }
  // front fork (leading link look) + deep front fender
  for (const z of [-0.07, 0.07]) B.rod(W, [0.42, 0.86, z], [front[0] + 0.02, front[1] + 0.02, z], 0.02, BLACK, MAT.metalPaint, 6);
  B.add(prim.torus(0.12, 5, 14, Math.PI * 0.9), mul(W, mat4(front[0], front[1], 0, 0, 0, 0.2, R + 0.05, R + 0.05, (R + 0.05) * 0.45)), shield, MAT.paintGloss);
  // leg shield: curved pressed panel from the steering head down to the step floor
  B.add(legShieldGeo(), W, shield, MAT.paintGloss);
  B.add(legShieldGeo(), W, shield, MAT.paintGloss, { flipNormals: true });
  // backbone + step floor
  B.tube(W, [[0.42, 0.86, 0], [0.3, 0.6, 0], [0.12, 0.34, 0], [-0.12, 0.3, 0]], 0.05, body, MAT.paintGloss, 8);
  B.box(W, 0.02, 0.31, 0, 0.42, 0.035, 0.3, BLACK, MAT.rubber);
  for (const z of [-0.1, -0.03, 0.04, 0.11]) B.box(W, 0.02, 0.33, z, 0.38, 0.01, 0.02, lin('#2a2a2a'), MAT.rubber);
  // engine: finned horizontal cylinder + crankcase, kick lever, exhaust
  B.box(W, -0.08, 0.2, 0, 0.28, 0.2, 0.2, lin('#7c7f7b'), MAT.steel);
  for (let i = 0; i < 6; i++) B.cyl(W, 0.07 + i * 0.03, 0.2, 0, 0.085 - i * 0.004, 0.012, lin('#9a9d98'), MAT.steel, 12, 1, 0, 0, -Math.PI / 2);
  B.cyl(W, 0.26, 0.2, 0, 0.05, 0.05, lin('#5f625e'), MAT.steel, 8, 1, 0, 0, -Math.PI / 2);
  B.rod(W, [-0.18, 0.24, -0.12], [-0.32, 0.12, -0.15], 0.012, lin('#333'), MAT.steel, 4);
  B.tube(W, [[0.27, 0.17, -0.04], [0.2, 0.1, -0.15], [-0.1, 0.13, -0.18], [-0.4, 0.22, -0.18], [-0.75, 0.3, -0.18]], 0.025, CHROME, MAT.chrome, 8);
  B.cyl(W, -0.6, 0.28, -0.18, 0.05, 0.42, CHROME, MAT.chrome, 10, 0.8, 0, 0, Math.PI / 2 + 0.12);
  // rear body under the seat + side covers
  B.sphere(W, -0.32, 0.58, 0, 0.3, 0.17, 0.135, body, MAT.paintGloss, 14, 8);
  B.box(W, -0.2, 0.47, 0, 0.32, 0.2, 0.24, body, MAT.paintGloss);
  B.box(W, -0.2, 0.47, 0.125, 0.22, 0.12, 0.01, mixc(body, lin('#ffffff'), 0.15), MAT.paintGloss);
  B.box(W, -0.6, 0.6, 0, 0.36, 0.06, 0.1, body, MAT.paintGloss, 0, 0, -0.25);
  // seat
  B.box(W, -0.35, 0.78, 0, 0.5, 0.08, 0.24, BLACK, MAT.rubber);
  B.sphere(W, -0.35, 0.82, 0, 0.26, 0.04, 0.12, BLACK, MAT.rubber, 10, 5);
  // rear carrier (black, large) with optional delivery box
  B.box(W, -0.78, 0.84, 0, 0.42, 0.025, 0.32, BLACK, MAT.metalPaint);
  for (const z of [-0.14, 0.14]) B.rod(W, [-0.6, 0.83, z], [-0.62, 0.42, z * 0.6], 0.01, BLACK, MAT.metalPaint, 4);
  if (o.box ?? rng.chance(0.35)) B.box(W, -0.8, 1.04, 0, 0.42, 0.38, 0.36, jitter(lin(rng.pick(['#d8d2c2', '#8d2a22', '#2e4a7a', '#9a9a92'])), rng, 0.06), MAT.paint);
  // rear fender + tail lamp
  B.add(prim.torus(0.1, 4, 12, Math.PI * 0.75), mul(W, mat4(rear[0], rear[1], 0, 0, 0, 0.55, R + 0.05, R + 0.05, (R + 0.05) * 0.4)), body, MAT.paintGloss);
  B.box(W, -0.96, 0.66, 0, 0.05, 0.06, 0.1, lin('#9c1c14'), MAT.lens, 0, 0, 0, { emit: [0.8, 0] });
  // handlebar with headlamp cowl, mirrors
  B.box(W, 0.44, 1.0, 0, 0.22, 0.13, 0.2, shield === body ? body : lin('#c9c6bd'), MAT.paintGloss);
  B.cyl(W, 0.56, 1.0, 0, 0.065, 0.04, CHROME, MAT.chrome, 12, 1, 0, 0, -Math.PI / 2);
  B.add(prim.sphere(10, 6), mul(W, mat4(0.585, 1.0, 0, 0, 0, 0, 0.012, 0.058, 0.058)), lin('#f2efe4'), MAT.lens, { emit: [1.2, 0] });
  B.tube(W, [[0.4, 1.02, -0.34], [0.43, 1.03, -0.15], [0.44, 1.04, 0], [0.43, 1.03, 0.15], [0.4, 1.02, 0.34]], 0.012, CHROME, MAT.chrome, 5);
  for (const z of [-0.32, 0.32]) {
    B.rod(W, [0.36, 1.02, z], [0.34, 1.02, z * 1.05], 0.02, BLACK, MAT.rubber, 6);
    B.rod(W, [0.42, 1.04, z * 0.75], [0.38, 1.3, z * 0.95], 0.006, CHROME, MAT.chrome, 4);
    B.cyl(W, 0.38, 1.3, z * 0.95, 0.045, 0.012, CHROME, MAT.chrome, 10, 1, 0, 0, Math.PI / 2);
  }
  // centre stand
  for (const z of [-0.09, 0.09]) B.rod(W, [-0.25, 0.22, z], [-0.32, 0.01, z * 1.3], 0.012, BLACK, MAT.steel, 4);
}

// ---------------------------------------------------------------------------------------------
const CAR_COLS = ['#e7e4da', '#ebe6d6', '#e2d7b9', '#9fb5c6', '#a8b59e', '#6a2c2a', '#2d3747', '#b8bbb8', '#7c5d3d', '#c4a64a', '#d9d4c6', '#556b55', '#efece4'];
const TAXI_SCHEMES = [['#2f5a3a', '#e8dfb8'], ['#e0a82e', '#2c2c2c'], ['#d9d2bd', '#a32b25'], ['#3a4f7a', '#e9e3d2'], ['#e57a2a', '#efe8d8']];

function carWheel(B, W, x, z, r, w, rng) {
  const M = mul(W, mat4(x, r, z));
  B.cyl(M, 0, 0, -w / 2, r, w, TYRE, MAT.tyre, 16, 1, 0, Math.PI / 2);
  const s = Math.sign(z);
  B.cyl(M, 0, 0, s > 0 ? w / 2 : -w / 2 - 0.012, r * 0.62, 0.012, CHROME, MAT.chrome, 14, 1, 0, Math.PI / 2);
  B.sphere(M, 0, 0, s * (w / 2 + 0.01), r * 0.25, r * 0.25, 0.03, CHROME, MAT.chrome, 10, 5);
}

/** Boxy 1970s sedan; o.taxi adds two-tone paint and a roof lamp. Length 4.5 m. */
export function buildSedan(B, BA, W, rng, o = {}) {
  const L = o.L || rng.range(4.25, 4.65), Wd = o.W || rng.range(1.6, 1.69);
  const hl = L / 2;
  let paint = jitter(lin(rng.pick(CAR_COLS)), rng, 0.05);
  let upper = paint;
  if (o.taxi) { const s = rng.pick(TAXI_SCHEMES); paint = lin(s[0]); upper = lin(s[1]); }
  const glass = lin('#1c2226');
  const r = 0.3, track = Wd / 2 - 0.065;
  // lower body (extruded side profile, slight bevel)
  const body = [[-hl, 0.3], [hl - 0.05, 0.3], [hl, 0.42], [hl + 0.02, 0.62], [hl - 0.08, 0.8], [0.95, 0.84], [-1.3, 0.87], [-hl + 0.06, 0.86], [-hl - 0.02, 0.66], [-hl, 0.42]];
  B.extrude(W, body, Wd, mat4(), paint, MAT.carPaint, { bevel: 0.03 });
  // upper body colour band for two-tone taxis
  if (o.taxi) B.extrude(W, [[hl - 0.1, 0.72], [hl - 0.06, 0.8], [0.95, 0.845], [-1.3, 0.875], [-hl + 0.07, 0.865], [-hl + 0.02, 0.72]], Wd + 0.01, mat4(), upper, MAT.carPaint);
  // greenhouse (dark glass) with narrower roof
  const gw = Wd - 0.18;
  B.extrude(W, [[-1.32, 0.86], [0.92, 0.86], [0.42, 1.3], [-0.98, 1.32], [-1.5, 0.88]], gw, mat4(), glass, MAT.glassDark);
  // roof panel + pillars in paint
  B.box(W, -0.27, 1.335, 0, 1.38, 0.035, gw - 0.04, upper, MAT.carPaint);
  for (const s of [-1, 1]) {
    const zz = s * (gw / 2 + 0.004);
    B.box(W, -0.28, 1.08, zz, 0.08, 0.48, 0.02, upper, MAT.carPaint, 0, 0, 0.08);         // B pillar
    B.rod(W, [0.9, 0.87, zz], [0.42, 1.31, zz], 0.035, upper, MAT.carPaint, 5);           // A pillar
    B.rod(W, [-1.45, 0.88, zz], [-0.98, 1.32, zz], 0.06, upper, MAT.carPaint, 5);         // C pillar
    // chrome window sill trim + door seams + handles
    B.box(W, -0.3, 0.875, s * (Wd / 2 + 0.003), 2.2, 0.018, 0.012, CHROME, MAT.chrome);
    B.box(W, 0.32, 0.6, s * (Wd / 2 + 0.002), 0.008, 0.52, 0.006, mixc(paint, [0, 0, 0], 0.5), MAT.carPaint);
    B.box(W, -0.62, 0.6, s * (Wd / 2 + 0.002), 0.008, 0.52, 0.006, mixc(paint, [0, 0, 0], 0.5), MAT.carPaint);
    B.box(W, 0.18, 0.74, s * (Wd / 2 + 0.012), 0.14, 0.025, 0.02, CHROME, MAT.chrome);
    B.box(W, -0.78, 0.74, s * (Wd / 2 + 0.012), 0.14, 0.025, 0.02, CHROME, MAT.chrome);
    // side moulding
    B.box(W, 0, 0.55, s * (Wd / 2 + 0.006), L - 0.3, 0.025, 0.012, CHROME, MAT.chrome);
    // wheel arch shadows
    for (const ax of [hl - 0.82, -hl + 0.8]) B.cyl(W, ax, r, s > 0 ? Wd / 2 + 0.002 : -Wd / 2 - 0.008, 0.37, 0.006, lin('#0c0c0c'), MAT.rubber, 16, 1, 0, Math.PI / 2);
    // fender mirror
    B.rod(W, [hl - 0.4, 0.83, s * (Wd / 2 - 0.12)], [hl - 0.42, 0.98, s * (Wd / 2 - 0.1)], 0.008, BLACK, MAT.metalPaint, 4);
    B.box(W, hl - 0.43, 1.0, s * (Wd / 2 - 0.1), 0.04, 0.06, 0.09, BLACK, MAT.metalPaint, s * 0.3);
  }
  // wheels
  for (const ax of [hl - 0.82, -hl + 0.8]) for (const s of [-1, 1]) carWheel(B, W, ax, s * track, r, 0.17, rng);
  // bumpers, grille, lamps, plates
  B.box(W, hl + 0.06, 0.4, 0, 0.1, 0.11, Wd + 0.04, CHROME, MAT.chrome);
  B.box(W, -hl - 0.06, 0.4, 0, 0.1, 0.11, Wd + 0.04, CHROME, MAT.chrome);
  BA.quad(W, hl + 0.025, 0.6, 0, Wd - 0.5, 0.2, ATLAS.grille, [1, 1, 1], MAT.chrome, Math.PI / 2);
  for (const s of [-1, 1]) {
    for (const dz of [0.0, 0.17]) {
      const z = s * (Wd / 2 - 0.13 - dz);
      B.cyl(W, hl + 0.01, 0.62, z, 0.07, 0.03, CHROME, MAT.chrome, 12, 1, 0, 0, -Math.PI / 2);
      B.add(prim.sphere(10, 6), mul(W, mat4(hl + 0.04, 0.62, z, 0, 0, 0, 0.012, 0.058, 0.058)), lin('#efeee6'), MAT.lens, { emit: [0.6, 0] });
    }
    B.box(W, -hl - 0.01, 0.66, s * (Wd / 2 - 0.2), 0.04, 0.12, 0.3, lin('#a6231a'), MAT.lens, 0, 0, 0, { emit: [0.4, 0] });
    B.box(W, hl + 0.0, 0.46, s * (Wd / 2 - 0.15), 0.04, 0.05, 0.14, lin('#e09a3a'), MAT.lens);
  }
  BA.quad(W, hl + 0.115, 0.4, 0, 0.33, 0.165, o.taxi ? ATLAS.plateTaxi : ATLAS.plateCar, [1, 1, 1], MAT.enamel, Math.PI / 2);
  BA.quad(W, -hl - 0.115, 0.43, 0, 0.33, 0.165, o.taxi ? ATLAS.plateTaxi : ATLAS.plateCar, [1, 1, 1], MAT.enamel, -Math.PI / 2);
  // underbody shadow block
  B.box(W, 0, 0.22, 0, L - 0.6, 0.12, Wd - 0.3, lin('#111'), MAT.rubber);
  if (o.taxi) {
    // roof lamp ("andon") without lettering + antenna
    const lc = lin(rng.pick(['#f0e9d6', '#efc35a', '#e8e2d0']));
    B.extrude(W, [[-0.16, 0], [0.16, 0], [0.12, 0.13], [-0.12, 0.13]], 0.42, mat4(-0.2, 1.355, 0, Math.PI / 2), lc, MAT.plastic);
    B.box(W, -0.2, 1.36, 0, 0.36, 0.02, 0.36, BLACK, MAT.rubber);
    B.rod(W, [-hl + 0.3, 0.86, -Wd / 2 + 0.15], [-hl + 0.1, 1.6, -Wd / 2 + 0.15], 0.004, CHROME, MAT.chrome, 3);
  }
  return { L, W: Wd };
}

/** One-box 1970s van (the R08 type). Length ~4.3 m. */
export function buildVan(B, BA, W, rng) {
  const L = 4.3, Wd = 1.69, hl = L / 2;
  const paint = jitter(lin(rng.pick(['#ebe8de', '#e9e3d0', '#d5d9d6', '#9fb3c3', '#efece4'])), rng, 0.04);
  const glass = lin('#1b2125');
  const prof = [[-hl, 0.32], [hl - 0.05, 0.32], [hl + 0.02, 0.5], [hl + 0.02, 1.02], [hl - 0.25, 1.86], [-hl + 0.05, 1.9], [-hl - 0.02, 1.8], [-hl - 0.02, 0.42]];
  B.extrude(W, prof, Wd, mat4(), paint, MAT.carPaint, { bevel: 0.04 });
  // windscreen + side windows (dark glass panels on the surface)
  B.box(W, hl - 0.1, 1.43, 0, 0.02, 0.62, Wd - 0.2, glass, MAT.glassDark, 0, 0, 0.36);
  for (const s of [-1, 1]) {
    B.box(W, hl - 0.5, 1.45, s * (Wd / 2 + 0.005), 0.75, 0.55, 0.01, glass, MAT.glassDark);
    B.box(W, -0.35, 1.47, s * (Wd / 2 + 0.005), 1.9, 0.5, 0.01, glass, MAT.glassDark);
    B.box(W, 0, 1.12, s * (Wd / 2 + 0.006), L - 0.2, 0.02, 0.012, CHROME, MAT.chrome);
    B.box(W, 0.95, 0.75, s * (Wd / 2 + 0.003), 0.008, 0.85, 0.006, mixc(paint, [0, 0, 0], 0.45), MAT.carPaint);
    B.box(W, -0.15, 0.82, s * (Wd / 2 + 0.003), 0.008, 0.9, 0.006, mixc(paint, [0, 0, 0], 0.45), MAT.carPaint);
    for (const ax of [hl - 0.55, -hl + 0.75]) B.cyl(W, ax, 0.31, s > 0 ? Wd / 2 + 0.002 : -Wd / 2 - 0.008, 0.36, 0.006, lin('#0c0c0c'), MAT.rubber, 16, 1, 0, Math.PI / 2);
    B.rod(W, [hl - 0.05, 1.0, s * (Wd / 2 - 0.05)], [hl + 0.05, 1.2, s * (Wd / 2 + 0.06)], 0.008, BLACK, MAT.metalPaint, 4);
    B.box(W, hl + 0.06, 1.22, s * (Wd / 2 + 0.08), 0.04, 0.14, 0.1, BLACK, MAT.metalPaint);
    B.cyl(W, hl + 0.01, 0.75, s * (Wd / 2 - 0.22), 0.085, 0.03, CHROME, MAT.chrome, 12, 1, 0, 0, -Math.PI / 2);
    B.add(prim.sphere(10, 6), mul(W, mat4(hl + 0.035, 0.75, s * (Wd / 2 - 0.22), 0, 0, 0, 0.012, 0.07, 0.07)), lin('#efeee6'), MAT.lens, { emit: [0.6, 0] });
    B.box(W, -hl - 0.03, 0.8, s * (Wd / 2 - 0.12), 0.04, 0.24, 0.12, lin('#a6231a'), MAT.lens);
  }
  B.box(W, -hl - 0.03, 1.32, 0, 0.012, 0.42, Wd - 0.4, glass, MAT.glassDark);
  for (const ax of [hl - 0.55, -hl + 0.75]) for (const s of [-1, 1]) carWheel(B, W, ax, s * (Wd / 2 - 0.07), 0.3, 0.18, rng);
  B.box(W, hl + 0.07, 0.42, 0, 0.1, 0.12, Wd + 0.02, lin('#9a9c9a'), MAT.chrome);
  B.box(W, -hl - 0.07, 0.42, 0, 0.1, 0.12, Wd + 0.02, lin('#9a9c9a'), MAT.chrome);
  BA.quad(W, hl + 0.03, 0.62, 0, Wd - 0.6, 0.16, ATLAS.grille, [1, 1, 1], MAT.chrome, Math.PI / 2);
  BA.quad(W, hl + 0.125, 0.42, 0, 0.33, 0.165, ATLAS.plateCar, [1, 1, 1], MAT.enamel, Math.PI / 2);
  BA.quad(W, -hl - 0.125, 0.5, 0, 0.33, 0.165, ATLAS.plateCar, [1, 1, 1], MAT.enamel, -Math.PI / 2);
  B.box(W, 0, 0.24, 0, L - 0.6, 0.12, Wd - 0.3, lin('#111'), MAT.rubber);
  if (rng.chance(0.5)) {
    // roof rack
    for (const s of [-1, 1]) B.box(W, -0.2, 1.97, s * (Wd / 2 - 0.08), 2.4, 0.03, 0.03, BLACK, MAT.metalPaint);
    for (let x = -1.3; x <= 0.9; x += 0.55) B.box(W, x, 1.97, 0, 0.03, 0.03, Wd - 0.16, BLACK, MAT.metalPaint);
  }
  return { L, W: Wd };
}

/** Light truck: cab-over with a flat bed and drop sides. Length ~3.9 m. */
export function buildTruck(B, BA, W, rng) {
  const L = 3.9, Wd = 1.6, hl = L / 2;
  const paint = jitter(lin(rng.pick(['#e8e5db', '#a9b6bd', '#d8cf9a', '#7d9aaa'])), rng, 0.05);
  const glass = lin('#1b2125');
  B.extrude(W, [[hl - 1.4, 0.4], [hl, 0.4], [hl + 0.02, 1.0], [hl - 0.25, 1.78], [hl - 1.4, 1.8]], Wd, mat4(), paint, MAT.carPaint, { bevel: 0.035 });
  B.box(W, hl - 0.1, 1.38, 0, 0.02, 0.56, Wd - 0.2, glass, MAT.glassDark, 0, 0, 0.36);
  for (const s of [-1, 1]) {
    B.box(W, hl - 0.6, 1.42, s * (Wd / 2 + 0.005), 0.7, 0.5, 0.01, glass, MAT.glassDark);
    B.cyl(W, hl + 0.01, 0.72, s * (Wd / 2 - 0.2), 0.08, 0.03, CHROME, MAT.chrome, 12, 1, 0, 0, -Math.PI / 2);
  }
  // bed
  const bedCol = mixc(paint, lin('#8a8a84'), 0.4);
  B.box(W, -0.55, 0.62, 0, 2.5, 0.06, Wd, lin('#3b3125'), MAT.wood);
  for (const s of [-1, 1]) B.box(W, -0.55, 0.85, s * (Wd / 2 - 0.02), 2.5, 0.4, 0.04, bedCol, MAT.metalPaint);
  B.box(W, -hl + 0.02, 0.85, 0, 0.04, 0.4, Wd, bedCol, MAT.metalPaint);
  B.box(W, hl - 1.42, 1.0, 0, 0.05, 0.7, Wd, bedCol, MAT.metalPaint);
  if (rng.chance(0.6)) for (let i = 0; i < 4; i++) B.box(W, -1.3 + i * 0.5, 0.8 + rng.range(0, 0.1), rng.range(-0.4, 0.4), 0.4, 0.3, 0.45, lin(rng.pick(['#b08a5a', '#c9a77a', '#6a7f8a'])), MAT.cardboard, rng.range(-0.3, 0.3));
  for (const ax of [hl - 0.5, -hl + 0.7]) for (const s of [-1, 1]) carWheel(B, W, ax, s * (Wd / 2 - 0.06), 0.29, 0.16, rng);
  B.box(W, 0, 0.3, 0, L - 0.6, 0.14, Wd - 0.3, lin('#111'), MAT.rubber);
  B.box(W, hl + 0.06, 0.45, 0, 0.08, 0.1, Wd, lin('#9a9c9a'), MAT.chrome);
  BA.quad(W, hl + 0.105, 0.45, 0, 0.33, 0.165, ATLAS.plateCar, [1, 1, 1], MAT.enamel, Math.PI / 2);
  BA.quad(W, -hl - 0.03, 0.6, 0, 0.33, 0.165, ATLAS.plateCar, [1, 1, 1], MAT.enamel, -Math.PI / 2);
  return { L, W: Wd };
}

/** Cars queued at the crossing on the main road south of the entrance (never in Ichibangai). */
export function placeTraffic(ctx, kit) {
  const { B, BA, BS, site, streets, D } = kit;
  const M = streets.main;
  const stats = { cars: 0, rejected: 0 };
  const footprints = [];
  const rng = ctx.rng('streetprops/cars');
  // lanes: eastbound (north half, heading +e) stop west of the crossing; westbound mirror.
  const lanes = [
    { s: 13.7, dir: 1, start: -11.5 }, { s: 16.9, dir: 1, start: -10.8 }, { s: 20.1, dir: 1, start: -12.4 },
    { s: 23.6, dir: -1, start: 12.6 }, { s: 26.8, dir: -1, start: 11.9 }, { s: 30.0, dir: -1, start: 13.4 },
  ];
  const kinds = ['sedan', 'sedan', 'taxi', 'sedan', 'van', 'taxi', 'sedan', 'truck', 'sedan', 'taxi'];
  let k = 0;
  for (const lane of lanes) {
    let E = lane.start;
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const kind = kinds[(k++ + rng.int(0, 3)) % kinds.length];
      const len = kind === 'van' ? 4.3 : kind === 'truck' ? 3.9 : 4.5;
      const cE = E - lane.dir * len / 2;
      const [x, z] = M.toWorld(cE, lane.s + rng.range(-0.15, 0.15));
      const ry = Math.atan2(lane.dir * M.e[0], lane.dir * M.e[1]) - Math.PI / 2 + rng.range(-0.015, 0.015);
      // local +x is forward: heading such that +x maps to dir*e
      if (!site.footprintClear(x, z, len / 2 + 0.1, 0.9, ry, { h: 1.6, wall: 0.8, corridor: 2.4 })) { stats.rejected++; E -= lane.dir * (len + 1.5); continue; }
      const g = site.groundUnder(x, z, len / 2, 0.8, ry);
      const W = mat4(x, (g.lo + g.hi) / 2, z, ry);
      B.setGround((g.lo + g.hi) / 2, 0.35, 0.5);
      const crng = ctx.rng(`streetprops/car/${lane.s}/${i}`);
      let dims;
      if (kind === 'van') dims = buildVan(B, BA, W, crng);
      else if (kind === 'truck') dims = buildTruck(B, BA, W, crng);
      else dims = buildSedan(B, BA, W, crng, { taxi: kind === 'taxi' });
      site.markBox(x, z, len / 2, 0.85, ry, g.lo, g.lo + 1.8);
      D.add(site, x, z, len / 2 + 0.35, 1.05, ry, 0.75);
      footprints.push({ x, z, r: len / 2, kind: `car-${kind}` });
      stats.cars++;
      E -= lane.dir * (len + crng.range(1.2, 2.6));
    }
  }
  // a taxi pulled in at the north kerb west of the crossing, and a van east of it
  for (const [E, s, kind, dir] of [[-24, 13.0, 'taxi', 1], [24, 13.0, 'van', 1]]) {
    const [x, z] = M.toWorld(E, s);
    const ry = Math.atan2(dir * M.e[0], dir * M.e[1]) - Math.PI / 2;
    if (!site.footprintClear(x, z, 2.35, 0.9, ry, { h: 1.6, wall: 0.8, corridor: 2.4 })) { stats.rejected++; continue; }
    const g = site.groundUnder(x, z, 2.2, 0.8, ry);
    const W = mat4(x, (g.lo + g.hi) / 2, z, ry);
    B.setGround((g.lo + g.hi) / 2, 0.35, 0.5);
    const crng = ctx.rng(`streetprops/car/kerb/${E}`);
    if (kind === 'van') buildVan(B, BA, W, crng); else buildSedan(B, BA, W, crng, { taxi: true });
    site.markBox(x, z, 2.3, 0.85, ry, g.lo, g.lo + 1.8);
    D.add(site, x, z, 2.6, 1.05, ry, 0.75);
    footprints.push({ x, z, r: 2.3, kind: `car-${kind}` });
    stats.cars++;
  }
  ctx.tag({ id: 'streetprops/cars', module: 'streetprops', tier: 'period-plausible-generic', note: `${stats.cars} generic 1970s sedans/taxis/vans/light trucks without badges or roof-lamp lettering, stopped at the assumed crossing on the main road south of the entrance (left-hand traffic). None inside Ichibangai.` });
  return { footprints, stats };
}
