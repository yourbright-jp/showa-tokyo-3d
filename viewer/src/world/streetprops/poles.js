import { MAT, lin, jitter, mat4, mul, sagWire, mixc, prim } from './kit.js';
import { ATLAS } from './materials.js';

// Concrete utility poles with crossarms, porcelain insulators, pole transformers, telephone
// cable, pole-mounted security lamps, pole advertisement plates and sagging overhead wires.
// Generic Showa-period Tokyo distribution practice (period-plausible-generic): pole positions,
// heights and line topology are production estimates, not a survey of 1976 poles.

const CONCRETE = lin('#a8a49b');
const GALV = lin('#8d918f');
const PORCELAIN = lin('#d9d6cc');
const WIRE = lin('#262624');
const CABLE = lin('#151515');
const TRANSFORMER = lin('#7f8786');

const INSULATOR = [[0.012, 0], [0.03, 0.015], [0.07, 0.04], [0.074, 0.055], [0.04, 0.07], [0.058, 0.095], [0.06, 0.105], [0.032, 0.125], [0.028, 0.15], [0, 0.152]];
const SPOOL = [[0.02, 0], [0.045, 0.005], [0.045, 0.02], [0.03, 0.03], [0.03, 0.06], [0.045, 0.07], [0.045, 0.085], [0.02, 0.09], [0, 0.09]];

/** World point of local (x,y,z) in frame W. */
function wp(W, x, y, z) {
  const e = W.elements;
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
}

/**
 * Build one concrete pole. Local frame: origin at ground on the pole axis, +z towards the
 * street (crossarms cantilever along +z), +x along the street.
 * Returns attachment points in world coordinates.
 */
export function buildUtilityPole(B, A, o) {
  const { x, z, gy, ry, H, rng } = o;
  const W = mat4(x, gy, z, ry);
  B.setGround(gy, 0.5, 0.5);
  const r0 = 0.175, r1 = 0.098;
  const rAt = (y) => r0 + (r1 - r0) * (y / H);
  const col = jitter(CONCRETE, rng, 0.07);
  B.cyl(W, 0, -0.4, 0, r0 + 0.003, H + 0.4, col, MAT.concrete, 12, r1 / (r0 + 0.003));
  B.cyl(W, 0, H - 0.02, 0, r1, 0.06, mixc(col, [0.2, 0.2, 0.2], 0.3), MAT.concrete, 12, 0.6);
  // pasted poster remnants / old wrap bands
  const nb = rng.int(1, 3);
  for (let i = 0; i < nb; i++) {
    const y = rng.range(1.2, 2.6), h = rng.range(0.15, 0.55);
    const c = rng.pick([lin('#d8cfb4'), lin('#c9b8a0'), lin('#b9c3c9'), lin('#c79a8a'), lin('#e1dccb')]);
    B.cyl(W, 0, y, 0, rAt(y) + 0.004, h, jitter(c, rng, 0.1), MAT.cardboard, 12, 1, rng.range(0, 6.28));
  }
  // step bolts, alternating sides along the street axis
  for (let y = 1.9, k = 0; y < H - 0.9; y += 0.42, k++) {
    const s = k % 2 ? 1 : -1;
    const r = rAt(y);
    B.rod(W, [s * r * 0.8, y, 0], [s * (r + 0.2), y + 0.02, 0], 0.011, GALV, MAT.steel, 4);
  }
  const out = { hv: [], lv: [], tel: null, rack: [], lamp: null, W, H };
  // HV crossarm (cantilevered towards the street)
  const arms = [];
  if (o.hv) arms.push({ y: H - 0.32, offs: o.hv, kind: 'hv' });
  if (o.lv) arms.push({ y: H - 1.45, offs: o.lv, kind: 'lv' });
  for (const arm of arms) {
    const zmin = Math.min(-0.22, ...arm.offs) - 0.12, zmax = Math.max(0.22, ...arm.offs) + 0.12;
    const len = zmax - zmin;
    B.box(W, 0, arm.y, (zmin + zmax) / 2, 0.075, 0.075, len, jitter(GALV, rng, 0.06), MAT.galv);
    // band clamp
    B.cyl(W, 0, arm.y - 0.06, 0, rAt(arm.y) + 0.012, 0.12, GALV, MAT.galv, 10);
    // brace(s)
    if (zmax > 0.6) B.rod(W, [0, arm.y - 0.85, rAt(arm.y - 0.85)], [0, arm.y - 0.04, zmax * 0.62], 0.016, GALV, MAT.galv, 4);
    if (zmin < -0.6) B.rod(W, [0, arm.y - 0.85, -rAt(arm.y - 0.85)], [0, arm.y - 0.04, zmin * 0.62], 0.016, GALV, MAT.galv, 4);
    for (const oz of arm.offs) {
      const prof = arm.kind === 'hv' ? INSULATOR : SPOOL;
      B.lathe(W, 0, arm.y + 0.038, oz, prof, jitter(PORCELAIN, rng, 0.05), MAT.porcelain, 10);
      const top = wp(W, 0, arm.y + 0.038 + (arm.kind === 'hv' ? 0.15 : 0.09), oz);
      out[arm.kind].push(top);
    }
  }
  // low-voltage rack (vertical spool insulators) used for service drops
  if (o.rack) {
    const yr = H - 2.25;
    B.box(W, 0, yr, rAt(yr) + 0.05, 0.05, 0.6, 0.04, GALV, MAT.galv);
    for (let k = 0; k < 3; k++) {
      const yy = yr - 0.22 + k * 0.22;
      B.lathe(W, 0, yy - 0.045, rAt(yr) + 0.12, SPOOL, PORCELAIN, MAT.porcelain, 8);
      out.rack.push(wp(W, 0, yy, rAt(yr) + 0.16));
    }
  }
  // pole transformer(s)
  if (o.transformer) {
    const yt = H - 2.8;
    const n = o.transformer;
    for (let k = 0; k < n; k++) {
      const sx = (k === 0 ? 1 : -1) * (rAt(yt) + 0.3);
      const tc = jitter(TRANSFORMER, rng, 0.08);
      B.box(W, sx * 0.55, yt + 0.25, 0, 0.42, 0.06, 0.08, GALV, MAT.galv);
      B.cyl(W, sx, yt - 0.15, 0, 0.23, 0.78, tc, MAT.metalPaint, 14);
      B.cyl(W, sx, yt + 0.63, 0, 0.245, 0.05, tc, MAT.metalPaint, 14);
      B.cyl(W, sx, yt - 0.18, 0, 0.2, 0.04, mixc(tc, [0, 0, 0], 0.3), MAT.metalPaint, 14);
      // cooling ribs
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2;
        B.box(W, sx + Math.cos(a) * 0.235, yt + 0.22, Math.sin(a) * 0.235, 0.03, 0.62, 0.03, tc, MAT.metalPaint, -a);
      }
      // bushings + leads up to the HV line
      for (let b = -1; b <= 1; b += 2) {
        B.lathe(W, sx + b * 0.09, yt + 0.68, 0, SPOOL.map(([r, y]) => [r * 0.8, y * 1.3]), PORCELAIN, MAT.porcelain, 8);
        if (out.hv.length) {
          const a = wp(W, sx + b * 0.09, yt + 0.8, 0);
          const t = out.hv[Math.min(out.hv.length - 1, b < 0 ? 0 : 1)];
          o.wireBatch.tube(mat4(), sagWire(a, t, 0.08, 6), 0.008, WIRE, MAT.rubber, 3, { ao: false });
        }
      }
    }
  }
  // telephone cable bracket
  if (o.tel) {
    const yt = H - 3.2;
    B.box(W, 0, yt, o.tel / 2, 0.05, 0.05, o.tel + 0.1, GALV, MAT.galv);
    B.cyl(W, 0, yt - 0.06, 0, rAt(yt) + 0.012, 0.12, GALV, MAT.galv, 10);
    out.tel = wp(W, 0, yt - 0.05, o.tel);
    out.telLocal = [0, yt - 0.05, o.tel];
  }
  // pole-mounted security lamp (fluorescent, white cover)
  if (o.lamp) {
    const yl = o.lampY || 5.0;
    const r = rAt(yl);
    B.cyl(W, 0, yl - 0.08, 0, r + 0.012, 0.16, GALV, MAT.galv, 10);
    B.tube(W, [[0, yl, r], [0, yl + 0.18, 0.45], [0, yl + 0.26, 0.95]], 0.022, GALV, MAT.galv, 5);
    B.box(W, 0, yl + 0.24, 1.08, 0.16, 0.09, 0.62, lin('#e9e6dc'), MAT.enamel);
    B.add(prim.box(), mul(W, mat4(0, yl + 0.18, 1.08, 0, 0, 0, 0.07, 0.04, 0.54)), lin('#fff4e0'), MAT.lens, { emit: [2.6, 0.0] });
    out.lamp = wp(W, 0, yl + 0.15, 1.08);
  }
  // enamel pole tag and optional advertisement plate
  A.quad(W, 0, 2.05, rAt(2.05) + 0.006, 0.11, 0.15, ATLAS.poleTag, [1, 1, 1], MAT.enamel);
  if (o.hydrant) {
    // red fire-hydrant indicator plate facing the street
    const y = 2.35, r = rAt(y);
    B.box(W, 0, y, r + 0.02, 0.2, 0.52, 0.012, lin('#b3261e'), MAT.enamel);
    A.quad(W, 0, y, r + 0.027, 0.18, 0.48, ATLAS.hydrant, [1, 1, 1], MAT.enamel);
    B.cyl(W, 0, y + 0.18, 0, r + 0.01, 0.03, GALV, MAT.galv, 10);
    B.cyl(W, 0, y - 0.18, 0, r + 0.01, 0.03, GALV, MAT.galv, 10);
  }
  if (o.ad) {
    const y = rng.range(2.4, 2.9), h = 1.1, zc = rAt(y) + 0.22;
    B.box(W, 0, y + h / 2 - 0.05, rAt(y) + 0.04, 0.03, 0.02, 0.1, GALV, MAT.galv);
    B.box(W, 0, y - h / 2 + 0.05, rAt(y) + 0.04, 0.03, 0.02, 0.1, GALV, MAT.galv);
    B.box(W, 0, y, zc, 0.012, h + 0.02, 0.33, lin('#d9d5c8'), MAT.enamel);
    A.quad(W, 0.008, y, zc, 0.31, h, ATLAS[o.ad], [1, 1, 1], MAT.enamel, Math.PI / 2);
    A.quad(W, -0.008, y, zc, 0.31, h, ATLAS[o.ad], [1, 1, 1], MAT.enamel, -Math.PI / 2);
  }
  return out;
}


/** Tall steel street light with a curved arm and a flat mercury-lamp head (main road). */
export function buildArmStreetLight(B, o) {
  const { x, z, gy, ry, rng } = o;
  const W = mat4(x, gy, z, ry);
  B.setGround(gy, 0.4, 0.5);
  const H = o.H || 8.2;
  const col = jitter(lin('#8e9490'), rng, 0.06);
  B.cyl(W, 0, 0, 0, 0.16, 0.5, col, MAT.metalPaint, 10, 0.75);
  B.cyl(W, 0, 0.5, 0, 0.09, H - 0.5, col, MAT.metalPaint, 10, 0.62);
  const arm = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const a = t * Math.PI / 2;
    arm.push([0, H - 0.6 + Math.sin(a) * 0.6 + t * 0.15, (1 - Math.cos(a)) * 0.6 + t * 1.6]);
  }
  B.tube(W, arm, 0.045, col, MAT.metalPaint, 6);
  const end = arm[arm.length - 1];
  B.sphere(W, 0, end[1] - 0.02, end[2] + 0.35, 0.2, 0.08, 0.42, col, MAT.metalPaint, 10, 6);
  B.add(prim.sphere(10, 5), mul(W, mat4(0, end[1] - 0.08, end[2] + 0.35, 0, 0, 0, 0.16, 0.05, 0.34)), lin('#f3efe6'), MAT.lens, { emit: [3.0, 0.0] });
  return { lamp: wp(W, 0, end[1] - 0.1, end[2] + 0.35) };
}

/** Service drop from a pole point to a facade point (with a wall insulator). */
function serviceDrop(site, BW, B, a, f, t, h, rng) {
  const ax = f.a[0] + (f.b[0] - f.a[0]) * t, az = f.a[1] + (f.b[1] - f.a[1]) * t;
  const ex = ax + f.normal[0] * 0.16, ez = az + f.normal[1] * 0.16;
  const gy = site.groundAt(ax + f.normal[0] * 0.5, az + f.normal[1] * 0.5);
  const b = [ex, gy + h, ez];
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const pts = sagWire(a, b, 0.05 + L * 0.012, Math.max(6, Math.ceil(L / 1.2)));
  if (!site.pathFree(pts, 0, 0.75, 0.25)) return false;
  BW.tube(mat4(), pts, 0.0075, WIRE, MAT.rubber, 3, { ao: false });
  // wall bracket + spool insulator
  const ang = Math.atan2(f.normal[0], f.normal[1]);
  const W = mat4(ax, gy + h, az, ang);
  B.setGround(-1e9);
  B.box(W, 0, 0, 0.07, 0.03, 0.03, 0.14, GALV, MAT.galv);
  B.lathe(W, 0, -0.045, 0.16, SPOOL.map(([r, y]) => [r * 0.8, y * 0.9]), PORCELAIN, MAT.porcelain, 6);
  site.markPath(pts);
  return true;
}

function spanWires(site, BW, aPts, bPts, r, sagK, col = WIRE, stats) {
  for (let i = 0; i < Math.min(aPts.length, bPts.length); i++) {
    const a = aPts[i], b = bPts[i];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const pts = sagWire(a, b, 0.05 + sagK * L * L, Math.max(10, Math.ceil(L / 1.0)));
    if (!site.pathFree(pts, 0, 0.75, 0.75)) { stats.blockedSpans++; continue; }
    BW.tube(mat4(), pts, r, col, MAT.rubber, r > 0.015 ? 5 : 3, { ao: false });
    site.markPath(pts);
    stats.spans++;
  }
}

/** Facades near a point that can receive service drops. */
function dropTargets(facades, x, z, rmin, rmax) {
  const out = [];
  for (const f of facades) {
    const d = Math.hypot(f.mid[0] - x, f.mid[1] - z);
    if (d < rmin || d > rmax || f.length < 2.5) continue;
    // facade must face the pole
    const vx = x - f.mid[0], vz = z - f.mid[1];
    if (vx * f.normal[0] + vz * f.normal[1] < 0.5) continue;
    out.push(f);
  }
  return out;
}

export function buildPoleNetwork(ctx, site, streets, B, BW, A) {
  const rng = ctx.rng('streetprops/poles');
  const stats = { poles: 0, spans: 0, blockedSpans: 0, drops: 0, moved: 0, skipped: 0 };
  const footprints = [];
  const landmarkIds = new Set(ctx.data.buildings.filter((b) => b.landmark).map((b) => b.id));
  const facades = ctx.data.facades.filter((f) => !landmarkIds.has(f.buildingId));

  /** Find a pole spot near route arc s on a side; returns {x,z,ry,gy,wallD} or null. */
  function polePlace(s, side, H, wallOff = 0.62) {
    for (const ds of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6]) {
      const p = streets.routeAt(s + ds);
      const rx = side > 0 ? -p.dz : p.dz, rz = side > 0 ? p.dx : -p.dx;
      const d = streets.rayToWall(p.x, p.z, rx, rz, 9);
      if (!isFinite(d) || d < 3.2) continue;
      for (const off of [wallOff, 1.75]) {
        const x = p.x + rx * (d - off), z = p.z + rz * (d - off);
        if (site.routeDistance(x, z) < 1.6) continue;
        if (site.obstacleDistance(x, z, 1.5) < 0.8) continue;
        if (site.wallDistance(x, z, 1) < 0.4) continue;
        const gy = site.groundAt(x, z);
        if (!site.boxFree(x, z, 0.22, 0.22, 0, gy + 0.2, gy + H)) continue;
        if (ds !== 0 || off !== wallOff) stats.moved++;
        return { x, z, gy, ry: Math.atan2(-rx, -rz), wallD: off, along: [p.dx, p.dz] };
      }
    }
    stats.skipped++;
    return null;
  }

  const adPool = ['poleAdA', 'poleAdB', 'poleAdC', 'poleAdD'];
  // ---- Ichibangai east-side distribution line ----
  const east = [];
  for (const s of [19, 48, 78, 107, 137]) {
    const H = 11.2 + rng.range(-0.3, 0.5);
    const pl = polePlace(s, +1, H);
    if (!pl) continue;
    const prng = ctx.rng(`streetprops/pole/east/${s}`);
    const k = pl.wallD < 1 ? 0 : -1.0; // offsets relative to the pole, outward to the street
    const res = buildUtilityPole(B, A, {
      ...pl, H, rng: prng, wireBatch: BW,
      hv: [1.2 + k, 1.7 + k, 2.2 + k], lv: [1.0 + k, 1.45 + k, 1.9 + k], rack: true, tel: pl.wallD < 1 ? 0.95 : 0.35,
      transformer: east.length === 1 || east.length === 3 ? 1 : 0, lamp: true, lampY: 4.9 + prng.range(-0.2, 0.3),
      ad: east.length !== 2 && prng.chance(0.75) ? adPool[east.length % adPool.length] : null, hydrant: east.length === 2,
    });
    site.markBox(pl.x, pl.z, 0.25, 0.25, 0, pl.gy, pl.gy + H);
    footprints.push({ x: pl.x, z: pl.z, r: 0.3, kind: 'utility-pole' });
    east.push({ ...pl, ...res });
    stats.poles++;
  }
  // ---- west-side lighter poles (telephone + drops + lamp) ----
  const west = [];
  for (const s of [33, 63, 93, 122]) {
    const H = 9.4 + rng.range(-0.3, 0.4);
    const pl = polePlace(s, -1, H);
    if (!pl) continue;
    const prng = ctx.rng(`streetprops/pole/west/${s}`);
    const k = pl.wallD < 1 ? 0 : -1.0;
    const res = buildUtilityPole(B, A, {
      ...pl, H, rng: prng, wireBatch: BW,
      lv: [1.05 + k, 1.6 + k], rack: true, tel: pl.wallD < 1 ? 0.95 : 0.35, lamp: true, lampY: 4.8 + prng.range(-0.2, 0.3),
      ad: prng.chance(0.6) ? adPool[(west.length + 2) % adPool.length] : null,
    });
    site.markBox(pl.x, pl.z, 0.25, 0.25, 0, pl.gy, pl.gy + H);
    footprints.push({ x: pl.x, z: pl.z, r: 0.3, kind: 'utility-pole' });
    west.push({ ...pl, ...res });
    stats.poles++;
  }

  // ---- main road north kerb line ----
  const M = streets.main;
  const mains = [];
  for (const E of [-46, -17, 17, 45]) {
    const [x, z] = M.toWorld(E, M.kerbS - 0.45);
    if (site.wallDistance(x, z, 1) < 0.5 || site.routeDistance(x, z) < 2) { stats.skipped++; continue; }
    const gy = site.groundAt(x, z);
    const prng = ctx.rng(`streetprops/pole/main/${E}`);
    const H = 12.0 + prng.range(-0.3, 0.4);
    const ry = Math.atan2(M.S[0], M.S[1]);
    const res = buildUtilityPole(B, A, {
      x, z, gy, ry, H, rng: prng, wireBatch: BW,
      hv: [-0.9, 0.0001, 0.9], lv: [-0.75, 0.0001, 0.75], rack: true, tel: -0.45, transformer: E === 17 ? 2 : 0,
      ad: prng.chance(0.5) ? adPool[(mains.length + 1) % adPool.length] : null,
    });
    site.markBox(x, z, 0.25, 0.25, 0, gy, gy + H);
    footprints.push({ x, z, r: 0.3, kind: 'utility-pole' });
    mains.push({ x, z, gy, H, ry, E, ...res });
    stats.poles++;
  }

  // ---- wires ----
  const chain = (list, key, r, sag) => { for (let i = 0; i + 1 < list.length; i++) spanWires(site, BW, list[i][key], list[i + 1][key], r, sag, WIRE, stats); };
  chain(east, 'hv', 0.0105, 0.0006);
  chain(east, 'lv', 0.0105, 0.0008);
  chain(mains, 'hv', 0.011, 0.0005);
  chain(mains, 'lv', 0.011, 0.0007);
  west.length && chain(west, 'lv', 0.0095, 0.0008);
  const telChain = (list) => { for (let i = 0; i + 1 < list.length; i++) if (list[i].tel && list[i + 1].tel) spanWires(site, BW, [list[i].tel], [list[i + 1].tel], 0.021, 0.0009, CABLE, stats); };
  telChain(east); telChain(west); telChain(mains);
  // main road -> Ichibangai feeder (LV + telephone) over the entrance, above the gate
  const feed = mains.find((m) => m.E === 17);
  if (feed && east[0]) {
    spanWires(site, BW, feed.lv.slice(0, 2), east[0].lv.slice(0, 2), 0.0105, 0.0007, WIRE, stats);
    if (feed.tel && east[0].tel) spanWires(site, BW, [feed.tel], [east[0].tel], 0.02, 0.0008, CABLE, stats);
  }
  // street crossings: each west pole takes LV from the nearest east pole
  for (const w of west) {
    let best = null, bd = Infinity;
    for (const e of east) { const d = Math.hypot(e.x - w.x, e.z - w.z); if (d < bd) { bd = d; best = e; } }
    if (best && bd < 26) spanWires(site, BW, best.rack.slice(0, 2), w.lv.slice(0, 2), 0.009, 0.0009, WIRE, stats);
  }

  // ---- service drops to facades ----
  const allPoles = [...east, ...west, ...mains];
  for (const p of allPoles) {
    const prng = ctx.rng(`streetprops/drops/${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    const cand = dropTargets(facades, p.x, p.z, 3, 17).filter((f) => f.topY - f.baseY > 5);
    const n = Math.min(cand.length, prng.int(3, 6));
    for (let i = 0; i < n; i++) {
      const f = cand.splice(prng.int(0, cand.length - 1), 1)[0];
      const from = p.rack.length ? p.rack[i % p.rack.length] : p.lv[i % p.lv.length];
      if (!from) continue;
      const maxH = Math.min(f.topY - f.baseY - 0.8, 8.5);
      for (let tries = 0; tries < 3; tries++) {
        const ok = serviceDrop(site, BW, B, from, f, prng.range(0.15, 0.85), prng.range(4.8, Math.max(5, maxH)), prng);
        if (ok) { stats.drops++; break; }
      }
    }
  }
  ctx.tag({ id: 'streetprops/utility-poles', module: 'streetprops', tier: 'period-plausible-generic', note: `${stats.poles} concrete poles, crossarms, insulators, transformers, security lamps and overhead wires; topology and positions are production estimates (Showa-era Tokyo practice; R04/R08 wire density), not surveyed 1976 poles.` });
  return { stats, footprints, poles: allPoles };
}
