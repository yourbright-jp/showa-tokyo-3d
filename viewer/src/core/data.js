// Loads the repository's scene data (no new geometry is invented here).
// Coordinates: metres, right-handed, x=east, y=up (orthometric - 32 m datum), z=south.
const SCENE_DIR = '/scenes/shinjuku/kabukicho/1976';
// Supplementary review cameras (not route stations). Loaded for every render so that modules
// which keep camera foregrounds clear (people) build the same world whichever camera is used.
export const REVIEW_VIEWS = ['r04-gate-establishing'];

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

function pointSegDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

export async function loadData() {
  // The adopted 1976 reconstruction (PR #7) is the canonical world: adopted massing heights,
  // landmark forms, fixtures, stable sign text, obstacles and the long walk. The R01 layout
  // features are still loaded for the road polygons used by facade analysis.
  const [sceneDef, layout, terrainRaw, period, walk, gateDecision, komaDecision, surfaceDecision, refIndex] = await Promise.all([
    getJSON(`${SCENE_DIR}/scene.json`),
    getJSON('/data/derived/kabukicho-layout-features.json'),
    getJSON('/data/derived/kabukicho-terrain.json'),
    getJSON('/data/derived/kabukicho-period-features.json'),
    getJSON(`${SCENE_DIR}/cameras/adopted-walk.json`),
    getJSON('/data/decisions/kabukicho-gate-1976.json'),
    getJSON('/data/decisions/kabukicho-koma-plaza-1976.json'),
    getJSON('/data/decisions/kabukicho-route-surfaces-1976.json'),
    getJSON(`${SCENE_DIR}/references/approved-colour-index.json`),
  ]);
  const stationIds = sceneDef.route.stations.map((s) => s.id);
  const cameras = Object.fromEntries(await Promise.all(stationIds.map(async (id) => [id, await getJSON(`${SCENE_DIR}/cameras/${id}.json`)])));
  const reviewCameras = Object.fromEntries(await Promise.all(REVIEW_VIEWS.map(async (id) => [id, await getJSON(`${SCENE_DIR}/cameras/${id}.json`)])));

  const terrain = buildTerrain(terrainRaw);
  const buildings = [];
  const fixtures = [];
  const facadeFeatures = [];
  let ground = null;
  for (const f of period.features) {
    if (f.kind === 'building' && f.role !== 'stable-sign-lettering' && f.polygons) {
      const fp = bottomFootprint(f.polygons);
      let footprint = f.footprint_xz || (fp && fp.ring);
      if (!footprint || !fp) continue;
      if (footprint.length > 3) {
        const a = footprint[0], z = footprint[footprint.length - 1];
        if (Math.abs(a[0] - z[0]) < 1e-6 && Math.abs(a[1] - z[1]) < 1e-6) footprint = footprint.slice(0, -1);
      }
      const landmark = !!f.adopted_identity;
      buildings.push({
        id: f.id, name: f.name, footprint, baseY: fp.minY, topY: fp.maxY, height: fp.maxY - fp.minY,
        status: f.historical_status, truth: f.historical_truth_status, decisionId: f.decision_id,
        // `proxy` kept for compatibility: true for landmark masses owned by the landmarks module
        proxy: landmark, landmark, adoptedIdentity: f.adopted_identity || null,
        materialKey: f.material_key, near: f.periodization === 'massing-and-near-route-facade',
        sourceHeight: f.source_height_m ?? null, feature: f,
      });
    } else if (f.kind === 'fixture') {
      fixtures.push(f);
    } else if (f.kind === 'facade') {
      facadeFeatures.push(f);
    } else if (f.kind === 'terrain') {
      ground = f;
    }
  }
  for (const b of buildings) {
    if (signedArea(b.footprint) < 0) b.footprint = b.footprint.slice().reverse(); // CCW in (x,z)
    let cx = 0, cz = 0;
    for (const [x, z] of b.footprint) { cx += x; cz += z; }
    b.centroid = [cx / b.footprint.length, cz / b.footprint.length];
  }
  const roads = [];
  for (const f of layout.features) {
    if (f.kind === 'road' && f.polygons) for (const poly of f.polygons) roads.push({ id: f.id, polygon: poly });
  }

  // Walk path (adopted long take) as the route for distance/LOD queries; stations kept separately.
  const route = [];
  let last = null;
  for (const s of walk.samples) {
    const g = s.ground_position_m;
    if (!last || Math.hypot(g[0] - last[0], g[2] - last[2]) > 2) { route.push(g); last = g; }
  }
  const lastG = walk.samples[walk.samples.length - 1].ground_position_m;
  if (route[route.length - 1] !== lastG) route.push(lastG);
  function routeDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i < route.length - 1; i++) best = Math.min(best, pointSegDist(x, z, route[i][0], route[i][2], route[i + 1][0], route[i + 1][2]));
    return best;
  }
  function walkPose(t) {
    const S = walk.samples;
    if (t <= S[0].time_s) return S[0];
    if (t >= S[S.length - 1].time_s) return S[S.length - 1];
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid].time_s <= t) lo = mid; else hi = mid; }
    const a = S[lo], b = S[hi];
    const u = (t - a.time_s) / Math.max(1e-9, b.time_s - a.time_s);
    const lerp = (p, q) => p.map((v, i) => v + (q[i] - v) * u);
    return { time_s: t, position_m: lerp(a.position_m, b.position_m), look_at_m: lerp(a.look_at_m, b.look_at_m), quaternion_xyzw: [a.quaternion_xyzw, b.quaternion_xyzw, u] };
  }

  const plazaBoundary = (period.plaza && period.plaza.boundary_m) || (layout.plaza && layout.plaza.boundary_m);
  return {
    sceneDef,
    cameras,
    reviewCameras,
    stations: sceneDef.route.stations,
    route,
    routeDistance,
    walk,
    walkPose,
    buildings,
    fixtures,
    facadeFeatures,
    textNodes: period.text_nodes,
    obstacles: period.obstacles,
    ground, // period terrain feature: polygons + polygon_material_keys (ground/asphalt/paving)
    decisions: { gate: gateDecision, komaPlaza: komaDecision, routeSurfaces: surfaceDecision, list: period.decisions },
    roads,
    plaza: { ...(layout.plaza || {}), ...(period.plaza || {}), boundary_m: plazaBoundary },
    hypothesis: null,
    references: refIndex.references,
    terrain,
    heightAt: terrain.heightAt,
  };
}
