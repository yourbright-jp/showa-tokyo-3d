import { packCanvas } from './textures.js';
import { polygonCap, mulCol, hexToRgb } from './geom.js';
import { FAMILY, familyOf } from './style.js';
import { midRoof } from './roof.js';

// Mid/far level of detail: extruded footprints with procedurally painted window/shopfront
// textures (alpha = wall mask so the wall takes the building colour while glass stays glass).

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

/** Upper-floor texture: 4 bays x 2 floors, 512 x 512, style 0..4. */
function paintUpper(style, rand) {
  const W_ = 512, H = 512; const [c, g] = canvas(W_, H); const [m, gm] = canvas(W_, H);
  const fy = (yUp) => H - yUp; // texture y (up) -> canvas y
  g.fillStyle = '#dcd9d2'; g.fillRect(0, 0, W_, H);
  // vertical run-off streaks over the whole wall
  for (let i = 0; i < 140; i++) { const x = rand() * W_, y = rand() * H, l = 30 + rand() * 200; const gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(90,86,80,0.28)'); gr.addColorStop(1, 'rgba(90,86,80,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + rand() * 4, l); }
  gm.fillStyle = '#fff'; gm.fillRect(0, 0, W_, H);
  // wall noise
  for (let i = 0; i < 2600; i++) { const v = 200 + rand() * 40; g.fillStyle = `rgba(${v},${v},${v - 4},0.25)`; g.fillRect(rand() * W_, rand() * H, 2 + rand() * 6, 2 + rand() * 6); }
  const bay = W_ / 4, fl = H / 2; const ppm = fl / 3.2;
  const glass = (x, y, w, h) => {
    const gr = g.createLinearGradient(0, fy(y), 0, fy(y + h));
    gr.addColorStop(0, 'rgb(30,36,40)'); gr.addColorStop(1, 'rgb(70,80,86)');
    g.fillStyle = gr; g.fillRect(x, fy(y + h), w, h);
    gm.fillStyle = '#000'; gm.fillRect(x - 2, fy(y + h) - 2, w + 4, h + 4);
    // curtains / blinds
    const k = rand();
    if (k < 0.35) { g.fillStyle = rand() < 0.5 ? 'rgba(226,214,186,0.95)' : 'rgba(205,190,160,0.95)'; const cw = w * (0.2 + rand() * 0.3); g.fillRect(x, fy(y + h), cw, h); if (rand() < 0.6) g.fillRect(x + w - cw * 0.8, fy(y + h), cw * 0.8, h); }
    else if (k < 0.5) { g.fillStyle = 'rgba(220,222,216,0.9)'; const bh = h * (0.3 + rand() * 0.5); g.fillRect(x, fy(y + h), w, bh); g.fillStyle = 'rgba(120,120,116,0.5)'; for (let yy = 0; yy < bh; yy += 4) g.fillRect(x, fy(y + h) + yy, w, 1); }
    else if (k < 0.58) { g.fillStyle = 'rgba(230,232,228,0.85)'; g.fillRect(x, fy(y + h), w, h); }
    // frame
    g.strokeStyle = 'rgb(190,192,190)'; g.lineWidth = 2.5; g.strokeRect(x, fy(y + h), w, h);
  };
  const sill = (x, w, y) => { g.fillStyle = '#e2e0da'; g.fillRect(x - 3, fy(y), w + 6, 4); for (let i = 0; i < 3; i++) { const sx = x + rand() * w; const gr = g.createLinearGradient(0, fy(y), 0, fy(y - 40 - rand() * 60)); gr.addColorStop(0, 'rgba(90,86,80,0.45)'); gr.addColorStop(1, 'rgba(90,86,80,0)'); g.fillStyle = gr; g.fillRect(sx, fy(y), 2 + rand() * 4, 40 + rand() * 60); } };
  for (let f = 0; f < 2; f++) {
    const y0 = f * fl; const sillY = y0 + 0.92 * ppm, headY = y0 + 2.7 * ppm;
    if (style === 1 || style === 4) {
      glass(6, sillY, W_ - 12, headY - sillY);
      for (let x = 6; x < W_ - 6; x += 32) { g.fillStyle = 'rgb(180,182,180)'; g.fillRect(x, fy(headY), 3, headY - sillY); }
      sill(6, W_ - 12, sillY);
      if (style === 4) for (let x = 0; x < W_; x += 64) { g.fillStyle = '#f0eee8'; g.fillRect(x, 0, 9, H); g.fillStyle = 'rgba(80,78,74,0.5)'; g.fillRect(x + 9, 0, 5, H); gm.fillStyle = '#fff'; gm.fillRect(x, 0, 14, H); }
      g.fillStyle = 'rgba(70,68,64,0.25)'; g.fillRect(0, fy(sillY - 2), W_, 0.4 * ppm);
    } else {
      for (let bI = 0; bI < 4; bI++) {
        const x0 = bI * bay;
        if (style === 2) { g.fillStyle = '#d8d6d0'; g.fillRect(x0, 0, 14, H); g.fillStyle = 'rgba(60,58,55,0.35)'; g.fillRect(x0 + 14, 0, 5, H); }
        const ww = style === 0 ? bay * (0.5 + rand() * 0.25) : style === 2 ? bay - 30 : bay * 0.6;
        const x = x0 + (bay - ww) / 2 + (style === 2 ? 8 : 0);
        const top = style === 3 ? y0 + 2.6 * ppm : headY;
        const bot = style === 3 ? y0 + 0.15 * ppm : sillY;
        glass(x, bot, ww, top - bot);
        if (ww > 60) { g.fillStyle = 'rgb(180,182,180)'; g.fillRect(x + ww / 2 - 1, fy(top), 3, top - bot); }
        if (style === 3) { g.fillStyle = 'rgba(60,64,62,0.9)'; g.fillRect(x0 + 4, fy(y0 + 1.1 * ppm), bay - 8, 3); for (let xx = x0 + 6; xx < x0 + bay - 6; xx += 7) g.fillRect(xx, fy(y0 + 1.1 * ppm), 1.5, 0.95 * ppm); gm.fillStyle = '#000'; gm.fillRect(x0 + 4, fy(y0 + 1.1 * ppm), bay - 8, 1.0 * ppm); }
        else sill(x, ww, bot);
      }
    }
    // floor band
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, fy(y0 + 0.12 * ppm), W_, 0.12 * ppm);
    g.fillStyle = 'rgba(60,58,54,0.18)'; g.fillRect(0, fy(y0), W_, 3);
  }
  return packCanvas(c, m, { worldW: 1, worldH: 1 });
}

/** Ground-floor texture: 4 shop bays, 1024 x 256 (3.2 m tall). */
function paintGround(rand) {
  const W_ = 1024, H = 256; const [c, g] = canvas(W_, H); const [m, gm] = canvas(W_, H);
  const ppm = H / 3.2; const fy = (y) => H - y;
  g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, W_, H); gm.fillStyle = '#fff'; gm.fillRect(0, 0, W_, H);
  const bay = W_ / 4;
  const goods = ['#c23a2c', '#d8b020', '#2d5fa0', '#3c8a4a', '#e8e4dc', '#e07a28', '#b84870', '#40a0b0'];
  for (let i = 0; i < 4; i++) {
    const x0 = i * bay + 14, w = bay - 28; const y0 = 0.05 * ppm, y1 = 2.75 * ppm;
    gm.fillStyle = '#000'; gm.fillRect(x0, fy(y1), w, y1 - y0);
    // interior
    const gr = g.createLinearGradient(0, fy(y1), 0, fy(y0)); gr.addColorStop(0, '#4a4640'); gr.addColorStop(1, '#2a2622');
    g.fillStyle = gr; g.fillRect(x0, fy(y1), w, y1 - y0);
    g.fillStyle = 'rgba(240,244,240,0.9)'; g.fillRect(x0 + 10, fy(y1 - 6), w - 20, 3);
    for (let s = 0; s < 4; s++) { const sy = y0 + 0.4 * ppm + s * 0.42 * ppm; for (let x = x0 + 6; x < x0 + w - 6; x += 4 + rand() * 8) { g.fillStyle = goods[Math.floor(rand() * goods.length)]; g.globalAlpha = 0.6; g.fillRect(x, fy(sy + 6 + rand() * 18), 3 + rand() * 5, 8 + rand() * 14); } }
    g.globalAlpha = 1;
    const k = rand();
    if (k < 0.45) { // shutter partly down
      const sb = y1 - (0.4 + rand() * 1.4) * ppm;
      g.fillStyle = '#b4b6b2'; g.fillRect(x0, fy(y1), w, y1 - sb);
      g.fillStyle = 'rgba(80,80,78,0.5)'; for (let y = sb; y < y1; y += 5) g.fillRect(x0, fy(y), w, 1);
    } else if (k < 0.75) { // glazed with frames
      g.fillStyle = 'rgba(120,140,150,0.25)'; g.fillRect(x0, fy(y1), w, y1 - y0);
      g.fillStyle = '#c8cccc'; for (let x = x0; x <= x0 + w; x += w / 3) g.fillRect(x - 2, fy(y1), 4, y1 - y0);
      g.fillRect(x0, fy(2.05 * ppm), w, 4);
    }
    // shutter box / head
    g.fillStyle = '#b8b4ac'; g.fillRect(x0 - 4, fy(y1 + 0.3 * ppm), w + 8, 0.3 * ppm); gm.fillStyle = '#fff'; gm.fillRect(x0 - 4, fy(y1 + 0.3 * ppm), w + 8, 0.3 * ppm);
  }
  g.fillStyle = '#5a5650'; g.fillRect(0, fy(0.12 * ppm), W_, 0.12 * ppm); gm.fillStyle = '#000'; gm.fillRect(0, fy(0.12 * ppm), W_, 0.12 * ppm);
  return packCanvas(c, m, { worldW: 1, worldH: 1 });
}

export function makeMidTextures(rand) {
  return { up0: paintUpper(0, rand), up1: paintUpper(1, rand), up2: paintUpper(2, rand), up3: paintUpper(3, rand), up4: paintUpper(4, rand), ground: paintGround(rand) };
}

/** Mid/far building: textured prism + roof cap (+ simple rooftop boxes when mid). */
export function buildMid(env, b, far) {
  const ctx = env.ctx;
  const r = ctx.rng(`buildings/mid/${b.id}`);
  const plan = env.plans.get(b.id);
  const S = env.styleOf(b);
  const metas = new Map((env.data.facadesByBuilding.get(b.id) || []).map((f) => [f.index, f]));
  const fam = FAMILY[familyOf(b)];
  const tint = mulCol(S.colour, 1.0);
  const groundTint = S.groundColour;
  const styleKey = ['up0', 'up1', 'up2', 'up3', 'up4'][{ punched: 0, ribbon: 1, grid: 2, balcony: 3, fins: 4, blank: 0 }[S.win] ?? 0];
  const Bu = env.B(`mid:${styleKey}`), Bg = env.B('mid:ground');
  const base = b.baseY, gfTop = base + plan.groundFloorH, top = b.topY;
  const ufh = plan.upperFloorH;
  const bayW = r.range(2.0, 3.4), gBay = r.range(3.2, 4.6);
  const ou = r.range(0, 4), ov = r.int(0, 1) * 0.5;
  const fp = b.footprint;
  const yBot = base - 0.4;
  let acc = 0;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const dx = c[0] - a[0], dz = c[1] - a[1]; const L = Math.hypot(dx, dz); if (L < 0.02) continue;
    const n = [dz / L, 0, -dx / L];
    const meta = metas.get(i);
    const windowed = meta ? (meta.streetFacing || meta.openDistance > 6) : false;
    const u0 = acc, u1 = acc + L; acc += L;
    const P = (p, y) => [p[0], y, p[1]];
    const shade = (y) => mulCol(tint, 0.86 + 0.12 * Math.min(1, (y - base) / Math.max(1, top - base)));
    if (windowed) {
      Bg.quad([P(a, yBot), P(c, yBot), P(c, gfTop), P(a, gfTop)], n,
        [[u0 / (4 * gBay), (yBot - base) / 3.2], [u1 / (4 * gBay), (yBot - base) / 3.2], [u1 / (4 * gBay), 1], [u0 / (4 * gBay), 1]],
        [mulCol(groundTint, 0.8), mulCol(groundTint, 0.8), groundTint, groundTint]);
      const v0 = ov, v1 = ov + (top - gfTop) / (2 * ufh);
      Bu.quad([P(a, gfTop), P(c, gfTop), P(c, top), P(a, top)], n,
        [[u0 / (4 * bayW) + ou, v0], [u1 / (4 * bayW) + ou, v0], [u1 / (4 * bayW) + ou, v1], [u0 / (4 * bayW) + ou, v1]],
        [shade(gfTop), shade(gfTop), shade(top), shade(top)]);
    } else {
      // blank wall: sample the spandrel (wall-only) rows of the texture
      Bu.quad([P(a, yBot), P(c, yBot), P(c, top), P(a, top)], n,
        [[u0 / (4 * bayW) + ou, 0.015], [u1 / (4 * bayW) + ou, 0.015], [u1 / (4 * bayW) + ou, 0.085], [u0 / (4 * bayW) + ou, 0.085]],
        [mulCol(S.sideColour, 0.78), mulCol(S.sideColour, 0.78), mulCol(S.sideColour, 0.9), mulCol(S.sideColour, 0.9)]);
    }
  }
  polygonCap(env.B('roof'), fp, top, mulCol(hexToRgb(fam.mid), 0.55));
  if (!far) midRoof(env, b, { roofY: top }, S, r);
}
