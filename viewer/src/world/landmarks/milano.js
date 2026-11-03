import * as THREE from 'three';
import {
  FacadeBuilder, WALL_Z, theatreMaterials, lobbyInterior, paintFacade, massWalls, frontEdgeIndex, southFirst, theatreShared,
  boxMinMax, cylGeo, quadGeo, wallWithHoles, edgeQuadReturns, revealGeo,
} from './theatre-kit.js';
import { weather, makeCanvas, toTexture, normGeo } from './kit.js';
import { letterGeometry } from './letters.js';

// Milano-za (milano-roof-proxy), adopted rule "milano-facade-adoption-rule": east-facing public
// facade with repeated doors/windows and the stable name. Material cues (pink tile wall,
// lattice ventilation band, barrel roof, yellow canopy fascia, red MILANO letters) follow the
// 1971/1972-derived references R03/R09; carrying them to 1976 is an assumption (year gap
// recorded in the provenance tags). Billboards carry neutral abstract panels only.

export function buildMilano(ctx, kit) {
  const D = ctx.data;
  const b = D.buildings.find((x) => x.id === 'milano-roof-proxy');
  const nodes = D.textNodes.filter((t) => t.id.startsWith('milano-'));
  const name0 = nodes.find((t) => t.id === 'milano-name-0');
  const nrm = [-name0.baseline_direction_xz[1], name0.baseline_direction_xz[0]];
  const fp = b.footprint;
  const fi = frontEdgeIndex(fp, nrm, [name0.position_m[0], name0.position_m[2]]);
  const [ea, eb] = southFirst(fp[fi], fp[(fi + 1) % fp.length]);
  const fb = new FacadeBuilder(ctx, kit, b, [ea, eb]);
  const W = fb.W;
  const chk = fb.local(name0);
  ctx.log(`landmarks/milano: frontage ${W.toFixed(2)} m, name local x ${chk.x.toFixed(2)} (adopted fraction 0.5 -> ${fb.x(0.5).toFixed(2)}), z ${chk.z.toFixed(3)}, y ${chk.y.toFixed(2)}`);
  // r03 adopted construction values for Milano (scripts/build_period_scene.py defaults)
  const canopyY = 3.1, canopyT = 0.22, canopyD = 1.5, stepH = 0.3, doorH = 2.6, doorW = 1.8, bays = 7;
  const span = [0.15, 0.85];
  const sx = span.map((t) => fb.x(t)).sort((p, q) => p - q);
  const springY = 13.75, crownY = b.topY - b.baseY; // 16.0
  const loggiaZ = -1.0;
  const bayX = []; for (let i = 0; i < bays; i++) bayX.push(fb.x(span[0] + (span[1] - span[0]) * (i + 0.5) / bays)); bayX.sort((p, q) => p - q);
  const pitch = (sx[1] - sx[0]) / bays;

  // ---------------- front wall (pink tile) with loggia opening and end openings
  const loggia = { x0: sx[0], x1: sx[1], y0: 0, y1: canopyY };
  const ticket = { x0: -W / 2 + 1.6, x1: -W / 2 + 3.4, y0: 0.95, y1: 2.1 };
  const shop = { x0: sx[1] + 0.9, x1: W / 2 - 0.9, y0: 0.1, y1: 2.85 };
  const shop2 = { x0: -W / 2 + 3.9, x1: sx[0] - 0.7, y0: 0.1, y1: 2.85 };
  const tileRgb = [204, 160, 143];
  const gx = []; for (let x = -Math.floor(W / 2 / 1.6) * 1.6; x <= W / 2; x += 1.6) gx.push(x);
  const gy = []; for (let y = 3.76; y < 12.0; y += 1.6) gy.push(y);
  const painter = paintFacade(fb, -W / 2, W / 2, 0, springY + 0.1, {
    key: 'front', baseRgb: tileRgb, ppm: 50, joints: { xs: gx, ys: gy }, coping: 12.0, canopyTop: canopyY + canopyT, dirtH: 0.8, stains: 22, dirtRgb: [110, 84, 74],
    extra: (P, rng) => {
      // mosaic tile micro-grid (45 mm) as faint grout lines
      const g = P.g; g.save(); g.globalAlpha = 0.06; g.strokeStyle = '#ffffff'; g.lineWidth = 1;
      const step = 0.09 * P.ppm;
      for (let x = 0; x < P.w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, P.h); g.stroke(); }
      for (let y = 0; y < P.h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(P.w, y); g.stroke(); }
      g.restore();
      // ground-floor stone below the canopy
      P.rect(-W / 2, 0, W / 2, canopyY, 'rgba(120,112,104,0.92)');
      P.noise(fb.S.nFine, 0.6, 0.25, 'overlay');
      P.band(0, 0.9, [60, 52, 46], 0.45, 0);
      // grime under the cornice and above the canopy
      P.streakRun(rng, -W / 2, W / 2, 12.0, 0.6, 3.5, 2.5, [105, 82, 72], 0.25);
    },
  });
  const latticeHole = { x0: -W / 2 + 0.01, x1: W / 2 - 0.01, y0: 12.25, y1: 13.55 };
  // round b: restore the adopted upper windows (r03 fixtures milano-upper-window-<row>-<col>, 2 x 10).
  // r02 had covered them with authored billboards without recording the change (history review).
  const winHoles = [];
  for (const f of ctx.data.fixtures.concat(ctx.data.facadeFeatures || []).filter((q) => /^milano-upper-window-\d+-\d+$/.test(q.id))) {
    const pts = f.polygons.flat().map((p) => fb.F.toLocal(p[0], p[1], p[2]));
    const xs = pts.map((v) => v.x), ys = pts.map((v) => v.y);
    winHoles.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), id: f.id });
  }
  fb.add('frontWall', wallWithHoles(-W / 2, 0, W / 2, springY, [loggia, ticket, shop, shop2, latticeHole, ...winHoles], WALL_Z, painter));
  { let wi = 0; for (const h of winHoles) fb.windowUnit(h, { recess: 0.14, mullion: true, cell: (wi++ * 5 + 1) % 16 }); }
  ctx.log(`landmarks/milano: adopted upper windows restored ${winHoles.length}`);
  edgeQuadReturns(fb, W, springY);
  // loggia: columns on the wall line, recessed doors, soffit with downlights
  fb.add('concrete', revealGeo({ x0: loggia.x0, x1: loggia.x1, y0: stepH, y1: canopyY }, loggiaZ - 0.05, WALL_Z));
  for (let i = 0; i <= bays; i++) {
    const x = sx[0] + i * pitch;
    const col = cylGeo(0.27, 0.27, stepH, canopyY, 20); col.translate(x, 0, -0.05); fb.add('column', col);
    const base = cylGeo(0.31, 0.31, stepH, stepH + 0.12, 20); base.translate(x, 0, -0.05); fb.add('brass', base);
  }
  for (const x of bayX) fb.door({ x0: x - doorW / 2, x1: x + doorW / 2, y0: stepH, y1: stepH + doorH }, { zDoor: loggiaZ, transomH: 0.5 });
  // solid infill between door openings on the door line
  {
    const holes = bayX.map((x) => ({ x0: x - doorW / 2, x1: x + doorW / 2, y0: stepH, y1: stepH + doorH }));
    fb.add('loggiaWall', wallWithHoles(sx[0], stepH, sx[1], canopyY, holes, loggiaZ - 0.02, null));
  }
  // round b: the cases sat on the column line (midpoints between doors) and the columns pierced
  // them; mount narrower cases on the column faces, in front of the shafts (front at z = 0.22)
  for (let i = 0; i < bays - 1; i++) fb.showcase((bayX[i] + bayX[i + 1]) / 2, stepH + 0.55, 0.62, 1.4, (i * 3 + 2) % 8, 0.09);
  fb.add('soffit', boxMinMax(sx[0], canopyY, loggiaZ - 0.05, sx[1], canopyY + 0.05, WALL_Z));
  for (const x of bayX) { const d = new THREE.CircleGeometry(0.09, 10); d.rotateX(Math.PI / 2); d.translate(x, canopyY - 0.003, (loggiaZ + WALL_Z) / 2); fb.add('downlight', d); }
  const lobby = lobbyInterior(fb, sx[0], sx[1], stepH, stepH + doorH + 0.3, loggiaZ - 0.04, 3.2, { cells: 7, wallTint: '#bfa07e' });
  // ticket window and shopfronts at the ends
  fb.windowUnit(ticket, { recess: 0.22, mullion: false, sill: false, cell: 3, glassKey: 'ticketGlass' });
  fb.add('steelDark', boxMinMax(ticket.x0 - 0.05, ticket.y0 - 0.06, WALL_Z - 0.2, ticket.x1 + 0.05, ticket.y0, WALL_Z + 0.24));
  for (const h of [shop, shop2]) {
    fb.add('concrete', revealGeo(h, -0.3, WALL_Z));
    const n = Math.max(2, Math.round((h.x1 - h.x0) / 1.2));
    for (let k = 0; k <= n; k++) { const xx = h.x0 + (h.x1 - h.x0) * k / n; fb.add('alu', boxMinMax(xx - 0.03, h.y0, -0.32, xx + 0.03, h.y1, -0.26)); }
    fb.add('alu', boxMinMax(h.x0, h.y1 - 0.6, -0.32, h.x1, h.y1 - 0.55, -0.26));
    fb.add('alu', boxMinMax(h.x0, h.y0, -0.32, h.x1, h.y0 + 0.35, -0.26));
    fb.add('shopGlass', quadGeo([h.x0, h.y0, -0.29], [h.x1, h.y0, -0.29], [h.x1, h.y1, -0.29], [h.x0, h.y1, -0.29], 1 / 8, 1 / 2, [0.125, 0.5]));
  }
  // canopy with tall yellow fascia (R05/R09 cue)
  fb.canopy(-0.48 * W, 0.48 * W, canopyY, canopyT, canopyD, { fasciaKey: 'yellow', fasciaH: 0.68, lights: 2 });
  // steps (r03: 2 x 0.15 m, 1.6 m out, entrance-span width), extended back into the loggia
  fb.steps(0, W * 0.7, stepH, 2, 1.6, { backTo: loggiaZ - 0.05 });

  // ---------------- billboards (neutral abstract panels), name panel, MILANO letters
  // round b: authored boards sit above the adopted window rows (r02: 4.05-7.55 m, over the windows)
  const bbY0 = 8.05, bbY1 = 11.35;
  const boards = [[-W / 2 + 2.0, -4.6], [4.6, W / 2 - 2.0]]; // clear of the MILANO letters (|x| < ~3.8 m)
  let cell = 1;
  for (const [x0, x1] of boards) {
    fb.add('steelDark', boxMinMax(x0 - 0.1, bbY0 - 0.1, WALL_Z, x1 + 0.1, bbY1 + 0.1, WALL_Z + 0.2));
    const n = Math.max(1, Math.round((x1 - x0) / 4.4));
    for (let k = 0; k < n; k++) {
      const a0 = x0 + (x1 - x0) * k / n + 0.05, a1 = x0 + (x1 - x0) * (k + 1) / n - 0.05;
      const c = (cell++ * 3) % 8;
      const u0 = (c % 2) / 2 + (c % 3) * 0.08, v0 = 1 - (Math.floor(c / 2) + 1) / 4;
      fb.add('billboard', quadGeo([a0, bbY0, WALL_Z + 0.205], [a1, bbY0, WALL_Z + 0.205], [a1, bbY1, WALL_Z + 0.205], [a0, bbY1, WALL_Z + 0.205], 0.29, 1 / 4, [u0, v0]));
    }
    for (let x = x0 + 0.7; x < x1; x += 2.1) {
      fb.add('steelDark', boxMinMax(x - 0.015, bbY1 + 0.1, WALL_Z + 0.1, x + 0.015, bbY1 + 0.14, WALL_Z + 0.85));
      fb.add('lampHead', boxMinMax(x - 0.1, bbY1 + 0.02, WALL_Z + 0.72, x + 0.1, bbY1 + 0.17, WALL_Z + 0.96));
    }
  }
  for (const node of nodes) {
    const loc = fb.local(node);
    if (node.text === '入口') {
      const { L } = fb.letters(node, { depth: 0.02, faceKey: 'labelFace', sideKey: 'labelFace', pins: false, stroke: 3 });
      const pw = L.width + 0.26, ph = node.height_m + 0.16;
      fb.add('labelPlate', boxMinMax(loc.x - pw / 2, loc.y - ph / 2, loc.z - 0.05, loc.x + pw / 2, loc.y + ph / 2, loc.z - 0.018));
      for (const s of [-1, 1]) { const g = cylGeo(0.008, 0.008, loc.y + ph / 2, canopyY, 5, true); g.translate(loc.x + s * (pw / 2 - 0.06), 0, loc.z - 0.034); fb.add('steelDark', g); }
    } else {
      const { L } = fb.letters(node, { depth: 0.07, stroke: 4, pins: false });
      // cream enamel name panel behind the adopted dark letters
      fb.add('enamelPanel', boxMinMax(loc.x - L.width / 2 - 0.45, loc.y - 0.55, WALL_Z, loc.x + L.width / 2 + 0.45, loc.y + 0.55, loc.z - 0.065));
      fb.add('steelDark', boxMinMax(loc.x - L.width / 2 - 0.5, loc.y - 0.6, WALL_Z, loc.x + L.width / 2 + 0.5, loc.y - 0.55, loc.z - 0.06));
    }
  }
  // MILANO (latin letters per R03/R09, 1971-72): red channel letters with cream returns
  {
    const ML = letterGeometry('MILANO', 1.45, 0.16, { px: 170, weight: 'bold', stroke: 16, spacing: 0.34 });
    const m = new THREE.Matrix4().makeTranslation(0, 9.85, WALL_Z + 0.2).premultiply(fb.F.matrix);
    if (ML.face) fb.B.add('milanoFace', ML.face, m);
    if (ML.side) fb.B.add('milanoSide', ML.side, m);
    ctx.tag({ id: 'milano-latin-letters', module: 'landmarks', tier: 'period-plausible-generic', note: 'MILANO latin letters follow R03/R09 (source photos 1971-1972); presence in 1976 assumed (year gap 4-5 years). Position/size authored.' });
  }
  // wall studs (small dark square fixtures at panel nodes, R09 cue), skipping signs/boards
  for (const x of gx) for (const y of [8.56, 10.16, 11.76, 6.96, 5.36]) {
    if (y < 8) continue; // adopted window rows and the name panel occupy this band
    if (y > 7.9 && y < 11.5 && Math.abs(x) > 4.4 && Math.abs(x) < W / 2 - 1.8) continue; // billboards
    if (Math.abs(y - 9.85) < 1.0 && Math.abs(x) < 7.5) continue;
    if (Math.abs(x) > W / 2 - 0.3) continue;
    fb.add('stud', boxMinMax(x - 0.06, y - 0.06, WALL_Z, x + 0.06, y + 0.06, WALL_Z + 0.05));
  }
  // cornice, lattice ventilation band, top band, curved gable
  fb.add('concrete', boxMinMax(-W / 2 - 0.05, 12.0, -0.1, W / 2 + 0.05, 12.25, WALL_Z + 0.22));
  const lt0 = 12.25, lt1 = 13.55;
  fb.add('lattice', quadGeo([-W / 2, lt0, -0.22], [W / 2, lt0, -0.22], [W / 2, lt1, -0.22], [-W / 2, lt1, -0.22], W, lt1 - lt0));
  fb.add('concrete', revealGeo({ x0: -W / 2 + 0.01, x1: W / 2 - 0.01, y0: lt0, y1: lt1 }, -0.22, WALL_Z));
  for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 8) fb.add('concrete', boxMinMax(x - 0.22, lt0, -0.22, x + 0.22, lt1, WALL_Z + 0.04));
  fb.add('concrete', boxMinMax(-W / 2 - 0.03, lt1, -0.1, W / 2 + 0.03, springY, WALL_Z + 0.12));
  // gable: arc wall from springY to crownY
  {
    const N = 32; const s = new THREE.Shape();
    s.moveTo(-W / 2, springY);
    for (let i = 0; i <= N; i++) { const x = -W / 2 + W * i / N; const u = 2 * x / W; s.lineTo(x, springY + (crownY - springY) * (1 - u * u)); }
    s.lineTo(W / 2, springY); s.closePath();
    const g = new THREE.ShapeGeometry(s); g.translate(0, 0, 0.0);
    const pos = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
    fb.add('gable', g);
    // gable coping following the arc
    for (let i = 0; i < N; i++) {
      const xa = -W / 2 + W * i / N, xb = -W / 2 + W * (i + 1) / N;
      const ya = springY + (crownY - springY) * (1 - (2 * xa / W) ** 2), yb = springY + (crownY - springY) * (1 - (2 * xb / W) ** 2);
      const L = Math.hypot(xb - xa, yb - ya); const ang = Math.atan2(yb - ya, xb - xa);
      const c = boxMinMax(0, -0.06, -0.2, L + 0.02, 0.08, 0.12); c.rotateZ(ang); c.translate(xa, ya, 0); fb.add('vaultMetal', c);
    }
  }
  // barrel roof: ruled surface between the front arc and the back edge arc (fits the footprint)
  {
    const bi = (fi + 2) % fp.length; const ba = fp[bi], bb = fp[(bi + 1) % fp.length];
    // front edge endpoints in world: local x=-W/2 and +W/2
    const fL = fb.F.toWorld(-W / 2, 0, 0), fR = fb.F.toWorld(W / 2, 0, 0);
    // pair back endpoints with the nearer front endpoints
    const dA = Math.hypot(ba[0] - fL.x, ba[1] - fL.z) + Math.hypot(bb[0] - fR.x, bb[1] - fR.z);
    const dB = Math.hypot(bb[0] - fL.x, bb[1] - fL.z) + Math.hypot(ba[0] - fR.x, ba[1] - fR.z);
    const [bL, bR] = dA < dB ? [ba, bb] : [bb, ba];
    const NX = 28, NZ = 6;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= NZ; j++) {
      const v = j / NZ;
      for (let i = 0; i <= NX; i++) {
        const u = i / NX; const uu = 2 * u - 1;
        const fx = fL.x + (fR.x - fL.x) * u, fz = fL.z + (fR.z - fL.z) * u;
        const bx = bL[0] + (bR[0] - bL[0]) * u, bz = bL[1] + (bR[1] - bL[1]) * u;
        const x = fx + (bx - fx) * v, z = fz + (bz - fz) * v;
        const y = b.baseY + springY + (crownY - springY) * (1 - uu * uu);
        pos.push(x, y, z); uv.push(u * W, v * 57);
      }
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, c = a + NX + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // ensure upward normals
    if (g.attributes.normal.getY(Math.floor(NX / 2)) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    fb.addWorld('vault', g);
    // back gable
    const bfb = new FacadeBuilder(ctx, kit, b, [bL, bR]);
    const BW = bfb.W; const s = new THREE.Shape(); s.moveTo(-BW / 2, springY);
    for (let i = 0; i <= 24; i++) { const x = -BW / 2 + BW * i / 24; const u = 2 * x / BW; s.lineTo(x, springY + (crownY - springY) * (1 - u * u)); }
    s.closePath();
    const bg = new THREE.ShapeGeometry(s); bfb.add('gable', bg);
    for (const [key, list] of bfb.B.parts) for (const gg of list) fb.addWorld(key, gg);
  }
  for (const g of massWalls(b, b.baseY, b.baseY + springY, new Set([fi]))) fb.addWorld('massWall', g);
  for (const s of [-1, 1]) fb.downpipe(s * (W / 2 - 0.35), 12.0);

  // ---------------- materials
  const M = theatreMaterials(ctx, kit, { wallColorLin: [0.66, 0.6, 0.55], metalLin: [0.14, 0.14, 0.13], glassLin: [0.075, 0.14, 0.16], baseY: b.baseY, topY: b.topY });
  const S = theatreShared(ctx, kit);
  const W8 = (m, o) => weather(m, kit.macro, o);
  const latticeTex = (() => {
    const c = makeCanvas(512, 64); const g = c.getContext('2d');
    g.fillStyle = '#cfc8b8'; g.fillRect(0, 0, 512, 64);
    for (let x = 0; x < 512; x += 16) for (let y = 0; y < 64; y += 16) { g.fillStyle = '#2a2724'; g.fillRect(x + 3, y + 3, 10, 10); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + 3, y + 12, 10, 1); }
    const t = toTexture(c, { repeat: [1 / 4, 1 / 1.3] }); return t;
  })();
  const vaultTex = (() => {
    const c = makeCanvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#cdbfa3'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) { g.fillStyle = 'rgba(80,70,55,0.35)'; g.fillRect(x, 0, 2, 256); g.fillStyle = 'rgba(255,250,235,0.25)'; g.fillRect(x + 2, 0, 1, 256); }
    g.save(); g.globalAlpha = 0.3; g.globalCompositeOperation = 'overlay'; const p = g.createPattern(S.nMottle, 'repeat'); g.fillStyle = p; g.fillRect(0, 0, 256, 256); g.restore();
    return toTexture(c, { repeat: [1 / 4, 1 / 4] });
  })();
  const mats = {
    ...M, ...lobby,
    frontWall: W8(new THREE.MeshStandardMaterial({ map: painter.texture(), roughness: 0.62 }), { baseY: b.baseY, dirt: 0, streak: 0.06, mottle: 0.04 }),
    massWall: W8(new THREE.MeshStandardMaterial({ map: S.panelTex, color: new THREE.Color(0.62, 0.52, 0.47), roughness: 0.85 }), { baseY: b.baseY, dirtH: 1.0, dirt: 0.3, streak: 0.18, mottle: 0.06, topY: b.baseY + springY, topStreak: 0.1 }),
    loggiaWall: new THREE.MeshStandardMaterial({ color: 0x4a403a, roughness: 0.6, envMapIntensity: 0.3 }),
    column: W8(new THREE.MeshStandardMaterial({ color: 0x2b2a2b, roughness: 0.25, metalness: 0.1 }), { baseY: b.baseY, dirtH: 0.6, dirt: 0.2, streak: 0, mottle: 0.1 }),
    yellow: W8(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.6, 0.06), roughness: 0.45, metalness: 0.05 }), { baseY: b.baseY, dirt: 0, streak: 0.22, mottle: 0.12 }),
    shopGlass: new THREE.MeshStandardMaterial({ map: S.windowTex, color: 0xa09c90, roughness: 0.05, metalness: 0.3 }),
    ticketGlass: new THREE.MeshStandardMaterial({ map: S.windowTex, emissive: 0xffe2b0, emissiveIntensity: kit.night ? 0.6 : 0.12, roughness: 0.08 }),
    billboard: new THREE.MeshStandardMaterial({ map: S.billboardTex, roughness: 0.75, emissive: 0xffffff, emissiveMap: S.billboardTex, emissiveIntensity: kit.night ? 0.5 : 0.0 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.5, metalness: 0.5, emissive: 0xfff0d0, emissiveIntensity: kit.night ? 0.6 : 0 }),
    enamelPanel: W8(new THREE.MeshStandardMaterial({ color: 0xe7e1cf, roughness: 0.38 }), { baseY: b.baseY, dirt: 0, streak: 0.18, mottle: 0.08 }),
    milanoFace: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.06, 0.04), roughness: 0.4, emissive: new THREE.Color(1, 0.12, 0.08), emissiveIntensity: kit.night ? 1.4 : 0.0 }),
    milanoSide: new THREE.MeshStandardMaterial({ color: 0xe2dccb, roughness: 0.5 }),
    stud: new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.5, metalness: 0.3 }),
    lattice: new THREE.MeshStandardMaterial({ map: latticeTex, roughness: 0.9 }),
    gable: W8(new THREE.MeshStandardMaterial({ map: vaultTex, roughness: 0.7, metalness: 0.15, side: THREE.DoubleSide }), { baseY: b.baseY, dirt: 0, streak: 0.25, mottle: 0.1 }),
    vault: W8(new THREE.MeshStandardMaterial({ map: vaultTex, roughness: 0.6, metalness: 0.25 }), { baseY: b.baseY, dirt: 0, streak: 0.1, mottle: 0.15 }),
    vaultMetal: new THREE.MeshStandardMaterial({ color: 0x9d9686, roughness: 0.5, metalness: 0.5 }),
  };
  const g = new THREE.Group(); g.name = 'milano-za';
  g.add(fb.build(mats, 'milano'));
  ctx.tag({ id: 'milano-front', module: 'landmarks', tier: 'adopted-inferred', note: 'Milano-za east front: stable name ミラノ座 / 入口 at adopted text nodes, 7 entrance bays, canopy 3.1/1.5 m and 2-step threshold as adopted in r03; dimensions/colours authored assumptions (milano-facade-adoption-rule).' });
  ctx.tag({ id: 'milano-detail', module: 'landmarks', tier: 'period-plausible-generic', note: 'Pink tile wall, lattice band, barrel roof, yellow fascia, studs, columns are authored after the generated colour masters R03/R09 (of 1971-72 sources tokyu-milano-1971/1972) carried to 1976 by assumption; billboards are neutral abstract panels placed above the adopted 2 x 10 upper windows (restored in r04 round b); no corporate emblem (TR mark omitted), no film titles.' });
  return g;
}
