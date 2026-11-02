import * as THREE from 'three';
import {
  FacadeBuilder, WALL_Z, theatreMaterials, lobbyInterior, paintFacade, massWalls, frontEdgeIndex, southFirst, theatreShared,
  boxMinMax, cylGeo, quadGeo, wallWithHoles, lin2srgb, edgeQuadReturns, rooftopKit, revealGeo,
} from './theatre-kit.js';
import { weather, makeCanvas, toTexture } from './kit.js';

// Shinjuku Toho Kaikan (adjacent-theatre-roof-proxy + lower front), adopted per
// kabukicho-koma-plaza-1976.json: low Plaza Theatre front (9 m), canopy 4.15 m / 1.6 m,
// three 2.8 m bays, central 6-step stair (1.2 m rise, 3.0 m wide, 2.0 m out), set-back
// Club Heights tower (28 m, 6 m setback, 0.48 frontage, 6 x 5 windows), texts プラザ劇場 /
// クラブハイツ / 入口. The adopted round emblem is NOT drawn (r04 rule: no corporate emblems).

export function buildToho(ctx, kit) {
  const D = ctx.data;
  const decision = D.decisions.komaPlaza.buildings.find((b) => b.proxy_id === 'adjacent-theatre-roof-proxy');
  const P = decision.parameters;
  const lower = D.buildings.find((b) => b.id === 'adjacent-theatre-roof-proxy-lower-front-mass');
  const tower = D.buildings.find((b) => b.id === 'adjacent-theatre-roof-proxy');
  const nodes = D.textNodes.filter((t) => t.id.startsWith('adjacent-theatre-'));
  const name0 = nodes.find((t) => t.id === 'adjacent-theatre-name-0');
  const nrm = [-name0.baseline_direction_xz[1], name0.baseline_direction_xz[0]];
  const fp = lower.footprint;
  const fi = frontEdgeIndex(fp, nrm, [name0.position_m[0], name0.position_m[2]]);
  const [ea, eb] = southFirst(fp[fi], fp[(fi + 1) % fp.length]);
  const fb = new FacadeBuilder(ctx, kit, lower, [ea, eb]);
  const W = fb.W, H = P.lower_front_height_m;
  const chk = fb.local(name0);
  ctx.log(`landmarks/toho: frontage ${W.toFixed(2)} m, name-0 local x ${chk.x.toFixed(2)} vs adopted ${fb.x(P.signs[0].fraction).toFixed(2)}, z ${chk.z.toFixed(3)}, y ${chk.y.toFixed(2)}`);
  const rise = P.entry_steps_total_height_m, doorH = P.entrance_height_m, bayW = P.entrance_bay_width_m;
  const span = [0.15, 0.85];
  const bays = [0, 1, 2].map((i) => fb.x(span[0] + (span[1] - span[0]) * (i + 0.5) / 3)).sort((a, b) => a - b);
  const holes = [], sills = [];
  const bayHoles = bays.map((x) => ({ x0: x - bayW / 2, x1: x + bayW / 2, y0: rise, y1: rise + doorH }));
  holes.push(...bayHoles);
  // shopfronts outside the span (authored)
  const shopHoles = [-1, 1].map((s) => { const xc = s * (W / 2 + Math.abs(fb.x(span[s > 0 ? 1 : 0]))) / 2; return { x0: xc - 1.8, x1: xc + 1.8, y0: 0.12, y1: 2.85 }; });
  holes.push(...shopHoles);
  // upper end windows beside the billboard
  const bx0 = fb.x(0.2), bx1 = fb.x(0.8); const bL = Math.min(bx0, bx1), bR = Math.max(bx0, bx1);
  const endWins = [];
  for (const s of [-1, 1]) for (const k of [0, 1]) {
    const xc = s > 0 ? bR + (W / 2 - bR) * (k + 0.5) / 2 : -W / 2 + (bL + W / 2) * (k + 0.5) / 2;
    endWins.push({ x0: xc - 0.7, x1: xc + 0.7, y0: 5.9, y1: 7.05 });
  }
  holes.push(...endWins);
  for (const h of endWins) sills.push({ x0: h.x0, x1: h.x1, y: h.y0 - 0.06 });

  const wallRgb = lin2srgb(P.wall_base_color_rgb).map((v, i) => v * [0.86, 0.84, 0.79][i]); // adopted colour, aged (authored weathering)
  const jx = []; for (let x = -Math.floor(W / 2 / 1.8) * 1.8; x <= W / 2; x += 1.8) jx.push(x);
  const painter = paintFacade(fb, -W / 2, W / 2, 0, H + 0.12, { key: 'front', baseRgb: wallRgb, ppm: 52, joints: { xs: jx, ys: [rise, 4.6, 5.45, 7.4, 8.6] }, sills, coping: H, canopyTop: P.canopy_height_m + 0.22, dirtH: 1.0, stains: 20, shadeBelow: P.canopy_height_m });
  fb.add('frontWall', wallWithHoles(-W / 2, 0, W / 2, H, holes, WALL_Z, painter));
  edgeQuadReturns(fb, W, H);
  // granite plinth up to the raised lobby floor (1.2 m) across the span
  fb.add('granite', boxMinMax(span[0] === 0 ? 0 : Math.min(fb.x(0.15), fb.x(0.85)) - 0.4, 0, WALL_Z - 0.01, Math.max(fb.x(0.15), fb.x(0.85)) + 0.4, rise, WALL_Z + 0.05));
  fb.add('granite', boxMinMax(-W / 2 - 0.01, 0, WALL_Z - 0.01, W / 2 + 0.01, 0.12, WALL_Z + 0.03));
  // central door; side bays are lobby windows above the plinth
  const mid = bayHoles[1];
  fb.door(mid, { zDoor: -0.42, transomH: 0.62 });
  for (const h of [bayHoles[0], bayHoles[2]]) {
    fb.add('concrete', revealGeo(h, -0.4, WALL_Z));
    for (const xx of [h.x0, (h.x0 + h.x1) / 2, h.x1]) fb.add('steelDark', boxMinMax(xx - 0.04, h.y0, -0.43, xx + 0.04, h.y1, -0.35));
    fb.add('steelDark', boxMinMax(h.x0, h.y1 - 0.62, -0.43, h.x1, h.y1 - 0.56, -0.35));
    fb.add('steelDark', boxMinMax(h.x0, h.y0, -0.43, h.x1, h.y0 + 0.08, -0.35));
    fb.add('doorGlass', quadGeo([h.x0, h.y0, -0.39], [h.x1, h.y0, -0.39], [h.x1, h.y1, -0.39], [h.x0, h.y1, -0.39], 1, 1));
    fb.add('granite', boxMinMax(h.x0, h.y0 - 0.02, -0.4, h.x1, h.y0 + 0.02, WALL_Z + 0.04));
  }
  const lobby = lobbyInterior(fb, bayHoles[0].x0 - 0.2, bayHoles[2].x1 + 0.2, rise, rise + doorH + 0.3, -0.45, 3.4, { cells: 5, wallTint: '#b49a7a' });
  // shopfronts with blank fascia panels
  for (const h of shopHoles) {
    fb.add('concrete', revealGeo(h, -0.25, WALL_Z));
    for (let k = 0; k <= 4; k++) { const xx = h.x0 + (h.x1 - h.x0) * k / 4; fb.add('alu', boxMinMax(xx - 0.03, h.y0, -0.27, xx + 0.03, h.y1, -0.2)); }
    fb.add('alu', boxMinMax(h.x0, h.y1 - 0.55, -0.27, h.x1, h.y1 - 0.5, -0.2));
    fb.add('alu', boxMinMax(h.x0, h.y0, -0.27, h.x1, h.y0 + 0.3, -0.2));
    fb.add('shopGlass', quadGeo([h.x0, h.y0, -0.24], [h.x1, h.y0, -0.24], [h.x1, h.y1, -0.24], [h.x0, h.y1, -0.24], 1 / 8, 1 / 2, [0.375, 0]));
    fb.add('enamel', boxMinMax(h.x0 - 0.1, h.y1 + 0.15, WALL_Z, h.x1 + 0.1, h.y1 + 0.75, WALL_Z + 0.05));
  }
  // showcases between the bays
  for (let i = 0; i < 2; i++) {
    const xc = (bays[i] + bays[i + 1]) / 2;
    fb.showcase(xc - 1.15, rise + 0.35, 1.0, 1.55, (i * 5 + 1) % 8);
    fb.showcase(xc + 1.15, rise + 0.35, 1.0, 1.55, (i * 5 + 2) % 8);
  }
  for (const h of endWins) fb.windowUnit(h, { recess: 0.12, transom: true });
  // canopy (adopted underside 4.15, depth 1.6)
  fb.canopy(-0.48 * W, 0.48 * W, P.canopy_height_m, 0.22, P.canopy_depth_m, { fasciaUp: 0.1, lights: 2 });
  // stair: adopted 6 steps x 0.2 m, 3.0 m wide, 2.0 m out; cheek walls and handrails (authored)
  const sw = P.entry_steps_width_m, sd = P.entry_steps_outward_depth_m, sn = P.entry_steps_count;
  fb.steps(0, sw, rise, sn, sd, { backTo: -0.44 });
  for (const s of [-1, 1]) {
    const xw = s * (sw / 2 + 0.12);
    // cheek wall following the stair profile (stepped boxes)
    for (let j = 0; j < sn; j++) {
      const h = rise * (j + 1) / sn + 0.12, d = sd * (sn - j) / sn + 0.22;
      fb.add('granite', boxMinMax(xw - 0.12, 0, d - sd / sn, xw + 0.12, h, d));
    }
    // handrail on posts
    const hp = [];
    for (let j = 0; j <= sn; j += 2) {
      const z = 0.22 + sd * (sn - j) / sn - 0.15, y = rise * j / sn;
      const post = cylGeo(0.022, 0.022, y + 0.12, y + 0.95, 6, true); post.translate(xw, 0, z); fb.add('steelDark', post);
      hp.push(new THREE.Vector3(xw, y + 0.95, z));
    }
    hp.push(new THREE.Vector3(xw, rise + 0.95, -0.2));
    for (let k = 0; k < hp.length - 1; k++) {
      const a = hp[k], b = hp[k + 1]; const d = b.clone().sub(a); const L = d.length();
      const g = cylGeo(0.025, 0.025, 0, L, 6, true); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z); fb.add('steelDark', g);
    }
  }
  // billboard (neutral abstract panels) with lamp arms, then the Club Heights band
  const bbY0 = 5.6, bbY1 = 7.25;
  fb.add('steelDark', boxMinMax(bL - 0.08, bbY0 - 0.08, WALL_Z, bR + 0.08, bbY1 + 0.08, WALL_Z + 0.16));
  const panels = 3;
  for (let k = 0; k < panels; k++) {
    const x0 = bL + (bR - bL) * k / panels + 0.04, x1 = bL + (bR - bL) * (k + 1) / panels - 0.04;
    const cell = [5, 2, 6][k];
    const u0 = (cell % 2) / 2, v0 = 1 - (Math.floor(cell / 2) + 1) / 4;
    fb.add('billboard', quadGeo([x0, bbY0, WALL_Z + 0.165], [x1, bbY0, WALL_Z + 0.165], [x1, bbY1, WALL_Z + 0.165], [x0, bbY1, WALL_Z + 0.165], 1 / 2, 1 / 8, [u0, v0 + 1 / 16]));
  }
  for (let x = bL + 0.8; x < bR; x += 1.9) {
    fb.add('steelDark', boxMinMax(x - 0.015, bbY1 + 0.08, WALL_Z + 0.1, x + 0.015, bbY1 + 0.12, WALL_Z + 0.75));
    fb.add('lampHead', boxMinMax(x - 0.09, bbY1 + 0.0, WALL_Z + 0.62, x + 0.09, bbY1 + 0.14, WALL_Z + 0.85));
  }
  const ch = nodes.find((n) => n.text === 'クラブハイツ');
  if (ch) {
    const loc = fb.local(ch);
    const est = ch.height_m * 6.4;
    fb.add('band', boxMinMax(loc.x - est / 2 - 0.55, loc.y - 0.55, WALL_Z, loc.x + est / 2 + 0.55, loc.y + 0.55, loc.z - 0.045));
  }
  for (const node of nodes) {
    if (node.text === '入口') {
      const loc = fb.local(node);
      const { L } = fb.letters(node, { depth: 0.02, faceKey: 'labelFace', sideKey: 'labelFace', pins: false, stroke: 3 });
      const pw = L.width + 0.26, ph = node.height_m + 0.16;
      fb.add('labelPlate', boxMinMax(loc.x - pw / 2, loc.y - ph / 2, loc.z - 0.05, loc.x + pw / 2, loc.y + ph / 2, loc.z - 0.018));
      for (const s of [-1, 1]) { const g = cylGeo(0.008, 0.008, loc.y + ph / 2, P.canopy_height_m, 5, true); g.translate(loc.x + s * (pw / 2 - 0.06), 0, loc.z - 0.034); fb.add('steelDark', g); }
    } else {
      fb.letters(node, { depth: node.text === 'クラブハイツ' ? 0.05 : 0.075, stroke: 4, pins: node.text !== 'クラブハイツ' });
    }
  }
  for (const s of [-1, 1]) fb.downpipe(s * (W / 2 - 0.3), H);
  fb.add('concrete', boxMinMax(-W / 2 - 0.03, H, -0.25, W / 2 + 0.03, H + 0.12, WALL_Z + 0.06));
  for (const g of massWalls(lower, lower.baseY, lower.baseY + H, new Set([fi]))) fb.addWorld('massWall', g);
  {
    const s = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, lower.baseY + H - 0.01, 0);
    const pos = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    fb.addWorld('roofing', g);
  }

  // ----- Club Heights tower (6 m setback, 0.48 of frontage)
  const tp = tower.footprint;
  const tfi = frontEdgeIndex(tp, nrm, [name0.position_m[0], name0.position_m[2]]);
  const [ta, tb] = southFirst(tp[tfi], tp[(tfi + 1) % tp.length]);
  const tfb = new FacadeBuilder(ctx, kit, tower, [ta, tb]);
  const TW = tfb.W, TH = tower.topY - tower.baseY;
  // adopted window grid (computed in the lower frame, converted to the tower frame)
  const twin = [];
  for (let r = 0; r < P.tower_window_rows; r++) {
    const y = H + (r + 0.5) * (P.main_tower_height_m - H) / P.tower_window_rows;
    for (let c = 0; c < P.tower_window_columns; c++) {
      const t = 0.5 + ((c + 0.5) / P.tower_window_columns - 0.5) * P.tower_frontage_fraction;
      const w = fb.F.toWorld(fb.x(t), y, -P.tower_rear_setback_m + 0.13);
      const l = tfb.F.toLocal(w.x, w.y, w.z);
      twin.push({ x0: l.x - 0.575, x1: l.x + 0.575, y0: l.y - 0.85, y1: l.y + 0.85 });
    }
  }
  const tsills = twin.map((h) => ({ x0: h.x0, x1: h.x1, y: h.y0 - 0.06 }));
  const tjy = []; for (let r = 1; r < P.tower_window_rows; r++) tjy.push(r * TH / P.tower_window_rows - 0.1);
  const tPainter = paintFacade(tfb, -TW / 2, TW / 2, 0, TH + 0.1, { key: 'tower-west', baseRgb: wallRgb.map((v) => v * 0.97), ppm: 48, joints: { xs: [-TW / 2 + 0.6, TW / 2 - 0.6], ys: tjy }, sills: tsills, coping: TH, dirtH: 0.5, stains: 16, age: 1.5 });
  tfb.add('towerWall', wallWithHoles(-TW / 2, 0, TW / 2, TH, twin, WALL_Z, tPainter));
  edgeQuadReturns(tfb, TW, TH);
  let k = 0;
  for (const h of twin) tfb.windowUnit(h, { recess: 0.14, transom: true, cell: (k++ * 5 + 1) % 16 });
  // spandrel bands
  for (const y of tjy) tfb.add('concrete', boxMinMax(-TW / 2, y - 0.08, WALL_Z, TW / 2, y + 0.08, WALL_Z + 0.08));
  // window coolers on a few windows (period-plausible)
  const crng = ctx.rng('landmarks/toho/coolers');
  for (const h of twin) if (crng() < 0.2) { const xc = (h.x0 + h.x1) / 2; tfb.add('cooler', boxMinMax(xc - 0.33, h.y0 + 0.02, WALL_Z - 0.1, xc + 0.33, h.y0 + 0.48, WALL_Z + 0.32)); }
  // side faces: applied window grid on the two long faces adjacent to the front
  for (const sideIdx of [(tfi + 1) % tp.length, (tfi + tp.length - 1) % tp.length]) {
    const a = tp[sideIdx], c = tp[(sideIdx + 1) % tp.length];
    const sfb = new FacadeBuilder(ctx, kit, tower, [a, c]);
    const SW = sfb.W; const cols = Math.floor((SW - 2) / 3.1);
    for (let r = 0; r < P.tower_window_rows; r++) {
      const yc = (r + 0.5) * TH / P.tower_window_rows;
      for (let cI = 0; cI < cols; cI++) {
        const xc = -SW / 2 + 1 + (cI + 0.5) * (SW - 2) / cols;
        const h = { x0: xc - 0.575, x1: xc + 0.575, y0: yc - 0.85, y1: yc + 0.85 };
        appliedWindow(sfb, h, (r * 7 + cI * 3) % 16);
      }
      if (r > 0) sfb.add('concrete', boxMinMax(-SW / 2, r * TH / P.tower_window_rows - 0.18, 0, SW / 2, r * TH / P.tower_window_rows - 0.02, 0.07));
    }
    tfb.B.parts.forEach(() => {});
    for (const [key, list] of sfb.B.parts) for (const g of list) tfb.addWorld(key, g);
    sfb.B.parts.clear();
  }
  for (const g of massWalls(tower, tower.baseY, tower.topY, new Set([tfi]))) tfb.addWorld('massWall', g);
  rooftopKit(tfb, tower, tfi, { seed: 'toho', tower: false });
  tfb.add('concrete', boxMinMax(-TW / 2 - 0.03, TH, -0.3, TW / 2 + 0.03, TH + 0.25, WALL_Z + 0.08));

  // ----- materials
  const M = theatreMaterials(ctx, kit, { wallColorLin: P.wall_base_color_rgb, metalLin: P.metal_base_color_rgb, glassLin: [0.075, 0.14, 0.16], baseY: lower.baseY, topY: tower.topY });
  const S = theatreShared(ctx, kit);
  const W8 = (m, o) => weather(m, kit.macro, o);
  const mats = {
    ...M, ...lobby,
    frontWall: W8(new THREE.MeshStandardMaterial({ map: painter.texture(), roughness: 0.86 }), { baseY: lower.baseY, dirt: 0, streak: 0.05, mottle: 0.04 }),
    towerWall: W8(new THREE.MeshStandardMaterial({ map: tPainter.texture(), roughness: 0.88 }), { baseY: tower.baseY, dirt: 0, streak: 0.08, mottle: 0.05 }),
    massWall: W8(new THREE.MeshStandardMaterial({ map: S.panelTex, color: new THREE.Color(...wallRgb.map((v) => (v / 255) ** 2.2)).multiplyScalar(1.45), roughness: 0.9 }), { baseY: lower.baseY, dirtH: 1.0, dirt: 0.3, streak: 0.16, mottle: 0.06, topY: tower.topY, topStreak: 0.08 }),
    shopGlass: new THREE.MeshStandardMaterial({ map: S.windowTex, color: 0x9a9a90, roughness: 0.05, metalness: 0.3 }),
    billboard: new THREE.MeshStandardMaterial({ map: S.billboardTex, roughness: 0.75, emissive: 0xffffff, emissiveMap: S.billboardTex, emissiveIntensity: kit.night ? 0.5 : 0.0 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.5, metalness: 0.5, emissive: 0xfff0d0, emissiveIntensity: kit.night ? 0.6 : 0 }),
    band: W8(new THREE.MeshStandardMaterial({ color: 0xc6aaa3, roughness: 0.45 }), { baseY: lower.baseY, dirt: 0, streak: 0.2, mottle: 0.1 }),
    cooler: W8(new THREE.MeshStandardMaterial({ color: 0xb9b6aa, roughness: 0.6, metalness: 0.2 }), { baseY: lower.baseY, dirt: 0, streak: 0.25, mottle: 0.15 }),
  };
  const g = new THREE.Group(); g.name = 'toho-kaikan';
  g.add(fb.build(mats, 'toho-lower'));
  g.add(tfb.build(mats, 'toho-tower'));
  ctx.tag({ id: 'toho-kaikan-front', module: 'landmarks', tier: 'adopted-inferred', note: 'Plaza Theatre low front 9 m, canopy 4.15/1.6 m, 3 x 2.8 m bays, 6-step stair, set-back Club Heights tower 28 m with adopted 6 x 5 window grid (1975/1979 photos, dimensions inferred).' });
  ctx.tag({ id: 'toho-kaikan-detail', module: 'landmarks', tier: 'period-plausible-generic', note: 'Shopfronts, showcases, neutral billboard panels (no programme), Club Heights sign band colour, cheek walls/handrails, side-face window grid, window coolers and rooftop plant are authored; adopted round emblem omitted (no corporate emblems rule).' });
  return g;
}

function appliedWindow(fb, h, cell) {
  const z = 0.0;
  const u0 = (cell % 8) / 8, v0 = 1 - (Math.floor(cell / 8) + 1) / 2;
  fb.add('winGlass', quadGeo([h.x0, h.y0, z + 0.015], [h.x1, h.y0, z + 0.015], [h.x1, h.y1, z + 0.015], [h.x0, h.y1, z + 0.015], 1 / 8, 1 / 2, [u0, v0]));
  const f = 0.06;
  fb.add('concrete', boxMinMax(h.x0 - f, h.y1, z, h.x1 + f, h.y1 + f, z + 0.06));
  fb.add('concrete', boxMinMax(h.x0 - f, h.y0 - f, z, h.x1 + f, h.y0, z + 0.08));
  fb.add('concrete', boxMinMax(h.x0 - f, h.y0, z, h.x0, h.y1, z + 0.06));
  fb.add('concrete', boxMinMax(h.x1, h.y0, z, h.x1 + f, h.y1, z + 0.06));
  fb.add('steelDark', boxMinMax((h.x0 + h.x1) / 2 - 0.02, h.y0, z + 0.015, (h.x0 + h.x1) / 2 + 0.02, h.y1, z + 0.04));
}
