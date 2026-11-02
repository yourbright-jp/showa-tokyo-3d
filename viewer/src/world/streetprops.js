import * as THREE from 'three';
import { Batch } from './streetprops/kit.js';
import { makeMaterials, makeAtlas } from './streetprops/materials.js';
import { makeSite } from './streetprops/site.js';
import { makeStreets } from './streetprops/streets.js';
import { buildPoleNetwork } from './streetprops/poles.js';
import { placeStreetLamps } from './streetprops/lamps.js';
import { buildTraffic } from './streetprops/traffic.js';
import { placeTraffic } from './streetprops/vehicles.js';
import { placeFrontage, placeSingletons } from './streetprops/front.js';

// Street life objects for Kabukicho c.1976: utility poles and overhead wires, shopping-street
// lamps, traffic signals and regulatory signs at the entrance, phone booths, vending machines,
// parked bicycles and step-through motorbikes, cars on the main road south of the entrance,
// bins, crates, plants and shop clutter. Everything is generated in code and deterministic
// (ctx.rng keyed by stable ids). Evidence tier: period-plausible-generic throughout (no prop
// position is documented for 1976); adopted geometry (route corridor, obstacles, gate posts)
// is respected, never moved.

/** Soft contact-shadow decals (ground AO) under props; vertex alpha carries the strength. */
class DecalBatch {
  constructor() { this.p = []; this.uv = []; this.c = []; this.i = []; }
  add(site, x, z, hx, hz, ry, alpha, lift = 0.012, rgb = [0, 0, 0]) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const b = this.p.length / 3;
    for (const [u, v, tu, tv] of [[-hx, -hz, 0, 0], [hx, -hz, 1, 0], [hx, hz, 1, 1], [-hx, hz, 0, 1]]) {
      const wx = x + u * c + v * s, wz = z - u * s + v * c;
      this.p.push(wx, site.groundAt(wx, wz) + lift, wz);
      this.uv.push(tu, tv);
      this.c.push(rgb[0], rgb[1], rgb[2], alpha);
    }
    this.i.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  toMesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 4));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = 'streetprops-contact';
    m.userData.noShadow = true; m.castShadow = false; m.receiveShadow = false;
    m.renderOrder = 1;
    return m;
  }
}

export function build(ctx) {
  const t0 = performance.now();
  const log = ctx.log || console.log;
  const group = new THREE.Group();
  const timings = {};
  const step = (name, fn) => { const t = performance.now(); const r = fn(); timings[name] = Math.round(performance.now() - t); return r; };
  const site = step('site', () => makeSite(ctx));
  const streets = makeStreets(ctx, site);
  const atlasTex = step('atlas', () => makeAtlas(ctx));
  const mats = step('materials', () => makeMaterials(ctx, atlasTex));
  mats.decal.vertexColors = true;

  const B = new Batch();            // opaque props that cast shadows
  const BS = new Batch();           // small opaque details (no shadow casting)
  const BW = new Batch();           // overhead wires (no shadow casting)
  const BA = new Batch({ uv: true }); // printed faces from the atlas
  const BF = new Batch();           // foliage (double sided)
  const BG = new Batch();           // transparent glass
  const D = new DecalBatch();
  const kit = { B, BS, BW, BA, BF, BG, D, site, streets, mats };
  const footprints = [];

  const poles = step('poles', () => buildPoleNetwork(ctx, site, streets, B, BW, BA));
  footprints.push(...poles.footprints);
  for (const f of poles.footprints) D.add(site, f.x, f.z, 0.55, 0.55, 0, 0.55);
  const lamps = step('lamps', () => placeStreetLamps(ctx, site, streets, B, footprints));
  footprints.push(...lamps.footprints);
  for (const f of lamps.footprints) D.add(site, f.x, f.z, 0.5, 0.5, 0, 0.5);
  const traffic = step('traffic', () => buildTraffic(ctx, kit));
  footprints.push(...traffic.footprints);
  const singles = step('singletons', () => placeSingletons(ctx, kit));
  footprints.push(...singles.footprints);
  const front = step('frontage', () => placeFrontage(ctx, kit));
  footprints.push(...front.footprints);
  const cars = step('cars', () => placeTraffic(ctx, kit));
  footprints.push(...cars.footprints);

  // ---- assemble meshes ----
  const tMesh = performance.now();
  const add = (batch, mat, name, cast) => {
    if (!batch.triCount) return;
    const m = batch.toMesh(mat, name);
    m.castShadow = cast;
    group.add(m);
  };
  add(B, mats.opaque, 'streetprops-main', true);
  add(BS, mats.opaque, 'streetprops-small', false);
  add(BW, mats.opaque, 'streetprops-wires', false);
  add(BA, mats.atlas, 'streetprops-printed', true);
  add(BF, mats.foliage, 'streetprops-foliage', true);
  if (BG.triCount) { const g = BG.toMesh(mats.glass, 'streetprops-glass'); g.castShadow = false; g.userData.noShadow = true; g.renderOrder = 2; group.add(g); }
  if (D.i.length) group.add(D.toMesh(mats.decal));
  // neon-night only: additive light pools on the ground under lit lamps (no real lights, cheap)
  if (ctx.look && ctx.look.name === 'neon-night') {
    const L = new DecalBatch();
    for (const f of lamps.footprints) L.add(site, f.x, f.z, 4.6, 4.6, 0, 0.16, 0.02, [1.0, 0.72, 0.42]);
    for (const p of poles.poles) if (p.lamp) L.add(site, p.lamp[0], p.lamp[2], 4.2, 4.2, 0, 0.12, 0.022, [0.75, 0.85, 1.0]);
    for (const p of traffic.lights || []) L.add(site, p[0], p[2], 7, 7, 0, 0.14, 0.022, [0.85, 0.95, 1.0]);
    if (L.i.length) {
      const m = L.toMesh(new THREE.MeshBasicMaterial({ map: mats.poolTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
      m.name = 'streetprops-lightpools';
      group.add(m);
    }
  }

  timings.meshes = Math.round(performance.now() - tMesh);
  ctx.streetprops = { footprints };
  const tris = B.triCount + BS.triCount + BW.triCount + BA.triCount + BF.triCount + BG.triCount;
  log(`streetprops: site ${JSON.stringify(site.stats)}`);
  log(`streetprops: poles ${JSON.stringify(poles.stats)} lamps ${JSON.stringify(lamps.stats)} traffic ${JSON.stringify(traffic.stats)}`);
  log(`streetprops: singles ${JSON.stringify(singles.stats)} frontage ${JSON.stringify(front.counts)} cars ${JSON.stringify(cars.stats)}`);
  log(`streetprops: ${Math.round(tris)} tris, timings ${JSON.stringify(timings)}, total ${Math.round(performance.now() - t0)} ms`);
  return group;
}
