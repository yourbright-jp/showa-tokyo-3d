import * as THREE from 'three';
import { pointInPolygon } from '../../core/facades.js';

// Placement context for street props:
//  - groundAt(x,z): top of whatever the terrain module built (kerbs, paving), else the DEM TIN
//  - clearance tests against the walk corridor, building footprints, adopted obstacles
//  - an occupancy voxel grid built from geometry already in the scene (signage, landmarks), so
//    poles, wires and clutter do not penetrate awnings, projecting signs, planters or benches
//    built by modules that ran earlier. Own placements are marked into the same grid.

const VOX = 0.25;
const vkey = (ix, iy, iz) => (ix + 4096) + (iz + 4096) * 8192 + (iy + 64) * 67108864;

/** Calls fn(ax,ay,az,bx,by,bz,cx,cy,cz) for every world-space triangle of meshes under root. */
export function forEachTriangle(root, fn, filter) {
  root.updateMatrixWorld(true);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const mw = new THREE.Matrix4(), im = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (filter && !filter(o)) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const count = idx ? idx.count : pos.count;
    const instances = o.isInstancedMesh ? o.count : 1;
    for (let inst = 0; inst < instances; inst++) {
      if (o.isInstancedMesh) { o.getMatrixAt(inst, im); mw.multiplyMatrices(o.matrixWorld, im); } else mw.copy(o.matrixWorld);
      for (let k = 0; k + 2 < count; k += 3) {
        const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
        va.fromBufferAttribute(pos, i0).applyMatrix4(mw);
        vb.fromBufferAttribute(pos, i1).applyMatrix4(mw);
        vc.fromBufferAttribute(pos, i2).applyMatrix4(mw);
        fn(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
      }
    }
  });
}

export function makeSite(ctx) {
  const { data, scene } = ctx;
  const t0 = performance.now();
  const stats = {};

  // ---- building footprint index ----
  const BC = 6;
  const bgrid = new Map();
  const bkey = (gx, gz) => gx * 100003 + gz;
  for (const b of data.buildings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.footprint) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    b._bb = [x0, z0, x1, z1];
    for (let gx = Math.floor(x0 / BC); gx <= Math.floor(x1 / BC); gx++) for (let gz = Math.floor(z0 / BC); gz <= Math.floor(z1 / BC); gz++) {
      const k = bkey(gx, gz); if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b);
    }
  }
  function nearBuildings(x, z, r = 0) {
    const out = new Set();
    for (let gx = Math.floor((x - r) / BC); gx <= Math.floor((x + r) / BC); gx++) for (let gz = Math.floor((z - r) / BC); gz <= Math.floor((z + r) / BC); gz++) {
      const l = bgrid.get(bkey(gx, gz)); if (l) for (const b of l) out.add(b);
    }
    return out;
  }
  function segDist(x, z, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
    return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
  }
  /** Signed-ish: returns -1 if inside a building, else distance to the nearest footprint edge (capped at r). */
  function wallDistance(x, z, r = 6) {
    let best = r;
    for (const b of nearBuildings(x, z, r)) {
      if (x < b._bb[0] - r || x > b._bb[2] + r || z < b._bb[1] - r || z > b._bb[3] + r) continue;
      if (pointInPolygon(x, z, b.footprint)) return -1;
      const fp = b.footprint;
      for (let i = 0; i < fp.length; i++) best = Math.min(best, segDist(x, z, fp[i], fp[(i + 1) % fp.length]));
    }
    return best;
  }

  /** Point inside a building volume (footprint grown by margin, between base and top)? */
  function insideBuilding3D(x, y, z, margin = 0) {
    for (const b of nearBuildings(x, z, margin)) {
      if (y > b.topY + 0.3 || y < b.baseY - 0.5) continue;
      if (x < b._bb[0] - margin || x > b._bb[2] + margin || z < b._bb[1] - margin || z > b._bb[3] + margin) continue;
      if (pointInPolygon(x, z, b.footprint)) return true;
      if (margin > 0) {
        const fp = b.footprint;
        for (let i = 0; i < fp.length; i++) if (segDist(x, z, fp[i], fp[(i + 1) % fp.length]) < margin) return true;
      }
    }
    return false;
  }

  // ---- adopted obstacles + fixtures ----
  const obstacles = (data.obstacles || []).map((o) => ({ id: o.id, ring: o.footprint_xz }));
  // overhead obstacles (gate body, lamp crowns, canopies) do not block ground-level props
  const groundObstacles = obstacles.filter((o) => !/overhead|canopy/.test(o.id));
  function obstacleDistance(x, z, r = 3, groundOnly = false) {
    let best = r;
    for (const o of groundOnly ? groundObstacles : obstacles) {
      if (pointInPolygon(x, z, o.ring)) return -1;
      for (let i = 0; i < o.ring.length; i++) best = Math.min(best, segDist(x, z, o.ring[i], o.ring[(i + 1) % o.ring.length]));
    }
    return best;
  }
  const plazaRing = data.plaza && data.plaza.boundary_m ? data.plaza.boundary_m.map((p) => [p[0], p[2]]) : null;
  const inPlaza = (x, z) => (plazaRing ? pointInPolygon(x, z, plazaRing) : false);

  // ---- ground from the terrain module's geometry ----
  const GC = 2;
  const ggrid = new Map();
  const tris = [];
  const terrainGroup = scene.getObjectByName('terrain');
  if (terrainGroup) {
    forEachTriangle(terrainGroup, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
      // upward-facing only
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9 || Math.abs(ny) / nl < 0.35) return;
      const id = tris.length;
      tris.push([ax, ay, az, bx, by, bz, cx, cy, cz]);
      const x0 = Math.floor(Math.min(ax, bx, cx) / GC), x1 = Math.floor(Math.max(ax, bx, cx) / GC);
      const z0 = Math.floor(Math.min(az, bz, cz) / GC), z1 = Math.floor(Math.max(az, bz, cz) / GC);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4000) return;
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = bkey(gx, gz); let l = ggrid.get(k); if (!l) { l = []; ggrid.set(k, l); } l.push(id);
      }
    });
  }
  stats.groundTris = tris.length;
  function groundAt(x, z) {
    const h0 = data.heightAt(x, z);
    const l = ggrid.get(bkey(Math.floor(x / GC), Math.floor(z / GC)));
    if (!l) return h0;
    let best = -Infinity;
    for (const id of l) {
      const t = tris[id];
      const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d;
      const l2 = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-5 || l2 < -1e-5 || l3 < -1e-5) continue;
      const y = l1 * t[1] + l2 * t[4] + l3 * t[7];
      if (y <= h0 + 0.7 && y >= h0 - 0.6 && y > best) best = y;
    }
    return best > -Infinity ? best : h0;
  }
  /** Highest ground under a rotated rectangle footprint (so nothing sinks on kerbs/slopes). */
  function groundUnder(cx, cz, hx, hz, ry = 0) {
    const c = Math.cos(ry), s = Math.sin(ry);
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[0, 0], [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
      const x = cx + u * c + v * s, z = cz - u * s + v * c;
      const y = groundAt(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return { lo, hi };
  }

  // ---- occupancy voxels ----
  const occ = new Set();
  const occWire = new Set(); // own poles and wires: block props and lamps, but not other wires
  // ROI mask (1 m cells) near the route and the entrance/main road
  const RM = 1, rx0 = -175, rz0 = -175, rnx = 230, rnz = 330;
  const roi = new Uint8Array(rnx * rnz);
  for (let i = 0; i < rnx; i++) for (let j = 0; j < rnz; j++) {
    const x = rx0 + (i + 0.5) * RM, z = rz0 + (j + 0.5) * RM;
    if (data.routeDistance(x, z) < 22 || (x > -150 && x < -20 && z > 55 && z < 125)) roi[i * rnz + j] = 1;
  }
  const inRoi = (x, z) => {
    const i = Math.floor((x - rx0) / RM), j = Math.floor((z - rz0) / RM);
    return i >= 0 && j >= 0 && i < rnx && j < rnz && roi[i * rnz + j] === 1;
  };
  function markPoint(x, y, z) { occ.add(vkey(Math.floor(x / VOX), Math.floor(y / VOX), Math.floor(z / VOX))); }
  let sampled = 0;
  function rasterTriangle(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx), minz = Math.min(az, bz, cz), maxz = Math.max(az, bz, cz);
    const midx = (minx + maxx) / 2, midz = (minz + maxz) / 2;
    if (!(inRoi(minx, minz) || inRoi(maxx, maxz) || inRoi(minx, maxz) || inRoi(maxx, minz) || inRoi(midx, midz))) return;
    const ground = data.heightAt(midx, midz);
    if (Math.min(ay, by, cy) > ground + 22 || Math.max(ay, by, cy) < ground - 1) return;
    const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.min(160, Math.max(1, Math.ceil(e / 0.2)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n;
      markPoint(ax + (bx - ax) * u + (cx - ax) * v, ay + (by - ay) * u + (cy - ay) * v, az + (bz - az) * u + (cz - az) * v);
      sampled++;
    }
  }
  const probed = [];
  for (const name of ['signage', 'landmarks']) {
    const g = scene.getObjectByName(name);
    if (!g) continue;
    probed.push(name);
    forEachTriangle(g, rasterTriangle, (o) => !(o.material && o.material.blending === THREE.AdditiveBlending) && o.visible !== false);
  }
  stats.probed = probed; stats.occVoxels = occ.size; stats.samples = sampled;

  function occupied(x, y, z, withWires = true) {
    const k = vkey(Math.floor(x / VOX), Math.floor(y / VOX), Math.floor(z / VOX));
    return occ.has(k) || (withWires && occWire.has(k));
  }
  /** Rotated box (half extents hx,hz around centre, heading ry) between absolute y0..y1. */
  function boxFree(cx, cz, hx, hz, ry, y0, y1, pad = 0.05) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const ex = hx + pad, ez = hz + pad;
    const nx = Math.max(1, Math.ceil((2 * ex) / 0.2)), nz = Math.max(1, Math.ceil((2 * ez) / 0.2)), ny = Math.max(1, Math.ceil((y1 - y0) / 0.2));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const u = -ex + (2 * ex * i) / nx, v = -ez + (2 * ez * j) / nz;
      const x = cx + u * c + v * s, z = cz - u * s + v * c;
      for (let k = 0; k <= ny; k++) if (occupied(x, y0 + ((y1 - y0) * k) / ny, z)) return false;
    }
    return true;
  }
  function markBox(cx, cz, hx, hz, ry, y0, y1, layer = 'prop') {
    const set = layer === 'wire' ? occWire : occ;
    const c = Math.cos(ry), s = Math.sin(ry);
    const nx = Math.max(1, Math.ceil((2 * hx) / 0.2)), nz = Math.max(1, Math.ceil((2 * hz) / 0.2)), ny = Math.max(1, Math.ceil((y1 - y0) / 0.2));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const u = -hx + (2 * hx * i) / nx, v = -hz + (2 * hz * j) / nz;
      const x = cx + u * c + v * s, z = cz - u * s + v * c;
      for (let k = 0; k <= ny; k++) { const y = y0 + ((y1 - y0) * k) / ny; set.add(vkey(Math.floor(x / VOX), Math.floor(y / VOX), Math.floor(z / VOX))); }
    }
  }
  /** Polyline of world points free (with radius r)? */
  let lastBlock = null;
  function pathFree(pts, r = 0.05, skipStart = 0, skipEnd = 0) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const n = Math.max(1, Math.ceil(L / 0.15));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
        acc += L / n;
        if (acc < skipStart || acc > total - skipEnd) continue;
        if (insideBuilding3D(x, y, z, 0.08)) { lastBlock = 'building'; return false; }
        lastBlock = 'occupied';
        if (occupied(x, y, z, false) || (r > VOX * 0.5 && (occupied(x + r, y, z, false) || occupied(x - r, y, z, false) || occupied(x, y, z + r, false) || occupied(x, y, z - r, false)))) return false;
      }
    }
    return true;
  }
  function markPath(pts, r = 0.1) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const n = Math.max(1, Math.ceil(L / 0.2));
      for (let k = 0; k <= n; k++) { const t = k / n; occWire.add(vkey(Math.floor((a[0] + (b[0] - a[0]) * t) / VOX), Math.floor((a[1] + (b[1] - a[1]) * t) / VOX), Math.floor((a[2] + (b[2] - a[2]) * t) / VOX))); }
    }
  }

  // ---- footprint clearance (ground props) ----
  const CORRIDOR = 1.2;
  /**
   * Is a rotated footprint clear of the walk corridor, buildings (wall margin), adopted
   * obstacles and occupied voxels between y0..y1 above ground?
   */
  function footprintClear(cx, cz, hx, hz, ry, { h = 1.2, wall = 0.36, corridor = CORRIDOR + 0.15, obstacle = 0.35, plazaOk = true, yFrom = 0.06, maxStep = 0.07 } = {}) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const pts = [[0, 0], [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, -hz], [0, hz], [-hx, 0], [hx, 0]];
    for (const [u, v] of pts) {
      const x = cx + u * c + v * s, z = cz - u * s + v * c;
      if (data.routeDistance(x, z) < corridor) return false;
      if (wallDistance(x, z, wall + 0.5) < wall) return false;
      if (obstacleDistance(x, z, obstacle + 0.5, h < 2.2) < obstacle) return false;
      if (!plazaOk && inPlaza(x, z)) return false;
    }
    const gu = groundUnder(cx, cz, hx, hz, ry);
    if (gu.hi - gu.lo > maxStep) return false; // straddles a kerb or step
    const g = groundAt(cx, cz);
    return boxFree(cx, cz, hx, hz, ry, g + yFrom, g + h);
  }

  stats.ms = Math.round(performance.now() - t0);
  return {
    groundAt, groundUnder, wallDistance, obstacleDistance, inPlaza, nearBuildings, insideBuilding3D,
    occupied, boxFree, markBox, pathFree, markPath, footprintClear, stats,
    routeDistance: data.routeDistance, CORRIDOR, get lastBlock() { return lastBlock; },
  };
}
