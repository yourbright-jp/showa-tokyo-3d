import * as THREE from 'three';
import { tileTexture, renderTexture, concreteTexture, panelTexture, streakTexture, shutterTexture, roofTexture, floorTexture, curtainAtlas } from './textures.js';

// Materials for the buildings module. Wall materials are MeshStandardMaterial patched so that
//  - texture alpha is a tint mask (tiles take the building colour, grout keeps its own grey),
//  - a per-facade grime atlas (attribute aGrime) darkens/stains the wall where openings drip,
//  - a tileable vertical streak texture breaks the stains into rain streaks.
// Upper-floor glass uses an interior-mapping shader (a box room behind each window, curtains
// and blinds from an atlas) added as emissive under standard reflective glass.

/** Canvas-painted grime atlas. Regions are shelf-packed; (u,y) facade coords map into them. */
export class GrimeAtlas {
  constructor(width, height) {
    this.W = width; this.H = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width; this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    this.g.fillStyle = '#ffffff'; this.g.fillRect(0, 0, width, height);
    this.x = 4; this.y = 4; this.rowH = 0; this.used = 0; this.failed = 0;
    this.white = [2 / width, 1 - 2 / height];
  }
  /** Allocate a region for a facade spanning u in [0,L], y in [y0,y1] at ppm pixels per metre. */
  alloc(L, y0, y1, ppm) {
    const w = Math.ceil(L * ppm) + 4, h = Math.ceil((y1 - y0) * ppm) + 4;
    if (w > this.W - 8) return null;
    if (this.x + w > this.W - 4) { this.x = 4; this.y += this.rowH + 2; this.rowH = 0; }
    if (this.y + h > this.H - 4) { this.failed++; return null; }
    const R = new GrimeRegion(this, this.x + 2, this.y + 2, L, y0, y1, ppm);
    this.x += w + 2; this.rowH = Math.max(this.rowH, h); this.used += w * h;
    return R;
  }
  texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    return t;
  }
}

export class GrimeRegion {
  constructor(atlas, px, py, L, y0, y1, ppm) { Object.assign(this, { atlas, px, py, L, y0, y1, ppm }); this.g = atlas.g; }
  /** atlas uv for facade coords */
  uv(u, y) {
    const uu = Math.min(this.L, Math.max(0, u)), yy = Math.min(this.y1, Math.max(this.y0, y));
    return [(this.px + uu * this.ppm) / this.atlas.W, 1 - (this.py + (this.y1 - yy) * this.ppm) / this.atlas.H];
  }
  X(u) { return this.px + u * this.ppm; }
  Y(y) { return this.py + (this.y1 - y) * this.ppm; }
  begin() { const g = this.g; g.save(); g.beginPath(); g.rect(this.px, this.py, this.L * this.ppm, (this.y1 - this.y0) * this.ppm); g.clip(); g.globalCompositeOperation = 'multiply'; }
  end() { this.g.restore(); }
  /** vertical streak from (u, y) downwards of length len (m), width wid (m); rgb multiply colour at strength a */
  streak(u, y, len, wid, rgb, a) {
    const g = this.g; const x = this.X(u), y0 = this.Y(y), y1 = this.Y(y - len);
    const w = Math.max(1, wid * this.ppm);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    grad.addColorStop(0.35, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a * 0.7})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad; g.fillRect(x - w / 2, y0, w, y1 - y0);
  }
  /** soft band darkening downward from y over len metres between u0..u1 */
  bandBelow(u0, u1, y, len, rgb, a) {
    const g = this.g; const y0 = this.Y(y), y1 = this.Y(y - len);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad; g.fillRect(this.X(u0), y0, this.X(u1) - this.X(u0), y1 - y0);
  }
  /** soft band darkening upward from y over len metres (ground splash) */
  bandAbove(u0, u1, y, len, rgb, a) {
    const g = this.g; const y0 = this.Y(y), y1 = this.Y(y + len);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad; g.fillRect(this.X(u0), y1, this.X(u1) - this.X(u0), y0 - y1);
  }
  blot(u, y, r, rgb, a) {
    const g = this.g; const x = this.X(u), yy = this.Y(y), rr = Math.max(1, r * this.ppm);
    const grad = g.createRadialGradient(x, yy, 0, x, yy, rr);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad; g.fillRect(x - rr, yy - rr, rr * 2, rr * 2);
  }
  rect(u0, u1, y0, y1, rgb, a) {
    const g = this.g; g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    g.fillRect(this.X(u0), this.Y(y1), (u1 - u0) * this.ppm, (y1 - y0) * this.ppm);
  }
}

const WALL_PARS = `
uniform sampler2D uGrime; uniform sampler2D uStreak; uniform float uStreakAmt; uniform float uGrimeAmt;
varying vec2 vGrime; varying vec2 vWallUv;
`;

function patchWall(mat, U, key, { tintMask = true, streak = 0.22 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrime = U.grime;
    shader.uniforms.uStreak = U.streak;
    shader.uniforms.uStreakAmt = { value: streak };
    shader.uniforms.uGrimeAmt = U.grimeAmt;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aGrime;\nvarying vec2 vGrime;\nvarying vec2 vWallUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrime = aGrime;\nvWallUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WALL_PARS)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 wTex = texture2D( map, vMapUv );
          diffuseColor.rgb *= wTex.rgb * ${tintMask ? 'mix(vec3(1.0), vColor, wTex.a)' : 'vColor'};
        #else
          diffuseColor.rgb *= vColor;
        #endif
        {
          vec3 gr = texture2D(uGrime, vGrime).rgb;
          float sk = texture2D(uStreak, vWallUv * vec2(0.333, 0.111)).r;
          float sk2 = texture2D(uStreak, vWallUv * vec2(0.71, 0.05) + vec2(0.37, 0.11)).r;
          vec3 g2 = mix(vec3(1.0), gr, clamp(0.45 + 0.9 * (1.0 - sk * sk2) , 0.0, 1.4) * uGrimeAmt);
          diffuseColor.rgb *= g2 * (1.0 - uStreakAmt * (1.0 - sk));
        }
      `)
      .replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => `bldg-wall-${key}`;
  return mat;
}

const GLASS_PARS = `
uniform sampler2D uCurtain; uniform float uInterior; uniform float uNight; uniform float uLitShare;
varying vec4 vWin; varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vPane;
float bh(float n){ return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
vec3 interiorColour() {
  vec3 N = normalize(vWNorm);
  vec3 T = normalize(vec3(-N.z, 0.0, N.x));
  vec3 V = normalize(vWPos - cameraPosition);
  float w = vWin.x, h = vWin.y, D = vWin.z, seed = vWin.w;
  vec2 p = vPane;
  float vu = dot(V, T), vy = V.y, vn = max(-dot(V, N), 0.03);
  float r1 = bh(seed), r2 = bh(seed + 1.7), r3 = bh(seed + 3.1), r4 = bh(seed + 5.3), r5 = bh(seed + 9.1), r6 = bh(seed + 11.3);
  float xMin = -0.25 - r1 * 2.0, xMax = w + 0.25 + r2 * 2.0;
  float yMin = -0.85, yMax = h + 0.32;
  float tB = D / vn;
  float tX = abs(vu) < 1e-4 ? 1e5 : (vu > 0.0 ? (xMax - p.x) / vu : (xMin - p.x) / vu);
  float tY = abs(vy) < 1e-4 ? 1e5 : (vy > 0.0 ? (yMax - p.y) / vy : (yMin - p.y) / vy);
  float t = min(tB, min(tX, tY));
  vec3 hit = vec3(p.x + vu * t, p.y + vy * t, vn * t);
  vec3 wallC = r3 < 0.33 ? vec3(0.62, 0.58, 0.50) : (r3 < 0.66 ? vec3(0.55, 0.58, 0.52) : vec3(0.66, 0.64, 0.60));
  bool lit = r4 < uLitShare;
  vec3 c;
  if (t == tB) {
    c = wallC * 0.8;
    // cabinets / shelving silhouettes along the back wall
    float cx = fract(hit.x / (1.1 + r5 * 1.4));
    if (hit.y < -0.85 + 1.0 + r6 * 0.9 && cx < 0.72) c = mix(vec3(0.20, 0.18, 0.16), vec3(0.42, 0.40, 0.36), r5) * (0.8 + 0.2 * step(0.5, fract(hit.y * 2.5)));
    if (hit.y > h - 0.2 && r6 > 0.6) c *= 0.85;
  } else if (t == tX) {
    c = wallC * 0.62;
    if (hit.y < 0.25 && r5 > 0.5) c = vec3(0.24, 0.22, 0.2);
  } else if (vy > 0.0) {
    c = vec3(0.70, 0.70, 0.68);
    float tube = step(abs(fract(hit.z / 1.8 + r1) - 0.5), 0.035) * step(abs(hit.x - w * 0.5), 0.6 + r2);
    c += tube * (lit ? 2.6 : 0.6) * vec3(0.95, 1.0, 0.98);
  } else {
    c = mix(vec3(0.22, 0.18, 0.14), vec3(0.32, 0.30, 0.26), r6);
    // desk / table in the middle of the room
    if (hit.z > 0.9 && hit.z < 1.9 && abs(hit.x - w * (0.3 + 0.4 * r2)) < 0.7) c *= 0.55;
  }
  float fade = exp(-hit.z * 0.18);
  float level = uNight > 0.5 ? (lit ? 1.6 : 0.025) : uInterior * (lit ? 1.25 : 0.85);
  vec3 col = c * fade * level;
  if (uNight > 0.5 && lit) col *= (r5 < 0.5 ? vec3(1.0, 0.86, 0.66) : vec3(0.9, 1.0, 1.05));
  // curtains / blinds on the glass plane
  float k = floor(bh(seed + 7.7) * 8.0);
  vec4 cu = texture2D(uCurtain, vec2((k + clamp(p.x / w, 0.0, 1.0)) / 8.0, clamp(p.y / h, 0.0, 1.0)));
  vec3 cl = cu.rgb * (uNight > 0.5 ? (lit ? 1.4 : 0.03) : uInterior * 2.3);
  col = mix(col, cl, cu.a);
  return col;
}
`;

function patchGlass(mat, U) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCurtain = U.curtain;
    shader.uniforms.uInterior = U.interior;
    shader.uniforms.uNight = U.night;
    shader.uniforms.uLitShare = U.litShare;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nvarying vec4 vWin;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nvarying vec2 vPane;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWin = aWin;\nvPane = uv;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLASS_PARS)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 Vg = normalize(vWPos - cameraPosition);
          float cosT = clamp(-dot(Vg, normalize(vWNorm)), 0.0, 1.0);
          float fr = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
          totalEmissiveRadiance += interiorColour() * (1.0 - fr);
        }`);
  };
  mat.customProgramCacheKey = () => 'bldg-glass-interior';
  return mat;
}

/** Interior surfaces: weak environment light plus a fluorescent "fill" so shops read as lit rooms. */
function patchInterior(mat, U, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFill = U.fill;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFill;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFill;');
  };
  mat.customProgramCacheKey = () => `bldg-interior-${key}`;
  return mat;
}

/** Mid/far LOD walls: window texture whose alpha is a wall mask (wall tinted, glass smooth). */
function patchMid(mat, U, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStreak = U.streak;
    shader.uniforms.uNight = U.night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWallUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWallUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uStreak; uniform float uNight; varying vec2 vWallUv;')
      .replace('#include <map_fragment>', `
        vec4 mTex = texture2D( map, vMapUv );
        diffuseColor.rgb *= mTex.rgb * mix(vec3(1.0), vColor, mTex.a);
        float skm = texture2D(uStreak, vMapUv * vec2(0.5, 0.18)).r;
        diffuseColor.rgb *= 1.0 - 0.35 * (1.0 - skm) * mTex.a;
      `)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.12, roughness, mTex.a);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.5) {
          float cell = fract(sin(dot(floor(vMapUv * vec2(4.0, 2.0)), vec2(12.9898, 78.233))) * 43758.5453);
          totalEmissiveRadiance += (1.0 - mTex.a) * step(0.62, cell) * vec3(1.0, 0.85, 0.62) * 0.9;
        }`);
  };
  mat.customProgramCacheKey = () => `bldg-mid-${key}`;
  return mat;
}

export const CLAD_KINDS = ['mosaic', 'brick', 'smalltile', 'render', 'concrete', 'panel', 'stone'];

export function makeMaterials(ctx, atlas) {
  const rng = ctx.rng('buildings/textures');
  const night = ctx.look && ctx.look.name === 'neon-night';
  const U = {
    grime: { value: atlas.texture() },
    streak: { value: streakTexture(rng) },
    grimeAmt: { value: 1.0 },
    curtain: { value: curtainAtlas(rng) },
    interior: { value: 0.30 },
    night: { value: night ? 1 : 0 },
    litShare: { value: night ? 0.45 : 0.4 },
    fill: { value: night ? 0.55 : 0.32 },
  };
  const tex = {
    mosaic: tileTexture(rng, { w: 512, h: 512, cols: 16, rows: 16, worldW: 0.8, worldH: 0.8, grout: 2.2, vary: 0.12, darkChance: 0.06, dark: 0.82, hue: 0.05, normalStrength: 2.2 }),
    brick: tileTexture(rng, { w: 512, h: 512, cols: 4, rows: 12, worldW: 0.948, worldH: 0.84, grout: 4.5, bond: 0.5, vary: 0.3, darkChance: 0.12, dark: 0.72, hue: 0.12, scratch: true, groutColor: [176, 170, 160], normalStrength: 3.5, bevel: 3 }),
    smalltile: tileTexture(rng, { w: 512, h: 512, cols: 8, rows: 8, worldW: 0.8, worldH: 0.8, grout: 3, vary: 0.07, darkChance: 0.03, dark: 0.88, hue: 0.03, normalStrength: 2.5 }),
    stone: tileTexture(rng, { w: 512, h: 512, cols: 2, rows: 4, worldW: 1.2, worldH: 1.2, grout: 1.5, vary: 0.12, hue: 0.03, normalStrength: 1.5, bond: 0.5 }),
    render: renderTexture(rng),
    concrete: concreteTexture(rng),
    panel: panelTexture(rng),
  };
  const roughOf = { mosaic: 0.55, brick: 0.86, smalltile: 0.5, stone: 0.6, render: 0.93, concrete: 0.92, panel: 0.7 };
  const M = { U, night };
  M.wall = {};
  for (const k of CLAD_KINDS) {
    const t = tex[k];
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: roughOf[k], metalness: 0, vertexColors: true });
    M.wall[k] = patchWall(m, U, k, { tintMask: true, streak: k === 'mosaic' || k === 'smalltile' ? 0.16 : 0.24 });
  }
  // painted metal / trims without texture (sills, copings of metal, pipes, AC bodies, railings)
  M.paint = patchWall(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15, vertexColors: true }), U, 'paint', { tintMask: false, streak: 0.12 });
  // sash frames and storefront members (aluminium or painted steel, colour per vertex)
  M.sash = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.55, vertexColors: true });
  // roller shutters
  const sh = shutterTexture(rng);
  M.shutter = new THREE.MeshStandardMaterial({ map: sh.map, normalMap: sh.normal, normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.55, metalness: 0.35, vertexColors: true });
  // upper-floor glass (interior mapping)
  M.glass = patchGlass(new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.06, metalness: 0.0, envMapIntensity: 0.9 }), U);
  // shopfront glass
  M.shopGlass = new THREE.MeshStandardMaterial({ color: 0x8fa3a8, roughness: 0.05, metalness: 0.0, transparent: true, opacity: night ? 0.1 : 0.2, depthWrite: false, envMapIntensity: 1.4 });
  // interiors (vertex colour) and shop floors
  M.interior = patchInterior(new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, vertexColors: true, envMapIntensity: 0.3 }), U, 'plain');
  M.interiorFloor = patchInterior(new THREE.MeshStandardMaterial({ map: floorTexture(rng), roughness: 0.45, metalness: 0, vertexColors: true, envMapIntensity: 0.3 }), U, 'floor');
  M.tube = new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(2.6, 2.7, 2.6) : new THREE.Color(1.5, 1.56, 1.52) });
  M.warm = new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(2.6, 1.9, 1.1) : new THREE.Color(1.3, 1.05, 0.75) });
  // roofs
  M.roof = new THREE.MeshStandardMaterial({ map: roofTexture(rng), roughness: 0.95, metalness: 0, vertexColors: true });
  return { M, tex, U };
}

export function makeMidMaterials(ctx, U, midTex) {
  const out = {};
  for (const [k, t] of Object.entries(midTex)) {
    out[k] = patchMid(new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0, vertexColors: true, envMapIntensity: 0.9 }), U, k);
  }
  return out;
}
