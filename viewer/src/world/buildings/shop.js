import { W, box, rectN, reveals, mulCol, mixCol, hexToRgb } from './geom.js';
import { SHOP_INTERIOR_COLOURS, GOODS } from './style.js';

// Ground-floor shop bays: aluminium/steel glazing, roller shutters at various heights, columns,
// transoms, and recessed interior volumes (shelves, counters, racks, fluorescent lights).
// All generic; text-bearing signs belong to the signage module.

const IWALL = SHOP_INTERIOR_COLOURS.map((h) => hexToRgb(h).map((v) => v * 0.42));
const GOOD = GOODS.map((h) => hexToRgb(h).map((v) => v * 0.7));
const ALU = hexToRgb('#9a9e9e');
const STEEL_DARK = hexToRgb('#3e4240');
const WOOD = ['#7a5232', '#8e6440', '#5e3e26', '#a07850'].map(hexToRgb);
const KICK = ['#9a9c98', '#5a5650', '#c8c4b8', '#3c3a36', '#7c6a58'].map(hexToRgb);

const KIT_BY_TEXT = { 理容: 'barber', 麻雀: 'stair', 喫茶: 'kissa', 食堂: 'diner', 写真: 'photo', レコード: 'records' };

/** 2D oriented rectangle overlap (separating axis) for interior volumes of one building. */
function rectPoly(F, u0, u1, d0, d1) { return [W(F, u0, 0, d0), W(F, u1, 0, d0), W(F, u1, 0, d1), W(F, u0, 0, d1)].map((p) => [p[0], p[2]]); }
function overlap(A, B) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const a = P[i], c = P[(i + 1) % 4]; const nx = c[1] - a[1], nz = a[0] - c[0];
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of A) { const s = p[0] * nx + p[1] * nz; amin = Math.min(amin, s); amax = Math.max(amax, s); }
    for (const p of B) { const s = p[0] * nx + p[1] * nz; bmin = Math.min(bmin, s); bmax = Math.max(bmax, s); }
    if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
  }
  return true;
}

function layoutBays(S, L, r, wantStair, adoptedText) {
  const pL = Math.min(S.endPier[0], L * 0.15), pR = Math.min(S.endPier[1], L * 0.15);
  const usable = L - pL - pR;
  const bays = [];
  if (usable < 1.1) return { bays, pL, pR };
  let a = pL, bEnd = L - pR;
  const cw = r.range(0.25, 0.45);
  if (wantStair && usable > 5.5) {
    const sw = r.range(1.05, 1.5);
    if (S.stairSide) { bays.push({ u0: bEnd - sw, u1: bEnd, type: 'stair' }); bEnd -= sw + cw; }
    else { bays.push({ u0: a, u1: a + sw, type: 'stair' }); a += sw + cw; }
  }
  const span = bEnd - a;
  if (span > 1.0) {
    const n = Math.max(1, Math.round(span / S.bayW));
    const wts = Array.from({ length: n }, () => r.range(0.75, 1.25)); const tot = wts.reduce((s, x) => s + x, 0);
    let u = a; const free = span - cw * (n - 1);
    for (let i = 0; i < n; i++) {
      const w = free * wts[i] / tot;
      let type = (() => { const x = r(); return x < 0.32 ? 'open' : x < 0.62 ? 'glazed' : x < 0.8 ? 'half' : x < 0.88 ? 'closed' : 'glazed'; })();
      if (w < 1.3) type = r.chance(0.5) ? 'glazed' : 'closed';
      bays.push({ u0: u, u1: u + w, type });
      u += w + cw;
    }
  }
  // the adopted shop text sits over a working shopfront
  if (adoptedText) {
    const shops = bays.filter((x) => x.type !== 'stair');
    if (shops.length && !shops.some((x) => x.type === 'open' || x.type === 'glazed')) shops[0].type = 'glazed';
  }
  bays.sort((p, q) => p.u0 - q.u0);
  return { bays, pL, pR };
}

/** Distance from (u, just inside) inward along -n to the far side of the footprint. */
function inwardDepth(b, F, u) {
  const p = W(F, u, 0, -0.05); const ox = p[0], oz = p[2]; const dx = -F.nx, dz = -F.nz;
  let best = Infinity;
  const fp = b.footprint;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const ex = c[0] - a[0], ez = c[1] - a[1];
    const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - ox) * ez - (a[1] - oz) * ex) / den;
    const s = ((a[0] - ox) * dz - (a[1] - oz) * dx) / den;
    if (t > 0.02 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best;
}

export function buildShopBays(env, b, S, lv, F, meta, r, fc) {
  const L = F.L;
  const adopted = meta && meta.adoptedText ? meta.adoptedText.text : null;
  const kitHint = adopted ? KIT_BY_TEXT[adopted] : null;
  const near = !env.lite && (meta ? meta.routeDist < 32 : false);
  const wantStair = (S.stairBay && lv.floors >= 3) || kitHint === 'stair';
  const { bays } = layoutBays(S, L, r, wantStair, adopted);
  if (kitHint && meta.adoptedText.position_m) {
    const tp = meta.adoptedText.position_m;
    const tu = (tp[0] - F.ax) * F.tx + (tp[2] - F.az) * F.tz;
    let best = null, bd = Infinity;
    for (const bay of bays) {
      if ((kitHint === 'stair') !== (bay.type === 'stair')) continue;
      const dd = Math.abs((bay.u0 + bay.u1) / 2 - tu); if (dd < bd) { bd = dd; best = bay; }
    }
    if (best) { best.kit = kitHint; if (best.type === 'closed' || best.type === 'half') best.type = 'glazed'; }
  }
  const holes = [];
  const headZone = r.range(0.28, 0.5);
  const openTop = lv.gfTop - headZone;
  const Bp = env.B('paint'), Bs = env.B('sash'), Bg = env.B('shopGlass'), Bground = env.B(`wall:${S.groundClad}`);
  const R = fc.region;
  if (!env.interiors.has(b.id)) env.interiors.set(b.id, []);
  const placed = env.interiors.get(b.id);
  const pierD = S.pierD;
  let pierStart = 0;
  for (const bay of bays) {
    const uMid = (bay.u0 + bay.u1) / 2;
    const gy = env.groundAt(F, uMid);
    const floorY = Math.max(lv.base, gy + 0.03);
    const top = bay.type === 'stair' ? Math.min(openTop, floorY + 2.3) : openTop;
    if (top - floorY < 1.8) continue;
    const h = { u0: bay.u0, u1: bay.u1, y0: floorY, y1: top };
    holes.push(h);
    // pier facing between openings (stone/tile cladding, slight relief) with a darker plinth
    if (bay.u0 - pierStart > 0.05) {
      box(Bground, F, pierStart, bay.u0, lv.yBot, lv.gfTop - 0.12, 0, pierD, mulCol(S.groundColour, 0.97), { uvo: S.uvo, ex: fc.ex, skip: new Set(['back']) });
      box(Bp, F, pierStart - 0.005, bay.u0 + 0.005, lv.yBot, gy + r.range(0.12, 0.3), 0, pierD + 0.015, S.plinthColour, { ex: fc.ex, skip: new Set(['back']) });
    }
    pierStart = bay.u1;
    const revealDepth = 0.28;
    reveals(Bground, F, h, revealDepth, mulCol(S.groundColour, 0.85), { uvo: S.uvo, ex: fc.ex, noBottom: true });
    // threshold
    box(env.B('trim'), F, bay.u0, bay.u1, floorY - 0.12, floorY, -revealDepth, 0.0, hexToRgb('#8a8a84').map((v) => v * 0.6), { ex: fc.ex, skip: new Set(['back', 'bottom']) });
    if (R) {
      R.bandBelow(bay.u0 - 0.1, bay.u1 + 0.1, lv.gfTop - 0.1, 0.3, [70, 66, 60], 0.18);
      R.bandAbove(bay.u0 - 0.2, bay.u0, floorY, 0.8, [90, 80, 70], 0.25);
      R.bandAbove(bay.u1, bay.u1 + 0.2, floorY, 0.8, [90, 80, 70], 0.25);
    }

    // head zone: shutter box for shuttered bays, transom panel otherwise
    const hasShutter = bay.type !== 'stair' && (bay.type !== 'glazed' || r.chance(0.6));
    if (hasShutter) {
      box(Bp, F, bay.u0 - 0.04, bay.u1 + 0.04, top, Math.min(lv.gfTop - 0.14, top + 0.34), -0.02, 0.1 + r.range(0, 0.08), mulCol(S.shutterColour, 0.92), { ex: fc.ex });
      box(Bs, F, bay.u0, bay.u0 + 0.05, floorY, top, -0.1, -0.02, mulCol(S.shutterColour, 0.7), { skip: new Set(['back']) });
      box(Bs, F, bay.u1 - 0.05, bay.u1, floorY, top, -0.1, -0.02, mulCol(S.shutterColour, 0.7), { skip: new Set(['back']) });
    }
    let shutterBottom = top; // y of the shutter's bottom bar (top = fully raised)
    if (bay.type === 'closed') shutterBottom = floorY;
    else if (bay.type === 'half') shutterBottom = floorY + r.range(1.15, 1.85);
    else if (hasShutter && bay.type === 'open' && r.chance(0.25)) shutterBottom = top - r.range(0.2, 0.5);
    if (shutterBottom < top - 0.01) {
      const Bsh = env.B('shutter');
      rectN(Bsh, F, bay.u0 + 0.03, bay.u1 - 0.03, shutterBottom, top, -0.06, S.shutterColour, { uv: (q) => [q[0] + S.uvo[0], q[1]], ex: fc.ex });
      box(Bs, F, bay.u0 + 0.03, bay.u1 - 0.03, shutterBottom - 0.06, shutterBottom, -0.075, -0.04, mulCol(S.shutterColour, 0.6), {});
      // handle
      box(Bs, F, uMid - 0.08, uMid + 0.08, shutterBottom - 0.05, shutterBottom - 0.02, -0.04, -0.015, STEEL_DARK, {});
      if (R) for (let u = bay.u0; u < bay.u1; u += r.range(0.4, 1.2)) R.streak(u, top, r.range(0.3, 1.2), 0.1, [96, 90, 80], 0.15);
    }
    if (bay.type === 'closed') continue;

    // interior volume ---------------------------------------------------------------
    const cwHalf = 0.12;
    const iu0 = bay.u0 - cwHalf, iu1 = bay.u1 + cwHalf;
    const avail = Math.min(inwardDepth(b, F, bay.u0 + 0.1), inwardDepth(b, F, uMid), inwardDepth(b, F, bay.u1 - 0.1));
    let depth = Math.min(bay.type === 'stair' ? r.range(3, 5) : r.range(2.6, 5.5), avail - 0.4);
    let poly = null;
    for (let tries = 0; tries < 6 && depth > 0.9; tries++) {
      poly = rectPoly(F, iu0, iu1, -revealDepth, -revealDepth - depth);
      if (!placed.some((P) => overlap(P, poly))) break;
      depth *= 0.65; poly = null;
    }
    if (!poly || depth < 0.9) {
      // too shallow for a room: show a dark display niche behind glass
      depth = 0.6; poly = rectPoly(F, iu0, iu1, -revealDepth, -revealDepth - depth);
    }
    placed.push(poly);
    const d0 = -revealDepth, d1 = -revealDepth - depth;
    const yC = lv.gfTop - r.range(0.18, 0.32);
    const kit = bay.type === 'stair' ? 'stair' : (bay.kit || r.pick(['goods', 'goods', 'clothing', 'diner', 'kissa', 'records', 'office', 'photo', 'barber', 'goods']));
    interiorRoom(env, F, iu0, iu1, floorY, yC, d0, d1, kit, r, near);

    // storefront glazing ----------------------------------------------------------------
    const gd = -0.1;
    if (bay.type === 'glazed' || (bay.type === 'half' && r.chance(0.5)) || bay.type === 'stair') {
      const frame = S.alu ? ALU : mixCol(S.sashColour, ALU, 0.3);
      const fw = 0.055;
      const doorW = Math.min(bay.u1 - bay.u0 - 0.2, bay.type === 'stair' ? bay.u1 - bay.u0 - 0.15 : r.range(1.5, 1.9));
      const doorPos = bay.type === 'stair' ? 0.5 : r.pick([0.5, 0.5, 0.2, 0.8]);
      const dA = bay.u0 + (bay.u1 - bay.u0 - doorW) * doorPos, dB = dA + doorW;
      const doorHead = Math.min(top - 0.35, floorY + 2.05);
      const kick = r.range(0.28, 0.5);
      const kcol = r.pick(KICK);
      // perimeter
      box(Bs, F, bay.u0, bay.u1, top - fw, top, gd - 0.03, gd + 0.03, frame, {});
      box(Bs, F, bay.u0, bay.u0 + fw, floorY, top, gd - 0.03, gd + 0.03, frame, {});
      box(Bs, F, bay.u1 - fw, bay.u1, floorY, top, gd - 0.03, gd + 0.03, frame, {});
      if (doorHead < top - 0.2) box(Bs, F, bay.u0, bay.u1, doorHead, doorHead + 0.05, gd - 0.03, gd + 0.03, frame, {});
      // display windows either side of the door, on a kick plate
      const segs = [[bay.u0 + fw, dA], [dB, bay.u1 - fw]].filter(([p, q]) => q - p > 0.25);
      for (const [p, q] of segs) {
        box(Bs, F, p, q, floorY, floorY + kick, gd - 0.02, gd + 0.02, kcol, {});
        box(Bs, F, p, q, floorY + kick, floorY + kick + 0.045, gd - 0.03, gd + 0.03, frame, {});
        const nm = Math.max(1, Math.round((q - p) / r.range(1.1, 1.8)));
        for (let m = 1; m < nm; m++) { const um = p + (q - p) * m / nm; box(Bs, F, um - 0.022, um + 0.022, floorY + kick, doorHead, gd - 0.03, gd + 0.03, frame, {}); }
        rectN(Bg, F, p, q, floorY + kick + 0.045, doorHead, gd, [1, 1, 1]);
      }
      // door leaves (sliding pair) with stiles and push bars
      box(Bs, F, dA - 0.03, dA + 0.03, floorY, doorHead, gd - 0.03, gd + 0.03, frame, {});
      box(Bs, F, dB - 0.03, dB + 0.03, floorY, doorHead, gd - 0.03, gd + 0.03, frame, {});
      const dm = (dA + dB) / 2;
      const openDoor = r.chance(0.35);
      for (const [p, q, dz] of [[dA, dm, gd - 0.025], [dm, dB, gd + 0.015]]) {
        const sh = openDoor && dz > gd ? -(q - p) * 0.8 : 0;
        const a = p + sh, c = q + sh;
        box(Bs, F, a, a + 0.045, floorY + 0.02, doorHead - 0.01, dz - 0.015, dz + 0.015, frame, {});
        box(Bs, F, c - 0.045, c, floorY + 0.02, doorHead - 0.01, dz - 0.015, dz + 0.015, frame, {});
        box(Bs, F, a, c, floorY + 0.02, floorY + 0.12, dz - 0.015, dz + 0.015, frame, {});
        box(Bs, F, a, c, doorHead - 0.06, doorHead - 0.01, dz - 0.015, dz + 0.015, frame, {});
        rectN(Bg, F, a + 0.045, c - 0.045, floorY + 0.12, doorHead - 0.06, dz, [1, 1, 1]);
        box(Bs, F, (a + c) / 2 - 0.15, (a + c) / 2 + 0.15, floorY + 0.95, floorY + 0.98, dz + 0.015, dz + 0.04, frame, {});
      }
      // transom lights over the door head
      if (doorHead < top - 0.2) rectN(Bg, F, bay.u0 + fw, bay.u1 - fw, doorHead + 0.05, top - fw, gd, [1, 1, 1]);
    } else if (bay.type === 'open') {
      // fully open front: a low display shelf / goods at the threshold for some
      if (r.chance(0.5) && near) {
        const sh = r.range(0.5, 0.85);
        box(env.B('interior'), F, bay.u0 + 0.15, bay.u1 - 0.15, floorY, floorY + sh, d0 - 0.75, d0 - 0.15, r.pick(WOOD), {});
        goodsRow(env, F, bay.u0 + 0.2, bay.u1 - 0.2, floorY + sh, d0 - 0.7, d0 - 0.2, r, 0.16);
      }
    }
  }
  // last pier to the facade end
  if (L - pierStart > 0.05) {
    box(Bground, F, pierStart, L, lv.yBot, lv.gfTop - 0.12, 0, pierD, mulCol(S.groundColour, 0.97), { uvo: S.uvo, ex: fc.ex, skip: new Set(['back']) });
    const gy = env.groundAt(F, (pierStart + L) / 2);
    box(Bp, F, pierStart - 0.005, L, lv.yBot, gy + 0.2, 0, pierD + 0.015, S.plinthColour, { ex: fc.ex, skip: new Set(['back']) });
  }
  return holes;
}

function goodsRow(env, F, u0, u1, y, dA, dB, r, hMax) {
  const B = env.B('interior');
  let u = u0;
  while (u < u1 - 0.05) {
    const w = r.range(0.08, 0.3); const h = r.range(0.06, hMax);
    const c = r.pick(GOOD);
    box(B, F, u, Math.min(u1, u + w), y, y + h, dA + r.range(0, 0.1), dB - r.range(0, 0.1), mulCol(c, r.range(0.75, 1.05)), { skip: new Set(['bottom', 'back']) });
    u += w + r.range(0.0, 0.05);
  }
}

function shelfUnit(env, F, u0, u1, y0, y1, dA, dB, r, frameCol, dense = 1) {
  const B = env.B('interior');
  // uprights
  box(B, F, u0, u0 + 0.04, y0, y1, dA, dB, frameCol, { skip: new Set(['bottom']) });
  box(B, F, u1 - 0.04, u1, y0, y1, dA, dB, frameCol, { skip: new Set(['bottom']) });
  const n = Math.max(2, Math.round((y1 - y0) / 0.42));
  for (let i = 0; i <= n; i++) {
    const y = y0 + 0.08 + (i * (y1 - y0 - 0.1)) / n;
    box(B, F, u0 + 0.04, u1 - 0.04, y - 0.025, y, dA, dB, frameCol, { skip: new Set(['bottom']) });
    if (i < n && r.chance(0.92 * dense)) goodsRow(env, F, u0 + 0.06, u1 - 0.06, y, dA, dB, r, Math.min(0.34, (y1 - y0) / n - 0.06));
  }
}

/** The recessed room behind a shop opening, in facade coords (d0 > d1, both negative). */
function interiorRoom(env, F, u0, u1, yF, yC, d0, d1, kit, r, near) {
  const B = env.B('interior');
  const wall = r.pick(IWALL);
  const dark = mulCol(wall, 0.55);
  const t = [F.tx, 0, F.tz], n = [F.nx, 0, F.nz];
  const P = (u, y, d) => W(F, u, y, d);
  // floor (textured), ceiling, back wall, side walls with baked corner darkening
  // floor: vinyl / terrazzo tiles as a vertex-coloured checker (no extra texture program)
  const tileA = r.pick([[0.5, 0.48, 0.44], [0.42, 0.4, 0.36], [0.55, 0.5, 0.42], [0.36, 0.38, 0.36]]);
  const tileB = r.chance(0.6) ? mulCol(tileA, 0.62) : mulCol(tileA, 0.9);
  const ts = Math.max(r.pick([0.3, 0.3, 0.45]), Math.sqrt(((u1 - u0) * (d0 - d1)) / 110));
  const nu = Math.max(1, Math.round((u1 - u0) / ts)), nd = Math.max(1, Math.round((d0 - d1) / ts));
  if (near && nu * nd <= 130) {
    for (let i = 0; i < nu; i++) for (let j = 0; j < nd; j++) {
      const a0 = u0 + (u1 - u0) * i / nu, a1 = u0 + (u1 - u0) * (i + 1) / nu, b0 = d0 - (d0 - d1) * j / nd, b1 = d0 - (d0 - d1) * (j + 1) / nd;
      const c = mulCol((i + j) % 2 ? tileA : tileB, 1 - 0.35 * (j / nd));
      B.quad([P(a0, yF, b0), P(a1, yF, b0), P(a1, yF, b1), P(a0, yF, b1)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], c);
    }
  } else B.quad([P(u0, yF, d0), P(u1, yF, d0), P(u1, yF, d1), P(u0, yF, d1)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [tileA, tileA, mulCol(tileA, 0.6), mulCol(tileA, 0.6)]);
  const ceil = [0.82, 0.82, 0.8];
  B.quad([P(u0, yC, d0), P(u1, yC, d0), P(u1, yC, d1), P(u0, yC, d1)], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [ceil, ceil, mulCol(ceil, 0.7), mulCol(ceil, 0.7)]);
  B.quad([P(u0, yF, d1), P(u1, yF, d1), P(u1, yC, d1), P(u0, yC, d1)], n, [[0, 0], [1, 0], [1, 1], [0, 1]], [mulCol(wall, 0.62), mulCol(wall, 0.62), mulCol(wall, 0.8), mulCol(wall, 0.8)]);
  B.quad([P(u0, yF, d0), P(u0, yF, d1), P(u0, yC, d1), P(u0, yC, d0)], t, [[0, 0], [1, 0], [1, 1], [0, 1]], [mulCol(wall, 0.8), mulCol(wall, 0.55), mulCol(wall, 0.66), mulCol(wall, 0.9)]);
  B.quad([P(u1, yF, d0), P(u1, yF, d1), P(u1, yC, d1), P(u1, yC, d0)], [-t[0], 0, -t[2]], [[0, 0], [1, 0], [1, 1], [0, 1]], [mulCol(wall, 0.8), mulCol(wall, 0.55), mulCol(wall, 0.66), mulCol(wall, 0.9)]);
  // fluorescent fixtures in rows parallel to the frontage
  const Bt = env.B(kit === 'kissa' || kit === 'barber' ? 'warm' : 'tube');
  const depth = d0 - d1;
  for (let dd = d0 - 0.7; dd > d1 + 0.3; dd -= r.range(1.1, 1.6)) {
    box(Bt, F, u0 + 0.35, Math.max(u0 + 0.6, u1 - 0.35), yC - 0.05, yC - 0.01, dd - 0.04, dd + 0.04, [1, 1, 1], { skip: new Set(['top']) });
    box(B, F, u0 + 0.3, Math.max(u0 + 0.65, u1 - 0.3), yC - 0.02, yC, dd - 0.08, dd + 0.08, [0.9, 0.9, 0.88], { skip: new Set(['top']) });
  }
  if (!near && kit !== 'stair') return;
  const W_ = u1 - u0;
  const frameCol = r.pick([[0.5, 0.5, 0.48], [0.75, 0.74, 0.7], mulCol(r.pick(WOOD), 1.0)]);
  if (kit === 'stair') {
    // terrazzo stair rising toward the back, lit by one tube; mailboxes on the side wall
    const stepH = 0.18, run = 0.27; let y = yF, d = d0 - 0.9;
    const sc = [0.62, 0.6, 0.56];
    while (y + stepH < yC - 0.9 && d - run > d1 + 0.05) {
      box(B, F, u0 + 0.12, u1 - 0.12, yF, y + stepH, d - run, d, mulCol(sc, 0.9 + 0.1 * ((y * 10) % 2)), { skip: new Set(['bottom']) });
      box(B, F, u0 + 0.12, u1 - 0.12, y + stepH - 0.015, y + stepH + 0.004, d - 0.04, d, [0.25, 0.24, 0.22], { skip: new Set(['bottom']) });
      y += stepH; d -= run;
    }
    box(B, F, u0 + 0.02, u0 + 0.12, yF + 1.1, yF + 1.6, d0 - 0.5, d0 - 0.9, [0.55, 0.6, 0.58], {});
    return;
  }
  if (kit === 'goods' || kit === 'photo' || kit === 'records') {
    // shelving along the back and side walls, a counter, goods
    const sh = Math.min(yC - yF - 0.3, r.range(1.6, 2.1));
    for (let u = u0 + 0.05; u < u1 - 0.6; u += r.range(0.9, 1.3)) shelfUnit(env, F, u, Math.min(u1 - 0.05, u + 0.9), yF, yF + sh, d1 + 0.45, d1 + 0.02, r, frameCol);
    if (depth > 2.2) {
      shelfUnit(env, F, u0 + 0.02, u0 + 0.42, yF, yF + sh * 0.9, d0 - 0.5, d1 + 0.6, r, frameCol);
      if (W_ > 2.4) shelfUnit(env, F, u1 - 0.42, u1 - 0.02, yF, yF + sh * 0.9, d0 - 0.5, d1 + 0.6, r, frameCol);
    }
    if (kit === 'records' && depth > 1.6) { // record bins in the middle
      const ub = u0 + W_ * 0.25, ue = u1 - W_ * 0.25;
      box(B, F, ub, ue, yF, yF + 0.75, d0 - 0.9, d0 - 1.5, r.pick(WOOD), { skip: new Set(['bottom']) });
      for (let u = ub + 0.03; u < ue - 0.03; u += 0.03) box(B, F, u, u + 0.012, yF + 0.75, yF + 1.02, d0 - 0.95, d0 - 1.45, r.pick(GOOD), { skip: new Set(['bottom']) });
    }
    if (kit === 'photo' && depth > 1.4) { // glass display counter
      box(B, F, u0 + W_ * 0.2, u1 - W_ * 0.2, yF, yF + 0.95, d0 - 0.6, d0 - 1.1, [0.3, 0.32, 0.33], { skip: new Set(['bottom']) });
      goodsRow(env, F, u0 + W_ * 0.22, u1 - W_ * 0.22, yF + 0.95, d0 - 0.65, d0 - 1.05, r, 0.12);
    }
    if (depth > 1.8 && kit === 'goods') box(B, F, u0 + W_ * 0.55, u1 - 0.3, yF, yF + 0.9, d1 + 1.4, d1 + 0.85, r.pick(WOOD), { skip: new Set(['bottom']) });
  } else if (kit === 'clothing') {
    for (let dd = d0 - 0.6; dd > d1 + 0.5; dd -= 0.9) {
      box(B, F, u0 + 0.3, u1 - 0.3, yF + 1.45, yF + 1.48, dd - 0.015, dd + 0.015, [0.7, 0.7, 0.68], {});
      for (let u = u0 + 0.35; u < u1 - 0.35; u += r.range(0.05, 0.09)) box(B, F, u, u + 0.035, yF + 0.55 + r.range(0, 0.35), yF + 1.42, dd - 0.22, dd + 0.22, mulCol(r.pick(GOOD), 0.8), { skip: new Set(['top']) });
    }
    shelfUnit(env, F, u0 + 0.05, u1 - 0.05, yF, yF + Math.min(2.0, yC - yF - 0.3), d1 + 0.4, d1 + 0.02, r, frameCol, 0.8);
  } else if (kit === 'diner' || kit === 'kissa') {
    // counter with stools along one side, tables, menu boards on the back wall
    const side = r.chance(0.5);
    const cu0 = side ? u0 + 0.05 : u1 - 0.7, cu1 = side ? u0 + 0.7 : u1 - 0.05;
    box(B, F, cu0, cu1, yF, yF + 1.0, d0 - 0.5, d1 + 0.3, kit === 'kissa' ? r.pick(WOOD) : [0.72, 0.7, 0.62], { skip: new Set(['bottom']) });
    box(B, F, cu0 - 0.06, cu1 + 0.06, yF + 1.0, yF + 1.04, d0 - 0.45, d1 + 0.25, [0.35, 0.22, 0.14], {});
    for (let dd = d0 - 0.8; dd > d1 + 0.5; dd -= 0.55) {
      const su = side ? cu1 + 0.25 : cu0 - 0.25;
      box(B, F, su - 0.03, su + 0.03, yF, yF + 0.62, dd - 0.03, dd + 0.03, [0.3, 0.3, 0.3], {});
      box(B, F, su - 0.16, su + 0.16, yF + 0.62, yF + 0.69, dd - 0.16, dd + 0.16, kit === 'kissa' ? [0.2, 0.07, 0.05] : [0.3, 0.06, 0.05], {});
    }
    if (W_ > 2.4) for (let dd = d0 - 0.9; dd > d1 + 0.8; dd -= 1.4) {
      const tu = side ? u1 - 0.8 : u0 + 0.8;
      box(B, F, tu - 0.4, tu + 0.4, yF + 0.68, yF + 0.72, dd - 0.35, dd + 0.35, kit === 'kissa' ? [0.3, 0.2, 0.12] : [0.8, 0.78, 0.7], {});
      box(B, F, tu - 0.04, tu + 0.04, yF, yF + 0.68, dd - 0.04, dd + 0.04, [0.2, 0.2, 0.2], {});
      for (const off of [-0.55, 0.55]) {
        const cc = kit === 'kissa' ? [0.18, 0.07, 0.05] : [0.22, 0.14, 0.09];
        box(B, F, tu - 0.2, tu + 0.2, yF + 0.38, yF + 0.45, dd + off - 0.18, dd + off + 0.18, cc, {});
        const back = off > 0 ? 0.16 : -0.16;
        box(B, F, tu - 0.2, tu + 0.2, yF + 0.45, yF + 0.95, dd + off + back - 0.03, dd + off + back + 0.03, cc, {});
        box(B, F, tu - 0.02, tu + 0.02, yF, yF + 0.38, dd + off - 0.02, dd + off + 0.02, [0.15, 0.15, 0.15], {});
      }
    }
    for (let u = u0 + 0.3; u < u1 - 0.5; u += r.range(0.35, 0.6)) box(B, F, u, u + 0.28, yC - 0.75, yC - 0.35, d1 + 0.02, d1 + 0.035, r.chance(0.7) ? [0.85, 0.82, 0.72] : [0.7, 0.2, 0.15], {});
  } else if (kit === 'barber') {
    // mirrors and chairs along one wall
    for (let u = u0 + 0.4; u < u1 - 0.5; u += 1.0) {
      box(B, F, u, u + 0.7, yF + 0.9, yF + 1.8, d1 + 0.02, d1 + 0.04, [0.55, 0.62, 0.66], {});
      box(B, F, u + 0.15, u + 0.55, yF + 0.35, yF + 0.55, d1 + 0.55, d1 + 1.0, [0.3, 0.08, 0.06], {});
      box(B, F, u + 0.15, u + 0.55, yF + 0.55, yF + 1.15, d1 + 0.92, d1 + 1.0, [0.3, 0.08, 0.06], {});
      box(B, F, u + 0.3, u + 0.4, yF, yF + 0.35, d1 + 0.7, d1 + 0.8, [0.6, 0.6, 0.6], {});
    }
  } else if (kit === 'office') {
    // estate agent / ticket office: desks, filing cabinets
    for (let u = u0 + 0.3; u < u1 - 1.0; u += 1.5) {
      box(B, F, u, u + 1.1, yF, yF + 0.72, d0 - 1.0, d0 - 1.7, [0.5, 0.52, 0.5], { skip: new Set(['bottom']) });
      box(B, F, u + 0.1, u + 0.6, yF + 0.72, yF + 0.74, d0 - 1.1, d0 - 1.5, [0.85, 0.85, 0.8], {});
    }
    for (let u = u0 + 0.1; u < u1 - 0.5; u += 0.48) box(B, F, u, u + 0.45, yF, yF + 1.3, d1 + 0.5, d1 + 0.02, [0.55, 0.58, 0.55], { skip: new Set(['bottom']) });
  }
}
