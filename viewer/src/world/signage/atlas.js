import * as THREE from 'three';
import { makeValueNoise, paintPixels } from '../../core/textures.js';

// Texture atlas for sign faces. All faces are painted into a few large canvases (pages) so the
// whole signage layer draws with a handful of materials. Optional parallel emissive pages share
// the same layout (only built for the neon-night look).

export class AtlasSet {
  // Pages are logical: packing assigns faces to pages, then pages are painted one at a time into a
  // single working canvas (plus one emissive canvas for neon-night) and uploaded to the GPU before
  // the canvas is reused. Many large accelerated canvases exceed Chromium's canvas memory budget and
  // silently fall back to (much slower) software rasterisation.
  constructor(size = 2048, { emissive = false, pad = 6 } = {}) {
    this.size = size; this.pad = pad; this.emissive = emissive;
    this.pages = [];
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext('2d');
    if (emissive) { this.em = document.createElement('canvas'); this.em.width = this.em.height = size; this.ge = this.em.getContext('2d'); }
  }
  _newPage() {
    const page = { index: this.pages.length, x: 0, y: 0, rowH: 0, used: 0, g: this.g, ge: this.ge || null, canvas: this.canvas, em: this.em || null };
    this.pages.push(page);
    return page;
  }
  /** Prepare the working canvas for painting `page`. */
  begin(page) {
    this.g.globalCompositeOperation = 'source-over'; this.g.globalAlpha = 1;
    this.g.fillStyle = '#7a7670'; this.g.fillRect(0, 0, this.size, this.size);
    if (this.ge) { this.ge.fillStyle = '#000'; this.ge.fillRect(0, 0, this.size, this.size); }
  }
  /** Upload the painted page now and return {map, emissiveMap}; the canvas is then free for reuse. */
  upload(renderer) {
    const map = toTex(this.canvas, true);
    renderer.initTexture(map);
    let emissiveMap = null;
    if (this.em) { emissiveMap = toTex(this.em, true); renderer.initTexture(emissiveMap); }
    return { map, emissiveMap };
  }
  /**
   * Pack a list of requests [{w, h, ...}] (pixels). Sorted by height for shelf packing.
   * Each request receives .region = {page, x, y, w, h, uv:[u0,v0,u1,v1]} (inner rect, padded).
   */
  pack(reqs) {
    const S = this.size, P = this.pad;
    const order = reqs.slice().sort((a, b) => b.h - a.h || b.w - a.w);
    let page = this.pages[this.pages.length - 1] || this._newPage();
    for (const r of order) {
      const w = Math.min(S - 2 * P, Math.max(2, Math.round(r.w))), h = Math.min(S - 2 * P, Math.max(2, Math.round(r.h)));
      const W = w + 2 * P, H = h + 2 * P;
      if (page.x + W > S) { page.x = 0; page.y += page.rowH; page.rowH = 0; }
      if (page.y + H > S) { page = this._newPage(); }
      const x = page.x + P, y = page.y + P;
      page.x += W; page.rowH = Math.max(page.rowH, H); page.used += W * H;
      r.region = { page: page.index, x, y, w, h, uv: [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S] };
    }
    return reqs;
  }
  /**
   * Fill a region's padding before painting so mip levels do not bleed the page background
   * into the sign edge. color=null clears to transparent (cloth faces use alpha).
   */
  prefill(region, color) {
    const P = this.pad;
    const { x, y, w, h } = region;
    if (color) { this.g.fillStyle = color; this.g.fillRect(x - P, y - P, w + 2 * P, h + 2 * P); }
    else this.g.clearRect(x - P, y - P, w + 2 * P, h + 2 * P);
  }
}

function toTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.flipY = true;
  return t;
}

/**
 * Weathering stamps (generated once, reused by every sign as transformed repeating patterns with random
 * crops). Values are near-white with darker grime so they can be multiplied onto a face.
 */
export function makeStamps(rng) {
  const r = rng('signage/stamps');
  const N = makeValueNoise(r, 256);
  // Stamps are stored as dark dirt colour with alpha = darkness so they can be laid over a face
  // with plain source-over blending (multiply needs destination reads, slow on GPU canvas).
  const mk = (w, h, fn) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paintPixels(c.getContext('2d'), w, h, (u, v, x, y) => {
      const [r, g, b] = fn(u, v, x, y);
      const a = Math.max(0, Math.min(255, (255 - (r + g + b) / 3) * 2.2));
      return [52, 44, 34, a];
    });
    return c;
  };
  // broad blotchy dirt (tileable)
  const blotch = mk(256, 256, (u, v) => {
    const n = N.fbm(u * 6, v * 6, 5, 6);
    const k = Math.max(0, Math.min(1, (n - 0.42) * 2.4));
    const l = 255 - k * 120;
    return [l, l * 0.97, l * 0.9];
  });
  // fine speckle / grain (sparse dark pits + faint mottling)
  const speck = mk(256, 256, (u, v, x, y) => {
    const n = N.noise2(x, y, 256);
    const m = N.noise2(x * 0.125, y * 0.125, 32);
    const pit = n > 0.86 ? (n - 0.86) * 900 : 0;
    const l = 255 - pit - (1 - m) * 14;
    return [l, l * 0.985, l * 0.95];
  });
  // vertical rain streaks: sparse columns, dark at the top fading down at varying lengths
  const streak = mk(256, 256, (u, v) => {
    const col = N.noise2(u * 40, 0.5, 40) * 0.75 + N.noise2(u * 140, 5.5, 140) * 0.25;
    const len = 0.15 + N.noise2(u * 23, 7.7, 23) * 0.85;
    const k = Math.max(0, col - 0.62) * 3.2;
    const s = Math.min(1, k) * Math.max(0, 1 - v / len) * (0.7 + 0.3 * N.noise2(u * 40, v * 12, 40));
    const l = 255 - s * 120;
    return [l, l * 0.96, l * 0.9];
  });
  return { blotch, speck, streak };
}

/** Small tileable grime texture for metal frames/brackets (multiplied with vertex colours). */
export function makeMetalGrime(rng) {
  const r = rng('signage/metal-grime');
  const N = makeValueNoise(r, 128);
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  paintPixels(c.getContext('2d'), 256, 256, (u, v, x, y) => {
    const a = N.fbm(u * 4, v * 4, 4, 4);
    const rust = Math.max(0, N.fbm(u * 8 + 3, v * 8, 4, 8) - 0.55) * 3.2;
    const streak = Math.max(0, N.noise2(u * 32, v * 2, 32) - 0.6) * 1.5;
    const l = 0.78 + a * 0.3 - streak * 0.25;
    const rr = l * (1 + rust * 0.25), gg = l * (1 - rust * 0.1), bb = l * (1 - rust * 0.35);
    return [Math.min(255, rr * 255), Math.min(255, gg * 255), Math.min(255, bb * 255)];
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
