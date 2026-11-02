import * as THREE from 'three';
import { buildLayout } from './terrain/layout.js';
import { makeNoiseTexture, makeAsphaltTextures, makeConcreteTextures, makeStoneTextures, makeCrackTexture } from './terrain/detail.js';
import { paintMacroTile, paintCoarse } from './terrain/macro.js';
import { makeGroundMaterial } from './terrain/material.js';
import { buildFeatures } from './terrain/features.js';

// Ground surfaces for Kabukicho c.1976.
//  Geometry: the adopted period ground = modern PLATEAU DEM TIN, kept exactly (other modules
//  ground their objects with ctx.data.heightAt, so walkable surfaces stay flush with it).
//  Surface classes: the adopted rule (paving in plaza/connector/forecourt polygons, asphalt in road
//  polygons, else ground), evaluated per macro texel. Near the walk two detailed macro tiles
//  (6 cm and 5 cm per texel) carry grime, stains, patches and tar seams (road paint is decals); the rest of the
//  TIN uses a 0.5 m class map. Materials, patterns, kerbs, gutters, covers and markings are
//  period-plausible generic choices, not documented 1976 surfaces.
const TILES = [
  { name: 'street', x0: -130, x1: -36, z0: -70, z1: 116, res: 0.06, inner: [-126, -66, -40, 112] },
  { name: 'plaza', x0: -108, x1: -2, z0: -138, z1: -50, res: 0.05, inner: [-104, -134, -6, -54] },
];

export async function build(ctx) {
  const T0 = performance.now();
  const timings = {};
  const lap = (k, t) => { timings[k] = Math.round(performance.now() - t); };
  const group = new THREE.Group();

  let t = performance.now();
  const L = buildLayout(ctx);
  lap('layout', t);

  t = performance.now();
  const tk = {}; const timed = (k, f) => { const t1 = performance.now(); const r = f(); tk[k] = Math.round(performance.now() - t1); return r; };
  const shared = {
    noise: timed('noise', () => makeNoiseTexture(ctx)),
    asph: timed('asph', () => makeAsphaltTextures(ctx)),
    conc: timed('conc', () => makeConcreteTextures(ctx)),
    stone: timed('stone', () => makeStoneTextures(ctx)),
    crack: timed('crack', () => makeCrackTexture(ctx)),
  };
  timings.detailSplit = tk;
  lap('detailTextures', t);

  // ---------------------------------------------------------------- TIN geometry split by tile
  t = performance.now();
  const { terrain } = ctx.data;
  const V = terrain.vertices, T = terrain.triangles;
  const pos = new Float32Array(V.length * 3);
  V.forEach((v, i) => pos.set(v, i * 3));
  // orientation: make every triangle face up (+y) in a right-handed, y-up frame
  const tris = T.map((tri) => {
    const [a, b, c] = tri;
    const ax = V[a][0], az = V[a][2], bx = V[b][0], bz = V[b][2], cx = V[c][0], cz = V[c][2];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // y of (b-a) x (c-a)
    return ny >= 0 ? [a, b, c] : [a, c, b];
  });
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', posAttr);
  full.setIndex(tris.flat());
  full.computeVertexNormals();
  const normAttr = full.getAttribute('normal');
  const buckets = TILES.map(() => []);
  const far = [];
  const inside = (x, z, r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
  for (const tri of tris) {
    const x = (V[tri[0]][0] + V[tri[1]][0] + V[tri[2]][0]) / 3, z = (V[tri[0]][2] + V[tri[1]][2] + V[tri[2]][2]) / 3;
    let k = -1;
    if (inside(x, z, TILES[1].inner) && z < -60) k = 1;
    else if (inside(x, z, TILES[0].inner)) k = 0;
    else if (inside(x, z, TILES[1].inner)) k = 1;
    if (k >= 0) buckets[k].push(...tri); else far.push(...tri);
  }
  const subGeo = (idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', posAttr);
    g.setAttribute('normal', normAttr);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  lap('geometry', t);

  const matOpts = { shared, gridDir: L.gridDir, foreDir: L.foreDir, foreOrigin: L.foreOrigin };
  t = performance.now();
  TILES.forEach((tile, k) => {
    if (!buckets[k].length) return;
    const tt = performance.now();
    const { t1, t2, W, H, T } = paintMacroTile(ctx, L, tile);
    timings[`macro-${tile.name}`] = `${Math.round(performance.now() - tt)} ms ${W}x${H} ${JSON.stringify(T)}`;
    const mesh = new THREE.Mesh(subGeo(buckets[k]), makeGroundMaterial({ ...matOpts, tile, t1, t2 }));
    mesh.userData.macro = { tile, t1, t2, W, H };
    mesh.name = `ground-${tile.name}`;
    mesh.castShadow = false;
    group.add(mesh);
  });
  const b = terrain.bounds;
  const coarseTile = { x0: Math.floor(b.minX) - 2, x1: Math.ceil(b.maxX) + 2, z0: Math.floor(b.minZ) - 2, z1: Math.ceil(b.maxZ) + 2, res: 0.5 };
  const coarse = paintCoarse(ctx, L, coarseTile);
  const farMesh = new THREE.Mesh(subGeo(far), makeGroundMaterial({ ...matOpts, tile: coarseTile, t1: coarse.t1, far: true }));
  farMesh.name = 'ground-far';
  farMesh.castShadow = false;
  group.add(farMesh);
  lap('macro', t);

  t = performance.now();
  const { group: fg, counts } = buildFeatures(ctx, L);
  group.add(fg);
  lap('features', t);

  // ---------------------------------------------------------------- provenance
  ctx.tag({ id: 'terrain-ground-geometry', module: 'terrain', tier: 'source-derived', note: 'PLATEAU 2025 DEM TIN kept exactly as the adopted period ground (modern reference; 1976 ground levels unverified).' });
  ctx.tag({ id: 'terrain-surface-classes', module: 'terrain', tier: 'adopted-inferred', note: 'Adopted rule of period-ground-surface (kabukicho-route-surfaces-1976 connector + forecourt, plaza hypothesis, modern road polygons) evaluated per 5-6 cm texel near the walk and 0.5 m elsewhere; agrees with the 17,478 adopted per-triangle keys.' });
  ctx.tag({ id: 'terrain-materials', module: 'terrain', tier: 'period-plausible-generic', note: 'Aged asphalt with reinstatement patches, tar-sealed cracks, oil/damp stains and dust; 600 mm grey precast plaza slabs with exposed fine aggregate (after R02) and lighter band slabs every 6 m; 450 mm forecourt slabs aligned to the adopted Koma frontage; broom-finished concrete panels for the ground class. Patterns and colours are not documented.' });
  ctx.tag({ id: 'terrain-arterial-sidewalk-kerb', module: 'terrain', tier: 'period-plausible-generic', note: `Main-road north building line fitted to modern road polygon edges; sidewalk width ${L.sidewalkW} m, flush granite kerb (+30 mm) and L-gutter are estimates; sidewalk kept flush with heightAt so other modules stay grounded.` });
  ctx.tag({ id: 'terrain-crosswalk', module: 'terrain', tier: 'period-plausible-generic', note: 'Pre-1992 ladder-type crosswalk (side lines + 0.45 m bars) across the main road on the gate axis, stop lines, lane and centre lines; R08 (1972) shows a crossing at the old gate; exact 1976 layout unverified.' });
  ctx.tag({ id: 'terrain-gutters-covers', module: 'terrain', tier: 'period-plausible-generic', note: `U-channel gutters with concrete lids and steel grates along external road edges near the walk (${counts.lids || 0} lids, ${counts.grates || 0} grates); generic cast-iron covers without emblems; plaza/forecourt granite edging where surface patterns change.` });

  group.userData.layout = { gutters: L.gutters, manholes: L.manholes, kerbs: L.kerbs, edges: L.edges, patches: L.patches.map((p) => p.ring), crosswalk: L.crosswalk };
  ctx.log(`terrain: ${JSON.stringify(timings)} counts ${JSON.stringify(counts)} total ${Math.round(performance.now() - T0)} ms`);
  return group;
}
