// 1970s Tokyo street wardrobe for procedural pedestrians.
//
// Evidence tier: period-plausible-generic. The archetypes follow the kinds of clothing visible
// in the approved colour references R01 (1978 source), R02 (1975 source) and R08 (1972 source):
// dark suits with white shirts and ties, short-sleeved white shirts with slacks, trench and
// wool coats, skirts/dresses below the knee, school uniforms, 1970s casual wear. Colours and
// mixes are working estimates, not counts of the 1976 crowd. No brand, logo or text is drawn.

// pattern layers in the fabric texture array (see people/fabric.js)
export const PAT = { plain: 0, pinstripe: 1, stripe: 2, check: 3, floral: 4, dots: 5, tweed: 6, denim: 7, knit: 8, wave: 9, border: 10 };

function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function hexRgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }

/** sRGB hex -> linear rgb with deterministic value/saturation jitter (and optional fading). */
export function colour(r, hex, vj = 0.08, sj = 0.1, fade = 0) {
  let [R, G, B] = hexRgb(hex);
  const v = 1 + (r() * 2 - 1) * vj;
  const l = 0.3 * R + 0.59 * G + 0.11 * B;
  const s = 1 + (r() * 2 - 1) * sj - fade;
  R = l + (R - l) * s; G = l + (G - l) * s; B = l + (B - l) * s;
  // a slight warm/cool cast so neighbouring garments of the same palette entry differ
  const t = (r() * 2 - 1) * 0.025;
  R *= v * (1 + t); G *= v; B *= v * (1 - t);
  return [srgbToLin(Math.min(1, Math.max(0, R))), srgbToLin(Math.min(1, Math.max(0, G))), srgbToLin(Math.min(1, Math.max(0, B)))];
}
export const lin = (hex) => hexRgb(hex).map(srgbToLin);

const P_ = {
  suit: [0x23272f, 0x1e222b, 0x2c2c2e, 0x353437, 0x44464a, 0x4a3a2c, 0x3b3226, 0x5e5e5d, 0x4d4632, 0x3a3f48, 0x2a2f2c, 0x262a30],
  suitLight: [0xa89878, 0x8d8d8a, 0x9c8160, 0x7e7462, 0xb0a48a],
  shirtWhite: [0xe0ddd4, 0xe6e3da, 0xd8dbdc, 0xdcd8cc, 0xe3e0d6],
  shirtPale: [0xb8c8dc, 0xc9d4e0, 0xe6dfcc, 0xe8e0b8, 0xd6dccf, 0xe3d2cc],
  tie: [0x6b1e24, 0x1e2a4a, 0x24412e, 0x5a3a22, 0xa8862a, 0x5a1a2a, 0x4a4a52, 0x2c3c6a, 0x7a3a1e],
  slacks: [0x5a5a5c, 0xa39274, 0x292c34, 0x5a4632, 0x262628, 0x7a7466, 0x4a4438, 0x8a7a60, 0x6a665c],
  casualShirt: [0xc49a3a, 0xa4502a, 0x6b6a3a, 0x6a4a30, 0xe2d6b8, 0x8fb0d0, 0xc2672e, 0x6e2a2e, 0x2e4a36, 0x5a3a4a, 0xd8c8a0, 0x3a5a7a],
  denim: [0x2c3a52, 0x46566e, 0x36445c, 0x323e54],
  blouse: [0xeeeae0, 0xeadfc6, 0xe2b4b8, 0xb8cce0, 0xe8dc9a, 0xc4b4d0, 0xe09a84, 0xb8d4c0, 0xf2f0ea],
  skirt: [0x2a3048, 0xb8a07a, 0x6a4a30, 0x6a6a6a, 0x252525, 0x6a2430, 0xa8824e, 0x34483a, 0x8a4a2a, 0x5a4a62],
  dress: [0xc86a3a, 0x4a6a48, 0xc8a848, 0xa83a34, 0x4a6aa0, 0xe8e4da, 0x7a3a5a, 0x3a4a6a, 0xd89a6a, 0x8a9a5a],
  coat: [0xa88456, 0xb8a27c, 0x262d42, 0x6a6a68, 0x5e2630, 0x5a412c, 0x2a2a2c, 0x8a7a5a, 0x3c4a3a],
  knit: [0xe0d6c0, 0x6a4e36, 0xc49a3a, 0x9a4a2a, 0x4a6a48, 0x2a3450, 0x7a7a78, 0x9a3030, 0xd8b890, 0x6a5a7a],
  shoeM: [0x18181a, 0x18181a, 0x2a1e16, 0x3a2a1e, 0x5a3a24],
  shoeF: [0x18181a, 0x2a1e16, 0xe0ddd5, 0xb8a080, 0x6a2e22, 0x5a3a24, 0x2a2a3a],
  skin: [0xc4906c, 0xbb8866, 0xb07c5c, 0xcc9c7c, 0xc09070, 0xa47252, 0xd0a586],
  hairDark: [0x141210, 0x1a1714, 0x221c18, 0x17140f, 0x1f1a16],
  hairBrown: [0x2a221c, 0x3a2e26, 0x30261e],
  hairGrey: [0x6e6a66, 0x4a4744, 0x9a9690, 0x5a5652],
  umbrella: [0x1a1a1c, 0x1e2440, 0x4a1e24, 0x23342a, 0x2a2a2e, 0x9c8a6a],
  bagM: [0x1a1a1a, 0x2a1e16, 0x4a3020, 0x3a2a20],
  bagF: [0x1a1a1a, 0x4a3020, 0x8a6440, 0xd8d4cc, 0x8a2a2a, 0x2a3048, 0xb08a5a],
  paper: [0xb0915e, 0xdcd8cc, 0xc9b48a],
};

const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

function baseBody(r, sex, age) {
  const f = sex === 'f';
  const student = age < 18;
  const H = student
    ? (f ? 1.52 + r.normal() * 0.04 : 1.62 + r.normal() * 0.055)
    : (f ? 1.545 + r.normal() * 0.05 : 1.672 + r.normal() * 0.058);
  return {
    sex, age,
    H: Math.min(f ? 1.68 : 1.84, Math.max(f ? 1.44 : 1.52, H)),
    heads: 7.45 + r.normal() * 0.15 + (student ? -0.15 : 0),
    girth: Math.max(0.86, Math.min(1.22, 1 + r.normal() * 0.065 + (age > 45 ? 0.06 : 0))),
    belly: age > 40 && !f ? r.range(0, 0.6) : r.range(0, 0.15),
    shoulderK: 1 + r.normal() * 0.04,
    skin: colour(r, pick(r, P_.skin), 0.06, 0.08),
  };
}

function hairFor(r, sex, age, style) {
  const grey = age > 52 ? r.chance(0.75) : age > 42 ? r.chance(0.3) : false;
  const col = colour(r, grey ? pick(r, P_.hairGrey) : (r.chance(0.12) && sex === 'f' && age < 35 ? pick(r, P_.hairBrown) : pick(r, P_.hairDark)), 0.12, 0.05);
  return { style, col };
}

function maleHair(r, age) {
  if (age > 50) return r.pick(['side-part', 'side-part', 'slick', 'balding', 'balding']);
  if (age > 35) return r.pick(['side-part', 'side-part', 'slick', 'perm', 'balding']);
  return r.pick(['side-part', 'side-part', 'long70', 'long70', 'perm', 'mop']);
}
function femaleHair(r, age) {
  if (age > 50) return r.pick(['short-perm', 'short-perm', 'bun']);
  if (age > 32) return r.pick(['short-perm', 'bob', 'shoulder', 'bun']);
  return r.pick(['long', 'long', 'long', 'bob', 'shoulder', 'shoulder', 'short-perm']);
}

function shoesM(r, kind = 'oxford') { return { kind, col: colour(r, pick(r, P_.shoeM), 0.1, 0.1) }; }
function shoesF(r) { return { kind: r.chance(0.2) ? 'boot' : 'pump', col: colour(r, pick(r, P_.shoeF), 0.1, 0.1) }; }

function maybeBag(r, P, kind, p) {
  if (!r.chance(p)) return;
  const f = P.sex === 'f';
  const hand = r.chance(0.55) ? 'R' : 'L';
  const cols = kind === 'paper' ? P_.paper : f ? P_.bagF : P_.bagM;
  P.bag = { kind, col: colour(r, pick(r, cols), 0.1, 0.1), hand };
}

function maybeUmbrella(r, P, p) {
  if (!r.chance(p)) return;
  const hand = P.bag && P.bag.hand === 'R' ? 'L' : 'R';
  P.umbrella = { col: colour(r, pick(r, P_.umbrella), 0.1, 0.1), hand };
}

function glasses(r, P, p, sunP = 0) {
  if (r.chance(sunP)) P.glasses = { kind: 'sun' };
  else if (r.chance(p)) P.glasses = { kind: 'clear' };
}

const plain = (col, extra = {}) => ({ col, col2: col, layer: PAT.plain, scale: 0.05, ...extra });

// ------------------------------------------------------------------ archetypes
// Each returns a fully specified look: body, hair, garments, accessories.
export const ARCHETYPES = [
  {
    id: 'salaryman-suit', weight: 22, sex: 'm', age: [23, 62],
    make(r, P) {
      const light = r.chance(0.15);
      const suit = colour(r, pick(r, light ? P_.suitLight : P_.suit), 0.1, 0.12);
      const pin = !light && r.chance(0.25);
      P.top = { kind: 'jacket', ...plain(suit), layer: pin ? PAT.pinstripe : r.chance(0.2) ? PAT.tweed : PAT.plain, col2: pin ? suit.map((c) => c * 2.2 + 0.03) : suit.map((c) => c * 1.35), scale: pin ? 0.1 : 0.04, sleeves: 'long', hem: 0.445 };
      P.inner = { kind: 'shirt', ...plain(colour(r, r.chance(0.8) ? pick(r, P_.shirtWhite) : pick(r, P_.shirtPale), 0.04, 0.1)) };
      const tc = colour(r, pick(r, P_.tie), 0.1, 0.1);
      P.tie = r.chance(0.92) ? { ...plain(tc), layer: r.chance(0.4) ? PAT.stripe : r.chance(0.3) ? PAT.dots : PAT.plain, col2: r.chance(0.5) ? colour(r, 0xc8b070, 0.1) : tc.map((c) => c * 0.45), scale: 0.035, wide: r.range(0.9, 1.3) } : null;
      P.bottom = { kind: 'trousers', ...plain(r.chance(0.85) ? suit : colour(r, pick(r, P_.slacks))), layer: P.top.layer, col2: P.top.col2, scale: P.top.scale };
      P.shoes = shoesM(r);
      maybeBag(r, P, r.chance(0.8) ? 'briefcase' : 'paper', 0.42);
      maybeUmbrella(r, P, 0.06);
      glasses(r, P, 0.28, 0.03);
      if (P.age > 48 && r.chance(0.18)) P.hat = { kind: 'fedora', col: colour(r, pick(r, [0x3a3630, 0x4a4438, 0x2a2a2c, 0x6a6050]), 0.1) };
      if (!P.bag && r.chance(0.12)) P.newspaper = true;
    },
  },
  {
    id: 'salaryman-shirtsleeves', weight: 15, sex: 'm', age: [21, 58],
    make(r, P) {
      const shortS = r.chance(0.65);
      P.top = { kind: 'shirt', ...plain(colour(r, r.chance(0.75) ? pick(r, P_.shirtWhite) : pick(r, P_.shirtPale), 0.04, 0.1)), sleeves: shortS ? 'short' : 'rolled', tucked: true };
      const tc = colour(r, pick(r, P_.tie), 0.1, 0.1);
      P.tie = r.chance(0.7) ? { ...plain(tc), layer: r.chance(0.4) ? PAT.stripe : PAT.plain, col2: tc.map((c) => c * 0.5), scale: 0.035, wide: r.range(0.9, 1.3) } : null;
      P.bottom = { kind: 'trousers', ...plain(colour(r, pick(r, P_.slacks), 0.1, 0.1)) };
      P.belt = colour(r, pick(r, [0x1a1a1a, 0x2a1e16, 0x4a3020]), 0.1);
      P.shoes = shoesM(r);
      maybeBag(r, P, r.chance(0.5) ? 'briefcase' : 'paper', 0.25);
      glasses(r, P, 0.3, 0.04);
      if (!P.bag && r.chance(0.15)) P.jacketOverArm = colour(r, pick(r, P_.suit), 0.1);
      if (r.chance(0.12)) P.cigarette = true;
    },
  },
  {
    id: 'man-trenchcoat', weight: 5, sex: 'm', age: [28, 65],
    make(r, P) {
      const c = colour(r, pick(r, [0xb8a27c, 0xa89070, 0x8a7a5a, 0x3a3a3c, 0x262d42, 0x6a6a68]), 0.08, 0.1);
      P.top = { kind: 'coat', ...plain(c), layer: PAT.plain, col2: c.map((x) => x * 1.2), sleeves: 'long', hem: r.range(0.27, 0.33), belted: r.chance(0.6) };
      P.inner = { kind: 'shirt', ...plain(colour(r, pick(r, P_.shirtWhite), 0.04)) };
      P.tie = { ...plain(colour(r, pick(r, P_.tie))), wide: 1.1 };
      P.bottom = { kind: 'trousers', ...plain(colour(r, pick(r, P_.suit))) };
      P.shoes = shoesM(r);
      maybeBag(r, P, 'briefcase', 0.4);
      maybeUmbrella(r, P, 0.12);
      glasses(r, P, 0.25);
      if (P.age > 45 && r.chance(0.35)) P.hat = { kind: 'fedora', col: colour(r, pick(r, [0x3a3630, 0x4a4438, 0x2a2a2c, 0x6a6050]), 0.1) };
    },
  },
  {
    id: 'young-man-flares', weight: 10, sex: 'm', age: [17, 30],
    make(r, P) {
      const patd = r.chance(0.55);
      const base = colour(r, pick(r, P_.casualShirt), 0.1, 0.15);
      const layer = patd ? r.pick([PAT.check, PAT.floral, PAT.wave, PAT.stripe, PAT.check]) : PAT.plain;
      P.top = { kind: r.chance(0.25) ? 'tshirt' : 'shirt', col: base, col2: patd ? colour(r, pick(r, P_.casualShirt), 0.1, 0.15) : base, layer, scale: layer === PAT.check ? 0.09 : 0.11, sleeves: r.chance(0.5) ? 'long' : 'short', tucked: r.chance(0.6), bigCollar: true };
      P.bottom = { kind: 'flare', ...plain(colour(r, r.chance(0.6) ? pick(r, P_.denim) : pick(r, [0x6a4a30, 0x3a3a3c, 0xa89070, 0x4a4a3a, 0x2a2a3a]), 0.1, 0.1)), layer: PAT.denim, scale: 0.03 };
      if (P.bottom.col[2] < P.bottom.col[0]) P.bottom.layer = PAT.plain;
      P.bottom.col2 = P.bottom.col.map((c) => Math.min(1, c * 2.1 + 0.02));
      P.belt = colour(r, pick(r, [0x2a1e16, 0x4a3020, 0x6a4a2a]), 0.1);
      if (r.chance(0.25)) P.top = { kind: 'jacket', col: colour(r, pick(r, [0x3a4a6a, 0x6a4a30, 0x4a4a3a, 0x8a6a4a]), 0.1), col2: null, layer: PAT.denim, scale: 0.03, sleeves: 'long', hem: 0.5, casual: true }, P.top.col2 = P.top.col.map((c) => c * 1.8), P.inner = { kind: 'tshirt', ...plain(colour(r, pick(r, [0xe8e4da, 0xc49a3a, 0x9a3030, 0x2a2a2a]))) };
      P.shoes = shoesM(r, r.chance(0.3) ? 'sneaker' : 'oxford');
      if (P.shoes.kind === 'sneaker') P.shoes.col = colour(r, pick(r, [0xd8d4cc, 0x3a4a7a, 0x8a2a2a]), 0.1);
      maybeBag(r, P, 'shoulder', 0.25);
      glasses(r, P, 0.12, 0.12);
      if (r.chance(0.15)) P.cigarette = true;
    },
  },
  {
    id: 'man-casual', weight: 7, sex: 'm', age: [25, 60],
    make(r, P) {
      const kind = r.pick(['polo', 'knit', 'safari', 'blouson']);
      const c = colour(r, pick(r, kind === 'safari' ? [0xb8a27c, 0x9c8a62, 0x8a8a6a] : P_.knit), 0.1, 0.12);
      if (kind === 'safari') P.top = { kind: 'jacket', ...plain(c), sleeves: 'short', hem: 0.47, belted: true, casual: true };
      else if (kind === 'blouson') P.top = { kind: 'blouson', ...plain(c), sleeves: 'long' };
      else P.top = { kind: kind === 'knit' ? 'knit' : 'shirt', col: c, col2: c.map((x) => x * 0.8), layer: kind === 'knit' ? PAT.knit : PAT.plain, scale: 0.02, sleeves: kind === 'polo' ? 'short' : 'long', tucked: kind === 'polo' && r.chance(0.6), turtle: kind === 'knit' && r.chance(0.4) };
      if (kind === 'safari' || kind === 'blouson') P.inner = { kind: 'shirt', ...plain(colour(r, pick(r, P_.shirtPale), 0.05)) };
      P.bottom = { kind: 'trousers', ...plain(colour(r, pick(r, P_.slacks), 0.1, 0.1)) };
      P.belt = colour(r, pick(r, [0x1a1a1a, 0x2a1e16, 0x4a3020]), 0.1);
      P.shoes = shoesM(r);
      maybeBag(r, P, r.chance(0.5) ? 'paper' : 'shoulder', 0.2);
      glasses(r, P, 0.25, 0.1);
      if (r.chance(0.12)) P.cigarette = true;
    },
  },
  {
    id: 'office-lady', weight: 9, sex: 'f', age: [19, 35],
    make(r, P) {
      const b = colour(r, pick(r, P_.blouse), 0.05, 0.12);
      P.top = { kind: 'blouse', ...plain(b), layer: r.chance(0.2) ? PAT.dots : PAT.plain, col2: b.map((c) => c * 0.6), scale: 0.05, sleeves: r.chance(0.5) ? 'long' : 'short', tucked: true, bow: r.chance(0.35) ? colour(r, pick(r, P_.tie)) : null };
      const sk = colour(r, pick(r, P_.skirt), 0.1, 0.1);
      P.bottom = { kind: 'skirt', ...plain(sk), layer: r.chance(0.25) ? PAT.check : PAT.plain, col2: sk.map((c) => c * 0.6 + 0.02), scale: 0.1, hem: r.range(0.24, 0.31), flare: r.range(0.98, 1.08), pleats: r.chance(0.4) ? r.int(14, 24) : 0 };
      if (r.chance(0.25)) P.top = { ...P.top, kind: 'cardigan', inner: b, col: colour(r, pick(r, P_.knit), 0.1), layer: PAT.knit, scale: 0.02 }, P.top.col2 = P.top.col.map((c) => c * 0.8);
      P.legs = { hose: true };
      P.shoes = shoesF(r);
      maybeBag(r, P, r.chance(0.7) ? 'handbag' : 'shoulder', 0.75);
      maybeUmbrella(r, P, 0.05);
      glasses(r, P, 0.1, 0.06);
    },
  },
  {
    id: 'woman-dress', weight: 7, sex: 'f', age: [20, 50],
    make(r, P) {
      const base = colour(r, pick(r, P_.dress), 0.1, 0.12);
      const layer = r.chance(0.55) ? r.pick([PAT.floral, PAT.floral, PAT.dots, PAT.check, PAT.wave, PAT.stripe]) : PAT.plain;
      const c2 = layer === PAT.plain ? base : colour(r, pick(r, [0xeeeae0, 0xe8dc9a, 0x2a3048, 0xc86a3a, 0x6a2430]), 0.08);
      P.top = { kind: 'dress', col: base, col2: c2, layer, scale: layer === PAT.dots ? 0.05 : 0.12, sleeves: r.pick(['short', 'long', 'short']), belted: r.chance(0.5) };
      P.bottom = { kind: 'skirt', col: base, col2: c2, layer, scale: P.top.scale, hem: r.range(0.18, 0.29), flare: r.range(1.0, 1.1), pleats: 0 };
      P.legs = { hose: true };
      P.shoes = shoesF(r);
      maybeBag(r, P, 'handbag', 0.7);
      maybeUmbrella(r, P, 0.05);
      glasses(r, P, 0.08, 0.1);
    },
  },
  {
    id: 'woman-coat', weight: 4, sex: 'f', age: [20, 60],
    make(r, P) {
      const c = colour(r, pick(r, P_.coat), 0.08, 0.1);
      P.top = { kind: 'coat', ...plain(c), layer: r.chance(0.2) ? PAT.tweed : PAT.plain, col2: c.map((x) => x * 1.3), sleeves: 'long', hem: r.range(0.2, 0.29), belted: r.chance(0.5) };
      P.inner = { kind: 'knit', ...plain(colour(r, pick(r, P_.knit))) };
      P.bottom = { kind: 'skirt', ...plain(colour(r, pick(r, P_.skirt))), hem: P.top.hem - 0.02, flare: 1.04, pleats: 0 };
      P.legs = { hose: true };
      P.shoes = shoesF(r);
      maybeBag(r, P, 'handbag', 0.8);
      maybeUmbrella(r, P, 0.1);
      if (r.chance(0.3)) P.scarf = colour(r, pick(r, [0xc8a848, 0xa83a34, 0xeeeae0, 0x4a6aa0, 0x7a3a5a]), 0.1);
    },
  },
  {
    id: 'young-woman-flares', weight: 7, sex: 'f', age: [16, 28],
    make(r, P) {
      const base = colour(r, pick(r, [...P_.knit, ...P_.blouse]), 0.1, 0.15);
      const layer = r.chance(0.35) ? r.pick([PAT.border, PAT.stripe, PAT.floral]) : r.chance(0.4) ? PAT.knit : PAT.plain;
      P.top = { kind: r.chance(0.5) ? 'knit' : 'blouse', col: base, col2: layer === PAT.knit ? base.map((c) => c * 0.8) : colour(r, pick(r, P_.knit), 0.1), layer, scale: layer === PAT.knit ? 0.02 : 0.08, sleeves: r.chance(0.6) ? 'long' : 'short', tucked: r.chance(0.6), turtle: r.chance(0.2) };
      P.bottom = { kind: 'flare', ...plain(colour(r, r.chance(0.65) ? pick(r, P_.denim) : pick(r, [0xe8e4da, 0xa8824e, 0x6a2430, 0x3a3a3c, 0x8a4a2a]), 0.1, 0.1)), layer: PAT.denim, scale: 0.03 };
      if (P.bottom.col[2] < P.bottom.col[0]) P.bottom.layer = PAT.plain;
      P.bottom.col2 = P.bottom.col.map((c) => Math.min(1, c * 2.0 + 0.02));
      P.shoes = { kind: 'pump', col: colour(r, pick(r, [0x2a1e16, 0x5a3a24, 0xb8a080, 0x18181a]), 0.1), platform: r.chance(0.5) };
      maybeBag(r, P, 'shoulder', 0.6);
      glasses(r, P, 0.05, 0.2);
    },
  },
  {
    id: 'student-gakuran', weight: 4, sex: 'm', age: [13, 17],
    make(r, P) {
      const blk = colour(r, 0x17181c, 0.08, 0.05);
      P.top = { kind: 'gakuran', ...plain(blk), col2: blk.map((c) => c * 1.6), sleeves: 'long', hem: 0.45 };
      P.bottom = { kind: 'trousers', ...plain(blk) };
      P.shoes = shoesM(r, r.chance(0.4) ? 'sneaker' : 'oxford');
      if (P.shoes.kind === 'sneaker') P.shoes.col = colour(r, 0xd8d4cc, 0.08);
      P.bag = { kind: 'school', col: colour(r, pick(r, [0x1a1a1a, 0x2a1e16]), 0.1), hand: r.chance(0.5) ? 'R' : 'L' };
      if (r.chance(0.55)) P.hat = { kind: 'student', col: blk };
      P.hairStyle = r.chance(0.6) ? 'crew' : 'side-part';
      glasses(r, P, 0.15);
    },
  },
  {
    id: 'student-sailor', weight: 3, sex: 'f', age: [13, 17],
    make(r, P) {
      const navy = colour(r, 0x1c2236, 0.06, 0.05);
      P.top = { kind: 'sailor', ...plain(navy), sleeves: 'long', scarf: colour(r, r.chance(0.6) ? 0xa82830 : 0x1c2236, 0.08), stripe: lin(0xe8e8e4) };
      P.bottom = { kind: 'skirt', ...plain(navy), hem: r.range(0.22, 0.27), flare: 1.06, pleats: r.int(20, 26) };
      P.legs = { socks: lin(0xe6e6e2), sockTop: r.chance(0.6) ? 0.2 : 0.09 };
      P.shoes = { kind: 'loafer', col: colour(r, pick(r, [0x18181a, 0x2a1e16]), 0.08) };
      P.bag = { kind: 'school', col: colour(r, pick(r, [0x1a1a1a, 0x2a1e16, 0x2a2a3a]), 0.1), hand: r.chance(0.5) ? 'R' : 'L' };
      P.hairStyle = r.pick(['long', 'bob', 'bob', 'braids']);
    },
  },
  {
    id: 'housewife', weight: 3, sex: 'f', age: [30, 62],
    make(r, P) {
      const b = colour(r, pick(r, P_.blouse), 0.06, 0.1);
      P.top = { kind: 'cardigan', col: colour(r, pick(r, P_.knit), 0.1), layer: PAT.knit, scale: 0.02, sleeves: 'long', inner: b };
      P.top.col2 = P.top.col.map((c) => c * 0.8);
      const sk = colour(r, pick(r, P_.skirt), 0.1);
      P.bottom = { kind: 'skirt', ...plain(sk), layer: r.chance(0.3) ? PAT.check : PAT.plain, col2: sk.map((c) => c * 0.65), scale: 0.1, hem: r.range(0.18, 0.25), flare: 1.03, pleats: r.chance(0.4) ? 18 : 0 };
      P.legs = { hose: true };
      P.shoes = { kind: 'pump', col: colour(r, pick(r, [0x18181a, 0x2a1e16, 0xb8a080]), 0.1) };
      maybeBag(r, P, r.chance(0.6) ? 'paper' : 'handbag', 0.85);
    },
  },
  {
    id: 'woman-kimono', weight: 1.5, sex: 'f', age: [35, 70],
    make(r, P) {
      const c = colour(r, pick(r, [0x4a5a6a, 0x6a5a4a, 0x5a3a4a, 0x3a4a3a, 0x7a6a5a, 0x2a3048]), 0.08, 0.1);
      P.top = { kind: 'kimono', col: c, col2: c.map((x) => x * 1.25), layer: r.chance(0.5) ? PAT.tweed : PAT.plain, scale: 0.06, sleeves: 'kimono', obi: colour(r, pick(r, [0xc8a848, 0xd8c8a0, 0x8a3a2a, 0x3a3a4a, 0xe8e0c8]), 0.08) };
      P.bottom = { kind: 'none' };
      P.legs = { socks: lin(0xeae8e2), sockTop: 0.06 };
      P.shoes = { kind: 'zori', col: colour(r, pick(r, [0xd8c8a0, 0x6a3a2a, 0x3a3a3a]), 0.08) };
      maybeBag(r, P, 'handbag', 0.6);
      P.hairStyle = 'bun';
    },
  },
  {
    id: 'worker', weight: 2.5, sex: 'm', age: [20, 60],
    make(r, P) {
      const c = colour(r, pick(r, [0x5a6a5a, 0x6a6a68, 0x4a5a6a, 0x8a8070, 0x3a4a5a]), 0.1, 0.1);
      P.top = { kind: 'blouson', ...plain(c), sleeves: 'long' };
      P.inner = { kind: 'shirt', ...plain(colour(r, pick(r, [0xe0dcd0, 0x9aaabb, 0xc8c0a8]), 0.06)) };
      P.bottom = { kind: 'trousers', ...plain(c.map((x) => x * r.range(0.8, 1.05))) };
      P.shoes = shoesM(r, r.chance(0.5) ? 'sneaker' : 'oxford');
      if (P.shoes.kind === 'sneaker') P.shoes.col = colour(r, pick(r, [0x2a2a2a, 0x4a4a4a, 0x2a3048]), 0.1);
      if (r.chance(0.3)) P.hat = { kind: 'cap', col: colour(r, pick(r, [0x2a3048, 0x5a6a5a, 0xe0dcd0]), 0.1) };
      if (r.chance(0.2)) P.cigarette = true;
    },
  },
  {
    id: 'older-man-cardigan', weight: 3, sex: 'm', age: [55, 75],
    make(r, P) {
      const c = colour(r, pick(r, [0x6a5a48, 0x7a7a70, 0x5a4a3a, 0x4a4a4a, 0x8a7a5a]), 0.1, 0.1);
      P.top = { kind: 'cardigan', col: c, col2: c.map((x) => x * 0.8), layer: PAT.knit, scale: 0.02, sleeves: 'long', inner: colour(r, pick(r, P_.shirtPale), 0.05) };
      P.bottom = { kind: 'trousers', ...plain(colour(r, pick(r, P_.slacks), 0.1)) };
      P.shoes = shoesM(r);
      if (r.chance(0.45)) P.hat = { kind: 'fedora', col: colour(r, pick(r, [0x4a4438, 0x6a6050, 0x3a3630]), 0.1) };
      glasses(r, P, 0.5);
      maybeBag(r, P, 'paper', 0.2);
      maybeUmbrella(r, P, 0.15);
    },
  },
];

export const ARCHETYPE_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

/** Weighted archetype choice; `bias` maps archetype id -> weight multiplier. */
export function chooseArchetype(r, bias = {}) {
  let total = 0;
  for (const a of ARCHETYPES) total += a.weight * (bias[a.id] ?? 1);
  let x = r() * total;
  for (const a of ARCHETYPES) { x -= a.weight * (bias[a.id] ?? 1); if (x <= 0) return a; }
  return ARCHETYPES[0];
}

/** Resolve a complete person look for an archetype. */
export function dressPerson(r, arch) {
  const age = r.int(arch.age[0], arch.age[1]);
  const P = baseBody(r, arch.sex, age);
  P.archetype = arch.id;
  arch.make(r, P);
  const style = P.hairStyle || (arch.sex === 'f' ? femaleHair(r, age) : maleHair(r, age));
  P.hair = hairFor(r, arch.sex, age, style);
  if (P.hat && P.hat.kind === 'fedora' && P.hair.style === 'long70') P.hair.style = 'side-part';
  return P;
}
