import * as THREE from 'three';

// Helpers for procedural (code-generated) textures. No image files are loaded anywhere.

export function canvasTexture(width, height, draw, { srgb = true, repeat = null, anisotropy = 8, mipmaps = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  draw(g, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// Value noise with smooth interpolation, tileable when `period` is given.
export function makeValueNoise(rand, size = 256) {
  const perm = new Uint8Array(size * 2);
  const vals = new Float32Array(size);
  for (let i = 0; i < size; i++) { perm[i] = i; vals[i] = rand(); }
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < size; i++) perm[i + size] = perm[i];
  const s = (t) => t * t * (3 - 2 * t);
  function noise2(x, y, period = size) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const w = (a) => ((a % period) + period) % period % size;
    const v = (ix, iy) => vals[perm[(perm[w(ix)] + w(iy)) % (size * 2)]];
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = s(xf), t = s(yf);
    return a + (b - a) * u + (c - a) * t + (a - b - c + d) * u * t;
  }
  function fbm(x, y, octaves = 5, period = size) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise2(x * f, y * f, period * f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
  return { noise2, fbm };
}

/** Fill a canvas pixel-by-pixel. fn(u, v, x, y) returns [r,g,b] (0-255) or [r,g,b,a]. */
export function paintPixels(g, w, h, fn) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  g.putImageData(img, 0, 0);
}

export const JP_FONT = '"IPAGothic", "IPAPGothic", "WenQuanYi Zen Hei", sans-serif';
