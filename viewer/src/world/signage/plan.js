// Sign placement and geometry emission. plan() walks every non-landmark building near the
// walk, decides which signs it carries (seeded by building/facade id) and returns items:
//   { id, kind, tier, fictional, faces: [faceReq], emit(G) }
// faceReq = { painter, spec, wm, hm, ppm, cls } gets an atlas region before emit() runs.
import { TRADES, TRADE_BY_WORD, SCHEMES, shopName, phone, PHRASES, MENU, NOREN_WORDS, floorLabel, UPPER_ONLY_PHRASES, NAME_STEMS } from './vocab.js';
const STEMS_FOR_BUILDINGS = NAME_STEMS.filter((s) => s.length <= 2);
import { neonStyle, pickTextKind, shade } from './paint.js';
import { box, beam, cylinder, face, v3, lin } from './geo.js';

const UP = [0, 1, 0];
const LIGHT_BG = ['redOnWhite', 'blueOnWhite', 'greenOnWhite', 'blackOnWhite', 'pinkOnWhite', 'redOnCream', 'brownOnCream'];
const ALL_SCHEMES = Object.keys(SCHEMES);
const PAINT_EDGE = ['#3b3732', '#2c2a27', '#5a5650', '#7a1f18', '#1f3a66', '#20402c', '#8a8780', '#b9b6ad'];
const TRIM = ['#b8b6ae', '#c9c6bc', '#9c9a93', '#2e2c29', '#6f6b64'];

export function frameOf(f) {
  const [nx, nz] = f.normal;
  return { ox: f.b[0], oz: f.b[1], rx: nz, rz: -nx, nx, nz, L: f.length, R: [nz, 0, -nx], N: [nx, 0, nz] };
}
export const W = (fr, u, y, d) => [fr.ox + fr.rx * u + fr.nx * d, y, fr.oz + fr.rz * u + fr.nz * d];

/** Texture density by distance from the walk (pixels per metre on the sign face). */
export function ppmFor(dist, k = 1) { return Math.max(28, Math.min(165, (2040 / Math.max(6, dist + 2)) * 0.75 * k)); }

function req(painter, spec, wm, hm, ppm, cls) {
  const p = Math.min(ppm, 2000 / Math.max(wm, hm));
  return { painter, spec, wm, hm, ppm: p, cls, w: Math.max(4, wm * p), h: Math.max(4, hm * p) };
}

/** Volume helper in facade frame: u-range, d-range, y-range -> Space volume. */
function volF(fr, u0, u1, d0, d1, y0, y1) {
  const uc = (u0 + u1) / 2, dc = (d0 + d1) / 2;
  const c = W(fr, uc, 0, dc);
  return { cx: c[0], cz: c[2], ax: fr.rx, az: fr.rz, hu: Math.abs(u1 - u0) / 2, hv: Math.abs(d1 - d0) / 2, y0, y1 };
}

// ------------------------------------------------------------------------------------------
export function plan(ctx, env) {
  const { data } = ctx;
  const items = [];
  const space = env.space;
  const used = new Set();
  const fictionalNames = new Set();
  const bnames = new Map();
  const NAME_STEMS_LOCAL = () => STEMS_FOR_BUILDINGS;

  // adopted parts by building id
  const adopted = new Map();
  for (const f of data.facadeFeatures) {
    const bid = f.id.split('-period-facade-')[0];
    if (!adopted.has(bid)) adopted.set(bid, {});
    const m = f.material_key;
    if (m === 'sign-white') adopted.get(bid).sign = f;
    else if (m.startsWith('awning')) adopted.get(bid).awning = f;
  }
  const textByB = new Map();
  for (const t of data.textNodes) if (t.decision_id === 'period-background-context-rule') textByB.set(t.id.replace('-generic-shop-text', ''), t);

  // gate keep-out (landmarks own the gate) and adopted obstacles
  const gp = data.decisions.gate.parameters;
  if (gp) {
    const [ax, , az] = gp.anchor_local_m; const [rx, rz] = gp.right_xz; const cu = gp.center_u_m || 0;
    space.addVolume({ cx: ax + rx * cu, cz: az + rz * cu, ax: rx, az: rz, hu: (gp.overall_width_m || 10.6) / 2 + 0.6, hv: 1.0, y0: -5, y1: 12, keep: 'gate' });
  }
  for (const o of data.obstacles || []) {
    const fp = o.footprint_xz; if (!fp || fp.length < 3) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of fp) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    space.addVolume({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, ax: 1, az: 0, hu: (x1 - x0) / 2 + 0.2, hv: (z1 - z0) / 2 + 0.2, y0: -5, y1: (o.physical_height_m || 6) + 2, keep: o.id });
  }

  // route tangent at the closest point: facades the walk heads towards are seen face-on, so they
  // get flush boards; facades parallel to the walk get projecting signs
  const route = data.route;
  function routeTangent(x, z) {
    let best = Infinity, tx = 0, tz = 1, px = x, pz = z;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2));
      const d = Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz);
      if (d < best) { best = d; const L = Math.sqrt(L2); tx = dx / L; tz = dz / L; px = a[0] + t * dx; pz = a[2] + t * dz; }
    }
    return [tx, tz, px, pz];
  }
  const uniq = (r, fn, tries = 6) => { let v; for (let i = 0; i < tries; i++) { v = fn(); if (!used.has(v.key || v)) break; } used.add(v.key || v); return v; };

  // ---------------------------------------------------------------- tenants
  function tenantsFor(b, pl, groundWord) {
    const r = env.rng(`signage/tenants/${b.id}`);
    const out = [];
    for (let fl = 1; fl <= Math.max(1, pl.floors); fl++) {
      let trade;
      if (fl === 1) trade = groundWord ? (TRADE_BY_WORD[groundWord] || { w: groundWord, fmt: 'pre', sch: LIGHT_BG }) : r.pick(TRADES.filter((t) => t.g));
      else {
        if (r.chance(fl > 5 ? 0.35 : 0.18)) { out.push(null); continue; }
        trade = r.pick(TRADES.filter((t) => t.u));
      }
      const t = uniq(r, () => {
        const nm = shopName(r, trade);
        const showName = nm.name && /(店|局|社|所|科|院|産|事|堂|房)$/.test(nm.name) ? nm.name : null;
        const display = nm.name ? (showName || `${trade.w} ${nm.name}`) : trade.w;
        const sch = r.chance(0.45) ? r.pick(LIGHT_BG) : r.pick(trade.sch || ALL_SCHEMES);
        return { key: display, trade: trade.w, name: nm.name, display, fictional: nm.fictional, scheme: SCHEMES[sch], noren: !!trade.noren, floor: fl, uses: 0 };
      });
      if (t.fictional && t.name) fictionalNames.add(t.name);
      t.__b = b.id;
      out.push(t);
    }
    return out;
  }

  // ---------------------------------------------------------------- per building
  const buildings = data.buildings.filter((b) => !b.landmark);
  for (const b of buildings) {
    const pl = data.plans.get(b.id);
    const fs = (data.facadesByBuilding.get(b.id) || []).map((f) => {
      const fr = frameOf(f);
      const ds = [0.15, 0.5, 0.85].map((t) => { const p = W(fr, f.length * t, 0, 0.5); return data.routeDistance(p[0], p[2]); });
      return { f, fr, dmin: Math.min(...ds) };
    });
    if (!fs.length) continue;
    const bmin = Math.min(...fs.map((x) => x.dmin));
    if (bmin > (ctx.quality.detailRadius || 140)) continue;
    const ad = adopted.get(b.id) || {};
    const tnode = textByB.get(b.id);
    const groundWord = tnode ? tnode.text : null;
    const tenants = tenantsFor(b, pl, groundWord);
    const rb = env.rng(`signage/building/${b.id}`);
    const ctxB = { b, pl, tenants, rb };

    // adopted frontage: board (+ text) and awning
    let adoptedFacade = null;
    if (ad.sign) {
      const res = adoptedBoard(ctxB, fs, ad.sign, tnode);
      if (res) { adoptedFacade = res.facade; items.push(res.item); }
      if (ad.awning) { const it = adoptedAwning(ctxB, fs, ad.awning, tnode); if (it) items.push(it); }
    }

    for (const F of fs) {
      const { f, fr, dmin } = F;
      if (!f.streetFacing || f.length < 1.8 || dmin > 120) continue;
      const rf = env.rng(`signage/facade/${f.id}`);
      const near = dmin < 18, mid = dmin < 45;
      const isAdopted = adoptedFacade === f;
      const [rtx, rtz, rpx, rpz] = routeTangent(f.mid[0], f.mid[1]);
      const vx = f.mid[0] - rpx, vz = f.mid[1] - rpz, vl = Math.hypot(vx, vz) || 1;
      const faceOn = -(fr.nx * vx + fr.nz * vz) / vl; // 1 = the walk looks straight at this facade
      const frontal = f.inPlaza || (Math.abs(fr.nx * rtx + fr.nz * rtz) > 0.55 && dmin > 8) || (dmin > 10 && faceOn > 0.6);
      // flush vertical boards on facades seen face-on (plaza edges, street ends) — R02
      if (frontal && pl.floors >= 3 && dmin < 110 && f.length >= 3) {
        const n = Math.max(1, Math.min(6, Math.round(f.length / rf.range(2.6, 4.2))));
        const slot = f.length / n;
        for (let i = 0; i < n; i++) {
          if (!rf.chance(0.8)) continue;
          const w = Math.min(slot - 0.4, rf.range(1.0, 2.2));
          if (w < 0.6) continue;
          const uc = slot * (i + 0.5) + rf.range(-0.2, 0.2) * (slot - w);
          const it = flushBoard(ctxB, F, uc - w / 2, uc + w / 2, i, rf);
          if (it) items.push(it);
        }
      }
      // generic fascia board(s)
      if (!isAdopted && f.length >= 2.4 && rf.chance(near ? 0.9 : mid ? 0.7 : 0.45)) {
        const n = f.length > 10 && rf.chance(0.7) ? 2 : 1;
        const gap = 0.3;
        const usable = f.length - 0.5;
        for (let i = 0; i < n; i++) {
          const w = (usable - gap * (n - 1)) / n;
          const u0 = 0.25 + i * (w + gap);
          const it = genericFascia(ctxB, F, u0, u0 + w, i, rf);
          if (it) items.push(it);
        }
        if (near && rf.chance(0.5)) { const it = genericAwning(ctxB, F, rf); if (it) items.push(it); }
      }
      // vertical projecting signs
      if (pl.floors >= 2 && dmin < 75) {
        const maxN = frontal ? (mid ? 1 : 0) : near ? Math.max(2, Math.min(4, Math.round(f.length / 2.4))) : mid ? Math.max(1, Math.min(3, Math.round(f.length / 3.5))) : (pl.floors >= 4 ? 1 : 0);
        const cands = [];
        cands.push(0.5 + rf.range(0, 0.4), f.length - 0.5 - rf.range(0, 0.4));
        if (f.length > 4.5) cands.push(f.length * rf.range(0.42, 0.58));
        if (f.length > 8) cands.push(f.length * 0.27, f.length * 0.73);
        if (f.length > 14) cands.push(f.length * 0.15, f.length * 0.85);
        let placed = 0;
        for (const u of cands) {
          if (placed >= maxN) break;
          if (!rf.chance(near ? 0.95 : 0.75)) continue;
          const it = verticalSign(ctxB, F, u, placed, rf, isAdopted);
          if (it) { items.push(it); placed++; }
        }
        // small projecting light boxes at fascia level
        if (near && rf.chance(0.55)) {
          for (const u of [0.35, f.length - 0.35]) {
            if (!rf.chance(0.5)) continue;
            const it = lightbox(ctxB, F, u, rf, isAdopted);
            if (it) { items.push(it); break; }
          }
        }
      }
      // wall boards on upper floors
      if (pl.floors >= 3 && dmin < 60) {
        const nw = near ? 2 : 1;
        for (let i = 0; i < nw; i++) {
          if (!rf.chance(near ? 0.55 : 0.3)) continue;
          const it = wallBoard(ctxB, F, rf, i);
          if (it) items.push(it);
        }
      }
      // ground floor extras near the walk
      if (dmin < 24) {
        const g = tenants[0];
        if (g && (g.noren || g.trade === '食堂') && rf.chance(0.75)) { const it = noren(ctxB, F, rf, g); if (it) items.push(it); }
        if (g && g.trade === '理容' && (isAdopted || rf.chance(0.5))) { const it = barberPole(ctxB, F, rf); if (it) items.push(it); }
        const ns = rf.int(0, f.length > 6 ? 2 : 1);
        for (let i = 0; i < ns; i++) { const it = standSign(ctxB, F, rf, i); if (it) items.push(it); }
      }
    }
    // rooftop billboard(s)
    if (pl.floors >= 3 && bmin < 100) {
      const rr = env.rng(`signage/roof/${b.id}`);
      const front = fs.filter((x) => x.f.streetFacing && x.f.length >= 4).sort((a, c) => a.dmin - c.dmin)[0];
      if (front && rr.chance(bmin < 20 ? 0.7 : 0.45)) {
        const it = rr.chance(0.35) ? roofSideBoard(ctxB, front, rr) || roofBoard(ctxB, front, rr) : roofBoard(ctxB, front, rr) || roofSideBoard(ctxB, front, rr);
        if (it) items.push(it);
      }
    }
  }
  env.fictionalNames = [...fictionalNames];
  return items;

  // ======================================================================================
  // Item makers. Each registers its volume with `space` and returns an item or null.
  // ======================================================================================

  function adoptedBoard(B, fs, signF, tnode) {
    const pts = signF.polygons.flat();
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    let best = null;
    for (const F of fs) {
      const { fr, f } = F;
      const u = (cx - fr.ox) * fr.rx + (cz - fr.oz) * fr.rz, d = (cx - fr.ox) * fr.nx + (cz - fr.oz) * fr.nz;
      if (u < -0.2 || u > f.length + 0.2 || Math.abs(d) > 0.6) continue;
      if (!best || Math.abs(d) < best.d) best = { F, d: Math.abs(d) };
    }
    if (!best) return null;
    const F = best.F; const { fr, f, dmin } = F;
    // board extents in the facade frame (adopted polygon), text frame from the text node
    let u0 = Infinity, u1 = -Infinity, y0 = Infinity, y1 = -Infinity, d1 = -Infinity;
    for (const p of pts) {
      const u = (p[0] - fr.ox) * fr.rx + (p[2] - fr.oz) * fr.rz, d = (p[0] - fr.ox) * fr.nx + (p[2] - fr.oz) * fr.nz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); d1 = Math.max(d1, d);
    }
    const r = env.rng(`signage/adopted/${signF.id}`);
    const ppm = ppmFor(dmin, 1.05);
    let textD = d1 + 0.01, tu = (u0 + u1) / 2, ty = (y0 + y1) / 2, R = fr.R, N = fr.N;
    if (tnode) {
      const [tx, tyy, tz] = tnode.position_m;
      tu = (tx - fr.ox) * fr.rx + (tz - fr.oz) * fr.rz; textD = (tx - fr.ox) * fr.nx + (tz - fr.oz) * fr.nz; ty = tyy;
      const [bx, bz] = tnode.baseline_direction_xz;
      R = [bx, 0, bz]; N = [-bz, 0, bx];
    }
    // enlarge the board slightly around the glyphs (allowed), keep the adopted centre/plane
    const yb0 = y0 - 0.04, yb1 = y1 + 0.06;
    const bw = u1 - u0;
    const g = B.tenants[0];
    const sch = tnode ? { ...SCHEMES[r.pick(LIGHT_BG)] } : { ...SCHEMES[r.pick(LIGHT_BG)] };
    sch.bg = r.pick(['#efece4', '#ece6d6', '#f1efe9', '#e9e4d6', '#e6e2d9']);
    const spec = {
      scheme: sch,
      text: tnode ? tnode.text : (g ? g.display : '営業中'),
      textKind: r.pick(['heavy', 'heavy', 'shadow', 'plain']),
      weather: r.range(0.2, 0.55),
      band: r.chance(0.6) ? { h: r.range(0.04, 0.09), top: true, bottom: r.chance(0.6), color: sch.ac, stripe: r.chance(0.3) ? sch.fg : null } : null,
      borderColor: r.chance(0.5) ? shade(sch.ac, -0.3) : null,
      side: r.chance(0.55) ? phone(r) : null,
      emblem: r.chance(0.35) ? { ch: tnode ? [...tnode.text][0] : '店', bg: sch.ac, fg: '#f4f1ea', round: r.chance(0.5) } : null,
      lit: r.chance(0.4) ? 'backlit' : 'none',
    };
    if (tnode) {
      const c = tnode.color_rgba;
      spec.adopted = { inkH_m: tnode.height_m, fg: `rgb(${Math.round(Math.pow(c[0], 1 / 2.2) * 255)},${Math.round(Math.pow(c[1], 1 / 2.2) * 255)},${Math.round(Math.pow(c[2], 1 / 2.2) * 255)})`, u_m: tu - u0, v_m: yb1 - ty };
    } else {
      spec.sub = r.chance(0.5) ? r.pick(PHRASES) : null;
    }
    const cls = r.chance(0.5) ? 'gloss' : 'paint';
    const fq = req('fascia', spec, bw, yb1 - yb0, ppm, cls);
    space.addVolume(volF(fr, u0, u1, 0, textD + 0.05, yb0, yb1));
    const lamps = dmin < 30 && r.chance(0.45);
    const trim = r.pick(TRIM), edge = r.pick(PAINT_EDGE);
    return {
      facade: f,
      item: {
        id: signF.id, kind: 'fascia-adopted', tier: tnode ? 'adopted-inferred' : 'adopted-inferred', textNode: tnode ? tnode.id : null, fictional: false, faces: [fq], spec,
        note: tnode ? `adopted text node ${tnode.id} rendered at its position/orientation/size on the adopted sign board` : 'adopted sign board placement; generic period text (no adopted text node)',
        emit(G) {
          // board body: back at the wall, front plane just behind the text node plane
          const dF = textD - 0.004, dB = 0.0;
          const c = W(fr, (u0 + u1) / 2, (yb0 + yb1) / 2, (dF + dB) / 2);
          const X = R, Z = N;
          box(G.painted, c, X, UP, Z, bw / 2, (yb1 - yb0) / 2, (dF - dB) / 2, lin(edge), (k) => (k === 'pz' ? { batch: G.faceBatch(fq.region, cls), uv: fq.region.uv } : null), new Set(['nz']));
          trimFrame(G, fr, u0, u1, yb0, yb1, dF, trim, X, Z);
          if (lamps) goosenecks(G, fr, u0, u1, yb1, dF, r);
          if (tnode && spec.adopted.u_px !== undefined) {
            // validation: world position of the painted glyph centre vs the adopted text node
            const reg = fq.region, sx = reg.w / bw, sy = reg.h / (yb1 - yb0);
            const p = W(fr, u0 + spec.adopted.u_px / sx, yb1 - spec.adopted.v_px / sy, dF + 0.004);
            const q = tnode.position_m;
            const ar = spec.adoptedRendered || {};
            (env.adoptedCheck || (env.adoptedCheck = [])).push({ id: tnode.id, err: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), inkH: ar.inkH_px ? ar.inkH_px / sy : null, sx: ar.sx, dirDot: X[0] * tnode.baseline_direction_xz[0] + X[2] * tnode.baseline_direction_xz[1] });
          }
        },
      },
    };
  }

  function adoptedAwning(B, fs, awF, tnode) {
    const pts = awF.polygons.flat();
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    let best = null;
    for (const F of fs) {
      const { fr, f } = F;
      const u = (cx - fr.ox) * fr.rx + (cz - fr.oz) * fr.rz, d = (cx - fr.ox) * fr.nx + (cz - fr.oz) * fr.nz;
      if (u < -0.3 || u > f.length + 0.3 || Math.abs(d) > 1.2) continue;
      if (!best || Math.abs(d) < best.d) best = { F, d: Math.abs(d) };
    }
    if (!best) return null;
    const { fr, f, dmin } = best.F;
    let u0 = Infinity, u1 = -Infinity, yTop = -Infinity, dOut = -Infinity;
    for (const p of pts) {
      const u = (p[0] - fr.ox) * fr.rx + (p[2] - fr.oz) * fr.rz, d = (p[0] - fr.ox) * fr.nx + (p[2] - fr.oz) * fr.nz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); yTop = Math.max(yTop, p[1]); dOut = Math.max(dOut, d);
    }
    u0 = Math.max(u0, 0.05); u1 = Math.min(u1, f.length - 0.05);
    const key = awF.material_key.replace('awning-', '');
    const r = env.rng(`signage/adopted-awning/${awF.id}`);
    const base = { red: ['#a8261d', '#b8352a', '#9c2018'], blue: ['#1f4a8a', '#2a5a96', '#28457a'], green: ['#1e6a46', '#2a7550', '#245c3e'] }[key] || ['#888'];
    const c1 = r.pick(base);
    const g = B.tenants[0];
    const stripes = r.chance(0.45);
    const valText = r.chance(0.7) ? (tnode ? `${tnode.text}${g && g.name ? ' ' + g.name : ''}` : (g ? g.display : null)) : null;
    if (g && g.name && valText && valText.includes(g.name)) fictionalNames.add(g.name);
    return awningItem(B, best.F, u0, u1, yTop, Math.max(0.6, dOut), {
      c1, c2: '#ede6d6', stripes, stripeW: r.range(0.18, 0.3), fg: '#f4efe4', text: valText, side: valText && r.chance(0.5) ? phone(r).replace('TEL ', '☎') : null, scallop: r.chance(0.5) ? r.range(0.18, 0.3) : 0, weather: r.range(0.4, 0.85),
    }, r, `adopted awning ${awF.id} (adopted colour key ${key}, extent and depth); cloth form and valance text period-plausible-generic`, 'adopted-inferred', awF.id);
  }

  function awningItem(B, F, u0, u1, yTop, depth, spec, r, note, tier, id) {
    const { fr, dmin } = F;
    const adoptedAw = tier === 'adopted-inferred';
    let drop = r.range(0.32, 0.48), valH = r.range(0.2, 0.28);
    const room = yTop - (B.pl.baseY + 2.15);
    if (drop + valH > room) {
      if (!adoptedAw) return null;
      // adopted awnings are always kept: flatten to fit the head height
      drop = Math.max(0.08, room * 0.55); valH = Math.max(0.12, room * 0.45);
    }
    const yEdge = yTop - drop;
    const vol = volF(fr, u0, u1, 0.02, depth + 0.05, yEdge - valH, yTop);
    if (!adoptedAw && space.hits(vol, 0.02)) return null;
    for (const uu of [u0 + 0.05, u1 - 0.05]) { const p = W(fr, uu, 0, depth); if (!adoptedAw && space.buildingAt(p[0], p[2])) return null; }
    space.addVolume(vol);
    const ppm = ppmFor(dmin, 0.8);
    const w = u1 - u0;
    const slope = Math.hypot(depth, drop);
    const round = r.chance(0.25) && w < 4.5;
    const fTop = req('awningTop', spec, w, round ? slope * 1.25 + valH : slope, Math.min(ppm, 90), 'cloth');
    const fVal = round ? null : req('valance', spec, w, valH, ppm, 'cloth');
    const faces = fVal ? [fTop, fVal] : [fTop];
    return {
      id: id || `awning:${F.f.id}:${u0.toFixed(1)}`, kind: 'awning', tier, fictional: !!(spec.text && B.tenants[0] && B.tenants[0].fictional), faces, note,
      emit(G) {
        const cb = G.faceBatch(fTop.region, 'cloth');
        const [a0, b0, a1, b1] = fTop.region.uv;
        const col = [1, 1, 1];
        if (!round) {
          const p0 = W(fr, u0, yTop, 0.02), p1 = W(fr, u1, yTop, 0.02), p2 = W(fr, u1, yEdge, depth), p3 = W(fr, u0, yEdge, depth);
          const n = v3.norm(v3.cross(v3.sub(p1, p0), v3.sub(p3, p0)));
          const nn = n[1] < 0 ? v3.neg(n) : n;
          // u along width; v: wall at top of region (b1) to edge (b0). Normal faces up/out.
          cb.quad(p3, p2, p1, p0, nn, [[a0, b0], [a1, b0], [a1, b1], [a0, b1]], col);
          const vb = G.faceBatch(fVal.region, 'cloth');
          const [c0, d0, c1, d1] = fVal.region.uv;
          vb.quad(W(fr, u0, yEdge - valH, depth), W(fr, u1, yEdge - valH, depth), W(fr, u1, yEdge, depth), W(fr, u0, yEdge, depth), fr.N, [[c0, d0], [c1, d0], [c1, d1], [c0, d1]], col);
          // side cheeks (triangles) using a strip of the top texture
          for (const [u, s] of [[u0, -1], [u1, 1]]) {
            const R = v3.mul(fr.R, s);
            cb.tri(W(fr, u, yTop, 0.02), W(fr, u, yEdge, depth), W(fr, u, yEdge - valH * 0.9, depth), R, [[a0, b1], [a0 + (a1 - a0) * 0.06, b0], [a0, b0]], col);
          }
        } else {
          // quarter-round dome awning
          const segs = 7, hTot = drop + valH;
          const prof = Array.from({ length: segs + 1 }, (_, i) => { const t = (i / segs) * Math.PI / 2; return [depth * Math.sin(t), yTop - hTot * (1 - Math.cos(t))]; });
          let acc = 0; const lens = [0];
          for (let i = 1; i <= segs; i++) { acc += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); lens.push(acc); }
          for (let i = 0; i < segs; i++) {
            const [dA, yA] = prof[i], [dB, yB] = prof[i + 1];
            const vA = b1 - (b1 - b0) * (lens[i] / acc), vB = b1 - (b1 - b0) * (lens[i + 1] / acc);
            const pA0 = W(fr, u0, yA, dA + 0.02), pA1 = W(fr, u1, yA, dA + 0.02), pB1 = W(fr, u1, yB, dB + 0.02), pB0 = W(fr, u0, yB, dB + 0.02);
            const tm = (i + 0.5) / segs * Math.PI / 2;
            const nn = v3.norm(v3.add(v3.mul(fr.N, Math.sin(tm)), [0, Math.cos(tm), 0]));
            cb.quad(pB0, pB1, pA1, pA0, nn, [[a0, vB], [a1, vB], [a1, vA], [a0, vA]], col);
          }
          for (const [u, s] of [[u0, -1], [u1, 1]]) {
            const R = v3.mul(fr.R, s);
            const cen = W(fr, u, yTop - hTot, 0.02);
            const tu = a0 + 0.0008, tv = b0 + 0.0008; // one texel: solid cloth colour on the end caps
            for (let i = 0; i < segs; i++) cb.tri(cen, W(fr, u, prof[i][1], prof[i][0] + 0.02), W(fr, u, prof[i + 1][1], prof[i + 1][0] + 0.02), R, [[tu, tv], [tu, tv], [tu, tv]], col);
          }
        }
        // steel frame: front rail and arms
        const steel = lin('#5d5a55');
        cylinder(G.steel, W(fr, u0, yEdge - 0.01, depth - 0.02), W(fr, u1, yEdge - 0.01, depth - 0.02), 0.014, 5, steel, null, false);
        const na = Math.max(2, Math.round((u1 - u0) / 1.8) + 1);
        for (let i = 0; i < na; i++) {
          const u = u0 + 0.05 + ((u1 - u0 - 0.1) * i) / (na - 1);
          cylinder(G.steel, W(fr, u, yTop - 0.02, 0.02), W(fr, u, yEdge - 0.03, depth - 0.04), 0.011, 4, steel, null, false);
        }
      },
    };
  }

  function genericAwning(B, F, rf) {
    const { fr, f } = F;
    const u0 = rf.range(0.3, 0.8), u1 = f.length - rf.range(0.3, 0.8);
    if (u1 - u0 < 1.4) return null;
    const yTop = B.pl.fasciaY0 - 0.12;
    const g = B.tenants[0];
    const c1 = rf.pick(['#a8261d', '#1f4a8a', '#1e6a46', '#c96a1c', '#6a2a3a', '#2a2a2a', '#b8352a']);
    const spec = { c1, c2: '#ede6d6', stripes: rf.chance(0.5), stripeW: rf.range(0.18, 0.3), fg: '#f4efe4', text: g && rf.chance(0.6) ? g.display : null, scallop: rf.chance(0.4) ? rf.range(0.18, 0.3) : 0, weather: rf.range(0.4, 0.9) };
    return awningItem(B, F, u0, u1, yTop, rf.range(0.7, 1.1), spec, rf, 'generic cloth awning (period-plausible-generic)', 'period-plausible-generic');
  }

  function genericFascia(B, F, u0, u1, idx, rf) {
    const { fr, f, dmin } = F;
    const pl = B.pl;
    const r = env.rng(`signage/fascia/${f.id}/${idx}`);
    const g = (idx === 0 ? B.tenants[0] : null) || uniq(r, () => { const t = r.pick(TRADES.filter((x) => x.g)); const nm = shopName(r, t); const d = nm.name ? `${t.w} ${nm.name}` : t.w; return { key: d, display: d, trade: t.w, name: nm.name, fictional: nm.fictional, scheme: SCHEMES[r.pick(t.sch)] }; });
    if (g.fictional && g.name) fictionalNames.add(g.name);
    const y0 = pl.fasciaY0 - r.range(0, 0.06), y1 = pl.fasciaY1 + r.range(0, 0.2);
    const depth = r.range(0.12, 0.26);
    for (const uu of [u0, u1]) { const p = W(fr, uu, 0, depth + 0.02); if (space.buildingAt(p[0], p[2])) return null; }
    const vol = volF(fr, u0, u1, 0, depth + 0.04, y0, y1);
    if (space.hits(vol, 0.01)) return null;
    space.addVolume(vol);
    const ppm = ppmFor(dmin);
    const scheme = r.chance(0.55) ? g.scheme : SCHEMES[r.pick(ALL_SCHEMES)];
    const neon = dmin < 40 && r.chance(0.18) ? neonStyle(r, { ...scheme, bg: '#1d1c1a' }) : null;
    const sch = neon ? { ...scheme, bg: r.pick(['#1d1c1a', '#20302a', '#2a1a20', '#1a2233']) } : scheme;
    const spec = {
      scheme: sch, text: g.display, textKind: pickTextKind(r), weather: r.range(0.35, 0.9), neon,
      sub: !neon && r.chance(0.45) ? (r.chance(0.5) ? r.pick(PHRASES) : phone(r)) : null,
      band: !neon && r.chance(0.4) ? { h: r.range(0.04, 0.1), top: true, bottom: r.chance(0.5), color: sch.ac } : null,
      emblem: !neon && r.chance(0.25) ? { ch: [...g.trade][0], bg: sch.ac, fg: sch.bg, round: r.chance(0.5) } : null,
      side: !neon && r.chance(0.25) ? phone(r) : null,
      borderColor: r.chance(0.45) ? shade(sch.bg, -0.4) : null, pin: r.chance(0.3) ? sch.ac : null,
      seams: r.chance(0.3), lit: neon ? 'neon' : r.chance(0.4) ? 'backlit' : 'none', bulbs: dmin < 50 && r.chance(0.1) ? r.range(0.14, 0.2) : 0,
    };
    const cls = r.chance(0.5) ? 'gloss' : 'paint';
    const fq = req('fascia', spec, u1 - u0, y1 - y0, ppm, cls);
    const trim = r.pick(TRIM), edge = r.pick(PAINT_EDGE);
    const lamps = dmin < 30 && r.chance(0.35);
    return {
      id: `fascia:${f.id}:${idx}`, kind: 'fascia', tier: 'period-plausible-generic', fictional: !!g.fictional, faces: [fq], spec, note: 'generic fascia sign (trade word + fictional name)',
      emit(G) {
        const c = W(fr, (u0 + u1) / 2, (y0 + y1) / 2, depth / 2);
        box(G.painted, c, fr.R, UP, fr.N, (u1 - u0) / 2, (y1 - y0) / 2, depth / 2, lin(edge), (k) => (k === 'pz' ? { batch: G.faceBatch(fq.region, cls), uv: fq.region.uv } : null), new Set(['nz']));
        trimFrame(G, fr, u0, u1, y0, y1, depth, trim, fr.R, fr.N);
        if (lamps) goosenecks(G, fr, u0, u1, y1, depth, r);
        if (spec.bulbPx && dmin < 22) bulbsOnFace(G, fq, W(fr, (u0 + u1) / 2, (y0 + y1) / 2, depth), fr.R, UP, fr.N, u1 - u0, y1 - y0);
      },
    };
  }

  function verticalSign(B, F, u, idx, rf, isAdopted) {
    const { fr, f, dmin } = F;
    const pl = B.pl, b = B.b;
    const r = env.rng(`signage/vertical/${f.id}/${idx}`);
    const directory = r.chance(0.45) && B.tenants.filter(Boolean).length >= 3;
    const sw = directory ? r.range(0.7, 1.05) : r.range(0.55, 1.0);
    const d0 = r.range(0.36, 0.42), d1 = Math.min(1.5, d0 + sw);
    const th = r.range(0.16, 0.3);
    const lowStart = !isAdopted && r.chance(0.25);
    let yb = lowStart ? pl.baseY + r.range(2.6, 3.0) : pl.fasciaY1 + r.range(0.25, 0.6);
    const ytMax = b.topY + (r.chance(0.2) ? r.range(0.3, 1.2) : -r.range(0.2, 0.8));
    if (ytMax - yb < 1.4) return null;
    // panels
    const panels = [];
    let fictional = false;
    if (directory) {
      const ten = B.tenants.slice(1).filter(Boolean).reverse();
      for (const t of ten.slice(0, 6)) {
        panels.push({ label: floorLabel(t.floor, r), text: t.name ? t.display.replace(' ', '') : t.trade, trade: t.trade, name: t.name && !t.display.endsWith(t.name) ? null : t.name, scheme: r.chance(0.6) ? t.scheme : SCHEMES[r.pick(LIGHT_BG)], kind: pickTextKind(r), labelStyle: r.chance(0.4) ? 'disc' : 'band' });
        if (t.fictional) fictional = true;
      }
    } else {
      const t = leastUsed(B.tenants, r);
      if (!t) return null;
      t.uses++;
      if (t.fictional) fictional = true;
      const p = { text: t.name ? t.display.replace(' ', '') : t.trade, trade: t.name && t.trade !== 'ビル' && t.display !== t.name ? t.trade : null, name: t.name, scheme: t.scheme, kind: pickTextKind(r), small: r.chance(0.4) ? phone(r) : null, tenant: t };
      panels.push(p);
      if (r.chance(0.3)) panels.push({ text: r.pick(PHRASES), scheme: SCHEMES[r.pick(LIGHT_BG)], kind: 'plain', weight: 0.45 });
    }
    if (!panels.length) return null;
    // height from content: characters at ~84% of the face width, stretched 1.0-1.35
    const cs = sw * 0.84, stretch = r.range(1.0, 1.35);
    let want = 0.1;
    for (const p of panels) {
      const n = [...(p.name && p.trade ? p.name : p.text)].length;
      const ph = (p.label ? Math.min(0.42, sw * 0.7) * 1.2 : 0) + n * cs * 1.06 * (p.weight && p.weight < 1 ? 0.8 : stretch) + 0.12;
      p.weight = ph; want += ph;
    }
    const yt = Math.min(ytMax, yb + Math.max(1.6, want));
    if (yt - yb < 1.4) return null;
    if (u - th / 2 < 0.15 || u + th / 2 > f.length - 0.15) return null;
    // the projecting volume must be open air (not inside any building) and clear of other signs
    for (const t of [0.2, 0.6, 1.0]) {
      const p = W(fr, u, 0, d0 + (d1 - d0) * t + 0.1);
      if (space.buildingAt(p[0], p[2])) return null;
    }
    const outer = W(fr, u, 0, d1);
    if (ctx.data.routeDistance(outer[0], outer[2]) < 1.0) return null;
    const vol = volF(fr, u - th / 2 - 0.05, u + th / 2 + 0.05, 0.3, d1 + 0.05, yb - 0.1, yt + 0.1);
    if (space.hits(vol, 0.3)) return null;
    space.addVolume(vol);
    const neon = !directory && dmin < 45 && r.chance(0.22) ? neonStyle(r, panels[0].scheme) : null;
    if (neon) panels.forEach((p) => { p.scheme = { ...p.scheme, bg: r.pick(['#1d1c1a', '#203028', '#2a1a22', '#1a2233', '#3a2a1a']) }; });
    const header = !directory && panels[0].tenant && panels[0].tenant.floor > 1 && r.chance(0.45) ? { text: floorLabel(panels[0].tenant.floor, r), scheme: SCHEMES[r.pick(['whiteOnRed', 'whiteOnBlue', 'blackOnYellow', 'whiteOnGreen'])] } : null;
    const cls = r.chance(0.6) ? 'gloss' : 'paint';
    const spec = { panels, header, neon, weather: r.range(0.35, 0.9), lit: neon ? 'neon' : cls === 'gloss' ? 'backlit' : 'none', bulbs: (neon || r.chance(0.12)) ? r.range(0.12, 0.18) : 0, frame: r.pick(['#3a3631', '#2a2825', '#6a6660', '#8a1f18']) };
    for (const p of panels) if (p.name) fictionalNames.add(p.name);
    const ppm = ppmFor(dmin, 0.95);
    const hgt = yt - yb, wid = d1 - d0;
    const fq = req('vertical', spec, wid, hgt, ppm, cls);
    const edge = lin(r.pick(PAINT_EDGE));
    const steel = lin(r.pick(['#4a4844', '#5d5a55', '#3a3835', '#6b665e']));
    return {
      id: `vertical:${f.id}:${idx}`, kind: 'vertical', tier: 'period-plausible-generic', fictional, faces: [fq], spec, note: directory ? 'stacked floor-directory projecting sign' : 'projecting vertical sign',
      emit(G) {
        const X = v3.neg(fr.N), Z = fr.R;
        const c = W(fr, u, (yb + yt) / 2, (d0 + d1) / 2);
        const fb = G.faceBatch(fq.region, cls);
        box(G.painted, c, X, UP, Z, wid / 2, hgt / 2, th / 2, edge, (k) => (k === 'pz' || k === 'nz' ? { batch: fb, uv: fq.region.uv } : null));
        // top cap
        box(G.painted, W(fr, u, yt + 0.02, (d0 + d1) / 2), X, UP, Z, wid / 2 + 0.02, 0.02, th / 2 + 0.02, edge);
        // brackets: arms from the wall every ~2.2 m, diagonal stays on the top/bottom arms
        const nArm = Math.max(2, Math.round(hgt / 2.2) + 1);
        for (let i = 0; i < nArm; i++) {
          const y = yb + 0.15 + ((hgt - 0.3) * i) / (nArm - 1);
          beam(G.steel, W(fr, u, y, 0.0), W(fr, u, y, d0 + 0.06), 0.045, steel);
          box(G.steel, W(fr, u, y, 0.01), fr.R, UP, fr.N, 0.09, 0.11, 0.01, steel);
          if (i === nArm - 1 || i === 0) beam(G.steel, W(fr, u, y - 0.45, 0.0), W(fr, u, y - 0.02, d0 * 0.95), 0.03, steel);
        }
        if (spec.bulbPx && dmin < 22) {
          const cF = W(fr, u, (yb + yt) / 2, (d0 + d1) / 2);
          bulbsOnFace(G, fq, v3.mad(cF, Z, th / 2), X, UP, Z, wid, hgt);
          bulbsOnFace(G, fq, v3.mad(cF, Z, -th / 2), v3.neg(X), UP, v3.neg(Z), wid, hgt);
        }
      },
    };
  }

  function lightbox(B, F, u, rf, isAdopted) {
    const { fr, f, dmin } = F;
    const pl = B.pl;
    const r = env.rng(`signage/lightbox/${f.id}/${u.toFixed(1)}`);
    const t = B.tenants.find(Boolean);
    if (!t) return null;
    const disc = r.chance(0.3);
    const vertical = !disc && r.chance(0.7);
    const wid = disc ? r.range(0.6, 0.9) : vertical ? r.range(0.35, 0.5) : r.range(0.5, 0.75), hgt = disc ? wid : vertical ? r.range(0.9, 1.5) : r.range(0.45, 0.65);
    const d0 = r.range(0.2, 0.3), d1 = d0 + wid, th = r.range(0.14, 0.22);
    const yb = pl.fasciaY1 + r.range(0.25, 0.45);
    const yt = yb + hgt;
    if (u - th < 0.1 || u + th > f.length - 0.1) return null;
    const p = W(fr, u, 0, d1 + 0.1);
    if (space.buildingAt(p[0], p[2])) return null;
    const vol = volF(fr, u - th / 2 - 0.03, u + th / 2 + 0.03, 0.15, d1 + 0.04, yb - 0.05, yt + 0.25);
    if (space.hits(vol, 0.2)) return null;
    space.addVolume(vol);
    const word = disc ? [...t.trade][0] : t.name && r.chance(0.6) ? t.name : t.trade;
    const spec = { text: word, disc, scheme: r.chance(0.5) ? t.scheme : SCHEMES[r.pick(LIGHT_BG)], textKind: pickTextKind(r), lit: 'backlit', weather: r.range(0.3, 0.7), frame: r.pick(['#3b3631', '#8a1f18', '#2a2a28', '#b8b6ae']) };
    if (word === t.name && t.fictional) fictionalNames.add(t.name);
    const fq = req('lightbox', spec, wid, hgt, ppmFor(dmin), 'gloss');
    const steel = lin('#4a4844');
    return {
      id: `lightbox:${f.id}:${u.toFixed(1)}`, kind: 'lightbox', tier: 'period-plausible-generic', fictional: word === t.name && t.fictional, faces: [fq], note: 'small projecting light box',
      emit(G) {
        const X = v3.neg(fr.N), Z = fr.R;
        const fb = G.faceBatch(fq.region, 'gloss');
        if (spec.disc) discGeom(fb, G.painted, W(fr, u, (yb + yt) / 2, (d0 + d1) / 2), X, UP, Z, wid / 2, th / 2, fq.region.uv, lin(spec.frame));
        else box(G.painted, W(fr, u, (yb + yt) / 2, (d0 + d1) / 2), X, UP, Z, wid / 2, hgt / 2, th / 2, lin(spec.frame), (k) => (k === 'pz' || k === 'nz' ? { batch: fb, uv: fq.region.uv } : null));
        // decorative hanging bracket on top
        beam(G.steel, W(fr, u, yt + 0.12, 0), W(fr, u, yt + 0.12, d1 + 0.02), 0.035, steel);
        beam(G.steel, W(fr, u, yt + 0.12, d0 + 0.05), W(fr, u, yt, d0 + 0.05), 0.015, steel);
        beam(G.steel, W(fr, u, yt + 0.12, d1 - 0.05), W(fr, u, yt, d1 - 0.05), 0.015, steel);
        beam(G.steel, W(fr, u, yb + 0.1, 0), W(fr, u, yb + 0.1, d0 + 0.03), 0.03, steel);
      },
    };
  }

  function wallBoard(B, F, rf, wi = 0) {
    const { fr, f, dmin } = F;
    const pl = B.pl, b = B.b;
    const r = env.rng(`signage/wallboard/${f.id}/${wi}`);
    const t = leastUsed(B.tenants.slice(1), r);
    if (!t) return null;
    t.uses++;
    const vertical = r.chance(0.35);
    let u0, u1, y0, y1;
    if (vertical) {
      const w = r.range(0.9, 1.5);
      const atEnd = r.chance(0.5);
      u0 = atEnd ? f.length - w - r.range(0.6, 1.2) : r.range(0.6, 1.2); u1 = u0 + w;
      y0 = pl.baseY + pl.storeyH * 2 + 0.3; y1 = Math.min(b.topY - 0.4, y0 + r.range(3.5, 9));
    } else {
      const fl = r.int(2, Math.min(pl.floors - 1, 5));
      const w = Math.min(f.length - 0.6, f.length * r.range(0.55, 0.92));
      u0 = (f.length - w) / 2 + r.range(-0.3, 0.3); u1 = u0 + w;
      y0 = pl.baseY + pl.storeyH * (fl - 1) + r.range(0.75, 1.0); y1 = y0 + r.range(1.4, 2.4);
      if (y1 > b.topY - 0.3) return null;
    }
    if (u0 < 0.2 || u1 > f.length - 0.2 || y1 - y0 < 1.2) return null;
    const dB = 0.37, dF = dB + 0.06;
    const vol = volF(fr, u0, u1, 0, dF + 0.03, y0, y1);
    if (space.hits(vol, 0.1)) return null;
    space.addVolume(vol);
    const label = floorLabel(t.floor, r);
    const spec = { text: t.name ? t.display.replace(' ', vertical ? '' : ' ') : t.trade, label, sub: !vertical && r.chance(0.6) ? `${r.pick([...PHRASES, ...UPPER_ONLY_PHRASES])}  ${phone(r)}` : null, scheme: r.chance(0.5) ? t.scheme : SCHEMES[r.pick(LIGHT_BG)], textKind: pickTextKind(r), weather: r.range(0.45, 0.95) };
    if (t.fictional && t.name) fictionalNames.add(t.name);
    const fq = req('wallboard', spec, u1 - u0, y1 - y0, ppmFor(dmin, 0.85), 'paint');
    const steel = lin('#55524c');
    return {
      id: `wallboard:${f.id}:${wi}`, kind: 'wallboard', tier: 'period-plausible-generic', fictional: !!t.fictional, faces: [fq], note: 'flush wall board on upper floors (stand-off brackets)',
      emit(G) {
        const fb = G.faceBatch(fq.region, 'paint');
        box(G.painted, W(fr, (u0 + u1) / 2, (y0 + y1) / 2, (dB + dF) / 2), fr.R, UP, fr.N, (u1 - u0) / 2, (y1 - y0) / 2, (dF - dB) / 2, lin('#4a4742'), (k) => (k === 'pz' ? { batch: fb, uv: fq.region.uv } : null));
        for (const uu of [u0 + 0.2, u1 - 0.2]) for (const yy of [y0 + 0.2, y1 - 0.2]) beam(G.steel, W(fr, uu, yy, 0), W(fr, uu, yy, dB), 0.04, steel);
      },
    };
  }

  function noren(B, F, rf, t) {
    const { fr, f, dmin } = F;
    const pl = B.pl;
    const r = env.rng(`signage/noren/${f.id}`);
    const w = r.range(0.9, 1.5), h = r.range(0.55, 0.9);
    const uc = r.range(0.6 + w / 2, Math.max(0.61 + w / 2, f.length - 0.6 - w / 2));
    if (uc + w / 2 > f.length - 0.3) return null;
    const yTop = pl.baseY + r.range(2.0, 2.2), d = 0.1;
    const vol = volF(fr, uc - w / 2 - 0.08, uc + w / 2 + 0.08, 0, d + 0.06, yTop - h, yTop + 0.06);
    if (space.hits(vol, 0.0)) return null;
    space.addVolume(vol);
    const words = NOREN_WORDS[t.trade] || NOREN_WORDS['食堂'];
    const spec = { text: r.pick(words), c1: r.pick(['#1e2a4a', '#24304f', '#6a1f1a', '#efe9da', '#2a2a2a', '#3a2a1e']), panels: r.pick([3, 3, 4, 5]), weather: r.range(0.3, 0.8) };
    spec.fg = spec.c1 === '#efe9da' ? '#1e2a4a' : '#f1ede2';
    const fq = req('noren', spec, w, h, ppmFor(dmin), 'cloth');
    return {
      id: `noren:${f.id}`, kind: 'noren', tier: 'period-plausible-generic', fictional: false, faces: [fq], note: 'cloth noren at a food-shop doorway (generic word)',
      emit(G) {
        const cb = G.faceBatch(fq.region, 'cloth');
        const [a0, b0, a1, b1] = fq.region.uv;
        const n = spec.panels;
        for (let i = 0; i < n; i++) {
          const s0 = i / n, s1 = (i + 1) / n;
          const ua = uc - w / 2 + w * s0, ub = uc - w / 2 + w * s1;
          const sway = r.range(0, 0.035);
          cb.quad(W(fr, ua, yTop - h, d + sway), W(fr, ub, yTop - h, d + sway), W(fr, ub, yTop, d), W(fr, ua, yTop, d), fr.N, [[a0 + (a1 - a0) * s0, b0], [a0 + (a1 - a0) * s1, b0], [a0 + (a1 - a0) * s1, b1], [a0 + (a1 - a0) * s0, b1]], [1, 1, 1]);
        }
        const wood = lin('#6a4a2a');
        cylinder(G.steel, W(fr, uc - w / 2 - 0.06, yTop + 0.02, d), W(fr, uc + w / 2 + 0.06, yTop + 0.02, d), 0.014, 5, wood);
        for (const uu of [uc - w / 2 - 0.03, uc + w / 2 + 0.03]) beam(G.steel, W(fr, uu, yTop + 0.02, 0), W(fr, uu, yTop + 0.02, d + 0.01), 0.02, lin('#3a3835'));
      },
    };
  }

  function barberPole(B, F, rf) {
    const { fr, f, dmin } = F;
    const pl = B.pl;
    const r = env.rng(`signage/pole/${f.id}`);
    const u = r.chance(0.5) ? r.range(0.35, 0.6) : f.length - r.range(0.35, 0.6);
    const y0 = pl.baseY + r.range(1.0, 1.3), h = r.range(0.8, 1.0), rad = 0.085, d = 0.2;
    const vol = volF(fr, u - 0.12, u + 0.12, 0, d + 0.12, y0 - 0.1, y0 + h + 0.2);
    if (space.hits(vol, 0.0)) return null;
    space.addVolume(vol);
    const spec = { kind: 'pole' };
    const fq = req('pole', spec, 0.6, h, 120, 'gloss');
    return {
      id: `pole:${f.id}`, kind: 'barber-pole', tier: 'period-plausible-generic', fictional: false, faces: [fq], note: 'barber pole at an adopted/generic barber (理容) frontage',
      emit(G) {
        const fb = G.faceBatch(fq.region, 'gloss');
        cylinder(fb, W(fr, u, y0, d), W(fr, u, y0 + h, d), rad, 12, [1, 1, 1], fq.region.uv, false);
        const metal = lin('#c9c6bc');
        cylinder(G.steel, W(fr, u, y0 + h, d), W(fr, u, y0 + h + 0.1, d), rad + 0.012, 10, metal);
        cylinder(G.steel, W(fr, u, y0 - 0.08, d), W(fr, u, y0, d), rad + 0.012, 10, metal);
        cylinder(G.steel, W(fr, u, y0 + h + 0.1, d), W(fr, u, y0 + h + 0.16, d), 0.04, 8, lin('#e8e2d0'));
        for (const yy of [y0 + 0.05, y0 + h - 0.05]) beam(G.steel, W(fr, u, yy, 0), W(fr, u, yy, d - rad), 0.03, lin('#55524c'));
      },
    };
  }

  function standSign(B, F, rf, i) {
    const { fr, f } = F;
    const pl = B.pl;
    const r = env.rng(`signage/stand/${f.id}/${i}`);
    const type = r.pick(['aframe', 'aframe', 'andon', 'board']);
    const u = r.range(0.6, f.length - 0.6), d = r.range(0.35, 0.7);
    const p = W(fr, u, 0, d);
    const rad = type === 'andon' ? 0.3 : 0.45;
    if (ctx.data.routeDistance(p[0], p[2]) < 1.2 + rad) return null;
    const pf = W(fr, u, 0, d + rad);
    if (space.buildingAt(p[0], p[2]) || space.buildingAt(pf[0], pf[2])) return null;
    const y = ctx.data.heightAt(p[0], p[2]);
    const vol = volF(fr, u - rad, u + rad, d - 0.3, d + 0.3, y - 0.5, y + 1.5);
    if (space.hits(vol, 0.15)) return null;
    space.addVolume(vol);
    const t = B.tenants.find((x, k) => x && (k === 0 || r.chance(0.5))) || B.tenants.find(Boolean);
    if (!t) return null;
    let spec, fw, fh;
    if (type === 'aframe' || type === 'board') {
      const menu = r.chance(0.5);
      const cat = /喫茶|純喫茶|喫茶室/.test(t.trade) ? '喫茶' : /酒|バー|スナック|クラブ|焼鳥|居酒屋/.test(t.trade) ? '酒' : '食事';
      const items = [...MENU[cat]].sort(() => r() - 0.5).slice(0, 4);
      spec = menu ? { layout: 'menu', title: t.name ? t.name : t.trade, items, scheme: SCHEMES[r.pick(['blackOnWhite', 'whiteOnBlack', 'redOnCream', 'whiteOnGreen', 'brownOnCream'])], weather: r.range(0.3, 0.8) }
        : { layout: 'vname', label: t.floor > 1 ? floorLabel(t.floor, r) : null, title: t.name ? t.display.replace(' ', '') : t.trade, scheme: r.chance(0.5) ? t.scheme : SCHEMES[r.pick(LIGHT_BG)], weather: r.range(0.3, 0.8) };
      fw = type === 'board' ? r.range(0.45, 0.6) : r.range(0.42, 0.55); fh = type === 'board' ? r.range(1.0, 1.3) : r.range(0.75, 0.95);
    } else {
      spec = { layout: 'vname', label: t.floor > 1 ? floorLabel(t.floor, r) : null, title: t.name ? t.display.replace(' ', '') : t.trade, scheme: SCHEMES[r.pick(['blackOnWhite', 'redOnWhite', 'whiteOnPurple', 'goldOnMaroon', 'pinkOnWhite'])], lit: 'backlit', weather: r.range(0.3, 0.6) };
      fw = r.range(0.26, 0.34); fh = r.range(0.75, 1.0);
    }
    if (t.fictional && t.name) fictionalNames.add(t.name);
    const cls = type === 'andon' ? 'gloss' : r.chance(0.5) ? 'gloss' : 'paint';
    const fq = req('stand', spec, fw, fh, 150, cls);
    const dark = lin(r.pick(['#3a3835', '#5a3a24', '#2a2a28', '#8a8780']));
    // stand faces along the street (perpendicular to the facade) so passers-by read it
    const R = fr.N, N = v3.neg(fr.R);
    return {
      id: `stand:${f.id}:${i}`, kind: `stand-${type}`, tier: 'period-plausible-generic', fictional: !!t.fictional && !!t.name, faces: [fq], note: 'standing sign at a doorway (outside the walk corridor)',
      emit(G) {
        const fb = G.faceBatch(fq.region, cls);
        const base = [p[0], y, p[2]];
        if (type === 'aframe') {
          const tilt = 0.17, legH = fh + 0.08;
          for (const s of [1, -1]) {
            const Nn = v3.mul(N, s);
            const Rr = v3.mul(R, s);
            const foot = v3.mad(base, Nn, Math.sin(tilt) * legH);
            const top = v3.add(base, [0, legH * Math.cos(tilt), 0]);
            const mid = v3.mul(v3.add(foot, top), 0.5);
            const Uv = v3.norm(v3.sub(top, foot));
            const Nf = v3.norm(v3.cross(Rr, Uv));
            box(G.painted, v3.mad(mid, Nf, 0.012), Rr, Uv, Nf, fw / 2 + 0.03, legH / 2, 0.012, dark, (k) => (k === 'pz' ? { batch: fb, uv: fq.region.uv } : null));
          }
        } else if (type === 'board') {
          const y0 = 0.25;
          box(G.painted, v3.add(base, [0, y0 + fh / 2, 0]), R, UP, N, fw / 2, fh / 2, 0.015, dark, (k) => (k === 'pz' || k === 'nz' ? { batch: fb, uv: fq.region.uv } : null));
          for (const s of [-1, 1]) {
            const leg = v3.mad(base, R, s * (fw / 2 - 0.04));
            beam(G.steel, leg, v3.add(leg, [0, y0 + 0.05, 0]), 0.03, dark);
            beam(G.steel, v3.mad(leg, N, -0.18), v3.mad(leg, N, 0.18), [0.04, 0.03], dark);
          }
        } else {
          // andon: four lit faces on a dark base
          const y0 = 0.18;
          box(G.painted, v3.add(base, [0, y0 / 2, 0]), R, UP, N, fw / 2 + 0.03, y0 / 2, fw / 2 + 0.03, dark);
          box(G.painted, v3.add(base, [0, y0 + fh / 2, 0]), R, UP, N, fw / 2, fh / 2, fw / 2, dark, (k) => (k !== 'py' && k !== 'ny' ? { batch: fb, uv: fq.region.uv } : null));
          box(G.painted, v3.add(base, [0, y0 + fh + 0.02, 0]), R, UP, N, fw / 2 + 0.02, 0.02, fw / 2 + 0.02, dark);
        }
      },
    };
  }

  function roofBoard(B, F, rr) {
    const { fr, f, dmin } = F;
    const b = B.b;
    const r = env.rng(`signage/roofboard/${b.id}`);
    const w = Math.min(f.length - 0.6, r.range(4.5, 12));
    if (w < 3) return null;
    const h = Math.max(1.8, Math.min(5.0, w * r.range(0.3, 0.55)));
    const lift = r.range(0.7, 1.8);
    const roofY = b.topY;
    const y0 = roofY + lift, y1 = y0 + h;
    const uc = f.length / 2 + r.range(-0.3, 0.3) * (f.length - w) ;
    const dBoard = -r.range(0.35, 1.0), D = r.range(1.0, 1.8);
    for (const [uu, dd] of [[uc - w / 2, dBoard], [uc + w / 2, dBoard], [uc - w / 2, dBoard - D], [uc + w / 2, dBoard - D]]) {
      const p = W(fr, uu, 0, dd);
      if (!space.insideBuilding(b, p[0], p[2])) return null;
    }
    const vol = volF(fr, uc - w / 2, uc + w / 2, dBoard - D, dBoard + 0.1, roofY, y1 + 0.2);
    if (space.hits(vol, 0.2)) return null;
    space.addVolume(vol);
    const t = B.tenants.slice(1).find((x) => x && r.chance(0.5)) || B.tenants.find(Boolean);
    const generic = r.chance(0.35);
    const top = r.chance(0.5) ? r.pick([...PHRASES, '冷暖房完備', '年中無休', '深夜営業']) : null;
    let text, fictional = false, sub = null;
    if (generic || !t) {
      const tr = r.pick(['サウナ', 'レストラン', '喫茶', '麻雀', '旅行', '不動産', 'ビリヤード', '中華料理', 'パチンコ', '洋品', '時計', '眼鏡', '金融']);
      const nm = shopName(r, tr);
      text = nm.name ? `${tr} ${nm.name}` : tr; fictional = nm.fictional; if (nm.name) fictionalNames.add(nm.name);
      sub = r.chance(0.6) ? `${r.pick(['歌舞伎町', '新宿', '当ビル'])}${r.pick(['', ' ' + floorLabel(r.int(2, 6), r)])}  ${phone(r)}` : null;
    } else {
      text = t.display; fictional = !!t.fictional;
      sub = `当ビル ${floorLabel(t.floor, r)}  ${phone(r)}`;
    }
    const spec = { text, top, sub, scheme: SCHEMES[r.pick(['redOnWhite', 'whiteOnRed', 'whiteOnBlue', 'blueOnWhite', 'blackOnYellow', 'redOnYellow', 'whiteOnGreen', 'whiteOnOrange', 'blackOnWhite'])], motif: r.pick(['none', 'none', 'burst', 'stripes', 'disc', 'panel']), discCh: [...text][0], textKind: r.pick(['shadow', 'heavy', 'double', 'outlined']), weather: r.range(0.5, 1.0), bulbs: dmin < 40 && r.chance(0.2) ? r.range(0.25, 0.35) : 0 };
    const ppm = ppmFor(dmin + 6, 0.8);
    const fq = req('roof', spec, w, h, ppm, 'paint');
    const steel = lin(r.pick(['#5a5650', '#4a4640', '#6a5a4a', '#55524c']));
    return {
      id: `roof:${b.id}`, kind: 'roof-billboard', tier: 'period-plausible-generic', fictional, faces: [fq], spec, note: 'rooftop billboard on a steel lattice frame',
      emit(G) {
        const dB = dBoard;
        const fb = G.faceBatch(fq.region, 'paint');
        box(G.painted, W(fr, uc, (y0 + y1) / 2, dB - 0.04), fr.R, UP, fr.N, w / 2, h / 2, 0.04, lin('#6a6760'), (k) => (k === 'pz' ? { batch: fb, uv: fq.region.uv } : null));
        lattice(G, fr, uc - w / 2, uc + w / 2, roofY, y0, y1, dB - 0.08, D, steel, r);
        // floodlight arms along the bottom edge
        const nl = Math.max(2, Math.round(w / 3));
        for (let i = 0; i < nl; i++) {
          const uu = uc - w / 2 + (w * (i + 0.5)) / nl;
          beam(G.steel, W(fr, uu, y0 - 0.05, dB - 0.05), W(fr, uu, y0 - 0.05, dB + 0.55), 0.03, steel);
          box(G.steel, W(fr, uu, y0 - 0.02, dB + 0.6), fr.R, UP, fr.N, 0.09, 0.06, 0.08, lin('#3a3835'));
        }
        if (spec.bulbPx && dmin < 40) bulbsOnFace(G, fq, W(fr, uc, (y0 + y1) / 2, dB), fr.R, UP, fr.N, w, h);
      },
    };
  }

  function roofSideBoard(B, F, rr) {
    // double-faced board perpendicular to the street front, seen up/down the street
    const { fr, f, dmin } = F;
    const b = B.b;
    const r = env.rng(`signage/roofside/${b.id}`);
    const w = r.range(2.2, 4.5), h = r.range(2.5, 6.5);
    const atEnd = r.chance(0.5);
    const u = atEnd ? f.length - r.range(0.5, 1.0) : r.range(0.5, 1.0);
    const dA = -r.range(0.2, 0.5), dB = dA - w;
    const roofY = b.topY, y0 = roofY + r.range(0.6, 1.4), y1 = y0 + h;
    for (const dd of [dA, dB, (dA + dB) / 2]) for (const du of [-0.4, 0.4]) {
      const p = W(fr, u + du, 0, dd);
      if (!space.insideBuilding(b, p[0], p[2])) return null;
    }
    const vol = volF(fr, u - 0.5, u + 0.5, dB, dA, roofY, y1 + 0.2);
    if (space.hits(vol, 0.2)) return null;
    space.addVolume(vol);
    const t = B.tenants.slice(1).find((x) => x && r.chance(0.6)) || B.tenants.find(Boolean);
    if (!t) return null;
    const label = t.floor > 1 ? floorLabel(t.floor, r) : null;
    const spec = { text: t.name ? t.display.replace(' ', '') : t.trade, label, scheme: r.chance(0.5) ? t.scheme : SCHEMES[r.pick(['redOnWhite', 'whiteOnRed', 'whiteOnBlue', 'blackOnYellow'])], textKind: pickTextKind(r), weather: r.range(0.5, 1.0) };
    if (t.fictional && t.name) fictionalNames.add(t.name);
    const fq = req('wallboard', spec, w, h, ppmFor(dmin + 4, 0.85), 'paint');
    const steel = lin('#55524c');
    return {
      id: `roofside:${b.id}`, kind: 'roof-side-billboard', tier: 'period-plausible-generic', fictional: !!t.fictional, faces: [fq], note: 'double-faced rooftop sign perpendicular to the street',
      emit(G) {
        const X = v3.neg(fr.N), Z = fr.R;
        const fb = G.faceBatch(fq.region, 'paint');
        box(G.painted, W(fr, u, (y0 + y1) / 2, (dA + dB) / 2), X, UP, Z, w / 2, h / 2, 0.06, lin('#5a5650'), (k) => (k === 'pz' || k === 'nz' ? { batch: fb, uv: fq.region.uv } : null));
        // legs and braces down to the roof
        const nl = Math.max(2, Math.round(w / 1.5) + 1);
        for (let i = 0; i < nl; i++) {
          const dd = dA - 0.1 - ((w - 0.2) * i) / (nl - 1);
          for (const s of [-1, 1]) {
            beam(G.steel, W(fr, u + s * 0.35, roofY, dd), W(fr, u + s * 0.08, y0 + 0.2, dd), 0.06, steel);
          }
          beam(G.steel, W(fr, u - 0.35, roofY + 0.3, dd), W(fr, u + 0.35, roofY + 0.3, dd), 0.04, steel);
        }
        beam(G.steel, W(fr, u, y0 - 0.02, dA - 0.05), W(fr, u, y0 - 0.02, dB + 0.05), 0.07, steel);
        for (const s of [-1, 1]) beam(G.steel, W(fr, u + s * 0.35, roofY + 0.05, dA - 0.1), W(fr, u + s * 0.35, roofY + 0.05, dB + 0.1), 0.06, steel);
      },
    };
  }

  function flushBoard(B, F, u0, u1, i, rf) {
    const { fr, f, dmin } = F;
    const pl = B.pl, b = B.b;
    const r = env.rng(`signage/flush/${f.id}/${i}`);
    if (u0 < 0.25 || u1 > f.length - 0.25) return null;
    const y0 = pl.baseY + pl.storeyH * r.int(1, 2) + r.range(0.3, 0.9);
    const y1 = Math.min(b.topY - r.range(0.3, 1.5), y0 + r.range(2.5, 8.5));
    if (y1 - y0 < 2.0) return null;
    const dB = 0.37 + r.range(0, 0.04), dF = dB + 0.05;
    const vol = volF(fr, u0, u1, 0.3, dF + 0.03, y0, y1);
    if (space.hits(vol, 0.12)) return null;
    space.addVolume(vol);
    const t = leastUsed(B.tenants, r);
    if (!t) return null;
    t.uses++;
    const strong = ['whiteOnRed', 'whiteOnBlue', 'whiteOnGreen', 'blackOnYellow', 'redOnYellow', 'whiteOnOrange', 'goldOnMaroon', 'whiteOnTeal', 'redOnWhite', 'blueOnWhite'];
    const spec = { text: t.name ? t.display.replace(' ', '') : t.trade, label: t.floor > 1 && r.chance(0.7) ? floorLabel(t.floor, r) : null, scheme: r.chance(0.5) ? t.scheme : SCHEMES[r.pick(strong)], textKind: pickTextKind(r), weather: r.range(0.4, 0.95) };
    if (t.fictional && t.name) fictionalNames.add(t.name);
    const fq = req('wallboard', spec, u1 - u0, y1 - y0, ppmFor(dmin, 0.9), r.chance(0.4) ? 'gloss' : 'paint');
    const steel = lin('#55524c');
    return {
      id: `flush:${f.id}:${i}`, kind: 'flush-vertical-board', tier: 'period-plausible-generic', fictional: !!t.fictional, faces: [fq], note: 'flush vertical board on a facade seen face-on (plaza edge / street end)',
      emit(G) {
        const fb = G.faceBatch(fq.region, fq.cls);
        box(G.painted, W(fr, (u0 + u1) / 2, (y0 + y1) / 2, (dB + dF) / 2), fr.R, UP, fr.N, (u1 - u0) / 2, (y1 - y0) / 2, (dF - dB) / 2, lin('#4a4742'), (k) => (k === 'pz' ? { batch: fb, uv: fq.region.uv } : null));
        for (const yy of [y0 + 0.25, (y0 + y1) / 2, y1 - 0.25]) for (const uu of [u0 + 0.15, u1 - 0.15]) beam(G.steel, W(fr, uu, yy, 0), W(fr, uu, yy, dB), 0.04, steel);
      },
    };
  }

  /** Round sign: textured discs on both faces (normal ±Z), painted rim. */
  function discGeom(fb, rimBatch, c, X, Y, Z, rad, hz, uv, rimCol, segs = 20) {
    const [u0, v0, u1, v1] = uv;
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2, ur = (u1 - u0) / 2, vr = (v1 - v0) / 2;
    for (const s of [1, -1]) {
      const n = v3.mul(Z, s);
      const cc = v3.mad(c, Z, s * hz);
      const Xs = v3.mul(X, s); // keeps text reading left-to-right on both faces
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const p = (a) => v3.add(cc, v3.add(v3.mul(Xs, Math.cos(a) * rad), v3.mul(Y, Math.sin(a) * rad)));
        const q = (a) => [um + Math.cos(a) * ur, vm + Math.sin(a) * vr];
        fb.tri(cc, p(a0), p(a1), n, [[um, vm], q(a0), q(a1)], [1, 1, 1]);
      }
    }
    // rim band
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const e = (a, s) => v3.add(v3.mad(c, Z, s * hz), v3.add(v3.mul(X, Math.cos(a) * rad), v3.mul(Y, Math.sin(a) * rad)));
      const nm = v3.norm(v3.add(v3.mul(X, Math.cos((a0 + a1) / 2)), v3.mul(Y, Math.sin((a0 + a1) / 2))));
      rimBatch.quad(e(a0, -1), e(a1, -1), e(a1, 1), e(a0, 1), nm, [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]], rimCol);
    }
  }

  /**
   * Content for the next sign of a building: an unused tenant first; then the building's own
   * (fictional) name; then an off-site advertiser (a fictional business elsewhere in the block,
   * common on Kabukicho facades). Avoids the same text on adjacent signs.
   */
  function leastUsed(list, r) {
    const pool = list.filter(Boolean);
    const fresh = pool.filter((t) => !(t.uses > 0));
    if (fresh.length) return r.pick(fresh);
    const B = list.__B;
    const b = pool.length ? pool[0].__b : null;
    const key = b || 'x';
    if (!bnames.has(key)) {
      const stem = r.pick(NAME_STEMS_LOCAL());
      const nm = r.pick([`${stem}ビル`, `第${r.pick(['一', '二', '三', '五'])}${stem}ビル`, `${stem}会館`]);
      const t = { key: nm, trade: 'ビル', name: nm, display: nm, fictional: true, scheme: SCHEMES[r.pick(['blackOnWhite', 'blueOnWhite', 'whiteOnBlue', 'brownOnCream'])], floor: 0, uses: 0 };
      bnames.set(key, t); fictionalNames.add(nm);
      return t;
    }
    // off-site advertiser
    const tr = r.pick(TRADES.filter((x) => x.u));
    const t = uniq(r, () => { const nm = shopName(r, tr); const d = nm.name ? `${tr.w} ${nm.name}` : tr.w; return { key: d, display: d, trade: tr.w, name: nm.name, fictional: nm.fictional, scheme: SCHEMES[r.pick(tr.sch)], floor: 0, uses: 0 }; });
    if (t.name) fictionalNames.add(t.name);
    return t;
  }

  // ---------------------------------------------------------------- shared detail emitters
  function trimFrame(G, fr, u0, u1, y0, y1, dF, trimHex, X, Z) {
    const t = lin(trimHex), s = 0.028;
    const c = (u, y) => W(fr, u, y, dF + s / 2 - 0.004);
    beam(G.steel, c(u0 - s / 2, y1 + s / 2), c(u1 + s / 2, y1 + s / 2), s, t, Z);
    beam(G.steel, c(u0 - s / 2, y0 - s / 2), c(u1 + s / 2, y0 - s / 2), s, t, Z);
    beam(G.steel, c(u0 - s / 2, y0 - s), c(u0 - s / 2, y1 + s), s, t, Z);
    beam(G.steel, c(u1 + s / 2, y0 - s), c(u1 + s / 2, y1 + s), s, t, Z);
    // top flashing cap
    box(G.painted, W(fr, (u0 + u1) / 2, y1 + s + 0.01, dF / 2 + 0.01), fr.R, UP, fr.N, (u1 - u0) / 2 + 0.04, 0.012, dF / 2 + 0.03, t);
  }

  function goosenecks(G, fr, u0, u1, yTop, dF, r) {
    const n = Math.max(2, Math.round((u1 - u0) / 1.5));
    const col = lin(r.pick(['#2a2a28', '#5a5852', '#8a1f18', '#1f3a66']));
    for (let i = 0; i < n; i++) {
      const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
      const a = W(fr, u, yTop + 0.03, dF * 0.5), b1 = W(fr, u, yTop + 0.28, dF * 0.5), c = W(fr, u, yTop + 0.36, dF + 0.25), e = W(fr, u, yTop + 0.3, dF + 0.42);
      beam(G.steel, a, b1, 0.022, col); beam(G.steel, b1, c, 0.022, col); beam(G.steel, c, e, 0.022, col);
      cylinder(G.steel, v3.add(e, [0, 0.02, 0]), v3.add(e, [0, -0.08, 0]), 0.075, 8, col);
    }
  }

  function lattice(G, fr, ua, ub, roofY, y0, y1, dF, D, steel, r) {
    const n = Math.max(2, Math.round((ub - ua) / 2.4) + 1);
    const s = 0.065, sb = 0.045;
    const us = Array.from({ length: n }, (_, i) => ua + 0.08 + ((ub - ua - 0.16) * i) / (n - 1));
    const dBk = dF - D;
    const yBk = y0 + (y1 - y0) * 0.55;
    for (const u of us) {
      beam(G.steel, W(fr, u, roofY, dF), W(fr, u, y1 - 0.05, dF), s, steel);
      beam(G.steel, W(fr, u, roofY, dBk), W(fr, u, yBk, dBk), s, steel);
      beam(G.steel, W(fr, u, yBk, dBk), W(fr, u, y1 - 0.15, dF), sb, steel);
      beam(G.steel, W(fr, u, roofY + 0.1, dBk), W(fr, u, y0, dF), sb, steel);
      beam(G.steel, W(fr, u, roofY + 0.05, dF + 0.15), W(fr, u, roofY + 0.05, dBk - 0.15), [0.12, 0.08], steel);
    }
    for (const y of [y0 + 0.1, (y0 + y1) / 2, y1 - 0.12]) beam(G.steel, W(fr, ua, y, dF - 0.02), W(fr, ub, y, dF - 0.02), sb, steel);
    beam(G.steel, W(fr, ua, y0 - 0.05, dF), W(fr, ub, y0 - 0.05, dF), s, steel);
    for (let i = 0; i < n - 1; i++) {
      beam(G.steel, W(fr, us[i], roofY + 0.1, dBk), W(fr, us[i + 1], yBk - 0.1, dBk), sb * 0.8, steel);
      beam(G.steel, W(fr, us[i + 1], roofY + 0.1, dBk), W(fr, us[i], yBk - 0.1, dBk), sb * 0.8, steel);
      beam(G.steel, W(fr, us[i], roofY + 0.15, dF - 0.03), W(fr, us[i + 1], y0 - 0.1, dF - 0.03), sb * 0.8, steel);
    }
  }

  function bulbsOnFace(G, fq, c, R, U, N, w, h) {
    const reg = fq.region;
    for (const [px, py] of fq.spec.bulbPx) {
      const s = (px - reg.x) / reg.w - 0.5, t = 0.5 - (py - reg.y) / reg.h;
      G.bulbs.push(v3.mad(v3.mad(v3.mad(c, R, s * w), U, t * h), N, 0.022));
    }
  }
}
