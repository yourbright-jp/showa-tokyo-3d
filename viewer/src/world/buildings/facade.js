import { W, box, rectN, wallWithHoles, reveals, tube, mulCol, mixCol, hexToRgb } from './geom.js';
import { buildShopBays } from './shop.js';

// Near-route facades (period-plausible-generic Showa mixed-use "zakkyo" buildings).
// Frame convention: u along the footprint edge, y up, d outward (d<0 is inside the building).

const DIRT = [74, 68, 60];
const SOOT = [58, 57, 56];
const RUST = [122, 84, 56];
const ALGAE = [86, 98, 78];
const SPLASH = [96, 86, 72];
const AC_COLS = ['#d9d2bf', '#cfc9b6', '#e0dccf', '#bdb8a8', '#c9c4ae'].map((h) => hexToRgb(h).map((v) => v * 0.6));
const SKIP_H = new Set(['back', 'left', 'right', 'bottom']); // bottom rail: top face shows
const SKIP_HB = new Set(['back', 'left', 'right', 'top']); // head rail: underside shows
const SKIP_V = new Set(['back', 'top', 'bottom']);
const SKIP_LITE = new Set(['back', 'left', 'right', 'top', 'bottom']);

/** Facade-level helpers bound to one facade. */
function facadeCtx(env, F, region) {
  const atlas = env.atlas;
  const ex = region ? (u, y) => ({ aGrime: region.uv(u, y) }) : () => ({ aGrime: atlas.white });
  return { ex, region };
}

/** Upper-floor window list for a front facade, per style. */
function upperWindows(S, lv, L, r) {
  const wins = [];
  const pL = Math.min(S.endPier[0], L * 0.2), pR = Math.min(S.endPier[1], L * 0.2);
  const span0 = pL, span1 = L - pR, span = span1 - span0;
  if (span < 0.6) return wins;
  for (let k = 1; k < lv.floors; k++) {
    const F0 = lv.floorY(k);
    let y0 = F0 + S.sillH, y1 = Math.min(F0 + lv.ufh - S.headH, lv.roofY - 0.25);
    if (k === 1) y0 = Math.max(y0, lv.fascia1 + 0.16);
    if (S.win === 'balcony' || (S.balconyTop && k === lv.floors - 1 && lv.floors > 2)) {
      const yy0 = Math.max(F0 + 0.06, k === 1 ? lv.fascia1 + 0.16 : 0), yy1 = Math.min(F0 + 2.15, lv.roofY - 0.25);
      if (yy1 - yy0 > 1.2) {
        const n = Math.max(1, Math.round(span / 3.6));
        const gap = 0.5; const w = (span - gap * (n - 1)) / n;
        for (let i = 0; i < n; i++) wins.push({ u0: span0 + i * (w + gap), u1: span0 + i * (w + gap) + w, y0: yy0, y1: yy1, k, kind: 'door', recess: 0.14 });
        continue;
      }
    }
    if (y1 - y0 < 0.6) continue;
    if (S.win === 'blank') {
      // stair-hall windows at one end, offset half a storey (landings)
      const w = Math.min(0.75, span * 0.4); const uc = S.stairSide ? span1 - 0.5 - w / 2 : span0 + 0.5 + w / 2;
      const ys = F0 + lv.ufh * 0.5 - 0.45;
      if (ys > lv.fascia1 + 0.2 && ys + 0.9 < lv.roofY - 0.2) wins.push({ u0: uc - w / 2, u1: uc + w / 2, y0: ys, y1: ys + 0.9, k, kind: 'small', recess: 0.12 });
      if (span > 5 && r.chance(0.5)) { const uc2 = (span0 + span1) / 2; wins.push({ u0: uc2 - 0.6, u1: uc2 + 0.6, y0, y1: Math.min(y1, y0 + 1.1), k, kind: 'punched', recess: S.recess }); }
      continue;
    }
    if (S.win === 'ribbon' || S.win === 'fins') {
      if (S.ribbonPierEvery && span > S.ribbonPierEvery * 1.4) {
        const n = Math.round(span / S.ribbonPierEvery); const pw = 0.35; const w = (span - pw * (n - 1)) / n;
        for (let i = 0; i < n; i++) wins.push({ u0: span0 + i * (w + pw), u1: span0 + i * (w + pw) + w, y0, y1, k, kind: 'ribbon', recess: S.recess });
      } else wins.push({ u0: span0, u1: span1, y0, y1, k, kind: 'ribbon', recess: S.recess });
      continue;
    }
    if (S.win === 'grid') {
      const n = Math.max(1, Math.round(span / S.bayW)); const bw = span / n;
      for (let i = 0; i < n; i++) {
        const a = span0 + i * bw + (i === 0 ? 0 : S.pilasterW / 2), b = span0 + (i + 1) * bw - (i === n - 1 ? 0 : S.pilasterW / 2);
        if (b - a > 0.6) wins.push({ u0: a + 0.12, u1: b - 0.12, y0, y1, k, kind: 'grid', recess: S.recess });
      }
      continue;
    }
    // punched
    const ww = Math.min(S.winW, span - 0.2);
    const n = Math.max(1, Math.floor((span + S.winGap) / (ww + S.winGap)));
    const total = n * ww + (n - 1) * S.winGap; const start = span0 + (span - total) / 2;
    const yTop = k === lv.floors - 1 && r.chance(0.3) ? Math.min(y1, y0 + 1.0) : y1;
    for (let i = 0; i < n; i++) wins.push({ u0: start + i * (ww + S.winGap), u1: start + i * (ww + S.winGap) + ww, y0, y1: yTop, k, kind: 'punched', recess: S.recess });
  }
  return wins;
}

/** Sash frames, mullions and interior-mapped glass for one window opening. */
function glazeWindow(env, F, w, S, r, fc) {
  const Bs = env.B('sash'), Bg = env.B('glass');
  const sash = S.sashColour;
  const d0 = -w.recess;
  const fw = 0.045, fd = 0.05;
  const W_ = w.u1 - w.u0, H = w.y1 - w.y0;
  // outer frame (hidden faces skipped; lite tier keeps only the front faces)
  const lite = env.lite;
  const SH = lite ? SKIP_LITE : SKIP_H, SV = lite ? SKIP_LITE : SKIP_V;
  box(Bs, F, w.u0, w.u1, w.y0, w.y0 + fw, d0 - 0.01, d0 + fd, sash, { skip: SH });
  box(Bs, F, w.u0, w.u1, w.y1 - fw, w.y1, d0 - 0.01, d0 + fd, sash, { skip: lite ? SKIP_LITE : SKIP_HB });
  box(Bs, F, w.u0, w.u0 + fw, w.y0 + fw, w.y1 - fw, d0 - 0.01, d0 + fd, sash, { skip: SV });
  box(Bs, F, w.u1 - fw, w.u1, w.y0 + fw, w.y1 - fw, d0 - 0.01, d0 + fd, sash, { skip: SV });
  // rooms: ribbons are split into 3-5 m rooms with their own interiors
  const segs = [];
  if (W_ > 5.5) {
    const n = Math.round(W_ / r.range(3.2, 4.8)); const sw = W_ / n;
    for (let i = 0; i < n; i++) segs.push([w.u0 + i * sw, w.u0 + (i + 1) * sw]);
  } else segs.push([w.u0, w.u1]);
  const transom = S.transom && H > 1.5 && w.kind !== 'door' ? w.y1 - Math.min(0.5, H * 0.3) : null;
  if (transom) box(Bs, F, w.u0 + fw, w.u1 - fw, transom - 0.02, transom + 0.02, d0, d0 + fd * 0.8, sash, { skip: lite ? SKIP_LITE : SKIP_H });
  const depthRoom = r.range(2.5, 5.5);
  for (const [s0, s1] of segs) {
    const seed = r.int(1, 9999);
    const sw = s1 - s0;
    const nP = Math.max(1, Math.round(sw / S.paneW));
    const pw = sw / nP;
    for (let p = 0; p < nP; p++) {
      const a = s0 + p * pw, b = a + pw;
      if (p > 0 || s0 > w.u0 + 1e-3) box(Bs, F, a - 0.018, a + 0.018, w.y0 + fw, w.y1 - fw, d0, d0 + fd * 0.9, sash, { skip: lite ? SKIP_LITE : SKIP_V });
      // sliding sashes sit at alternating depths
      const dg = d0 - (p % 2 ? 0.035 : 0.012);
      const q = (u, y) => [W(F, u, y, dg), [u - s0, y - w.y0]];
      const ya = w.y0 + fw, yb = w.y1 - fw;
      const pts = [[a, ya], [b, ya], [b, yb], [a, yb]];
      const vv = pts.map(([u, y]) => q(u, y));
      const winAttr = [sw, H, depthRoom, seed];
      Bg.quad(vv.map((x) => x[0]), [F.nx, 0, F.nz], vv.map((x) => x[1]), [1, 1, 1], [0, 1, 2, 3].map(() => ({ aWin: winAttr })));
    }
  }
  // window AC unit (1970s window cooler), sparingly
  if (S.acRate && !env.lite && w.kind !== 'door' && W_ > 0.9 && r.chance(S.acRate)) {
    const uc = r.range(w.u0 + 0.4, w.u1 - 0.4); const col = r.pick(AC_COLS);
    const Bp = env.B('paint');
    box(Bp, F, uc - 0.31, uc + 0.31, w.y0 + 0.02, w.y0 + 0.44, d0 + 0.02, 0.3, col, { ex: fc.ex });
    box(env.B('trim'), F, uc - 0.26, uc + 0.26, w.y0 + 0.08, w.y0 + 0.38, 0.3, 0.305, mulCol(col, 0.45), { ex: fc.ex, skip: new Set(['back']) });
    if (fc.region) { fc.region.streak(uc + r.range(-0.2, 0.2), w.y0, r.range(0.8, 2.6), r.range(0.04, 0.1), RUST, 0.35); }
  }
}

/** Grime events for a window opening. */
function stainWindow(R, w, r, dirt) {
  if (!R) return;
  R.bandBelow(w.u0 - 0.05, w.u1 + 0.05, w.y0 - 0.06, r.range(0.3, 0.9), DIRT, 0.24 * dirt);
  const n = 2 + Math.floor((w.u1 - w.u0) / r.range(0.3, 0.8));
  for (let i = 0; i < n; i++) {
    const u = i === 0 ? w.u0 + 0.04 : i === 1 ? w.u1 - 0.04 : r.range(w.u0, w.u1);
    const edge = i < 2;
    R.streak(u, w.y0 - 0.05, (edge ? r.range(1.0, 3.2) : r.range(0.3, 2.2)) * dirt + 0.2, r.range(0.03, edge ? 0.2 : 0.12), r.chance(0.2) ? ALGAE : DIRT, r.range(0.25, 0.6) * dirt);
  }
  // head: dirt collects under the lintel edges
  R.bandBelow(w.u0, w.u1, w.y1 + 0.08, 0.08, SOOT, 0.12 * dirt);
}

function ageTone(R, L, lv, r, dirt) {
  // overall weathered tone: slightly darker, darker still towards the top (run-off) and the street (soot)
  R.rect(0, L, lv.yBot, lv.topY + 0.05, [214, 208, 198], 0.35 * dirt);
  R.bandBelow(0, L, lv.topY, (lv.topY - lv.base) * 0.45, [120, 112, 100], 0.22 * dirt);
  R.bandAbove(0, L, lv.base, 3.5, [110, 104, 96], 0.2 * dirt);
}

function facadeStains(R, L, lv, r, dirt, ground) {
  if (!R) return;
  ageTone(R, L, lv, r, dirt);
  // broad mottling
  for (let i = 0; i < 3 + L / 3; i++) R.blot(r.range(0, L), r.range(lv.base, lv.topY), r.range(1.0, 4.5), r.chance(0.3) ? SOOT : DIRT, r.range(0.06, 0.18) * dirt);
  // parapet/coping run-off
  R.bandBelow(0, L, lv.topY, r.range(0.6, 1.8), DIRT, 0.3 * dirt);
  for (let u = r.range(0, 0.6); u < L; u += r.range(0.15, 0.9)) R.streak(u, lv.topY - 0.1, r.range(0.6, 5.5) * dirt, r.range(0.03, 0.22), r.chance(0.15) ? ALGAE : DIRT, r.range(0.12, 0.42) * dirt);
  // ground splash and soot at street level
  R.bandAbove(0, L, ground, r.range(0.35, 1.0), SPLASH, 0.32 * dirt);
  R.bandBelow(0, L, lv.gfTop, r.range(0.15, 0.4), SOOT, 0.15 * dirt);
}

/** A front (street) facade with shopfront and full upper-floor articulation. */
export function buildFrontFacade(env, b, S, lv, F, meta, corner, r) {
  const L = F.L;
  const ground = env.groundAt(F, L / 2);
  const region = env.atlas.alloc(L, lv.yBot, lv.topY + 0.05, env.ppmFront);
  const fc = facadeCtx(env, F, region);
  const dirt = S.dirt;
  if (region) region.begin();
  facadeStains(region, L, lv, r, dirt, ground);

  const Bwall = env.B(`wall:${S.clad}`), Bground = env.B(`wall:${S.groundClad}`), Bfascia = env.B(`wall:${S.fasciaClad}`);
  const Bp = env.B('paint');
  const extA = corner.convA ? 0.3 : -0.3, extB = corner.convB ? 0.3 : -0.3; // band extension sign per corner (scaled by depth)

  // --- ground floor: shop bays --------------------------------------------------------------
  const groundHoles = buildShopBays(env, b, S, lv, F, meta, r, fc);
  wallWithHoles(Bground, F, 0, L, lv.yBot, lv.gfTop, groundHoles, S.groundColour, { uvo: S.uvo, ex: fc.ex });
  // slab edge band under the fascia (kept below fasciaY0) and drip ledge above it
  const tc = S.trimColour;
  box(Bp, F, extA > 0 ? -0.08 : 0.08, L + (extB > 0 ? 0.08 : -0.08), lv.gfTop - 0.12, lv.gfTop + 0.06, 0, 0.08, tc, { ex: fc.ex, skip: new Set(['back']) });
  // fascia band (plain; signage mounts here)
  wallWithHoles(Bfascia, F, 0, L, lv.gfTop, lv.fascia1, [], S.fasciaColour, { uvo: S.uvo, ex: fc.ex });
  box(Bp, F, extA > 0 ? -0.06 : 0.06, L + (extB > 0 ? 0.06 : -0.06), lv.fascia1, lv.fascia1 + 0.07, 0, 0.06, tc, { ex: fc.ex, skip: new Set(['back']) });
  if (region) region.bandBelow(0, L, lv.fascia1, 0.5, DIRT, 0.12 * dirt);

  // --- upper floors ------------------------------------------------------------------------
  const wins = upperWindows(S, lv, L, r);
  wallWithHoles(Bwall, F, 0, L, lv.fascia1, lv.topY, wins, S.colour, { uvo: S.uvo, ex: fc.ex });
  const sillCol = S.sillKind === 'metal' ? mixCol(S.sashColour, [0.5, 0.5, 0.5], 0.2) : S.trimColour;
  for (const w of wins) {
    reveals(Bwall, F, w, w.recess, mulCol(S.colour, 0.92), { uvo: S.uvo, ex: fc.ex });
    if (w.kind !== 'door') box(env.B('trim'), F, w.u0 - 0.05, w.u1 + 0.05, w.y0 - 0.06, w.y0 + 0.005, -w.recess, 0.06, sillCol, { ex: fc.ex, skip: new Set(['back']) });
    glazeWindow(env, F, w, S, r, fc);
    stainWindow(region, w, r, dirt);
    if (w.kind === 'punched' && S.hoods) {
      box(Bp, F, w.u0 - 0.12, w.u1 + 0.12, w.y1 + 0.02, w.y1 + 0.11, 0, 0.3, S.trimColour, { ex: fc.ex });
      if (region) { region.streak(w.u0 - 0.1, w.y1 + 0.02, r.range(0.5, 1.6), 0.08, DIRT, 0.35); region.streak(w.u1 + 0.1, w.y1 + 0.02, r.range(0.5, 1.6), 0.08, DIRT, 0.35); }
    }
    if (w.kind === 'door') { // shallow balcony ledge and railing (<= 0.33 m)
      const yl = w.y0 - 0.06;
      box(Bp, F, w.u0 - 0.1, w.u1 + 0.1, yl - 0.1, yl + 0.04, 0, 0.32, S.trimColour, { ex: fc.ex });
      const rc = S.railColour;
      box(Bp, F, w.u0 - 0.1, w.u1 + 0.1, yl + 0.95, yl + 1.0, 0.27, 0.32, rc, { ex: fc.ex });
      box(env.B('trim'), F, w.u0 - 0.1, w.u1 + 0.1, yl + 0.18, yl + 0.21, 0.28, 0.31, rc, { ex: fc.ex });
      for (let u = w.u0 - 0.05; u < w.u1 + 0.1; u += 0.13) box(env.B('sash'), F, u, u + 0.018, yl + 0.04, yl + 0.95, 0.285, 0.303, rc, { skip: env.lite ? SKIP_LITE : SKIP_V });
      if (region) for (let u = w.u0; u < w.u1; u += r.range(0.2, 0.7)) region.streak(u, yl - 0.1, r.range(0.4, 1.8), 0.05, RUST, 0.22);
    }
  }

  // --- articulation: spandrels, pilasters, fins, bands -------------------------------------
  const pL = Math.min(S.endPier[0], L * 0.2), pR = Math.min(S.endPier[1], L * 0.2);
  if (S.win === 'ribbon' && S.spandrel !== 'same') {
    const Bsp = env.B(S.spandrel === 'panel' ? 'wall:panel' : `wall:${S.clad === 'mosaic' ? 'smalltile' : 'mosaic'}`);
    const rows = [...new Set(wins.map((w) => w.k))];
    for (const k of rows) {
      const ws = wins.filter((w) => w.k === k);
      const yTopPrev = k === 1 ? lv.fascia1 + 0.07 : Math.max(...wins.filter((w) => w.k === k - 1).map((w) => w.y1).concat([lv.floorY(k)]));
      const y0 = yTopPrev, y1 = Math.min(...ws.map((w) => w.y0)) - 0.06;
      if (y1 - y0 > 0.2) box(Bsp, F, pL, L - pR, y0, y1, 0, 0.025, S.spandrelColour, { ex: fc.ex, uvo: S.uvo, skip: new Set(['back']) });
    }
  }
  if (S.win === 'grid') {
    const span = L - pL - pR; const n = Math.max(1, Math.round(span / S.bayW)); const bw = span / n;
    for (let i = 0; i <= n; i++) {
      const uc = pL + i * bw; const a = Math.max(0, uc - S.pilasterW / 2), c = Math.min(L, uc + S.pilasterW / 2);
      box(Bwall, F, a, c, lv.fascia1 + 0.07, lv.topY - 0.02, 0, S.pilasterD, mulCol(S.colour, 0.96), { ex: fc.ex, uvo: S.uvo, skip: new Set(['back']) });
      if (region) region.streak(uc, lv.topY, r.range(2, 8), S.pilasterW * 0.8, DIRT, 0.12 * dirt);
    }
    for (let k = 2; k < lv.floors; k++) {
      const y = lv.floorY(k);
      box(Bwall, F, pL, L - pR, y - 0.3, y + 0.12, 0, S.pilasterD * 0.6, mulCol(S.colour, 1.02), { ex: fc.ex, uvo: S.uvo, skip: new Set(['back']) });
    }
  } else if (S.win === 'fins') {
    const span = L - pL - pR; const n = Math.max(1, Math.round(span / (S.paneW * S.finEvery)));
    for (let i = 0; i <= n; i++) {
      const uc = pL + (i * span) / n;
      box(Bwall, F, uc - 0.06, uc + 0.06, lv.fascia1 + 0.07, lv.roofY + 0.2, 0, S.finD, mulCol(S.colour, 1.03), { ex: fc.ex, uvo: S.uvo, skip: new Set(['back']) });
    }
  }
  if (S.band !== 'none' && S.win !== 'grid') {
    for (let k = 2; k < lv.floors; k++) {
      const y = lv.floorY(k);
      const h = S.band === 'slab' ? S.bandH : 0.08, d = S.band === 'slab' ? S.bandD : 0.035;
      const ya = y - h * 0.55, yb = y + h * 0.45;
      if (wins.some((w) => w.y1 > ya && w.y0 < yb)) continue;
      box(Bp, F, -extA * d / 0.3, L + extB * d / 0.3, ya, yb, 0, d, S.bandColour, { ex: fc.ex, skip: new Set(['back']) });
      if (region) for (let u = r.range(0, 1); u < L; u += r.range(0.3, 1.4)) region.streak(u, ya, r.range(0.3, 2.2) * dirt, r.range(0.03, 0.12), DIRT, r.range(0.15, 0.4) * dirt);
    }
  }
  // cornice / coping
  const cd = S.corniceD;
  box(Bp, F, -extA * cd / 0.3, L + extB * cd / 0.3, lv.topY - 0.22, lv.topY + 0.02, 0, cd, S.trimColour, { ex: fc.ex });
  if (S.cornice === 'stepped') box(Bp, F, -extA * cd / 0.6, L + extB * cd / 0.6, lv.topY - 0.42, lv.topY - 0.22, 0, cd * 0.5, mulCol(S.trimColour, 0.95), { ex: fc.ex, skip: new Set(['back']) });
  if (S.cornice === 'deep') box(Bwall, F, 0, L, lv.roofY - 0.4, lv.topY - 0.22, 0, 0.05, mulCol(S.colour, 1.04), { ex: fc.ex, uvo: S.uvo, skip: new Set(['back']) });

  // drainpipe at one end of the main front
  if (L > 3 && corner.pipe) {
    const u = S.pipeEnd ? L - 0.16 : 0.16;
    const p0 = W(F, u, ground - 0.02, 0.11), p1 = W(F, u, lv.topY - 0.35, 0.11);
    tube(env.B('paint'), p0, p1, 0.05, 8, S.pipeColour);
    box(Bp, F, u - 0.13, u + 0.13, lv.topY - 0.6, lv.topY - 0.32, 0.02, 0.24, S.pipeColour, { ex: fc.ex });
    for (let y = ground + 1.5; y < lv.topY - 0.8; y += 1.8) box(env.B('trim'), F, u - 0.07, u + 0.07, y, y + 0.04, 0, 0.17, mulCol(S.pipeColour, 0.8), { ex: fc.ex, skip: new Set(['back']) });
    if (region) { region.streak(u, lv.topY - 0.3, lv.topY - ground, 0.3, DIRT, 0.25 * dirt); region.blot(u, lv.topY - 0.5, 0.6, RUST, 0.3); }
  }
  if (region) region.end();
}

/** Side facades (open but not on the street) and party walls. */
export function buildSideFacade(env, b, S, lv, F, meta, kind, r) {
  const L = F.L;
  const ground = env.groundAt(F, L / 2);
  // walls hidden by an abutting neighbour are skipped (fully) or start above the neighbour's roof
  let yStart = lv.yBot;
  if ((kind === 'party' || kind === 'plain') && (!meta || meta.openDistance < 1.5)) {
    const cover = env.neighbourCover(F, b.id, meta ? Math.min(1.3, meta.openDistance) : 0.1);
    if (cover >= lv.topY - 0.05) return;
    if (cover > lv.yBot + 0.5) yStart = cover - 0.3;
  }
  const open = kind === 'side';
  const ppm = open && meta && meta.routeDist < 60 ? env.ppmSide : env.ppmBack;
  const region = L > 0.8 ? env.atlas.alloc(L, yStart, lv.topY + 0.05, ppm) : null;
  const fc = facadeCtx(env, F, region);
  if (region) region.begin();
  const dirt = Math.min(1, S.dirt + 0.15);
  const Bwall = env.B(`wall:${S.sideClad}`);
  let wins = [];
  let nb = -Infinity;
  if (kind === 'party') nb = env.neighbourTop(F, b.id);
  if (L > 2.2 && kind !== 'plain' && !(env.lite && kind === 'party')) {
    const cols = Math.max(1, Math.floor(L / r.range(3, 6)));
    const ww = r.range(0.7, 1.4);
    for (let k = 1; k < lv.floors; k++) {
      const F0 = lv.floorY(k);
      const y0 = Math.max(F0 + 0.9, k === 1 ? lv.fascia1 + 0.2 : -1e9), y1 = Math.min(F0 + 2.1, lv.roofY - 0.3);
      if (y1 - y0 < 0.6 || y0 < nb + 0.4) continue;
      for (let c = 0; c < cols; c++) {
        if (!r.chance(open ? 0.75 : 0.45)) continue;
        const uc = (c + 0.5) * L / cols + r.range(-0.3, 0.3);
        const u0 = Math.max(0.3, uc - ww / 2), u1 = Math.min(L - 0.3, uc + ww / 2);
        if (u1 - u0 > 0.5) wins.push({ u0, u1, y0, y1: Math.min(y1, y0 + r.range(0.9, 1.3)), k, kind: 'punched', recess: 0.12 });
      }
    }
  }
  wallWithHoles(Bwall, F, 0, L, yStart, lv.topY, wins, S.sideColour, { uvo: S.uvo, ex: fc.ex });
  if (region) {
    ageTone(region, L, lv, r, dirt);
    for (let i = 0; i < 2 + L / 5; i++) region.blot(r.range(0, L), r.range(lv.base, lv.topY), r.range(1.5, 6), DIRT, r.range(0.05, 0.15) * dirt);
    region.bandBelow(0, L, lv.topY, r.range(0.8, 2.5), DIRT, 0.35 * dirt);
    for (let u = r.range(0, 0.6); u < L; u += r.range(0.2, 1.1)) region.streak(u, lv.topY - 0.05, r.range(1, 8) * dirt, r.range(0.04, 0.3), r.chance(0.2) ? ALGAE : DIRT, r.range(0.15, 0.45) * dirt);
    region.bandAbove(0, L, ground, r.range(0.4, 1.2), SPLASH, 0.35 * dirt);
    // formwork-joint seepage lines and patch repairs on exposed party walls
    if (kind === 'party' && nb > lv.base) region.bandAbove(0, L, nb, 0.6, SOOT, 0.25);
  }
  const Bp = env.B('paint');
  for (const w of wins) {
    reveals(Bwall, F, w, w.recess, mulCol(S.sideColour, 0.9), { uvo: S.uvo, ex: fc.ex });
    box(env.B('trim'), F, w.u0 - 0.04, w.u1 + 0.04, w.y0 - 0.05, w.y0, -w.recess, 0.05, S.trimColour, { ex: fc.ex, skip: new Set(['back']) });
    glazeWindow(env, F, w, { ...S, acRate: open ? S.acRate * 1.5 : S.acRate, transom: false }, r, fc);
    stainWindow(region, w, r, dirt);
    // aluminium security grille on some side windows
    if (S.grilleRate && !env.lite && r.chance(S.grilleRate)) {
      const Bs = env.B('sash');
      box(Bs, F, w.u0 - 0.05, w.u1 + 0.05, w.y0 - 0.02, w.y0 + 0.02, 0, 0.09, S.sashColour, { skip: new Set(['back']) });
      box(Bs, F, w.u0 - 0.05, w.u1 + 0.05, w.y1 - 0.02, w.y1 + 0.02, 0, 0.09, S.sashColour, { skip: new Set(['back']) });
      for (let u = w.u0; u <= w.u1 + 1e-3; u += 0.11) box(Bs, F, u - 0.008, u + 0.008, w.y0, w.y1, 0.06, 0.08, S.sashColour, { skip: new Set(['back', 'top', 'bottom']) });
    }
  }
  // service pipes on open side walls
  if (open && L > 2 && r.chance(0.7)) {
    const u = r.range(0.3, L - 0.3);
    tube(env.B('paint'), W(F, u, ground, 0.1), W(F, u, lv.topY - 0.3, 0.1), 0.045, 6, S.pipeColour);
    if (region) region.streak(u, lv.topY, lv.topY - ground, 0.25, DIRT, 0.25);
  }
  if (open && L > 3 && r.chance(0.5)) {
    // steel back door at ground level
    const u0 = r.range(0.4, Math.max(0.5, L - 1.4)), u1 = u0 + 0.9;
    box(Bp, F, u0, u1, ground, ground + 2.0, 0, 0.03, mixCol(S.pipeColour, [0.25, 0.27, 0.26], 0.5), { ex: fc.ex, skip: new Set(['back']) });
    box(Bp, F, u0 - 0.06, u1 + 0.06, ground + 2.0, ground + 2.08, 0, 0.12, S.trimColour, { ex: fc.ex });
  }
  if (region) region.end();
}
