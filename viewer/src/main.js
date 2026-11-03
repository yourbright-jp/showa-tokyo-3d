import * as THREE from 'three';
import { loadData } from './core/data.js';
import { makeRng } from './core/rng.js';
import { applyLook, focusShadow, makeComposer } from './core/look.js';
import { WORLD_MODULES } from './world/index.js';
import { analyseFacades } from './core/facades.js';

// URL parameters
//   station=<station id>   camera from scenes/.../cameras/<id>.json (default entrance-approach)
//   still=1                offline-quality single frame; sets window.__renderDone when finished
//   w, h                   output size (default window size; stills default 1920x1080)
//   walk=<seconds>         camera from the adopted long-take walk (overrides station)
//   view=<camera id>       supplementary review camera scenes/.../cameras/<id>.json that is not a
//                          route station (e.g. r04-gate-establishing); overrides station
//   look=<preset>          lighting preset from core/look.js
//   only=<a,b>             build only the listed world modules (debugging)
//   decor=1972             optional layer: the 1972 temporary street decoration on Ichibangai lamps
const params = new URLSearchParams(location.search);
const still = params.get('still') === '1';
const walkT = params.has('walk') ? Number(params.get('walk')) : null; // seconds on cameras/adopted-walk.json
const viewId = params.get('view');
const stationId = params.get('station') || 'entrance-approach';
const width = Number(params.get('w')) || (still ? 1920 : window.innerWidth);
const height = Number(params.get('h')) || (still ? 1080 : window.innerHeight);
const lookName = params.get('look') || 'clear-afternoon';
const only = params.get('only') ? new Set(params.get('only').split(',')) : null;
if (still) document.body.classList.add('still');

window.__log = [];
const log = (m) => { window.__log.push(m); console.log(m); };
window.addEventListener('error', (e) => { window.__error = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { window.__error = String(e.reason && e.reason.stack || e.reason); });

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: still });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.domElement.style.width = still ? `${width}px` : '100vw';
renderer.domElement.style.height = still ? `${height}px` : '100vh';
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 3000);

function setStationCamera(cam) {
  const [px, py, pz] = cam.position_m;
  const [tx, ty, tz] = cam.look_at_m;
  const f = cam.focal_length_35mm_equivalent_mm || 35;
  // 35 mm equivalent on the 36 mm horizontal film width (same convention as scripts/render_blockout.py)
  const hfov = 2 * Math.atan(18 / f);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / (width / height)));
  camera.position.set(px, py, pz);
  camera.up.set(0, 1, 0);
  camera.lookAt(tx, ty, tz);
  camera.updateProjectionMatrix();
}

async function main() {
  const t0 = performance.now();
  const data = await loadData();
  log(`data loaded: ${data.buildings.length} buildings, ${data.roads.length} road polygons (${(performance.now() - t0).toFixed(0)} ms)`);
  const ctx = {
    THREE, scene, renderer, camera, data,
    rng: makeRng(1976),
    still,
    stationId,
    options: { decor1972: params.get('decor') === '1972' },
    quality: { still, shadowMap: still ? 4096 : 2048, msaa: still ? 4 : 2, detailRadius: 140 },
    provenance: [],
    /** Record the evidence tier of generated content. tier: source-derived | period-plausible-generic | placeholder */
    tag(entry) { ctx.provenance.push(entry); },
    log,
  };
  window.__ctx = ctx;
  applyLook(ctx, lookName);
  const tf = performance.now();
  analyseFacades(ctx);
  log(`facades: ${data.facades.length} edges, ${data.facades.filter((f) => f.streetFacing).length} street-facing (${(performance.now() - tf).toFixed(0)} ms)`);

  for (const mod of WORLD_MODULES) {
    if (only && !only.has(mod.name)) continue;
    const ts = performance.now();
    try {
      const m = await import(new URL(`./world/${mod.path.slice(2)}`, import.meta.url).href + (still ? '' : `?t=${Date.now()}`));
      const group = await m.build(ctx);
      if (group) { group.name = mod.name; scene.add(group); }
      log(`module ${mod.name}: ${(performance.now() - ts).toFixed(0)} ms`);
    } catch (err) {
      log(`module ${mod.name} FAILED: ${err && err.stack || err}`);
      window.__moduleErrors = (window.__moduleErrors || []).concat([`${mod.name}: ${err && err.message || err}`]);
    }
  }

  if (walkT !== null) {
    const pose = data.walkPose(walkT);
    setStationCamera({ position_m: pose.position_m, look_at_m: pose.look_at_m, focal_length_35mm_equivalent_mm: data.walk.focal_length_35mm_equivalent_mm });
  } else {
    let cam = data.cameras[stationId];
    if (viewId) {
      cam = data.reviewCameras[viewId];
      if (!cam) throw new Error(`unknown review view ${viewId} (add it to REVIEW_VIEWS in core/data.js)`);
    }
    if (!cam) throw new Error(`unknown station ${stationId}`);
    setStationCamera(cam);
  }
  focusShadow(ctx, camera, 90);

  const composer = makeComposer(ctx, camera, width, height);
  scene.traverse((o) => { if (o.isMesh && o.userData.noShadow !== true) { o.receiveShadow = true; } /* castShadow is opt-in: three.js defaults it to false, so each module sets it explicitly */ });
  // three.js (r163+) replaces material.envMapIntensity with scene.environmentIntensity whenever a
  // material has no envMap of its own. Bind the scene environment explicitly to materials that ask
  // for a non-default intensity so recesses/interiors that dim their sky fill keep that choice.
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && m.isMeshStandardMaterial && !m.envMap && m.envMapIntensity !== 1 && scene.environment) { m.envMap = scene.environment; m.needsUpdate = true; }
    }
  });

  window.__stats = () => {
    let meshes = 0, tris = 0;
    scene.traverse((o) => {
      if (o.isMesh && o.geometry) {
        meshes++;
        const g = o.geometry; const n = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        tris += n * (o.isInstancedMesh ? o.count : 1);
      }
    });
    return { meshes, tris: Math.round(tris), provenanceEntries: ctx.provenance.length, calls: renderer.info.render.calls };
  };

  if (still) {
    composer.render();
    // second frame after shader compile ensures all lazily-uploaded textures are present
    composer.render();
    log(`still rendered in ${(performance.now() - t0).toFixed(0)} ms`);
    window.__renderDone = true;
    return;
  }

  // Interactive preview: drag to look, WASD to walk at eye height, 1-6 to jump to stations.
  const hud = document.getElementById('hud');
  const keys = new Set();
  let yaw = 0, pitch = 0;
  const syncAngles = () => { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); yaw = e.y; pitch = e.x; };
  syncAngles();
  addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    const n = Number(e.key);
    if (n >= 1 && n <= data.stations.length) { setStationCamera(data.cameras[data.stations[n - 1].id]); syncAngles(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  let dragging = false;
  renderer.domElement.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', (e) => { if (!dragging) return; yaw -= e.movementX * 0.003; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.003)); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); composer.setSize(innerWidth, innerHeight); });
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const speed = keys.has('shift') ? 6 : 1.4;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.has('w')) camera.position.addScaledVector(f, speed * dt);
    if (keys.has('s')) camera.position.addScaledVector(f, -speed * dt);
    if (keys.has('a')) camera.position.addScaledVector(r, -speed * dt);
    if (keys.has('d')) camera.position.addScaledVector(r, speed * dt);
    camera.position.y = data.heightAt(camera.position.x, camera.position.z) + 1.6;
    focusShadow(ctx, camera, 90);
    composer.render();
    hud.textContent = `${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)}  |  1-6 stations, WASD walk, drag look`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => { window.__error = String(err && err.stack || err); console.error(err); });
