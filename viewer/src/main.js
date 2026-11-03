import * as THREE from 'three';
import { loadData } from './core/data.js';
import { makeRng } from './core/rng.js';
import { applyLook, focusShadow, makeComposer } from './core/look.js';
import { accumulate } from './core/accumulate.js';
import { WORLD_MODULES } from './world/index.js';
import { analyseFacades } from './core/facades.js';
import { prepareSignFonts } from './core/fonts.js';

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
//   spp=<n>                stills: accumulation rendering, n jittered samples averaged (core/accumulate.js);
//                          omitted = the r04 single-pass path
//   aa=<px>                accumulation pixel filter sigma (default 0.42)
//   sunr=<deg>             angular radius of the sun for soft shadows (default 0.27, the solar disk)
//   msaa=<n>               MSAA per accumulation sample (default 0)
//   fstop=<N>, focus=<m>   optional depth of field (35 mm-equivalent full frame), focus distance in metres
//   shutter=<s>            optional motion blur along the walk (walk= only), e.g. 0.0167 for 1/60 s
//   shadow=<px>            stills: sun shadow map size (default 4096)
//   batch=1                stills: build the world once and expose window.__renderView({station|view|walk})
//   (r05 parallel trial)   optional appearance parameters read by the modules themselves through
//                          ctx.params; each is off when omitted, so the default image is unchanged.
//                          The render script passes them with --set k=v[,k=v]
//   atmo=1                 atmosphere/light bundle (core/atmosphere.js; clear-afternoon only, other looks
//                          throw): ltm=0.06, lut=reversal, lutmix=1, haze=1, skygrad=1; each key below
//                          overrides the bundle (0 or lut=none switches that part off)
//   ltm=<s>                local tone mapping: edge-aware log-luminance base compressed (shadow lift
//                          saturating at ~2 stops x s, highlights x(1-0.3 s)), detail kept
//   lut=<name>             code-generated display LUT after OutputPass (reversal: hue preserving); lutmix=<0..1> blend
//   haze=<s>               aerial perspective: per-channel extinction (s x 7.0e-4/8.0e-4/9.5e-4 per m
//                          from 40 m) towards a sky-coloured in-scatter, on top of the preset FogExp2
//   skygrad=<s>            visible sky only: deeper blue towards the zenith, paler/warmer at the horizon
//   mat=1                  buildings: material ageing shader (soot mottling, per-tile colour + dirty grout, patched/cracked mortar, efflorescence, rain streaks below ledges and openings only, rust on steel, roughness variation)
//                          scaled by a per-building age class (new/mid/old; the gate-right corner building is forced new),
//                          plus unlit opal globes on the Ichibangai lamps (streetprops/lamps.js)
//   sign=1                 signage: per-sign ageing (sun fade, chalking, face fade and water marks, dirt, bolt rust runs,
//                          rusty frames), complexity-capped kanji strokes, no thin accent ring round lettering, fan emblem
//                          instead of the concentric-ring rooftop emblem
const params = new URLSearchParams(location.search);
const still = params.get('still') === '1';
const walkT = params.has('walk') ? Number(params.get('walk')) : null; // seconds on cameras/adopted-walk.json
const viewId = params.get('view');
const stationId = params.get('station') || 'entrance-approach';
const width = Number(params.get('w')) || (still ? 1920 : window.innerWidth);
const height = Number(params.get('h')) || (still ? 1080 : window.innerHeight);
const lookName = params.get('look') || 'clear-afternoon';
const only = params.get('only') ? new Set(params.get('only').split(',')) : null;
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const spp = still ? num('spp', 0) : 0;
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
  camera.userData.focalMm = f;
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
    params, // URLSearchParams: optional appearance parameters owned by the modules (see the list above)
    quality: { still, shadowMap: still ? num('shadow', 4096) : 2048, msaa: still ? 4 : 2, detailRadius: 140 },
    provenance: [],
    /** Record the evidence tier of generated content. tier: source-derived | period-plausible-generic | placeholder */
    tag(entry) { ctx.provenance.push(entry); },
    log,
  };
  window.__ctx = ctx;
  // Which WebGL implementation is drawing (SwiftShader = CPU; otherwise the GPU), and whether the
  // sign fonts are installed (a missing family silently falls back and changes the lettering).
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    window.__gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { window.__gpu = `unknown (${e.message})`; }
  log(`webgl renderer: ${window.__gpu}`);
  {
    const { missing, sources } = await prepareSignFonts(log);
    window.__fontWarnings = missing;
    window.__fontSources = sources;
  }
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

  const walkCamera = (t) => {
    const pose = data.walkPose(t);
    setStationCamera({ position_m: pose.position_m, look_at_m: pose.look_at_m, focal_length_35mm_equivalent_mm: data.walk.focal_length_35mm_equivalent_mm });
  };
  if (walkT !== null) {
    walkCamera(walkT);
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

  const composer = spp > 0 ? null : makeComposer(ctx, camera, width, height);
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

  // batch=1: build the world once, then the renderer script calls window.__renderView() per camera.
  // The world does not depend on the camera (detail ranges are measured from the route), so every
  // view sees the same world as a one-view page; only the per-page build time is saved.
  if (still && params.get('batch') === '1') {
    let post = null; // one bloom/grade/output chain for every view (see makeComposer)
    window.__renderView = async (v) => {
      const tv = performance.now();
      if (v.walk !== undefined && v.walk !== null) walkCamera(v.walk);
      else {
        const cam = v.view ? data.reviewCameras[v.view] : data.cameras[v.station];
        if (!cam) throw new Error(`unknown camera ${v.view || v.station}`);
        setStationCamera(cam);
      }
      focusShadow(ctx, camera, 90);
      const isWalk = v.walk !== undefined && v.walk !== null;
      const { texture, target, stats } = await accumulate(ctx, camera, width, height, {
        spp: Math.max(1, spp), aa: num('aa', undefined), sunRadiusDeg: num('sunr', undefined), msaa: num('msaa', 0),
        fstop: num('fstop', 0), focus: num('focus', 0), focalMm: camera.userData.focalMm,
        shutter: isWalk ? num('shutter', 0) : 0, pose: isWalk ? (dt) => walkCamera(v.walk + dt) : null,
        shadowRadius: 90,
      });
      if (post) post.setInput(texture); else post = makeComposer(ctx, camera, width, height, texture);
      post.render();
      target.dispose();
      log(`view ${JSON.stringify(v)}: accumulated ${stats.spp} samples in ${stats.ms} ms, view total ${(performance.now() - tv).toFixed(0)} ms`);
      return { ...stats, viewMs: Math.round(performance.now() - tv) };
    };
    log(`world ready in ${(performance.now() - t0).toFixed(0)} ms (batch)`);
    window.__worldReady = true;
    return;
  }

  if (still && spp > 0) {
    const { texture, stats } = await accumulate(ctx, camera, width, height, {
      spp, aa: num('aa', undefined), sunRadiusDeg: num('sunr', undefined), msaa: num('msaa', 0),
      fstop: num('fstop', 0), focus: num('focus', 0), focalMm: camera.userData.focalMm,
      shutter: walkT !== null ? num('shutter', 0) : 0, pose: walkT !== null ? (dt) => walkCamera(walkT + dt) : null,
      shadowRadius: 90,
    });
    window.__accum = stats;
    log(`accumulated ${stats.spp} samples in ${stats.ms} ms (${stats.msPerSample} ms/sample) ${JSON.stringify(stats)}`);
    makeComposer(ctx, camera, width, height, texture).render();
    log(`still rendered in ${(performance.now() - t0).toFixed(0)} ms`);
    window.__renderDone = true;
    return;
  }
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
