import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';

// r05 step 1, atmosphere and light (optional; every effect is off unless its URL parameter is set,
// so the default image is unchanged):
//   ltm=<strength>      local tone mapping on the linear HDR frame: an edge-aware blurred log-luminance
//                       base layer is compressed around a fixed anchor (shadows opened with a
//                       saturating lift, highlights pulled in a little) while the detail layer is kept
//   lut=<name>          display-referred 3-D LUT generated in code (no files); lutmix=<0..1> blend
//                       names: reversal (1970s reversal-film-like response)
//   haze=<strength>     distance-based aerial perspective: per-channel extinction (blue > red) towards a
//                       sky-coloured in-scatter, starting a few metres from the camera; replaces the
//                       stock fog blend through THREE.ShaderChunk (patched before the world compiles)
//   skygrad=<strength>  sky gradation: deeper blue towards the zenith, paler and slightly warmer at
//                       the horizon (visible sky only; the environment lighting is unchanged)
//   atmo=1              bundle: the tuned combination below; the individual parameters override it
// All of these are VISUAL WORKING CHOICES for matching the approved colour references; none is a
// historical claim about 1976 film stock, weather or air quality.

export const ATMO_BUNDLE = { ltm: 0.2, lut: 'reversal', lutmix: 1, haze: 1, skygrad: 1 };

// Per-preset constants. Only the daylight preset is tuned; asking for these effects with another
// preset is an error rather than a silent reuse of daylight values.
const ATMO_TUNING = {
  'clear-afternoon': {
    hazeColor: 0xbccfe4,          // in-scatter colour, a little darker than the rendered horizon sky
    hazeBeta: [0.00078, 0.00095, 0.00122], // per-metre extinction at haze=1 (R, G, B)
    hazeStart: 18,                // metres from the camera before any aerial perspective
    ltmAnchor: 0.32,              // linear luminance the base layer is compressed around
    zenithGain: [0.66, 0.80, 0.94], // sky multiplier towards the zenith at skygrad=1 (linear)
    horizonPale: 0.22, horizonWarm: [1.025, 1.0, 0.96],
  },
};

function numParam(params, key, fallbackFromBundle) {
  if (!params.has(key)) return fallbackFromBundle;
  const v = Number(params.get(key));
  if (!Number.isFinite(v) || v < 0) throw new Error(`atmosphere: ${key}=${params.get(key)} must be a number >= 0`);
  return v;
}

/** Resolve the atmosphere parameters from the URL (bundle first, then individual overrides). */
export function readAtmo(params) {
  const p = params || new URLSearchParams();
  if (p.has('atmo') && !['0', '1'].includes(p.get('atmo'))) throw new Error(`atmosphere: atmo=${p.get('atmo')} must be 0 or 1`);
  const b = p.get('atmo') === '1' ? ATMO_BUNDLE : { ltm: 0, lut: null, lutmix: 1, haze: 0, skygrad: 0 };
  let lut = p.has('lut') ? p.get('lut') : b.lut;
  if (lut === '0' || lut === 'none' || lut === '') lut = null;
  if (lut !== null && !LUTS[lut]) throw new Error(`atmosphere: unknown lut=${lut} (known: ${Object.keys(LUTS).join(', ')})`);
  const a = {
    ltm: numParam(p, 'ltm', b.ltm),
    lut,
    lutmix: Math.min(1, numParam(p, 'lutmix', b.lutmix)),
    haze: numParam(p, 'haze', b.haze),
    skygrad: numParam(p, 'skygrad', b.skygrad),
  };
  a.any = a.ltm > 0 || a.lut !== null || a.haze > 0 || a.skygrad > 0;
  return a;
}

const glslVec3 = (v) => `vec3(${v.map((x) => x.toFixed(7)).join(', ')})`;

/**
 * Scene-side effects (haze, sky gradation). Called from applyLook after the sky and fog exist and
 * before any world material compiles. Does nothing when no atmosphere parameter is set.
 */
export function applyAtmosphere(ctx, sky, presetName, P) {
  const a = readAtmo(ctx.params);
  ctx.atmo = a;
  if (!a.any) return;
  const T = ATMO_TUNING[presetName];
  if (!T) throw new Error(`atmosphere parameters are tuned only for ${Object.keys(ATMO_TUNING).join(', ')}, not look=${presetName}`);
  ctx.atmoTuning = T;

  if (a.haze > 0) {
    const beta = T.hazeBeta.map((x) => x * a.haze);
    // view-space position interpolated per fragment (distance is not linear across a triangle)
    THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vHazeView;
#endif
`;
    THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vHazeView = mvPosition.xyz;
#endif
`;
    THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vHazeView;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
    // transmittance = aerial extinction beyond hazeStart x the preset's FogExp2 (kept for the far field)
    THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
	float hazeD = length( vHazeView );
	vec3 hazeT = exp( - max( hazeD - ${T.hazeStart.toFixed(1)}, 0.0 ) * ${glslVec3(beta)} );
	#ifdef FOG_EXP2
		hazeT *= exp( - fogDensity * fogDensity * hazeD * hazeD );
	#else
		hazeT *= 1.0 - smoothstep( fogNear, fogFar, hazeD );
	#endif
	gl_FragColor.rgb = gl_FragColor.rgb * hazeT + fogColor * ( 1.0 - hazeT );
#endif
`;
    ctx.scene.fog = new THREE.FogExp2(T.hazeColor, P.fogDensity);
    ctx.tag({ id: 'atmo-haze', module: 'core/atmosphere', tier: 'period-plausible-generic', note: `aerial perspective haze=${a.haze} (per-channel extinction ${beta.map((x) => x.toExponential(2)).join('/')} per m from ${T.hazeStart} m): visual working choice for depth, not a measurement of 1976 air quality` });
  }

  if (a.skygrad > 0) {
    const s = a.skygrad;
    const zen = T.zenithGain.map((g) => 1 + (g - 1) * s);
    const warm = T.horizonWarm.map((g) => 1 + (g - 1) * s);
    const pale = Math.min(1, T.horizonPale * s);
    const marker = 'gl_FragColor = vec4( retColor, 1.0 );';
    const fs = sky.material.fragmentShader;
    if (!fs.includes(marker)) throw new Error('atmosphere: Sky shader layout changed; sky gradation cannot be applied');
    sky.material.fragmentShader = fs.replace(marker, `
			{
				// r05 sky gradation (core/atmosphere.js): deeper zenith, paler/warmer horizon
				float skyH = clamp( direction.y, 0.0, 1.0 );
				float zenW = smoothstep( 0.0, 0.3, skyH );
				float horW = 1.0 - smoothstep( 0.0, 0.12, skyH );
				float skyL = dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) );
				retColor = mix( retColor, vec3( skyL ), ${pale.toFixed(4)} * horW ) * mix( vec3( 1.0 ), ${glslVec3(warm)}, horW );
				retColor *= mix( vec3( 1.0 ), ${glslVec3(zen)}, zenW );
			}
			${marker}`);
    sky.material.needsUpdate = true;
    ctx.tag({ id: 'atmo-skygrad', module: 'core/atmosphere', tier: 'period-plausible-generic', note: `sky gradation skygrad=${s}: visual working choice towards the reversal-film references (deep zenith), not a historical weather claim` });
  }
  if (a.ltm > 0) ctx.tag({ id: 'atmo-ltm', module: 'core/atmosphere', tier: 'period-plausible-generic', note: `local tone mapping ltm=${a.ltm}: rendering choice (large-scale contrast compression), no historical meaning` });
  if (a.lut) ctx.tag({ id: `atmo-lut-${a.lut}`, module: 'core/atmosphere', tier: 'period-plausible-generic', note: `code-generated LUT "${a.lut}" mix ${a.lutmix}: a generic reversal-film-like response chosen by eye against R01/R02/R08, not a model of a specific 1976 film stock or lab` });
}

// ---------------------------------------------------------------------------------------------
// 3-D LUTs generated in code. Input/output are display-referred (sRGB-encoded) values in [0, 1],
// applied after OutputPass (tone mapping + sRGB).

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Subtle 1970s reversal-film-like response (Ektachrome/Fujichrome-like, by eye). */
function reversal([r, g, b]) {
  // 1. gentle per-channel S-curve (mid slope ~1.12, denser toe, soft shoulder)
  const s = (x) => x + 0.24 * x * (1 - x) * (2 * x - 1);
  let c = [s(r), s(g), s(b)];
  let y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // 2. split toning: cool-ish shadows, warm highlights (small)
  const ws = Math.pow(1 - smooth(0.0, 0.55, y), 2);
  const wh = smooth(0.5, 1.0, y);
  c = [c[0] - 0.010 * ws + 0.014 * wh, c[1] + 0.002 * ws + 0.004 * wh, c[2] + 0.016 * ws - 0.016 * wh];
  // 3. hue-selective density: deeper, richer blue sky; denser reds; otherwise untouched
  const [R, G, B] = c;
  const blue = smooth(0.06, 0.32, B - R) * smooth(0.0, 0.10, B - G);
  c = [R * (1 - 0.07 * blue), G * (1 - 0.045 * blue), B * (1 - 0.01 * blue)];
  const red = smooth(0.10, 0.40, c[0] - Math.max(c[1], c[2]));
  c = [c[0] * (1 - 0.005 * red), c[1] * (1 - 0.035 * red), c[2] * (1 - 0.03 * red)];
  // 4. reversal film loses saturation towards white: pull very bright colours a little to neutral
  y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const hi = 0.12 * smooth(0.75, 1.0, y);
  c = c.map((v) => v + (y - v) * hi);
  return c.map((v) => Math.min(1, Math.max(0, v)));
}

const LUTS = { reversal };

export function makeLutTexture(name, size = 33) {
  const fn = LUTS[name];
  if (!fn) throw new Error(`atmosphere: unknown lut ${name}`);
  const data = new Uint16Array(size * size * size * 4);
  let i = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const out = fn([ri / (size - 1), gi / (size - 1), bi / (size - 1)]);
    data[i++] = THREE.DataUtils.toHalfFloat(out[0]);
    data[i++] = THREE.DataUtils.toHalfFloat(out[1]);
    data[i++] = THREE.DataUtils.toHalfFloat(out[2]);
    data[i++] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.type = THREE.HalfFloatType;
  tex.format = THREE.RGBAFormat;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Local tone mapping (linear HDR in, linear HDR out).

const quadVS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const LUM = 'vec3(0.2126, 0.7152, 0.0722)';

const DownShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: quadVS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
    float ll(vec2 uv){ return log2(max(dot(texture2D(tDiffuse, uv).rgb, ${LUM}), 1e-4)); }
    void main(){
      // mean log-luminance of the 4x4 source block (four bilinear taps)
      float L = 0.25 * (ll(vUv + uTexel * vec2(-1.0, -1.0)) + ll(vUv + uTexel * vec2(1.0, -1.0)) + ll(vUv + uTexel * vec2(-1.0, 1.0)) + ll(vUv + uTexel * vec2(1.0, 1.0)));
      gl_FragColor = vec4(L, L, 0.0, 1.0);
    }`,
};

// separable bilateral blur of channel r (log2 luminance); channel g carries the unblurred value
const BlurShader = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uSigmaR: { value: 0.9 } },
  vertexShader: quadVS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uSigmaR; varying vec2 vUv;
    #define RADIUS 20
    #define SIGMA_S 9.0
    void main(){
      vec4 c0 = texture2D(tDiffuse, vUv);
      float sum = 0.0, wsum = 0.0;
      for (int i = -RADIUS; i <= RADIUS; i++) {
        float fi = float(i);
        float Li = texture2D(tDiffuse, vUv + uDir * fi).r;
        float dr = (Li - c0.r) / uSigmaR;
        float w = exp(-0.5 * fi * fi / (SIGMA_S * SIGMA_S) - 0.5 * dr * dr);
        sum += w * Li; wsum += w;
      }
      gl_FragColor = vec4(sum / wsum, c0.g, 0.0, 1.0);
    }`,
};

const ApplyShader = {
  uniforms: {
    tDiffuse: { value: null }, tBase: { value: null }, uLowSize: { value: new THREE.Vector2() },
    uStrength: { value: 0.3 }, uAnchor: { value: 0 }, uSigmaR: { value: 0.9 },
  },
  vertexShader: quadVS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tBase; uniform vec2 uLowSize;
    uniform float uStrength; uniform float uAnchor; uniform float uSigmaR; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float L = log2(max(dot(c.rgb, ${LUM}), 1e-4));
      // joint bilateral upsampling of the base layer: the four nearest low-res texels, weighted
      // bilinearly and by how close their own (unblurred) log-luminance is to this pixel's
      vec2 p = vUv * uLowSize - 0.5;
      vec2 f = fract(p); vec2 i0 = floor(p);
      float base = 0.0, wsum = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
        vec2 uv = (clamp(i0 + o, vec2(0.0), uLowSize - 1.0) + 0.5) / uLowSize;
        vec4 t = texture2D(tBase, uv);
        float wb = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
        float dr = (t.g - L) / uSigmaR;
        float w = wb * exp(-0.5 * dr * dr) + 1e-5 * wb;
        base += w * t.r; wsum += w;
      }
      base /= wsum;
      float d = base - uAnchor;
      // shadows: saturating lift (at most ~2 stops x strength); highlights: mild linear pull-in
      float nd = d < 0.0 ? d + uStrength * 2.0 * tanh(-d / 2.0) : d * (1.0 - 0.3 * uStrength);
      c.rgb *= exp2(nd - d);
      gl_FragColor = c;
    }`,
};

export class LocalToneMapPass extends Pass {
  constructor(width, height, strength, anchor) {
    super();
    this.strength = strength;
    this.anchor = anchor;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtA = mk(); this.rtB = mk();
    const mat = (S) => new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(S.uniforms), vertexShader: S.vertexShader, fragmentShader: S.fragmentShader, depthTest: false, depthWrite: false });
    this.down = mat(DownShader); this.blur = mat(BlurShader); this.apply = mat(ApplyShader);
    this.quad = new FullScreenQuad(null);
    this.setSize(width, height);
  }

  setSize(width, height) {
    this.width = width; this.height = height;
    const lw = Math.max(1, Math.round(width / 4)), lh = Math.max(1, Math.round(height / 4));
    this.rtA.setSize(lw, lh); this.rtB.setSize(lw, lh);
    this.down.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.apply.uniforms.uLowSize.value.set(lw, lh);
    this.lowSize = [lw, lh];
  }

  render(renderer, writeBuffer, readBuffer) {
    const [lw, lh] = this.lowSize;
    this.down.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.down; renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    this.blur.uniforms.tDiffuse.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(1 / lw, 0);
    this.quad.material = this.blur; renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
    this.blur.uniforms.tDiffuse.value = this.rtB.texture; this.blur.uniforms.uDir.value.set(0, 1 / lh);
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    const u = this.apply.uniforms;
    u.tDiffuse.value = readBuffer.texture; u.tBase.value = this.rtA.texture;
    u.uStrength.value = this.strength; u.uAnchor.value = Math.log2(this.anchor);
    this.quad.material = this.apply;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.down.dispose(); this.blur.dispose(); this.apply.dispose(); this.quad.dispose();
  }
}

/** Passes for makeComposer: `pre` goes before bloom (linear HDR), `post` after OutputPass. */
export function atmospherePasses(ctx, width, height) {
  const a = ctx.atmo;
  if (!a || !a.any) return { pre: [], post: [] };
  const T = ctx.atmoTuning;
  const pre = [], post = [];
  if (a.ltm > 0) pre.push(new LocalToneMapPass(width, height, a.ltm, T.ltmAnchor));
  if (a.lut) {
    const lut = new LUTPass({ lut: makeLutTexture(a.lut), intensity: a.lutmix });
    post.push(lut);
  }
  return { pre, post };
}
