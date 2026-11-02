import * as THREE from 'three';
import {
  Bucket, edgeFrame, boxMinMax, boxGeo, cylGeo, quadGeo, normGeo, wallWithHoles, revealGeo, FacadePainter, facadeQuad,
  makeCanvas, toTexture, noiseCanvas, rgbStr, lin2srgb, weather, prismGeo, ringArea, insetRing,
} from './kit.js';
import { letterGeometry, textNodeMatrix } from './letters.js';

// Shared builder for the three adopted theatre fronts (Koma, Toho Kaikan, Milano-za).
// Local facade space: x = baseline (reading direction), y = height above the building base,
// z = outward from the adopted frontage line. The adopted r03 placements are reproduced:
// wall face at z = 0.16, letters with front face at z = 0.27 (names) / 0.32 (入口),
// canopy from the wall to z = depth + 0.12, steps from z = 0.22 outward.

export const WALL_Z = 0.16;

// ------------------------------------------------------------------ shared textures

let shared = null;
export function theatreShared(ctx, kit) {
  if (shared && shared.ctx === ctx) return shared;
  const rng = ctx.rng('landmarks/theatre-shared');
  const nMottle = noiseCanvas(rng, 256, 6, 6, 5, 1.5);
  const nFine = noiseCanvas(rng, 256, 32, 32, 3, 1.6);
  const nStreak = noiseCanvas(rng, 256, 48, 3, 3, 1.8);
  const S = { ctx, nMottle, nFine, nStreak };

  // tileable concrete (2 m tile) for reveals, copings, sills, side returns
  S.concreteTex = (() => {
    const c = makeCanvas(512, 512); const g = c.getContext('2d');
    g.fillStyle = '#c9c8c0'; g.fillRect(0, 0, 512, 512);
    const pat = (nc, s, a, mode) => { g.save(); g.globalAlpha = a; g.globalCompositeOperation = mode; const p = g.createPattern(nc, 'repeat'); p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0])); g.fillStyle = p; g.fillRect(0, 0, 512, 512); g.restore(); };
    pat(nMottle, 2, 0.4, 'overlay'); pat(nFine, 1, 0.25, 'overlay'); pat(nFine, 0.5, 0.2, 'multiply');
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rng() < 0.5 ? '60,58,52' : '235,232,224'},${0.15 + rng() * 0.3})`; g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 2, 1 + rng() * 2); }
    return toTexture(c, { repeat: [0.5, 0.5] });
  })();
  // granite / terrazzo plinth (1 m tile)
  S.graniteTex = (() => {
    const c = makeCanvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#5d5b57'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) { const v = rng(); g.fillStyle = v < 0.4 ? 'rgba(30,29,28,0.8)' : v < 0.75 ? 'rgba(150,146,138,0.7)' : 'rgba(200,196,188,0.6)'; g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2.2, 1 + rng() * 2.2); }
    return toTexture(c, { repeat: [1, 1] });
  })();
  // terrazzo for steps/lobby floors (1 m tile)
  S.terrazzoTex = (() => {
    const c = makeCanvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#a9a69d'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = rng(); g.fillStyle = v < 0.3 ? 'rgba(70,68,62,0.7)' : v < 0.6 ? 'rgba(190,185,172,0.8)' : v < 0.8 ? 'rgba(140,120,100,0.6)' : 'rgba(230,228,220,0.8)'; const r = 0.8 + rng() * 2.8; g.beginPath(); g.arc(rng() * 256, rng() * 256, r, 0, 7); g.fill(); }
    g.save(); g.globalAlpha = 0.3; g.globalCompositeOperation = 'multiply'; const p = g.createPattern(nMottle, 'repeat'); g.fillStyle = p; g.fillRect(0, 0, 256, 256); g.restore();
    return toTexture(c, { repeat: [1, 1] });
  })();
  // roofing (bitumen + gravel), 2 m tile
  S.roofTex = (() => {
    const c = makeCanvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#55524c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rng() < 0.5 ? '30,30,28' : '120,116,108'},${0.3 + rng() * 0.4})`; g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2); }
    g.save(); g.globalAlpha = 0.45; g.globalCompositeOperation = 'overlay'; const p = g.createPattern(nMottle, 'repeat'); g.fillStyle = p; g.fillRect(0, 0, 256, 256); g.restore();
    return toTexture(c, { repeat: [0.5, 0.5] });
  })();
  // neutral, non-figurative poster atlas (4 x 2 cells): colour fields, stripes, circles; no text, no faces
  S.posterTex = (() => {
    const W = 1024, H = 768; const c = makeCanvas(W, H); const g = c.getContext('2d');
    const palettes = [
      ['#e8e1cf', '#c2412f', '#2d4c6b', '#e3b13f'], ['#d9d4c3', '#3f6d5a', '#d58a3a', '#262626'],
      ['#efe9da', '#8a2f3b', '#c9b48a', '#4a5f7a'], ['#d6dfe2', '#24476b', '#e0623c', '#f2e2b0'],
      ['#f0e6cc', '#5b3d6e', '#e1a33b', '#9cb4a8'], ['#e4ddd0', '#b3392d', '#1f1f1f', '#d8c28c'],
      ['#dcd8cc', '#4f7591', '#e8c35a', '#a83b2e'], ['#ece4d4', '#6c8a3c', '#d36b3f', '#33465e'],
    ];
    for (let k = 0; k < 8; k++) {
      const cx = (k % 4) * 256, cy = Math.floor(k / 4) * 384; const pal = palettes[k];
      g.save(); g.beginPath(); g.rect(cx, cy, 256, 384); g.clip();
      g.fillStyle = pal[0]; g.fillRect(cx, cy, 256, 384);
      const style = k % 4;
      const R = (a, b) => a + (b - a) * rng();
      if (style === 0) { // horizon composition: two washes and a low band
        let gr = g.createLinearGradient(cx, cy, cx, cy + 250); gr.addColorStop(0, pal[3]); gr.addColorStop(1, pal[0]); g.fillStyle = gr; g.fillRect(cx, cy, 256, 250);
        gr = g.createLinearGradient(cx, cy + 250, cx, cy + 384); gr.addColorStop(0, pal[2]); gr.addColorStop(1, pal[1]); g.fillStyle = gr; g.fillRect(cx, cy + 250, 256, 134);
        g.fillStyle = pal[1]; g.fillRect(cx + R(20, 60), cy + R(150, 190), R(60, 120), R(50, 80));
      } else if (style === 1) { // collage of rectangles
        for (let i = 0; i < 6; i++) { g.fillStyle = pal[1 + (i % 3)]; g.globalAlpha = R(0.55, 0.9); g.fillRect(cx + R(0, 180), cy + R(0, 320), R(50, 140), R(40, 150)); }
        g.globalAlpha = 1;
      } else if (style === 2) { // diagonal split
        const gr = g.createLinearGradient(cx, cy, cx + 256, cy + 384); gr.addColorStop(0, pal[2]); gr.addColorStop(1, pal[1]); g.fillStyle = gr;
        g.beginPath(); g.moveTo(cx, cy + 384); g.lineTo(cx + 256, cy + R(40, 140)); g.lineTo(cx + 256, cy + 384); g.fill();
        g.fillStyle = pal[3]; g.fillRect(cx + 24, cy + 24, 208, 18);
      } else { // vertical bands with soft edges
        for (let i = 0; i < 5; i++) { const gr = g.createLinearGradient(cx + i * 52, 0, cx + i * 52 + 52, 0); gr.addColorStop(0, pal[1 + (i % 3)]); gr.addColorStop(1, pal[0]); g.fillStyle = gr; g.fillRect(cx + i * 52, cy + R(30, 120), 46, R(160, 300)); }
      }
      // brushy paint texture
      g.globalAlpha = 0.22; g.globalCompositeOperation = 'overlay'; { const p = g.createPattern(nStreak, 'repeat'); g.fillStyle = p; g.fillRect(cx, cy, 256, 384); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      // paper ageing and sun fading
      g.globalAlpha = 0.12; g.fillStyle = '#d9d2c0'; g.fillRect(cx, cy, 256, 384);
      g.globalAlpha = 0.18; g.globalCompositeOperation = 'multiply'; const p = g.createPattern(nMottle, 'repeat'); g.fillStyle = p; g.fillRect(cx, cy, 256, 384);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.restore();
    }
    return toTexture(c);
  })();
  // billboard atlas (2 x 4 cells, 2:1): pasted paper sheets with abstract painted washes; no text/faces/emblems
  S.billboardTex = (() => {
    const W = 1024, H = 1024; const c = makeCanvas(W, H); const g = c.getContext('2d');
    const pals = [['#e9e2d0', '#b8452f', '#38556e', '#e0b54a'], ['#dfe3dc', '#4a6b52', '#d9893c', '#2e2e30'], ['#efe6d2', '#7d3346', '#c7ae7c', '#4b6584'],
      ['#e2dccb', '#2f5878', '#d9603e', '#f0dca8'], ['#ece2c8', '#5d4470', '#dba23c', '#8fae9e'], ['#e6ded0', '#a5382c', '#232323', '#d0bb86'],
      ['#dedad0', '#4c7290', '#e4bf58', '#a33c30'], ['#ebe3d1', '#647f3a', '#cf6a3e', '#34465a']];
    for (let k = 0; k < 8; k++) {
      const x0 = (k % 2) * 512, y0 = Math.floor(k / 2) * 256; const pal = pals[k];
      g.save(); g.beginPath(); g.rect(x0, y0, 512, 256); g.clip();
      g.fillStyle = pal[0]; g.fillRect(x0, y0, 512, 256);
      g.globalAlpha = 0.35; g.fillStyle = pal[2]; g.fillRect(x0, y0, 512, 256); g.globalAlpha = 1;
      for (let i = 0; i < 5; i++) {
        const gx = x0 + rng() * 420, gy = y0 + rng() * 200, gw = 120 + rng() * 260, gh = 60 + rng() * 160;
        const gr = g.createLinearGradient(gx, gy, gx + gw, gy + gh); gr.addColorStop(0, pal[1 + (i % 3)]); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.7 + rng() * 0.3; g.fillStyle = gr;
        g.beginPath(); g.moveTo(gx, gy + gh * rng()); g.lineTo(gx + gw, gy); g.lineTo(gx + gw * (0.7 + rng() * 0.3), gy + gh); g.lineTo(gx + gw * rng() * 0.3, gy + gh); g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = pal[1 + (k % 3)]; g.fillRect(x0, y0 + 220 + rng() * 20, 512, 14 + rng() * 10);
      g.globalAlpha = 0.25; g.globalCompositeOperation = 'overlay'; { const p = g.createPattern(nStreak, 'repeat'); g.fillStyle = p; g.fillRect(x0, y0, 512, 256); }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      // paper sheet seams, fading, grime under the top frame
      for (let i = 1; i < 6; i++) { g.fillStyle = 'rgba(80,72,60,0.22)'; g.fillRect(x0 + i * 512 / 6, y0, 1.5, 256); }
      for (let i = 1; i < 3; i++) { g.fillStyle = 'rgba(80,72,60,0.18)'; g.fillRect(x0, y0 + i * 256 / 3, 512, 1.5); }
      g.globalAlpha = 0.1; g.fillStyle = '#ddd5c2'; g.fillRect(x0, y0, 512, 256); g.globalAlpha = 1;
      const gr2 = g.createLinearGradient(0, y0, 0, y0 + 60); gr2.addColorStop(0, 'rgba(60,54,44,0.35)'); gr2.addColorStop(1, 'rgba(60,54,44,0)'); g.fillStyle = gr2; g.fillRect(x0, y0, 512, 60);
      for (let i = 0; i < 4; i++) { const tx = x0 + rng() * 500, ty = y0 + rng() * 240; g.fillStyle = 'rgba(235,230,215,0.9)'; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 8 + rng() * 20, ty + rng() * 6); g.lineTo(tx + rng() * 8, ty + 10 + rng() * 14); g.fill(); }
      g.restore();
    }
    return toTexture(c);
  })();
  // window interior atlas (8 x 2): dark rooms, curtains, blinds, a few lit
  S.windowTex = (() => {
    const W = 1024, H = 256; const c = makeCanvas(W, H); const g = c.getContext('2d');
    for (let k = 0; k < 16; k++) {
      const x0 = (k % 8) * 128, y0 = Math.floor(k / 8) * 128;
      const kind = [0, 2, 0, 4, 1, 0, 2, 0, 3, 0, 4, 2, 0, 1, 0, 2][k];
      g.fillStyle = ['#1c2224', '#222624', '#1a1e22', '#2a2a26', '#202424'][kind]; g.fillRect(x0, y0, 128, 128);
      if (kind === 1) { g.fillStyle = '#c9bfa8'; g.fillRect(x0, y0, 52, 128); g.fillRect(x0 + 90, y0, 38, 128); for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x0 + i * 6, y0, 2, 128); } }
      if (kind === 2) { for (let i = 0; i < 20; i++) { g.fillStyle = i % 2 ? '#b8b5a8' : '#9f9d92'; g.fillRect(x0, y0 + i * 4, 128, 3); } }
      if (kind === 3) { g.fillStyle = '#d8ccb0'; g.fillRect(x0, y0, 128, 128); g.fillStyle = 'rgba(80,70,50,0.25)'; for (let i = 0; i < 12; i++) g.fillRect(x0 + i * 11, y0, 3, 128); }
      if (kind === 4) { g.fillStyle = '#3a3a34'; g.fillRect(x0 + 10, y0 + 70, 108, 58); g.fillStyle = '#6b6658'; g.fillRect(x0 + 60, y0 + 30, 30, 40); }
      const gr = g.createLinearGradient(x0, y0, x0 + 128, y0 + 128);
      gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.05)');
      g.fillStyle = gr; g.fillRect(x0, y0, 128, 128);
    }
    return toTexture(c);
  })();
  // tileable precast panel texture (6.4 m tile; joints 3.2 m x 1.6 m) for side walls
  S.panelTex = (() => {
    const N = 512, ppm = N / 6.4; const c = makeCanvas(N, N); const g = c.getContext('2d');
    g.fillStyle = '#d2d1c9'; g.fillRect(0, 0, N, N);
    const pat = (nc, sc, a, mode) => { g.save(); g.globalAlpha = a; g.globalCompositeOperation = mode; const p = g.createPattern(nc, 'repeat'); p.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0])); g.fillStyle = p; g.fillRect(0, 0, N, N); g.restore(); };
    pat(nMottle, 2, 0.35, 'overlay'); pat(nFine, 0.6, 0.18, 'overlay');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) { g.fillStyle = rng() < 0.5 ? `rgba(70,66,58,${0.03 + rng() * 0.05})` : `rgba(255,252,240,${0.03 + rng() * 0.04})`; g.fillRect(i * 3.2 * ppm, j * 1.6 * ppm, 3.2 * ppm, 1.6 * ppm); }
    g.fillStyle = 'rgba(96,94,86,0.7)';
    for (let i = 0; i < 2; i++) g.fillRect(i * 3.2 * ppm, 0, 1.4, N);
    for (let j = 0; j < 4; j++) g.fillRect(0, j * 1.6 * ppm, N, 1.4);
    for (let j = 0; j < 4; j++) for (let k = 0; k < 10; k++) { const x = rng() * N, y = j * 1.6 * ppm + 2, len = 10 + rng() * 60; const gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, 'rgba(90,84,72,0.18)'); gr.addColorStop(1, 'rgba(90,84,72,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + rng() * 5, len); }
    return toTexture(c, { repeat: [1 / 6.4, 1 / 6.4] });
  })();
  S.mats = {};
  S.mat = (key, make) => (S.mats[key] || (S.mats[key] = make()));
  shared = S;
  return S;
}

// ------------------------------------------------------------------ facade builder

export class FacadeBuilder {
  constructor(ctx, kit, building, frontEdge, opts) {
    this.ctx = ctx; this.kit = kit; this.b = building;
    this.S = theatreShared(ctx, kit);
    this.F = edgeFrame(frontEdge[0], frontEdge[1], building.centroid, building.baseY);
    this.W = this.F.W;
    this.B = new Bucket();
    this.mats = {};
    this.opts = opts;
    this.rng = ctx.rng(`landmarks/${building.id}`);
  }
  add(key, geo) { return this.B.add(key, geo, this.F.matrix); }
  addWorld(key, geo) { return this.B.add(key, geo); }
  x(t) { return this.F.xOfT(t); }
  /** local position of an adopted text node */
  local(node) { return this.F.toLocal(...node.position_m); }

  /** dimensional letters on an adopted text node; standoff pins back to the wall plane */
  letters(node, { depth = 0.07, faceKey = 'letterFace', sideKey = 'letterSide', pins = true, px = 150, stroke = 4, weight = 'bold', font } = {}) {
    const L = letterGeometry(node.text, node.height_m, depth, { px, weight, stroke, font });
    const m = textNodeMatrix(node, 0);
    if (L.face) this.B.add(faceKey, L.face, m);
    if (L.side) this.B.add(sideKey, L.side, m);
    const loc = this.local(node);
    if (pins) {
      const back = loc.z - depth;
      if (back > WALL_Z + 0.005) {
        const n = Math.max(2, Math.round(L.width / 0.5));
        for (let i = 0; i < n; i++) {
          const xx = loc.x - L.width / 2 + (i + 0.5) * (L.width / n);
          for (const yy of [loc.y - node.height_m * 0.28, loc.y + node.height_m * 0.22]) {
            const g = cylGeo(0.008, 0.008, 0, back - WALL_Z + 0.01, 5, true); g.rotateX(Math.PI / 2); g.translate(xx, yy, WALL_Z - 0.005);
            this.add('steelDark', g);
          }
        }
      }
    }
    this.ctx.tag({ id: node.id, module: 'landmarks', tier: 'adopted-inferred', note: `${node.text}: dimensional letters at adopted text node (decision ${node.decision_id})` });
    return { L, loc };
  }

  /** window with reveal, steel frame, sill and interior-atlas glazing; opening h = {x0,x1,y0,y1} */
  windowUnit(h, { recess = 0.14, frame = 0.045, mullion = true, transom = false, sill = true, glassKey = 'winGlass', frameKey = 'steelDark', revealKey = 'concrete', cell = null } = {}) {
    const zf = WALL_Z, zb = WALL_Z - recess;
    this.add(revealKey, revealGeo(h, zb, zf));
    // frame (4 bars) and mullion
    const zf0 = zb + 0.01, zf1 = zb + 0.06;
    this.add(frameKey, boxMinMax(h.x0, h.y0, zf0, h.x1, h.y0 + frame, zf1));
    this.add(frameKey, boxMinMax(h.x0, h.y1 - frame, zf0, h.x1, h.y1, zf1));
    this.add(frameKey, boxMinMax(h.x0, h.y0, zf0, h.x0 + frame, h.y1, zf1));
    this.add(frameKey, boxMinMax(h.x1 - frame, h.y0, zf0, h.x1, h.y1, zf1));
    if (mullion) { const xm = (h.x0 + h.x1) / 2; this.add(frameKey, boxMinMax(xm - frame * 0.4, h.y0, zf0, xm + frame * 0.4, h.y1, zf1)); }
    if (transom) { const yt = h.y1 - (h.y1 - h.y0) * 0.3; this.add(frameKey, boxMinMax(h.x0, yt - frame * 0.4, zf0, h.x1, yt + frame * 0.4, zf1)); }
    // glazing with interior atlas uv
    const k = cell ?? Math.floor(this.rng() * 16);
    const u0 = (k % 8) / 8, v0 = 1 - (Math.floor(k / 8) + 1) / 2;
    const g = quadGeo([h.x0, h.y0, zb + 0.03], [h.x1, h.y0, zb + 0.03], [h.x1, h.y1, zb + 0.03], [h.x0, h.y1, zb + 0.03], 1 / 8, 1 / 2, [u0, v0]);
    this.add(glassKey, g);
    if (sill) this.add('concrete', boxMinMax(h.x0 - 0.06, h.y0 - 0.06, zb, h.x1 + 0.06, h.y0, zf + 0.055));
  }

  /** recessed glazed double door; opening h; door plane at zDoor (< WALL_Z) */
  door(h, { zDoor = -0.3, frameKey = 'steelDark', glassKey = 'doorGlass', revealKey = 'concrete', transomH = 0.5, pushBars = true } = {}) {
    this.add(revealKey, revealGeo(h, zDoor - 0.02, WALL_Z));
    const fw = 0.06, z0 = zDoor - 0.03, z1 = zDoor + 0.03;
    const yt = h.y1 - transomH;
    this.add(frameKey, boxMinMax(h.x0, h.y1 - fw, z0, h.x1, h.y1, z1));
    this.add(frameKey, boxMinMax(h.x0, yt - fw / 2, z0, h.x1, yt + fw / 2, z1));
    this.add(frameKey, boxMinMax(h.x0, h.y0, z0, h.x0 + fw, h.y1, z1));
    this.add(frameKey, boxMinMax(h.x1 - fw, h.y0, z0, h.x1, h.y1, z1));
    const xm = (h.x0 + h.x1) / 2;
    this.add(frameKey, boxMinMax(xm - fw * 0.6, h.y0, z0, xm + fw * 0.6, yt, z1));
    this.add(frameKey, boxMinMax(h.x0, h.y0, z0, h.x1, h.y0 + 0.16, z1)); // kick plates
    if (pushBars) for (const s of [-1, 1]) {
      const xx = xm + s * 0.12;
      this.add('brass', boxMinMax(xx - 0.015, h.y0 + 0.75, z1, xx + 0.015, h.y0 + 1.45, z1 + 0.05));
    }
    this.add(glassKey, quadGeo([h.x0, h.y0, zDoor], [h.x1, h.y0, zDoor], [h.x1, h.y1, zDoor], [h.x0, h.y1, zDoor], h.x1 - h.x0, h.y1 - h.y0));
  }

  /** wall-mounted poster showcase with lamp hood (neutral abstract poster from the atlas) */
  showcase(xc, y0, w, hgt, cell) {
    const z0 = WALL_Z, z1 = WALL_Z + 0.11, f = 0.045;
    const x0 = xc - w / 2, x1 = xc + w / 2, y1 = y0 + hgt;
    this.add('alu', boxMinMax(x0, y0, z0, x1, y0 + f, z1));
    this.add('alu', boxMinMax(x0, y1 - f, z0, x1, y1, z1));
    this.add('alu', boxMinMax(x0, y0, z0, x0 + f, y1, z1));
    this.add('alu', boxMinMax(x1 - f, y0, z0, x1, y1, z1));
    const u0 = (cell % 4) / 4, v0 = 1 - (Math.floor(cell / 4) % 2 + 1) / 2;
    this.add('poster', quadGeo([x0 + f, y0 + f, z0 + 0.02], [x1 - f, y0 + f, z0 + 0.02], [x1 - f, y1 - f, z0 + 0.02], [x0 + f, y1 - f, z0 + 0.02], 1 / 4, 1 / 2, [u0, v0]));
    this.add('caseGlass', quadGeo([x0 + f, y0 + f, z1 - 0.01], [x1 - f, y0 + f, z1 - 0.01], [x1 - f, y1 - f, z1 - 0.01], [x0 + f, y1 - f, z1 - 0.01], 1, 1));
    // lamp hood
    this.add('alu', boxMinMax(x0 + 0.1, y1 + 0.02, z0, x1 - 0.1, y1 + 0.09, z1 + 0.09));
  }

  /** cantilever canopy: slab, fascia, soffit downlights, top membrane, wall gutter */
  canopy(x0, x1, yU, thick, depthOut, { fasciaKey = 'canopyFascia', fasciaUp = 0.06, fasciaH = null, soffitKey = 'soffit', lights = 2, lightPitch = 1.8 } = {}) {
    const zf = depthOut + 0.12; // r03: canopy runs to depth + 0.12 from the frontage line
    const z0 = WALL_Z;
    this.add(soffitKey, boxMinMax(x0, yU, z0, x1, yU + thick, zf - 0.04));
    const fh = fasciaH ?? (thick + fasciaUp);
    this.add(fasciaKey, boxMinMax(x0 - 0.02, yU, zf - 0.05, x1 + 0.02, yU + fh, zf));
    this.add(fasciaKey, boxMinMax(x0 - 0.02, yU, z0, x0 + 0.03, yU + fh, zf));
    this.add(fasciaKey, boxMinMax(x1 - 0.03, yU, z0, x1 + 0.02, yU + fh, zf));
    this.add('steelDark', boxMinMax(x0, yU - 0.012, zf - 0.07, x1, yU + 0.01, zf - 0.05)); // drip edge
    this.add('roofing', boxMinMax(x0 + 0.03, yU + thick, z0, x1 - 0.03, yU + thick + 0.02, zf - 0.05));
    this.add('steelDark', boxMinMax(x0, yU + thick, z0, x1, yU + thick + 0.07, z0 + 0.1)); // wall gutter
    const lights0 = [];
    const n = Math.floor((x1 - x0) / lightPitch);
    for (let r = 0; r < lights; r++) {
      const zz = z0 + (zf - z0) * (r + 1) / (lights + 1);
      for (let i = 0; i < n; i++) {
        const xx = x0 + (i + 0.5) * ((x1 - x0) / n);
        const disc = new THREE.CircleGeometry(0.075, 10); disc.rotateX(Math.PI / 2); disc.translate(xx, yU - 0.004, zz);
        this.add('downlight', disc);
        const ring = new THREE.RingGeometry(0.075, 0.1, 10); ring.rotateX(Math.PI / 2); ring.translate(xx, yU - 0.003, zz);
        this.add('alu', ring);
        lights0.push([xx, zz]);
      }
    }
    return lights0;
  }

  /** stepped threshold boxes as in r03 (steps from z=0.22 outwards), with nosing and back extension */
  steps(xc, w, totalH, count, depthOut, { key = 'stepStone', backTo = -0.4 } = {}) {
    for (let j = 0; j < count; j++) {
      const h = totalH * (j + 1) / count;
      const d = depthOut * (count - j) / count;
      const zFront = d + 0.22;
      this.add(key, boxMinMax(xc - w / 2, Math.max(0, h - totalH / count) - 0.25, backTo, xc + w / 2, h, zFront));
      this.add('nosing', boxMinMax(xc - w / 2 + 0.02, h - 0.012, zFront - 0.06, xc + w / 2 - 0.02, h + 0.004, zFront + 0.004));
    }
  }

  /** vertical rain-water downpipe with brackets, from yTop to the ground */
  downpipe(x, yTop, z = WALL_Z + 0.08, r = 0.05) {
    const g = cylGeo(r, r, 0.05, yTop, 8, true); g.translate(x, 0, z); this.add('pipe', g);
    const shoe = cylGeo(r * 1.1, r * 1.3, 0.0, 0.18, 8); shoe.translate(x, 0, z); this.add('pipe', shoe);
    for (let y = 1.2; y < yTop - 0.3; y += 1.8) this.add('pipe', boxMinMax(x - 0.06, y, WALL_Z, x + 0.06, y + 0.04, z));
    const hopper = boxMinMax(x - 0.12, yTop - 0.35, WALL_Z, x + 0.12, yTop, z + 0.12); this.add('pipe', hopper);
  }

  build(materials, name) { return this.B.build(materials, name); }
}

// ------------------------------------------------------------------ materials

export function theatreMaterials(ctx, kit, { wallColorLin, metalLin, glassLin, baseY, topY }) {
  const S = theatreShared(ctx, kit);
  const night = kit.night;
  const metal = new THREE.Color().setRGB(...metalLin);
  const glass = new THREE.Color().setRGB(...glassLin);
  const W = (m, o) => weather(m, kit.macro, { baseY, topY, ...o });
  return {
    concrete: W(new THREE.MeshStandardMaterial({ map: S.concreteTex, color: new THREE.Color().setRGB(...wallColorLin).multiplyScalar(1.0), roughness: 0.88 }), { dirt: 0.25, streak: 0.12, mottle: 0.12 }),
    granite: W(new THREE.MeshStandardMaterial({ map: S.graniteTex, roughness: 0.5, metalness: 0.0 }), { dirt: 0.2, streak: 0.0, mottle: 0.05 }),
    stepStone: W(new THREE.MeshStandardMaterial({ map: S.terrazzoTex, color: 0xd8d4c8, roughness: 0.62 }), { baseY, dirtH: 0.5, dirt: 0.15, streak: 0, mottle: 0.14 }),
    nosing: new THREE.MeshStandardMaterial({ color: 0x4b4842, roughness: 0.55, metalness: 0.35 }),
    steelDark: new THREE.MeshStandardMaterial({ color: metal, roughness: 0.55, metalness: 0.45 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x9a9b96, roughness: 0.38, metalness: 0.75 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xa8894e, roughness: 0.32, metalness: 0.85 }),
    pipe: W(new THREE.MeshStandardMaterial({ color: 0x8c8c84, roughness: 0.6, metalness: 0.3 }), { dirt: 0.3, streak: 0.2, mottle: 0.15 }),
    roofing: new THREE.MeshStandardMaterial({ map: S.roofTex, roughness: 0.95 }),
    canopyFascia: W(new THREE.MeshStandardMaterial({ color: 0x8e8f88, roughness: 0.45, metalness: 0.5 }), { dirt: 0, streak: 0.25, mottle: 0.12 }),
    soffit: new THREE.MeshStandardMaterial({ color: 0xc8c6bc, roughness: 0.85 }),
    downlight: new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: new THREE.Color(1.0, 0.86, 0.62), emissiveIntensity: night ? 3.5 : 0.9, roughness: 0.4 }),
    winGlass: new THREE.MeshStandardMaterial({ map: S.windowTex, color: 0xffffff, roughness: 0.06, metalness: 0.25, envMapIntensity: 1.0 }),
    doorGlass: new THREE.MeshStandardMaterial({ color: glass.clone().multiplyScalar(0.5), roughness: 0.03, metalness: 0.5, transparent: true, opacity: 0.42, envMapIntensity: 1.0, depthWrite: false }),
    caseGlass: new THREE.MeshStandardMaterial({ color: 0xdfe6e4, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }),
    poster: new THREE.MeshStandardMaterial({ map: S.posterTex, roughness: 0.7, emissive: 0xffffff, emissiveMap: S.posterTex, emissiveIntensity: night ? 0.45 : 0.0 }),
    letterFace: new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.08, 0.085, 0.08), roughness: 0.4, metalness: 0.2 }),
    letterSide: new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.05, 0.05, 0.05), roughness: 0.55, metalness: 0.3 }),
    labelFace: new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.88, 0.87, 0.82), roughness: 0.4, emissive: new THREE.Color(0.88, 0.87, 0.82), emissiveIntensity: night ? 0.8 : 0.0 }),
    labelPlate: new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.45, metalness: 0.2 }),
    tank: W(new THREE.MeshStandardMaterial({ color: 0xa9aba4, roughness: 0.5, metalness: 0.55 }), { dirt: 0, streak: 0.3, mottle: 0.2 }),
    coolTower: W(new THREE.MeshStandardMaterial({ color: 0x6f8478, roughness: 0.6, metalness: 0.1 }), { dirt: 0, streak: 0.25, mottle: 0.2 }),
    serviceDoorRoof: new THREE.MeshStandardMaterial({ color: 0x55605a, roughness: 0.6, metalness: 0.3 }),
    louvre: new THREE.MeshStandardMaterial({ color: 0x8d8e88, roughness: 0.6, metalness: 0.35 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0xe6e2d4, roughness: 0.4 }),
  };
}

/** Lobby interior seen through glass doors: floor, ceiling with lamp discs, back wall. */
export function lobbyInterior(fb, x0, x1, y0, y1, zFront, depth, { wallTint = '#b9a27f', cells = 6 } = {}) {
  const ctx = fb.ctx; const rng = fb.rng;
  const W = x1 - x0, H = y1 - y0;
  const c = makeCanvas(1024, 128); const g = c.getContext('2d');
  g.fillStyle = wallTint; g.fillRect(0, 0, 1024, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,240,200,0.35)'); gr.addColorStop(0.6, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 128);
  for (let i = 0; i < cells; i++) {
    const cx = (i + 0.5) * 1024 / cells;
    g.fillStyle = '#3a2a22'; g.fillRect(cx - 34, 26, 68, 96); // inner doors
    g.fillStyle = 'rgba(255,230,180,0.6)'; g.fillRect(cx - 30, 30, 4, 4);
    const px = cx + 1024 / cells / 2;
    g.fillStyle = ['#c84a32', '#2f5470', '#d9b350', '#5a7a4a', '#7a3a52'][Math.floor(rng() * 5)]; g.fillRect(px - 22, 30, 44, 62);
    g.fillStyle = 'rgba(255,255,240,0.5)'; g.fillRect(px - 22, 30, 44, 8);
    g.fillStyle = '#8a7a5a'; g.fillRect(px - 26, 26, 52, 3);
  }
  const wallTex = toTexture(c);
  const cl = makeCanvas(256, 64); const gc = cl.getContext('2d');
  gc.fillStyle = '#6d6556'; gc.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { const gg = gc.createRadialGradient(16 + i * 32, 16 + j * 32, 0, 16 + i * 32, 16 + j * 32, 12); gg.addColorStop(0, '#fff6dc'); gg.addColorStop(0.35, '#f3dcaa'); gg.addColorStop(1, 'rgba(109,101,86,0)'); gc.fillStyle = gg; gc.fillRect(i * 32, j * 32, 32, 32); }
  const ceilTex = toTexture(cl, { repeat: [W / 8, 1] });
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
  const zb = zFront - depth;
  fb.add('lobbyWall', facadeQuad({ uv: (x, y) => [(x - x0) / W, (y - y0) / H] }, x0, y0, x1, y1, zb));
  fb.add('lobbyFloor', quadGeo([x0, y0 + 0.002, zFront], [x1, y0 + 0.002, zFront], [x1, y0 + 0.002, zb], [x0, y0 + 0.002, zb], W, depth, [0, 0], [0, 1, 0]));
  fb.add('lobbyCeil', quadGeo([x0, y1, zb], [x1, y1, zb], [x1, y1, zFront], [x0, y1, zFront], W / 8, 1, [0, 0], [0, -1, 0]));
  fb.add('lobbySide', quadGeo([x0, y0, zb], [x0, y0, zFront], [x0, y1, zFront], [x0, y1, zb], depth, H, [0, 0], [1, 0, 0]));
  fb.add('lobbySide', quadGeo([x1, y0, zFront], [x1, y0, zb], [x1, y1, zb], [x1, y1, zFront], depth, H, [0, 0], [-1, 0, 0]));
  const night = fb.kit.night;
  const S = fb.S;
  return {
    lobbyWall: { material: new THREE.MeshStandardMaterial({ map: wallTex, color: 0x333333, emissive: 0xffd9a8, emissiveMap: wallTex, emissiveIntensity: night ? 0.7 : 0.42, roughness: 0.8, envMapIntensity: 0.05 }), castShadow: false },
    lobbyFloor: { material: new THREE.MeshStandardMaterial({ map: S.terrazzoTex, color: 0x4a4238, roughness: 0.3, envMapIntensity: 0.08, emissive: 0x3a2a18, emissiveIntensity: 1 }), castShadow: false },
    lobbyCeil: { material: new THREE.MeshStandardMaterial({ map: ceilTex, emissive: 0xffffff, emissiveMap: ceilTex, emissiveIntensity: night ? 0.9 : 0.6, roughness: 0.9, envMapIntensity: 0.03, color: 0x222222 }), castShadow: false },
    lobbySide: { material: new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 0.8, envMapIntensity: 0.05, emissive: 0x3a2a18, emissiveIntensity: 1 }), castShadow: false },
  };
}

/**
 * Painted facade texture: panel joints, tone variation, streaks under sills/coping, splash dirt.
 * opts: { baseRgb (0..255), joints:{xs, ys}, sills:[{x0,x1,y}], coping:y, canopyTop:y, dirtH, ppm, stains }
 */
export function paintFacade(fb, x0, x1, y0, y1, o) {
  const S = fb.S; const rng = fb.ctx.rng(`landmarks/${fb.b.id}/paint/${o.key || 'front'}`);
  const P = new FacadePainter(x0, x1, y0, y1, o.ppm || 48, 2048);
  P.fill(o.baseRgb);
  P.noise(S.nMottle, 14, 0.09, 'overlay', [rng() * 5, rng() * 5]);
  P.noise(S.nFine, 1.2, 0.12, 'overlay');
  P.noise(S.nFine, 0.35, 0.08, 'multiply');
  // per-panel tone variation
  if (o.joints) {
    const xs = [x0, ...o.joints.xs.filter((x) => x > x0 && x < x1), x1].sort((a, b) => a - b);
    const ys = [y0, ...o.joints.ys.filter((y) => y > y0 && y < y1), y1].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const v = rng();
      P.rect(xs[i], ys[j], xs[i + 1], ys[j + 1], v < 0.5 ? `rgba(70,66,58,${0.012 + rng() * 0.03})` : `rgba(255,252,240,${0.012 + rng() * 0.025})`);
    }
    const jw = o.jointW ?? 0.016;
    for (const x of o.joints.xs) { P.line(x, y0, x, y1, [96, 94, 86], 0.75, jw); P.line(x + jw * 0.8, y0, x + jw * 0.8, y1, [255, 255, 248], 0.25, jw * 0.4); }
    for (const y of o.joints.ys) { P.line(x0, y, x1, y, [96, 94, 86], 0.7, jw); P.line(x0, y - jw * 0.8, x1, y - jw * 0.8, [255, 255, 248], 0.22, jw * 0.4); }
  }
  const dirtRgb = o.dirtRgb || [88, 82, 70];
  const age = o.age ?? 1;
  // streaks under sills (corner runs) and from joints
  for (const s of o.sills || []) {
    for (const xx of [s.x0 + 0.05, s.x1 - 0.05, (s.x0 + s.x1) / 2]) P.streak(xx + (rng() - 0.5) * 0.08, s.y, 0.6 + rng() * 2.2, 0.06 + rng() * 0.1, dirtRgb, (0.16 + rng() * 0.18) * age);
    P.streak((s.x0 + s.x1) / 2, s.y, 0.35, s.x1 - s.x0, dirtRgb, 0.12 * age);
  }
  if (o.coping !== undefined) { P.band(o.coping - 0.5, o.coping, dirtRgb, 0, 0.18 * age); P.streakRun(rng, x0, x1, o.coping, 0.3, 2.6 + age, 2.2 * age, dirtRgb, 0.22 * age); }
  if (o.joints) for (const y of o.joints.ys) P.streakRun(rng, x0, x1, y, 0.1, 0.9, 0.7 * age, dirtRgb, 0.1 * age);
  if (o.joints) for (const x of o.joints.xs) if (rng() < 0.6) P.streak(x, y1 - rng() * 0.5, (y1 - y0) * (0.2 + rng() * 0.6), 0.05 + rng() * 0.12, dirtRgb, 0.1 * age);
  if (o.canopyTop !== undefined) { P.rect(x0, o.canopyTop, x1, o.canopyTop + 0.07, 'rgba(70,64,54,0.35)'); P.band(o.canopyTop, o.canopyTop + 0.9, [92, 84, 70], 0.3, 0); }
  P.band(y0, y0 + (o.dirtH ?? 0.9), [74, 68, 58], 0.45, 0);
  if (o.shadeBelow !== undefined) { P.rect(x0, y0, x1, o.shadeBelow, 'rgba(84,78,66,0.10)'); P.band(o.shadeBelow - 0.8, o.shadeBelow, [70, 64, 54], 0.0, 0.16); }
  for (let i = 0; i < (o.stains ?? 18); i++) P.blotch(x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0), 0.2 + rng() * 0.9, 0.3 + rng() * 1.4, dirtRgb, 0.03 + rng() * 0.05);
  if (o.extra) o.extra(P, rng);
  return P;
}

/** Build simple walls (tiled weathered material) for all footprint edges except `skip` indices. */
export function massWalls(b, y0, y1, skip = new Set()) {
  const fp = b.footprint; const parts = [];
  let acc = 0;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (!skip.has(i)) parts.push(quadGeo([c[0], y0, c[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [c[0], y1, c[1]], L, y1 - y0, [acc, y0]));
    acc += L;
  }
  return parts;
}

/** Index of the footprint edge closest to/aligned with segment p-q. */
export function matchEdge(fp, p, q) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const d1 = Math.hypot(a[0] - p[0], a[1] - p[1]) + Math.hypot(c[0] - q[0], c[1] - q[1]);
    const d2 = Math.hypot(a[0] - q[0], a[1] - q[1]) + Math.hypot(c[0] - p[0], c[1] - p[1]);
    const d = Math.min(d1, d2);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Edge of footprint whose outward normal best matches dir and that is closest to point pt. */
export function frontEdgeIndex(fp, dir, pt) {
  let best = -1, bs = -Infinity;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const n = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L];
    const align = n[0] * dir[0] + n[1] * dir[1];
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const score = align * 10 - Math.hypot(mx - pt[0], mz - pt[1]) * 0.05;
    if (score > bs) { bs = score; best = i; }
  }
  return best;
}

/** Southern endpoint first (r03 convention: fraction t is measured from the southern pixel). */
export function southFirst(a, c) { return a[1] >= c[1] ? [a, c] : [c, a]; }

/** End returns of a clad front wall standing proud of the mass by z (local). */
export function edgeQuadReturns(fb, W, H, z = WALL_Z) {
  fb.add('concrete', quadGeo([-W / 2, 0, 0], [-W / 2, 0, z], [-W / 2, H, z], [-W / 2, H, 0], z, H, [0, 0], [-1, 0, 0]));
  fb.add('concrete', quadGeo([W / 2, 0, z], [W / 2, 0, 0], [W / 2, H, 0], [W / 2, H, z], z, H, [0, 0], [1, 0, 0]));
}

/** Coping around a roof edge + period rooftop plant (penthouse, water tank, cooling tower, vents, rod). */
export function rooftopKit(fb, b, frontIdx, { seed = 'roof', tank = true, tower = true, penthouse = true } = {}) {
  const rng = fb.ctx.rng(`landmarks/${b.id}/roof/${seed}`);
  const fp = b.footprint; const top = b.topY;
  // coping boxes along every edge
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const d = [(c[0] - a[0]) / L, (c[1] - a[1]) / L];
    const n = [d[1], -d[0]]; // outward for CCW
    const g = boxMinMax(-0.04, 0, -0.32, L + 0.04, 0.16, 0.05);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(d[0], 0, d[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], 0, n[1]));
    m.setPosition(a[0], top, a[1]);
    fb.addWorld('concrete', g.applyMatrix4(m));
  }
  // roof cap
  const s = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, -z)));
  const rg = new THREE.ShapeGeometry(s); rg.rotateX(-Math.PI / 2); rg.translate(0, top + 0.005, 0);
  { const pos = rg.attributes.position, uv = rg.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i)); }
  fb.addWorld('roofing', rg);
  // plant positioned in the front frame (local z negative = into the building)
  const F = fb.F; const W = F.W;
  const inside = (x, z, r) => { for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const w = F.toWorld(x + dx, 0, z + dz); if (!insidePolyXZ(w.x, w.z, fp)) return false; } return true; };
  const place = (x, z, r) => (inside(x, z, r) ? true : false);
  const H0 = top - F.baseY;
  if (penthouse) {
    const x = -W * 0.22 + rng() * 2, z = -9 - rng() * 3;
    if (place(x, z, 3)) {
      fb.add('massWall', boxMinMax(x - 2.4, H0, z - 1.8, x + 2.4, H0 + 3.0, z + 1.8));
      fb.add('concrete', boxMinMax(x - 2.5, H0 + 3.0, z - 1.9, x + 2.5, H0 + 3.15, z + 1.9));
      fb.add('serviceDoorRoof', boxMinMax(x + 0.6, H0 + 0.05, z + 1.8, x + 1.5, H0 + 2.1, z + 1.83));
      for (let k = 0; k < 9; k++) fb.add('steelDark', boxMinMax(x - 2.3, H0 + 0.3 + k * 0.3, z + 1.8, x - 1.9, H0 + 0.33 + k * 0.3, z + 1.95));
      for (const xx of [-2.3, -1.9]) fb.add('steelDark', boxMinMax(x + xx - 0.02, H0, z + 1.93, x + xx + 0.02, H0 + 3.6, z + 1.97));
      if (tank) {
        const ty = H0 + 3.15;
        for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) fb.add('steelDark', boxMinMax(x + dx - 0.05, ty, z + dz - 0.05, x + dx + 0.05, ty + 1.2, z + dz + 0.05));
        fb.add('steelDark', boxMinMax(x - 1.1, ty + 1.2, z - 1.1, x + 1.1, ty + 1.3, z + 1.1));
        const cyl = cylGeo(1.15, 1.15, ty + 1.3, ty + 3.2, 20); cyl.translate(x, 0, z); fb.add('tank', cyl);
        const cap = new THREE.SphereGeometry(1.15, 20, 6, 0, Math.PI * 2, 0, Math.PI * 0.22); cap.scale(1, 0.6, 1); cap.translate(x, ty + 3.2 - 0.05, z); fb.add('tank', cap);
      }
    }
  }
  if (tower) {
    const x = W * 0.18 + rng() * 2, z = -16 - rng() * 4;
    if (place(x, z, 2.2)) {
      fb.add('steelDark', boxMinMax(x - 1.6, H0, z - 1.6, x + 1.6, H0 + 0.5, z + 1.6));
      const c1 = cylGeo(1.5, 1.25, H0 + 0.5, H0 + 2.6, 20); c1.translate(x, 0, z); fb.add('coolTower', c1);
      const c2 = cylGeo(1.0, 1.0, H0 + 2.6, H0 + 3.0, 16, true); c2.translate(x, 0, z); fb.add('steelDark', c2);
    }
  }
  for (let k = 0; k < 6; k++) {
    const x = (rng() - 0.5) * W * 0.8, z = -4 - rng() * 20;
    if (!place(x, z, 1)) continue;
    const w = 0.5 + rng() * 1.2, h = 0.4 + rng() * 0.9, d = 0.5 + rng();
    fb.add(rng() < 0.5 ? 'massWall' : 'louvre', boxMinMax(x - w / 2, H0, z - d / 2, x + w / 2, H0 + h, z + d / 2));
  }
  // lightning rod near a front corner
  const rx = -W / 2 + 1.2, rz = -1.0;
  const rod = cylGeo(0.02, 0.012, H0 + 0.16, H0 + 4.2, 5); rod.translate(rx, 0, rz); fb.add('steelDark', rod);
  for (const a of [0, 2.1, 4.2]) fb.add('steelDark', boxMinMax(rx + Math.cos(a) * 0.4 - 0.01, H0 + 0.16, rz + Math.sin(a) * 0.4 - 0.01, rx + Math.cos(a) * 0.4 + 0.01, H0 + 1.4, rz + Math.sin(a) * 0.4 + 0.01));
}

function insidePolyXZ(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]; const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export { prismGeo, ringArea, insetRing, lin2srgb, rgbStr, boxMinMax, boxGeo, cylGeo, quadGeo, normGeo, wallWithHoles, revealGeo, facadeQuad, Bucket };
