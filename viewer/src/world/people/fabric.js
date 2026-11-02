// Code-generated fabric patterns (no image files) and the shared people material.
//
// One DataArrayTexture holds 128x128 tileable pattern layers. Channel R is the mix factor
// between the vertex colour (ground) and the second vertex colour `col2` (pattern ink);
// channel G is a weave/brightness modulation. Layer order matches PAT in wardrobe.js.
import { makeValueNoise } from '../../core/textures.js';

const S = 128;

function layerFns(rng) {
  const N = makeValueNoise(rng, 256);
  const fbm = (x, y, o = 4, p = 8) => N.fbm(x * p, y * p, o, p);
  const weave = (u, v) => 0.93 + 0.05 * (N.noise2(u * 64, v * 64, 64) - 0.5) * 2 + 0.025 * Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48);
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const band = (x, w) => { const d = Math.abs(((x % 1) + 1) % 1 - 0.5); return 1 - ss(w * 0.5 - 0.02, w * 0.5 + 0.02, d); };
  // tileable flower field
  const flowers = [];
  for (let i = 0; i < 7; i++) flowers.push([rng(), rng(), 0.08 + rng() * 0.06, rng() * Math.PI]);
  return [
    (u, v) => [0, weave(u, v)],
    (u, v) => [band(u * 8, 0.06) * 0.85, weave(u, v)],
    (u, v) => [band(u * 3, 0.42), weave(u, v)],
    (u, v) => { const a = band(u * 2, 0.36), b = band(v * 2, 0.36), t = band(u * 8 + 0.25, 0.08) * 0.5 + band(v * 8 + 0.25, 0.08) * 0.5; return [Math.min(1, a * 0.55 + b * 0.55 + t * 0.35), weave(u, v) * (1 - 0.06 * t)]; },
    (u, v) => {
      let m = 0, ctr = 0;
      for (const [fx, fy, fr, rot] of flowers) {
        for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) {
          const dx = u - fx - ox, dy = v - fy - oy;
          const d = Math.hypot(dx, dy);
          if (d > fr * 1.3) continue;
          const th = Math.atan2(dy, dx) + rot;
          const petal = fr * (0.55 + 0.45 * Math.abs(Math.cos(th * 2.5)));
          m = Math.max(m, 1 - ss(petal * 0.85, petal, d));
          ctr = Math.max(ctr, 1 - ss(fr * 0.18, fr * 0.26, d));
        }
      }
      const leaf = ss(0.62, 0.7, fbm(u, v, 3, 4)) * 0.45;
      return [Math.max(m, leaf) * (1 - ctr * 0.6), weave(u, v) * (1 - ctr * 0.35)];
    },
    (u, v) => { const du = ((u * 3) % 1) - 0.5, dv = ((v * 3 + (Math.floor(u * 3) % 2) * 0.5) % 1) - 0.5; return [1 - ss(0.16, 0.2, Math.hypot(du, dv)), weave(u, v)]; },
    (u, v) => { const n = N.noise2(u * 96, v * 96, 96); const n2 = fbm(u, v, 3, 16); return [ss(0.62, 0.72, n) * 0.8 + ss(0.4, 0.3, n) * 0.0, 0.86 + 0.14 * n2]; },
    (u, v) => { const tw = band((u + v) * 24, 0.5); const fade = fbm(u, v, 4, 4); return [0.12 + tw * 0.28 + 0.25 * ss(0.55, 0.8, fade), 0.9 + 0.1 * N.noise2(u * 128, v * 16, 128)]; },
    (u, v) => [0, 0.8 + 0.2 * Math.abs(Math.sin(u * Math.PI * 16)) - 0.04 * (N.noise2(u * 64, v * 64, 64))],
    (u, v) => { const s = Math.sin((u * 2 + 0.35 * Math.sin(v * Math.PI * 4)) * Math.PI * 2); return [ss(-0.15, 0.15, s), weave(u, v)]; },
    (u, v) => [band(v * 4, 0.45), weave(u, v)],
  ];
}

export function makeFabricTexture(THREE, rng) {
  const fns = layerFns(rng);
  const L = fns.length;
  const data = new Uint8Array(S * S * 4 * L);
  for (let l = 0; l < L; l++) {
    const fn = fns[l];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const [r, g] = fn(x / S, y / S);
      const i = ((l * S + y) * S + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      data[i + 2] = 0; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataArrayTexture(data, S, S, L);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * MeshStandardMaterial reading per-vertex colour pairs, fabric layer, roughness and a procedural
 * fold/strand height used for derivative bump-mapping (cloth wrinkles, hair strands). Folds fade
 * out with screen-space footprint so distant people do not shimmer.
 */
export function makePeopleMaterial(THREE, tex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPat = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 pat;\nattribute vec3 col2;\nvarying vec4 vPat;\nvarying vec3 vCol2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = pat;\nvCol2 = col2;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray uPat;
        varying vec4 vPat;
        varying vec3 vCol2;
        float pHash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
        float pNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float clothFolds(vec2 m) {
          float n = pNoise(m * vec2(7.0, 3.5));
          float a = sin(m.y * 40.0 + n * 7.0 + sin(m.x * 6.0) * 1.7);
          float b = pNoise(m * vec2(16.0, 34.0)) * 2.0 - 1.0;
          return a * 0.55 + b * 0.45;
        }
        float hairStrands(vec2 m) {
          return sin(m.x * 520.0 + pNoise(m * vec2(40.0, 9.0)) * 9.0) * 0.4 + (pNoise(m * vec2(70.0, 12.0)) * 2.0 - 1.0) * 0.6;
        }
        vec3 pBump(vec3 surfPos, vec3 n, float h) {
          vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
          vec3 r1 = cross(sy, n), r2 = cross(n, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
          return normalize(abs(det) * n - grad);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pLayer = floor(vPat.z);
        float pFold = floor(vPat.w);
        float pH = 0.0;
        float pFade = 1.0 - smoothstep(0.012, 0.05, length(fwidth(vPat.xy)));
        if (vPat.z > 19.5) {
          pH = hairStrands(vPat.xy) * 0.0018 * pFade;
          diffuseColor.rgb *= 0.86 + 0.28 * pNoise(vPat.xy * vec2(160.0, 14.0));
        } else if (vPat.z > -0.5) {
          float pScale = max(0.01, fract(vPat.z));
          vec4 tp = texture(uPat, vec3(vPat.xy / pScale, pLayer));
          diffuseColor.rgb = mix(diffuseColor.rgb, vCol2, tp.r) * (tp.g * 1.05);
        }
        if (pFold > 0.5 && vPat.z < 19.5) {
          float fh = clothFolds(vPat.xy);
          pH = fh * 0.0022 * pFold * pFade;
          diffuseColor.rgb *= 1.0 - 0.055 * pFold * pFade * (0.5 - 0.5 * fh);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fract(vPat.w);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (pH != 0.0) normal = pBump(-vViewPosition, normal, pH);`);
  };
  mat.customProgramCacheKey = () => 'people-fabric-v2';
  return mat;
}
