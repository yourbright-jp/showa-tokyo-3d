// Japanese typesetting on a 2D canvas for sign faces.
// Horizontal (yokogaki) and vertical (tategaki) layout with:
//  - long vowel mark, dashes, wave dash and brackets rotated 90° in vertical text,
//  - small kana and 、。 moved to the upper-right of their cell in vertical text,
//  - short Latin/digit runs (e.g. "3F") set upright side-by-side in one cell (tate-chu-yoko),
//  - condensed horizontal scaling to fit, letter spacing,
//  - heavy lettering via stroke+fill, outlines, drop shadows.
// System fonts only (no font files are fetched): IPAGothic / IPAMincho (IPA Font License v1.0),
// Motoya L Maruberi / Motoya L Cedar (Apache-2.0), WenQuanYi Zen Hei for Latin/digits fallback.
// r04: one modern digital gothic for ~1,100 signs read as a modern typeface (history review), so
// painted signs pick a family per sign and get deterministic per-glyph hand variation.

export const FONT_JP = '"IPAGothic", "IPAPGothic", "WenQuanYi Zen Hei", sans-serif';
export const FONT_MINCHO = '"IPAMincho", "IPAPMincho", "IPAGothic", serif';
export const FONT_MARU = '"MotoyaLMaru", "IPAGothic", sans-serif';
export const FONT_CEDAR = '"MotoyaLCedar", "IPAGothic", sans-serif';
export const FONT_ALT = '"WenQuanYi Zen Hei", "IPAGothic", sans-serif'; // Latin/digits only

const ROTATE_V = new Set(['ー', '－', '〜', '～', '…', '‥', '—', '―', '（', '）', '「', '」', '『', '』', '【', '】', '〈', '〉', '《', '》', '(', ')', '-', '=', '＝', '~']);
const SMALL_KANA = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ']);
const PUNCT_V = new Set(['、', '。', '，', '．']);
const isAscii = (c) => c.charCodeAt(0) < 0x7f && c !== ' ';
const isNarrow = (c) => c.charCodeAt(0) < 0x2000;

/** Split text into units for vertical layout: single chars, or runs of ≤3 ASCII chars. */
function verticalUnits(text) {
  const out = [];
  const s = [...text];
  for (let i = 0; i < s.length;) {
    if (isAscii(s[i])) {
      let j = i;
      while (j < s.length && isAscii(s[j])) j++;
      const run = s.slice(i, j).join('');
      if (run.length <= 3) out.push({ t: run, tcy: true });
      else for (const c of run) out.push({ t: c, sideways: true });
      i = j;
    } else if (s[i] === ' ' || s[i] === '　') { out.push({ t: ' ', space: true }); i++; }
    else { out.push({ t: s[i] }); i++; }
  }
  return out;
}

/**
 * Glyph placements for a vertical column centred at x, starting at top y.
 * Returns { glyphs, height }. adv = advance in em (1.0 = solid set).
 */
export function layoutVertical(g, text, x, top, px, { adv = 1.0, family = FONT_JP, sy = 1 } = {}) {
  const units = verticalUnits(text);
  const glyphs = [];
  let y = top;
  const step = px * adv * sy;
  for (const u of units) {
    const cy = y + step / 2;
    if (u.space) { y += step * 0.5; continue; }
    if (u.tcy) {
      g.font = `${px}px ${FONT_ALT}`;
      const w = g.measureText(u.t).width;
      const sx = Math.min(1, (px * 0.92) / Math.max(1, w));
      glyphs.push({ ch: u.t, x, y: cy, px, sx, sy: Math.min(1, sy), rot: 0, family: FONT_ALT });
    } else if (u.sideways || ROTATE_V.has(u.t)) {
      glyphs.push({ ch: u.t, x, y: cy, px, sx: 1, sy: 1, rot: Math.PI / 2, family });
    } else if (SMALL_KANA.has(u.t)) {
      glyphs.push({ ch: u.t, x: x + px * 0.11, y: cy - px * 0.11 * sy, px, sx: 1, sy, rot: 0, family });
    } else if (PUNCT_V.has(u.t)) {
      glyphs.push({ ch: u.t, x: x + px * 0.58, y: cy - px * 0.56 * sy, px, sx: 1, sy, rot: 0, family });
    } else {
      glyphs.push({ ch: u.t, x, y: cy, px, sx: 1, sy, rot: 0, family });
    }
    y += step;
  }
  return { glyphs, height: y - top };
}

/** Natural (unscaled) width of horizontal text at px with letter spacing `track` (em). */
export function measureH(g, text, px, { family = FONT_JP, track = 0 } = {}) {
  let w = 0;
  const chars = [...text];
  for (const c of chars) {
    g.font = `${px}px ${isNarrow(c) ? FONT_ALT : family}`;
    w += c === ' ' ? px * 0.35 : g.measureText(c).width;
  }
  return w + Math.max(0, chars.length - 1) * track * px;
}

/** Glyph placements for horizontal text centred at (cx, cy), condensed by sx. */
export function layoutHorizontal(g, text, cx, cy, px, { sx = 1, family = FONT_JP, track = 0, align = 'center' } = {}) {
  const chars = [...text];
  const widths = chars.map((c) => {
    g.font = `${px}px ${isNarrow(c) ? FONT_ALT : family}`;
    return c === ' ' ? px * 0.35 : g.measureText(c).width;
  });
  const total = (widths.reduce((a, b) => a + b, 0) + Math.max(0, chars.length - 1) * track * px) * sx;
  let x = align === 'center' ? cx - total / 2 : align === 'left' ? cx : cx - total;
  const glyphs = [];
  chars.forEach((c, i) => {
    const w = widths[i] * sx;
    if (c !== ' ') glyphs.push({ ch: c, x: x + w / 2, y: cy, px, sx, sy: 1, rot: 0, family: isNarrow(c) ? FONT_ALT : family });
    x += w + track * px * sx;
  });
  return { glyphs, width: total };
}

/**
 * Fit horizontal text into a box: returns { px, sx }. Prefers the requested px, condenses
 * down to minSx, then shrinks px. maxSx allows slight expansion of short words.
 */
export function fitH(g, text, boxW, boxH, { family = FONT_JP, track = 0, minSx = 0.55, maxSx = 1.0, px = null } = {}) {
  let p = px || boxH;
  let w = measureH(g, text, p, { family, track });
  let sx = boxW / Math.max(1, w);
  if (sx < minSx) { p *= sx / minSx; sx = minSx; }
  return { px: p, sx: Math.min(maxSx, sx) };
}

/** Ink height (ascent+descent) of text at px — used to hit an exact glyph height. */
export function inkHeight(g, text, px, family = FONT_JP) {
  g.font = `${px}px ${family}`;
  const m = g.measureText(text);
  return (m.actualBoundingBoxAscent || px * 0.8) + (m.actualBoundingBoxDescent || px * 0.1);
}
/** Vertical offset of the ink centre relative to the em 'middle' baseline (positive = ink sits lower). */
export function inkCenterOffset(g, text, px, family = FONT_JP) {
  g.font = `${px}px ${family}`;
  g.textBaseline = 'middle';
  const m = g.measureText(text);
  return ((m.actualBoundingBoxDescent || 0) - (m.actualBoundingBoxAscent || 0)) / 2;
}

function eachGlyph(g, glyphs, fn) {
  for (const q of glyphs) {
    g.save();
    g.translate(q.x + (q.jx || 0), q.y + (q.jy || 0));
    if (q.rot || q.jr) g.rotate((q.rot || 0) + (q.jr || 0));
    g.scale(q.sx * (q.js || 1), (q.sy || 1) * (q.js || 1));
    g.font = `${q.px}px ${q.family}`;
    fn(q);
    g.restore();
  }
}

/**
 * Render glyphs with a style:
 *  fill, weight (extra stroke as fraction of px, makes heavy lettering),
 *  outline:[{color, w}] (outer strokes, w as fraction of px, drawn largest first),
 *  shadow:{dx, dy, color, blur} (dx,dy as fraction of px),
 *  tube: {color, w, shadow} draws a neon-tube outline along glyph edges.
 */
function glyphHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Apply style.family (CJK glyphs only) and deterministic hand-painted jitter (style.hand 0..1). */
function personalise(glyphs, style) {
  if (!style.family && !style.hand) return glyphs;
  const hand = style.hand || 0;
  return glyphs.map((q) => {
    const family = style.family && q.family !== FONT_ALT ? style.family : q.family;
    if (!hand) return { ...q, family };
    const r = glyphHash(`${q.ch}|${Math.round(q.x)}|${Math.round(q.y)}|${q.px.toFixed(1)}`);
    // Only offsets and per-glyph brush weight vary: per-glyph size or rotation defeats the glyph
    // cache and tripled the sign painting time on the CPU rasteriser.
    return { ...q, family, jx: (r() - 0.5) * 0.04 * q.px * hand, jy: (r() - 0.5) * 0.04 * q.px * hand, jw: 1 + Math.round((r() - 0.5) * 2) * 0.3 * hand }; // 3 weight steps (cache friendly)
  });
}

export function drawGlyphs(g, glyphs, style) {
  if (!glyphs.length) return;
  glyphs = personalise(glyphs, style);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const px = glyphs[0].px;
  // r04: heavy strokes/outlines closed up small glyphs into blobs (e.g. 鈴蘭, 眼鏡 on distant
  // boards); thin them progressively below ~50 px per em
  const small = Math.min(1, Math.max(0.3, (px - 10) / 40));
  const weight = (style.weight || 0) * px * small;
  const outlines = (style.outline || []).slice().sort((a, b) => b.w - a.w).map((o) => ({ ...o, w: o.w * (0.5 + 0.5 * small) }));
  const lw = (w, q) => (w * (q.jw || 1)) / Math.max(0.3, Math.min(q.sx, q.sy || 1));
  if (style.shadow) {
    const s = style.shadow;
    const ow = outlines.length ? outlines[0].w * px * 2 : 0;
    g.save();
    g.fillStyle = s.color; g.strokeStyle = s.color;
    if (s.blur) g.filter = `blur(${Math.max(0.5, s.blur * px).toFixed(1)}px)`;
    eachGlyph(g, glyphs.map((q) => ({ ...q, x: q.x + s.dx * px, y: q.y + s.dy * px })), (q) => {
      if (weight + ow > 0) { g.lineWidth = lw(weight + ow, q); g.strokeText(q.ch, 0, 0); }
      g.fillText(q.ch, 0, 0);
    });
    g.restore();
  }
  for (const o of outlines) {
    g.strokeStyle = o.color;
    eachGlyph(g, glyphs, (q) => { g.lineWidth = lw(weight + o.w * px * 2, q); g.strokeText(q.ch, 0, 0); });
  }
  if (style.fill) {
    g.fillStyle = style.fill;
    g.strokeStyle = style.fill;
    eachGlyph(g, glyphs, (q) => {
      if (weight > 0) { g.lineWidth = lw(weight, q); g.strokeText(q.ch, 0, 0); }
      g.fillText(q.ch, 0, 0);
    });
    if ((style.hand || 0) > 0.45 && glyphs[0].px > 40) {
      // second, slightly offset translucent pass: the uneven edge of a brush-painted letter
      g.save(); g.globalAlpha = 0.32;
      eachGlyph(g, glyphs.map((q) => ({ ...q, jx: (q.jx || 0) + q.px * 0.012, jy: (q.jy || 0) - q.px * 0.009 })), (q) => {
        if (weight > 0) { g.lineWidth = lw(weight * 0.8, q); g.strokeText(q.ch, 0, 0); }
        g.fillText(q.ch, 0, 0);
      });
      g.restore();
    }
  }
  if (style.tube) {
    // glass tube following the letter edge; dark offset shadow (tube stands off the board), body, highlight
    const t = style.tube;
    const tw = t.w * px;
    if (t.shadow) {
      g.strokeStyle = t.shadow;
      eachGlyph(g, glyphs.map((q) => ({ ...q, x: q.x + tw * 0.9, y: q.y + tw * 1.3 })), (q) => { g.lineWidth = lw(tw * 1.1, q); g.strokeText(q.ch, 0, 0); });
    }
    g.strokeStyle = t.color;
    eachGlyph(g, glyphs, (q) => { g.lineWidth = lw(tw, q); g.strokeText(q.ch, 0, 0); });
    if (t.hi) {
      g.strokeStyle = t.hi;
      eachGlyph(g, glyphs.map((q) => ({ ...q, x: q.x - tw * 0.18, y: q.y - tw * 0.22 })), (q) => { g.lineWidth = lw(tw * 0.32, q); g.strokeText(q.ch, 0, 0); });
    }
  }
}
