import { mat4, mul } from './kit.js';
import { buildBicycle, buildMotorbike } from './vehicles.js';
import {
  buildPhoneBooth, buildVending, buildBin, buildCrateStack, buildCardboard, buildPlants,
  buildStool, buildBucket, buildBroom, buildGasCylinders, buildAshtray, buildWoodCrates, buildIceBox, buildPostbox,
} from './clutter.js';

// Places clutter along shop frontages (Ichibangai, the plaza edge and the main-road block near
// the entrance) and a few singletons (phone booths, plaza bins). Each item is tested against the
// 1.2 m walk corridor, building walls, adopted obstacles and occupied voxels (signage standing
// signs/awnings, landmark furniture) before it is built. Selection is deterministic per facade id.

/**
 * Item catalogue: w = width along the wall, d = depth from the wall, h = height,
 * gap = distance from the wall line, wt = weight per context.
 */
const ITEMS = {
  bikes: { w: 0, d: 1.95, h: 1.15, gap: 0.3, wt: { street: 4.6, entrance: 6, plaza: 1.6, main: 4 } },
  bikeParallel: { w: 1.85, d: 0.62, h: 1.15, gap: 0.42, wt: { street: 1.4, entrance: 1.5, plaza: 0.8, main: 1.5 } },
  motorbike: { w: 1.95, d: 0.72, h: 1.3, gap: 0.42, wt: { street: 1.8, entrance: 1.8, plaza: 0.6, main: 1.8 } },
  crates: { w: 0.98, d: 0.4, h: 1.5, gap: 0.4, wt: { street: 1.6, entrance: 0.8, plaza: 0.6, main: 0.6 } },
  bins: { w: 0.62, d: 0.6, h: 0.75, gap: 0.4, wt: { street: 1.5, entrance: 1.0, plaza: 1.0, main: 0.8 } },
  plants: { w: 1.3, d: 0.5, h: 1.4, gap: 0.4, wt: { street: 1.4, entrance: 0.7, plaza: 0.8, main: 0.5 } },
  vending: { w: 0.98, d: 0.72, h: 1.85, gap: 0.38, wt: { street: 0.75, entrance: 0.9, plaza: 1.2, main: 0.9 } },
  cardboard: { w: 0.75, d: 0.5, h: 1.0, gap: 0.4, wt: { street: 0.8, entrance: 0.4, plaza: 0.3, main: 0.4 } },
  misc: { w: 0.8, d: 0.45, h: 1.3, gap: 0.4, wt: { street: 1.3, entrance: 0.5, plaza: 0.4, main: 0.5 } },
  ashtray: { w: 0.36, d: 0.36, h: 0.72, gap: 0.5, wt: { street: 0.5, entrance: 0.5, plaza: 0.6, main: 0.4 } },
};

function pickWeighted(rng, ctxName, counts) {
  let tot = 0;
  const entries = [];
  for (const [k, v] of Object.entries(ITEMS)) {
    let w = v.wt[ctxName] || 0;
    if (k === 'vending' && counts.vending >= 9) w = 0;
    if (k === 'motorbike' && counts.motorbike >= 9) w = 0;
    entries.push([k, w]); tot += w;
  }
  let r = rng() * tot;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

/** Frame for a two-wheeler: origin on the ground between the wheel contacts, pitched to the slope. */
function groundedFrame(site, x, z, heading, half, lean) {
  const cx = Math.cos(heading), sx = -Math.sin(heading);
  const gF = site.groundAt(x + cx * half, z + sx * half), gR = site.groundAt(x - cx * half, z - sx * half);
  const pitch = Math.atan2(gF - gR, 2 * half);
  return mat4(x, (gF + gR) / 2, z, heading, lean, pitch);
}

export function placeFrontage(ctx, kit) {
  const { site, D } = kit;
  const data = ctx.data;
  const landmarkIds = new Set(data.buildings.filter((b) => b.landmark).map((b) => b.id));
  const M = kit.streets.main;
  const counts = { vending: 0, motorbike: 0, bikes: 0, items: 0, rejected: 0 };
  const footprints = [];
  const placed = (x, z, hx, hz, ry, gy, h, kind, alpha = 0.6) => {
    site.markBox(x, z, hx, hz, ry, gy, gy + h);
    D.add(site, x, z, hx + 0.22, hz + 0.22, ry, alpha);
    footprints.push({ x, z, r: Math.max(hx, hz), kind });
    counts.items++;
  };

  // eligible facades
  const fronts = [];
  for (const f of data.facades) {
    if (landmarkIds.has(f.buildingId) || f.length < 1.6) continue;
    const mx = f.mid[0], mz = f.mid[1];
    const toRoute = site.routeDistance(mx, mz);
    // facing test: the route must lie in front of the facade
    const px = mx + f.normal[0] * 3, pz = mz + f.normal[1] * 3;
    const facing = site.routeDistance(px, pz) < toRoute - 1.5;
    const [E, s] = M.toLocal(mx, mz);
    let kind = null;
    if (f.inPlaza && toRoute < 40) kind = 'plaza';
    else if (toRoute < 8.5 && facing && f.streetFacing) kind = (mz > 40 ? 'entrance' : 'street');
    else if (Math.abs(E) < 45 && s > -3 && s < 3 && f.normal[0] * M.S[0] + f.normal[1] * M.S[1] > 0.8) kind = 'main';
    if (!kind) continue;
    fronts.push({ f, kind });
  }
  fronts.sort((a, b) => (a.f.id < b.f.id ? -1 : 1));

  for (const { f, kind } of fronts) {
    const rng = ctx.rng(`streetprops/front/${f.id}`);
    if (rng.chance(kind === 'plaza' ? 0.45 : 0.12)) continue; // some frontages stay clear
    const tx = (f.b[0] - f.a[0]) / f.length, tz = (f.b[1] - f.a[1]) / f.length;
    const nx = f.normal[0], nz = f.normal[1];
    const ryWall = Math.atan2(nx, nz); // local +z -> street
    const gyAt = (x, z) => site.groundAt(x, z);
    let cur = 0.35 + rng.range(0, 1.2);
    const end = f.length - 0.35;
    let guard = 0;
    while (cur < end && guard++ < 40) {
      const type = pickWeighted(rng, kind, counts);
      const it = ITEMS[type];
      let w = it.w, d = it.d;
      let nb = 1;
      if (type === 'bikes') { nb = rng.int(1, kind === 'plaza' ? 3 : 5); w = 0.62 * nb; }
      if (type === 'vending') { nb = rng.chance(0.4) ? 2 : 1; w = it.w * nb; }
      if (type === 'plants') { nb = rng.int(1, 4); w = nb * 0.45; }
      if (cur + w > end) { cur += 0.5; continue; }
      const along = cur + w / 2;
      const off = it.gap + d / 2;
      const cx = f.a[0] + tx * along + nx * off, cz = f.a[1] + tz * along + nz * off;
      // footprint as a box aligned with the wall
      if (!site.footprintClear(cx, cz, w / 2, d / 2, ryWall, { h: it.h, wall: Math.max(0.1, Math.min(0.34, it.gap - 0.05)) })) {
        counts.rejected++; cur += 0.45; continue;
      }
      const gy = gyAt(cx, cz);
      const irng = ctx.rng(`streetprops/item/${f.id}/${cur.toFixed(2)}`);
      const B = kit.B;
      B.setGround(gy, 0.3, 0.5); kit.BS.setGround(gy, 0.3, 0.5); kit.BA.setGround(gy, 0.3, 0.5); kit.BF.setGround(gy, 0.2, 0.6);
      if (type === 'bikes') {
        // perpendicular to the wall, front wheel towards the shop, slight random angles
        for (let i = 0; i < nb; i++) {
          const a0 = along - w / 2 + 0.31 + i * 0.62 + irng.range(-0.07, 0.07);
          const rev = irng.chance(0.22); // some parked rear-wheel first
          const depth = it.gap + (rev ? 1.02 : 0.92) + irng.range(-0.08, 0.1);
          const bx = f.a[0] + tx * a0 + nx * depth, bz = f.a[1] + tz * a0 + nz * depth;
          const heading = Math.atan2(nz, -nx) + (rev ? Math.PI : 0) + irng.range(-0.26, 0.26); // local +x -> -normal
          const W = groundedFrame(site, bx, bz, heading, 0.55, irng.range(-0.025, 0.025));
          buildBicycle(B, kit.BA, W, irng, {});
          counts.bikes++;
        }
        placed(cx, cz, w / 2, d / 2, ryWall, gy, it.h, 'bicycles', 0.5);
      } else if (type === 'bikeParallel' || type === 'motorbike') {
        const heading = Math.atan2(-tz, tx) + (irng.chance(0.5) ? Math.PI : 0) + irng.range(-0.06, 0.06);
        const W = groundedFrame(site, cx, cz, heading, 0.6, irng.range(-0.03, 0.03));
        if (type === 'motorbike') { buildMotorbike(B, W, irng); counts.motorbike++; } else { buildBicycle(B, kit.BA, W, irng, {}); counts.bikes++; }
        placed(cx, cz, w / 2, d / 2, ryWall, gy, it.h, type, 0.55);
      } else if (type === 'vending') {
        for (let i = 0; i < nb; i++) {
          const a0 = along - w / 2 + it.w / 2 + i * it.w;
          const vx = f.a[0] + tx * a0 + nx * off, vz = f.a[1] + tz * a0 + nz * off;
          const vt = irng.pick(['cig', 'drinkRed', 'drinkBlue', 'cig', 'drinkRed']);
          buildVending(kit, mat4(vx, site.groundAt(vx, vz), vz, ryWall), irng, vt);
          counts.vending++;
        }
        placed(cx, cz, w / 2, d / 2, ryWall, gy, it.h, 'vending', 0.7);
      } else {
        const W = mat4(cx, gy, cz, ryWall + irng.range(-0.08, 0.08));
        if (type === 'crates') buildCrateStack(kit, W, irng, 2);
        else if (type === 'bins') buildBin(kit, W, irng, kind === 'plaza' && irng.chance(0.6) ? 'concreteCyl' : irng.pick(['poly', 'poly', 'dustbin']));
        else if (type === 'plants') buildPlants(kit, W, irng, nb);
        else if (type === 'cardboard') buildCardboard(kit, W, irng);
        else if (type === 'ashtray') buildAshtray(kit, W, irng);
        else {
          const m = irng.pick(['stool', 'bucket', 'broom', 'gas', 'woodcrates', 'icebox', 'stoolbucket']);
          if (m === 'stool') buildStool(kit, W, irng);
          else if (m === 'bucket') buildBucket(kit, W, irng);
          else if (m === 'broom') { buildBroom(kit, mul(W, mat4(0, 0, -0.12)), irng); buildBucket(kit, mul(W, mat4(0.3, 0, 0)), irng); }
          else if (m === 'gas') buildGasCylinders(kit, W, irng);
          else if (m === 'woodcrates') buildWoodCrates(kit, W, irng);
          else if (m === 'icebox') buildIceBox(kit, W, irng);
          else { buildStool(kit, mul(W, mat4(-0.2, 0, 0)), irng); buildBucket(kit, mul(W, mat4(0.25, 0, 0)), irng); }
        }
        placed(cx, cz, w / 2, d / 2, ryWall, gy, it.h, type, type === 'ashtray' ? 0.45 : 0.6);
      }
      cur += w + rng.range(0.3, kind === 'plaza' ? 4.5 : 2.6);
    }
  }
  ctx.tag({ id: 'streetprops/frontage', module: 'streetprops', tier: 'period-plausible-generic', note: `${counts.items} shop-front groups (${counts.bikes} bicycles, ${counts.motorbike} step-through motorbikes, ${counts.vending} vending machines, crates, bins, plants, cardboard, stools, buckets, propane cylinders). Generic period clutter; no documented 1976 positions.` });
  return { footprints, counts };
}

/** Singletons with anchor candidates: phone booths and freestanding plaza bins. */
export function placeSingletons(ctx, kit) {
  const { site, D } = kit;
  const footprints = [];
  const stats = { booths: 0, plazaBins: 0 };
  const M = kit.streets.main;
  const tryPlace = (cands, hx, hz, h, build, kind, opts = {}) => {
    for (const [x, z, ry] of cands) {
      if (!site.footprintClear(x, z, hx, hz, ry, { h, ...opts })) continue;
      const gy = site.groundAt(x, z);
      kit.B.setGround(gy, 0.3, 0.5); kit.BS.setGround(gy, 0.3, 0.5); kit.BA.setGround(gy, 0.3, 0.5);
      build(mat4(x, gy, z, ry), ctx.rng(`streetprops/${kind}/${x.toFixed(1)},${z.toFixed(1)}`));
      site.markBox(x, z, hx, hz, ry, gy, gy + h);
      D.add(site, x, z, hx + 0.25, hz + 0.25, ry, 0.65);
      footprints.push({ x, z, r: Math.max(hx, hz), kind });
      return true;
    }
    return false;
  };
  // phone booth on the main-road sidewalk west of the gate (faces the road)
  const yawS = Math.atan2(M.S[0], M.S[1]);
  const mainCands = [];
  for (const E of [-13.5, -15, -17, -11.5]) { const [x, z] = M.toWorld(E, 1.25); mainCands.push([x, z, yawS]); }
  if (tryPlace(mainCands, 0.5, 0.5, 2.65, (W, r) => buildPhoneBooth(kit, W, r), 'phone-booth')) stats.booths++;
  // phone booth in Ichibangai near the cross street (east side), facing the street
  const streetCands = [];
  for (const s of [88, 84, 92, 80, 96]) {
    const p = kit.streets.routeAt(s);
    const rx = -p.dz, rz = p.dx;
    const d = kit.streets.rayToWall(p.x, p.z, rx, rz, 9);
    if (!isFinite(d)) continue;
    streetCands.push([p.x + rx * (d - 0.62), p.z + rz * (d - 0.62), Math.atan2(-rx, -rz)]);
  }
  if (tryPlace(streetCands, 0.5, 0.5, 2.65, (W, r) => buildPhoneBooth(kit, W, r), 'phone-booth', { wall: 0.1 })) stats.booths++;
  // plaza: a phone booth and concrete bins near the Ichibangai exit and the fountain
  // r04: prefer the Ichibangai-exit side; the first r02 spot read as standing in front of the Koma doors
  const plazaBooth = [[-57.5, -60.5, 0.6], [-42.5, -64.5, -0.4], [-39.0, -71.5, -Math.PI / 2], [-40.2, -81.0, -Math.PI / 2], [-41.0, -86.0, -Math.PI / 2]];
  if (tryPlace(plazaBooth, 0.5, 0.5, 2.65, (W, r) => buildPhoneBooth(kit, W, r), 'phone-booth')) stats.booths++;
  // a concrete bin beside each adopted plaza lamp (R02 shows bins at the lamp foot)
  for (const f of ctx.data.fixtures.filter((q) => /^plaza-lamp-.*-base$/.test(q.id))) {
    const pts = f.polygons.flat();
    const lx = pts.reduce((a, q) => a + q[0], 0) / pts.length, lz = pts.reduce((a, q) => a + q[2], 0) / pts.length;
    const cands = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.4; cands.push([lx + Math.cos(a) * 1.05, lz + Math.sin(a) * 1.05, a]); }
    cands.sort((p, q) => site.routeDistance(q[0], q[1]) - site.routeDistance(p[0], p[1]));
    if (tryPlace(cands, 0.32, 0.32, 0.8, (W, r) => buildBin(kit, W, r, 'concreteCyl'), 'plaza-bin')) stats.plazaBins++;
  }
  for (const c of [[-53.5, -70.5, 0.3], [-49.8, -79.0, 1.1], [-56.5, -93.5, 0.2], [-45.5, -73.5, 0.7], [-60.5, -68.2, 0.5]]) {
    if (stats.plazaBins >= 5) break;
    const type = 'concreteBox';
    if (tryPlace([c], 0.34, 0.34, 0.8, (W, r) => buildBin(kit, W, r, type), 'plaza-bin')) stats.plazaBins++;
  }
  // round postboxes: main-road sidewalk near the booth, and one inside Ichibangai
  stats.postboxes = 0;
  const pbMain = [];
  // round d: east of the old spot; seen from across the road the red postbox stood behind a parked car
  // and read as an emergency-vehicle roof lamp
  for (const E of [-9.5, -22, -20.5, -19]) { const [x, z] = M.toWorld(E, 1.0); pbMain.push([x, z, yawS]); }
  if (tryPlace(pbMain, 0.26, 0.26, 1.25, (W, r) => buildPostbox(kit, W, r), 'postbox')) stats.postboxes++;
  const pbStreet = [];
  for (const s of [58, 55, 61, 52, 64]) {
    const p = kit.streets.routeAt(s);
    const rx = -p.dz, rz = p.dx;
    const d = kit.streets.rayToWall(p.x, p.z, rx, rz, 9);
    if (!isFinite(d)) continue;
    pbStreet.push([p.x + rx * (d - 0.6), p.z + rz * (d - 0.6), Math.atan2(-rx, -rz)]);
  }
  if (tryPlace(pbStreet, 0.26, 0.26, 1.25, (W, r) => buildPostbox(kit, W, r), 'postbox', { wall: 0.3 })) stats.postboxes++;
  ctx.tag({ id: 'streetprops/singletons', module: 'streetprops', tier: 'period-plausible-generic', note: `${stats.booths} generic phone booths (cream frame, red roof, 電話 sign; no operator logo) and ${stats.plazaBins} concrete plaza bins (R02 type with generic くず入れ label), ${stats.postboxes} round red postboxes (Showa cylindrical type, no postal mark drawn). Positions are production estimates.` });
  return { footprints, stats };
}
