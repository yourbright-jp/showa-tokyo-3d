import * as THREE from 'three';

// r05 optional material layer for the buildings module (URL parameter mat=1).
// Per-pixel ageing on top of the r04 wall shader: multi-scale mottling (soot, dirt, faded patches),
// per-tile colour/tilt variation with dirty grout for mosaic and scratch tile, patched and cracked
// mortar render, efflorescence (白華) on exposed concrete, fine rain streaks (雨だれ), rust on painted
// steel, and roughness variation. Noise is world-space value noise on the integer PCG hash, so GPU
// and SwiftShader agree. These programs are only compiled when mat=1 (materials.js checks U.mat);
// without the parameter the r04 programs and images are unchanged.

// same integer hash as materials.js (PCG) -> [0, 1)
const UHASH = `
float uhash(int n){
  uint v = uint(n & 0x7fffffff) * 747796405u + 2891336453u;
  uint w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  w = (w >> 22u) ^ w;
  return float(w >> 8u) / 16777216.0;
}
`;

const MAT_PARS = `
uniform vec4 uMatTile; uniform vec4 uMatA; uniform vec4 uMatB; uniform vec4 uMatC; uniform sampler2D uAgeMap;
varying vec3 vMatPos; varying vec3 vMatN;
int mh3(ivec3 i) { return (i.x * 73856093) ^ (i.y * 19349663) ^ (i.z * 83492791); }
float vn3(vec3 p) {
  vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl; f = f * f * (3.0 - 2.0 * f);
  float a = uhash(mh3(i)), b = uhash(mh3(i + ivec3(1, 0, 0))), c = uhash(mh3(i + ivec3(0, 1, 0))), d = uhash(mh3(i + ivec3(1, 1, 0)));
  float e = uhash(mh3(i + ivec3(0, 0, 1))), g = uhash(mh3(i + ivec3(1, 0, 1))), h = uhash(mh3(i + ivec3(0, 1, 1))), k = uhash(mh3(i + ivec3(1, 1, 1)));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
// streak field on facade coords q = (u, y) metres: columns colW wide, each column cut into cells
// with at most one streak per cell (starting near the cell top, fading downwards). Returns 0..1.
float mStreak(vec2 q, int seed, float colW, float dens) {
  float cx = floor(q.x / colW); float fx = q.x / colW - cx;
  int ci = int(cx) * 92821 + seed;
  float cellH = 1.6 + 2.4 * uhash(ci);
  float yo = uhash(ci ^ 0x2c1b3c6d) * cellH;
  float cy = floor((q.y + yo) / cellH); float fy = (q.y + yo) / cellH - cy;
  int si = ci ^ (int(cy) * 668265263);
  float on = step(uhash(si), dens);
  float top = 0.7 + 0.3 * uhash(si + 1);
  float len = 0.12 + 0.88 * pow(uhash(si + 2), 1.4);
  float t = (top - fy) / (len * top);
  float along = smoothstep(0.0, 0.06, t) * pow(clamp(1.0 - t, 0.0, 1.0), 1.4);
  float c0 = 0.5 + (uhash(si + 3) - 0.5) * 0.5 + 0.05 * sin(q.y * 4.0 + float(si & 255));
  float hw = 0.08 + 0.3 * uhash(si + 4);
  float fwx = fwidth(q.x) / colW;
  float across = 1.0 - smoothstep(hw * 0.4, hw + fwx, abs(fx - c0));
  return on * along * across * (0.45 + 0.55 * uhash(si + 5));
}
`;

const MAT_FRAG = `
  vec3 matN = normalize(vMatN);
  float matVert = 1.0 - smoothstep(0.5, 0.8, abs(matN.y));
  int matSeed = int(floor(dot(vMatPos.xz, matN.xz) * 2.0 + 0.5)) * 7 + int(floor(atan(matN.z, matN.x) * 30.0 + 200.0)) * 1013;
  vec3 matP = vMatPos;
  float m1 = vn3(matP * vec3(0.42, 0.22, 0.42));
  float m2 = vn3(matP * vec3(1.6, 0.7, 1.6) + 11.0);
  float m3 = vn3(matP * 5.5 + 23.0);
  float matRough = roughness;
  vec3 matTilt = vec3(0.0);
  float matFace = 1.0;
  vec3 matPre = diffuseColor.rgb;
  // where the r04 atlas already stains the wall (below openings, sills, bands, copings, ground soot)
  float matAtl = smoothstep(0.1, 0.32, 1.0 - dot(matGr, vec3(0.3333)));
  {
    // mottling: large soot/dirt clouds, medium blotches, fine unevenness
    float mot = ((m1 - 0.5) * 1.1 + (m2 - 0.5) * 0.8 + (m3 - 0.5) * 0.45) * 2.2;
    float dk = clamp(-mot, 0.0, 1.0);
    diffuseColor.rgb *= (1.0 + uMatA.x * mot) * mix(vec3(1.0), vec3(0.9, 0.87, 0.82), clamp(dk * uMatA.x * 3.0, 0.0, 1.0));
    // soot stains: patchy darker areas with a defined (not gaussian) edge
    float stain = smoothstep(0.5, 0.7, m1 * 0.55 + m2 * 0.3 + m3 * 0.15);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.7, 0.67, 0.62), clamp(stain * uMatA.x * 3.0, 0.0, 1.0));
  }
  #ifdef USE_MAP
  matFace = wTex.a;
  if (uMatTile.w > 0.0) {
    // per-tile colour, occasional replaced/stained tiles, slight tilt; grout dirtier than the tiles
    vec2 tc = vMapUv * uMatTile.xy;
    float iy = floor(tc.y);
    float ix = floor(tc.x - uMatTile.z * mod(iy, 2.0));
    int ts = int(ix) * 7919 + int(iy) * 104729 + matSeed;
    float h1 = uhash(ts), h2 = uhash(ts ^ 0x5bd1e99), h3 = uhash(ts ^ 0x2a2a2a2);
    float fwT = max(fwidth(tc.x), fwidth(tc.y));
    float fade = 1.0 - smoothstep(0.5, 1.6, fwT);
    vec3 tv = vec3(1.0 + (h1 - 0.5) * 2.0 * uMatTile.w);
    tv *= vec3(1.0 + (h2 - 0.5) * uMatTile.w * 0.7, 1.0, 1.0 - (h2 - 0.5) * uMatTile.w * 0.7);
    if (h3 < 0.022) tv *= vec3(0.84, 0.82, 0.79);
    else if (h3 > 0.986) tv *= vec3(1.08, 1.07, 1.04);
    diffuseColor.rgb *= mix(vec3(1.0), tv, wTex.a * fade);
    matTilt = (vec3(uhash(ts + 1), uhash(ts + 2), 0.5) - 0.5) * uMatC.y * wTex.a * fade;
    float gd = (1.0 - wTex.a) * (0.5 + 0.5 * smoothstep(0.75, 0.25, m2));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.69, 0.64), clamp(gd * uMatC.x, 0.0, 1.0));
  }
  #endif
  if (uMatA.y > 0.0) {
    // patched render: ragged repair areas in a fresher or darker mix, dirt line along the patch edge
    float pn = vn3(matP * vec3(0.8, 1.1, 0.8) + 41.0) + 0.1 * (m3 - 0.5);
    float pfw = fwidth(pn);
    float pa = smoothstep(0.71 - pfw, 0.71 + pfw, pn);
    float pe = 1.0 - smoothstep(0.0, 0.006 + 1.5 * pfw, abs(pn - 0.71));
    vec3 pc = vn3(matP * 0.3 + 3.0) > 0.5 ? vec3(1.08, 1.07, 1.05) : vec3(0.88, 0.87, 0.85);
    diffuseColor.rgb *= mix(vec3(1.0), pc, pa * uMatA.y) * (1.0 - 0.18 * pe * uMatA.y);
    matRough -= 0.06 * pa * uMatA.y;
  }
  if (uMatA.z > 0.0) {
    // hairline cracks (jagged by domain warp), only in some areas, faded out where sub-pixel
    vec3 cq = matP * vec3(1.1, 0.75, 1.1) + 0.2 * vec3(m3, m2, m3);
    float cn = vn3(cq + 71.0);
    float cw = fwidth(cn);
    float line = 1.0 - smoothstep(0.003, 0.003 + cw * 1.2, abs(cn - 0.5));
    float vis = smoothstep(0.5, 0.68, vn3(matP * 0.35 + 91.0)) * (1.0 - smoothstep(0.015, 0.045, cw));
    diffuseColor.rgb *= 1.0 - uMatA.z * 0.6 * line * vis;
  }
  if (uMatB.y > 0.0) {
    // fine rain streaks: short, sparse, and only inside the atlas stains below openings, sills,
    // bands and copings (no continuous streaking over whole walls)
    float sd = mStreak(vWallUv * vec2(1.0, 1.8), matSeed, 0.085, 0.2 + 0.25 * m1);
    float sd2 = mStreak(vWallUv * vec2(1.0, 1.4) + vec2(0.37, 0.0), matSeed ^ 0x3b9, 0.23, 0.15 + 0.2 * m2);
    float s = clamp(0.7 * sd + 0.5 * sd2, 0.0, 1.0) * matVert * matAtl * uMatB.y;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.55, 0.53, 0.49), s);
    matRough += 0.06 * s;
  }
  if (uMatA.w > 0.0) {
    // efflorescence: whitish lime run-off streaks and blooms
    float ef = mStreak(vWallUv * vec2(1.0, 1.6) + vec2(0.05, 0.9), matSeed ^ 0x77, 0.17, 0.1) * matVert * (0.3 + 0.7 * matAtl);
    float bloom = smoothstep(0.68, 0.88, m2) * smoothstep(0.45, 0.75, m3) * 0.3;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.61, 0.57), clamp(uMatA.w * (ef + bloom), 0.0, 0.55));
  }
  if (uMatB.x > 0.0) {
    // rust on painted steel: spots where the paint failed, and rust run-off below them
    float rn = vn3(matP * 7.0 + 5.0) * 0.6 + m2 * 0.4;
    float rr = smoothstep(0.56, 0.72, rn) * uMatB.x;
    vec3 rustC = mix(vec3(0.16, 0.06, 0.025), vec3(0.3, 0.13, 0.05), m3);
    diffuseColor.rgb = mix(diffuseColor.rgb, rustC, rr);
    float rs = mStreak(vWallUv, matSeed ^ 0x1234, 0.05, 0.3) * matVert;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.7, 0.52, 0.38), rs * uMatB.x);
    matRough += 0.3 * rr;
  }
  matRough = mix(uMatB.w, uMatB.z, matFace) + (m2 - 0.5) * uMatC.z + (m3 - 0.5) * uMatC.z * 0.6 + (matRough - roughness);
  // building age class (buildings.js age map): new and mid buildings get only part of the ageing
  diffuseColor.rgb = mix(matPre, diffuseColor.rgb, matAge);
`;

// per material kind: tile = [cols, rows, bond, per-tile variation] (cols/rows per texture repeat,
// matching textures.js), A = [mottle, render patches, cracks, efflorescence],
// B = [rust, fine streaks, tile-face roughness, grout/base roughness], C = [grout dirt, tile tilt, roughness noise, -]
const MAT_KIND = {
  mosaic: { tile: [16, 16, 0, 0.14], A: [0.28, 0, 0, 0], B: [0, 0.9, 0.32, 0.92], C: [0.9, 0.14, 0.1, 0.5] },
  smalltile: { tile: [8, 8, 0, 0.12], A: [0.28, 0, 0, 0], B: [0, 0.9, 0.38, 0.92], C: [0.85, 0.12, 0.1, 0.5] },
  brick: { tile: [4, 12, 0.5, 0.2], A: [0.28, 0, 0, 0.05], B: [0, 0.95, 0.8, 0.95], C: [0.65, 0.06, 0.12, 0.5] },
  stone: { tile: [2, 4, 0.5, 0.12], A: [0.26, 0, 0.35, 0.05], B: [0, 0.9, 0.55, 0.8], C: [0.5, 0.03, 0.1, 0.5] },
  render: { tile: [0, 0, 0, 0], A: [0.32, 0.7, 0.8, 0.05], B: [0, 1.0, 0.93, 0.93], C: [0, 0, 0.1, 0.6] },
  concrete: { tile: [0, 0, 0, 0], A: [0.32, 0.3, 0.6, 0.22], B: [0, 1.0, 0.9, 0.9], C: [0, 0, 0.1, 0.65] },
  panel: { tile: [0, 0, 0, 0], A: [0.2, 0, 0, 0], B: [0, 0.8, 0.65, 0.7], C: [0, 0, 0.12, 0.4] },
  shutter: { tile: [0, 0, 0, 0], A: [0.12, 0, 0, 0], B: [0.3, 0.6, 0.55, 0.55], C: [0, 0, 0.12, 0.2] },
  roof: { tile: [0, 0, 0, 0], A: [0.2, 0.3, 0.3, 0.05], B: [0, 0, 0.95, 0.95], C: [0, 0, 0.05, 0] },
  paint: { tile: [0, 0, 0, 0], A: [0.12, 0, 0, 0], B: [0.32, 0.5, 0.6, 0.6], C: [0, 0, 0.12, 0.15] },
  sash: { tile: [0, 0, 0, 0], A: [0.08, 0, 0, 0], B: [0.15, 0.3, 0.45, 0.45], C: [0, 0, 0.1, 0] },
};

const VERT_COMMON = '\nvarying vec3 vMatPos;\nvarying vec3 vMatN;';
const VERT_POS = '#include <project_vertex>\nvMatPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMatN = normalize(mat3(modelMatrix) * objectNormal);';

/** mat=1 variant of materials.js patchWall: the r04 wall shading plus the MAT_FRAG ageing layer. */
export function patchWallMat(mat, U, key, { tintMask = true, streak = 0.22, WALL_PARS }) {
  const k = MAT_KIND[key] || MAT_KIND.paint;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrime = U.grime;
    shader.uniforms.uStreak = U.streak;
    shader.uniforms.uStreakAmt = { value: streak };
    shader.uniforms.uGrimeAmt = U.grimeAmt;
    shader.uniforms.uBounce = U.bounce;
    shader.uniforms.uMatTile = { value: new THREE.Vector4(...k.tile) };
    shader.uniforms.uMatA = { value: new THREE.Vector4(...k.A) };
    shader.uniforms.uMatB = { value: new THREE.Vector4(...k.B) };
    shader.uniforms.uMatC = { value: new THREE.Vector4(...k.C) };
    shader.uniforms.uAgeMap = U.ageMap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aGrime;\nvarying vec2 vGrime;\nvarying vec2 vWallUv;' + VERT_COMMON)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrime = aGrime;\nvWallUv = uv;')
      .replace('#include <project_vertex>', VERT_POS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WALL_PARS + UHASH + MAT_PARS)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 wTex = texture2D( map, vMapUv );
          diffuseColor.rgb *= wTex.rgb * ${tintMask ? 'mix(vec3(1.0), vColor, wTex.a)' : 'vColor'};
        #else
          diffuseColor.rgb *= vColor;
        #endif
        float matAge = texture2D(uAgeMap, vGrime).r;
        vec3 matGr = texture2D(uGrime, vGrime).rgb;
        {
          // r04 atlas stains scaled by the building age class; the tileable streak texture is
          // weakened (it read as continuous vertical siding over whole walls)
          float sk = texture2D(uStreak, vWallUv * vec2(0.333, 0.111)).r;
          vec3 g2 = mix(vec3(1.0), matGr, clamp(0.75 + 0.5 * (1.0 - sk), 0.0, 1.4) * uGrimeAmt * mix(0.5, 1.0, matAge));
          diffuseColor.rgb *= g2 * (1.0 - uStreakAmt * 0.35 * (1.0 - sk));
        }
      ` + MAT_FRAG)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(matRough, 0.04, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + matTilt);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uBounce;');
  };
  mat.customProgramCacheKey = () => `bldg-wall-${tintMask ? 'tint' : 'plain'}-r05mat`;
  return mat;
}

/** mat=1 variant of materials.js patchMid: world-space mottling and vertical wash-down on the
 *  mid/far painted walls so neighbouring prisms with the same window texture do not read as copies. */
export function patchMidMat(mat, U) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStreak = U.streak;
    shader.uniforms.uNight = U.night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWallUv;' + VERT_COMMON)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWallUv = uv;')
      .replace('#include <project_vertex>', VERT_POS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uStreak; uniform float uNight; varying vec2 vWallUv;\n' + UHASH + MAT_PARS)
      .replace('#include <map_fragment>', `
        vec4 mTex = texture2D( map, vMapUv );
        diffuseColor.rgb *= mTex.rgb * mix(vec3(1.0), vColor, mTex.a);
        float skm = texture2D(uStreak, vMapUv * vec2(0.5, 0.18)).r;
        diffuseColor.rgb *= 1.0 - 0.35 * (1.0 - skm) * mTex.a;
        {
          vec3 Pm = vMatPos;
          float a1 = vn3(Pm * vec3(0.3, 0.12, 0.3) + 7.0), a2 = vn3(Pm * vec3(1.1, 0.5, 1.1) + 13.0);
          float a3 = vn3(Pm * vec3(2.6, 0.12, 2.6) + 57.0);
          float mot = ((a1 - 0.5) * 1.1 + (a2 - 0.5) * 0.7) * 2.0 - smoothstep(0.5, 0.8, a3) * 0.25;
          vec3 mc = (1.0 + 0.07 * mot) * mix(vec3(1.0), vec3(0.95, 0.94, 0.92), clamp(-mot * 0.5, 0.0, 1.0));
          diffuseColor.rgb *= mix(vec3(1.0), mc, mTex.a);
        }
      `)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.12, roughness, mTex.a);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.5) {
          ivec2 ci = ivec2(floor(vMapUv * vec2(4.0, 2.0)));
          float cell = uhash(ci.x * 7919 + ci.y * 104729);
          totalEmissiveRadiance += (1.0 - mTex.a) * step(0.62, cell) * vec3(1.0, 0.85, 0.62) * 0.9;
        }`);
  };
  mat.customProgramCacheKey = () => 'bldg-mid-r05mat';
  return mat;
}
