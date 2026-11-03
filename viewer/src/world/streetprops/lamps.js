import { MAT, lin, jitter, mat4, mixc, prim, mul } from './kit.js';

// Ichibangai shopping-street lamps: steel pole, arched crossbar with two chrome bell shades and
// frosted bulbs. Modelled on the decorative street lamps visible in R08 (generated colour master
// of a 1972 source photograph); the 1976 design and spacing are not documented, so the set is
// period-plausible-generic. r04: the ribbon streamers and artificial-flower cluster seen in that
// 1972 view were a temporary/seasonal street decoration (docs/research/r02-gate-evidence.md,
// constraint 6) and are no longer permanent: they are an optional layer (viewer ?decor=1972).

const BELL = [[0, 0.33], [0.05, 0.325], [0.13, 0.3], [0.22, 0.24], [0.29, 0.15], [0.335, 0.06], [0.36, 0.0], [0.385, -0.035], [0.37, -0.045], [0.33, -0.01], [0.3, 0.05], [0.0, 0.08]];
const RIBBON_COLS = ['#e86f9a', '#f4a6c0', '#5b8fd6', '#f2d24b', '#f5f2ea', '#61b07a', '#e4572e', '#9b6fc9'];
const FLOWER_COLS = ['#f3a3bf', '#f7c4d4', '#ee86aa', '#fbe1ea', '#f19ab6'];

export function buildStreetLamp(B, o) {
  const { x, z, gy, ry, rng } = o;
  const W = mat4(x, gy, z, ry);
  B.setGround(gy, 0.35, 0.5);
  const poleCol = jitter(lin(rng.pick(['#b7bab5', '#c9c4b4', '#a9aeae'])), rng, 0.05);
  const H = 4.55 + rng.range(-0.08, 0.1);
  // base + pole
  B.lathe(W, 0, 0, 0, [[0.17, 0], [0.17, 0.06], [0.13, 0.1], [0.12, 0.32], [0.09, 0.4], [0.075, 0.46], [0, 0.46]], mixc(poleCol, [0.1, 0.1, 0.1], 0.35), MAT.metalPaint, 12);
  B.cyl(W, 0, 0.44, 0, 0.068, H - 0.44, poleCol, MAT.metalPaint, 10, 0.82);
  // decorative collar
  B.cyl(W, 0, 2.6, 0, 0.085, 0.07, poleCol, MAT.metalPaint, 10);
  // arched crossbar along local x
  const bar = [];
  for (let k = 0; k <= 8; k++) { const t = -1 + (2 * k) / 8; bar.push([t * 0.64, H + 0.05 + (1 - t * t) * -0.06 + Math.abs(t) * 0.04, 0]); }
  B.tube(W, bar, 0.032, poleCol, MAT.metalPaint, 6);
  B.sphere(W, 0, H + 0.12, 0, 0.06, 0.06, 0.06, poleCol, MAT.metalPaint, 8, 6);
  B.rod(W, [0, H + 0.12, 0], [0, H + 0.38, 0], 0.012, poleCol, MAT.metalPaint, 5);
  B.sphere(W, 0, H + 0.4, 0, 0.035, 0.035, 0.035, lin('#d7b85a'), MAT.chrome, 8, 6);
  const heads = [];
  const chrome = lin('#a7abad');
  for (const sx of [-0.64, 0.64]) {
    const hy = H + 0.12;
    B.rod(W, [sx, H + 0.06, 0], [sx, hy + 0.06, 0], 0.02, poleCol, MAT.metalPaint, 5);
    B.lathe(W, sx, hy, 0, BELL, chrome, [0.24, 1.0, 0.4], 18);
    B.sphere(W, sx, hy + 0.35, 0, 0.03, 0.03, 0.03, chrome, MAT.chrome, 8, 6);
    // frosted bulb
    B.add(prim.sphere(10, 8), mul(W, mat4(sx, hy - 0.08, 0, 0, 0, 0, 0.1, 0.11, 0.1)), lin('#fff3dc'), MAT.lens, { emit: [4.0, 0.0] });
    heads.push([sx, hy]);
    // ribbon streamers hanging from the rim (optional 1972 temporary-decoration layer)
    const n = rng.int(6, 9) * (o.decor ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = rng.range(0.6, 1.25);
      const cx = sx + Math.cos(a) * 0.33, cz = Math.sin(a) * 0.33;
      const col = jitter(lin(rng.pick(RIBBON_COLS)), rng, 0.1);
      // two segments with a slight outward kink (hangs and flutters)
      const kx = Math.cos(a) * rng.range(0.02, 0.08), kz = Math.sin(a) * rng.range(0.02, 0.08);
      B.box(W, cx + kx * 0.5, hy - 0.05 - len * 0.25, cz + kz * 0.5, 0.05, len * 0.5, 0.006, col, MAT.cloth, a + Math.PI / 2, kz * 2, -kx * 2);
      B.box(W, cx + kx * 1.4, hy - 0.05 - len * 0.75, cz + kz * 1.4, 0.05, len * 0.5, 0.006, col, MAT.cloth, a + Math.PI / 2, -kz * 1.5, kx * 1.5);
    }
  }
  // artificial flower cluster around the pole (spring decoration)
  if (o.decor && o.flowers) {
    const fy = rng.range(3.0, 3.4);
    for (let i = 0; i < 18; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.07, 0.2), y = fy + rng.range(-0.25, 0.25);
      const s = rng.range(0.045, 0.075);
      B.add(prim.ico(0), mul(W, mat4(Math.cos(a) * r, y, Math.sin(a) * r, rng.range(0, 6), rng.range(0, 6), 0, s, s * 0.8, s)), jitter(lin(rng.pick(FLOWER_COLS)), rng, 0.08), MAT.cloth);
    }
    for (let i = 0; i < 8; i++) {
      const a = rng.range(0, Math.PI * 2), y = fy + rng.range(-0.3, 0.3);
      B.box(W, Math.cos(a) * 0.16, y, Math.sin(a) * 0.16, 0.12, 0.012, 0.05, jitter(lin('#4f7f3c'), rng, 0.1), MAT.leaf, -a, 0, rng.range(-0.5, 0.5));
    }
  }
  return { heads: heads.map(([sx, hy]) => { const e = W.elements; return [e[0] * sx + e[12], e[13] + hy, e[2] * sx + e[14]]; }) };
}

export function placeStreetLamps(ctx, site, streets, B, avoid) {
  const stats = { lamps: 0, skipped: 0 };
  const footprints = [];
  const slots = [];
  for (let s = 15, k = 0; s < 146; s += 9.5, k++) slots.push({ s, side: k % 2 ? -1 : 1 });
  for (const slot of slots) {
    let placed = false;
    for (const ds of [0, 1.2, -1.2, 2.4, -2.4]) {
      const p = streets.routeAt(slot.s + ds);
      const rx = slot.side > 0 ? -p.dz : p.dz, rz = slot.side > 0 ? p.dx : -p.dx;
      const d = streets.rayToWall(p.x, p.z, rx, rz, 9);
      if (!isFinite(d) || d < 4.2 || d > 8) continue;
      const off = 2.15;
      const x = p.x + rx * (d - off), z = p.z + rz * (d - off);
      if (site.inPlaza(x, z) || site.routeDistance(x, z) < 1.55) continue;
      if (site.obstacleDistance(x, z, 2) < 1.2) continue;
      if (avoid.some((f) => Math.hypot(f.x - x, f.z - z) < 2.6)) continue;
      const gy = site.groundAt(x, z);
      const ry = Math.atan2(-rx, -rz);
      if (!site.boxFree(x, z, 0.2, 0.2, ry, gy + 0.2, gy + 3.1)) continue;
      if (!site.boxFree(x, z, 1.05, 0.45, ry, gy + 3.1, gy + 5.2)) continue;
      const rng = ctx.rng(`streetprops/lamp/${slot.s}`);
      buildStreetLamp(B, { x, z, gy, ry, rng, flowers: rng.chance(0.85), decor: !!(ctx.options && ctx.options.decor1972) });
      site.markBox(x, z, 0.2, 0.2, ry, gy, gy + 3.1);
      site.markBox(x, z, 1.05, 0.45, ry, gy + 3.1, gy + 5.2);
      footprints.push({ x, z, r: 0.25, kind: 'street-lamp' });
      stats.lamps++; placed = true; break;
    }
    if (!placed) stats.skipped++;
  }
  ctx.tag({ id: 'streetprops/ichibangai-lamps', module: 'streetprops', tier: 'period-plausible-generic', note: `${stats.lamps} twin chrome-bell shopping-street lamps after R08 (generated master of a 1972 photo); 1976 design and spacing undocumented; 1972 temporary streamers/flowers ${ctx.options && ctx.options.decor1972 ? 'ON (optional layer)' : 'off (not treated as permanent)'}. Not placed in the plaza (adopted plaza lamps).` });
  return { stats, footprints };
}
