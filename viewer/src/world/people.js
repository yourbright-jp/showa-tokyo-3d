import * as THREE from 'three';
import { canvasTexture } from '../core/textures.js';
import { MeshWriter } from './people/mesh.js';
import { emitPerson } from './people/body.js';
import { chooseArchetype, dressPerson, ARCHETYPE_BY_ID, ARCHETYPES } from './people/wardrobe.js';
import { makeFabricTexture, makePeopleMaterial } from './people/fabric.js';
import {
  CORRIDOR_M, BODY_R, makeGrid, rasterGround, rasterBuildings, rasterObstacles, rasterTerrainHeights,
  rasterSceneProps, computeRouteDistances, freeAt, routeInfo, clearLine,
} from './people/placement.js';

// Procedural pedestrians for Kabukicho c.1976 (module: people).
//
// Evidence tier: period-plausible-generic. Clothing, hair and carried items follow the kinds of
// 1970s Tokyo street dress seen in the approved colour references R01/R02/R08; the crowd
// density, mix, positions and poses are production estimates, not a record of who was there.
// People are static for stills in r04. Every person has a stable id, ground position, facing
// and gait phase (group.userData.people) so motion can be added later without re-placing them.

const MIN_SEP = 0.66;          // centre spacing between unrelated people (m)
const TILE = 4;                // placement tile (m); each tile has its own RNG stream
const CHUNK = 24;              // mesh chunk size (m) for frustum culling
const MIN_ROUTE = CORRIDOR_M + BODY_R + 0.06;

// Plaza attractors used to orient walkers (adopted Koma entrance forecourt, Ichibangai mouth,
// Milano-za front, Toho Kaikan front). Approximate production targets.
const ATTRACTORS = [[-28, -84], [-55, -54], [-86, -128], [-12, -112], [-66, -104]];

function zoneOf(ctx, x, z, ri, inPlaza) {
  if (inPlaza) return 'plaza';
  if (ri.d < 9 && z > -60) return 'street';
  if (z < -50 && ri.d < 14) return 'plaza';
  return 'side';
}

export function build(ctx) {
  const t0 = performance.now();
  const group = new THREE.Group();
  const data = ctx.data;
  const look = ctx.look ? ctx.look.name : 'clear-afternoon';

  // ------------------------------------------------------------ free-space grid
  const G = makeGrid(ctx);
  rasterGround(ctx, G);
  rasterBuildings(ctx, G);
  rasterObstacles(ctx, G);
  const terrainHeights = rasterTerrainHeights(ctx, G);
  const propCells = rasterSceneProps(ctx, G);
  computeRouteDistances(ctx, G);
  const tGrid = performance.now();

  const plazaRing = data.plaza && data.plaza.boundary_m ? data.plaza.boundary_m.map((p) => [p[0], p[2]]) : null;
  const inPoly = (x, z, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  const fixedCams = [...Object.values(data.cameras || {}), ...Object.values(data.reviewCameras || {})];
  const camPts = fixedCams.map((c) => c.position_m);
  // View cones: nobody stands right in front of a diagnostic camera or of the walk camera
  // (the walk turns and looks around, so the 1.2 m corridor alone does not keep its view clear).
  const cones = [];
  const addCone = (pos, look, focal, reach) => {
    const dx = look[0] - pos[0], dz = look[2] - pos[2];
    const l = Math.hypot(dx, dz) || 1;
    cones.push({ x: pos[0], z: pos[2], dx: dx / l, dz: dz / l, cos: Math.cos(Math.atan(18 / (focal || 35)) + 0.2), reach });
  };
  // r04: keep only the first 3.5 m in front of fixed cameras empty; between 3.5 and 9 m people may
  // stand but are turned away from the camera (below), so the foreground is populated without close
  // frontal faces exposing the limited face/hand modelling (visual review asked for both).
  for (const c of fixedCams) addCone(c.position_m, c.look_at_m, c.focal_length_35mm_equivalent_mm, 3.5);
  const awayCones = fixedCams.map((c) => {
    const dx = c.look_at_m[0] - c.position_m[0], dz = c.look_at_m[2] - c.position_m[2], l = Math.hypot(dx, dz) || 1;
    return { x: c.position_m[0], z: c.position_m[2], dx: dx / l, dz: dz / l, cos: Math.cos(Math.atan(18 / (c.focal_length_35mm_equivalent_mm || 35)) + 0.25), reach: 9.5 };
  });
  const awayFrom = (x, z) => {
    for (const c of awayCones) {
      const vx = x - c.x, vz = z - c.z, d = Math.hypot(vx, vz);
      if (d > c.reach || d < 1e-6) continue;
      if ((vx * c.dx + vz * c.dz) / d > c.cos) return Math.atan2(vx, vz);
    }
    return null;
  };
  if (data.walk && data.walk.samples) {
    const S = data.walk.samples;
    for (let i = 0; i < S.length; i += 4) addCone(S[i].position_m, S[i].look_at_m, data.walk.focal_length_35mm_equivalent_mm, 2.9);
  }
  const inCone = (x, z) => {
    for (const c of cones) {
      const vx = x - c.x, vz = z - c.z;
      const d = Math.hypot(vx, vz);
      if (d > c.reach || d < 1e-6) continue;
      if ((vx * c.dx + vz * c.dz) / d > c.cos) return true;
    }
    return false;
  };

  // r04: nobody stands in the arterial traffic lanes except on the ladder crosswalk (visual/history
  // review: pedestrians loitered on the carriageway in the gate establishing view)
  const tg = ctx.scene.children.find((o) => o.name === 'terrain');
  const art = tg && tg.userData.layout && tg.userData.layout.arterial;
  const inTrafficLane = (x, z) => {
    if (!art) return false;
    const t = (x - art.cx) * art.ux + (z - art.cz) * art.uz, o = (x - art.cx) * art.sx + (z - art.cz) * art.sz;
    if (t < art.tMin - 30 || t > art.tMax + 30 || o < art.carriage[0] - 0.3 || o > art.carriage[1] + 0.3) return false;
    return Math.abs(t - art.cwT) > art.cwWidth / 2 - 0.3;
  };
  const density = (x, z, ri, zone) => {
    if (inTrafficLane(x, z)) return 0;
    let d = zone === 'street' ? 0.16 : zone === 'plaza' ? 0.1 : 0.034 * (1 - 0.6 * Math.min(1, Math.max(0, (ri.d - 12) / 28)));
    // keep the immediate foreground of the six diagnostic cameras mostly open (same world for all frames)
    for (const c of camPts) {
      const dd = Math.hypot(x - c[0], z - c[2]);
      if (dd < 9) d *= 0.45 + 0.55 * Math.max(0, (dd - 3.5) / 5.5);
    }
    return d;
  };

  // ------------------------------------------------------------ sample people per tile
  const people = [];
  const hash = new Map();
  const hkey = (x, z) => `${Math.floor(x / 1.5)},${Math.floor(z / 1.5)}`;
  const nearOK = (x, z, sep, ignore) => {
    const gx = Math.floor(x / 1.5), gz = Math.floor(z / 1.5);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = hash.get(`${gx + a},${gz + b}`);
      if (!L) continue;
      for (const p of L) { if (ignore && ignore.has(p)) continue; if (Math.hypot(p.x - x, p.z - z) < sep) return false; }
    }
    return true;
  };
  const addP = (p) => { people.push(p); const k = hkey(p.x, p.z); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(p); };
  const okPos = (x, z) => freeAt(G, x, z, MIN_ROUTE) && data.routeDistance(x, z) >= MIN_ROUTE && !inCone(x, z) && !inTrafficLane(x, z);

  const ntx = Math.ceil((G.maxX - G.minX) / TILE), ntz = Math.ceil((G.maxZ - G.minZ) / TILE);
  const cellsPerTile = TILE / G.cell;
  for (let tz = 0; tz < ntz; tz++) for (let tx = 0; tx < ntx; tx++) {
    const cells = [];
    let expected = 0;
    for (let a = 0; a < cellsPerTile; a++) for (let b = 0; b < cellsPerTile; b++) {
      const gx = tx * cellsPerTile + b, gz = tz * cellsPerTile + a;
      if (gx >= G.nx || gz >= G.nz) continue;
      const id = gz * G.nx + gx;
      if (!G.walk[id] || G.block[id] || !(G.rd[id] >= MIN_ROUTE - 0.25)) continue;
      const x = G.cx(gx), z = G.cz(gz);
      const ri = routeInfo(data.route, x, z);
      // "ground" class (not road/paving): forecourts and setbacks, only where seen from the route
      if (G.walk[id] === 2 && (ri.d > 26 || !clearLine(G, x, z, ri.foot[0], ri.foot[1]))) continue;
      const zone = zoneOf(ctx, x, z, ri, plazaRing ? inPoly(x, z, plazaRing) : false);
      const d = density(x, z, ri, zone) * (G.walk[id] === 2 ? 0.6 : 1);
      expected += d * G.cell * G.cell;
      cells.push({ x, z, d, zone });
    }
    if (!cells.length || expected <= 0) continue;
    const r = ctx.rng(`people/tile/${tx},${tz}`);
    const n = Math.floor(expected) + (r() < expected - Math.floor(expected) ? 1 : 0);
    let cum = 0;
    const cdf = cells.map((c) => (cum += c.d));
    for (let k = 0; k < n; k++) {
      for (let attempt = 0; attempt < 7; attempt++) {
        const u = r() * cum;
        let lo = 0; while (cdf[lo] < u) lo++;
        const c = cells[lo];
        const x = c.x + (r() - 0.5) * G.cell, z = c.z + (r() - 0.5) * G.cell;
        if (!okPos(x, z) || !nearOK(x, z, MIN_SEP)) continue;
        const id = `p-${tx}-${tz}-${k}`;
        const seed = { id, x, z, zone: c.zone, group: null, role: 'solo' };
        const pg = c.zone === 'plaza' ? 0.34 : c.zone === 'street' ? 0.16 : 0.1;
        if (r() < pg) {
          // couples/colleagues walking side by side, or a standing chat group
          const ri = routeInfo(data.route, x, z);
          const chat = c.zone === 'plaza' ? r() < 0.6 : r() < 0.35;
          const members = [seed];
          if (chat) {
            const m = 1 + Math.floor(r() * (c.zone === 'plaza' ? 3.2 : 2.2));
            const rad = 0.42 + 0.06 * m + r() * 0.1;
            const a0 = r() * Math.PI * 2;
            const cx = x + Math.cos(a0) * rad, cz = z + Math.sin(a0) * rad;
            seed.groupCentre = [cx, cz];
            // the seed stands at angle a0+PI around the centre; the others continue round the circle
            for (let j = 1; j <= m; j++) {
              const a = a0 + Math.PI + j * ((Math.PI * 2) / (m + 1)) + (r() - 0.5) * 0.25;
              members.push({ id: `${id}-${j}`, x: cx + Math.cos(a) * rad, z: cz + Math.sin(a) * rad, zone: c.zone });
            }
            members.forEach((mm) => { mm.groupCentre = [cx, cz]; });
          } else {
            const tan = c.zone === 'street' ? ri.tan : [Math.cos(r() * 6.283), Math.sin(r() * 6.283)];
            const side = r() < 0.5 ? 1 : -1;
            const sp = 0.56 + r() * 0.1;
            members.push({ id: `${id}-1`, x: x - tan[1] * sp * side, z: z + tan[0] * sp * side, zone: c.zone });
            members.forEach((mm) => { mm.pairTan = tan; });
          }
          const ok = [];
          for (const [j, mm] of members.entries()) {
            if (j > 0 && !(okPos(mm.x, mm.z) && nearOK(mm.x, mm.z, MIN_SEP))) continue;
            if (ok.some((o) => Math.hypot(o.x - mm.x, o.z - mm.z) < 0.5)) continue;
            ok.push(mm);
          }
          if (ok.length >= 2) {
            ok.forEach((mm) => { mm.group = id; mm.role = chat ? 'chat' : 'pair'; mm.groupSize = ok.length; });
            ok.forEach(addP);
            break;
          }
          seed.group = null; seed.role = 'solo'; delete seed.groupCentre;
        }
        addP(seed);
        break;
      }
    }
  }
  const tPlace = performance.now();

  // ------------------------------------------------------------ looks, facing and poses
  const groupLook = new Map();
  for (const p of people) {
    const r = ctx.rng(`people/look/${p.id}`);
    const ri = routeInfo(data.route, p.x, p.z);
    p.rd = ri.d;
    const bias = p.zone === 'plaza' ? { 'young-man-flares': 1.5, 'young-woman-flares': 1.5, 'student-gakuran': 1.3, 'student-sailor': 1.3 } : p.zone === 'side' ? { worker: 2, 'man-casual': 1.4 } : {};
    let arch;
    if (p.group && groupLook.has(p.group)) {
      const gl = groupLook.get(p.group);
      if (p.role === 'pair' && gl.pairPartner) arch = ARCHETYPE_BY_ID[gl.pairPartner];
      else arch = r() < 0.5 ? ARCHETYPE_BY_ID[gl.arch] : chooseArchetype(r, bias); // r04: 0.5 (was 0.7) — fewer look-alike groups
    } else {
      arch = chooseArchetype(r, bias);
      if (p.group) {
        const partners = {
          'salaryman-suit': ['salaryman-suit', 'office-lady', 'salaryman-shirtsleeves'],
          'young-man-flares': ['young-woman-flares', 'young-man-flares', 'woman-dress'],
          'young-woman-flares': ['young-man-flares', 'young-woman-flares'],
          'office-lady': ['office-lady', 'salaryman-suit'],
          'student-sailor': ['student-sailor'], 'student-gakuran': ['student-gakuran'],
          'housewife': ['housewife', 'woman-coat'], 'woman-dress': ['young-man-flares', 'woman-dress', 'salaryman-suit'],
        };
        const pp = partners[arch.id];
        groupLook.set(p.group, { arch: arch.id, pairPartner: pp ? r.pick(pp) : null });
      }
    }
    const P = dressPerson(r, arch);
    p.look = P;
    p.archetype = arch.id;

    // facing
    const walkP = p.role === 'chat' ? 0 : p.role === 'pair' ? 0.85 : p.zone === 'street' ? 0.72 : p.zone === 'plaza' ? 0.45 : 0.62;
    const walking = r() < walkP && !(p.role === 'chat');
    let yaw;
    if (p.role === 'chat') {
      const [cx, cz] = p.groupCentre;
      yaw = Math.atan2(cx - p.x, cz - p.z) + (r() - 0.5) * 0.5;
    } else if (p.role === 'pair' && groupLook.get(p.group)) {
      const gl = groupLook.get(p.group);
      if (gl.yaw === undefined) {
        const t = p.pairTan;
        gl.yaw = Math.atan2(t[0], t[1]) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.2;
      }
      yaw = gl.yaw + (r() - 0.5) * 0.1;
    } else if (walking) {
      if (p.zone === 'street') {
        const lat = (p.x - ri.foot[0]) * ri.tan[1] - (p.z - ri.foot[1]) * ri.tan[0];
        const fwd = r() < (lat > 0 ? 0.6 : 0.4);
        yaw = Math.atan2(ri.tan[0], ri.tan[1]) + (fwd ? 0 : Math.PI) + (r() - 0.5) * 0.3;
      } else if (p.zone === 'plaza') {
        const a = ATTRACTORS[Math.floor(r() * ATTRACTORS.length)];
        yaw = Math.atan2(a[0] - p.x, a[1] - p.z) + (r() < 0.35 ? Math.PI : 0) + (r() - 0.5) * 0.5;
      } else {
        const e = 0.6;
        const gx = data.routeDistance(p.x + e, p.z) - data.routeDistance(p.x - e, p.z);
        const gz = data.routeDistance(p.x, p.z + e) - data.routeDistance(p.x, p.z - e);
        yaw = Math.atan2(gx, gz) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.25;
      }
    } else {
      // standing: window-shopping towards the nearest facade when close, else loosely towards the street
      const wall = nearestFacade(data, p.x, p.z);
      if (wall && wall.d < 1.7 && r() < 0.55) yaw = Math.atan2(-wall.n[0], -wall.n[1]) + (r() - 0.5) * 0.5;
      else yaw = Math.atan2(ri.foot[0] - p.x, ri.foot[1] - p.z) + (r() - 0.5) * 2.4;
    }
    // r04: near the fixed cameras, turn away from the lens (keeps chat groups' inward facing loosely)
    const away = awayFrom(p.x, p.z);
    if (away !== null) yaw = p.role === 'chat' ? away + (r() - 0.5) * 1.6 : away + (r() - 0.5) * 0.7;
    p.yaw = yaw;

    // pose
    const f = P.sex === 'f';
    const elderly = P.age > 62;
    const pose = { type: walking ? 'walk' : 'stand', phase: r(), arms: {}, wide: P.bottom.kind === 'skirt' || P.top.kind === 'coat' || P.top.kind === 'kimono' || P.girth > 1.12 };
    if (walking) {
      pose.stride = P.top.kind === 'kimono' ? 0.13 : (P.bottom.kind === 'skirt' ? 0.27 : f ? 0.35 : 0.4) * (elderly ? 0.82 : 1) + r.range(-0.02, 0.025);
      pose.lean = r.range(-0.02, 0.03) + (elderly ? 0.04 : 0);
      if (p.role === 'pair') pose.phase = (ctx.rng(`people/pairphase/${p.group}`)() + (p.id.endsWith('-1') ? r.range(-0.1, 0.1) : 0) + 1) % 1;
    } else {
      pose.weight = r() < 0.5 ? 1 : -1;
      pose.spread = r.range(-0.1, 0.35);
      pose.relaxFwd = r.range(-0.01, 0.06);
      pose.yawJ = r.range(-0.12, 0.12);
      pose.lean = r.range(-0.015, 0.02);
    }
    pose.headYaw = r.range(-0.35, 0.35);
    pose.headPitch = r.range(-0.06, 0.1);
    if (p.role === 'chat') pose.headYaw = r.range(-0.5, 0.5);
    // arms follow what is carried
    const bagHand = P.bag && (P.bag.kind !== 'shoulder') ? (P.bag.hand === 'L' ? 1 : -1) : 0;
    const umbHand = P.umbrella ? (P.umbrella.hand === 'L' ? 1 : -1) : 0;
    for (const s of [1, -1]) {
      let m;
      if (s === bagHand) m = P.bag.kind === 'handbag' && f && r() < 0.45 ? 'crook' : 'carry';
      else if (s === umbHand) m = 'carry';
      else if (walking) m = 'swing';
      else {
        const opts = f ? ['hang', 'hang', 'front', 'crossed'] : P.age > 50 ? ['hang', 'behind', 'pockets', 'crossed'] : ['hang', 'pockets', 'pockets', 'crossed', 'hang'];
        m = r.pick(opts);
      }
      pose.arms[s] = m;
    }
    if (!walking) {
      // pairs of arm poses that must match
      if (pose.arms[1] === 'crossed' || pose.arms[-1] === 'crossed') { if (!bagHand && !umbHand) pose.arms[1] = pose.arms[-1] = 'crossed'; else for (const s of [1, -1]) if (pose.arms[s] === 'crossed') pose.arms[s] = 'hang'; }
      if (pose.arms[1] === 'behind' || pose.arms[-1] === 'behind') { if (!bagHand && !umbHand) pose.arms[1] = pose.arms[-1] = 'behind'; else for (const s of [1, -1]) if (pose.arms[s] === 'behind') pose.arms[s] = 'hang'; }
      if (P.bag && P.bag.kind === 'handbag' && f && r() < 0.5 && !umbHand) { pose.arms[1] = pose.arms[-1] = 'front'; }
      if (P.cigarette && pose.arms[-1] !== 'carry' && pose.arms[-1] !== 'crossed' && pose.arms[-1] !== 'behind' && r() < 0.6) pose.arms[-1] = 'smoke';
      if (p.role === 'chat' && r() < 0.25 && pose.arms[1] === 'hang') pose.arms[1] = 'gesture';
    } else if (P.cigarette && pose.arms[-1] === 'swing' && r() < 0.3) {
      pose.arms[-1] = 'smoke';
    }
    p.pose = pose;
  }
  const tLook = performance.now();

  // ------------------------------------------------------------ geometry (chunked, merged)
  const writers = new Map();
  let maxRd = 0;
  for (const p of people) {
    const id = G.idx(p.x, p.z);
    p.y = id >= 0 && !Number.isNaN(G.gy[id]) ? G.gy[id] : data.heightAt(p.x, p.z);
    const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
    if (!writers.has(key)) writers.set(key, new MeshWriter(1 << 15));
    const w = writers.get(key);
    w.setTransform(p.yaw, p.x, p.y, p.z);
    const q = p.rd < 18 ? 1 : p.rd < 32 ? 0.8 : 0.62; // LOD by route distance
    emitPerson(w, p.look, p.pose, q, hashId(p.id));
    maxRd = Math.max(maxRd, p.rd);
  }
  const fabric = makeFabricTexture(THREE, ctx.rng('people/fabric'));
  const mat = makePeopleMaterial(THREE, fabric);
  let tris = 0;
  for (const [key, w] of writers) {
    const geo = w.toGeometry(THREE);
    tris += w.ni / 3;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `people-chunk-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // soft contact occlusion under each person (people often stand in building shade)
  const blobTex = canvasTexture(64, 64, (g, W, H) => {
    const grd = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.9)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.62)');
    grd.addColorStop(0.7, 'rgba(0,0,0,0.22)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }, { srgb: false });
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: look === 'neon-night' ? 0.8 : 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, people.length);
  const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  people.forEach((p, i) => {
    const walk = p.pose.type === 'walk';
    qn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    sc.set(0.7, 1, walk ? 1.0 : 0.8); // r04: stronger, slightly larger contact shadow (visual review)
    ps.set(p.x, p.y + 0.012, p.z);
    m4.compose(ps, qn, sc);
    blobs.setMatrixAt(i, m4);
  });
  blobs.instanceMatrix.needsUpdate = true;
  blobs.castShadow = false; blobs.receiveShadow = false;
  blobs.userData.noShadow = true;
  blobs.renderOrder = 1;
  blobs.name = 'people-contact-shadows';
  group.add(blobs);

  // ------------------------------------------------------------ manifest + provenance
  const counts = {};
  for (const p of people) counts[p.archetype] = (counts[p.archetype] || 0) + 1;
  group.userData.people = people.map((p) => ({
    id: p.id, archetype: p.archetype, position_m: [round(p.x), round(p.y), round(p.z)], facing_yaw_rad: round(p.yaw, 4),
    facing_xz: [round(Math.sin(p.yaw), 4), round(Math.cos(p.yaw), 4)], zone: p.zone, group: p.group, role: p.role,
    pose: p.pose.type, gait_phase: p.pose.type === 'walk' ? round(p.pose.phase, 4) : null, stride_h: p.pose.stride ? round(p.pose.stride, 3) : null,
    height_m: round(p.look.H, 3), sex: p.look.sex,
  }));
  group.userData.peopleStats = { count: people.length, tris, chunks: writers.size, counts, terrainHeights, propCells, archetypes: ARCHETYPES.length };
  ctx.tag({
    id: 'people-crowd', module: 'people', tier: 'period-plausible-generic',
    note: `${people.length} procedural pedestrians in ${ARCHETYPES.length} 1970s Tokyo dress archetypes (suits/white shirts, shirt-sleeves, trench and wool coats, skirts/dresses, school uniforms, flares and patterned shirts, kimono, work wear) modelled on the kinds of clothing in references R01/R02/R08. Positions, density, mix and poses are production estimates, not a record of the 1976 crowd. Static stride/standing poses; stable ids/positions/facing in group.userData.people.`,
  });
  ctx.tag({
    id: 'people-placement-rule', module: 'people', tier: 'period-plausible-generic',
    note: `Placement rule: adopted asphalt/paving + plaza boundary, ≥${MIN_ROUTE.toFixed(2)} m from the walk centreline (1.2 m corridor + body), ≥0.72 m from facades, off adopted ground obstacles and off other modules' body-height props; foreground of the six diagnostic cameras thinned. Densities 0.16/m² Ichibangai, 0.1/m² plaza, ≤0.034/m² side streets are working choices.`,
  });
  const tEnd = performance.now();
  ctx.log && ctx.log(`people: ${people.length} persons, ${Math.round(tris)} tris, ${writers.size} chunks; grid ${(tGrid - t0).toFixed(0)} ms (terrainHeights=${terrainHeights}, propCells=${propCells}), place ${(tPlace - tGrid).toFixed(0)} ms, looks ${(tLook - tPlace).toFixed(0)} ms, mesh ${(tEnd - tLook).toFixed(0)} ms; mix ${JSON.stringify(counts)}`);
  return group;
}

function round(v, d = 3) { const k = 10 ** d; return Math.round(v * k) / k; }
function hashId(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function nearestFacade(data, x, z) {
  let best = null;
  for (const f of data.facades || []) {
    const [ax, az] = f.a, [bx, bz] = f.b;
    if (Math.abs(f.mid[0] - x) > f.length / 2 + 4 || Math.abs(f.mid[1] - z) > f.length / 2 + 4) continue;
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (!best || d < best.d) best = { d, n: f.normal };
  }
  return best;
}
