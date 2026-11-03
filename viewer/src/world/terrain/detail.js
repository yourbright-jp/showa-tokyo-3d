// Tileable detail textures for the ground shader, generated in code (no image files):
//  - noise:    4 independent fbm fields (linear RGBA) for world-scale variation
//  - asphalt:  albedo (sRGB) + height (A) / gradient normal (RG) + cavity (B), ~1.5 mm per texel
//  - concrete: albedo + height / gradient + cavity, ~1.2 mm per texel
//  - cracks:   open hairline cracks (R) and tar-sealed crack bands (G), ~5.5 mm per texel
import * as THREE from 'three';
import { fbmGrid, latticeGrid, normalise, boxBlurWrap, srgb8, makeCanvas } from './util.js';

function dataTex(data, size, srgb, { repeat = true, aniso = 4 } = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export function makeNoiseTexture(ctx, size = 512) {
  const out = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    const r = ctx.rng(`terrain/tex/noise/${c}`);
    const f = normalise(fbmGrid(r, size, 4, 6, 0.52));
    for (let i = 0; i < f.length; i++) out[i * 4 + c] = Math.round(f[i] * 255);
  }
  return dataTex(out, size, false, { aniso: 1 });
}

// Encode height field as gradient (RG) + cavity (B); heightScale = relief (m) per unit height,
// texel = metres per texel. Gradient stored as 0.5 + slope/4.
function encodeNormal(H, size, heightScale, texel) {
  const out = new Uint8Array(size * size * 4);
  const blur = boxBlurWrap(H, size, 3);
  const k = heightScale / (2 * texel);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yo = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const gx = (H[yo + xp] - H[yo + xm]) * k, gy = (H[yp + x] - H[ym + x]) * k;
      const i = (yo + x) * 4;
      out[i] = Math.max(0, Math.min(255, Math.round((0.5 + gx / 4) * 255)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round((0.5 + gy / 4) * 255)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round((0.5 + (H[yo + x] - blur[yo + x]) * 2.2) * 255)));
      out[i + 3] = 255;
    }
  }
  return out;
}

function stampStones(S, R, G, B, H, rand, count, rMin, rMax, skew, palette, heightBase, fine) {
  for (let k = 0; k < count; k++) {
    const cx = rand() * S, cy = rand() * S;
    const rad = rMin + Math.pow(rand(), skew) * (rMax - rMin);
    const asp = 0.55 + 0.45 * rand();
    const rot = rand() * Math.PI;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const p = palette(rand);
    const expose = p[3];
    const ext = Math.ceil(rad) + 1;
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    const tilt = (rand() - 0.5) * 0.5;
    for (let dy = -ext; dy <= ext; dy++) {
      const yy = ((y0 + dy) % S + S) % S;
      for (let dx = -ext; dx <= ext; dx++) {
        const fx = x0 + dx + 0.5 - cx, fy = y0 + dy + 0.5 - cy;
        const lx = fx * cs + fy * sn, ly = (-fx * sn + fy * cs) / asp;
        const d2 = (lx * lx + ly * ly) / (rad * rad);
        if (d2 >= 1) continue;
        const xx = ((x0 + dx) % S + S) % S;
        const i = yy * S + xx;
        const t = 1 - d2;
        const e = Math.min(1, t * 3.5) * expose;
        const v = 0.86 + 0.28 * fine[i] + tilt * lx / rad;
        R[i] += (p[0] * v - R[i]) * e; G[i] += (p[1] * v - G[i]) * e; B[i] += (p[2] * v - B[i]) * e;
        const h = heightBase + 0.42 * Math.sqrt(t) * (0.6 + 0.4 * expose);
        if (h > H[i]) H[i] = h;
      }
    }
  }
}

export function makeAsphaltTextures(ctx, S = 1024, tileM = 1.53) {
  const rand = ctx.rng('terrain/tex/asphalt');
  const N = S * S;
  const big = normalise(fbmGrid(rand, S, 4, 5));
  const mid = normalise(fbmGrid(rand, S, 48, 3));
  const fine = new Float32Array(N); for (let i = 0; i < N; i++) fine[i] = rand();
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), H = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // weathered mastic: binder with fines, oxidised to a warm mid-dark grey
    const m = 0.082 + 0.03 * (big[i] - 0.5) + 0.028 * (mid[i] - 0.5) + 0.03 * (fine[i] - 0.5);
    R[i] = m * 1.03; G[i] = m; B[i] = m * 0.955;
    H[i] = 0.22 + 0.16 * mid[i] + 0.08 * fine[i];
  }
  // sand-size fines (sub-texel to 1 px) brighten the mastic in places
  for (let k = 0; k < N * 0.08; k++) {
    const i = (rand() * N) | 0; const v = 0.14 + rand() * 0.14;
    R[i] = R[i] * 0.4 + v * 0.6; G[i] = G[i] * 0.4 + v * 0.58; B[i] = B[i] * 0.4 + v * 0.55;
  }
  const palette = (r) => {
    const p = r();
    const e = 0.2 + 0.6 * r();
    if (p < 0.34) { const v = 0.21 + r() * 0.12; return [v * 1.02, v, v * 0.96, e * 0.8]; } // light grey stone
    if (p < 0.68) { const v = 0.14 + r() * 0.07; return [v, v, v * 1.02, e]; }              // mid grey
    if (p < 0.84) { const v = 0.8 + r() * 0.3; return [0.30 * v, 0.26 * v, 0.205 * v, e]; } // beige/tan
    if (p < 0.95) { const v = 0.06 + r() * 0.04; return [v, v, v, e]; }                     // dark
    return [0.27, 0.165, 0.115, e];                                                          // reddish chert
  };
  const meanArea = Math.PI * 3.2 * 3.2 * 0.78;
  stampStones(S, R, G, B, H, rand, Math.round((N * 0.36) / meanArea), 1.0, 7.5, 2.4, palette, 0.45, fine);
  // voids and pits between stones
  for (let k = 0; k < N * 0.0025; k++) {
    const cx = (rand() * S) | 0, cy = (rand() * S) | 0, r = 0.8 + rand() * 1.6;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const i = (((cy + dy) % S + S) % S) * S + (((cx + dx) % S + S) % S);
      R[i] *= 0.45; G[i] *= 0.45; B[i] *= 0.45; H[i] = Math.min(H[i], 0.05);
    }
  }
  const alb = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    alb[i * 4] = srgb8(R[i]); alb[i * 4 + 1] = srgb8(G[i]); alb[i * 4 + 2] = srgb8(B[i]);
    alb[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(H[i] * 255)));
  }
  const nrm = encodeNormal(H, S, 0.004, tileM / S);
  return { albedo: dataTex(alb, S, true), normal: dataTex(nrm, S, false), tileM };
}

export function makeConcreteTextures(ctx, S = 512, tileM = 0.605) {
  const rand = ctx.rng('terrain/tex/concrete');
  const N = S * S;
  const big = normalise(fbmGrid(rand, S, 2, 5));
  const mid = normalise(fbmGrid(rand, S, 20, 3));
  const blot = normalise(latticeGrid(rand, S, 6));
  const fine = new Float32Array(N); for (let i = 0; i < N; i++) fine[i] = rand();
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), H = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = 0.3 + 0.05 * (big[i] - 0.5) + 0.03 * (mid[i] - 0.5) + 0.02 * (fine[i] - 0.5) - 0.025 * Math.max(0, blot[i] - 0.6);
    R[i] = m * 1.02; G[i] = m; B[i] = m * 0.955;
    H[i] = 0.5 + 0.18 * (mid[i] - 0.5) + 0.06 * fine[i];
  }
  const palette = (r) => {
    const p = r();
    const e = 0.35 + 0.5 * r();
    if (p < 0.45) { const v = 0.36 + r() * 0.12; return [v * 1.01, v, v * 0.96, e]; }
    if (p < 0.75) { const v = 0.17 + r() * 0.06; return [v, v, v, e]; }
    if (p < 0.92) { return [0.34, 0.29, 0.22, e]; }
    return [0.08, 0.08, 0.08, e];
  };
  stampStones(S, R, G, B, H, rand, Math.round(N * 0.16 / (Math.PI * 1.4 * 1.4)), 0.6, 3.2, 2.2, palette, 0.52, fine);
  // pores
  for (let k = 0; k < N * 0.0035; k++) {
    const cx = (rand() * S) | 0, cy = (rand() * S) | 0, r = 0.6 + rand() * 1.3;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const i = (((cy + dy) % S + S) % S) * S + (((cx + dx) % S + S) % S);
      R[i] *= 0.55; G[i] *= 0.55; B[i] *= 0.55; H[i] = Math.min(H[i], 0.2);
    }
  }
  const alb = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    alb[i * 4] = srgb8(R[i]); alb[i * 4 + 1] = srgb8(G[i]); alb[i * 4 + 2] = srgb8(B[i]);
    alb[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(H[i] * 255)));
  }
  const nrm = encodeNormal(H, S, 0.0015, tileM / S);
  return { albedo: dataTex(alb, S, true), normal: dataTex(nrm, S, false), tileM };
}

// Precast slab face with exposed fine aggregate (granite-like speckle), ~1.2 mm per texel.
export function makeStoneTextures(ctx, S = 512, tileM = 0.61) {
  const rand = ctx.rng('terrain/tex/stone');
  const N = S * S;
  const big = normalise(fbmGrid(rand, S, 4, 4));
  const fine = new Float32Array(N); for (let i = 0; i < N; i++) fine[i] = rand();
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), H = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = 0.2 + 0.03 * (big[i] - 0.5) + 0.02 * (fine[i] - 0.5);
    R[i] = m * 1.02; G[i] = m; B[i] = m * 0.97; H[i] = 0.45 + 0.05 * fine[i];
  }
  const palette = (r) => {
    const p = r(); const e = 0.6 + 0.4 * r();
    if (p < 0.3) { const v = 0.035 + r() * 0.03; return [v, v, v, e]; }
    if (p < 0.55) { const v = 0.42 + r() * 0.15; return [v, v * 0.99, v * 0.95, e]; }
    if (p < 0.85) { const v = 0.15 + r() * 0.1; return [v, v, v * 1.02, e]; }
    return [0.3, 0.2, 0.15, e];
  };
  stampStones(S, R, G, B, H, rand, Math.round(N * 0.5 / (Math.PI * 1.3 * 1.3)), 0.5, 2.6, 2.0, palette, 0.5, fine);
  const alb = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    alb[i * 4] = srgb8(R[i]); alb[i * 4 + 1] = srgb8(G[i]); alb[i * 4 + 2] = srgb8(B[i]);
    alb[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(H[i] * 255)));
  }
  const nrm = encodeNormal(H, S, 0.0008, tileM / S);
  return { albedo: dataTex(alb, S, true), normal: dataTex(nrm, S, false), tileM };
}

export function makeCrackTexture(ctx, S = 2048, tileM = 11.3) {
  const rand = ctx.rng('terrain/tex/cracks');
  const c = makeCanvas(S, S);
  const g = c.getContext('2d', { alpha: false, willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalCompositeOperation = 'lighten';
  const polylines = [];
  function walk(x, y, h, steps, w, depth) {
    const pts = [[x, y]];
    for (let i = 0; i < steps; i++) {
      h += (rand() - 0.5) * 0.7;
      const L = 4 + rand() * 9;
      x += Math.cos(h) * L; y += Math.sin(h) * L;
      pts.push([x, y]);
      if (depth < 2 && rand() < 0.035) walk(x, y, h + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.9), Math.floor(steps * (0.2 + rand() * 0.4)), w * 0.7, depth + 1);
    }
    polylines.push({ pts, w, sealed: depth === 0 && rand() < 0.45 });
  }
  for (let k = 0; k < 30; k++) walk(rand() * S, rand() * S, rand() * Math.PI * 2, 30 + Math.floor(rand() * 140), 1.0 + rand() * 1.6, 0);
  // alligator (block) cracking clusters
  for (let k = 0; k < 3; k++) {
    const cx = rand() * S, cy = rand() * S, R0 = 60 + rand() * 90;
    for (let j = 0; j < 45; j++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * R0;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr, r = 10 + rand() * 18;
      const n = 4 + Math.floor(rand() * 3);
      const rot = rand() * 6.28;
      const corners = [];
      for (let i = 0; i < n; i++) { const b = rot + ((i + (rand() - 0.5) * 0.6) / n) * Math.PI * 2; const q = r * (0.55 + rand() * 0.7); corners.push([px + Math.cos(b) * q, py + Math.sin(b) * q]); }
      for (let i = 0; i < n; i++) {
        if (rand() < 0.35) continue; // partial edges: real block cracking is not a closed mesh
        const a0 = corners[i], a1 = corners[(i + 1) % n];
        const mid = [(a0[0] + a1[0]) / 2 + (rand() - 0.5) * 6, (a0[1] + a1[1]) / 2 + (rand() - 0.5) * 6];
        polylines.push({ pts: [a0, mid, a1], w: 0.7 + rand() * 0.6, sealed: false });
      }
    }
  }
  const strokeAll = (style, widthFn, filter) => {
    g.strokeStyle = style;
    for (const pl of polylines) {
      if (!filter(pl)) continue;
      g.lineWidth = widthFn(pl);
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        g.beginPath();
        pl.pts.forEach(([x, y], i) => (i ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)));
        g.stroke();
      }
    }
  };
  strokeAll('rgb(0,255,0)', () => 4 + rand() * 4, (pl) => pl.sealed);
  strokeAll('rgb(0,120,0)', () => 8 + rand() * 4, (pl) => pl.sealed && rand() < 0.5);
  strokeAll('rgb(255,0,0)', (pl) => pl.w, () => true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return { tex: t, tileM };
}
