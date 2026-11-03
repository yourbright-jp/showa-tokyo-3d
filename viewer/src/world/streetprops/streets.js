// Street frames used to lay out props.
//  - Ichibangai: arc length along the adopted walk route (ctx.data.route), sides by ray casts
//    against building footprints.
//  - Main road south of the entrance: a frame aligned with the adopted gate line
//    (data/decisions/kabukicho-gate-1976.json right_xz). E runs east along the road, s runs
//    south from the gate line. Kerb and lane positions are production estimates (the modern
//    PLATEAU road polygon includes sidewalks); they are not measured 1976 values.

export function makeStreets(ctx, site) {
  const { data } = ctx;
  const R = data.route;
  const cum = [0];
  for (let i = 1; i < R.length; i++) cum.push(cum[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][2] - R[i - 1][2]));
  const routeLen = cum[cum.length - 1];
  function routeAt(s) {
    s = Math.max(0, Math.min(routeLen, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = R[i - 1], b = R[i];
    const L = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / L;
    const dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t, dx, dz, s };
  }

  /** Distance from (x,z) along unit dir (dx,dz) to the first building footprint edge. */
  function rayToWall(x, z, dx, dz, maxD = 12) {
    const cx = x + (dx * maxD) / 2, cz = z + (dz * maxD) / 2;
    let best = Infinity;
    for (const b of site.nearBuildings(cx, cz, maxD / 2 + 1)) {
      const fp = b.footprint;
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i], c = fp[(i + 1) % fp.length];
        const ex = c[0] - a[0], ez = c[1] - a[1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((a[0] - x) * ez - (a[1] - z) * ex) / den;
        const u = ((a[0] - x) * dz - (a[1] - z) * dx) / den;
        if (t > 1e-4 && u >= 0 && u <= 1 && t < best) best = t;
      }
    }
    return best <= maxD ? best : Infinity;
  }

  // ---- main road frame ----
  const gate = data.decisions.gate.parameters;
  const p0 = gate.post_positions_local_m[0].position_local_m, p1 = gate.post_positions_local_m[1].position_local_m;
  const O = [(p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2];
  const e = gate.right_xz; // east along the road
  const S = [-gate.forward_xz[0], -gate.forward_xz[1]]; // south, away from Ichibangai
  const main = {
    O, e, S,
    kerbS: 12.0, // north kerb line (estimate)
    carriageway: [12.0, 31.5],
    southKerbS: 31.5,
    toWorld(E, s) { return [O[0] + e[0] * E + S[0] * s, O[1] + e[1] * E + S[1] * s]; },
    toLocal(x, z) { const dx = x - O[0], dz = z - O[1]; return [dx * e[0] + dz * e[1], dx * S[0] + dz * S[1]]; },
    /** heading (ry) whose local +z points along world direction (dx,dz) */
  };
  const headingOf = (dx, dz) => Math.atan2(dx, dz);
  return { routeLen, routeAt, rayToWall, main, headingOf };
}
