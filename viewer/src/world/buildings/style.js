import { hexToRgb } from './geom.js';

// Per-building design choices. All period-plausible-generic: nothing here identifies or claims a
// specific 1976 building. Each choice is drawn from a stream keyed by the building id.

function weighted(r, table) {
  let s = 0; for (const [, w] of table) s += w;
  let x = r() * s;
  for (const [v, w] of table) { x -= w; if (x <= 0) return v; }
  return table[table.length - 1][0];
}
function jitter(c, r, k) { const m = 1 + (r() - 0.5) * k; return [c[0] * m * (1 + (r() - 0.5) * k * 0.5), c[1] * m, c[2] * m * (1 + (r() - 0.5) * k * 0.5)]; }
const L = (hex) => hexToRgb(hex);

// Muted 1960s-70s cladding colours (sRGB hex; converted to linear for vertex colours).
const PAL = {
  mosaic: ['#e6dcc4', '#e3d3a6', '#ebe8de', '#c7d3bd', '#c2cad0', '#d8c4a2', '#c4a37c', '#ddb9a0', '#b4c2b0', '#d6cfb6', '#9fb0a6', '#cbb69c', '#8c6a52', '#a37d5c'],
  smalltile: ['#efebe1', '#e6dcc2', '#d4d2cc', '#d9bf8a', '#c8d5da', '#e2d6c0', '#c6bfac', '#b9c6b4'],
  brick: ['#b06f50', '#9a5a42', '#8b5340', '#a8684a', '#7f4c3a', '#b57c5a', '#94604a'],
  render: ['#e0d4b6', '#d4b47a', '#a8b29b', '#e4e1d8', '#e0c6b6', '#b8b5ad', '#bccfbf', '#b6c4cc', '#d6cca9', '#c6b089', '#dbd6ca', '#a6a092', '#cfc3a0'],
  concrete: ['#d2cec6', '#c8c6c0', '#d6d0c4', '#bebdb8', '#d0c8b8'],
  panel: ['#e6e2d8', '#d0d4d2', '#c8c0ae', '#9aa59c', '#e0dccc', '#b4b8b6'],
  stone: ['#d6cdbb', '#c4bcac', '#ddd6c6', '#a9a49a', '#8f8a82'],
};
const GROUND_TILE = ['#5a4638', '#3f4a44', '#6d5444', '#4b4a46', '#8a6e58', '#5c5e62', '#7b3f30', '#e0d8c4', '#c6b694'];
const SASH = { alu: ['#c6cacb', '#b9bdbf', '#cfd1cf'], steel: ['#7a877a', '#5b6063', '#d6cfb8', '#6a503c', '#a5a7a3', '#4f5f56', '#8b8272', '#7e93a0'] };
const TRIM = ['#d8d3c8', '#c3beb2', '#e6e1d6', '#a39e94', '#dad0bd', '#bdb7aa'];
const SHUTTER = ['#b9bbb8', '#c4c6c2', '#a9aca8', '#d0c8a8', '#8fa092', '#9aa9b4', '#c9c0b0'];
const PIPE = ['#9ea19c', '#c8c2b0', '#7d756a', '#aab0aa', '#6a6f6c'];

export function chooseStyle(ctx, b, plan) {
  const r = ctx.rng(`buildings/style/${b.id}`);
  const floors = plan.floors;
  const tall = floors >= 6;
  const clad = weighted(r, [['mosaic', 0.26], ['smalltile', 0.12], ['brick', 0.14], ['render', floors <= 3 ? 0.36 : 0.18], ['concrete', 0.15], ['panel', tall ? 0.08 : 0.03]]);
  const colour = jitter(L(r.pick(PAL[clad])), r, 0.08);
  const win = weighted(r, [['punched', 0.34], ['ribbon', 0.26], ['grid', tall ? 0.18 : 0.1], ['fins', tall ? 0.1 : 0.04], ['blank', 0.07], ['balcony', floors <= 5 ? 0.08 : 0.03]]);
  const sideClad = r.chance(0.6) ? (r.chance(0.65) ? 'concrete' : 'render') : clad;
  const sideColour = sideClad === clad ? colour : jitter(L(r.pick(sideClad === 'concrete' ? PAL.concrete : ['#cbc6ba', '#bfbbb0', '#d4cdbb', '#b2b2aa', '#c9c0a8'])), r, 0.06);
  const alu = r.chance(0.6);
  const sashColour = jitter(L(r.pick(alu ? SASH.alu : SASH.steel)), r, 0.05);
  const groundClad = weighted(r, [['stone', 0.35], ['mosaic', 0.3], ['smalltile', 0.1], [clad, 0.25]]);
  const groundColour = groundClad === 'stone' ? jitter(L(r.pick(PAL.stone)), r, 0.05)
    : groundClad === clad ? colour : jitter(L(r.pick(GROUND_TILE)), r, 0.06);
  const spandrel = weighted(r, [['same', 0.5], ['panel', 0.3], ['contrast', 0.2]]);
  const spandrelColour = spandrel === 'panel' ? jitter(L(r.pick(PAL.panel)), r, 0.05)
    : spandrel === 'contrast' ? jitter(L(r.pick(PAL[clad === 'brick' ? 'concrete' : 'mosaic'])), r, 0.06) : colour;
  const trimColour = jitter(L(r.pick(TRIM)), r, 0.05);
  const S = {
    clad, colour, win, sideClad, sideColour, alu, sashColour, groundClad, groundColour, spandrel, spandrelColour, trimColour,
    fasciaColour: jitter(L(r.pick(['#e6e2d8', '#d6d1c4', '#c4bdac', '#ece9e0', '#b6b0a2', '#cfc6b0'])), r, 0.04),
    shutterColour: jitter(L(r.pick(SHUTTER)), r, 0.06),
    pipeColour: jitter(L(r.pick(PIPE)), r, 0.05),
    uvo: [r.range(0, 10), r.range(0, 10)],
    endPier: [r.range(0.3, 0.75), r.range(0.3, 0.75)],
    // upper floors
    recess: { punched: r.range(0.14, 0.24), ribbon: r.range(0.08, 0.14), grid: r.range(0.1, 0.18), fins: r.range(0.08, 0.14), blank: 0.15, balcony: 0.12 }[win],
    sillH: { punched: r.range(0.75, 1.0), ribbon: r.range(0.8, 1.05), grid: r.range(0.5, 0.8), fins: r.range(0.75, 0.95), blank: 1.0, balcony: 0.05 }[win],
    headH: { punched: r.range(0.35, 0.6), ribbon: r.range(0.3, 0.48), grid: r.range(0.28, 0.42), fins: r.range(0.32, 0.5), blank: 0.5, balcony: r.range(0.55, 0.8) }[win],
    winW: r.range(1.3, 2.4), winGap: r.range(0.6, 1.6),
    paneW: r.range(0.72, 1.05),
    transom: r.chance(0.45),
    bayW: r.range(3.2, 5.6),
    pilasterW: r.range(0.38, 0.6), pilasterD: r.range(0.12, 0.26),
    finD: r.range(0.22, 0.34), finEvery: r.int(1, 3),
    ribbonPierEvery: r.chance(0.5) ? r.range(3.5, 6.5) : 0,
    band: weighted(r, [['none', 0.35], ['slab', 0.4], ['line', 0.25]]),
    bandH: r.range(0.18, 0.4), bandD: r.range(0.06, 0.2),
    cornice: weighted(r, [['flat', 0.45], ['deep', 0.3], ['stepped', 0.25]]),
    corniceD: r.range(0.08, 0.3),
    sillKind: r.chance(0.55) ? 'concrete' : 'metal',
    acRate: r.chance(0.55) ? r.range(0.03, 0.12) : 0,
    grilleRate: r.chance(0.3) ? r.range(0.1, 0.5) : 0,
    balconyTop: !tall && r.chance(0.3),
    pipeEnd: r.chance(0.5) ? 0 : 1,
    stairBay: floors >= 3 && r.chance(0.75),
    stairSide: r.chance(0.5) ? 0 : 1,
    dirt: r.range(0.55, 1.0),
    roofItems: { tank: r.chance(0.8), tankKind: weighted(r, [['frp', 0.45], ['cyl', 0.35], ['hcyl', 0.2]]), penthouse: floors >= 3 && r.chance(0.85), antennas: r.int(0, 3), rail: r.chance(0.3), machine: tall && r.chance(0.7) },
  };
  return S;
}

export const SHOP_INTERIOR_COLOURS = ['#e8e4d8', '#d8d0bc', '#c8d0c4', '#e0d0b8', '#d4dce0', '#f0e8d0', '#c0b098', '#e6dccc'];
export const GOODS = ['#c23a2c', '#d8b020', '#2d5fa0', '#3c8a4a', '#e8e4dc', '#e07a28', '#7a4a2a', '#b84870', '#40a0b0', '#f0d8a0', '#5a5a60', '#9c2a24', '#f2f0e8', '#3a3a8a'];
