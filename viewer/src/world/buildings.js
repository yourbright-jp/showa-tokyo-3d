import * as THREE from 'three';
import { pointInPolygon } from '../core/facades.js';
import { Batch, makeFrame, W } from './buildings/geom.js';
import { GrimeAtlas, makeMaterials, makeMidMaterials } from './buildings/materials.js';
import { chooseStyle } from './buildings/style.js';
import { buildFrontFacade, buildSideFacade } from './buildings/facade.js';
import { buildRoof } from './buildings/roof.js';
import { makeMidTextures, buildMid } from './buildings/lod.js';

// Buildings module (r04): turns the adopted period massing into dense Showa mixed-use buildings.
//  - near (< NEAR m from the walk path): full facades (shopfront bays with interiors, upper-floor
//    windows with sashes and interior-mapped rooms, bands, cornices, balconies, pipes, AC units),
//    per-facade grime atlas, parapets and rooftop equipment;
//  - mid (< MID m): textured prisms with painted window/shopfront maps and simple rooftop boxes;
//  - far: textured prisms only.
// Landmark masses (Milano-za, Koma, Toho Kaikan) are skipped: the landmarks module owns them.

const NEAR = 40;
const LITE = 88; // full facade geometry without interiors/small clutter (plaza perimeter, street vistas)
const MID = 140;
const CELL = 48;

function minRouteDist(data, b) {
  let d = data.routeDistance(b.centroid[0], b.centroid[1]);
  const fp = b.footprint;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    d = Math.min(d, data.routeDistance(a[0], a[1]), data.routeDistance((a[0] + c[0]) / 2, (a[1] + c[1]) / 2));
  }
  return d;
}

export async function build(ctx) {
  const t0 = performance.now();
  const group = new THREE.Group();
  const data = ctx.data;
  const all = data.buildings.filter((b) => !b.landmark && !b.proxy);
  const rd = new Map(all.map((b) => [b.id, minRouteDist(data, b)]));
  const near = all.filter((b) => rd.get(b.id) < LITE);
  const nearIds = new Set(near.map((b) => b.id));
  const isLite = (b) => rd.get(b.id) >= NEAR;

  // grime atlas sized from the near wall area
  const ppmFront = 11, ppmSide = 6, ppmBack = 3.5;
  let est = 0;
  for (const b of near) for (let i = 0; i < b.footprint.length; i++) {
    const a = b.footprint[i], c = b.footprint[(i + 1) % b.footprint.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const k = isLite(b) ? 0.45 : 1;
    est += (L * ppmFront * k + 6) * (b.height * ppmFront * k + 6) * 0.5 + (L * ppmSide * k + 6) * (b.height * ppmSide * k + 6) * 0.5;
  }
  let atlasH = 1024; while (atlasH < 4096 && 4096 * atlasH < est * 1.25) atlasH *= 2;
  const scale = Math.min(1, Math.sqrt((4096 * atlasH) / (est * 1.25)));
  const atlas = new GrimeAtlas(4096, atlasH);
  const { M, U } = makeMaterials(ctx, atlas);
  const midTex = makeMidTextures(ctx.rng('buildings/midtex'));
  const MM = makeMidMaterials(ctx, U, midTex);

  // material registry: key -> { mat, extras, cast }
  const spec = new Map();
  for (const [k, m] of Object.entries(M.wall)) spec.set(`wall:${k}`, { mat: m, extras: { aGrime: 2 }, cast: true });
  spec.set('paint', { mat: M.paint, extras: { aGrime: 2 }, cast: true });
  spec.set('trim', { mat: M.paint, extras: { aGrime: 2 }, cast: false }); // small members: no shadow-pass cost
  spec.set('sash', { mat: M.sash, extras: { aGrime: 2 }, cast: false });
  spec.set('shutter', { mat: M.shutter, extras: { aGrime: 2 }, cast: false });
  spec.set('glass', { mat: M.glass, extras: { aWin: 4 }, cast: false });
  spec.set('shopGlass', { mat: M.shopGlass, extras: {}, cast: false, noShadow: true });
  spec.set('interior', { mat: M.interior, extras: {}, cast: false });
  spec.set('tube', { mat: M.tube, extras: {}, cast: false, noShadow: true });
  spec.set('warm', { mat: M.warm, extras: {}, cast: false, noShadow: true });
  spec.set('roof', { mat: M.roof, extras: { aGrime: 2 }, cast: true });
  for (const [k, m] of Object.entries(MM)) spec.set(`mid:${k}`, { mat: m, extras: {}, cast: true });

  const batches = new Map();
  let cellKey = '0,0';
  const B = (key) => {
    const k = `${key}|${cellKey}`;
    let bt = batches.get(k);
    if (!bt) { const s = spec.get(key); if (!s) throw new Error(`no material ${key}`); bt = new Batch(s.extras); bt.key = key; batches.set(k, bt); }
    return bt;
  };

  // spatial index of footprints (for party-wall neighbour heights)
  const grid = new Map(); const G = 20;
  for (const b of data.buildings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.footprint) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
      const k = `${gx},${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b);
    }
  }
  const buildingsAt = (x, z) => (grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []).filter((b) => pointInPolygon(x, z, b.footprint));
  const styles = new Map();
  const styleOf = (b) => { if (!styles.has(b.id)) styles.set(b.id, chooseStyle(ctx, b, data.plans.get(b.id))); return styles.get(b.id); };

  const env = {
    ctx, data, plans: data.plans, atlas, M, B, styleOf,
    ppmFront: ppmFront * scale, ppmSide: ppmSide * scale, ppmBack: ppmBack * scale,
    interiors: new Map(),
    groundAt: (F, u) => { const p = W(F, u, 0, 0.8); return data.heightAt(p[0], p[2]); },
    // height up to which the wall is hidden by an abutting neighbour along its whole length
    neighbourCover: (F, selfId, gap = 0.1) => {
      let cover = Infinity;
      for (const t of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const p = W(F, F.L * t, 0, gap + 0.15);
        let top = -Infinity;
        for (const o of buildingsAt(p[0], p[2])) if (o.id !== selfId) top = Math.max(top, o.topY);
        cover = Math.min(cover, top);
      }
      return cover;
    },
    neighbourTop: (F, selfId) => {
      let best = -Infinity;
      for (const t of [0.2, 0.5, 0.8]) {
        const p = W(F, F.L * t, 0, 0.6);
        for (const o of buildingsAt(p[0], p[2])) if (o.id !== selfId) best = Math.max(best, o.topY);
      }
      return best;
    },
  };

  // Published for other modules (read-only): roof slab height inside the parapet and rooftop
  // equipment footprints [{x, z, hu, hd, dir:[dx,dz], top}] for near/lite buildings.
  const published = { roofY: new Map(), rooftop: new Map() };
  ctx.buildingsInfo = published;

  // --- near buildings -----------------------------------------------------------------------
  let nearFacades = 0;
  const tn = performance.now();
  for (const b of near) {
    cellKey = `${Math.floor(b.centroid[0] / CELL)},${Math.floor(b.centroid[1] / CELL)}`;
    env.lite = isLite(b);
    env.ppmFront = ppmFront * scale * (env.lite ? 0.45 : 1); env.ppmSide = ppmSide * scale * (env.lite ? 0.45 : 1); env.ppmBack = ppmBack * scale * (env.lite ? 0.6 : 1);
    const plan = data.plans.get(b.id);
    const S = styleOf(b);
    const lv = {
      base: b.baseY, yBot: b.baseY - 0.5, gfTop: b.baseY + plan.groundFloorH,
      fascia0: plan.fasciaY0, fascia1: plan.fasciaY1, floors: plan.floors, ufh: plan.upperFloorH,
      topY: b.topY, roofY: b.topY - S.parapetH,
      floorY: (k) => b.baseY + plan.groundFloorH + (k - 1) * plan.upperFloorH,
    };
    const fp = b.footprint; const n = fp.length;
    const metas = new Map((data.facadesByBuilding.get(b.id) || []).map((f) => [f.index, f]));
    // adopted frontage: the edge (> 3 m) nearest the walk path gets a storefront
    let frontIdx = -1, fd = Infinity;
    if (b.near) for (let i = 0; i < n; i++) {
      const a = fp[i], c = fp[(i + 1) % n]; if (Math.hypot(c[0] - a[0], c[1] - a[1]) <= 3) continue;
      const d = data.routeDistance((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); if (d < fd) { fd = d; frontIdx = i; }
    }
    const frontEdges = [];
    let pipeDone = false;
    const kinds = [];
    let area2 = 0; for (let i = 0; i < n; i++) { const a = fp[i], c = fp[(i + 1) % n]; area2 += a[0] * c[1] - c[0] * a[1]; }
    const smallFree = Math.abs(area2) / 2 < 40;
    for (let i = 0; i < n; i++) {
      const meta = metas.get(i);
      let kind = 'plain';
      if (meta) {
        if (i === frontIdx || meta.adoptedText || (meta.streetFacing && meta.routeDist < (env.lite ? 110 : 60))) kind = 'front';
        else if (meta.openDistance > 3.5) kind = 'side';
        else kind = 'party';
      }
      const a = fp[i], c = fp[(i + 1) % n];
      // round c: tiny free-standing structures facing open space (e.g. the small modern plaza structure
      // kept by the adopted context rule at 6.4 m) read as blank grey boxes; give them shop fronts
      if (kind === 'side' && smallFree && meta && (meta.inPlaza || meta.openDistance > 6)) kind = 'front';
      if (kind === 'front' && Math.hypot(c[0] - a[0], c[1] - a[1]) < 2.0) kind = 'side';
      kinds.push(kind);
    }
    for (let i = 0; i < n; i++) {
      const a = fp[i], c = fp[(i + 1) % n], p = fp[(i - 1 + n) % n], q = fp[(i + 2) % n];
      const F = makeFrame(a[0], a[1], c[0], c[1]);
      if (F.L < 0.03) continue;
      const cross = (u, v, w) => (v[0] - u[0]) * (w[1] - v[1]) - (v[1] - u[1]) * (w[0] - v[0]);
      const corner = { convA: cross(p, a, c) > 0, convB: cross(a, c, q) > 0, pipe: false };
      const r = ctx.rng(`buildings/facade/${b.id}#${i}`);
      const meta = metas.get(i);
      if (kinds[i] === 'front') {
        corner.pipe = !pipeDone && F.L > 3; pipeDone = pipeDone || corner.pipe;
        buildFrontFacade(env, b, S, lv, F, meta, corner, r);
        frontEdges.push([a, c]);
        nearFacades++;
      } else buildSideFacade(env, b, S, lv, F, meta, kinds[i], r);
    }
    env.rooftop = [];
    buildRoof(env, b, S, lv, frontEdges, ctx.rng(`buildings/roof/${b.id}`));
    published.roofY.set(b.id, lv.roofY);
    published.rooftop.set(b.id, env.rooftop);
  }
  const tNear = performance.now() - tn;

  // --- mid / far ----------------------------------------------------------------------------
  let midCount = 0, farCount = 0;
  for (const b of all) {
    if (nearIds.has(b.id)) continue;
    cellKey = `${Math.floor(b.centroid[0] / CELL)},${Math.floor(b.centroid[1] / CELL)}`;
    const far = rd.get(b.id) >= MID;
    buildMid(env, b, far);
    if (far) farCount++; else midCount++;
  }

  // --- meshes ------------------------------------------------------------------------------
  let tris = 0;
  const perKey = {};
  for (const bt of batches.values()) {
    if (bt.triCount === 0) continue;
    perKey[bt.key] = (perKey[bt.key] || 0) + bt.triCount;
    const s = spec.get(bt.key);
    const mesh = new THREE.Mesh(bt.toGeometry(), s.mat);
    mesh.castShadow = !!s.cast;
    if (s.noShadow) { mesh.userData.noShadow = true; mesh.receiveShadow = false; }
    if (bt.key === 'shopGlass') mesh.renderOrder = 2;
    mesh.name = `buildings:${bt.key}`;
    tris += bt.triCount;
    group.add(mesh);
  }

  ctx.tag({ id: 'buildings-footprints', module: 'buildings', tier: 'source-derived', note: 'Footprints are PLATEAU 2025 LOD1 outlines (modern spatial scaffold), not surveyed 1976 plans.' });
  ctx.tag({ id: 'buildings-massing-heights', module: 'buildings', tier: 'adopted-inferred', note: 'Heights/floors from the r03 adopted period rule (3.2 m storeys, 24 m cap near the route, 28 m elsewhere); inferred, not surveyed.' });
  ctx.tag({ id: 'buildings-colour-family', module: 'buildings', tier: 'adopted-inferred', note: 'Base colour family follows the adopted material_key (context-gray/cream/brick/blue-gray); exact tones per building are generic variation.' });
  ctx.tag({ id: 'buildings-facade-design', module: 'buildings', tier: 'period-plausible-generic', note: 'Cladding (mosaic/scratch tile/render/exposed concrete/panels), window styles, bands, cornices, sashes, balconies, drainpipes and window AC units are generic 1960s-70s Showa forms; no specific building is depicted.' });
  ctx.tag({ id: 'buildings-shopfronts', module: 'buildings', tier: 'period-plausible-generic', note: 'Ground-floor bays (aluminium glazing, roller shutters, stair entrances) and recessed interiors (shelves, counters, racks, fluorescent tubes). Interior kit follows the adopted generic shop text where present; no tenant is identified.' });
  ctx.tag({ id: 'buildings-upper-interiors', module: 'buildings', tier: 'period-plausible-generic', note: 'Upper windows use an interior-mapping shader (procedural rooms, curtains, blinds); not evidence of any interior.' });
  ctx.tag({ id: 'buildings-rooftops', module: 'buildings', tier: 'period-plausible-generic', note: 'Parapets, stair/elevator penthouses, elevated FRP/steel water tanks and TV antennas; placed toward the back of roofs.' });
  ctx.tag({ id: 'buildings-weathering', module: 'buildings', tier: 'period-plausible-generic', note: 'Procedural grime atlas: rain streaks under sills/bands/copings, ground splash, mottling; visual only.' });
  ctx.tag({ id: 'buildings-mid-far-lod', module: 'buildings', tier: 'period-plausible-generic', note: `Buildings beyond ${NEAR} m use painted window/shopfront textures on the adopted massing.` });

  const info = `buildings: ${near.length} near+lite (${near.filter(isLite).length} lite; ${nearFacades} front facades), ${midCount} mid, ${farCount} far; ${tris} tris in ${group.children.length} meshes; atlas 4096x${atlasH} used ${(100 * atlas.used / (4096 * atlasH)).toFixed(0)}% (failed ${atlas.failed}, scale ${scale.toFixed(2)}); near build ${tNear.toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`;
  if (ctx.log) { ctx.log(info); ctx.log('buildings tris by material: ' + Object.entries(perKey).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${(v / 1000).toFixed(0)}k`).join(' ')); }
  ctx.debug = Object.assign(ctx.debug || {}, { buildingsAtlas: atlas.canvas });
  return group;
}
