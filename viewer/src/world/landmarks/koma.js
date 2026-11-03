import * as THREE from 'three';
import {
  FacadeBuilder, WALL_Z, theatreMaterials, lobbyInterior, paintFacade, massWalls, frontEdgeIndex, southFirst, theatreShared,
  boxMinMax, cylGeo, wallWithHoles, lin2srgb, edgeQuadReturns, rooftopKit, revealGeo,
} from './theatre-kit.js';
import { weather } from './kit.js';

// Shinjuku Koma Theatre, adopted per data/decisions/kabukicho-koma-plaza-1976.json
// (koma-south-roof-proxy + its lower-front mass). West front to the plaza: 8.5 m lower front,
// canopy 3.1 m / 1.8 m, seven 1.8 m entrance bays in the 0.15-0.85 span, two window rows,
// cladding joints every 3.2 m, pale mineral wall, コマ劇場 / コマ東宝 / 入口 lettering, threshold steps.

export function buildKoma(ctx, kit) {
  const D = ctx.data;
  const decision = D.decisions.komaPlaza.buildings.find((b) => b.proxy_id === 'koma-south-roof-proxy');
  const P = decision.parameters;
  const lower = D.buildings.find((b) => b.id === 'koma-south-roof-proxy-lower-front-mass');
  const upper = D.buildings.find((b) => b.id === 'koma-south-roof-proxy');
  const nodes = D.textNodes.filter((t) => t.id.startsWith('koma-south-'));
  const name0 = nodes.find((t) => t.id === 'koma-south-name-0');
  const nrm = [-name0.baseline_direction_xz[1], name0.baseline_direction_xz[0]];
  const fi = frontEdgeIndex(lower.footprint, nrm, [name0.position_m[0], name0.position_m[2]]);
  const fp = lower.footprint;
  const [ea, eb] = southFirst(fp[fi], fp[(fi + 1) % fp.length]);
  const fb = new FacadeBuilder(ctx, kit, lower, [ea, eb]);
  const W = fb.W, H = P.lower_front_height_m;
  const check = fb.local(name0);
  ctx.log(`landmarks/koma: frontage ${W.toFixed(2)} m, name-0 local x ${check.x.toFixed(2)} vs adopted ${fb.x(P.signs[0].fraction).toFixed(2)}, z ${check.z.toFixed(3)}, y ${check.y.toFixed(2)}`);

  const stepH = P.threshold_steps_total_height_m, doorH = P.entrance_height_m, doorW = P.entrance_bay_width_m;
  const span = P.entrance_span_fraction.map((t) => fb.x(t)).sort((a, b) => a - b);
  const bays = [];
  for (let i = 0; i < P.entrance_bays; i++) bays.push(fb.x(P.entrance_span_fraction[0] + (P.entrance_span_fraction[1] - P.entrance_span_fraction[0]) * (i + 0.5) / P.entrance_bays));
  bays.sort((a, b) => a - b);
  const holes = []; const doorHoles = []; const winHoles = []; const sills = [];
  for (const x of bays) { const h = { x0: x - doorW / 2, x1: x + doorW / 2, y0: stepH, y1: stepH + doorH }; holes.push(h); doorHoles.push(h); }
  for (const yc of P.upper_window_rows_m) for (let c = 0; c < P.upper_window_columns; c++) {
    const x = fb.x((c + 0.5) / P.upper_window_columns);
    const h = { x0: x - P.upper_window_width_m / 2, x1: x + P.upper_window_width_m / 2, y0: yc - P.upper_window_height_m / 2, y1: yc + P.upper_window_height_m / 2 };
    holes.push(h); winHoles.push(h); sills.push({ x0: h.x0, x1: h.x1, y: h.y0 - 0.06 });
  }
  // ticket windows and service doors outside the entrance span (authored)
  const ends = [(-W / 2 + span[0]) / 2, (W / 2 + span[1]) / 2];
  const ticketHoles = ends.map((x) => ({ x0: x - 0.8, x1: x + 0.8, y0: 1.0, y1: 2.05 }));
  const serviceHoles = [-1, 1].map((s) => ({ x0: s * (W / 2 - 1.05) - 0.5, x1: s * (W / 2 - 1.05) + 0.5, y0: 0.15, y1: 2.25 }));
  holes.push(...ticketHoles, ...serviceHoles);
  for (const h of ticketHoles) sills.push({ x0: h.x0, x1: h.x1, y: h.y0 - 0.06 });

  // joints: vertical every 3.2 m (adopted spacing), horizontal at authored courses
  const jx = []; for (let x = -Math.floor(W / 2 / 3.2) * 3.2; x <= W / 2; x += 3.2) jx.push(x);
  const jy = [0.32, 3.46, 4.05, 5.55, 7.05, 8.2];
  const wallRgb = lin2srgb(P.wall_base_color_rgb).map((v, i) => v * [0.87, 0.83, 0.75][i]); // adopted pale mineral colour, aged/sooted towards warm grime (authored weathering; round b: slightly warmer)
  const painter = paintFacade(fb, -W / 2, W / 2, 0, H + 0.12, { key: 'front', baseRgb: wallRgb, ppm: 56, joints: { xs: jx, ys: jy }, sills, coping: H, canopyTop: P.canopy_height_m + P.canopy_thickness_m, dirtH: 1.1, stains: 26, shadeBelow: P.canopy_height_m, age: 1.3 });
  fb.add('frontWall', wallWithHoles(-W / 2, 0, W / 2, H, holes, WALL_Z, painter));
  edgeQuadReturns(fb, W, H);
  // plinth (granite) and base course
  fb.add('granite', boxMinMax(-W / 2 - 0.01, 0, WALL_Z - 0.01, W / 2 + 0.01, stepH, WALL_Z + 0.035));
  // doors with lobby behind
  for (const h of doorHoles) fb.door(h, { zDoor: -0.32, transomH: 0.52 });
  // windows
  let wi = 0;
  for (const h of winHoles) fb.windowUnit(h, { recess: 0.13, cell: (wi++ * 7 + 3) % 16 });
  // ticket windows: lit counter, ledge, speaking grille plate, blank enamel panel above
  for (const h of ticketHoles) {
    fb.windowUnit(h, { recess: 0.22, mullion: false, transom: false, sill: false, cell: 4, glassKey: 'ticketGlass' });
    fb.add('steelDark', boxMinMax(h.x0 - 0.05, h.y0 - 0.06, WALL_Z - 0.2, h.x1 + 0.05, h.y0, WALL_Z + 0.24));
    fb.add('alu', boxMinMax((h.x0 + h.x1) / 2 - 0.16, h.y0 + 0.3, WALL_Z - 0.18, (h.x0 + h.x1) / 2 + 0.16, h.y0 + 0.58, WALL_Z - 0.16));
    fb.add('enamel', boxMinMax(h.x0 - 0.1, h.y1 + 0.18, WALL_Z, h.x1 + 0.1, h.y1 + 0.62, WALL_Z + 0.03));
  }
  for (const h of serviceHoles) {
    fb.add('concrete', (() => { const g = boxMinMax(h.x0, h.y0, WALL_Z - 0.12, h.x1, h.y1, WALL_Z - 0.1); return g; })());
    fb.add('serviceDoor', boxMinMax(h.x0 + 0.04, h.y0, WALL_Z - 0.11, h.x1 - 0.04, h.y1 - 0.04, WALL_Z - 0.08));
    fb.add('concrete', boxMinMax(h.x0 - 0.1, h.y1, WALL_Z, h.x1 + 0.1, h.y1 + 0.08, WALL_Z + 0.12));
    fb.add('brass', boxMinMax(h.x1 - 0.16, h.y0 + 1.0, WALL_Z - 0.08, h.x1 - 0.1, h.y0 + 1.06, WALL_Z - 0.03));
    fb.add('concrete', boxMinMax(h.x0, 0, WALL_Z - 0.12, h.x1, h.y0, WALL_Z + 0.25));
  }
  const lobby = lobbyInterior(fb, span[0], span[1], stepH, stepH + doorH + 0.25, -0.34, 3.2, { cells: 7 });
  // showcases on piers between doors and beside the end doors
  let cell = 0;
  for (let i = 0; i < bays.length - 1; i++) fb.showcase((bays[i] + bays[i + 1]) / 2, 0.78, 1.12, 1.5, (cell++ * 3) % 8);
  // small fixtures: hydrant box (no lettering), notice boards with blank sheets, meter box
  {
    const xf = span[1] + 0.8;
    fb.add('fireBox', boxMinMax(xf - 0.35, 0.9, WALL_Z, xf + 0.35, 1.75, WALL_Z + 0.16));
    fb.add('steelDark', boxMinMax(xf - 0.3, 1.0, WALL_Z + 0.16, xf + 0.3, 1.65, WALL_Z + 0.17));
    const lamp = cylGeo(0.06, 0.06, 1.85, 1.95, 10); lamp.rotateX(Math.PI / 2); lamp.translate(xf, 0, WALL_Z + 0.05); fb.add('fireBox', lamp);
    for (const xb of [span[0] - 0.8]) {
      fb.add('board', boxMinMax(xb - 0.55, 1.05, WALL_Z, xb + 0.55, 1.85, WALL_Z + 0.03));
      const r = ctx.rng('landmarks/koma/notices');
      for (let k = 0; k < 5; k++) { const px = xb - 0.45 + r() * 0.75, py = 1.12 + r() * 0.5; fb.add('paper', boxMinMax(px, py, WALL_Z + 0.03, px + 0.15 + r() * 0.08, py + 0.2 + r() * 0.08, WALL_Z + 0.034)); }
    }
    fb.add('alu', boxMinMax(span[0] - 1.25, 0.45, WALL_Z, span[0] - 0.9, 0.9, WALL_Z + 0.12));
  }
  // canopy (adopted: underside 3.1 m, depth 1.8 m, thickness 0.22 m, 0.96 of frontage)
  fb.canopy(-0.48 * W, 0.48 * W, P.canopy_height_m, P.canopy_thickness_m, P.canopy_depth_m, { fasciaUp: 0.07, lights: 2 });
  // lettering
  for (const node of nodes) {
    if (node.text === '入口') {
      const loc = fb.local(node);
      const { L } = fb.letters(node, { depth: 0.02, faceKey: 'labelFace', sideKey: 'labelFace', pins: false, stroke: 3 });
      const pw = L.width + 0.26, ph = node.height_m + 0.16;
      fb.add('labelPlate', boxMinMax(loc.x - pw / 2, loc.y - ph / 2, loc.z - 0.05, loc.x + pw / 2, loc.y + ph / 2, loc.z - 0.018));
      for (const s of [-1, 1]) { const g = cylGeo(0.008, 0.008, loc.y + ph / 2, P.canopy_height_m, 5, true); g.translate(loc.x + s * (pw / 2 - 0.06), 0, loc.z - 0.034); fb.add('steelDark', g); }
    } else if (P.sign_mounting && P.sign_mounting.applies_to.includes(node.text)) {
      // r05 (r05-koma-name-canopy): freestanding letters on the canopy slab, as in the 1957 photograph:
      // a channel rail on the slab carries the letters; a light frame behind them is stayed back to the wall.
      const depth = 0.075;
      const { L } = fb.letters(node, { depth, stroke: 4, pins: false });
      const loc = fb.local(node);
      const slabTop = P.canopy_height_m + P.canopy_thickness_m, railTop = slabTop + P.sign_mounting.support_rail_height_m;
      const x0 = loc.x - L.width / 2 - 0.12, x1 = loc.x + L.width / 2 + 0.12, zBack = loc.z - depth;
      fb.add('steelDark', boxMinMax(x0, slabTop, zBack - 0.1, x1, railTop, zBack + 0.02));
      const frameTop = loc.y + node.height_m / 2 - 0.08, zf = zBack - 0.06;
      const posts = Math.max(2, Math.round((x1 - x0) / 0.9) + 1);
      for (let k = 0; k < posts; k++) {
        const x = x0 + 0.03 + (x1 - x0 - 0.06) * k / (posts - 1);
        fb.add('steelDark', boxMinMax(x - 0.02, railTop, zf - 0.02, x + 0.02, frameTop, zf + 0.02));
        if (k % 2 === 0) { // diagonal stay from the frame head back to the wall gutter
          const a = new THREE.Vector3(x, frameTop - 0.05, zf - 0.02), b = new THREE.Vector3(x, slabTop + 0.05, WALL_Z + 0.12);
          const d = b.clone().sub(a); const g = cylGeo(0.014, 0.014, 0, d.length(), 6, true);
          g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z);
          fb.add('steelDark', g);
        }
      }
      fb.add('steelDark', boxMinMax(x0, frameTop - 0.03, zf - 0.02, x1, frameTop + 0.01, zf + 0.02));
    } else {
      fb.letters(node, { depth: 0.075, stroke: 4 });
    }
  }
  // threshold steps (adopted 2 x 0.15 m, 1.6 m out, entrance-span width)
  fb.steps(0, W * (P.entrance_span_fraction[1] - P.entrance_span_fraction[0]), stepH, P.threshold_step_count, P.threshold_steps_outward_depth_m, { backTo: -0.36 });
  // round c: dark expansion-joint strips at both ends so the Koma front reads as a separate building
  // from the abutting Toho Kaikan front (history review: the near-identical adopted colours ran together)
  for (const s of [-1, 1]) fb.add('steelDark', boxMinMax(s * (W / 2) - 0.09, 0, WALL_Z - 0.02, s * (W / 2) + 0.09, H + 0.12, WALL_Z + 0.012));
  // downpipes, coping
  for (const s of [-1, 1]) fb.downpipe(s * (W / 2 - 0.3), H);
  fb.add('concrete', boxMinMax(-W / 2 - 0.03, H, -0.25, W / 2 + 0.03, H + 0.12, WALL_Z + 0.06));
  fb.add('steelDark', boxMinMax(-W / 2 - 0.03, H + 0.12, -0.25, W / 2 + 0.03, H + 0.135, WALL_Z + 0.07));

  // ----- lower mass: other walls and roof
  const sideParts = massWalls(lower, lower.baseY, lower.baseY + H, new Set([fi]));
  for (const g of sideParts) fb.addWorld('massWall', g);
  {
    const s = new THREE.Shape(lower.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, lower.baseY + H - 0.01, 0);
    const pos = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    fb.addWorld('roofing', g);
  }

  // ----- upper (auditorium) mass, set back 5 m
  const up = upper.footprint;
  const ufi = frontEdgeIndex(up, nrm, [name0.position_m[0], name0.position_m[2]]);
  const [ua, ub] = southFirst(up[ufi], up[(ufi + 1) % up.length]);
  const ufb = new FacadeBuilder(ctx, kit, upper, [ua, ub]);
  const UW = ufb.W, UH = upper.topY - upper.baseY;
  const ujx = []; for (let x = -Math.floor(UW / 2 / 3.2) * 3.2; x <= UW / 2; x += 3.2) ujx.push(x);
  const ujy = []; for (let y = 1.6; y < UH; y += 1.6) ujy.push(y);
  const ribs = []; for (let x = -Math.floor(UW / 2 / 6.4) * 6.4; x <= UW / 2 - 1; x += 6.4) ribs.push(x);
  const louvreY0 = UH - 2.3, louvreY1 = UH - 0.9;
  const upPainter = paintFacade(ufb, -UW / 2, UW / 2, 0, UH + 0.1, {
    key: 'upper', baseRgb: wallRgb.map((v, i) => v * [0.9, 0.89, 0.87][i]), ppm: 40, jointW: 0.032, joints: { xs: ujx, ys: ujy }, coping: UH, dirtH: 0.6, stains: 70, age: 2.6, // r04: heavier soot/rain staining on the large auditorium wall (visual review: flat pale field)
    extra: (Pn, r) => {
      for (const x of ribs) { Pn.streak(x - 0.45, louvreY0, 3 + r() * 5, 0.16, [80, 76, 66], 0.32); Pn.streak(x + 0.45, louvreY0, 2 + r() * 5, 0.14, [80, 76, 66], 0.28); }
      Pn.streakRun(r, -UW / 2, UW / 2, louvreY0, 0.4, 4.5, 2.4, [80, 76, 66], 0.3);
      Pn.band(0, 0.8, [70, 66, 56], 0.35, 0);
    },
  });
  ufb.add('upperWall', wallWithHoles(-UW / 2, 0, UW / 2, UH, [{ x0: -UW / 2 + 0.6, x1: UW / 2 - 0.6, y0: louvreY0, y1: louvreY1 }], WALL_Z * 0.5, upPainter));
  edgeQuadReturns(ufb, UW, UH, WALL_Z * 0.5);
  // louvre band (recessed, horizontal blades)
  ufb.add('steelDark', boxMinMax(-UW / 2 + 0.6, louvreY0, -0.35, UW / 2 - 0.6, louvreY1, -0.3));
  for (let y = louvreY0 + 0.08; y < louvreY1 - 0.04; y += 0.14) {
    const g = boxMinMax(-UW / 2 + 0.6, y, -0.28, UW / 2 - 0.6, y + 0.025, 0.02); g.rotateX(0); ufb.add('louvre', g);
  }
  ufb.add('concrete', revealGeo({ x0: -UW / 2 + 0.6, x1: UW / 2 - 0.6, y0: louvreY0, y1: louvreY1 }, -0.35, WALL_Z * 0.5));
  for (const x of ribs) { ufb.add('rib', boxMinMax(x - 0.3, 0, WALL_Z * 0.5, x + 0.3, UH, WALL_Z * 0.5 + 0.45)); ufb.add('rib', boxMinMax(x - 0.36, UH - 0.25, WALL_Z * 0.5, x + 0.36, UH, WALL_Z * 0.5 + 0.5)); }
  ufb.add('concrete', boxMinMax(-UW / 2 - 0.03, UH, -0.3, UW / 2 + 0.03, UH + 0.25, WALL_Z * 0.5 + 0.34));
  for (const s of [-1, 1]) ufb.downpipe(s * (UW / 2 - 0.5), UH, WALL_Z * 0.5 + 0.08);
  const uside = massWalls(upper, upper.baseY, upper.topY, new Set([ufi]));
  for (const g of uside) ufb.addWorld('massWall', g);
  rooftopKit(ufb, upper, ufi, { seed: 'koma' });

  // ----- materials
  const M = theatreMaterials(ctx, kit, { wallColorLin: P.wall_base_color_rgb, metalLin: P.metal_base_color_rgb, glassLin: P.glazing_base_color_rgb, baseY: lower.baseY, topY: upper.topY });
  const S = theatreShared(ctx, kit);
  const frontWall = weather(new THREE.MeshStandardMaterial({ map: painter.texture(), roughness: 0.86 }), kit.macro, { baseY: lower.baseY, dirt: 0.0, streak: 0.05, mottle: 0.05 });
  const upperWall = weather(new THREE.MeshStandardMaterial({ map: upPainter.texture(), roughness: 0.88 }), kit.macro, { baseY: upper.baseY, dirt: 0.0, streak: 0.22, mottle: 0.14 });
  const massWall = weather(new THREE.MeshStandardMaterial({ map: S.panelTex, color: new THREE.Color(...wallRgb.map((v) => (v / 255) ** 2.2)).multiplyScalar(1.45), roughness: 0.9 }), kit.macro, { baseY: lower.baseY, dirtH: 1.0, dirt: 0.3, streak: 0.16, mottle: 0.06, topY: upper.topY, topStreak: 0.08 });
  const mats = {
    ...M, ...lobby, frontWall, upperWall, massWall,
    ticketGlass: new THREE.MeshStandardMaterial({ map: S.windowTex, color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: kit.night ? 0.6 : 0.12, roughness: 0.08 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0xe6e2d4, roughness: 0.4 }),
    serviceDoor: weather(new THREE.MeshStandardMaterial({ color: 0x4f5a55, roughness: 0.6, metalness: 0.3 }), kit.macro, { baseY: lower.baseY, dirt: 0.3, streak: 0.1 }),
    louvre: new THREE.MeshStandardMaterial({ color: 0x5a5d58, roughness: 0.6, metalness: 0.35 }),
    rib: weather(new THREE.MeshStandardMaterial({ map: S.panelTex, color: new THREE.Color(...wallRgb.map((v) => (v / 255) ** 2.2)).multiplyScalar(1.45), roughness: 0.9 }), kit.macro, { baseY: upper.baseY, dirtH: 0.5, dirt: 0.2, streak: 0.3, mottle: 0.08, streakScale: 3 }),
    fireBox: weather(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.05, 0.03), roughness: 0.45, metalness: 0.2 }), kit.macro, { baseY: lower.baseY, dirt: 0.2, streak: 0.2, mottle: 0.1 }),
    board: new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.85 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9 }),
  };
  const g = new THREE.Group(); g.name = 'koma-theatre';
  g.add(fb.build(mats, 'koma-lower'));
  g.add(ufb.build(mats, 'koma-upper'));
  ctx.tag({ id: 'koma-theatre-front', module: 'landmarks', tier: 'adopted-inferred', note: 'Koma west front: lower front 8.5 m, canopy 3.1/1.8 m, 7 bays, window rows 4.8/6.3 m x 9, joints 3.2 m, wall/metal/glass colours from kabukicho-koma-plaza-1976 (1957 motifs carried to 1976 by assumption). r05: the コマ劇場 / コマ東宝 letters stand on the canopy (revision r05-koma-name-canopy).' });
  ctx.tag({ id: 'koma-name-supports', module: 'landmarks', tier: 'period-plausible-generic', note: 'Rail, frame posts and back-stays carrying the canopy-mounted letters are authored after the frame seen behind the 1957 canopy letters; dimensions are not measured.' });
  ctx.tag({ id: 'koma-theatre-detail', module: 'landmarks', tier: 'period-plausible-generic', note: 'Ticket windows, service doors, poster showcases (neutral abstract panels, no programmes), lobby interior, downpipes, louvre band, ribs and rooftop plant are authored detail.' });
  return g;
}

