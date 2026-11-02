import * as THREE from 'three';
import { MAT, lin, jitter, mat4, mul, mixc, prim } from './kit.js';
import { ATLAS } from './materials.js';
import { buildArmStreetLight } from './poles.js';

// Traffic equipment at the Ichibangai entrance and on the main road: 1970s horizontal
// three-lamp vehicle signals and two-box pedestrian signals at a crossing in front of the gate,
// regulatory signs (pedestrian-only with plate as in R08, vehicle no-entry and speed limit as in
// R01), orange portable barricades (R08), white pedestrian guard rails and arm street lights.
// All period-plausible-generic: the crossing, signal and sign positions are not documented.

const GALV = lin('#9a9e9b');
const SIGNAL_GREY = lin('#5f6461');
let VISOR = null;
function visorGeo() {
  if (!VISOR) {
    VISOR = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true, -Math.PI / 2 - 1.2, 2.4 + Math.PI * 0.0);
    VISOR.rotateX(Math.PI / 2); // axis along z, open below
    VISOR.translate(0, 0, 0.5);
  }
  return VISOR;
}

/** Vehicle signal head; local +z faces traffic. lit: 'red'|'yellow'|'green'. */
function signalHead(B, W, lit) {
  const body = jitter(SIGNAL_GREY, () => 0.5, 0);
  B.box(W, 0, 0, 0, 1.08, 0.36, 0.22, body, MAT.metalPaint);
  B.box(W, 0, 0.19, 0, 1.0, 0.02, 0.2, mixc(body, [0, 0, 0], 0.2), MAT.metalPaint);
  const lamps = [['green', -0.34, lin('#1f9e86')], ['yellow', 0, lin('#e7a52a')], ['red', 0.34, lin('#e2341f')]];
  for (const [name, x, col] of lamps) {
    const on = name === lit;
    B.cyl(W, x, 0, 0.11, 0.145, 0.012, lin('#1d1d1d'), MAT.metalPaint, 14, 1, 0, Math.PI / 2);
    B.add(prim.sphere(12, 6), mul(W, mat4(x, 0, 0.115, 0, 0, 0, 0.125, 0.125, 0.025)), on ? col : mixc(col, [0.02, 0.02, 0.02], 0.82), MAT.lens, { emit: on ? [5.0, 2.6] : [0, 0] });
    B.add(visorGeo(), mul(W, mat4(x, 0, 0.11, 0, 0, 0, 0.16, 0.16, 0.24)), body, MAT.metalPaint, { flipNormals: false });
    B.add(visorGeo(), mul(W, mat4(x, 0, 0.11, 0, 0, 0, 0.158, 0.158, 0.24)), body, MAT.metalPaint, { flipNormals: true });
  }
}

/** Pedestrian signal (two boxes, red standing on top, green walking lit below); faces +z. */
function pedHead(B, BA, W) {
  for (const [y, reg, lit] of [[0.17, 'pedRedOff', false], [-0.17, 'pedGreen', true]]) {
    B.box(W, 0, y, 0, 0.32, 0.32, 0.2, SIGNAL_GREY, MAT.metalPaint);
    BA.quad(W, 0, y, 0.101, 0.26, 0.26, ATLAS[reg], [1, 1, 1], MAT.lens, 0, 0, { emit: lit ? [3.0, 1.6] : [0, 0] });
    B.add(visorGeo(), mul(W, mat4(0, y, 0.1, 0, 0, 0, 0.17, 0.17, 0.18)), SIGNAL_GREY, MAT.metalPaint);
    B.add(visorGeo(), mul(W, mat4(0, y, 0.1, 0, 0, 0, 0.168, 0.168, 0.18)), SIGNAL_GREY, MAT.metalPaint, { flipNormals: true });
  }
}

function signalPole(kit, x, z, toTraffic, armLen, ry, pedRy, rng) {
  const { B, BA, site } = kit;
  const gy = site.groundAt(x, z);
  const W = mat4(x, gy, z, ry); // local +z: along the arm (over the carriageway)
  B.setGround(gy, 0.4, 0.5);
  const col = jitter(lin('#a7aaa6'), rng, 0.05);
  B.cyl(W, 0, 0, 0, 0.13, 0.4, col, MAT.metalPaint, 10, 0.8);
  B.cyl(W, 0, 0.4, 0, 0.1, 5.4, col, MAT.metalPaint, 10, 0.8);
  B.cyl(W, 0, 5.8, 0, 0.085, 0.05, col, MAT.metalPaint, 10);
  // arm with diagonal tie rod
  B.rod(W, [0, 5.25, 0], [0, 5.35, armLen], 0.055, col, MAT.metalPaint, 6, 0.7);
  B.rod(W, [0, 5.75, 0], [0, 5.36, armLen * 0.55], 0.018, col, MAT.metalPaint, 4);
  // head hangs under the arm end, facing the approaching traffic (toTraffic is its local yaw)
  B.rod(W, [0, 5.32, armLen - 0.05], [0, 5.08, armLen - 0.05], 0.025, col, MAT.metalPaint, 4);
  signalHead(B, mul(W, mat4(0, 4.9, armLen - 0.05, toTraffic)), 'red');
  // pedestrian head on the pole at ~2.7 m, plus push-button box
  pedHead(B, BA, mul(W, mat4(0, 2.75, 0, pedRy - ry)).multiply(mat4(0, 0, 0.2)));
  B.box(W, 0, 1.15, 0, 0.12, 0.2, 0.08, lin('#d4b23a'), MAT.paint, pedRy - ry, 0, 0, undefined);
  site.markBox(x, z, 0.2, 0.2, 0, gy, gy + 6);
  return { x, z, r: 0.25, kind: 'signal-pole' };
}

/** Round regulatory sign on a galvanised pipe. Face points along local +z. */
function signPost(kit, x, z, ry, discs, plate, rng, topY = 2.75) {
  const { B, BA, site } = kit;
  const gy = site.groundAt(x, z);
  const W = mat4(x, gy, z, ry);
  B.setGround(gy, 0.3, 0.55);
  B.cyl(W, 0, 0, 0, 0.032, topY + 0.1, jitter(GALV, rng, 0.05), MAT.galv, 8);
  B.sphere(W, 0, topY + 0.1, 0, 0.034, 0.02, 0.034, GALV, MAT.galv, 8, 4);
  let y = topY - 0.3;
  for (const reg of discs) {
    B.cyl(W, 0, y, 0.035, 0.3, 0.012, lin('#9b9e9c'), MAT.galv, 24, 1, 0, Math.PI / 2);
    BA.quad(W, 0, y, 0.048, 0.6, 0.6, ATLAS[reg], [1, 1, 1], MAT.enamel);
    for (const by of [y + 0.16, y - 0.16]) B.box(W, 0, by, 0.012, 0.09, 0.03, 0.05, GALV, MAT.galv);
    y -= 0.66;
  }
  if (plate) {
    const py = y + 0.2;
    B.box(W, 0, py, 0.035, 0.62, 0.21, 0.012, lin('#9b9e9c'), MAT.galv);
    BA.quad(W, 0, py, 0.042, 0.6, 0.19, ATLAS[plate], [1, 1, 1], MAT.enamel);
  }
  site.markBox(x, z, 0.32, 0.12, ry, gy, gy + topY + 0.1);
  return { x, z, r: 0.15, kind: 'sign-post' };
}

function barricade(kit, x, z, ry, rng) {
  const { B, BA, site } = kit;
  const gy = site.groundAt(x, z);
  const W = mat4(x, gy, z, ry);
  B.setGround(gy, 0.25, 0.5);
  const col = jitter(lin('#df9531'), rng, 0.06);
  const w = 1.25;
  // two side frames (feet + uprights) and top rail
  for (const sx of [-w / 2, w / 2]) {
    B.box(W, sx, 0.03, 0, 0.05, 0.05, 0.62, col, MAT.metalPaint);
    B.rod(W, [sx, 0.05, 0], [sx, 1.0, 0], 0.022, col, MAT.metalPaint, 6);
    for (const sz of [-0.29, 0.29]) B.cyl(W, sx, 0, sz, 0.035, 0.03, lin('#222'), MAT.rubber, 8, 1, 0, Math.PI / 2);
  }
  B.rod(W, [-w / 2, 1.0, 0], [w / 2, 1.0, 0], 0.022, col, MAT.metalPaint, 6);
  B.rod(W, [-w / 2, 0.32, 0], [w / 2, 0.32, 0], 0.018, col, MAT.metalPaint, 6);
  B.box(W, 0, 0.72, 0, w - 0.04, 0.5, 0.018, col, MAT.metalPaint);
  BA.quad(W, 0, 0.72, 0.011, w - 0.1, 0.46, ATLAS.barricade, [1, 1, 1], MAT.paint);
  BA.quad(W, 0, 0.72, -0.011, w - 0.1, 0.46, ATLAS.barricade, [1, 1, 1], MAT.paint, Math.PI);
  site.markBox(x, z, w / 2 + 0.05, 0.33, ry, gy, gy + 1.05);
  kit.D.add(site, x, z, w / 2 + 0.25, 0.5, ry, 0.45);
  return { x, z, r: 0.7, kind: 'barricade' };
}

function guardRail(kit, E0, E1, s, rng) {
  const { B, site, streets } = kit;
  const M = streets.main;
  const col = lin('#e3e1d9');
  const ry = Math.atan2(M.e[0], M.e[1]);
  const posts = [];
  for (let E = E0; E <= E1 + 1e-6; E += 2.0) {
    const [x, z] = M.toWorld(E, s);
    if (site.obstacleDistance(x, z, 1) < 0.3 || site.routeDistance(x, z) < 1.6) { posts.push(null); continue; }
    const gy = site.groundAt(x, z);
    posts.push([x, gy, z]);
    B.setGround(gy, 0.25, 0.55);
    B.cyl(mat4(), x, gy, z, 0.034, 0.82, jitter(col, rng, 0.05), MAT.metalPaint, 8);
    B.sphere(mat4(), x, gy + 0.82, z, 0.036, 0.02, 0.036, col, MAT.metalPaint, 8, 4);
  }
  B.setGround(-1e9);
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i], b = posts[i + 1];
    if (!a || !b) continue;
    for (const h of [0.78, 0.42]) B.rod(mat4(), [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.026, jitter(col, rng, 0.04), MAT.metalPaint, 6);
  }
  return ry;
}

export function buildTraffic(ctx, kit) {
  const { site, streets } = kit;
  const M = streets.main;
  const rng = ctx.rng('streetprops/traffic');
  const footprints = [];
  const stats = { signals: 0, signs: 0, barricades: 0, lights: 0 };
  const yaw = (dx, dz) => Math.atan2(dx, dz);
  const S = M.S, e = M.e;

  // ---- signalised crossing in front of the gate ----
  {
    const [x, z] = M.toWorld(-9, M.kerbS - 0.4);
    // arm points south over the eastbound lanes; head faces west (-e) towards eastbound traffic
    footprints.push(signalPole(kit, x, z, yaw(-e[0], -e[1]) - yaw(S[0], S[1]), 5.2, yaw(S[0], S[1]), yaw(S[0], S[1]), rng));
    stats.signals++;
  }
  {
    const [x, z] = M.toWorld(10, M.southKerbS + 0.4);
    footprints.push(signalPole(kit, x, z, yaw(e[0], e[1]) - yaw(-S[0], -S[1]), 5.2, yaw(-S[0], -S[1]), yaw(-S[0], -S[1]), rng));
    stats.signals++;
  }

  // ---- regulatory signs just inside the gate (face south, towards arriving pedestrians) ----
  const placeSign = (s, side, discs, plate) => {
    for (const ds of [0, 0.8, -0.8, 1.6, 2.4, 3.2, 4.0, -1.6]) {
      const p = streets.routeAt(s + ds);
      const rx = side > 0 ? -p.dz : p.dz, rz = side > 0 ? p.dx : -p.dx;
      const d = streets.rayToWall(p.x, p.z, rx, rz, 9);
      if (!isFinite(d)) continue;
      for (const off of [0.55, 0.95, 1.6]) {
        const x = p.x + rx * (d - off), z = p.z + rz * (d - off);
        if (site.obstacleDistance(x, z, 1) < 0.45 || site.routeDistance(x, z) < 1.5) continue;
        const gy = site.groundAt(x, z);
        const ry = yaw(-p.dx, -p.dz);
        if (!site.boxFree(x, z, 0.32, 0.1, ry, gy + 0.1, gy + 2.9)) continue;
        footprints.push(signPost(kit, x, z, ry, discs, plate, rng));
        stats.signs++;
        return true;
      }
    }
    return false;
  };
  placeSign(13.5, +1, ['pedestrian'], 'plateHokousha');
  placeSign(13.0, -1, ['noEntry'], null);

  // ---- speed limit and no-parking on the main road (face the eastbound traffic) ----
  {
    const [x, z] = M.toWorld(-38, M.kerbS - 0.35);
    if (site.wallDistance(x, z, 1) > 0.3) { footprints.push(signPost(kit, x, z, yaw(-e[0], -e[1]), ['speed40', 'noParking'], null, rng, 3.1)); stats.signs++; }
  }

  // ---- portable barricades flanking the entrance (R08) ----
  for (const [E, s] of [[-3.4, 2.3], [5.0, 2.0]]) {
    const [x, z] = M.toWorld(E, s);
    const ry = yaw(S[0], S[1]);
    if (site.footprintClear(x, z, 0.68, 0.34, ry, { h: 1.0, corridor: 1.35 })) {
      footprints.push(barricade(kit, x, z, ry, ctx.rng(`streetprops/barricade/${E}`)));
      stats.barricades++;
    }
  }

  // ---- pedestrian guard rails along the north kerb (gap at the crossing) ----
  guardRail(kit, -60, -12, M.kerbS - 0.12, rng);
  guardRail(kit, 12, 60, M.kerbS - 0.12, rng);

  // ---- arm street lights on the main road ----
  for (const [E, s, dir] of [[-30, M.kerbS - 0.45, 1], [31, M.kerbS - 0.45, 1], [-4, M.southKerbS + 0.45, -1], [52, M.southKerbS + 0.45, -1]]) {
    const [x, z] = M.toWorld(E, s);
    if (site.wallDistance(x, z, 1) < 0.5 || site.routeDistance(x, z) < 1.6) continue;
    const gy = site.groundAt(x, z);
    buildArmStreetLight(kit.B, { x, z, gy, ry: yaw(S[0] * dir, S[1] * dir), rng: ctx.rng(`streetprops/armlight/${E}`) });
    site.markBox(x, z, 0.2, 0.2, 0, gy, gy + 8.5);
    footprints.push({ x, z, r: 0.25, kind: 'street-light' });
    kit.D.add(site, x, z, 0.5, 0.5, 0, 0.5);
    stats.lights++;
  }
  for (const f of footprints) if (f.kind === 'signal-pole' || f.kind === 'sign-post') kit.D.add(site, f.x, f.z, 0.4, 0.4, 0, 0.45);

  ctx.tag({ id: 'streetprops/traffic', module: 'streetprops', tier: 'period-plausible-generic', note: 'Signalised crossing in front of the gate, 1970s three-lamp vehicle and two-box pedestrian signals, pedestrian-only sign + plate (R08), vehicle no-entry (R01), speed-limit 40 (R01), barricades (R08), guard rails and arm street lights. Positions, kerb line (s≈12 m from the gate line) and lane layout are production estimates.' });
  return { footprints, stats };
}
