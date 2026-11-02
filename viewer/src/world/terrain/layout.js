// World-space layout of ground features, derived from the adopted data:
//  - surface classes follow the adopted rule used for `period-ground-surface`
//    (paving inside plaza/connector/forecourt polygons, else asphalt inside a road polygon,
//    else ground). Here the same polygons are sampled per texel instead of per TIN centroid.
//  - road edges, the arterial (main road) building line and sidewalk/kerb lines are derived
//    from the modern road polygons (modern reference, not 1976 survey).
//  - gutters, kerbs, manholes, patches, stains and markings are period-plausible generic
//    placements from keyed RNG streams; none is a documented 1976 object.
import { ringXZ, RingSet, signedArea, segDist } from './util.js';

const SIDEWALK_W = 5.0; // assumed arterial sidewalk width (period-plausible estimate)

export function buildLayout(ctx) {
  const D = ctx.data;
  const rng = (k) => ctx.rng(`terrain/${k}`);

  // ---------------------------------------------------------------- classes
  const roadRings = D.roads.map((r) => ringXZ(r.polygon)).filter((r) => r.length >= 3);
  const roads = new RingSet(roadRings);
  const plazaRing = ringXZ(D.plaza.boundary_m);
  const surfaces = (D.decisions.routeSurfaces && D.decisions.routeSurfaces.connector_surfaces) || [];
  const connectorRings = [];
  let forecourtRing = null;
  for (const s of surfaces) {
    if (!s.boundary_m) continue;
    const r = ringXZ(s.boundary_m);
    if (s.id === 'koma-entrance-forecourt-paving') forecourtRing = r; else connectorRings.push(r);
  }
  const plazaSet = new RingSet([plazaRing, ...connectorRings]);
  const foreSet = new RingSet(forecourtRing ? [forecourtRing] : []);
  const buildingRings = D.buildings.map((b) => b.footprint);
  const buildings = new RingSet(buildingRings);
  const obstacleRings = (D.obstacles || []).map((o) => o.footprint_xz).filter(Boolean);
  const obstacles = new RingSet(obstacleRings);

  /** adopted class: 'paving' | 'asphalt' | 'ground' */
  const classify = (x, z) => (plazaSet.has(x, z) || foreSet.has(x, z) ? 'paving' : roads.has(x, z) ? 'asphalt' : 'ground');
  /** visual pattern (paving split into plaza flags / forecourt flags) */
  const pattern = (x, z) => (foreSet.has(x, z) ? 'forecourt' : plazaSet.has(x, z) ? 'plaza' : roads.has(x, z) ? 'asphalt' : 'ground');

  // ---------------------------------------------------------------- road edges
  const extEdges = [];
  roadRings.forEach((ring, ri) => {
    const ccw = signedArea(ring) > 0; // (x,z) CCW: outward normal = (dz, -dx)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      if (L < 0.8) continue;
      let nx = dz / L, nz = -dx / L;
      if (!ccw) { nx = -nx; nz = -nz; }
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (roads.has(mx + nx * 0.6, mz + nz * 0.6)) continue;
      if (!roads.has(mx - nx * 0.6, mz - nz * 0.6)) continue;
      extEdges.push({ ri, a, b, L, nx, nz, ux: dx / L, uz: dz / L });
    }
  });

  // Arterial north building line (fitted to the north external edges of the main road).
  function fitLine(edges) {
    let sx = 0, sz = 0, w = 0;
    for (const e of edges) { sx += (e.a[0] + e.b[0]) * 0.5 * e.L; sz += (e.a[1] + e.b[1]) * 0.5 * e.L; w += e.L; }
    if (!w) return null;
    const cx = sx / w, cz = sz / w;
    let ux = 0, uz = 0;
    for (const e of edges) { const s = Math.sign(e.ux || 1); ux += e.ux * s * e.L; uz += e.uz * s * e.L; }
    const L = Math.hypot(ux, uz);
    return { cx, cz, ux: ux / L, uz: uz / L };
  }
  const northEdges = extEdges.filter((e) => e.nz < -0.9 && e.L > 5 && (e.a[0] + e.b[0]) / 2 > -125 && (e.a[0] + e.b[0]) / 2 < -45 && (e.a[1] + e.b[1]) / 2 > 55 && (e.a[1] + e.b[1]) / 2 < 90);
  let north = fitLine(northEdges) || { cx: -84, cz: 72.7, ux: 0.967, uz: 0.255 };
  if (north.ux < 0) { north.ux = -north.ux; north.uz = -north.uz; }
  const sN = [-north.uz, north.ux]; // normal pointing south (+z) from the north building line
  if (sN[1] < 0) { sN[0] = -sN[0]; sN[1] = -sN[1]; }
  const southOff = (x, z) => (x - north.cx) * sN[0] + (z - north.cz) * sN[1]; // metres south of line
  const along = (x, z) => (x - north.cx) * north.ux + (z - north.cz) * north.uz;
  const linePt = (t, off) => [north.cx + north.ux * t + sN[0] * off, north.cz + north.uz * t + sN[1] * off];
  const southEdges = extEdges.filter((e) => e.nz > 0.9 && e.L > 5 && (e.a[0] + e.b[0]) / 2 > -125 && (e.a[0] + e.b[0]) / 2 < -45 && southOff((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2) > 25);
  const southLine = fitLine(southEdges);
  let roadWidth = 42;
  if (southLine) roadWidth = Math.max(25, Math.min(60, southOff(southLine.cx, southLine.cz)));

  const arterialRing = roadRings.map((ring) => {
    let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; }
    cx /= ring.length; cz /= ring.length;
    return southOff(cx, cz) > 3 && Math.abs(along(cx, cz)) < 200;
  });

  // ---------------------------------------------------------------- the walk route
  const route = D.route.map((p) => [p[0], p[2]]);
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const routeLen = cum[cum.length - 1];
  function routeAt(s) {
    s = Math.max(0, Math.min(routeLen, s));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = route[i - 1], b = route[i];
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return { x: a[0] + dx * t, z: a[1] + dz * t, ux: dx / L, uz: dz / L };
  }
  // where the street ends and the plaza begins along the route
  let sPlaza = routeLen;
  for (let s = 0; s < routeLen; s += 0.5) { const p = routeAt(s); if (plazaSet.has(p.x, p.z)) { sPlaza = s; break; } }
  const sGate = (() => { for (let s = 0; s < routeLen; s += 0.5) { const p = routeAt(s); if (southOff(p.x, p.z) < -0.5) return s; } return 12; })();
  const routeDist = (x, z) => D.routeDistance(x, z);

  const clearOfSolids = (x, z, margin) => !buildings.has(x, z) && !obstacles.has(x, z) && (margin <= 0 || (buildings.near(x, z, margin + 1) > margin && obstacles.near(x, z, margin + 1) > margin));

  // ---------------------------------------------------------------- gutters (U-channels with lids)
  const gutters = []; // {x,z,ang,kind}
  const gutterLines = []; // [[x,z],[x,z]] for macro painting
  const gr = rng('gutters');
  extEdges.forEach((e, ei) => {
    if (arterialRing[e.ri]) return;
    const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[1] + e.b[1]) / 2;
    if (routeDist(mx, mz) > 48) return;
    if (plazaSet.has(mx + e.nx * 0.6, mz + e.nz * 0.6) || foreSet.has(mx + e.nx * 0.6, mz + e.nz * 0.6)) return;
    const inset = 0.42; // clear of facade protrusions (<= 0.35 m)
    const ang = Math.atan2(e.ux, e.uz); // rotation about y so local +z runs along the edge
    const pitch = 0.5;
    const n = Math.floor((e.L - 0.3) / pitch);
    if (n < 2) return;
    const start = (e.L - n * pitch) / 2 + pitch / 2;
    let runStart = null, last = null;
    for (let k = 0; k < n; k++) {
      const t = start + k * pitch;
      const x = e.a[0] + e.ux * t - e.nx * inset, z = e.a[1] + e.uz * t - e.nz * inset;
      // lid corners must be clear of buildings, obstacles, plaza paving and other roads' interiors
      let ok = !plazaSet.has(x, z) && !foreSet.has(x, z) && southOff(x, z) < -0.3;
      if (ok) {
        for (const [cu, cn] of [[-0.26, -0.2], [0.26, -0.2], [-0.26, 0.2], [0.26, 0.2]]) {
          const px = x + e.ux * cu + e.nx * cn, pz = z + e.uz * cu + e.nz * cn;
          if (buildings.has(px, pz) || obstacles.has(px, pz)) { ok = false; break; }
        }
      }
      // at junction mouths the outside continues as road: no gutter across the mouth
      if (ok && roads.has(x + e.nx * 0.7, z + e.nz * 0.7)) ok = false;
      if (ok) {
        const grate = (k % 13) === 6 || gr.chance(0.015);
        gutters.push({ x, z, ang, kind: grate ? 'grate' : 'lid', tone: gr.range(-1, 1), broken: gr.chance(0.04) });
        if (!runStart) runStart = [x - e.ux * pitch / 2, z - e.uz * pitch / 2];
        last = [x + e.ux * pitch / 2, z + e.uz * pitch / 2];
      } else if (runStart) { gutterLines.push({ a: runStart, b: last, nx: e.nx, nz: e.nz }); runStart = null; }
    }
    if (runStart) gutterLines.push({ a: runStart, b: last, nx: e.nx, nz: e.nz });
  });

  // ---------------------------------------------------------------- arterial kerb + crosswalk
  const kerbs = []; // {x,z,ang,len,w,h,tone}
  const kr = rng('kerb');
  const tMin = along(-127, 60), tMax = along(-44, 82);
  const kerbAng = Math.atan2(north.ux, north.uz);
  for (let t = tMin; t < tMax; t += 1.0) {
    const [x, z] = linePt(t + 0.5, SIDEWALK_W);
    const [xa, za] = linePt(t + 0.02, SIDEWALK_W), [xb, zb] = linePt(t + 0.98, SIDEWALK_W);
    if (buildings.has(x, z) || obstacles.has(x, z) || buildings.has(xa, za) || buildings.has(xb, zb) || obstacles.has(xa, za) || obstacles.has(xb, zb)) continue;
    kerbs.push({ x, z, ang: kerbAng, len: 0.985 + kr.range(-0.01, 0.005), w: 0.18, h: 0.03 + kr.range(-0.006, 0.006), tone: kr.range(-1, 1), tilt: kr.range(-0.006, 0.006) });
  }
  // gate centre from the adopted gate post fixtures
  const posts = D.fixtures.filter((f) => /^ichibangai-gate-post-/.test(f.id));
  let gx = -88, gz = 70.5;
  if (posts.length >= 2) {
    let sx = 0, sz = 0, n = 0;
    for (const f of posts) for (const poly of f.polygons) for (const p of poly) { sx += p[0]; sz += p[2]; n++; }
    gx = sx / n; gz = sz / n;
  }
  const cwT = along(gx, gz);
  const crosswalk = {
    t: cwT,
    start: SIDEWALK_W + 0.55, // offset from the north building line where the bars begin
    length: Math.max(10, roadWidth - 2 * SIDEWALK_W - 1.1),
    width: 4.0, bar: 0.45, gap: 0.45, rail: 0.2,
    centre: linePt(cwT, 0), u: [north.ux, north.uz], s: sN,
  };
  // painted lines on the arterial (stop lines, lane lines, centre line): polygons in world xz
  const paint = [];
  const carriage0 = SIDEWALK_W + 0.35, carriage1 = roadWidth - SIDEWALK_W - 0.35;
  const mid = (carriage0 + carriage1) / 2;
  const quad = (t0, t1, o0, o1) => [linePt(t0, o0), linePt(t1, o0), linePt(t1, o1), linePt(t0, o1)];
  // stop lines: eastbound (north half) stops west of the crossing; westbound east of it (left-hand traffic)
  paint.push({ ring: quad(cwT - 2.0 - 2.0 - 0.45, cwT - 2.0 - 2.0, carriage0 + 0.2, mid - 0.2), w: 0.9 });
  paint.push({ ring: quad(cwT + 4.0, cwT + 4.45, mid + 0.2, carriage1 - 0.2), w: 0.9 });
  // centre line (solid) and dashed lane lines, interrupted at the crossing
  for (const [t0, t1] of [[tMin - 30, cwT - 4.6], [cwT + 4.6, tMax + 30]]) {
    paint.push({ ring: quad(t0, t1, mid - 0.075, mid + 0.075), w: 0.8 });
    for (const lane of [carriage0 + (mid - carriage0) / 2, mid + (carriage1 - mid) / 2]) {
      for (let t = t0 + 1; t < t1 - 5; t += 10) paint.push({ ring: quad(t, t + 5, lane - 0.075, lane + 0.075), w: 0.7 });
    }
  }
  const sidewalkRing = [linePt(tMin - 40, -1), linePt(tMax + 40, -1), linePt(tMax + 40, SIDEWALK_W), linePt(tMin - 40, SIDEWALK_W)];
  const lGutterRing = [linePt(tMin - 40, SIDEWALK_W + 0.09), linePt(tMax + 40, SIDEWALK_W + 0.09), linePt(tMax + 40, SIDEWALK_W + 0.42), linePt(tMin - 40, SIDEWALK_W + 0.42)];
  // kerb inlets (drain grates in the L-gutter)
  const inlets = [];
  for (let t = tMin + 7; t < tMax; t += 19 + kr.range(-3, 3)) {
    if (Math.abs(t - cwT) < 4) continue;
    const [x, z] = linePt(t, SIDEWALK_W + 0.27);
    if (!buildings.has(x, z)) inlets.push({ x, z, ang: kerbAng });
  }

  const rimEarly = D.fixtures.find((f) => f.id === 'plaza-fountain-rim');
  const inFountainEarly = (() => {
    if (!rimEarly) return () => false;
    let sx = 0, sz = 0, n = 0, rx = 0, rz = 0;
    for (const poly of rimEarly.polygons) for (const p of poly) { sx += p[0]; sz += p[2]; n++; }
    const cx = sx / n, cz = sz / n;
    for (const poly of rimEarly.polygons) for (const p of poly) { rx = Math.max(rx, Math.abs(p[0] - cx)); rz = Math.max(rz, Math.abs(p[2] - cz)); }
    return (x, z) => ((x - cx) / (rx + 0.3)) ** 2 + ((z - cz) / (rz + 0.3)) ** 2 < 1;
  })();
  // ---------------------------------------------------------------- plaza / forecourt edging
  const edges = [];
  const er = rng('edging');
  const edgeRings = [plazaRing, ...connectorRings, ...(forecourtRing ? [forecourtRing] : [])];
  for (const ring of edgeRings) {
    const ccw = signedArea(ring) > 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.5) continue;
      const ux = dx / L, uz = dz / L;
      let nx = uz, nz = -ux; if (!ccw) { nx = -nx; nz = -nz; }
      const ang = Math.atan2(ux, uz);
      for (let t = 0.3; t < L - 0.2; t += 0.6) {
        const x = a[0] + ux * t, z = a[1] + uz * t;
        const pin = pattern(x - nx * 0.25, z - nz * 0.25), pout = pattern(x + nx * 0.25, z + nz * 0.25);
        if (pin === pout) continue;
        if (buildings.has(x, z) || obstacles.has(x, z)) continue;
        if (buildings.has(x - ux * 0.3, z - uz * 0.3) || buildings.has(x + ux * 0.3, z + uz * 0.3) || obstacles.has(x - ux * 0.3, z - uz * 0.3) || obstacles.has(x + ux * 0.3, z + uz * 0.3)) continue;
        if (inFountainEarly(x, z)) continue;
        edges.push({ x, z, ang, len: 0.595, w: 0.2, h: 0.012 + er.range(-0.004, 0.004), tone: er.range(-1, 1), tilt: er.range(-0.004, 0.004) });
      }
    }
  }

  // ---------------------------------------------------------------- fixtures used for avoidance
  const fx = (re) => D.fixtures.filter((f) => re.test(f.id));
  const centreOf = (f) => { let sx = 0, sz = 0, n = 0; for (const poly of f.polygons) for (const p of poly) { sx += p[0]; sz += p[2]; n++; } return [sx / n, sz / n]; };
  let fountain = null;
  const rim = fx(/^plaza-fountain-rim$/)[0];
  if (rim) {
    const c = centreOf(rim);
    let rx = 0, rz = 0;
    for (const poly of rim.polygons) for (const p of poly) { rx = Math.max(rx, Math.abs(p[0] - c[0])); rz = Math.max(rz, Math.abs(p[2] - c[1])); }
    fountain = { x: c[0], z: c[1], rx, rz };
  }
  const lampBases = fx(/^plaza-lamp-.*-base$/).map(centreOf);
  const steps = fx(/entry-step-0$/).map((f) => ringXZ(f.polygons.reduce((a, b) => (b.length > a.length ? b : a))));
  const inFountain = (x, z, m = 0) => fountain && ((x - fountain.x) / (fountain.rx + m)) ** 2 + ((z - fountain.z) / (fountain.rz + m)) ** 2 < 1;

  // ---------------------------------------------------------------- manholes and covers
  const manholes = []; // {x,z,ang,design,size}
  const mr = rng('manholes');
  const okCover = (x, z, r) => clearOfSolids(x, z, r + 0.25) && !inFountain(x, z, r + 1.2) && (Math.abs(southOff(x, z) - SIDEWALK_W) > r + 0.4);
  // sewer covers along Ichibangai's centre
  for (let s = sGate + 9 + mr.range(0, 6); s < sPlaza - 4; s += 27 + mr.range(-4, 5)) {
    const p = routeAt(s);
    const lat = mr.range(-0.9, 0.9);
    const x = p.x - p.uz * lat, z = p.z + p.ux * lat;
    if (classify(x, z) === 'asphalt' && okCover(x, z, 0.4)) manholes.push({ x, z, ang: mr.range(0, Math.PI * 2), design: mr.chance(0.6) ? 0 : 1, size: 0.64 });
  }
  // small valve / meter covers near the street edges
  for (const g of gutterLines) {
    const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    const ux = (g.b[0] - g.a[0]) / L, uz = (g.b[1] - g.a[1]) / L;
    for (let t = mr.range(3, 12); t < L - 1; t += mr.range(9, 22)) {
      const x = g.a[0] + ux * t - g.nx * 0.65, z = g.a[1] + uz * t - g.nz * 0.65;
      if (routeDist(x, z) > 30) continue;
      if (classify(x, z) === 'asphalt' && okCover(x, z, 0.25)) manholes.push({ x, z, ang: Math.atan2(ux, uz), design: 2, size: mr.pick([0.3, 0.3, 0.4]) });
    }
  }
  // arterial: larger sewer covers in the carriageway, valve covers on the sidewalk
  for (let t = tMin + mr.range(4, 10); t < tMax; t += mr.range(14, 24)) {
    const o = mr.pick([mid - 1.8, mid + 1.6, carriage0 + 3.2]);
    const [x, z] = linePt(t, o);
    if (Math.abs(t - cwT) < 3) continue;
    if (okCover(x, z, 0.45)) manholes.push({ x, z, ang: mr.range(0, 6.28), design: mr.chance(0.5) ? 0 : 1, size: 0.7 });
    const [x2, z2] = linePt(t + mr.range(-4, 4), mr.range(1.0, 3.8));
    if (mr.chance(0.6) && okCover(x2, z2, 0.25) && Math.abs(along(x2, z2) - cwT) > 2.6) manholes.push({ x: x2, z: z2, ang: kerbAng, design: 2, size: 0.3 });
  }
  // plaza: access covers and small drain grates
  const pb = plazaRing;
  const pbb = pb.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  let tries = 0, placed = 0;
  while (placed < 7 && tries++ < 300) {
    const x = mr.range(pbb[0], pbb[2]), z = mr.range(pbb[1], pbb[3]);
    if (pattern(x, z) !== 'plaza' || !okCover(x, z, 0.5)) continue;
    const gridAng = Math.atan2(north.ux, north.uz);
    manholes.push({ x, z, ang: gridAng, design: placed < 3 ? 2 : 3, size: placed < 3 ? 0.6 : 0.45 });
    placed++;
  }

  // ---------------------------------------------------------------- asphalt patches and seams
  const patches = []; // {ring, age, seam}
  const ar = rng('patches');
  const streetHalf = (p) => {
    let l = 0.5, r = 0.5;
    while (l < 9 && roads.has(p.x - p.uz * l, p.z + p.ux * l)) l += 0.25;
    while (r < 9 && roads.has(p.x + p.uz * r, p.z - p.ux * r)) r += 0.25;
    return [l, r];
  };
  const rectAt = (cx, cz, ux, uz, hl, hw) => [[cx - ux * hl - uz * hw, cz - uz * hl + ux * hw], [cx + ux * hl - uz * hw, cz + uz * hl + ux * hw], [cx + ux * hl + uz * hw, cz + uz * hl - ux * hw], [cx - ux * hl + uz * hw, cz - uz * hl - ux * hw]];
  // transverse utility trench reinstatements across Ichibangai
  for (let s = sGate + 6 + ar.range(0, 8); s < sPlaza - 3; s += ar.range(14, 30)) {
    const p = routeAt(s); const [l, r] = streetHalf(p);
    const w = ar.range(0.35, 0.6);
    const cx = p.x - p.uz * (l - r) / 2, cz = p.z + p.ux * (l - r) / 2;
    // across the street: long axis perpendicular to the route direction
    patches.push({ ring: rectAt(cx, cz, -p.uz, p.ux, (l + r) / 2 + 0.3, w), age: ar.range(0.35, 0.95), seam: 1 });
  }
  // longitudinal trench patches
  for (let k = 0; k < 3; k++) {
    const s0 = ar.range(sGate + 5, sPlaza - 30);
    const len = ar.range(8, 26);
    const p = routeAt(s0 + len / 2);
    const lat = ar.range(-2.2, 2.2);
    patches.push({ ring: rectAt(p.x - p.uz * lat, p.z + p.ux * lat, p.ux, p.uz, len / 2, ar.range(0.3, 0.5)), age: ar.range(0.3, 0.8), seam: 1 });
  }
  // square reinstatement around each manhole
  for (const m of manholes) {
    if (m.design > 1 || classify(m.x, m.z) !== 'asphalt') continue;
    const hl = m.size / 2 + ar.range(0.25, 0.5);
    const a = ar.range(0, Math.PI);
    patches.push({ ring: rectAt(m.x, m.z, Math.cos(a), Math.sin(a), hl, hl * ar.range(0.85, 1.15)), age: ar.range(0.2, 0.75), seam: 1 });
  }
  // irregular pothole repairs, denser near the street edges
  const irregular = (cx, cz, r) => {
    const n = 7 + ar.int(0, 4), ring = [];
    const rot = ar.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; const rr = r * ar.range(0.55, 1.15); ring.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr * ar.range(0.6, 1)]); }
    return ring;
  };
  for (let s = sGate; s < sPlaza; s += ar.range(2, 7)) {
    const p = routeAt(s); const [l, r] = streetHalf(p);
    const lat = ar.chance(0.6) ? (ar.chance(0.5) ? -(l - ar.range(0.4, 1.4)) : (r - ar.range(0.4, 1.4))) : ar.range(-l + 1, r - 1);
    const x = p.x + p.uz * lat, z = p.z - p.ux * lat;
    if (classify(x, z) !== 'asphalt') continue;
    patches.push({ ring: irregular(x, z, ar.range(0.15, 0.7)), age: ar.range(0.15, 0.9), seam: ar.chance(0.6) ? 1 : 0 });
  }
  // larger reinstated areas (several m2) in Ichibangai
  for (let k = 0; k < 7; k++) {
    const sMid = ar.range(sGate + 4, sPlaza - 6);
    const p = routeAt(sMid); const [l, r] = streetHalf(p);
    const len = ar.range(1.8, 6.5), wid = ar.range(0.9, Math.min(3.2, (l + r) * 0.45));
    const lat = ar.range(-l + wid * 0.6, r - wid * 0.6);
    patches.push({ ring: rectAt(p.x + p.uz * lat, p.z - p.ux * lat, p.ux, p.uz, len / 2, wid / 2), age: ar.range(0.25, 0.85), seam: 1 });
  }
  // arterial patches (long strips along lanes and a few squares)
  for (let k = 0; k < 7; k++) {
    const t = ar.range(tMin, tMax), len = ar.range(3, 18);
    const o = ar.range(carriage0 + 0.5, carriage1 - 0.5);
    const [cx, cz] = linePt(t, o);
    patches.push({ ring: rectAt(cx, cz, north.ux, north.uz, len / 2, ar.range(0.4, 1.2)), age: ar.range(0.2, 0.7), seam: 1 });
  }
  for (let k = 0; k < 10; k++) {
    const [cx, cz] = linePt(ar.range(tMin, tMax), ar.range(0.6, carriage1));
    patches.push({ ring: irregular(cx, cz, ar.range(0.25, 0.9)), age: ar.range(0.15, 0.8), seam: ar.chance(0.5) ? 1 : 0 });
  }

  // ---------------------------------------------------------------- stains, damp spots, dust
  const stains = []; // {x,z,r,k:'oil'|'damp'|'rust'|'dust', a}
  const sr = rng('stains');
  // oil drips where vehicles wait at the arterial stop lines and along lane centres
  for (const [t0, t1, o0, o1] of [[cwT - 30, cwT - 4.5, carriage0 + 0.6, mid - 0.6], [cwT + 4.5, cwT + 30, mid + 0.6, carriage1 - 0.6]]) {
    for (let lane = 0; lane < 2; lane++) {
      const o = o0 + (o1 - o0) * (lane + 0.5) / 2;
      for (let t = t0; t < t1; t += sr.range(0.6, 2.2)) {
        const [x, z] = linePt(t, o + sr.normal() * 0.35);
        stains.push({ x, z, r: sr.range(0.08, 0.35), k: 'oil', a: sr.range(0.25, 0.7) });
      }
    }
  }
  // Ichibangai: delivery vans and shop-front washing in front of street-facing facades
  const nearFacades = (D.facades || []).filter((f) => f.streetFacing && f.routeDist < 22 && !f.inPlaza);
  for (const f of nearFacades) {
    const r2 = ctx.rng(`terrain/stain/${f.id}`);
    if (r2.chance(0.35)) {
      const t = r2.range(0.2, 0.8);
      const d = r2.range(0.8, 2.6);
      const x = f.a[0] + (f.b[0] - f.a[0]) * t + f.normal[0] * d, z = f.a[1] + (f.b[1] - f.a[1]) * t + f.normal[1] * d;
      if (classify(x, z) !== 'paving') stains.push({ x, z, r: r2.range(0.3, 1.1), k: r2.chance(0.25) ? 'damp' : 'oil', a: r2.range(0.25, 0.6) });
    }
    if (r2.chance(0.5)) {
      const t = r2.range(0.1, 0.9);
      const x = f.a[0] + (f.b[0] - f.a[0]) * t + f.normal[0] * 0.5, z = f.a[1] + (f.b[1] - f.a[1]) * t + f.normal[1] * 0.5;
      stains.push({ x, z, r: r2.range(0.3, 0.9), k: 'dirt', a: r2.range(0.3, 0.7) });
    }
  }
  // each shop frontage apron has its own wear/cleanliness (scrubbed, oily, dusty)
  const frontages = [];
  for (const f of (D.facades || []).filter((f) => f.streetFacing && f.routeDist < 45 && f.length > 1.5)) {
    const r3 = ctx.rng(`terrain/frontage/${f.id}`);
    const depth = r3.range(1.2, 3.0);
    const [ax, az] = f.a, [bx, bz] = f.b, [nx, nz] = f.normal;
    frontages.push({ ring: [[ax, az], [bx, bz], [bx + nx * depth, bz + nz * depth], [ax + nx * depth, az + nz * depth]], v: r3.chance(0.6) ? r3.range(96, 120) : r3.range(134, 150), a: r3.range(0.35, 0.8) });
    for (let k = 0; k < 3; k++) if (r3.chance(0.45)) {
      const t = r3.range(0.1, 0.9), d = r3.range(0.3, 2.2);
      stains.push({ x: ax + (bx - ax) * t + nx * d, z: az + (bz - az) * t + nz * d, r: r3.range(0.15, 0.7), k: r3.chance(0.7) ? 'oil' : 'dirt', a: r3.range(0.3, 0.7) });
    }
  }
  // random drips along the street
  for (let s = sGate; s < sPlaza; s += sr.range(1.5, 5)) {
    const p = routeAt(s); const lat = sr.normal() * 1.6;
    stains.push({ x: p.x + p.uz * lat, z: p.z - p.ux * lat, r: sr.range(0.05, 0.25), k: 'oil', a: sr.range(0.2, 0.55) });
  }
  // rust bleeding from the steel lamp bases, splash ring around the working fountain
  for (const [x, z] of lampBases) for (let k = 0; k < 4; k++) stains.push({ x: x + sr.normal() * 0.35, z: z + sr.normal() * 0.35, r: sr.range(0.2, 0.5), k: 'rust', a: sr.range(0.3, 0.6) });
  // plaza: scattered gum/dirt patches and a few dark spills
  for (let k = 0; k < 40; k++) {
    const x = sr.range(pbb[0], pbb[2]), z = sr.range(pbb[1], pbb[3]);
    if (pattern(x, z) === 'plaza' || pattern(x, z) === 'forecourt') stains.push({ x, z, r: sr.range(0.2, 1.4), k: sr.chance(0.7) ? 'dirt' : 'oil', a: sr.range(0.15, 0.45) });
  }

  // large soft tone variations (darker binder-rich / lighter dusty areas), 1.5-6 m
  const tones = [];
  const tr = rng('tones');
  for (let s = 0; s < routeLen; s += tr.range(1.5, 4)) {
    const p = routeAt(s);
    const lat = tr.normal() * 3.2;
    tones.push({ x: p.x + p.uz * lat, z: p.z - p.ux * lat, r: tr.range(1.2, 5.5), v: tr.chance(0.55) ? tr.range(92, 116) : tr.range(138, 156), a: tr.range(0.45, 0.95) });
  }
  for (let k = 0; k < 40; k++) {
    const [x, z] = linePt(tr.range(tMin, tMax), tr.range(-1, roadWidth));
    tones.push({ x, z, r: tr.range(2, 7), v: tr.chance(0.5) ? tr.range(104, 120) : tr.range(134, 148), a: tr.range(0.3, 0.7) });
  }
  for (let k = 0; k < 70; k++) {
    const x = tr.range(pbb[0] - 15, pbb[2] + 15), z = tr.range(pbb[1] - 15, pbb[3] + 10);
    tones.push({ x, z, r: tr.range(1.5, 6), v: tr.chance(0.6) ? tr.range(102, 120) : tr.range(134, 146), a: tr.range(0.3, 0.75) });
  }

  return {
    tones, frontages,
    roads, roadRings, plazaSet, foreSet, plazaRing, connectorRings, forecourtRing, buildings, buildingRings, obstacles,
    classify, pattern, north, sN, southOff, along, linePt, roadWidth, sidewalkW: SIDEWALK_W,
    sidewalkRing, lGutterRing, kerbs, inlets, crosswalk, paint, gutters, gutterLines, edges, manholes, patches, stains,
    fountain, lampBases, steps, route, routeAt, routeLen, sPlaza, sGate, inFountain,
    gridDir: [north.ux, north.uz],
    foreDir: (() => {
      const e = D.decisions.routeSurfaces && D.decisions.routeSurfaces.theatre_arrival && D.decisions.routeSurfaces.theatre_arrival.frontage_edge_xz_m;
      if (!e) return [0.405, -0.914];
      const dx = e[1][0] - e[0][0], dz = e[1][1] - e[0][1], L = Math.hypot(dx, dz);
      return [dx / L, dz / L];
    })(),
    foreOrigin: (() => {
      const e = D.decisions.routeSurfaces && D.decisions.routeSurfaces.theatre_arrival && D.decisions.routeSurfaces.theatre_arrival.frontage_edge_xz_m;
      return e ? e[0] : [-30.26, -66.93];
    })(),
  };
}

export { segDist };
