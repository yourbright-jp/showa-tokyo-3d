import { hexToRgb } from './geom.js';

// Per-building design choices. All period-plausible-generic: nothing here identifies or claims a
// specific 1976 building. Each choice is drawn from a stream keyed by the building id. The base
// colour family follows the adopted r03 material key (context-gray / -cream / -brick / -blue-gray).

function weighted(r, table) {
  let s = 0; for (const [, w] of table) s += w;
  let x = r() * s;
  for (const [v, w] of table) { x -= w; if (x <= 0) return v; }
  return table[table.length - 1][0];
}
function jitter(c, r, k) { const m = 1 + (r() - 0.5) * k; return [c[0] * m * (1 + (r() - 0.5) * k * 0.4), c[1] * m, c[2] * m * (1 + (r() - 0.5) * k * 0.4)]; }
// Linear albedo is scaled down so sunlit walls land in a photographic range under AgX.
const ALBEDO = 0.53;
const SAT = 1.3; // period paint/tile colours read richer than the muted swatches once grime and haze apply
const L = (hex, k = ALBEDO) => {
  const c = hexToRgb(hex); const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v) => Math.max(0, l + (v - l) * SAT) * k);
};

// Cladding choice and colours per adopted colour family (sRGB hex, muted 1960s-70s tones).
export const FAMILY = {
  'context-gray': {
    clad: [['concrete', 0.32], ['render', 0.26], ['smalltile', 0.14], ['mosaic', 0.16], ['panel', 0.12]],
    concrete: ['#c9c5bb', '#bfbab0', '#cdc7bb', '#b9b4aa', '#c4bcae'],
    render: ['#c2bdb0', '#b3b0a4', '#cbc5b6', '#a9a99c', '#bab2a2'],
    smalltile: ['#c6c2b8', '#d2cec2', '#b5b1a6'], mosaic: ['#bdb8ac', '#ccc7ba', '#aeaa9e', '#d4cfc1', '#a3a497'],
    panel: ['#c4c2ba', '#b0b2aa', '#d0cdc2'],
    mid: '#bcb8ae',
  },
  'context-cream': {
    clad: [['mosaic', 0.34], ['render', 0.3], ['smalltile', 0.2], ['panel', 0.06], ['concrete', 0.1]],
    mosaic: ['#e0d1ae', '#d8c290', '#e6dcc2', '#d4b884', '#c9a874', '#e3d4b0', '#d6c29c'],
    render: ['#d9c9a2', '#cfb680', '#e0d4b4', '#c6aa78', '#d4c090', '#cbbb92'],
    smalltile: ['#e8dfc6', '#ddcfa8', '#d3c08f', '#e2d6b8'], panel: ['#ddd3b8', '#d2c6a4'], concrete: ['#cfc6b0', '#c8bea6'],
    mid: '#d6c9a6',
  },
  'context-brick': {
    clad: [['brick', 0.64], ['mosaic', 0.26], ['smalltile', 0.1]],
    brick: ['#a96a4c', '#94573f', '#86503c', '#a3654a', '#7b4a39', '#b07657', '#8f5c46', '#9c6a50'],
    mosaic: ['#8a6650', '#9a7258', '#7a5644', '#a57d60', '#b28a6a'], smalltile: ['#b08868', '#9e7a5e', '#c09878'],
    mid: '#9a6a52',
  },
  'context-blue-gray': {
    clad: [['mosaic', 0.34], ['smalltile', 0.24], ['render', 0.2], ['panel', 0.22]],
    mosaic: ['#9fb2b9', '#93a9b2', '#b2c1c4', '#87a0a8', '#a9bdb8', '#8fa8a0'],
    smalltile: ['#a8bcc2', '#bccbcd', '#98aeb6', '#b0c6c0'], render: ['#a2b2b6', '#b3c0bf', '#91a3a8', '#a9b8ae'],
    panel: ['#93a6ad', '#a9b9bc', '#7f94a0', '#a0b4ae'],
    mid: '#a2b2b4',
  },
};
const GROUND_TILE = ['#5a4638', '#3f4a44', '#6d5444', '#4b4a46', '#8a6e58', '#5c5e62', '#7b3f30', '#e0d8c4', '#c6b694', '#2f3a36'];
const STONE = ['#d6cdbb', '#c4bcac', '#ddd6c6', '#a9a49a', '#8f8a82', '#6e6a64'];
const SASH = { alu: ['#c6cacb', '#b9bdbf', '#cfd1cf'], steel: ['#7a877a', '#5b6063', '#d6cfb8', '#6a503c', '#a5a7a3', '#4f5f56', '#8b8272', '#7e93a0'] };
const TRIM = ['#d8d3c8', '#c3beb2', '#e6e1d6', '#a39e94', '#dad0bd', '#bdb7aa'];
const SHUTTER = ['#b9bbb8', '#c4c6c2', '#a9aca8', '#d0c8a8', '#8fa092', '#9aa9b4', '#c9c0b0', '#b0a898'];
const PIPE = ['#9ea19c', '#c8c2b0', '#7d756a', '#aab0aa', '#6a6f6c'];
const RAIL = ['#3f4a44', '#5c5650', '#d0ccc0', '#6a4a38', '#7a8a86'];
const PLINTH = ['#4a4844', '#5e5a54', '#3a3936', '#6c6860', '#7a7468'];

export function familyOf(b) { return FAMILY[b.materialKey] ? b.materialKey : 'context-gray'; }

export function chooseStyle(ctx, b, plan) {
  const r = ctx.rng(`buildings/style/${b.id}`);
  const fam = FAMILY[familyOf(b)];
  const floors = plan.floors;
  const tall = floors >= 6;
  const clad = weighted(r, fam.clad);
  const colour = jitter(L(r.pick(fam[clad])), r, 0.08);
  const win = weighted(r, [['punched', 0.34], ['ribbon', 0.26], ['grid', tall ? 0.18 : 0.1], ['fins', tall ? 0.1 : 0.04], ['blank', 0.07], ['balcony', floors <= 5 ? 0.08 : 0.03]]);
  const sideClad = r.chance(0.6) ? (r.chance(0.65) ? 'concrete' : 'render') : clad;
  const sideColour = sideClad === clad ? colour : jitter(L(r.pick(sideClad === 'concrete' ? FAMILY['context-gray'].concrete : ['#cbc6ba', '#bfbbb0', '#d4cdbb', '#b2b2aa', '#c9c0a8'])), r, 0.06);
  const alu = r.chance(0.6);
  const sashColour = jitter(L(r.pick(alu ? SASH.alu : SASH.steel), 0.5), r, 0.05);
  const groundClad = weighted(r, [['stone', 0.35], ['mosaic', 0.3], ['smalltile', 0.1], [clad, 0.25]]);
  const groundColour = groundClad === 'stone' ? jitter(L(r.pick(STONE)), r, 0.05)
    : groundClad === clad ? colour : jitter(L(r.pick(GROUND_TILE)), r, 0.06);
  const spandrel = weighted(r, [['same', 0.5], ['panel', 0.3], ['contrast', 0.2]]);
  const spandrelColour = spandrel === 'panel' ? jitter(L(r.pick(['#e6e2d8', '#d0d4d2', '#c8c0ae', '#9aa59c', '#e0dccc', '#b4b8b6'])), r, 0.05)
    : spandrel === 'contrast' ? jitter(L(r.pick(FAMILY[b.materialKey === 'context-brick' ? 'context-cream' : 'context-brick'].mosaic)), r, 0.06) : colour;
  const trimColour = jitter(L(r.pick(TRIM)), r, 0.05);
  return {
    clad, colour, win, sideClad, sideColour, alu, sashColour, groundClad, groundColour, spandrel, spandrelColour, trimColour,
    fasciaClad: r.chance(0.6) ? 'panel' : 'render',
    fasciaColour: jitter(L(r.pick(['#e6e2d8', '#d6d1c4', '#c4bdac', '#ece9e0', '#b6b0a2', '#cfc6b0']), 0.46), r, 0.04),
    shutterColour: jitter(L(r.pick(SHUTTER)), r, 0.06),
    pipeColour: jitter(L(r.pick(PIPE)), r, 0.05),
    railColour: jitter(L(r.pick(RAIL)), r, 0.05),
    plinthColour: jitter(L(r.pick(PLINTH)), r, 0.05),
    bandColour: r.chance(0.5) ? trimColour : jitter(colour, r, 0.04).map((v) => v * 1.06),
    uvo: [r.range(0, 10), r.range(0, 10)],
    endPier: [r.range(0.3, 0.75), r.range(0.3, 0.75)],
    pierD: r.range(0.02, 0.07),
    recess: { punched: r.range(0.14, 0.24), ribbon: r.range(0.08, 0.14), grid: r.range(0.1, 0.18), fins: r.range(0.08, 0.14), blank: 0.15, balcony: 0.12 }[win],
    sillH: { punched: r.range(0.75, 1.0), ribbon: r.range(0.8, 1.05), grid: r.range(0.5, 0.8), fins: r.range(0.75, 0.95), blank: 1.0, balcony: 0.85 }[win],
    headH: { punched: r.range(0.35, 0.6), ribbon: r.range(0.3, 0.48), grid: r.range(0.28, 0.42), fins: r.range(0.32, 0.5), blank: 0.5, balcony: r.range(0.4, 0.6) }[win],
    winW: r.range(1.3, 2.4), winGap: r.range(0.6, 1.6),
    paneW: r.range(0.72, 1.05),
    transom: r.chance(0.45),
    hoods: win === 'punched' && r.chance(0.45),
    bayW: r.range(3.2, 5.6),
    pilasterW: r.range(0.38, 0.6), pilasterD: r.range(0.12, 0.26),
    finD: r.range(0.22, 0.34), finEvery: r.int(1, 3),
    ribbonPierEvery: r.chance(0.5) ? r.range(3.5, 6.5) : 0,
    band: weighted(r, [['none', 0.35], ['slab', 0.4], ['line', 0.25]]),
    bandH: r.range(0.18, 0.4), bandD: r.range(0.06, 0.2),
    cornice: weighted(r, [['flat', 0.45], ['deep', 0.3], ['stepped', 0.25]]),
    corniceD: r.range(0.08, 0.3),
    parapetH: plan.parapetH + r.range(0.0, 0.45),
    sillKind: r.chance(0.55) ? 'concrete' : 'metal',
    acRate: r.chance(0.55) ? r.range(0.03, 0.12) : 0,
    grilleRate: r.chance(0.3) ? r.range(0.1, 0.5) : 0,
    balconyTop: !tall && r.chance(0.3),
    pipeEnd: r.chance(0.5) ? 0 : 1,
    stairBay: floors >= 3 && r.chance(0.75),
    stairSide: r.chance(0.5) ? 0 : 1,
    dirt: r.range(0.6, 1.0),
    roof: {
      tank: r.chance(0.8), tankKind: weighted(r, [['frp', 0.45], ['cyl', 0.35], ['hcyl', 0.2]]), tankOnPenthouse: r.chance(0.6),
      penthouse: floors >= 3 && r.chance(0.85), antennas: r.int(0, 3), machine: tall && r.chance(0.7),
      tankColour: L(r.pick(['#a9c2cc', '#d6d2c0', '#bcc6c0', '#c8ccc8', '#8fa6a0'])),
    },
  };
}

export const SHOP_INTERIOR_COLOURS = ['#e8e4d8', '#d8d0bc', '#c8d0c4', '#e0d0b8', '#d4dce0', '#f0e8d0', '#c0b098', '#e6dccc'];
export const GOODS = ['#c23a2c', '#d8b020', '#2d5fa0', '#3c8a4a', '#e8e4dc', '#e07a28', '#7a4a2a', '#b84870', '#40a0b0', '#f0d8a0', '#5a5a60', '#9c2a24', '#f2f0e8', '#3a3a8a'];
