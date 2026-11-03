import * as THREE from 'three';
import { makeValueNoise, paintPixels } from '../../core/textures.js';
import { hexRgb, rgbHex } from './paint.js';

// r05 optional sign ageing (URL parameter sign=1; nothing here runs when it is omitted).
//  - per-sign age drawn from its own keyed stream (signage/r05age/...), never from the painter
//    streams, so names, layouts and the adopted text nodes are untouched;
//  - hue-selective sun fade of the painted colours (reds/oranges fade to salmon/pink, blacks chalk
//    to grey, whites yellow), applied by swapping the spec colours only while the face is painted;
//  - an extra overlay pass after the painter: chalky mottling, uneven brushing, dirt caps on top
//    edges, bolts with rust runs and grime below them, rust bleed along the lower frame and paint
//    flakes showing primer. Some signs draw a "recent" age and get much less of all of this.
//  - rustier, dirtier steel brackets/frames (texture + per-vertex tint).
// Evidence tier: period-plausible-generic (1970s street photographs: faded enamel, rust runs).

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const hh = h / 360;
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

/** Sun fade / chalking of one sRGB hex colour. a = 0..1 exposure x age. */
export function fadeHex(hex, a) {
  if (a <= 0) return hex;
  const [R, G, B] = hexRgb(hex).map((v) => v / 255);
  let [h, s, l] = rgb2hsl(R, G, B);
  // organic red/orange pigments fade fastest; yellows and blues less, greens least
  const k = (h < 48 || h >= 320) ? 1.0 : h < 70 ? 0.55 : h < 175 ? 0.3 : 0.45;
  const f = a * k * s;
  if (h < 48 || h >= 320) h = h >= 320 ? h + (360 - h) * 0.3 * f : h + (h < 20 ? 5 : -3) * f; // reds drift towards a dull salmon, not pink
  s *= 1 - 0.5 * f;
  l += (0.72 - l) * 0.3 * f;
  let [r, g, b] = hsl2rgb(h, s, l);
  // enamel chalking: darks lift towards a warm grey; whites yellow slightly
  const c = a * 0.22 * (1 - l);
  r += (0.62 - r) * c; g += (0.6 - g) * c; b += (0.56 - b) * c;
  if (l > 0.8) { const y = a * 0.12; r += (0.9 - r) * y; g += (0.86 - g) * y; b += (0.74 - b) * y; }
  return rgbHex([r * 255, g * 255, b * 255]);
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const SKIP = new Set(['adopted', 'adoptedRendered', 'neon', 'bulbPx', 'region', 'night']);

/**
 * Temporarily fade every colour in a face spec (and its weather amount for recent signs). Returns
 * an undo function; the spec (and the shared scheme objects it references) is restored exactly.
 */
export function swapSpec(spec, a, recent) {
  const undo = [];
  const seen = new Set();
  const fadeA = Math.pow(a, 1.4); // mid-aged signs fade little, the oldest ones most
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 4) return;
    seen.add(o);
    for (const key of Object.keys(o)) {
      if (SKIP.has(key)) continue;
      const v = o[key];
      if (typeof v === 'string' && HEX.test(v)) { undo.push([o, key, v]); o[key] = fadeHex(v, fadeA); }
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(spec, 0);
  if (recent && typeof spec.weather === 'number') { undo.push([spec, 'weather', spec.weather]); spec.weather *= 0.35; }
  return () => { for (let i = undo.length - 1; i >= 0; i--) { const [o, key, v] = undo[i]; o[key] = v; } };
}

/** Per-face age: most signs mid-aged, some old, a share recently repainted. */
export function drawAge(rr, spec) {
  const u = rr();
  if (u < 0.2) return { a: 0.05 + rr() * 0.15, recent: true };
  const w = typeof spec.weather === 'number' ? spec.weather : 0.55;
  return { a: clamp01(0.35 + 0.45 * w + (rr() - 0.5) * 0.5), recent: false };
}

/** Stamps for the age overlay (generated once per build from their own key). */
export function makeAgeStamps(rng) {
  const N = makeValueNoise(rng('signage/r05age/stamps'), 256);
  const mk = (w, h, fn) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paintPixels(c.getContext('2d'), w, h, fn);
    return c;
  };
  // chalky light mottling (alpha = chalk)
  const chalk = mk(256, 256, (u, v) => {
    const n = N.fbm(u * 5 + 11, v * 5 + 3, 5, 5);
    const k = clamp01((n - 0.5) * 3.2) * (0.7 + 0.3 * N.noise2(u * 96, v * 96, 96));
    return [232, 228, 216, k * 150];
  });
  // dirt cap: dark at the top (row 0), irregular lower edge, fading down (tile horizontally)
  const cap = mk(256, 64, (u, v) => {
    const edge = 0.3 + 0.45 * N.fbm(u * 8 + 5, 1.5, 4, 8);
    const k = clamp01(1 - v / edge) ** 1.4 * (0.75 + 0.25 * N.noise2(u * 64, v * 16, 64));
    // sparse run-down tails below the cap (rain carries the settled dirt down the face)
    const col = clamp01((N.noise2(u * 56, 9.5, 56) - 0.6) * 4);
    const tail = col * clamp01(1 - v / (0.4 + 0.6 * N.noise2(u * 31, 2.5, 31))) * 0.55;
    return [48, 41, 32, Math.max(k, tail) * 230];
  });
  // rust bleed band: orange-brown, strongest at the bottom row, ragged upper edge
  const rust = mk(256, 64, (u, v) => {
    const edge = 0.25 + 0.6 * N.fbm(u * 10 + 9, 4.5, 4, 10);
    const k = clamp01(1 - (1 - v) / edge) ** 1.2 * (0.6 + 0.4 * N.noise2(u * 48, v * 12 + 7, 48));
    return [118, 58, 26, k * 210];
  });
  return { chalk, cap, rust };
}

const PATS = new WeakMap();
function pats(g, S) {
  let p = PATS.get(g);
  if (!p) { p = { chalk: g.createPattern(S.chalk, 'repeat'), cap: g.createPattern(S.cap, 'repeat-x'), rust: g.createPattern(S.rust, 'repeat-x') }; PATS.set(g, p); }
  return p;
}

/** Rust run from a fixing: a tapering, slightly wandering orange-brown streak. */
function rustRun(g, rr, x0, y0, len, wd, alpha) {
  const gr = g.createLinearGradient(0, y0, 0, y0 + len);
  gr.addColorStop(0, `rgba(112,52,22,${alpha})`);
  gr.addColorStop(0.35, `rgba(128,66,30,${alpha * 0.6})`);
  gr.addColorStop(1, 'rgba(128,70,34,0)');
  g.fillStyle = gr;
  const drift = (rr() - 0.5) * wd * 1.5;
  g.beginPath();
  g.moveTo(x0 - wd * 0.5, y0);
  g.quadraticCurveTo(x0 - wd * 0.45 + drift * 0.5, y0 + len * 0.5, x0 - wd * 0.12 + drift, y0 + len);
  g.lineTo(x0 + wd * 0.12 + drift, y0 + len);
  g.quadraticCurveTo(x0 + wd * 0.45 + drift * 0.5, y0 + len * 0.5, x0 + wd * 0.5, y0);
  g.closePath(); g.fill();
}

/**
 * Overlay pass after the painter. P is the painter context (P.r is NOT used); rr is the face's own
 * r05age stream. Uses source-atop so cloth cut-outs (scallops, noren slits) stay transparent.
 */
export function ageFace(P, f, S, age, rr) {
  const { g, x, y, w, h, ppm } = P;
  const a = age.a;
  const cloth = f.cls === 'cloth';
  const pt = pats(g, S);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalCompositeOperation = 'source-atop';
  const pfill = (pat, sc, ox, oy, alpha, x0, y0, w0, h0, sy = 1) => {
    pat.setTransform(new DOMMatrix().translate(ox, oy).scale(sc, sc * sy));
    g.globalAlpha = Math.min(1, alpha); g.fillStyle = pat; g.fillRect(x0, y0, w0, h0);
  };
  // 1. chalky mottling (uneven fading across the face)
  pfill(pt.chalk, (ppm / 30) * (0.5 + rr()), x - rr() * 256, y - rr() * 256, a * (cloth ? 0.25 : 0.32), x, y, w, h, 0.7 + rr() * 0.6);
  g.globalAlpha = 1;
  // 2. uneven brushing: a few faint horizontal bands
  const nb = 2 + Math.floor(rr() * 3);
  for (let i = 0; i < nb; i++) {
    const lite = rr() < 0.2;
    g.fillStyle = `rgba(${lite ? '255,250,238' : '40,34,28'},${(lite ? 0.006 + rr() * 0.01 : 0.012 + rr() * 0.025) * (0.4 + a)})`;
    g.fillRect(x, y + rr() * h, w, h * (0.03 + rr() * 0.12));
  }
  // 2b. large-scale field ageing (r05 round 2: faces read slightly too clean): one side of the face
  // more sun-bleached than the other, a soft bleached cloud, and faint water marks running down from
  // the top edge. All low contrast and non-uniform (no all-over speckle).
  {
    const L = Math.hypot(w, h), ang = rr() * Math.PI * 2, cx0 = x + w / 2, cy0 = y + h / 2;
    const gx = (Math.cos(ang) * L) / 2, gy = (Math.sin(ang) * L) / 2;
    const kf = (0.04 + 0.11 * a) * (0.6 + 0.8 * rr());
    const gr = g.createLinearGradient(cx0 - gx, cy0 - gy, cx0 + gx, cy0 + gy);
    gr.addColorStop(0, `rgba(238,233,218,${kf.toFixed(3)})`);
    gr.addColorStop(0.45 + 0.3 * rr(), 'rgba(238,233,218,0)');
    gr.addColorStop(1, `rgba(58,50,40,${(kf * 0.45).toFixed(3)})`);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    const rx = x + rr() * w, ry = y + rr() * h * 0.6, rad = (0.25 + rr() * 0.5) * Math.max(w, h);
    const rg = g.createRadialGradient(rx, ry, 0, rx, ry, rad);
    rg.addColorStop(0, `rgba(240,236,224,${(0.03 + 0.08 * a).toFixed(3)})`); rg.addColorStop(1, 'rgba(240,236,224,0)');
    g.fillStyle = rg; g.fillRect(x, y, w, h);
  }
  if (!cloth && h > 4) {
    const nwm = Math.round((w / ppm) * (0.6 + 2.2 * a) * (0.4 + rr()));
    for (let i = 0; i < nwm; i++) {
      const x0 = x + rr() * w, wd = (0.02 + rr() * 0.08) * ppm, len = h * (0.12 + rr() * 0.55 * (0.4 + a));
      const al = (0.03 + 0.07 * a) * (0.5 + rr());
      const lite = rr() < 0.3; // rain-washed track through the settled dirt
      const col = lite ? '238,234,222' : '70,62,50';
      const drift = (rr() - 0.5) * wd;
      const wg = g.createLinearGradient(0, y, 0, y + len);
      wg.addColorStop(0, `rgba(${col},${al.toFixed(3)})`); wg.addColorStop(0.75, `rgba(${col},${(al * 0.5).toFixed(3)})`); wg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = wg;
      g.beginPath();
      g.moveTo(x0 - wd / 2, y);
      g.quadraticCurveTo(x0 - wd * 0.45 + drift, y + len * 0.6, x0 - wd * 0.3 + drift, y + len);
      g.quadraticCurveTo(x0 + drift, y + len + wd * 0.35, x0 + wd * 0.3 + drift, y + len);
      g.quadraticCurveTo(x0 + wd * 0.45 + drift, y + len * 0.6, x0 + wd / 2, y);
      g.closePath(); g.fill();
      if (!lite) {
        // tide line where the run stopped
        g.strokeStyle = `rgba(62,54,42,${(al * 1.4).toFixed(3)})`; g.lineWidth = Math.max(0.6, 0.004 * ppm);
        g.beginPath(); g.moveTo(x0 - wd * 0.32 + drift, y + len * 0.97); g.quadraticCurveTo(x0 + drift, y + len + wd * 0.35, x0 + wd * 0.32 + drift, y + len * 0.97); g.stroke();
      }
    }
  }
  // 3. dirt cap on the top edge (dust and soot settle on the upper frame and run down a little)
  const capH = Math.min(h * 0.5, (0.08 + 0.3 * a * rr() + 0.04) * ppm);
  if (capH > 1.5) {
    const sc = capH / 64, m = 1.5 + rr() * 2; // stretched horizontally, stamp height = capH
    pfill(pt.cap, sc * m, x - rr() * 256 * sc, y, (0.25 + 0.6 * a) * (cloth ? 0.7 : 1), x, y, w, capH, 1 / m);
    g.globalAlpha = 1;
  }
  if (!cloth && !age.recent) {
    // 4. rust bleed along the lower frame
    if (a > 0.35) {
      const bh = Math.min(h * 0.3, (0.04 + 0.14 * a * rr()) * ppm);
      if (bh > 1.5) { const sc = bh / 64, m = 1.2 + rr() * 1.5; pfill(pt.rust, sc * m, x - rr() * 256 * sc, y + h - bh, 0.25 + 0.55 * a, x, y + h - bh, w, bh, 1 / m); g.globalAlpha = 1; }
    }
    // 5. fixings: bolts near the top and bottom edges, with rust runs and a grime shadow below
    const wm = w / ppm, hm = h / ppm;
    if (wm > 0.25 && hm > 0.2) {
      const inset = Math.min(0.06, hm * 0.12, wm * 0.12) * ppm;
      const spacing = 0.55 + rr() * 0.45;
      const n = Math.max(1, Math.round((wm - 0.12) / spacing));
      const rows = hm > 0.6 ? [y + inset, y + h - inset] : [y + inset];
      const br = Math.max(0.8, 0.011 * ppm);
      for (const by of rows) {
        for (let i = 0; i <= n; i++) {
          const bx = x + inset + ((w - 2 * inset) * i) / n;
          if (rr() < 0.15) continue; // missing / painted-over bolt
          g.fillStyle = `rgba(70,46,30,${0.55 + 0.35 * a})`;
          g.beginPath(); g.arc(bx, by, br * 1.6, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(36,30,26,0.85)';
          g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
          if (rr() < 0.25 + 0.6 * a) {
            const len = Math.min(y + h - by, (0.05 + rr() * 0.45 * a + 0.05) * ppm);
            rustRun(g, rr, bx, by + br * 0.5, len, Math.max(1.2, (0.012 + rr() * 0.02) * ppm), 0.3 + 0.45 * a);
          } else if (rr() < 0.6) {
            const len = Math.min(y + h - by, (0.04 + rr() * 0.2) * ppm);
            const gr = g.createLinearGradient(0, by, 0, by + len);
            gr.addColorStop(0, `rgba(46,40,34,${0.2 + 0.3 * a})`); gr.addColorStop(1, 'rgba(46,40,34,0)');
            g.fillStyle = gr; g.fillRect(bx - br * 1.4, by, br * 2.8, len);
          }
        }
      }
    }
    // 6. flaked paint on old signs: patches along the edges showing primer or an older coat
    if (a > 0.55) {
      const nf = Math.round((w + h) / ppm * (a - 0.45) * 2.2);
      for (let i = 0; i < nf; i++) {
        const side = rr();
        const s = (0.012 + rr() * 0.05 * a) * ppm;
        const t = rr();
        let cx, cy;
        if (side < 0.4) { cx = x + t * w; cy = y + rr() * 0.04 * ppm; }
        else if (side < 0.7) { cx = x + t * w; cy = y + h - rr() * 0.04 * ppm; }
        else if (side < 0.85) { cx = x + rr() * 0.04 * ppm; cy = y + t * h; }
        else { cx = x + w - rr() * 0.04 * ppm; cy = y + t * h; }
        const col = rr();
        const fill = col < 0.45 ? 'rgba(138,74,48,0.85)' : col < 0.75 ? 'rgba(168,162,150,0.85)' : 'rgba(84,62,46,0.85)';
        const pts = 5 + Math.floor(rr() * 3);
        g.beginPath();
        for (let k = 0; k < pts; k++) {
          const ang = (k / pts) * Math.PI * 2, rad = s * (0.45 + rr() * 0.7);
          const px = cx + Math.cos(ang) * rad * 1.3, py = cy + Math.sin(ang) * rad * 0.8;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.strokeStyle = 'rgba(40,32,26,0.35)'; g.lineWidth = Math.max(0.6, s * 0.12); g.stroke();
        g.fillStyle = fill; g.fill();
      }
    }
  }
  g.restore();
}

/** Rustier grime texture for the steel/painted frame batches (own key; replaces signage/metal-grime). */
export function makeAgedMetal(rng) {
  const N = makeValueNoise(rng('signage/r05age/metal'), 128);
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  paintPixels(c.getContext('2d'), 256, 256, (u, v) => {
    const a = N.fbm(u * 4, v * 4, 4, 4);
    const rust = clamp01((N.fbm(u * 6 + 3, v * 6, 4, 6) - 0.42) * 2.2);
    const runs = clamp01((N.noise2(u * 48, v * 3, 48) - 0.55) * 2.5) * (0.5 + 0.5 * N.noise2(u * 48, v * 9 + 3, 48));
    const pit = N.noise2(u * 128, v * 128, 128) > 0.82 ? 0.18 : 0;
    const l = 0.66 + a * 0.32 - pit;
    const k = clamp01(rust * 0.6 + runs * 0.5);
    // grey steel / dirty paint -> dull brown oxide
    const rr = l * (1 - k) + k * (0.5 + a * 0.12), gg = l * (1 - k) + k * (0.36 + a * 0.08), bb = l * (1 - k) + k * (0.27 + a * 0.05);
    return [Math.min(255, rr * 255), Math.min(255, gg * 255), Math.min(255, bb * 255)];
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function ihash(n) {
  // integer PCG-style hash (same family as uhash in buildings/materials.js), 0..1
  let v = (Math.imul(n | 0, 747796405) + 2891336453) >>> 0;
  let w = Math.imul(((v >>> ((v >>> 28) + 4)) ^ v) >>> 0, 277803737) >>> 0;
  w = ((w >>> 22) ^ w) >>> 0;
  return (w >>> 8) / 16777216;
}

/**
 * Per-vertex tint for a frame batch: each ~0.7 m cell gets its own rust/dirt amount (linear colour).
 * strength: 1 for bare steel, ~0.5 for painted frames.
 */
export function ageBatchColours(batch, strength) {
  const p = batch.p, c = batch.c;
  const rust = [0.075, 0.042, 0.024]; // linear, a dull dark oxide brown
  for (let i = 0; i < batch.vc; i++) {
    const X = Math.floor(p[i * 3] / 0.7), Y = Math.floor(p[i * 3 + 1] / 0.7), Z = Math.floor(p[i * 3 + 2] / 0.7);
    const h1 = ihash(X * 73856093 ^ Y * 19349663 ^ Z * 83492791);
    const h2 = ihash((X * 73856093 ^ Y * 19349663 ^ Z * 83492791) + 1013904223);
    const k = strength * (0.08 + 0.42 * h1 * h1);
    const d = 1 - strength * (0.05 + 0.2 * h2);
    for (let j = 0; j < 3; j++) c[i * 3 + j] = (c[i * 3 + j] * (1 - k) + rust[j] * k) * d;
  }
}
