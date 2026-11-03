import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { applyAtmosphere, atmospherePasses } from './atmosphere.js';

// Lighting presets are VISUAL WORKING CHOICES for comparison with the approved colour
// references. They are not historical claims about the 1976 season, time or weather.
export const LOOK_PRESETS = {
  'clear-afternoon': {
    note: 'Visual working choice matched to R01/R02/R08 daylight; not a historical time-of-day claim.',
    // r04 revision: the r02 values (turbidity 6.5, AgX, fog 0.0032, sky fill 0.85) washed every
    // station towards a pale grey and turned the adopted gate red (#A92B1D) salmon. The approved
    // references read as saturated reversal film with a deep blue sky and dark-ish shadows.
    sunElevationDeg: 40, sunAzimuthDeg: 222, // azimuth measured clockwise from north
    turbidity: 3.0, rayleigh: 2.4, mieCoefficient: 0.0035, mieDirectionalG: 0.8,
    sunIntensity: 3.7, sunColor: 0xfff0d8, skyFill: 0.56, groundFill: 0x5e564a,
    exposure: 0.95, fogColor: 0xb4c3d2, fogDensity: 0.0019,
    toneMapping: 'neutral',
    bloom: { strength: 0.12, radius: 0.4, threshold: 0.97 },
    grade: { lift: [0.004, 0.0, 0.004], gain: [1.03, 0.995, 0.975], saturation: 1.07, contrast: 1.17, vignette: 0.24, grain: 0.022 }, // round d: less olive shadows, less warm ground, ~7% less saturation (signs/clothes read as pure paint)
  },
  'neon-night': {
    note: 'Visual working choice matched to R04; not a historical claim.',
    sunElevationDeg: -14, sunAzimuthDeg: 260,
    turbidity: 2, rayleigh: 0.4, mieCoefficient: 0.002, mieDirectionalG: 0.7,
    sunIntensity: 0.0, sunColor: 0x8899bb, skyFill: 0.06, groundFill: 0x221d1a,
    exposure: 1.25, fogColor: 0x1a1c24, fogDensity: 0.006,
    toneMapping: 'agx',
    bloom: { strength: 0.75, radius: 0.55, threshold: 0.55 },
    grade: { lift: [0.01, 0.008, 0.016], gain: [1.03, 0.98, 0.98], saturation: 1.1, contrast: 1.06, vignette: 0.3, grain: 0.03 },
  },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uVignette: { value: 0.2 },
    uGrain: { value: 0.02 },
    uSeed: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uLift; uniform vec3 uGain; uniform float uSat; uniform float uContrast;
    uniform float uVignette; uniform float uGrain; uniform float uSeed; uniform float uAspect; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;           // linear, pre-tonemap HDR
      col = col * uGain + uLift;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.18) * uContrast + 0.18;
      vec2 q = vUv - 0.5; q.x *= uAspect;
      float v = 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
      col *= v;
      float n = hash(vUv * 1931.0 + uSeed) - 0.5;
      col *= 1.0 + n * uGrain * 2.0;
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

export function applyLook(ctx, presetName = 'clear-afternoon') {
  const { scene, renderer } = ctx;
  const P = LOOK_PRESETS[presetName];
  if (!P) throw new Error(`unknown look preset ${presetName}`);
  ctx.look = { name: presetName, preset: P };

  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = P.turbidity; u.rayleigh.value = P.rayleigh;
  u.mieCoefficient.value = P.mieCoefficient; u.mieDirectionalG.value = P.mieDirectionalG;
  const phi = THREE.MathUtils.degToRad(90 - P.sunElevationDeg);
  // azimuth clockwise from north (-z) towards east (+x)
  const theta = THREE.MathUtils.degToRad(P.sunAzimuthDeg);
  const sunDir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta)).normalize();
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  ctx.sunDir = sunDir;

  // Environment lighting baked from the sky (code-generated, no HDR files).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky(); envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms.turbidity, { value: P.turbidity });
  envSky.material.uniforms.rayleigh.value = P.rayleigh;
  envSky.material.uniforms.mieCoefficient.value = P.mieCoefficient;
  envSky.material.uniforms.mieDirectionalG.value = P.mieDirectionalG;
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);
  // dark lower hemisphere so the env does not light surfaces from below with sky colour
  const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: P.groundFill, side: THREE.BackSide }));
  envScene.add(ground);
  const envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = P.skyFill;

  const sun = new THREE.DirectionalLight(P.sunColor, P.sunIntensity);
  sun.castShadow = P.sunIntensity > 0;
  sun.shadow.mapSize.set(ctx.quality.shadowMap, ctx.quality.shadowMap);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  ctx.sun = sun;

  scene.fog = new THREE.FogExp2(P.fogColor, P.fogDensity);
  // optional r05 atmosphere (haze, sky gradation; core/atmosphere.js): no-op unless its URL parameters are set
  applyAtmosphere(ctx, sky, presetName, P);
  // Khronos PBR Neutral keeps hue and saturation of paint colours (adopted reds, enamel signs) far
  // better than AgX, which desaturates mid-tones; night keeps AgX for its graceful neon roll-off.
  renderer.toneMapping = P.toneMapping === 'neutral' ? THREE.NeutralToneMapping : P.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = P.exposure;
}

/** Fit the sun's shadow frustum around the region the camera sees. */
export function focusShadow(ctx, camera, radius = 70) {
  const { sun, sunDir } = ctx;
  if (!sun) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0; fwd.normalize();
  const center = camera.position.clone().addScaledVector(fwd, radius * 0.55);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDir, 300);
  const cam = sun.shadow.camera;
  cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
  cam.near = 50; cam.far = 700;
  cam.updateProjectionMatrix();
  sun.target.updateMatrixWorld();
}

const InputShader = {
  uniforms: { tInput: { value: null } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: `uniform sampler2D tInput; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tInput, vUv); }`,
};

/**
 * Bloom, grade and tone mapping after the scene. `input` (optional): a linear HDR texture to use
 * instead of drawing the scene, e.g. the averaged samples of core/accumulate.js; swap it later with
 * composer.setInput(texture) to reuse the passes for the next view or frame (EffectComposer.dispose()
 * does not free the passes' own render targets, so per-view composers would leak GPU memory).
 */
export function makeComposer(ctx, camera, width, height, input = null) {
  const { renderer, scene } = ctx;
  const P = ctx.look.preset;
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: input ? 0 : ctx.quality.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  if (input) {
    const pass = new ShaderPass(InputShader, 'tInputUnused'); // keep tInput: the pass must not read the composer buffer
    pass.uniforms.tInput.value = input;
    composer.addPass(pass);
    composer.setInput = (texture) => { pass.uniforms.tInput.value = texture; };
  } else {
    composer.addPass(new RenderPass(scene, camera));
  }
  const atmo = atmospherePasses(ctx, width, height); // empty unless the atmosphere parameters are set
  for (const pass of atmo.pre) composer.addPass(pass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), P.bloom.strength, P.bloom.radius, P.bloom.threshold);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uLift.value.fromArray(P.grade.lift);
  grade.uniforms.uGain.value.fromArray(P.grade.gain);
  grade.uniforms.uSat.value = P.grade.saturation;
  grade.uniforms.uContrast.value = P.grade.contrast;
  grade.uniforms.uVignette.value = P.grade.vignette;
  grade.uniforms.uGrain.value = P.grade.grain;
  grade.uniforms.uAspect.value = width / height;
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  for (const pass of atmo.post) composer.addPass(pass);
  return composer;
}
