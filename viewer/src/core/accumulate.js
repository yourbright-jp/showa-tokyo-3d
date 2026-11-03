import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Accumulation ("jittered multi-pass") still rendering, r05 stage a.
// The world is built once; the frame is drawn `spp` times with slightly different conditions and
// the linear HDR results are averaged before bloom, grade and tone mapping (core/look.js):
//   - anti-aliasing: sub-pixel camera offsets, Gaussian pixel filter (sigma `aa` px)
//   - soft shadows:  the sun light direction is sampled over the solar disk (angular radius
//                    `sunRadiusDeg`), and the shadow map is shifted by sub-texel amounts
//   - depth of field (optional, `fstop` > 0): thin-lens camera offsets with the plane at `focus`
//     metres kept fixed (35 mm-equivalent full-frame aperture f / N)
//   - motion blur (optional, `shutter` > 0 s): the camera pose is sampled across the shutter
// Samples use a 2-D Halton set; each effect visits the set in its own (coprime-stride) order so
// the effects are not correlated with one another.

function halton(i, base) {
  let f = 1, r = 0;
  for (let n = i; n > 0; n = Math.floor(n / base)) { f /= base; r += f * (n % base); }
  return r;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** i-th of `n` 2-D Halton points, visited in the order of dimension `dim`. */
function point(i, n, dim) {
  const strides = [1, 7, 11, 13, 17];
  let s = strides[dim % strides.length];
  while (gcd(s, n) !== 1) s += 2;
  const k = (i * s + dim * 3) % n;
  return [halton(k + 1, 2), halton(k + 1, 3)];
}
/** Uniform unit disk from a unit square (Shirley-Chiu concentric map). */
function disk(u, v) {
  const a = 2 * u - 1, b = 2 * v - 1;
  if (a === 0 && b === 0) return [0, 0];
  let r, phi;
  if (Math.abs(a) > Math.abs(b)) { r = a; phi = (Math.PI / 4) * (b / a); } else { r = b; phi = Math.PI / 2 - (Math.PI / 4) * (a / b); }
  return [r * Math.cos(phi), r * Math.sin(phi)];
}

const MixShader = {
  uniforms: { tPrev: { value: null }, tSample: { value: null }, uWeight: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tPrev; uniform sampler2D tSample; uniform float uWeight; varying vec2 vUv;
    void main(){ gl_FragColor = mix(texture2D(tPrev, vUv), texture2D(tSample, vUv), uWeight); }`,
};

/**
 * Draw `spp` samples into a float32 running mean and return its texture (linear HDR, pre-tonemap).
 * `pose(t)` (optional) places the camera for shutter offset t in seconds (motion blur).
 */
export async function accumulate(ctx, camera, width, height, opts) {
  const { renderer, scene, sun, sunDir } = ctx;
  const spp = Math.max(1, Math.round(opts.spp));
  const aa = opts.aa ?? 0.42;
  const sunR = THREE.MathUtils.degToRad(opts.sunRadiusDeg ?? 0.27);
  const shadowRadius = opts.shadowRadius ?? 90;

  const sampleRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: opts.msaa ?? 0 });
  const acc = [0, 1].map(() => new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
  const mix = new THREE.ShaderMaterial({ ...MixShader, uniforms: THREE.UniformsUtils.clone(MixShader.uniforms), depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(mix);

  const base = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  const pixelsPerRadian = (height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const focalMm = opts.focalMm ?? 35;
  const apertureRadius = opts.fstop > 0 ? (focalMm / 1000) / (2 * opts.fstop) : 0; // metres
  const focus = opts.focus > 0 ? opts.focus : 10;
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), dir = new THREE.Vector3();
  t1.crossVectors(sunDir, Math.abs(sunDir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  t2.crossVectors(sunDir, t1).normalize();
  const sunBase = sun ? { target: sun.target.position.clone(), distance: sun.position.distanceTo(sun.target.position) } : null;
  const texel = sun ? (2 * shadowRadius) / sun.shadow.mapSize.x : 0;

  // shader compile and texture upload before timing
  renderer.setRenderTarget(sampleRT);
  renderer.render(scene, camera);
  // read back one pixel of a float32 target: waits for the GPU, so the timing below is real
  const sync = (rt) => { const px = new Float32Array(4); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px); };
  sync(acc[0]);

  const t0 = performance.now();
  let read = 0;
  for (let i = 0; i < spp; i++) {
    // camera pose: shutter time (motion blur), then the lens offset (depth of field)
    if (opts.pose && opts.shutter > 0) opts.pose(((i + point(i, spp, 4)[0]) / spp - 0.5) * opts.shutter);
    else { camera.position.copy(base.position); camera.quaternion.copy(base.quaternion); }
    camera.updateMatrixWorld();
    let ox = 0, oy = 0;
    if (apertureRadius > 0) {
      const [lu, lv] = point(i, spp, 3);
      const [lx, ly] = disk(lu, lv).map((d) => d * apertureRadius);
      right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(right, lx).addScaledVector(up, ly);
      ox -= (lx / focus) * pixelsPerRadian; oy += (ly / focus) * pixelsPerRadian;
    }
    // sub-pixel offset with a Gaussian filter (Box-Muller on the Halton point)
    const [pu, pv] = point(i, spp, 0);
    const pr = aa * Math.sqrt(-2 * Math.log(Math.max(pu, 1e-6)));
    ox += pr * Math.cos(2 * Math.PI * pv); oy += pr * Math.sin(2 * Math.PI * pv);
    camera.setViewOffset(width, height, ox, oy, width, height);
    camera.updateMatrixWorld();

    // sun direction over the solar disk, shadow map shifted by up to half a texel
    if (sun && sunBase) {
      const [su, sv] = point(i, spp, 1);
      const [dx, dy] = disk(su, sv);
      dir.copy(sunDir).addScaledVector(t1, dx * Math.tan(sunR)).addScaledVector(t2, dy * Math.tan(sunR)).normalize();
      const [hu, hv] = point(i, spp, 2);
      const shift = t1.clone().multiplyScalar((hu - 0.5) * texel).addScaledVector(t2, (hv - 0.5) * texel);
      sun.target.position.copy(sunBase.target).add(shift);
      sun.position.copy(sun.target.position).addScaledVector(dir, sunBase.distance);
      sun.target.updateMatrixWorld();
    }

    renderer.setRenderTarget(sampleRT);
    renderer.render(scene, camera);
    mix.uniforms.tPrev.value = acc[read].texture;
    mix.uniforms.tSample.value = sampleRT.texture;
    mix.uniforms.uWeight.value = 1 / (i + 1);
    renderer.setRenderTarget(acc[1 - read]);
    quad.render(renderer);
    read = 1 - read;
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  sync(acc[read]); // the last sample written
  renderer.setRenderTarget(null);
  const ms = performance.now() - t0;

  camera.clearViewOffset();
  camera.position.copy(base.position); camera.quaternion.copy(base.quaternion); camera.updateMatrixWorld();
  if (sun && sunBase) {
    sun.target.position.copy(sunBase.target);
    sun.position.copy(sunBase.target).addScaledVector(sunDir, sunBase.distance);
    sun.target.updateMatrixWorld();
  }
  sampleRT.dispose(); acc[1 - read].dispose(); quad.dispose(); mix.dispose();
  return {
    texture: acc[read].texture, target: acc[read],
    stats: { spp, ms: Math.round(ms), msPerSample: +(ms / spp).toFixed(1), aa, sunRadiusDeg: opts.sunRadiusDeg ?? 0.27, msaa: opts.msaa ?? 0, fstop: opts.fstop || 0, focus: apertureRadius ? focus : null, shutter: opts.shutter || 0 },
  };
}
