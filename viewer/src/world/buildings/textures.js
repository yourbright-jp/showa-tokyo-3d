import * as THREE from 'three';

// Procedural textures for the buildings module (no image files). Tileable textures are built as
// DataTextures so that an alpha "tint mask" channel survives (canvas alpha is premultiplied).
// Row 0 of a DataTexture is v=0 (bottom).

/** Tileable value noise with independent periods on x and y. */
export function tileNoise(rand, px, py) {
  const g = new Float32Array(px * py);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = s(x - xi), yf = s(y - yi);
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const a = g[y0 * px + x0], b = g[y0 * px + x1], c = g[y1 * px + x0], d = g[y1 * px + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

/** Tileable fbm over a w x h texture: base lattice cells (cx, cy) at octave 0. */
export function tileFbm(rand, w, h, cx, cy, oct = 4) {
  const layers = [];
  for (let o = 0; o < oct; o++) layers.push({ n: tileNoise(rand, cx << o, cy << o), fx: (cx << o) / w, fy: (cy << o) / h, a: Math.pow(0.5, o) });
  const norm = layers.reduce((s, l) => s + l.a, 0);
  return (x, y) => { let v = 0; for (const l of layers) v += l.a * l.n(x * l.fx, y * l.fy); return v / norm; };
}

export function makeDataTexture(w, h, data, { srgb = true, worldW = 1, worldH = 1, anisotropy = 8 } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.repeat.set(1 / worldW, 1 / worldH);
  t.needsUpdate = true;
  return t;
}

/** Normal map (tangent space, tileable) from a height field. strength scales slopes. */
export function normalFromHeight(H, w, h, strength = 2, worldW = 1, worldH = 1) {
  const out = new Uint8Array(w * h * 4);
  const sx = strength * w / worldW / 512, sy = strength * h / worldH / 512;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yd = (y - 1 + h) % h, yu = (y + 1) % h;
      const dx = (H[y * w + xr] - H[y * w + xl]) * sx;
      const dy = (H[yu * w + x] - H[yd * w + x]) * sy;
      let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
  return out;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Tile cladding: grid of tiles with grout. Returns {map, normal}. Tile pixels get alpha 255
 * (tinted by the building colour), grout alpha 0 (keeps its own grey).
 * opts: {w,h, cols, rows, worldW, worldH, grout(px), bond(0|0.5), vary, dark, scratch, grout colour}
 */
export function tileTexture(rand, o) {
  const { w, h, cols, rows, worldW, worldH } = o;
  const cw = w / cols, ch = h / rows;
  const tileVals = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols + 1; c++) {
      let l = 1 - o.vary * rand();
      if (rand() < (o.darkChance || 0)) l *= o.dark || 0.8;
      const hue = (rand() - 0.5) * (o.hue || 0.04);
      row.push([l * (1 + hue), l, l * (1 - hue)]);
    }
    tileVals.push(row);
  }
  const fine = tileFbm(rand, w, h, 32, 32, 3);
  const H = new Float32Array(w * h);
  const data = new Uint8Array(w * h * 4);
  const gc = o.groutColor || [168, 164, 156];
  for (let y = 0; y < h; y++) {
    const r = Math.floor(y / ch); const fy = y - r * ch;
    const shift = (r % 2) * (o.bond || 0) * cw;
    for (let x = 0; x < w; x++) {
      const xs = (x - shift + w) % w;
      const c = Math.floor(xs / cw); const fx = xs - c * cw;
      const g = o.grout;
      const edge = Math.min(fx, cw - fx, fy, ch - fy);
      const i = (y * w + x) * 4;
      const n = fine(x, y);
      if (edge < g) {
        const v = 0.92 + 0.16 * n;
        data[i] = clamp255(gc[0] * v); data[i + 1] = clamp255(gc[1] * v); data[i + 2] = clamp255(gc[2] * v); data[i + 3] = 0;
        H[y * w + x] = 0;
      } else {
        const tv = tileVals[r][c % (cols + 1)];
        let face = 0.97 + 0.06 * (n - 0.5);
        if (o.scratch) face *= 0.9 + 0.1 * Math.sin((x * 2.7 + n * 8)) * Math.sin(x * 0.9 + y * 0.03);
        const bevel = Math.min(1, (edge - g) / Math.max(1, o.bevel || 2));
        data[i] = clamp255(255 * tv[0] * face); data[i + 1] = clamp255(255 * tv[1] * face); data[i + 2] = clamp255(255 * tv[2] * face); data[i + 3] = 255;
        H[y * w + x] = 0.6 + 0.4 * bevel + (o.scratch ? 0.08 * Math.sin(x * 2.7 + n * 8) : 0.02 * n);
      }
    }
  }
  return {
    map: makeDataTexture(w, h, data, { worldW, worldH }),
    normal: makeDataTexture(w, h, normalFromHeight(H, w, h, o.normalStrength || 3, worldW, worldH), { srgb: false, worldW, worldH }),
  };
}

/** Mottled painted render / mortar (fully tinted). */
export function renderTexture(rand, w = 512, h = 512, worldW = 2, worldH = 2) {
  const big = tileFbm(rand, w, h, 4, 4, 5);
  const fine = tileFbm(rand, w, h, 64, 64, 2);
  const data = new Uint8Array(w * h * 4); const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = big(x, y), f = fine(x, y);
    const speck = rand() < 0.012 ? 0.86 : 1;
    const v = (0.86 + 0.16 * b + 0.05 * (f - 0.5)) * speck;
    const i = (y * w + x) * 4;
    data[i] = clamp255(255 * v); data[i + 1] = clamp255(255 * v * 0.995); data[i + 2] = clamp255(255 * v * 0.985); data[i + 3] = 255;
    H[y * w + x] = f * 0.6 + b * 0.4;
  }
  return { map: makeDataTexture(w, h, data, { worldW, worldH }), normal: makeDataTexture(w, h, normalFromHeight(H, w, h, 1.2, worldW, worldH), { srgb: false, worldW, worldH }) };
}

/** Exposed concrete with 0.9 x 1.8 m formwork panels and tie holes. Texture spans 1.8 x 1.8 m. */
export function concreteTexture(rand, w = 512, h = 512) {
  const worldW = 1.8, worldH = 1.8;
  const big = tileFbm(rand, w, h, 6, 6, 5);
  const fine = tileFbm(rand, w, h, 96, 96, 2);
  const panelTone = [1 + (rand() - 0.5) * 0.08, 1 + (rand() - 0.5) * 0.08];
  const holes = [];
  for (const px of [0.15, 0.75, 1.05, 1.65]) for (const py of [0.3, 0.9, 1.5]) holes.push([px / worldW * w, py / worldH * h]);
  const data = new Uint8Array(w * h * 4); const H = new Float32Array(w * h);
  const seam = (x) => Math.min(Math.abs(x % (w / 2)), Math.abs(w / 2 - (x % (w / 2))));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const pt = panelTone[x < w / 2 ? 0 : 1];
    let v = (0.8 + 0.2 * big(x, y) + 0.08 * (fine(x, y) - 0.5)) * pt;
    let hh = 0.5 + 0.2 * fine(x, y);
    const sx = seam(x), sy = Math.min(y, h - y);
    if (sx < 1.2 || sy < 1.2) { v *= 0.8; hh = 0.2; }
    for (const [hx, hy] of holes) { const d = Math.hypot(x - hx, y - hy); if (d < 4) { v *= 0.55 + 0.1 * d; hh = 0.1; } else if (d < 7) v *= 0.96; }
    if (rand() < 0.004) { v *= 0.8; hh -= 0.2; } // air pockets
    const i = (y * w + x) * 4;
    data[i] = clamp255(196 * v); data[i + 1] = clamp255(194 * v); data[i + 2] = clamp255(188 * v); data[i + 3] = 255;
    H[y * w + x] = hh;
  }
  return { map: makeDataTexture(w, h, data, { worldW, worldH }), normal: makeDataTexture(w, h, normalFromHeight(H, w, h, 2, worldW, worldH), { srgb: false, worldW, worldH }) };
}

/** Painted steel / precast spandrel panels with joints every 0.9 m. Texture spans 1.8 x 1.8 m. */
export function panelTexture(rand, w = 256, h = 256) {
  const worldW = 1.8, worldH = 1.8;
  const big = tileFbm(rand, w, h, 4, 4, 4);
  const data = new Uint8Array(w * h * 4); const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = Math.min(x % (w / 2), w / 2 - (x % (w / 2)));
    let v = 0.93 + 0.07 * big(x, y); let hh = 0.5;
    if (j < 1.5) { v *= 0.7; hh = 0.1; }
    const i = (y * w + x) * 4;
    data[i] = clamp255(250 * v); data[i + 1] = clamp255(250 * v); data[i + 2] = clamp255(248 * v); data[i + 3] = 255;
    H[y * w + x] = hh;
  }
  return { map: makeDataTexture(w, h, data, { worldW, worldH }), normal: makeDataTexture(w, h, normalFromHeight(H, w, h, 2, worldW, worldH), { srgb: false, worldW, worldH }) };
}

/** Vertical rain-streak modulation (R channel ~ 1 clean, lower = streak). Spans 3 x 9 m. */
export function streakTexture(rand, w = 256, h = 512) {
  const n1 = tileNoise(rand, 96, 6), n2 = tileNoise(rand, 40, 3), n3 = tileNoise(rand, 160, 12);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = n1(x / w * 96, y / h * 6), b = n2(x / w * 40, y / h * 3), c = n3(x / w * 160, y / h * 12);
    let s = Math.pow(Math.max(0, a * 0.55 + b * 0.3 + c * 0.25 - 0.35), 1.6) * 2.2;
    s = Math.min(1, s);
    const v = 255 * (1 - 0.85 * s);
    const i = (y * w + x) * 4; data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  const t = makeDataTexture(w, h, data, { srgb: false });
  t.repeat.set(1, 1);
  return t;
}

/** Corrugated roller shutter slats (horizontal ribs every ~6 cm). Spans 1 x 1 m. */
export function shutterTexture(rand, w = 128, h = 256) {
  const big = tileFbm(rand, w, h, 4, 8, 4);
  const streak = tileNoise(rand, 24, 2);
  const data = new Uint8Array(w * h * 4); const H = new Float32Array(w * h);
  const ribs = 16;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ph = (y / h) * ribs; const f = ph - Math.floor(ph);
    const prof = Math.sin(f * Math.PI * 2) * 0.5 + 0.5;
    const groove = f < 0.08 ? 0.55 : 1;
    const dirt = 0.85 + 0.15 * big(x, y) - 0.12 * Math.max(0, streak(x / w * 24, y / h * 2) - 0.6);
    const v = (0.78 + 0.22 * prof) * groove * dirt;
    const i = (y * w + x) * 4;
    data[i] = clamp255(255 * v); data[i + 1] = clamp255(255 * v); data[i + 2] = clamp255(255 * v * 0.98); data[i + 3] = 255;
    H[y * w + x] = prof * 0.8 + (f < 0.08 ? -0.3 : 0);
  }
  return { map: makeDataTexture(w, h, data, { worldW: 1, worldH: 1 }), normal: makeDataTexture(w, h, normalFromHeight(H, w, h, 3, 1, 1), { srgb: false }) };
}

/** Flat roof: weathered concrete / asphalt sheet with patches. Spans 4 x 4 m. */
export function roofTexture(rand, w = 256, h = 256) {
  const big = tileFbm(rand, w, h, 4, 4, 5), fine = tileFbm(rand, w, h, 48, 48, 2);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = big(x, y); let v = 0.7 + 0.3 * b + 0.1 * (fine(x, y) - 0.5);
    if (b > 0.68) v *= 0.75; // tar patches
    const seam = (x % 64 < 1.5) || (y % 64 < 1.5);
    if (seam) v *= 0.82;
    const i = (y * w + x) * 4; data[i] = clamp255(200 * v); data[i + 1] = clamp255(196 * v); data[i + 2] = clamp255(188 * v); data[i + 3] = 255;
  }
  return makeDataTexture(w, h, data, { worldW: 4, worldH: 4 });
}

/** Shop floor: vinyl tiles / terrazzo checker (0.3 m tiles). Spans 1.2 x 1.2 m. */
export function floorTexture(rand, w = 128, h = 128) {
  const fine = tileFbm(rand, w, h, 32, 32, 2);
  const data = new Uint8Array(w * h * 4);
  const cell = w / 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const chk = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
    const joint = x % cell < 1 || y % cell < 1;
    let v = (chk ? 0.9 : 0.62) * (0.92 + 0.12 * fine(x, y));
    if (joint) v *= 0.8;
    const i = (y * w + x) * 4; data[i] = clamp255(255 * v); data[i + 1] = clamp255(250 * v); data[i + 2] = clamp255(240 * v); data[i + 3] = 255;
  }
  return makeDataTexture(w, h, data, { worldW: 1.2, worldH: 1.2 });
}

/**
 * Curtain / blind atlas for interior-mapped windows: 8 tiles side by side (each 64 x 128).
 * RGB = curtain colour, A = coverage. Tile 0 = nothing.
 */
export function curtainAtlas(rand) {
  const tw = 64, th = 128, n = 8, w = tw * n, h = th;
  const data = new Uint8Array(w * h * 4);
  const fine = tileFbm(rand, w, h, 64, 16, 2);
  const set = (x, y, c, a) => { const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a; };
  for (let k = 0; k < n; k++) {
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const u = x / tw, v = y / th; // v=0 bottom
      const gx = k * tw + x; const f = fine(gx, y);
      let c = [0, 0, 0], a = 0;
      if (k === 1) { // two-side drawn curtains, cream
        const left = 0.18 + 0.08 * Math.sin(v * 3), right = 0.82 - 0.06 * Math.sin(v * 2.3 + 1);
        if (u < left || u > right) { const fold = 0.8 + 0.2 * Math.sin(u * 70); c = [232 * fold, 220 * fold, 190 * fold]; a = 255; }
      } else if (k === 2) { // lace curtain full width, translucent
        const fold = 0.85 + 0.15 * Math.sin(u * 90); c = [240 * fold, 238 * fold, 228 * fold]; a = 150 + 40 * f;
      } else if (k === 3) { // venetian blind lowered to 60%
        if (v > 0.4) { const slat = ((v * 40) % 1) < 0.8 ? 1 : 0.6; c = [214 * slat, 216 * slat, 210 * slat]; a = 240; }
      } else if (k === 4) { // roll blind half down, pale yellow
        if (v > 0.52) { c = [226, 212, 168]; a = 250; } else if (v > 0.5) { c = [120, 110, 90]; a = 255; }
      } else if (k === 5) { // frosted / paper-covered glass
        c = [222 + 10 * f, 226 + 10 * f, 224 + 10 * f]; a = 225;
      } else if (k === 6) { // one-side curtain, patterned (period floral print on cream, muted)
        if (u < 0.55) {
          const fold = 0.82 + 0.18 * Math.sin(u * 55);
          const dot = (Math.sin(u * 26 + Math.sin(v * 9) * 2) * Math.sin(v * 21) > 0.55);
          c = dot ? [200 * fold, 150 * fold, 110 * fold] : [226 * fold, 214 * fold, 182 * fold]; a = 255;
        }
      } else if (k === 7) { // stacked boxes / storage against glass on lower half
        if (v < 0.38) { const bx = Math.floor(u * 2.2 + Math.floor(v * 2.6) * 0.5); const t = 0.55 + 0.45 * ((bx * 37) % 7) / 7; c = [150 * t, 132 * t, 104 * t]; a = 255; }
      }
      set(gx, y, c.map(clamp255), a);
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

/** Pack an RGB canvas and a mask canvas into a DataTexture (mask -> alpha), flipping rows. */
export function packCanvas(rgbCanvas, maskCanvas, opts = {}) {
  const w = rgbCanvas.width, h = rgbCanvas.height;
  const a = rgbCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const m = maskCanvas ? maskCanvas.getContext('2d').getImageData(0, 0, w, h).data : null;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = (sy * w + x) * 4, di = (y * w + x) * 4;
      out[di] = a[si]; out[di + 1] = a[si + 1]; out[di + 2] = a[si + 2]; out[di + 3] = m ? m[si] : 255;
    }
  }
  return makeDataTexture(w, h, out, opts);
}
