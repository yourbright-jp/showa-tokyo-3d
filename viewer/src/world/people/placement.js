// Crowd placement on the adopted ground: where people may stand without touching walls,
// adopted obstacles, other modules' street furniture, or the walk corridor (CORRIDOR_M).
//
// Walkable = adopted ground triangles classed asphalt/paving (data.ground) or the adopted plaza
// boundary; minus building footprints (+ margin), ground obstacles (+ margin), the route
// corridor, and occupied cells found by scanning the already-built signage / landmarks /
// streetprops groups (geometry between 0.3 m and 1.95 m above ground). Ground height comes from
// the built terrain group when present (so feet sit on kerbs/paving), else data.heightAt.
import { pointInPolygon } from '../../core/facades.js';

export const CORRIDOR_M = 0.85;    // clear corridor on each side of the walk (round c: 1.2 left an empty lane down every street view)
export const BODY_R = 0.32;        // body + carried bag half-width
export const WALL_CLEAR = 0.72;    // 0.35 m facade protrusions + body
const CELL = 0.5;

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

export function makeGrid(ctx, margin = 42) {
  const route = ctx.data.route;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of route) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); }
  const b = ctx.data.terrain.bounds;
  minX = Math.max(b.minX, minX - margin); maxX = Math.min(b.maxX, maxX + margin);
  minZ = Math.max(b.minZ, minZ - margin); maxZ = Math.min(b.maxZ, maxZ + margin);
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const N = nx * nz;
  return {
    minX, minZ, maxX, maxZ, nx, nz, cell: CELL,
    walk: new Uint8Array(N), block: new Uint8Array(N), gy: new Float32Array(N).fill(NaN), rd: new Float32Array(N).fill(NaN),
    idx(x, z) { const gx = Math.floor((x - minX) / CELL), gz = Math.floor((z - minZ) / CELL); return gx < 0 || gz < 0 || gx >= nx || gz >= nz ? -1 : gz * nx + gx; },
    cx(gx) { return minX + (gx + 0.5) * CELL; },
    cz(gz) { return minZ + (gz + 0.5) * CELL; },
  };
}

// Rasterise a triangle (x,z) into cells whose centres lie within `pad` of it.
function rasterTri(G, ax, az, bx, bz, cx, cz, pad, fn) {
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - pad - G.minX) / CELL)), x1 = Math.min(G.nx - 1, Math.floor((Math.max(ax, bx, cx) + pad - G.minX) / CELL));
  const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - pad - G.minZ) / CELL)), z1 = Math.min(G.nz - 1, Math.floor((Math.max(az, bz, cz) + pad - G.minZ) / CELL));
  if (x1 < x0 || z1 < z0) return;
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  for (let gz = z0; gz <= z1; gz++) {
    const pz = G.cz(gz);
    for (let gx = x0; gx <= x1; gx++) {
      const px = G.cx(gx);
      let inside = false, l1 = 0, l2 = 0;
      if (Math.abs(d) > 1e-12) {
        l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        inside = l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6;
      }
      if (!inside && pad > 0) {
        const dd = Math.min(segDist(px, pz, ax, az, bx, bz), segDist(px, pz, bx, bz, cx, cz), segDist(px, pz, cx, cz, ax, az));
        if (dd > pad) continue;
      } else if (!inside) continue;
      fn(gz * G.nx + gx, l1, l2, inside);
    }
  }
}

// Surface classes mirror the terrain module's adopted rule: paving inside the plaza boundary and
// the adopted connector/forecourt polygons, asphalt inside road polygons (walk = 1); anything else
// is "ground" (walk = 2), usable only where visible from the route (checked when sampling).
export function rasterGround(ctx, G) {
  const g = ctx.data.ground;
  if (g && g.polygons) {
    g.polygons.forEach((tri) => {
      if (tri.length !== 3) return;
      const [a, b, c] = tri;
      rasterTri(G, a[0], a[2], b[0], b[2], c[0], c[2], 0, (id, l1, l2) => {
        if (Number.isNaN(G.gy[id])) G.gy[id] = l1 * a[1] + l2 * b[1] + (1 - l1 - l2) * c[1];
        if (!G.walk[id]) G.walk[id] = 2;
      });
    });
  }
  const rings = [];
  const pb = ctx.data.plaza && ctx.data.plaza.boundary_m;
  if (pb) rings.push(pb.map((p) => [p[0], p[2]]));
  const rs = ctx.data.decisions && ctx.data.decisions.routeSurfaces;
  for (const sfc of (rs && rs.connector_surfaces) || []) if (sfc.boundary_m) rings.push(sfc.boundary_m.map((p) => [p[0], p[2]]));
  for (const r of ctx.data.roads || []) rings.push(r.polygon.map((p) => [p[0], p[2]]));
  for (const ring of rings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const gx0 = Math.max(0, Math.floor((x0 - G.minX) / CELL)), gx1 = Math.min(G.nx - 1, Math.floor((x1 - G.minX) / CELL));
    const gz0 = Math.max(0, Math.floor((z0 - G.minZ) / CELL)), gz1 = Math.min(G.nz - 1, Math.floor((z1 - G.minZ) / CELL));
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const id = gz * G.nx + gx;
      if (G.walk[id] === 1) continue;
      if (pointInPolygon(G.cx(gx), G.cz(gz), ring)) G.walk[id] = 1;
    }
  }
}

/** Line of sight on the grid from (x,z) to (tx,tz) not crossing building cells. */
export function clearLine(G, x, z, tx, tz) {
  const L = Math.hypot(tx - x, tz - z);
  const n = Math.ceil(L / (CELL * 0.8));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const id = G.idx(x + (tx - x) * t, z + (tz - z) * t);
    if (id >= 0 && G.block[id] === 1) return false;
  }
  return true;
}

export function rasterBuildings(ctx, G) {
  const m = WALL_CLEAR;
  for (const b of ctx.data.buildings) {
    const fp = b.footprint;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of fp) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const gx0 = Math.max(0, Math.floor((x0 - m - G.minX) / CELL)), gx1 = Math.min(G.nx - 1, Math.floor((x1 + m - G.minX) / CELL));
    const gz0 = Math.max(0, Math.floor((z0 - m - G.minZ) / CELL)), gz1 = Math.min(G.nz - 1, Math.floor((z1 + m - G.minZ) / CELL));
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const id = gz * G.nx + gx;
      if (G.block[id]) continue;
      const px = G.cx(gx), pz = G.cz(gz);
      if (pointInPolygon(px, pz, fp)) { G.block[id] = 1; continue; }
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i], c = fp[(i + 1) % fp.length];
        if (segDist(px, pz, a[0], a[1], c[0], c[1]) < m) { G.block[id] = 1; break; }
      }
    }
  }
}

export function rasterObstacles(ctx, G) {
  for (const o of ctx.data.obstacles || []) {
    if (o.collision_role === 'overhead' && (o.min_height_above_ground_m || 0) > 2.0) continue;
    const ring = o.footprint_xz;
    const pad = BODY_R + 0.15;
    for (let i = 1; i < ring.length - 1; i++) {
      rasterTri(G, ring[0][0], ring[0][1], ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], pad, (id) => { if (!G.block[id]) G.block[id] = 3; });
    }
  }
}

// Ground surface actually built by the terrain module (upward-facing triangles near the DEM).
export function rasterTerrainHeights(ctx, G) {
  const THREE = ctx.THREE;
  const tg = ctx.scene.children.find((o) => o.name === 'terrain');
  if (!tg) return false;
  tg.updateMatrixWorld(true);
  const hmax = new Float32Array(G.walk.length).fill(-Infinity);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  let used = 0;
  tg.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, index = o.geometry.index;
    const n = index ? index.count : pos.count;
    const mw = o.matrixWorld;
    for (let i = 0; i < n; i += 3) {
      const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, ia).applyMatrix4(mw); vb.fromBufferAttribute(pos, ib).applyMatrix4(mw); vc.fromBufferAttribute(pos, ic).applyMatrix4(mw);
      if (Math.max(va.x, vb.x, vc.x) < G.minX || Math.min(va.x, vb.x, vc.x) > G.maxX || Math.max(va.z, vb.z, vc.z) < G.minZ || Math.min(va.z, vb.z, vc.z) > G.maxZ) continue;
      const ux = vb.x - va.x, uy = vb.y - va.y, uz = vb.z - va.z, wx = vc.x - va.x, wy = vc.y - va.y, wz = vc.z - va.z;
      const ny = uz * wx - ux * wz, nx = uy * wz - uz * wy, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9 || Math.abs(ny) / nl < 0.75) continue;
      used++;
      rasterTri(G, va.x, va.z, vb.x, vb.z, vc.x, vc.z, 0, (id, l1, l2) => {
        const y = l1 * va.y + l2 * vb.y + (1 - l1 - l2) * vc.y;
        if (y > hmax[id]) hmax[id] = y;
      });
    }
  });
  if (!used) return false;
  for (let id = 0; id < hmax.length; id++) {
    if (hmax[id] === -Infinity) continue;
    const base = G.gy[id];
    if (Number.isNaN(base) || (hmax[id] - base < 0.6 && hmax[id] - base > -0.3)) G.gy[id] = hmax[id];
  }
  return true;
}

// Mark cells occupied by other modules' things at body height (standing signs, poles, bikes...).
export function rasterSceneProps(ctx, G, names = ['signage', 'landmarks', 'streetprops']) {
  const THREE = ctx.THREE;
  const box = new THREE.Box3(), m4 = new THREE.Matrix4(), mi = new THREE.Matrix4();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const pad = BODY_R;
  let marked = 0;
  const groundAt = (x, z) => { const id = G.idx(x, z); const y = id >= 0 ? G.gy[id] : NaN; return Number.isNaN(y) ? ctx.data.heightAt(x, z) : y; };
  const markBox = (bb) => {
    const x0 = Math.max(0, Math.floor((bb.min.x - pad - G.minX) / CELL)), x1 = Math.min(G.nx - 1, Math.floor((bb.max.x + pad - G.minX) / CELL));
    const z0 = Math.max(0, Math.floor((bb.min.z - pad - G.minZ) / CELL)), z1 = Math.min(G.nz - 1, Math.floor((bb.max.z + pad - G.minZ) / CELL));
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) { const id = gz * G.nx + gx; if (!G.block[id]) G.block[id] = 2; marked++; }
  };
  const markTris = (geo, mat) => {
    const pos = geo.attributes.position, index = geo.index;
    const n = index ? index.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, ia).applyMatrix4(mat); vb.fromBufferAttribute(pos, ib).applyMatrix4(mat); vc.fromBufferAttribute(pos, ic).applyMatrix4(mat);
      const cxm = (va.x + vb.x + vc.x) / 3, czm = (va.z + vb.z + vc.z) / 3;
      if (cxm < G.minX - 5 || cxm > G.maxX + 5 || czm < G.minZ - 5 || czm > G.maxZ + 5) continue;
      const g0 = groundAt(cxm, czm);
      const lo = Math.min(va.y, vb.y, vc.y), hi = Math.max(va.y, vb.y, vc.y);
      if (hi < g0 + 0.3 || lo > g0 + 1.95) continue;
      rasterTri(G, va.x, va.z, vb.x, vb.z, vc.x, vc.z, pad, (id) => { if (!G.block[id]) G.block[id] = 2; marked++; });
    }
  };
  const visit = (geo, mat) => {
    box.copy(geo.boundingBox).applyMatrix4(mat);
    if (box.max.x < G.minX || box.min.x > G.maxX || box.max.z < G.minZ || box.min.z > G.maxZ) return;
    const g0 = groundAt((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
    if (box.max.y < g0 + 0.3 || box.min.y > g0 + 1.95) return;
    if (box.max.x - box.min.x < 3 && box.max.z - box.min.z < 3) markBox(box);
    else markTris(geo, mat);
  };
  for (const name of names) {
    const grp = ctx.scene.children.find((o) => o.name === name);
    if (!grp) continue;
    grp.updateMatrixWorld(true);
    grp.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mt && (mt.visible === false || (mt.transparent && mt.opacity < 0.25) || mt.blending === THREE.AdditiveBlending)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, mi); m4.multiplyMatrices(o.matrixWorld, mi); visit(o.geometry, m4); }
      } else visit(o.geometry, o.matrixWorld);
    });
  }
  return marked;
}

/** Route distance, nearest segment and tangent (xz) for a point. */
export function routeInfo(route, x, z) {
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
    const d = Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  const a = route[bi], b = route[Math.min(route.length - 1, bi + 1)];
  const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  return { d: best, seg: bi, t: bt, tan: [(b[0] - a[0]) / tl, (b[2] - a[2]) / tl], foot: [a[0] + (b[0] - a[0]) * bt, a[2] + (b[2] - a[2]) * bt] };
}

export function computeRouteDistances(ctx, G) {
  const rd = ctx.data.routeDistance;
  for (let gz = 0; gz < G.nz; gz++) for (let gx = 0; gx < G.nx; gx++) {
    const id = gz * G.nx + gx;
    if (!G.walk[id] || G.block[id]) continue;
    G.rd[id] = rd(G.cx(gx), G.cz(gz));
  }
}

/** Is a (sub-cell) position free for a person of radius r? Checks cells around it. */
export function freeAt(G, x, z, minRoute) {
  const id = G.idx(x, z);
  if (id < 0 || !G.walk[id] || G.block[id]) return false;
  const rd = G.rd[id];
  if (!(rd >= minRoute)) return false;
  // neighbours: ground present, unblocked and flat enough (no kerb edge under the feet)
  let lo = Infinity, hi = -Infinity;
  for (const [ox, oz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
    const j = G.idx(x + ox, z + oz);
    if (j < 0 || G.block[j] || Number.isNaN(G.gy[j])) return false;
    lo = Math.min(lo, G.gy[j]); hi = Math.max(hi, G.gy[j]);
  }
  return hi - lo < 0.07;
}
