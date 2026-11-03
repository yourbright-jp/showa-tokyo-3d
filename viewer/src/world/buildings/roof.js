import { pointInPolygon } from '../../core/facades.js';
import { W, box, obox, tube, polygonCap, mulCol, hexToRgb } from './geom.js';

// Flat roofs with parapets, stair/elevator penthouses, elevated water tanks and TV antennas.
// Rooftop equipment is kept to the back of the roof (away from street-facing edges) so the
// signage module can put rooftop billboards over the front.

/** Inward miter offset of a CCW ring by t metres. */
export function insetRing(ring, t) {
  const n = ring.length; const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], c = ring[i], q = ring[(i + 1) % n];
    let e1x = c[0] - p[0], e1z = c[1] - p[1]; const l1 = Math.hypot(e1x, e1z) || 1; e1x /= l1; e1z /= l1;
    let e2x = q[0] - c[0], e2z = q[1] - c[1]; const l2 = Math.hypot(e2x, e2z) || 1; e2x /= l2; e2z /= l2;
    const n1 = [e1z, -e1x], n2 = [e2z, -e2x];
    const k = Math.max(0.35, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    out.push([c[0] - t * (n1[0] + n2[0]) / k, c[1] - t * (n1[1] + n2[1]) / k]);
  }
  return out;
}

function distToSeg(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}

/** Principal frame of a footprint (longest edge direction). */
function principal(fp) {
  let best = 0, dir = [1, 0];
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) { best = l; dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
  }
  return dir;
}

/** Find a rectangle (hu x hd half sizes, aligned with dir) inside the ring, far from front edges. */
function placeRect(ring, dir, hu, hd, fronts, avoid, margin = 0.45) {
  const e2 = [-dir[1], dir[0]];
  let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
  let smin = Infinity, smax = -Infinity, tmin = Infinity, tmax = -Infinity;
  for (const p of ring) { const s = (p[0] - cx) * dir[0] + (p[1] - cz) * dir[1], t = (p[0] - cx) * e2[0] + (p[1] - cz) * e2[1]; smin = Math.min(smin, s); smax = Math.max(smax, s); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  let best = null, bs = -Infinity;
  const N = 7;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const s = smin + hu + margin + (smax - smin - 2 * (hu + margin)) * (i / (N - 1));
    const t = tmin + hd + margin + (tmax - tmin - 2 * (hd + margin)) * (j / (N - 1));
    if (!isFinite(s) || !isFinite(t)) continue;
    const x = cx + dir[0] * s + e2[0] * t, z = cz + dir[1] * s + e2[1] * t;
    let ok = true;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = x + dir[0] * (hu + margin) * a + e2[0] * (hd + margin) * b, pz = z + dir[1] * (hu + margin) * a + e2[1] * (hd + margin) * b;
      if (!pointInPolygon(px, pz, ring)) { ok = false; break; }
    }
    if (!ok) continue;
    if (avoid.some((o) => Math.abs((x - o[0]) * dir[0] + (z - o[1]) * dir[1]) < hu + o[2] + 0.4 && Math.abs((x - o[0]) * e2[0] + (z - o[1]) * e2[1]) < hd + o[3] + 0.4)) continue;
    let score = fronts.length ? Math.min(...fronts.map(([a, b]) => distToSeg(x, z, a, b))) : -Math.hypot(x - cx, z - cz);
    score += 0.001 * (i + j);
    if (score > bs) { bs = score; best = [x, z]; }
  }
  return best;
}

function antenna(env, x, z, y0, r) {
  const B = env.B('sash'); const col = [0.42, 0.43, 0.42];
  const h = r.range(2.2, 4.8);
  tube(B, [x, y0, z], [x, y0 + h, z], 0.022, 5, col);
  const nb = r.int(1, 3);
  for (let i = 0; i < nb; i++) {
    const y = y0 + h - 0.15 - i * r.range(0.5, 0.9);
    const a = r.range(0, Math.PI); const dx = Math.cos(a), dz = Math.sin(a);
    const len = r.range(1.2, 2.2);
    const p0 = [x - dx * len * 0.3, y, z - dz * len * 0.3], p1 = [x + dx * len * 0.7, y, z + dz * len * 0.7];
    tube(B, p0, p1, 0.012, 3, col);
    const ne = r.int(5, 9);
    for (let e = 0; e < ne; e++) {
      const t = e / (ne - 1); const cx = p0[0] + (p1[0] - p0[0]) * t, cz = p0[2] + (p1[2] - p0[2]) * t;
      const el = (0.9 - 0.5 * t) * r.range(0.8, 1.1) / 2;
      tube(B, [cx - dz * el, y, cz + dx * el], [cx + dz * el, y, cz - dx * el], 0.006, 3, col);
    }
  }
}

function waterTank(env, S, x, z, y0, dir, r, maxHu, maxHd) {
  const Bp = env.B('paint'), Bs = env.B('sash');
  const steel = [0.32, 0.33, 0.31];
  const legH = r.range(0.5, 1.8);
  const kind = S.roof.tankKind;
  const col = S.roof.tankColour;
  const exW = () => ({ aGrime: env.atlas.white });
  let hu = Math.min(maxHu, r.range(0.8, 1.3)), hd = Math.min(maxHd, r.range(0.6, 1.0));
  if (hu < 0.45 || hd < 0.4) return;
  // stand: legs + ring beams
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = x + dir[0] * hu * 0.9 * a - dir[1] * hd * 0.9 * b, pz = z + dir[1] * hu * 0.9 * a + dir[0] * hd * 0.9 * b;
    obox(Bs, px, pz, y0, legH, 0.05, 0.05, dir[0], dir[1], steel);
  }
  obox(Bs, x, z, y0 + legH - 0.12, 0.12, hu, hd, dir[0], dir[1], steel);
  obox(Bs, x, z, y0 + legH * 0.45, 0.06, hu * 0.92, hd * 0.92, dir[0], dir[1], steel, { skip: new Set(['top', 'bottom']) });
  const yb = y0 + legH;
  if (kind === 'frp') {
    const h = r.range(1.1, 1.9);
    obox(env.B('wall:panel'), x, z, yb, h, hu, hd, dir[0], dir[1], col, { ex: exW });
    obox(Bp, x, z, yb + h, 0.04, hu + 0.03, hd + 0.03, dir[0], dir[1], mulCol(col, 0.9), { ex: exW });
    obox(Bp, x + dir[0] * hu * 0.4, z + dir[1] * hu * 0.4, yb + h, 0.18, 0.28, 0.28, dir[0], dir[1], mulCol(col, 0.85), { ex: exW });
    // ladder
    const lx = x - dir[1] * (hd + 0.08), lz = z + dir[0] * (hd + 0.08);
    for (const s of [-0.2, 0.2]) tube(Bs, [lx + dir[0] * s, y0, lz + dir[1] * s], [lx + dir[0] * s, yb + h, lz + dir[1] * s], 0.015, 4, steel);
    for (let y = y0 + 0.3; y < yb + h; y += 0.3) tube(Bs, [lx - dir[0] * 0.2, y, lz - dir[1] * 0.2], [lx + dir[0] * 0.2, y, lz + dir[1] * 0.2], 0.01, 3, steel);
  } else if (kind === 'cyl') {
    const rad = Math.min(hu, hd) * 0.95, h = r.range(1.3, 2.2);
    tube(Bp, [x, yb, z], [x, yb + h, z], rad, 12, col, true);
    tube(Bp, [x, yb + h, z], [x, yb + h + 0.2, z], rad * 0.35, 8, mulCol(col, 0.85), true);
  } else {
    const rad = Math.min(hd * 0.95, 0.75);
    tube(Bp, [x - dir[0] * hu, yb + rad, z - dir[1] * hu], [x + dir[0] * hu, yb + rad, z + dir[1] * hu], rad, 12, col, true);
  }
}

export function buildRoof(env, b, S, lv, frontEdges, r) {
  const fp = b.footprint;
  const t = 0.16;
  const inner = insetRing(fp, t);
  const Broof = env.B('roof'), Bp = env.B('paint');
  const roofCol = mulCol([0.9, 0.9, 0.88], r.range(0.75, 1.0));
  polygonCap(Broof, inner, lv.roofY, roofCol);
  const wallKey = `wall:${S.sideClad}`;
  const Bw = env.B(wallKey);
  const exW = () => ({ aGrime: env.atlas.white });
  const pc = mulCol(S.sideColour, 0.9);
  for (let i = 0; i < fp.length; i++) {
    const a = inner[i], c = inner[(i + 1) % fp.length], A = fp[i], C = fp[(i + 1) % fp.length];
    const ex = c[0] - a[0], ez = c[1] - a[1]; const l = Math.hypot(ex, ez); if (l < 0.02) continue;
    const n = [-ez / l, 0, ex / l]; // inward-facing (towards roof centre) for a CCW ring
    Bw.quad([[a[0], lv.roofY, a[1]], [c[0], lv.roofY, c[1]], [c[0], lv.topY, c[1]], [a[0], lv.topY, a[1]]], n, [[0, lv.roofY], [l, lv.roofY], [l, lv.topY], [0, lv.topY]], pc, [0, 1, 2, 3].map(() => ({ aGrime: env.atlas.white })));
    Bp.quad([[A[0], lv.topY, A[1]], [C[0], lv.topY, C[1]], [c[0], lv.topY, c[1]], [a[0], lv.topY, a[1]]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], S.trimColour, [0, 1, 2, 3].map(() => ({ aGrime: env.atlas.white })));
  }
  const dir = principal(fp);
  const avoid = [];
  const R = S.roof;
  let penthouse = null;
  if (R.penthouse) {
    const hu = r.range(1.2, 2.1), hd = r.range(1.2, 2.3);
    const at = placeRect(inner, dir, hu, hd, frontEdges, avoid);
    if (at) {
      const h = r.range(2.6, 3.1);
      const [x, z] = at;
      const Bpw = env.B(wallKey);
      obox(Bpw, x, z, lv.roofY, h, hu, hd, dir[0], dir[1], mulCol(S.sideColour, 0.95), { ex: exW, skip: new Set(['bottom']) });
      obox(Bp, x, z, lv.roofY + h, 0.12, hu + 0.12, hd + 0.12, dir[0], dir[1], S.trimColour, { ex: exW });
      // steel door and a small window on the long side
      const Fd = { ax: x, az: z, tx: dir[0], tz: dir[1], nx: dir[1], nz: -dir[0] };
      box(Bp, Fd, -0.45, 0.45, lv.roofY + 0.05, lv.roofY + 2.0, hd, hd + 0.03, [0.3, 0.32, 0.31], { ex: exW, skip: new Set(['back']) });
      box(Bp, Fd, -hu + 0.3, -hu + 0.9, lv.roofY + 1.4, lv.roofY + 2.0, -hd - 0.03, -hd, [0.12, 0.14, 0.15], { ex: exW, skip: new Set(['back']) });
      penthouse = { x, z, hu, hd, top: lv.roofY + h + 0.12 };
      avoid.push([x, z, hu, hd]);
      if (env.rooftop) env.rooftop.push({ kind: 'penthouse', x, z, hu, hd, dir, top: penthouse.top + (R.machine ? 2.1 : (R.tank && R.tankOnPenthouse ? 4.2 : 0)) });
      if (R.machine) {
        const mh = r.range(1.4, 2.0);
        obox(Bpw, x + dir[0] * hu * 0.35, z + dir[1] * hu * 0.35, penthouse.top, mh, hu * 0.6, hd * 0.8, dir[0], dir[1], mulCol(S.sideColour, 0.92), { ex: exW, skip: new Set(['bottom']) });
        obox(Bp, x + dir[0] * hu * 0.35, z + dir[1] * hu * 0.35, penthouse.top + mh, 0.1, hu * 0.6 + 0.08, hd * 0.8 + 0.08, dir[0], dir[1], S.trimColour, { ex: exW });
      }
    }
  }
  if (R.tank) {
    if (penthouse && R.tankOnPenthouse && !R.machine) waterTank(env, S, penthouse.x - dir[0] * penthouse.hu * 0.2, penthouse.z - dir[1] * penthouse.hu * 0.2, penthouse.top, dir, r, penthouse.hu * 0.75, penthouse.hd * 0.8);
    else {
      const at = placeRect(inner, dir, 1.0, 0.8, frontEdges, avoid, 0.35);
      if (at) { waterTank(env, S, at[0], at[1], lv.roofY, dir, r, 1.2, 0.9); avoid.push([at[0], at[1], 1.2, 0.9]); if (env.rooftop) env.rooftop.push({ kind: 'tank', x: at[0], z: at[1], hu: 1.3, hd: 1.0, dir, top: lv.roofY + 4.2 }); }
    }
  }
  for (let i = 0; i < R.antennas; i++) {
    const at = placeRect(inner, [Math.cos(i * 2.1), Math.sin(i * 2.1)], 0.3, 0.3, frontEdges, avoid, 0.3);
    if (at) { antenna(env, at[0], at[1], lv.roofY, r); avoid.push([at[0], at[1], 0.4, 0.4]); if (env.rooftop) env.rooftop.push({ kind: 'antenna', x: at[0], z: at[1], hu: 1.2, hd: 1.2, dir: [1, 0], top: lv.roofY + 5 }); }
  }
}

/** Simplified rooftop for mid LOD: penthouse box and a tank block. */
export function midRoof(env, b, lv, S, r) {
  const fp = b.footprint; const dir = principal(fp);
  const inner = insetRing(fp, 0.2);
  const B = env.B('paint');
  if (S.roof.penthouse) {
    const hu = r.range(1.2, 2.0), hd = r.range(1.2, 2.0);
    const at = placeRect(inner, dir, hu, hd, [], [], 0.4);
    if (at) {
      const h = r.range(2.5, 3.0);
      obox(B, at[0], at[1], lv.roofY, h, hu, hd, dir[0], dir[1], mulCol(S.sideColour, 0.9), { skip: new Set(['bottom']) });
      if (S.roof.tank) obox(B, at[0], at[1], lv.roofY + h, r.range(1.6, 2.6), Math.min(hu, 1.0) * 0.8, Math.min(hd, 0.8) * 0.8, dir[0], dir[1], S.roof.tankColour, { skip: new Set(['bottom']) });
    }
  }
}
