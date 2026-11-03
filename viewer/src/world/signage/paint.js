// Sign-face painters. Every painter draws into an atlas region (pixel space) through a small
// context P = { g, ge, x, y, w, h, ppm, r } where g is the albedo canvas context, ge the optional
// emissive context (neon-night only), (x,y,w,h) the region in pixels and r a keyed PRNG.
// All content is period-plausible-generic: generic trade words, fictional names, no logos.
import { FONT_JP, FONT_MINCHO, FONT_MARU, FONT_CEDAR, layoutHorizontal, layoutVertical, drawGlyphs, fitH, inkHeight, inkCenterOffset, measureH } from './typeset.js';

// ---------------------------------------------------------------- colour helpers
export function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbHex([r, g, b]) { const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return `#${c(r)}${c(g)}${c(b)}`; }
export function shade(h, k) { const c = hexRgb(h); return rgbHex(k >= 0 ? c.map((v) => v + (255 - v) * k) : c.map((v) => v * (1 + k))); }
export function mix(h1, h2, t) { const a = hexRgb(h1), b = hexRgb(h2); return rgbHex(a.map((v, i) => v + (b[i] - v) * t)); }
export function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
const lum = (h) => { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

// ---------------------------------------------------------------- primitives
function clip(P) { const { g } = P; g.save(); g.beginPath(); g.rect(P.x, P.y, P.w, P.h); g.clip(); }
function unclip(P) { P.g.restore(); }
function emit(P, fn) { if (!P.ge) return; const g = P.ge; g.save(); g.beginPath(); g.rect(P.x, P.y, P.w, P.h); g.clip(); fn(g); g.restore(); }
function fillR(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

/** Base board: flat paint with a faint vertical sheen gradient and optional panel seams. */
function board(P, bg, { seams = 0, gloss = 0.06 } = {}) {
  const { g, x, y, w, h, r } = P;
  fillR(g, x, y, w, h, bg);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, `rgba(255,255,255,${gloss})`);
  gr.addColorStop(0.5, 'rgba(255,255,255,0)');
  gr.addColorStop(1, `rgba(0,0,0,${gloss * 0.8})`);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  // subtle hand-painted unevenness
  for (let i = 0; i < 4; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.015 + r() * 0.02})`;
    g.fillRect(x + r() * w * 0.7, y, w * (0.2 + r() * 0.4), h);
  }
  if (seams > 0) {
    const n = Math.round(w / (seams * P.ppm));
    for (let i = 1; i < n; i++) {
      const sx = x + (i * w) / n;
      fillR(g, sx - 0.6, y, 1.2, h, 'rgba(0,0,0,0.18)');
      fillR(g, sx + 0.6, y, 1, h, 'rgba(255,255,255,0.10)');
    }
  }
}

/** Border: outer line + optional inner pinstripe. */
function border(P, color, wm, inner = null) {
  const { g, x, y, w, h, ppm } = P;
  const b = Math.max(1, wm * ppm);
  g.strokeStyle = color; g.lineWidth = b;
  g.strokeRect(x + b / 2, y + b / 2, w - b, h - b);
  if (inner) {
    const i = Math.max(1, inner.w * ppm), o = b + Math.max(1.5, inner.gap * ppm);
    g.strokeStyle = inner.color; g.lineWidth = i;
    g.strokeRect(x + o + i / 2, y + o + i / 2, w - 2 * o - i, h - 2 * o - i);
  }
}

// r04: per-sign lettering family. Weighted towards gothic; mincho and rounded gothic were both common
// on 1970s painted and back-lit signs. weightK rescales the stroke so light W3 faces read as bold.
const FAMILIES = [
  { f: FONT_JP, w: 0.42, weightK: 1.0 },
  { f: FONT_MINCHO, w: 0.24, weightK: 0.45 },
  { f: FONT_MARU, w: 0.22, weightK: 1.55 },
  { f: FONT_CEDAR, w: 0.12, weightK: 1.35 },
];
function pickFamily(r) {
  let x = r() * FAMILIES.reduce((a, b) => a + b.w, 0);
  for (const F of FAMILIES) { if ((x -= F.w) <= 0) return F; }
  return FAMILIES[0];
}

function textStyle(r, scheme, kind) {
  const dark = lum(scheme.bg) < 0.45;
  const rim = dark ? shade(scheme.bg, -0.5) : '#ffffff';
  const F = pickFamily(r);
  const hand = r.range(0.35, 1.0);
  const k = F.weightK * r.range(0.8, 1.2);
  const base = { family: F.f, hand };
  switch (kind) {
    case 'heavy': return { ...base, fill: scheme.fg, weight: 0.07 * k };
    case 'outlined': return { ...base, fill: scheme.fg, weight: 0.05 * k, outline: [{ color: dark ? scheme.ac : shade(scheme.fg, -0.45), w: 0.035 }] };
    case 'double': return { ...base, fill: scheme.fg, weight: 0.04 * k, outline: [{ color: scheme.ac, w: 0.06 }, { color: rim, w: 0.035 }] }; // r04: thinner (read as a daytime glow)
    case 'shadow': return { ...base, fill: scheme.fg, weight: 0.05 * k, shadow: { dx: 0.045, dy: 0.05, color: rgba(dark ? '#000000' : shade(scheme.fg, -0.6), dark ? 0.55 : 0.45) } };
    case 'thin': return { ...base, fill: scheme.fg, weight: 0.0 };
    default: return { ...base, fill: scheme.fg, weight: 0.035 * k };
  }
}
export function pickTextKind(r) { return r.pick(['heavy', 'heavy', 'outlined', 'shadow', 'shadow', 'double', 'plain']); }

/** Horizontal text fitted to a box (px coordinates). Returns glyph px used. */
export function textH(P, text, cx, cy, bw, bh, style, opt = {}) {
  const { g } = P;
  const f = fitH(g, text, bw, bh, { minSx: opt.minSx ?? 0.5, maxSx: opt.maxSx ?? 1.0, track: opt.track || 0 });
  const off = inkCenterOffset(g, text, f.px);
  const L = layoutHorizontal(g, text, cx, cy - off * 0.6, f.px, { sx: f.sx, track: opt.track || 0, align: opt.align || 'center' });
  drawGlyphs(g, L.glyphs, style);
  if (opt.emit && P.ge) emit(P, (ge) => drawGlyphs(ge, L.glyphs, opt.emit));
  return f.px;
}

/** Vertical text fitted to a column box. Compresses vertically to 0.72 before shrinking. */
export function textV(P, text, cx, top, bw, bh, style, opt = {}) {
  const { g } = P;
  const n = [...text].length || 1;
  const adv = opt.adv || 1.04;
  let px = Math.min(bw * (opt.fillW || 0.86), opt.maxPx || 1e9);
  let sy = 1;
  const need = n * px * adv;
  if (need > bh) { sy = Math.max(0.72, bh / need); if (n * px * adv * sy > bh) px = bh / (n * adv * sy); }
  else if (opt.stretch !== false) sy = Math.min(opt.maxStretch || 1.4, bh / need);
  const H = n * px * adv * sy;
  const t0 = opt.valign === 'top' ? top : top + (bh - H) / 2;
  const L = layoutVertical(g, text, cx, t0, px, { adv, sy });
  drawGlyphs(g, L.glyphs, style);
  if (opt.emit && P.ge) emit(P, (ge) => drawGlyphs(ge, L.glyphs, opt.emit));
  return { px, height: H };
}

// ---------------------------------------------------------------- weathering
const PATS = new WeakMap();
function patternsFor(g, stamps) {
  let p = PATS.get(g);
  if (!p) { p = { blotch: g.createPattern(stamps.blotch, 'repeat'), speck: g.createPattern(stamps.speck, 'repeat'), streak: g.createPattern(stamps.streak, 'repeat') }; PATS.set(g, p); }
  return p;
}
/**
 * Fade, dirt, rain streaks, speckle, edge chips and rust drips. amount 0..1.
 * Cheap: uses pre-generated RGBA dirt stamps as transformed pattern fills (source-over).
 */
export function weather(P, stamps, amount, { chips = true, rust = true, streaks = true, top = true } = {}) {
  const { g, x, y, w, h, r, ppm } = P;
  if (amount <= 0) return;
  clip(P);
  // sun fade / chalking: wash towards a warm grey
  g.fillStyle = `rgba(226,221,206,${0.05 + amount * 0.16})`;
  g.fillRect(x, y, w, h);
  // stamps applied as transformed repeating patterns (drawImage between canvases is ~10x slower
  // on the accelerated canvas used by headless Chromium)
  const pats = patternsFor(g, stamps);
  const pfill = (pat, sc, ox, oy, a, x0, y0, w0, h0, rot = 0, sy = 1) => {
    pat.setTransform(new DOMMatrix().translate(ox, oy).rotate(rot).scale(sc, sc * sy));
    g.globalAlpha = a; g.fillStyle = pat; g.fillRect(x0, y0, w0, h0);
  };
  // r04: the same cloudy blotch read as one stamp repeated on every board (visual review); vary its
  // orientation, scale and aspect per board and keep it lighter
  pfill(pats.blotch, (ppm / 22) * (0.45 + r() * 1.2), x - r() * 256, y - r() * 256, Math.min(1, 0.12 + amount * 0.45), x, y, w, h, r.pick([0, 90, 180, 270]), 0.6 + r() * 0.8);
  if (streaks) {
    const sc = (ppm / 45) * (0.6 + r() * 0.8);
    const hh = Math.min(h, 256 * sc * 0.98);
    pfill(pats.streak, sc, x - r() * 256 * sc, y, Math.min(1, 0.2 + amount * 0.6), x, y, w, hh);
  }
  pfill(pats.speck, Math.max(0.6, ppm / 160), x - r() * 256, y - r() * 256, 0.35 + amount * 0.4, x, y, w, h);
  g.globalAlpha = 1;
  // grime band along the bottom edge (dust settles on the lower frame) and under the top edge
  const gb = g.createLinearGradient(0, y + h, 0, y + h - Math.min(h * 0.35, 0.25 * ppm));
  gb.addColorStop(0, `rgba(60,52,40,${0.12 + amount * 0.22})`); gb.addColorStop(1, 'rgba(60,52,40,0)');
  g.fillStyle = gb; g.fillRect(x, y, w, h);
  if (top) {
    const gt = g.createLinearGradient(0, y, 0, y + Math.min(h * 0.25, 0.12 * ppm));
    gt.addColorStop(0, `rgba(50,44,36,${0.1 + amount * 0.2})`); gt.addColorStop(1, 'rgba(50,44,36,0)');
    g.fillStyle = gt; g.fillRect(x, y, w, h);
  }
  // rust drips from fixings along the top
  if (rust) {
    const n = Math.max(1, Math.round((w / ppm) / 1.2 * amount));
    for (let i = 0; i < n; i++) {
      const sx = x + (0.05 + r() * 0.9) * w, len = (0.08 + r() * 0.5 * amount) * ppm, wd = Math.max(1, (0.01 + r() * 0.02) * ppm);
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, `rgba(120,62,28,${0.25 + amount * 0.35})`); gr.addColorStop(1, 'rgba(120,62,28,0)');
      g.fillStyle = gr; g.fillRect(sx - wd / 2, y, wd, len);
    }
  }
  // chipped paint along the edges (primer / bare metal showing)
  if (chips) {
    const n = Math.round(((w + h) / ppm) * 3 * amount);
    for (let i = 0; i < n; i++) {
      const side = r() * (w + h) * 2;
      let cx, cy;
      if (side < w) { cx = x + side; cy = y + r() * 0.03 * ppm; }
      else if (side < 2 * w) { cx = x + side - w; cy = y + h - r() * 0.03 * ppm; }
      else if (side < 2 * w + h) { cx = x + r() * 0.03 * ppm; cy = y + side - 2 * w; }
      else { cx = x + w - r() * 0.03 * ppm; cy = y + side - 2 * w - h; }
      const s = (0.004 + r() * 0.018) * ppm;
      g.fillStyle = r() < 0.5 ? 'rgba(92,70,52,0.75)' : 'rgba(210,206,196,0.7)';
      g.beginPath();
      g.moveTo(cx - s, cy); g.lineTo(cx - s * 0.2, cy - s * (0.6 + r() * 0.6)); g.lineTo(cx + s * (0.6 + r()), cy - s * 0.1); g.lineTo(cx + s * 0.1, cy + s * (0.5 + r() * 0.6));
      g.closePath(); g.fill();
    }
  }
  unclip(P);
}

// ---------------------------------------------------------------- bulbs and neon helpers
/** Painted bulb sockets around a rect (returned positions in px so 3D bulbs can sit on them). */
export function bulbRing(P, inset, spacing) {
  const { x, y, w, h, ppm } = P;
  const ins = inset * ppm, sp = spacing * ppm;
  const pts = [];
  const nx = Math.max(2, Math.round((w - 2 * ins) / sp)), ny = Math.max(2, Math.round((h - 2 * ins) / sp));
  for (let i = 0; i <= nx; i++) { pts.push([x + ins + ((w - 2 * ins) * i) / nx, y + ins]); pts.push([x + ins + ((w - 2 * ins) * i) / nx, y + h - ins]); }
  for (let j = 1; j < ny; j++) { pts.push([x + ins, y + ins + ((h - 2 * ins) * j) / ny]); pts.push([x + w - ins, y + ins + ((h - 2 * ins) * j) / ny]); }
  return pts;
}
export function paintSockets(P, pts, rad, lit = '#ffd27a') {
  const { g } = P;
  const R = Math.max(1.2, rad * P.ppm);
  for (const [px, py] of pts) {
    g.fillStyle = '#2a2622'; g.beginPath(); g.arc(px, py, R * 1.25, 0, Math.PI * 2); g.fill();
    const gr = g.createRadialGradient(px - R * 0.3, py - R * 0.3, R * 0.1, px, py, R);
    gr.addColorStop(0, '#fffaf0'); gr.addColorStop(0.6, '#e9dcc0'); gr.addColorStop(1, '#9a8a70');
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, R, 0, Math.PI * 2); g.fill();
  }
  emit(P, (ge) => {
    for (const [px, py] of pts) {
      const gr = ge.createRadialGradient(px, py, 0, px, py, R * 2.4);
      gr.addColorStop(0, lit); gr.addColorStop(0.45, rgba(lit, 0.55)); gr.addColorStop(1, rgba(lit, 0));
      ge.fillStyle = gr; ge.beginPath(); ge.arc(px, py, R * 2.4, 0, Math.PI * 2); ge.fill();
    }
  });
}

/** Copy the albedo of the region into the emissive page (backlit acrylic face). */
function backlight(P, k) {
  // recorded only; composited per page once (see signage.js) to avoid per-region canvas snapshots
  if (!P.ge || !P.backlit) return;
  P.backlit.push([P.x, P.y, P.w, P.h, k]);
}

const NEON = ['#ff3b30', '#ff6a2a', '#ffd23a', '#4dd2ff', '#7cff6a', '#ff5ab4', '#ffffff', '#b06cff'];
function neonStyle(r, scheme, tubeW = 0.032) {
  const c = r.pick(NEON);
  return {
    day: { fill: scheme.fg, weight: 0.05, shadow: { dx: 0.03, dy: 0.04, color: 'rgba(0,0,0,0.35)' }, tube: { color: 'rgba(236,228,222,0.95)', hi: 'rgba(255,255,255,0.95)', shadow: 'rgba(0,0,0,0.5)', w: tubeW } },
    night: { fill: rgba(c, 0.35), tube: { color: c, hi: '#ffffff', w: tubeW * 1.4 }, weight: 0.0 },
    color: c,
  };
}

// ---------------------------------------------------------------- face painters

/**
 * Fascia board (horizontal). spec: { text, sub?, phone?, scheme, adopted? {inkH_m, fg}, layout,
 * textKind, lit, weather, emblem? }
 */
export function paintFascia(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  const S = spec.scheme;
  clip(P);
  board(P, S.bg, { seams: spec.seams ? 1.8 : 0, gloss: spec.lit === 'backlit' ? 0.1 : 0.05 });
  // coloured trim bands (top/bottom) — common on period shop fascias
  const band = spec.band;
  if (band) {
    const bh = band.h * ppm;
    if (band.top) fillR(g, x, y, w, bh, band.color);
    if (band.bottom) fillR(g, x, y + h - bh, w, bh, band.color);
    if (band.stripe) { fillR(g, x, y + bh + 2, w, Math.max(1, 0.012 * ppm), band.stripe); fillR(g, x, y + h - bh - 2 - Math.max(1, 0.012 * ppm), w, Math.max(1, 0.012 * ppm), band.stripe); }
  }
  let tx0 = x + 0.08 * ppm, tx1 = x + w - 0.08 * ppm;
  // adopted stable text is laid out first so optional decorations only use the free space
  let adoptedL = null;
  if (spec.adopted) {
    const targetPx = spec.adopted.inkH_m * ppm;
    let px = targetPx;
    for (let i = 0; i < 3; i++) px *= targetPx / Math.max(1, inkHeight(g, spec.text, px));
    const off = inkCenterOffset(g, spec.text, px);
    const acx = x + spec.adopted.u_px, acy = y + spec.adopted.v_px;
    const track = spec.track ?? 0.06;
    const nat = measureH(g, spec.text, px, { track });
    const maxW = Math.min((acx - x) * 2, (x + w - acx) * 2) - 0.1 * ppm;
    const sx = Math.min(1, Math.max(0.6, maxW / nat));
    adoptedL = layoutHorizontal(g, spec.text, acx, acy - off, px, { sx, track });
    spec.adoptedRendered = { px, inkH_px: inkHeight(g, spec.text, px), sx, width_px: adoptedL.width };
    tx0 = acx - adoptedL.width / 2; tx1 = acx + adoptedL.width / 2;
  }
  // emblem block at the left (coloured square/disc with a single generic character, e.g. 茶 麻 酒)
  if (spec.emblem) {
    const es = Math.min(h * 0.82, 0.75 * ppm);
    const ex = x + Math.max(0.12 * ppm, (h - es) / 2), ey = y + (h - es) / 2;
    if (!adoptedL || ex + es + 0.1 * ppm < tx0) {
      if (spec.emblem.round) { g.fillStyle = spec.emblem.bg; g.beginPath(); g.arc(ex + es / 2, ey + es / 2, es / 2, 0, Math.PI * 2); g.fill(); }
      else fillR(g, ex, ey, es, es, spec.emblem.bg);
      textH(P, spec.emblem.ch, ex + es / 2, ey + es / 2, es * 0.8, es * 0.8, { fill: spec.emblem.fg, weight: 0.05 });
      if (!adoptedL) tx0 = ex + es + 0.12 * ppm;
    }
  }
  // right info block: phone / sub line in small type
  if (spec.side) {
    const sw = Math.min(w * 0.28, Math.max(0.7, spec.side.length * 0.11) * ppm);
    const sx = x + w - sw - 0.08 * ppm;
    if (!adoptedL || sx > tx1 + 0.1 * ppm) {
      textH(P, spec.side, sx + sw / 2, y + h * 0.5, sw, h * 0.26, { fill: spec.subColor || S.fg, weight: 0.02 }, { minSx: 0.45 });
      if (!adoptedL) tx1 = sx - 0.08 * ppm;
    }
  }
  const cx = (tx0 + tx1) / 2;
  if (adoptedL) {
    // adopted text keeps the default face and no jitter (its ink height/centre are verified)
    drawGlyphs(g, adoptedL.glyphs, { ...textStyle(r, { ...S, fg: spec.adopted.fg }, spec.textKind || 'heavy'), fill: spec.adopted.fg, family: null, hand: 0 });
  } else if (spec.text) {
    const mainH = spec.sub ? h * 0.56 : h * 0.72;
    const my = spec.sub ? y + h * 0.4 : y + h * 0.52;
    const style = spec.neon ? spec.neon.day : textStyle(r, S, spec.textKind || 'heavy');
    textH(P, spec.text, cx, my, tx1 - tx0, mainH, style, { maxSx: 1.0, minSx: 0.42, track: spec.track || 0.04, emit: spec.neon ? spec.neon.night : null });
    if (spec.sub) textH(P, spec.sub, cx, y + h * 0.82, (tx1 - tx0) * 0.8, h * 0.2, { fill: spec.subColor || S.fg, weight: 0.02 }, { minSx: 0.5, track: 0.1 });
  }
  if (spec.borderColor) border(P, spec.borderColor, 0.025, spec.pin ? { color: spec.pin, w: 0.008, gap: 0.02 } : null);
  if (spec.lit === 'backlit') backlight(P, 0.55);
  unclip(P);
  if (spec.bulbs) { spec.bulbPx = bulbRing(P, 0.06, spec.bulbs); paintSockets(P, spec.bulbPx, 0.022); }
  weather(P, stamps, spec.weather ?? 0.5);
}

/**
 * Vertical projecting sign face. spec.panels: [{ label?, text, trade?, scheme, kind }] stacked
 * top-to-bottom; spec.header?: {text, scheme}; spec.neon?; spec.bulbs?
 */
export function paintVertical(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  clip(P);
  const total = spec.panels.reduce((s, p) => s + (p.weight || 1), 0);
  const gap = Math.max(1, 0.025 * ppm);
  let yy = y;
  const head = spec.header ? Math.min(h * 0.18, Math.max(0.35, w / ppm * 0.9) * ppm) : 0;
  if (head) {
    const S = spec.header.scheme;
    board({ ...P, h: head }, S.bg, {});
    textH({ ...P, h: head }, spec.header.text, x + w / 2, y + head / 2, w * 0.86, head * 0.62, { fill: S.fg, weight: 0.06 }, { minSx: 0.5 });
    yy += head;
    fillR(g, x, yy, w, gap, '#2b2824'); yy += gap;
  }
  const avail = y + h - yy;
  spec.panels.forEach((p, i) => {
    const ph = (avail * (p.weight || 1)) / total - (i < spec.panels.length - 1 ? gap : 0);
    const S = p.scheme;
    const PP = { ...P, y: yy, h: ph };
    board(PP, S.bg, { gloss: spec.lit === 'backlit' ? 0.12 : 0.05 });
    let ty = yy + 0.04 * ppm, th = ph - 0.08 * ppm;
    if (p.label) {
      // floor label: coloured disc or band at the top of the panel
      const ls = Math.min(w * 0.7, 0.42 * ppm, ph * 0.3);
      if (p.labelStyle === 'disc') {
        g.fillStyle = S.ac; g.beginPath(); g.arc(x + w / 2, yy + ls * 0.62, ls / 2, 0, Math.PI * 2); g.fill();
        textH(PP, p.label, x + w / 2, yy + ls * 0.62, ls * 0.8, ls * 0.6, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f4f1ea', weight: 0.06 }, { minSx: 0.5 });
      } else {
        fillR(g, x, yy, w, ls * 1.05, S.ac);
        textH(PP, p.label, x + w / 2, yy + ls * 0.55, w * 0.8, ls * 0.7, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f4f1ea', weight: 0.06 }, { minSx: 0.5 });
      }
      ty = yy + ls * 1.2; th = ph - ls * 1.2 - 0.05 * ppm;
    }
    const style = spec.neon ? spec.neon.day : textStyle(r, S, p.kind || 'heavy');
    const emitStyle = spec.neon ? spec.neon.night : null;
    if (p.trade && p.name && w / ppm > 0.55 && th > w * 2.2) {
      // two columns: trade word small on the right, name large on the left (read right-to-left)
      const cw = w * 0.36;
      textV(PP, p.trade, x + w - cw * 0.62, ty, cw, th, { fill: S.fg, weight: 0.03 }, { valign: 'top', adv: 1.0, stretch: false });
      textV(PP, p.name, x + (w - cw) * 0.5, ty, w - cw * 1.1, th, style, { adv: 1.06, emit: emitStyle });
    } else {
      textV(PP, p.text, x + w / 2, ty, w * 0.94, th, style, { adv: 1.06, emit: emitStyle, fillW: 0.84 });
    }
    if (p.small) {
      // tiny phone line at the panel foot
      textH(PP, p.small, x + w / 2, yy + ph - 0.07 * ppm, w * 0.9, 0.07 * ppm, { fill: S.fg, weight: 0.0 }, { minSx: 0.3 });
    }
    yy += ph;
    if (i < spec.panels.length - 1) { fillR(g, x, yy, w, gap, '#2b2824'); yy += gap; }
  });
  if (spec.lit === 'backlit') backlight(P, 0.6);
  border(P, spec.frame || '#3a3631', 0.02);
  unclip(P);
  if (spec.bulbs) { spec.bulbPx = bulbRing(P, 0.05, spec.bulbs); paintSockets(P, spec.bulbPx, 0.02); }
  weather(P, stamps, spec.weather ?? 0.55);
}

/** Rooftop billboard. spec: { text, top?, sub?, scheme, motif, textKind } */
export function paintRoof(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  const S = spec.scheme;
  clip(P);
  board(P, S.bg, { seams: 1.2, gloss: 0.04 });
  // simple period graphic motifs (no logos): sunburst, diagonal stripes, big disc, side panel
  const m = spec.motif;
  if (m === 'burst') {
    g.save(); g.translate(x + w * 0.12, y + h * 0.5); g.fillStyle = rgba(S.ac, 0.85);
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(w, -h * 0.08); g.lineTo(w, h * 0.08); g.closePath(); if (i % 2 === 0) g.fill(); }
    g.restore();
    g.fillStyle = S.bg; g.beginPath(); g.ellipse(x + w * 0.55, y + h * 0.5, w * 0.4, h * 0.42, 0, 0, Math.PI * 2); g.fill();
  } else if (m === 'stripes') {
    // r04: horizontal double rules (the r02 diagonal border read as a hazard/works stripe)
    g.fillStyle = rgba(S.ac, 0.9);
    for (const [f0, f1] of [[0.06, 0.1], [0.13, 0.15], [0.85, 0.87], [0.9, 0.94]]) g.fillRect(x + h * 0.06, y + h * f0, w - h * 0.12, h * (f1 - f0));
  } else if (m === 'disc') {
    g.fillStyle = S.ac; g.beginPath(); g.arc(x + h * 0.55, y + h * 0.5, h * 0.4, 0, Math.PI * 2); g.fill();
    textH(P, spec.discCh || '◎', x + h * 0.55, y + h * 0.5, h * 0.55, h * 0.55, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f5f2ea', weight: 0.06 });
  } else if (m === 'panel') {
    fillR(g, x + w - w * 0.22, y, w * 0.22, h, S.ac);
    textV({ ...P }, spec.panelText || '営業中', x + w - w * 0.11, y + h * 0.06, w * 0.18, h * 0.88, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f5f2ea', weight: 0.05 });
  }
  const left = m === 'disc' ? x + h * 1.05 : m === 'burst' ? x + w * 0.18 : x + 0.2 * ppm;
  const right = m === 'panel' ? x + w * 0.76 : x + w - 0.2 * ppm;
  const cx = (left + right) / 2;
  const style = textStyle(r, S, spec.textKind || 'shadow');
  if (spec.top) textH(P, spec.top, cx, y + h * 0.17, (right - left) * 0.8, h * 0.16, { fill: S.ac === S.bg ? S.fg : (lum(S.bg) < 0.45 ? S.ac : S.fg), weight: 0.03 }, { track: 0.15 });
  textH(P, spec.text, cx, y + h * (spec.top ? 0.55 : 0.47), right - left, h * (spec.sub ? 0.5 : 0.62), style, { minSx: 0.5, track: 0.03 });
  if (spec.sub) textH(P, spec.sub, cx, y + h * 0.86, (right - left) * 0.85, h * 0.13, { fill: S.fg, weight: 0.02 }, { track: 0.1 });
  border(P, spec.frame || shade(S.bg, -0.45), 0.05);
  if (spec.lit === 'backlit') backlight(P, 0.35);
  unclip(P);
  if (spec.bulbs) { spec.bulbPx = bulbRing(P, 0.12, spec.bulbs); paintSockets(P, spec.bulbPx, 0.035); }
  weather(P, stamps, spec.weather ?? 0.75);
}

/** Cloth awning top (slope) — stripes or solid, sun-faded towards the outer edge. */
export function paintAwningTop(P, spec, stamps) {
  const { g, x, y, w, h, ppm } = P;
  clip(P);
  fillR(g, x, y, w, h, spec.c1);
  if (spec.stripes) {
    const sw = spec.stripeW * ppm;
    for (let sx = x; sx < x + w; sx += sw * 2) fillR(g, sx, y, sw, h, spec.c2);
  }
  // canvas weave and slope shading: darker at the wall (top of region), faded at the edge
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.03)'); gr.addColorStop(1, 'rgba(255,250,240,0.1)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  for (let yy = y; yy < y + h; yy += Math.max(2, 0.012 * ppm)) fillR(g, x, yy, w, 1, 'rgba(0,0,0,0.035)');
  unclip(P);
  weather(P, stamps, spec.weather ?? 0.6, { chips: false, rust: false, top: false });
}

/** Awning valance (front flap) with shop text and optional scalloped hem (alpha). */
export function paintValance(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  clip(P);
  fillR(g, x, y, w, h, spec.c1);
  if (spec.stripes && !spec.text) { const sw = spec.stripeW * ppm; for (let sx = x; sx < x + w; sx += sw * 2) fillR(g, sx, y, sw, h, spec.c2); }
  if (spec.text) {
    const style = { fill: spec.fg, weight: 0.05 };
    textH(P, spec.text, x + w / 2, y + h * 0.46, w * 0.85, h * 0.6, style, { minSx: 0.5, track: 0.15 });
    if (spec.side) {
      textH(P, spec.side, x + w * 0.1, y + h * 0.46, w * 0.15, h * 0.3, { fill: spec.fg, weight: 0.02 }, { minSx: 0.4 });
      textH(P, spec.side2 || spec.side, x + w * 0.9, y + h * 0.46, w * 0.15, h * 0.3, { fill: spec.fg, weight: 0.02 }, { minSx: 0.4 });
    }
  }
  fillR(g, x, y, w, Math.max(1, 0.012 * ppm), 'rgba(0,0,0,0.25)');
  unclip(P);
  weather(P, stamps, spec.weather ?? 0.6, { chips: false, rust: false });
  if (spec.scallop) {
    // cut scallops out of the hem: alpha 0 below arcs (cloth material uses alphaTest)
    const sc = spec.scallop * ppm, depth = Math.min(h * 0.3, sc * 0.45);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    for (let sx = x; sx < x + w; sx += sc) {
      g.beginPath();
      g.moveTo(sx, y + h + 2);
      g.lineTo(sx, y + h - depth * 0.1);
      g.quadraticCurveTo(sx + sc / 2, y + h - depth * 2.1 + depth, sx + sc, y + h - depth * 0.1);
      g.lineTo(sx + sc, y + h + 2);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
}

/** Noren: 3–5 cloth panels with slits (alpha), big white characters across, rod hem at the top. */
export function paintNoren(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  clip(P);
  fillR(g, x, y, w, h, spec.c1);
  // indigo dye unevenness
  for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.04})`; g.fillRect(x + r() * w, y, w * 0.2, h); }
  fillR(g, x, y, w, 0.06 * ppm, shade(spec.c1, -0.3));
  const n = spec.panels;
  const chars = [...spec.text];
  const pw = w / n;
  if (chars.length <= n) {
    // one character per panel, centred in the panel span
    const start = Math.floor((n - chars.length) / 2);
    chars.forEach((c, i) => textH(P, c, x + pw * (start + i + 0.5), y + h * 0.55, pw * 0.82, h * 0.6, { fill: spec.fg, weight: 0.06 }));
  } else {
    textH(P, spec.text, x + w / 2, y + h * 0.55, w * 0.9, h * 0.55, { fill: spec.fg, weight: 0.05 }, { minSx: 0.5 });
  }
  unclip(P);
  weather(P, stamps, spec.weather ?? 0.5, { chips: false, rust: false, top: false });
  // slits between panels (from just below the hem to the bottom)
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  const sw = Math.max(2, 0.025 * ppm);
  for (let i = 1; i < n; i++) g.fillRect(x + pw * i - sw / 2, y + 0.1 * ppm, sw, h);
  g.restore();
}

/** Standing sign face: menu board / vertical name. spec.layout: 'menu' | 'vname' */
export function paintStand(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  const S = spec.scheme;
  clip(P);
  board(P, S.bg, { gloss: 0.08 });
  if (spec.layout === 'menu') {
    fillR(g, x, y, w, h * 0.22, S.ac);
    textH(P, spec.title, x + w / 2, y + h * 0.11, w * 0.86, h * 0.15, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f4f1ea', weight: 0.05 }, { minSx: 0.45 });
    const items = spec.items || [];
    items.forEach((it, i) => textH(P, it, x + w / 2, y + h * (0.32 + i * 0.13), w * 0.84, h * 0.08, { fill: S.fg, weight: 0.02 }, { minSx: 0.4 }));
  } else {
    if (spec.label) { fillR(g, x, y, w, h * 0.16, S.ac); textH(P, spec.label, x + w / 2, y + h * 0.08, w * 0.8, h * 0.1, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f4f1ea', weight: 0.05 }, { minSx: 0.4 }); }
    textV(P, spec.title, x + w / 2, y + h * (spec.label ? 0.2 : 0.06), w * 0.9, h * (spec.label ? 0.72 : 0.86), textStyle(r, S, spec.textKind || 'heavy'), { adv: 1.04 });
  }
  border(P, spec.frame || shade(S.bg, -0.5), 0.015);
  if (spec.lit === 'backlit') backlight(P, 0.7);
  unclip(P);
  weather(P, stamps, spec.weather ?? 0.45, { rust: false });
}

/** Wall board / banner (large flush board on upper floors): big text + small line. */
export function paintWallboard(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  const S = spec.scheme;
  clip(P);
  board(P, S.bg, { seams: 1.0 });
  const vertical = h > w * 1.4;
  if (vertical) {
    if (spec.label) { fillR(g, x, y, w, Math.min(h * 0.14, w * 0.5), S.ac); textH(P, spec.label, x + w / 2, y + Math.min(h * 0.07, w * 0.25), w * 0.8, Math.min(h * 0.1, w * 0.36), { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f4f1ea', weight: 0.06 }, { minSx: 0.5 }); }
    textV(P, spec.text, x + w / 2, y + h * 0.17, w * 0.92, h * 0.78, textStyle(r, S, spec.textKind || 'heavy'), { adv: 1.05 });
  } else {
    const lw = spec.label ? Math.min(w * 0.22, h * 0.95) : 0;
    if (lw) {
      fillR(g, x + 0.05 * ppm, y + (h - lw * 0.9) / 2, lw, lw * 0.9, S.ac);
      textH(P, spec.label, x + 0.05 * ppm + lw / 2, y + h / 2, lw * 0.8, lw * 0.5, { fill: lum(S.ac) > 0.55 ? '#1b1a17' : '#f4f1ea', weight: 0.06 }, { minSx: 0.5 });
    }
    const l = x + lw + 0.15 * ppm, rr = x + w - 0.12 * ppm;
    textH(P, spec.text, (l + rr) / 2, y + h * (spec.sub ? 0.42 : 0.5), rr - l, h * (spec.sub ? 0.55 : 0.68), textStyle(r, S, spec.textKind || 'heavy'), { minSx: 0.45, track: 0.04 });
    if (spec.sub) textH(P, spec.sub, (l + rr) / 2, y + h * 0.83, (rr - l) * 0.85, h * 0.15, { fill: S.fg, weight: 0.02 }, { track: 0.08, minSx: 0.4 });
  }
  border(P, shade(S.bg, -0.4), 0.03);
  unclip(P);
  weather(P, stamps, spec.weather ?? 0.65);
}

/** Small projecting light box (two faces share this): vertical or square with 1–4 chars. */
export function paintLightbox(P, spec, stamps) {
  const { g, x, y, w, h, ppm, r } = P;
  const S = spec.scheme;
  clip(P);
  board(P, S.bg, { gloss: 0.12 });
  if (spec.disc) {
    // round sign: ring + single character (UVs map the disc onto this square)
    g.strokeStyle = S.ac; g.lineWidth = w * 0.07;
    g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.43, 0, Math.PI * 2); g.stroke();
    textH(P, spec.text, x + w / 2, y + h / 2, w * 0.6, h * 0.6, textStyle(r, S, 'heavy'));
    unclip(P);
    weather(P, stamps, spec.weather ?? 0.4, { rust: false, chips: false });
    return;
  }
  if (h > w * 1.3) textV(P, spec.text, x + w / 2, y + 0.04 * ppm, w * 0.9, h - 0.08 * ppm, textStyle(r, S, spec.textKind || 'heavy'), { adv: 1.02 });
  else textH(P, spec.text, x + w / 2, y + h / 2, w * 0.86, h * 0.62, textStyle(r, S, spec.textKind || 'heavy'), { minSx: 0.5 });
  border(P, spec.frame || '#3b3631', 0.018);
  if (spec.lit === 'backlit') backlight(P, 0.75);
  unclip(P);
  weather(P, stamps, spec.weather ?? 0.4, { rust: false });
}

/** Barber pole: diagonal red/white/blue stripes wrapping once around (u = circumference). */
export function paintPole(P) {
  const { g, x, y, w, h } = P;
  clip(P);
  fillR(g, x, y, w, h, '#f3f0ea');
  const cols = ['#c0261d', '#f3f0ea', '#1f4a91', '#f3f0ea'];
  const band = w / 4;
  g.save(); g.translate(x, y);
  for (let k = -8; k < 12; k++) {
    g.fillStyle = cols[((k % 4) + 4) % 4];
    g.beginPath(); g.moveTo(k * band, h); g.lineTo((k + 1) * band, h); g.lineTo((k + 1) * band + w, 0); g.lineTo(k * band + w, 0); g.closePath(); g.fill();
  }
  g.restore();
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.05)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.05)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  unclip(P);
}

export const PAINTERS = { pole: paintPole, fascia: paintFascia, vertical: paintVertical, roof: paintRoof, awningTop: paintAwningTop, valance: paintValance, noren: paintNoren, stand: paintStand, wallboard: paintWallboard, lightbox: paintLightbox };
export { neonStyle, textStyle };
