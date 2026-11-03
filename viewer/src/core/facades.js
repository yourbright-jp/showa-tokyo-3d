// Shared facade analysis so independent world modules agree on where walls, shopfronts
// and signs are. Derived only from the loaded footprints/roads; floor counts are a
// deterministic visual assumption (not survey data) and are tagged as such by callers.

export function pointInPolygon(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function segIntersectT(ox, oz, dx, dz, ax, az, bx, bz) {
  // ray o + t d vs segment a-b; returns t or Infinity
  const ex = bx - ax, ez = bz - az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((ax - ox) * ez - (az - oz) * ex) / den;
  const u = ((ax - ox) * dz - (az - oz) * dx) / den;
  return t > 1e-4 && u >= 0 && u <= 1 ? t : Infinity;
}

/**
 * Builds ctx.data.facades and ctx.data.plans (per building). Call once; idempotent.
 * facade: { id, buildingId, index, a:[x,z], b:[x,z], length, normal:[nx,nz] (outward),
 *           mid:[x,z], baseY, topY, openDistance, onRoad, inPlaza, routeDist, streetFacing }
 * plan:   { floors, groundFloorH, upperFloorH, parapetH, topY, baseY }
 */
export function analyseFacades(ctx) {
  const data = ctx.data;
  if (data.facades) return data.facades;
  const roadRings = data.roads.map((r) => r.polygon.map((p) => [p[0], p[2]]));
  const plazaRing = data.plaza && data.plaza.boundary_m ? data.plaza.boundary_m.map((p) => [p[0], p[2]]) : null;
  const all = data.buildings;
  // spatial hash of building edges for ray casts
  const cell = 20;
  const edgeGrid = new Map();
  const key = (gx, gz) => `${gx},${gz}`;
  for (const b of all) {
    const fp = b.footprint;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], c = fp[(i + 1) % fp.length];
      const x0 = Math.floor(Math.min(a[0], c[0]) / cell), x1 = Math.floor(Math.max(a[0], c[0]) / cell);
      const z0 = Math.floor(Math.min(a[1], c[1]) / cell), z1 = Math.floor(Math.max(a[1], c[1]) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = key(gx, gz);
        if (!edgeGrid.has(k)) edgeGrid.set(k, []);
        edgeGrid.get(k).push([b.id, a, c]);
      }
    }
  }
  function openDistance(selfId, ox, oz, nx, nz, maxD = 40) {
    let best = maxD;
    const seen = new Set();
    for (let s = 0; s <= maxD; s += cell / 2) {
      const gx = Math.floor((ox + nx * s) / cell), gz = Math.floor((oz + nz * s) / cell);
      for (let ddx = -1; ddx <= 1; ddx++) for (let ddz = -1; ddz <= 1; ddz++) {
        const list = edgeGrid.get(key(gx + ddx, gz + ddz));
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e)) continue; seen.add(e);
          if (e[0] === selfId) continue;
          const t = segIntersectT(ox, oz, nx, nz, e[1][0], e[1][1], e[2][0], e[2][1]);
          if (t < best) best = t;
        }
      }
      if (best < s) break;
    }
    return best;
  }

  const facades = [];
  const plans = new Map();
  for (const b of all) {
    // Adopted period rule (data/derived/kabukicho-period-features.json): 3.2 m storey scale.
    // Fascia band sits on the 2F spandrel, matching the adopted storefront sign (≈3.3–4.1 m).
    const storeyH = 3.2;
    // r05 (kabukicho-context-massing-1976): low background structures keep their modern height, below the
    // two-storey minimum; they are one storey with no shop fascia (signage skips them).
    const minor = !b.landmark && b.height < 2 * storeyH - 0.05;
    const floors = minor ? 1 : Math.max(1, Math.round(b.height / storeyH));
    const groundFloorH = b.landmark ? 6 : minor ? b.height : storeyH;
    plans.set(b.id, {
      floors, storeyH, groundFloorH, upperFloorH: floors > 1 ? (b.height - groundFloorH) / (floors - 1) : storeyH,
      parapetH: 0.6, baseY: b.baseY, topY: b.topY, minor,
      fasciaY0: minor ? b.topY : b.baseY + groundFloorH + 0.08, fasciaY1: minor ? b.topY : b.baseY + groundFloorH + 0.92,
      assumption: minor ? 'r05 low background structure at its modern height (inferred), not surveyed' : 'adopted 3.2 m storey scale (inferred), not surveyed',
    });
    const fp = b.footprint; // CCW in (x,z) as stored by data.js
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], c = fp[(i + 1) % fp.length];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.8) continue;
      // CCW with signedArea>0 in (x,z): outward normal is (dz, -dx)/len
      const nx = dz / len, nz = -dx / len;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const od = openDistance(b.id, mx + nx * 0.05, mz + nz * 0.05, nx, nz);
      const px = mx + nx * 2.5, pz = mz + nz * 2.5;
      const onRoad = roadRings.some((ring) => pointInPolygon(px, pz, ring));
      const inPlaza = plazaRing ? pointInPolygon(px, pz, plazaRing) : false;
      facades.push({
        id: `${b.id}#${i}`, buildingId: b.id, index: i, a, b: c, length: len, normal: [nx, nz], mid: [mx, mz],
        baseY: b.baseY, topY: b.topY, openDistance: od, onRoad, inPlaza,
        routeDist: data.routeDistance(mx, mz),
        streetFacing: od > 3.5 && (onRoad || inPlaza || od > 8),
      });
    }
  }
  // Attach the adopted stable shop text (period text_nodes) to the facade it sits on.
  for (const t of data.textNodes || []) {
    const [tx, , tz] = t.position_m;
    let best = null, bd = 0.6;
    for (const f of facades) {
      if (!t.id.startsWith(f.buildingId)) continue;
      const d = Math.abs((tx - f.a[0]) * f.normal[0] + (tz - f.a[1]) * f.normal[1]);
      const along = ((tx - f.a[0]) * (f.b[0] - f.a[0]) + (tz - f.a[1]) * (f.b[1] - f.a[1])) / (f.length * f.length);
      if (d < bd && along > -0.05 && along < 1.05) { bd = d; best = f; }
    }
    if (best) { best.adoptedText = t; t.facadeId = best.id; }
  }
  data.facades = facades;
  data.plans = plans;
  data.facadesByBuilding = new Map();
  for (const f of facades) {
    if (!data.facadesByBuilding.has(f.buildingId)) data.facadesByBuilding.set(f.buildingId, []);
    data.facadesByBuilding.get(f.buildingId).push(f);
  }
  return facades;
}
