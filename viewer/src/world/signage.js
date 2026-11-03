import * as THREE from 'three';
import { AtlasSet, makeStamps, makeMetalGrime } from './signage/atlas.js';
import { PAINTERS } from './signage/paint.js';
import { Batch } from './signage/geo.js';
import { Space } from './signage/space.js';
import { plan } from './signage/plan.js';
import { NAME_STEMS, KANA_NAMES } from './signage/vocab.js';

// Signage layer for non-landmark buildings (r04).
//  - Renders the 35 adopted generic shop text nodes (decision period-background-context-rule)
//    at their exact position / baseline / glyph height on the adopted sign boards, plus the 21
//    adopted boards without text, and the 56 adopted awnings as cloth awnings.
//  - Adds period-plausible-generic density: projecting vertical signs (single tenant and floor
//    directories), fascia boards, rooftop billboards on steel lattices, wall boards, light
//    boxes, awnings, noren, standing signs, barber poles, neon tube lettering and bulb frames.
//  - All faces are canvas-painted into a shared atlas (no image files). Deterministic: every
//    decision is drawn from ctx.rng keyed by building/facade id.
// Exposes ctx.signage = { volumes } so later modules (street props) can avoid sign volumes.

const PAGE = 2048;
const MAX_PAGES = 14;

export async function build(ctx) {
  const t0 = performance.now();
  const group = new THREE.Group();
  const night = ctx.look && ctx.look.name === 'neon-night';
  const space = new Space(ctx);
  const env = { rng: ctx.rng, space };

  const items = plan(ctx, env);
  const tPlan = performance.now();

  // ---------------------------------------------------------------- atlas budget + packing
  const faces = items.flatMap((it) => it.faces);
  const area = faces.reduce((s, f) => s + (f.w + 12) * (f.h + 12), 0);
  const budget = PAGE * PAGE * MAX_PAGES * 0.82;
  const k = area > budget ? Math.sqrt(budget / area) : 1;
  if (k < 1) for (const f of faces) { f.ppm *= k; f.w = Math.max(4, f.w * k); f.h = Math.max(4, f.h * k); }
  const atlas = new AtlasSet(PAGE, { emissive: night });
  atlas.pack(faces);

  // ---------------------------------------------------------------- paint (page by page)
  const stamps = makeStamps(ctx.rng);
  const byPage = atlas.pages.map(() => []);
  for (const f of faces) byPage[f.region.page].push(f);
  const texs = [];
  for (const page of atlas.pages) {
    atlas.begin(page);
    const backlit = [];
    for (const f of byPage[page.index]) {
      const reg = f.region;
      const P = { g: atlas.g, ge: atlas.ge || null, backlit, x: reg.x, y: reg.y, w: reg.w, h: reg.h, ppm: Math.min(reg.w / f.wm, reg.h / f.hm), r: ctx.rng(`signage/paint/${f.painter}/${reg.page}/${reg.x}/${reg.y}`) };
      if (f.spec.adopted) {
        // re-derive the adopted glyph centre in the allocated pixel grid; glyph height is vertical
        const sx = reg.w / f.wm, sy = reg.h / f.hm;
        f.spec.adopted = { ...f.spec.adopted, u_px: f.spec.adopted.u_m * sx, v_px: f.spec.adopted.v_m * sy };
        P.ppm = sy;
      }
      const sp = f.spec;
      atlas.prefill(reg, f.cls === 'cloth' ? null : (sp.scheme && sp.scheme.bg) || (sp.panels && sp.panels[0].scheme.bg) || sp.c1 || '#8a8780');
      try { PAINTERS[f.painter](P, f.spec, stamps); } catch (e) { ctx.log && ctx.log(`signage: painter ${f.painter} failed: ${e.message}`); }
    }
    if (night) {
      // unlit painted boards still read at night (spill from goosenecks/street light): weak base glow
      for (const f of byPage[page.index]) if (f.cls !== 'cloth' && !(f.spec.lit === 'backlit')) backlit.push([f.region.x, f.region.y, f.region.w, f.region.h, 0.14]);
    }
    if (night && backlit.length) {
      // emissive += albedo x mask for backlit acrylic faces (one composite per page)
      const m = document.createElement('canvas'); m.width = m.height = PAGE;
      const mg = m.getContext('2d');
      mg.fillStyle = '#000'; mg.fillRect(0, 0, PAGE, PAGE);
      for (const [x, y, w, h, kk] of backlit) { mg.fillStyle = `rgba(255,255,255,${kk})`; mg.fillRect(x, y, w, h); }
      mg.globalCompositeOperation = 'multiply';
      mg.drawImage(atlas.canvas, 0, 0);
      atlas.ge.globalCompositeOperation = 'lighter';
      atlas.ge.drawImage(m, 0, 0);
      atlas.ge.globalCompositeOperation = 'source-over';
    }
    texs.push(atlas.upload(ctx.renderer));
  }
  const tPaint = performance.now();

  // ---------------------------------------------------------------- materials
  const CLS = {
    gloss: { roughness: 0.34, metalness: 0.0, envMapIntensity: 1.0 },
    paint: { roughness: 0.72, metalness: 0.0, envMapIntensity: 0.8 },
    cloth: { roughness: 0.93, metalness: 0.0, envMapIntensity: 0.6, alphaTest: 0.5, side: THREE.DoubleSide },
  };
  const faceMats = new Map();
  const faceBatches = new Map();
  const matFor = (page, cls) => {
    const key = `${page}:${cls}`;
    if (!faceMats.has(key)) {
      const o = { map: texs[page].map, ...CLS[cls] };
      if (night) Object.assign(o, { emissiveMap: texs[page].emissiveMap, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.7 });
      faceMats.set(key, new THREE.MeshStandardMaterial(o));
    }
    return faceMats.get(key);
  };
  const metalTex = makeMetalGrime(ctx.rng);
  metalTex.repeat.set(0.5, 0.5);
  const G = {
    steel: new Batch(),
    painted: new Batch(),
    bulbs: [],
    faceBatch(region, cls) {
      const key = `${region.page}:${cls}`;
      if (!faceBatches.has(key)) faceBatches.set(key, new Batch());
      return faceBatches.get(key);
    },
  };

  // ---------------------------------------------------------------- geometry
  let failed = 0;
  for (const it of items) {
    try { it.emit(G); } catch (e) { failed++; if (failed < 5) ctx.log && ctx.log(`signage: emit ${it.kind} failed: ${e.message}`); }
  }
  for (const [key, batch] of faceBatches) {
    if (!batch.vc) continue;
    const [page, cls] = key.split(':');
    const mesh = new THREE.Mesh(batch.geometry(), matFor(Number(page), cls));
    mesh.name = `signage-faces-${key}`;
    mesh.castShadow = true;
    group.add(mesh);
  }
  const steelMat = new THREE.MeshStandardMaterial({ map: metalTex, vertexColors: true, roughness: 0.58, metalness: 0.45 });
  const paintMat = new THREE.MeshStandardMaterial({ map: metalTex, vertexColors: true, roughness: 0.62, metalness: 0.08 });
  for (const [batch, mat, name] of [[G.steel, steelMat, 'signage-steel'], [G.painted, paintMat, 'signage-painted']]) {
    if (!batch.vc) continue;
    const mesh = new THREE.Mesh(batch.geometry(), mat);
    mesh.name = name;
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (G.bulbs.length) {
    const bulbGeo = new THREE.IcosahedronGeometry(0.027, 0);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.22, metalness: 0.0, emissive: night ? new THREE.Color(0xffb35c) : new THREE.Color(0x000000), emissiveIntensity: night ? 3.2 : 0 });
    const inst = new THREE.InstancedMesh(bulbGeo, bulbMat, G.bulbs.length);
    const m = new THREE.Matrix4();
    G.bulbs.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(i, m); });
    inst.castShadow = false;
    inst.userData.noShadow = true;
    inst.name = 'signage-bulbs';
    group.add(inst);
  }

  // ---------------------------------------------------------------- provenance
  const counts = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
  for (const it of items) {
    if (it.kind === 'fascia-adopted' && it.textNode) {
      const r = it.spec.adoptedRendered || {};
      ctx.tag({ id: `signage/${it.textNode}`, module: 'signage', tier: 'adopted-inferred', note: `${it.note}; glyph ink height ${(r.inkH_px && it.faces[0].region ? (r.inkH_px / (it.faces[0].region.h / it.faces[0].hm)).toFixed(3) : '?')} m (adopted 0.55 m); board colours/trim/weathering are period-plausible-generic` });
    }
  }
  ctx.tag({ id: 'signage/adopted-boards-without-text', module: 'signage', tier: 'adopted-inferred', note: `${items.filter((i) => i.kind === 'fascia-adopted' && !i.textNode).length} adopted sign-white boards rendered at adopted placement with generic period text (period-plausible-generic wording)` });
  ctx.tag({ id: 'signage/adopted-awnings', module: 'signage', tier: 'adopted-inferred', note: `${items.filter((i) => i.id && String(i.id).includes('awning') && i.tier === 'adopted-inferred').length} adopted awnings (extent, depth, colour key) rendered as cloth awnings; stripe/valance/scallop styling and valance text are period-plausible-generic` });
  const added = items.filter((i) => i.tier === 'period-plausible-generic');
  ctx.tag({ id: 'signage/added', module: 'signage', tier: 'period-plausible-generic', note: `added signs by kind: ${JSON.stringify(counts)}. Generic trade words; no real brands, logos, film titles or performers.` });
  ctx.tag({ id: 'signage/fictional-names', module: 'signage', tier: 'period-plausible-generic', fictional: true, note: `FICTIONAL shop names used on ${added.filter((i) => i.fictional).length} signs (invented from the fictional stem lists in signage/vocab.js: ${NAME_STEMS.length} kanji stems, ${KANA_NAMES.length} kana names): ${(env.fictionalNames || []).slice(0, 400).join('、')}` });
  ctx.tag({ id: 'signage/phone-numbers', module: 'signage', tier: 'period-plausible-generic', note: 'No telephone numbers are printed (r04 round b): a fictional 7-digit number could map to a real current 03-3xxx-xxxx number.' });

  const chk = env.adoptedCheck || [];
  const maxErr = chk.reduce((m, c) => Math.max(m, c.err), 0);
  const inkHs = chk.map((c) => c.inkH).filter(Boolean);
  ctx.log && ctx.log(`signage: adopted text nodes rendered ${chk.length}; max centre error ${maxErr.toFixed(3)} m; glyph ink height ${Math.min(...inkHs).toFixed(3)}-${Math.max(...inkHs).toFixed(3)} m; min horizontal scale ${Math.min(...chk.map((c) => c.sx || 1)).toFixed(2)}; min baseline dot ${Math.min(...chk.map((c) => c.dirDot)).toFixed(4)}`);
  ctx.signage = { volumes: space.vols, items: items.length, adoptedCheck: chk, fictionalNames: [...(env.fictionalNames || [])].sort() };
  const t1 = performance.now();
  const tris = group.children.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3) * (m.isInstancedMesh ? m.count : 1), 0);
  ctx.log && ctx.log(`signage: ${items.length} items ${JSON.stringify(counts)}; atlas ${atlas.pages.length} pages (scale ${k.toFixed(2)}), ${faces.length} faces; ${G.bulbs.length} bulbs; ${Math.round(tris)} tris; plan ${(tPlan - t0).toFixed(0)} ms, paint ${(tPaint - tPlan).toFixed(0)} ms, build ${(t1 - tPaint).toFixed(0)} ms; emit failures ${failed}`);
  return group;
}
