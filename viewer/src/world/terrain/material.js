// Ground shader: MeshStandardMaterial extended (onBeforeCompile) with a world-space surface
// model. Inputs are the baked macro maps (classes, grime, stains, paint, tar, patches) and tiled
// detail textures; flags, panel joints, gum and litter are procedural so they stay sharp up close.
import * as THREE from 'three';

const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uM1;
uniform sampler2D uM2;
uniform vec4 uTile;
uniform sampler2D uNoiseT;
uniform sampler2D uAsphA;
uniform sampler2D uAsphN;
uniform sampler2D uConcA;
uniform sampler2D uConcN;
uniform sampler2D uStoneA;
uniform sampler2D uStoneN;
uniform sampler2D uCrackT;
uniform vec2 uGrid;
uniform vec2 uFore;
uniform vec2 uForeO;
uniform vec3 uScales;
uniform float uStoneS;
uniform vec3 uIblTint;
varying vec3 vWPos;
varying vec3 vWNrm;
vec3 sAlb; float sRough; vec2 sGrad;

float th12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 th22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float jointMask(vec2 f, vec2 fw, float jw) {
  vec2 d = min(f, 1.0 - f);
  vec2 j = 1.0 - smoothstep(vec2(jw) - fw, vec2(jw) + fw, d);
  return max(j.x, j.y);
}

void groundSurface() {
  vec2 wp = vWPos.xz;
  vec2 dpx = dFdx(wp), dpy = dFdy(wp);
  float pix = max(length(dpx), length(dpy));
  vec2 muv = (wp - uTile.xy) * uTile.zw;
  vec4 m1 = texture(uM1, muv);
#ifdef GROUND_FAR
  vec4 m2 = vec4(0.5, 0.0, 0.0, 0.0);
#else
  vec4 m2 = texture(uM2, muv);
#endif
  float wPav = m1.r, wCon = m1.g;
  float wAsp = clamp(1.0 - wPav - wCon, 0.0, 1.0);
  float sumW = max(1e-4, wPav + wCon + wAsp);
  wPav /= sumW; wCon /= sumW; wAsp /= sumW;
  vec4 nA = textureGrad(uNoiseT, wp * (1.0 / 53.0), dpx / 53.0, dpy / 53.0);
  vec4 nB = textureGrad(uNoiseT, wp * (1.0 / 9.7) + vec2(0.31, 0.67), dpx / 9.7, dpy / 9.7);
  vec4 nC = textureGrad(uNoiseT, wp * (1.0 / 2.3) + vec2(0.13, 0.41), dpx / 2.3, dpy / 2.3);
  vec4 nD = textureGrad(uNoiseT, wp * (1.0 / 0.61) + vec2(0.57, 0.23), dpx / 0.61, dpy / 0.61);
  vec4 ck = textureGrad(uCrackT, wp * uScales.z, dpx * uScales.z, dpy * uScales.z);
  vec2 gperp = vec2(-uGrid.y, uGrid.x);

  vec3 alb = vec3(0.0); float rough = 0.0; vec2 grad = vec2(0.0); float aggH = 0.5;

  // ------------------------------------------------------------- asphalt
  if (wAsp > 0.001) {
    float fine = smoothstep(0.25, 0.6, m1.b);
    float s1 = uScales.x * mix(1.0, 1.9, fine);
    vec2 u1 = wp * s1;
    const mat2 R2 = mat2(0.8253, 0.5646, -0.5646, 0.8253);
    float s2 = uScales.x * 1.63;
    vec2 u2 = (R2 * wp) * s2 + vec2(0.37, 0.11);
    vec4 a1 = textureGrad(uAsphA, u1, dpx * s1, dpy * s1);
    vec4 a2 = textureGrad(uAsphA, u2, (R2 * dpx) * s2, (R2 * dpy) * s2);
    vec4 g1 = textureGrad(uAsphN, u1, dpx * s1, dpy * s1);
    vec4 g2 = textureGrad(uAsphN, u2, (R2 * dpx) * s2, (R2 * dpy) * s2);
    float b = smoothstep(0.32, 0.68, nB.r);
    vec3 c = mix(a1.rgb, a2.rgb, b) * vec3(1.07, 1.0, 0.9);
    vec2 gra = mix((g1.rg - 0.5) * 4.0, transpose(R2) * ((g2.rg - 0.5) * 4.0), b);
    float h = mix(a1.a, a2.a, b);
    float cav = mix(g1.b, g2.b, b);
    // oxidation / weathering mottling at several scales
    float ox = clamp(nA.g * 1.3 - 0.15 + (nB.g - 0.5) * 0.9 + (nC.g - 0.5) * 0.35, 0.0, 1.0);
    c *= mix(vec3(0.66, 0.65, 0.65), vec3(1.06, 1.0, 0.92), ox);
    float rich = smoothstep(0.58, 0.8, nB.a * 0.7 + nC.a * 0.45);   // binder-rich dark blotches
    c *= 1.0 - 0.28 * rich;
    c *= 0.88 + 0.24 * nD.g;
    c *= 0.85 + 0.3 * cav;
    c = mix(c, c * vec3(1.2, 1.18, 1.13) + 0.012, fine * 0.7);
    // fresh reinstatement: darker binder-rich surface with coated aggregate
    float pt = m2.a;
    vec3 fresh = mix(vec3(dot(c, vec3(0.3333))), c, 0.45) * 0.4 + 0.004;
    c = mix(c, fresh, pt * (0.8 + 0.2 * nC.r));
    gra *= 1.0 - 0.6 * pt;
    // hairline cracks and tar-sealed cracks in some zones only
    float zone = smoothstep(0.55, 0.75, nA.a + (nB.a - 0.5) * 0.5) * (1.0 - pt);
    c *= 1.0 - 0.65 * ck.r * zone;
    float sealed = smoothstep(0.35, 0.9, ck.g) * smoothstep(0.58, 0.78, nA.b + (nB.b - 0.5) * 0.35) * (1.0 - pt);
    sealed *= 0.55 + 0.45 * nC.r;
    float r = 0.93 - 0.05 * fine - 0.13 * pt;
    c = mix(c, vec3(0.035, 0.032, 0.03), sealed * 0.75);
    r = mix(r, 0.62, sealed);
    c *= vec3(1.42, 1.36, 1.25); // r04: older, greyer asphalt; shaded streets read near-black and teal (visual reviews a, b)
    alb += wAsp * c; rough += wAsp * r; grad += wAsp * gra * 0.5; aggH = mix(aggH, h, wAsp);
  }

  // ------------------------------------------------------------- paving slabs (plaza / forecourt)
  if (wPav > 0.001) {
    float fore = step(0.5, m1.b);
    vec2 dir = normalize(mix(uGrid, uFore, fore));
    vec2 dpp = vec2(-dir.y, dir.x);
    float size = mix(0.60, 0.45, fore);
    vec2 q = wp - fore * uForeO;
    vec2 pu = vec2(dot(q, dir), dot(q, dpp)) / size;
    vec2 dux = vec2(dot(dpx, dir), dot(dpx, dpp)) / size;
    vec2 duy = vec2(dot(dpy, dir), dot(dpy, dpp)) / size;
    vec2 fw = abs(dux) + abs(duy);
    pu.x += (th12(vec2(floor(pu.y), 3.0 + fore)) - 0.5) * 0.06;   // hand-laid rows do not align exactly
    vec2 cell = floor(pu); vec2 f = pu - cell;
    float h = th12(cell + fore * 57.0);
    vec2 hh = th22(cell + 7.0 + fore * 13.0);
    float jw = (0.0025 + 0.0035 * th12(cell + 0.5)) / size;
    float joint = jointMask(f, fw * 0.75, jw);
    float fade = 1.0 - smoothstep(0.1, 0.4, max(fw.x, fw.y));
    float vfade = 1.0 - smoothstep(0.25, 0.9, max(fw.x, fw.y));   // per-slab variation fades with distance (no sparkle)
    vec2 d = min(f, 1.0 - f);
    float arris = 1.0 - smoothstep(0.0, 0.015 / size + max(fw.x, fw.y), min(d.x, d.y));
    vec2 m10 = mod(cell, 10.0);
    float band = (1.0 - fore) * ((m10.x < 1.0 || m10.y < 1.0) ? 1.0 : 0.0);
    vec3 tint = mix(vec3(1.0, 0.97, 0.92), vec3(1.12, 1.06, 0.96), fore);
    tint = mix(tint, vec3(1.32, 1.25, 1.1), band);                 // lighter band slabs
    tint *= mix(0.97, 0.88 + 0.2 * h, vfade);
    tint *= mix(1.0, 0.8, step(0.88, th12(cell + 77.0)) * th12(cell + 78.0) * vfade);   // stained slabs
    tint *= 1.0 - 0.18 * step(0.975, h) * vfade;                   // odd replacement slab
    vec2 su = pu * size * uStoneS + hh * 3.0;
    vec2 sux = dux * size * uStoneS, suy = duy * size * uStoneS;
    vec4 sa = textureGrad(uStoneA, su, sux, suy);
    vec4 sn = textureGrad(uStoneN, su, sux, suy);
    vec3 c = sa.rgb * tint;
    c *= mix(0.86, 1.08, nB.r) * mix(0.93, 1.05, nC.b);
    c *= mix(1.0, mix(0.76, 1.03, nD.r), vfade);                  // blotchy dirt at slab scale
    c *= 1.0 - 0.22 * arris * fade * (0.5 + nD.a);
    float cracked = step(0.94, hh.y);
    c *= 1.0 - 0.65 * cracked * ck.r;
    vec2 gp = (sn.rg - 0.5) * 4.0 * 0.4;
    gp = gp.x * dir + gp.y * dpp;
    gp += (th22(cell + 3.1) - 0.5) * 0.024 * fade;
    float jdark = mix(0.22, 0.6, th12(cell + 11.0));
    vec3 jc = c * jdark + vec3(0.008, 0.007, 0.006);
    c = mix(c, jc, joint * fade);
    c *= 1.0 - (1.0 - fade) * 0.04;
    float r = mix(0.8, 0.78, fore) - 0.06 * (1.0 - band);
    alb += wPav * c; rough += wPav * mix(r, 0.96, joint * fade); grad += wPav * gp; aggH = mix(aggH, sa.a, wPav);
  }

  // ------------------------------------------------------------- cast concrete ground
  if (wCon > 0.001) {
    float size = 2.4;
    vec2 pu = vec2(dot(wp, uGrid), dot(wp, gperp)) / size + vec2(0.37, 0.61);
    vec2 dux = vec2(dot(dpx, uGrid), dot(dpx, gperp)) / size;
    vec2 duy = vec2(dot(dpy, uGrid), dot(dpy, gperp)) / size;
    vec2 fw = abs(dux) + abs(duy);
    vec2 cell = floor(pu); vec2 f = pu - cell;
    float h = th12(cell + 101.0);
    float near = 1.0 - smoothstep(0.25, 0.9, max(fw.x, fw.y));
    float joint = jointMask(f, fw * 0.75, (0.004 + 0.006 * th12(cell + 4.0)) / size);
    float fade = 1.0 - smoothstep(0.1, 0.4, max(fw.x, fw.y));
    vec3 base = vec3(0.235, 0.218, 0.188) * mix(0.96, 0.8 + 0.32 * h, near);
    float sc = uScales.y;
    // broom finish: grain stretched across each panel
    vec2 cu = vec2(pu.x * size * sc * 0.22, pu.y * size * sc) + th22(cell) * 4.0;
    vec2 cux = vec2(dux.x * size * sc * 0.22, dux.y * size * sc), cuy = vec2(duy.x * size * sc * 0.22, duy.y * size * sc);
    vec4 ca = textureGrad(uConcA, cu, cux, cuy);
    vec4 cn = textureGrad(uConcN, cu, cux, cuy);
    vec4 cb = textureGrad(uConcA, wp * sc * 0.83, dpx * sc * 0.83, dpy * sc * 0.83);
    vec3 c = base * mix(ca.rgb, cb.rgb, 0.4) / 0.3;
    c *= mix(0.6, 1.08, nB.g) * mix(0.78, 1.06, nC.a) * mix(0.8, 1.1, nD.b);
    // stained panels and rectangular mortar repairs inside some panels
    c *= 1.0 - 0.3 * step(0.8, th12(cell + 55.0)) * near;
    vec2 rp = th22(cell + 61.0);
    vec2 rlo = rp * 0.55 + 0.05, rhi = rlo + 0.2 + 0.3 * th22(cell + 62.0);
    float rep = step(0.84, th12(cell + 63.0)) * step(rlo.x, f.x) * step(f.x, rhi.x) * step(rlo.y, f.y) * step(f.y, rhi.y);
    c = mix(c, c * mix(0.7, 1.18, th12(cell + 64.0)), rep * near);
    // dirt collects along joints and edges
    vec2 d = min(f, 1.0 - f);
    float edgeDirt = 1.0 - smoothstep(0.0, 0.05 + 0.05 * nD.a, min(d.x, d.y));
    c *= 1.0 - 0.22 * edgeDirt * near;
    float zone = smoothstep(0.4, 0.62, nA.r + (nB.r - 0.5) * 0.4);
    c *= 1.0 - 0.65 * ck.r * zone;
    c = mix(c, c * mix(0.2, 0.55, th12(cell + 8.0)), joint * fade);
    c *= 1.0 - (1.0 - fade) * 0.05;
    vec2 gp = (cn.rg - 0.5) * 4.0 * 0.32;
    gp = gp.x * uGrid + gp.y * gperp;
    gp += (th22(cell + 9.0) - 0.5) * 0.02 * near;
    alb += wCon * c; rough += wCon * mix(0.9, 0.97, joint * fade); grad += wCon * gp; aggH = mix(aggH, ca.a, wCon);
  }

  // ------------------------------------------------------------- overlays
  float v = (m2.r - 0.5) * 2.0;
  float vm = mix(0.35, 1.65, clamp(nC.r * 0.55 + nD.r * 0.45, 0.0, 1.0));
  if (v < 0.0) alb = mix(alb, alb * vec3(0.36, 0.33, 0.29), clamp(-v * vm * 2.2, 0.0, 1.0));
  else alb = mix(alb, vec3(0.40, 0.36, 0.30) * mix(0.9, 1.1, nB.b), clamp(v * vm * 1.0, 0.0, 0.85));
  float tr = clamp(m2.b * mix(0.75, 1.2, nC.g), 0.0, 1.0);
  alb = mix(alb, vec3(0.024, 0.023, 0.021), tr * 0.9);
  rough = mix(rough, 0.52, tr);
  float pv = m2.g * smoothstep(0.22, 0.5, nC.b * 0.55 + aggH * 0.45 + (nB.a - 0.5) * 0.3 + 0.12);
  alb = mix(alb, vec3(0.56, 0.55, 0.5), pv);
  rough = mix(rough, 0.7, pv);
  grad *= 1.0 - 0.6 * pv;
  float gm = m1.a;
  alb *= mix(vec3(0.42, 0.39, 0.35), vec3(1.0), gm);

  // chewing gum (flattened dark discs), denser on paving and along worn lines
  if (pix < 0.03) {
    float cs = 0.33;
    vec2 g = wp / cs; vec2 gc = floor(g); vec2 gf = g - gc;
    float dens = 0.012 + 0.05 * wPav + 0.08 * wPav * clamp(v * 6.0, 0.0, 1.0);
    if (th12(gc + 17.0) < dens) {
      vec2 c0 = 0.2 + 0.6 * th22(gc + 5.0);
      float rr = (0.006 + 0.009 * th12(gc + 9.0)) / cs;
      float pw = pix / cs;
      float m = 1.0 - smoothstep(rr - pw, rr + pw, length((gf - c0) * vec2(1.0, 0.8 + 0.4 * th12(gc + 2.0))));
      m *= 1.0 - smoothstep(0.012, 0.03, pix);
      alb = mix(alb, alb * 0.3 + vec3(0.006), m * 0.9);
    }
  }
  // cigarette ends and paper scraps
  if (pix < 0.035) {
    float cs = 0.9;
    vec2 g = wp / cs; vec2 gc = floor(g); vec2 gf = g - gc;
    float dens = 0.012 + 0.035 * (1.0 - gm) + 0.015 * wPav;
    if (th12(gc + 41.0) < dens) {
      vec2 c0 = 0.15 + 0.7 * th22(gc + 23.0);
      float a = th12(gc + 29.0) * 6.2832;
      vec2 l = gf - c0; l = mat2(cos(a), -sin(a), sin(a), cos(a)) * l * cs;
      float paper = step(0.82, th12(gc + 31.0));
      vec2 hs = mix(vec2(0.013, 0.0042), vec2(0.045, 0.03) * (0.7 + 0.6 * th12(gc + 37.0)), paper);
      vec2 qq = abs(l) - hs;
      float sd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0);
      float m = 1.0 - smoothstep(-pix * 0.7, pix * 0.7, sd);
      m *= 1.0 - smoothstep(0.014, 0.035, pix);
      vec3 col = paper > 0.5 ? vec3(0.6, 0.585, 0.54) * (0.8 + 0.3 * th12(gc + 3.0)) : (l.x > hs.x * 0.3 ? vec3(0.5, 0.33, 0.16) : vec3(0.66, 0.64, 0.58));
      alb = mix(alb, col, m); rough = mix(rough, 0.9, m); grad *= 1.0 - m;
    }
  }

  sAlb = clamp(alb, 0.0, 1.0);
  sRough = clamp(rough, 0.35, 1.0);
  sGrad = grad;
}
`;

export function makeGroundMaterial({ tile, t1, t2, shared, far = false, gridDir, foreDir, foreOrigin }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
  const uniforms = {
    uM1: { value: t1 },
    uM2: { value: t2 || t1 },
    uTile: { value: new THREE.Vector4(tile.x0, tile.z0, 1 / (tile.x1 - tile.x0), 1 / (tile.z1 - tile.z0)) },
    uNoiseT: { value: shared.noise },
    uAsphA: { value: shared.asph.albedo },
    uAsphN: { value: shared.asph.normal },
    uConcA: { value: shared.conc.albedo },
    uConcN: { value: shared.conc.normal },
    uStoneA: { value: shared.stone.albedo },
    uStoneN: { value: shared.stone.normal },
    uCrackT: { value: shared.crack.tex },
    uGrid: { value: new THREE.Vector2(gridDir[0], gridDir[1]) },
    uFore: { value: new THREE.Vector2(foreDir[0], foreDir[1]) },
    uForeO: { value: new THREE.Vector2(foreOrigin[0], foreOrigin[1]) },
    uScales: { value: new THREE.Vector3(1 / shared.asph.tileM, 1 / shared.conc.tileM, 1 / shared.crack.tileM) },
    uStoneS: { value: 1 / shared.stone.tileM },
    // Warm bounce from sunlit facades is not simulated; tint the sky irradiance on the ground
    // (visual approximation, documented in the round notes).
    uIblTint: { value: new THREE.Vector3(1.26, 1.04, 0.8) },
  };
  if (far) mat.defines = { GROUND_FAR: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SURFACE_GLSL)
      .replace('#include <map_fragment>', 'groundSurface();\ndiffuseColor.rgb = sAlb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <lights_fragment_end>', 'iblIrradiance *= uIblTint;\nradiance *= mix(vec3(1.0), uIblTint, 0.6);\n#include <lights_fragment_end>')
      .replace('#include <normal_fragment_maps>', '{ vec3 nw = normalize(vWNrm); vec3 pn = normalize(nw + vec3(-sGrad.x, 0.0, -sGrad.y)); normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz); }');
  };
  mat.customProgramCacheKey = () => (far ? 'kabukicho-ground-far-v1' : 'kabukicho-ground-near-v1');
  mat.userData.groundUniforms = uniforms;
  return mat;
}
