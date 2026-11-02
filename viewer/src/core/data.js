// Loads the repository's scene data (no new geometry is invented here).
// Coordinates: metres, right-handed, x=east, y=up (orthometric - 32 m datum), z=south.
const SCENE_DIR = '/scenes/shinjuku/kabukicho/1976';

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch failed ${path}: ${res.status}`);
  return res.json();
}

function bottomFootprint(polygons) {
  // PLATEAU LOD1 prisms: the base face is the polygon whose vertices all share the minimum y.
  let minY = Infinity, maxY = -Infinity;
  for (const poly of polygons) for (const p of poly) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  let best = null;
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    if (poly.every((p) => Math.abs(p[1] - minY) < 1e-3)) {
      if (!best || poly.length > best.length) best = poly;
    }
  }
  if (!best) return null;
  let ring = best.map((p) => [p[0], p[2]]);
  if (ring.length > 3) {
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) ring = ring.slice(0, -1);
  }
  return { ring, minY, maxY };
}

export function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

function buildTerrain(t) {
  const V = t.vertices_m;
  const T = t.triangles;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const v of V) { minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]); minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]); }
  const cell = 8;
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const grid = Array.from({ length: nx * nz }, () => []);
  T.forEach((tri, ti) => {
    const xs = tri.map((i) => V[i][0]), zs = tri.map((i) => V[i][2]);
    const x0 = Math.floor((Math.min(...xs) - minX) / cell), x1 = Math.floor((Math.max(...xs) - minX) / cell);
    const z0 = Math.floor((Math.min(...zs) - minZ) / cell), z1 = Math.floor((Math.max(...zs) - minZ) / cell);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) grid[gz * nx + gx].push(ti);
  });
  let lastFallback = 0;
  function heightAt(x, z) {
    const gx = Math.floor((x - minX) / cell), gz = Math.floor((z - minZ) / cell);
    if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) return lastFallback;
    for (const ti of grid[gz * nx + gx]) {
      const [a, b, c] = T[ti].map((i) => V[i]);
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) {
        lastFallback = l1 * a[1] + l2 * b[1] + l3 * c[1];
        return lastFallback;
      }
    }
    return lastFallback;
  }
  return { vertices: V, triangles: T, bounds: { minX, maxX, minZ, maxZ }, heightAt };
}

export async function loadData() {
  const [sceneDef, layout, terrainRaw, hypothesis, refIndex] = await Promise.all([
    getJSON(`${SCENE_DIR}/scene.json`),
    getJSON('/data/derived/kabukicho-layout-features.json'),
    getJSON('/data/derived/kabukicho-terrain.json'),
    getJSON('/data/kabukicho-layout-hypothesis.json'),
    getJSON(`${SCENE_DIR}/references/approved-colour-index.json`),
  ]);
  const stationIds = sceneDef.route.stations.map((s) => s.id);
  const cameras = Object.fromEntries(await Promise.all(stationIds.map(async (id) => [id, await getJSON(`${SCENE_DIR}/cameras/${id}.json`)])));

  const terrain = buildTerrain(terrainRaw);
  const buildings = [];
  const roads = [];
  for (const f of layout.features) {
    if (f.kind === 'building') {
      if (f.footprint_xz) {
        const baseY = (f.base_orthometric_height_m_assumption ?? 32) - 32;
        buildings.push({ id: f.id, name: f.name, footprint: f.footprint_xz, baseY, topY: baseY + f.height_m, height: f.height_m, status: f.historical_status, proxy: true, heightVerified: !!f.height_verified, surveyYear: null });
      } else if (f.polygons) {
        const fp = bottomFootprint(f.polygons);
        if (!fp) continue;
        buildings.push({ id: f.id, name: f.name, footprint: fp.ring, baseY: fp.minY, topY: fp.maxY, height: fp.maxY - fp.minY, status: f.historical_status, proxy: false, heightVerified: false, surveyYear: f.source_survey_year });
      }
    } else if (f.kind === 'road' && f.polygons) {
      for (const poly of f.polygons) roads.push({ id: f.id, polygon: poly });
    }
  }
  for (const b of buildings) {
    if (signedArea(b.footprint) < 0) b.footprint = b.footprint.slice().reverse(); // CCW in (x,z)
    let cx = 0, cz = 0;
    for (const [x, z] of b.footprint) { cx += x; cz += z; }
    b.centroid = [cx / b.footprint.length, cz / b.footprint.length];
  }

  const routePts = sceneDef.route.geometry.coordinates;
  function routeDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i < routePts.length - 1; i++) {
      const [ax, , az] = routePts[i];
      const [bx, , bz] = routePts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
    return best;
  }

  return {
    sceneDef,
    cameras,
    stations: sceneDef.route.stations,
    route: routePts,
    routeDistance,
    buildings,
    roads,
    plaza: layout.plaza,
    hypothesis,
    references: refIndex.references,
    terrain,
    heightAt: terrain.heightAt,
  };
}
