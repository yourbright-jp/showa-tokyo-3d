// Procedural human body, pose and clothing geometry.
//
// Proportions follow common anthropometric ratios of stature H (shoulder 0.81H, hip joint
// 0.53H, knee 0.285H, ankle 0.039H; head height H/7.3-7.7). These are generic adult/teen
// proportions, not measurements of particular people. Poses are static snapshots (walking
// mid-stride at a given gait phase, or standing) so motion can later be driven by the same
// parameters (pose.phase, pose.type) per stable person id.
import { tubePath, sweepRings, ellipsoid, box, add, sub, mul, dot, cross, len, nrm, lerp3, madd, rotY, clamp, smooth, basisYawPitch, ik2 } from './mesh.js';
import { PAT, lin } from './wardrobe.js';

// torso cross-section keys: [y/H, rx/H, rz/H, cz/H]
const TORSO_M = [
  [0.425, 0.062, 0.042, -0.006], [0.445, 0.080, 0.052, -0.006], [0.47, 0.092, 0.060, -0.009], [0.50, 0.099, 0.065, -0.012],
  [0.53, 0.101, 0.066, -0.012], [0.56, 0.097, 0.063, -0.008], [0.60, 0.088, 0.058, -0.002], [0.64, 0.088, 0.059, 0.002],
  [0.68, 0.093, 0.063, 0.006], [0.72, 0.099, 0.067, 0.008], [0.755, 0.104, 0.066, 0.006], [0.785, 0.111, 0.060, 0.001],
  [0.805, 0.110, 0.052, -0.005], [0.822, 0.088, 0.044, -0.008], [0.836, 0.045, 0.035, -0.008],
];
const TORSO_F = [
  [0.425, 0.066, 0.044, -0.008], [0.445, 0.085, 0.054, -0.008], [0.47, 0.100, 0.062, -0.013], [0.50, 0.109, 0.068, -0.016],
  [0.53, 0.109, 0.068, -0.015], [0.56, 0.099, 0.062, -0.010], [0.60, 0.080, 0.052, -0.002], [0.64, 0.079, 0.053, 0.003],
  [0.675, 0.085, 0.060, 0.010], [0.705, 0.090, 0.069, 0.016], [0.735, 0.090, 0.064, 0.012], [0.765, 0.094, 0.056, 0.004],
  [0.795, 0.099, 0.048, -0.004], [0.815, 0.078, 0.040, -0.006], [0.830, 0.038, 0.031, -0.006],
];

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const BLACK = lin(0x141414);
const GOLD = lin(0xb89a4a);

// superellipse radius factor (n = 2 is an ellipse; larger n is boxier, keeping the sides flatter)
function superK(phi, n = 2) {
  if (!n || n === 2) return 1;
  return Math.pow(Math.pow(Math.abs(Math.sin(phi)), n) + Math.pow(Math.abs(Math.cos(phi)), n), -1 / n);
}

function dims(P) {
  const H = P.H, f = P.sex === 'f', g = P.girth;
  const hh = H / P.heads;
  return {
    H, hh, f, g, belly: P.belly || 0,
    shoulderY: 0.784 * H, shoulderX: (f ? 0.097 : 0.11) * H * P.shoulderK,
    hipY: 0.53 * H, hipX: (f ? 0.054 : 0.05) * H * (0.7 + 0.3 * g),
    thigh: 0.245 * H, shin: 0.246 * H, ankleH: 0.039 * H,
    upper: 0.184 * H, fore: 0.148 * H, hand: 0.1 * H,
    footL: (f ? 0.142 : 0.15) * H, footW: (f ? 0.048 : 0.055) * H,
    neckR: (f ? 0.027 : 0.032) * H,
    topY: (f ? 0.83 : 0.836) * H,
  };
}

function profAt(D, y, inflate = 0) {
  const T = D.f ? TORSO_F : TORSO_M;
  const yf = y / D.H;
  let i = 0;
  while (i < T.length - 2 && yf > T[i + 1][0]) i++;
  const a = T[i], b = T[i + 1];
  const t = clamp((yf - a[0]) / (b[0] - a[0]), 0, 1);
  const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
  let rx = (a[1] + (b[1] - a[1]) * s) * D.H;
  let rz = (a[2] + (b[2] - a[2]) * s) * D.H;
  let cz = (a[3] + (b[3] - a[3]) * s) * D.H;
  // girth mostly widens the waist/hips, little at the shoulders
  const gw = 1 + (D.g - 1) * (1 - 0.6 * smooth(0.66, 0.8, yf));
  rx *= gw; rz *= 1 + (D.g - 1) * 1.1;
  const bb = D.belly * Math.exp(-(((yf - 0.575) / 0.065) ** 2));
  rz += bb * 0.024 * D.H; cz += bb * 0.018 * D.H; rx += bb * 0.01 * D.H;
  return [rx + inflate, rz + inflate, cz];
}

// ------------------------------------------------------------------ pose
function makePtx(D, S) {
  const tl = Math.tan(S.lean);
  return (p, n) => {
    const t = smooth(D.hipY, D.shoulderY, p[1]);
    const yaw = S.pelvisYaw * (1 - t) + S.shoulderYaw * t;
    const q = rotY(p, yaw);
    q[0] += S.shiftX * (1 - 0.7 * t);
    q[2] += (p[1] - D.hipY) * tl;
    q[1] += S.dy;
    return [q, n ? rotY(n, yaw) : null];
  };
}

function solvePose(P, D, pose) {
  const H = D.H;
  const S = { pelvisYaw: 0, shoulderYaw: 0, lean: 0, shiftX: 0, dy: 0, walk: pose.type === 'walk' };
  const feet = {};
  const L = (pose.stride || 0.4) * H;
  S.L = L;
  if (S.walk) {
    const p = pose.phase;
    for (const s of [1, -1]) {
      const ph = s === 1 ? p : (p + 0.5) % 1;
      let z, lift = 0, pitch = 0;
      if (ph < 0.6) {
        const t = ph / 0.6;
        z = L * (0.5 - t);
        if (ph < 0.1) pitch = 0.2 * (1 - ph / 0.1);
        else if (t > 0.72) pitch = -0.55 * smooth(0.72, 1, t);
      } else {
        const t = (ph - 0.6) / 0.4;
        z = L * (-0.5 + smooth(0, 1, t));
        lift = 0.065 * (H / 1.65) * Math.sin(Math.PI * Math.min(1, t * 1.15));
        pitch = -0.45 * (1 - smooth(0, 0.55, t)) + 0.18 * smooth(0.6, 1, t);
      }
      feet[s] = { x: s * D.hipX * 0.55, z, lift, pitch, yaw: s * 0.07, straight: false };
    }
    S.pelvisYaw = -0.11 * (feet[1].z - feet[-1].z) / Math.max(0.2, L);
    S.shoulderYaw = -0.75 * S.pelvisYaw;
    S.lean = 0.04 + (pose.lean || 0);
  } else {
    const ws = pose.weight || 1;
    for (const s of [1, -1]) {
      const relaxed = s !== ws;
      feet[s] = {
        x: s * D.hipX * (0.85 + (pose.spread || 0)) + (relaxed ? s * 0.012 * H : 0),
        z: relaxed ? (pose.relaxFwd || 0.03) * H : (pose.zj || 0) * H,
        lift: 0, pitch: 0, yaw: s * (relaxed ? 0.32 : 0.14), straight: !relaxed,
      };
    }
    S.shiftX = ws * 0.014 * H;
    S.pelvisYaw = pose.yawJ || 0;
    S.shoulderYaw = (pose.yawJ || 0) * 0.4 + (pose.shoulderJ || 0);
    S.lean = pose.lean || 0;
  }
  const sh = P.shoes.kind;
  const heelH = sh === 'pump' ? (P.shoes.platform ? 0.05 : 0.032) : sh === 'boot' ? 0.03 : sh === 'zori' ? 0.022 : 0;
  for (const s of [1, -1]) {
    const f = feet[s];
    f.heelH = heelH;
    const heelPitch = sh === 'pump' ? -Math.atan(heelH * 0.6 / (D.footL * 0.7)) : 0;
    f.pitchTot = f.pitch + heelPitch * (f.lift > 0 ? 0.5 : 1);
    const ay = D.ankleH + f.lift + heelH * 0.85 + (f.pitch < 0 ? 0.62 * D.footL * Math.sin(-f.pitch) : 0.2 * D.footL * Math.sin(f.pitch));
    f.ankle = [f.x, ay, f.z];
    const yaw = f.yaw + S.pelvisYaw * 0.6;
    const cp = Math.cos(f.pitchTot);
    f.dir = [Math.sin(yaw) * cp, Math.sin(f.pitchTot), Math.cos(yaw) * cp];
  }
  // pelvis height so both feet are reachable (stance leg nearly straight)
  let ptx = makePtx(D, S);
  let drop = 0;
  for (const s of [1, -1]) {
    const f = feet[s];
    const hj = ptx([s * D.hipX, D.hipY, 0])[0];
    const dx = hj[0] - f.ankle[0], dz = hj[2] - f.ankle[2];
    const reach = (D.thigh + D.shin) * (f.straight ? 0.999 : 0.993);
    const v = Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
    drop = Math.max(drop, hj[1] - (f.ankle[1] + v));
  }
  S.dy = -Math.max(0, drop) - (S.walk ? 0.003 * H : 0.001 * H);
  ptx = makePtx(D, S);
  S.ptx = ptx;
  S.legs = {};
  for (const s of [1, -1]) {
    const f = feet[s];
    const hip = ptx([s * D.hipX, D.hipY, 0])[0];
    const pole = add(rotY(Z, S.pelvisYaw), [S.walk ? -s * 0.06 : s * 0.1, 0, 0]);
    const k = ik2(hip, f.ankle, D.thigh, D.shin, pole);
    S.legs[s] = { hip, knee: k.mid, ankle: k.end, foot: f };
  }
  // arms
  S.arms = {};
  for (const s of [1, -1]) {
    const mode = (pose.arms && pose.arms[s]) || (S.walk ? 'swing' : 'hang');
    const SJ = ptx([s * D.shoulderX, D.shoulderY, -0.006 * H])[0];
    let elbow, wrist, hidden = false;
    if (mode === 'swing' || mode === 'carry' || mode === 'crook') {
      const armPhase = S.walk ? -feet[s].z / Math.max(0.1, L / 2) : 0;
      const a = (mode === 'swing' ? 0.32 : mode === 'carry' ? 0.07 : 0.05) * armPhase + (pose.armJ || 0);
      const e = mode === 'swing' ? 0.22 + 0.28 * Math.max(0, armPhase) : mode === 'carry' ? 0.06 : 1.45;
      const ab = (mode === 'swing' ? 0.09 : mode === 'carry' ? 0.17 : 0.2) + (pose.wide ? 0.07 : 0);
      let ud = [s * Math.sin(ab), -Math.cos(ab) * Math.cos(a), Math.cos(ab) * Math.sin(a)];
      let fd = [s * Math.sin(ab * 0.5), -Math.cos(ab * 0.5) * Math.cos(a + e), Math.cos(ab * 0.5) * Math.sin(a + e)];
      if (mode === 'crook') fd = nrm(add(fd, [-s * 0.35, 0, 0]));
      ud = rotY(ud, S.shoulderYaw); fd = rotY(fd, S.shoulderYaw);
      elbow = madd(SJ, ud, D.upper);
      wrist = madd(elbow, fd, D.fore);
    } else {
      let T, pole;
      switch (mode) {
        case 'pockets': T = ptx([s * 0.088 * H, 0.528 * H, 0.03 * H])[0]; pole = [s, -0.2, -0.7]; hidden = true; break;
        case 'crossed': T = ptx([-s * 0.06 * H, 0.69 * H, (0.095 + (s > 0 ? 0.012 : 0)) * H])[0]; pole = [s, -0.7, -0.1]; break;
        case 'front': T = ptx([s * 0.035 * H, 0.565 * H, 0.1 * H])[0]; pole = [s, -0.5, -0.4]; break;
        case 'smoke': T = ptx([s * 0.03 * H, 0.86 * H, 0.08 * H])[0]; pole = [s * 0.8, -1, 0.1]; break;
        case 'behind': T = ptx([s * 0.02 * H, 0.54 * H, -0.085 * H])[0]; pole = [s, 0, -0.2]; break;
        case 'gesture': T = ptx([s * 0.11 * H, 0.65 * H, 0.19 * H])[0]; pole = [s, -1, -0.3]; break;
        default: {
          // hang just outside the hip/skirt line
          const hx = profAt(D, 0.47 * H, 0)[0] + (pose.wide ? 0.05 : 0.036) * H;
          T = add(SJ, [0, -(D.upper + D.fore) * 0.975, 0.02 * H]);
          T[0] = s * Math.max(Math.abs(T[0]) + 0.02 * H, hx);
          pole = [s * 0.25, 0, -1];
        }
      }
      const k = ik2(SJ, T, D.upper, D.fore, pole);
      elbow = k.mid; wrist = k.end;
    }
    S.arms[s] = { mode, SJ, elbow, wrist, hidden, dir: nrm(sub(wrist, elbow)) };
  }
  S.headC = ptx([0, H - 0.5 * D.hh, 0.012 * H])[0];
  S.headYaw = S.shoulderYaw + (pose.headYaw || 0);
  S.headPitch = (pose.headPitch || 0) + S.lean * 0.5;
  S.neckBase = ptx([0, 0.818 * H, -0.008 * H])[0];
  return S;
}

// ------------------------------------------------------------------ garments
function torsoRings(D, S, y0, y1, inflate, opts = {}) {
  const T = D.f ? TORSO_F : TORSO_M;
  const ys = [y0];
  for (const k of T) { const y = k[0] * D.H; if (y > y0 + 0.004 && y < y1 - 0.004) ys.push(y); }
  ys.push(y1);
  // subdivide long gaps
  const out = [ys[0]];
  for (let i = 1; i < ys.length; i++) {
    const gap = ys[i] - ys[i - 1];
    const n = Math.ceil(gap / (0.045 * D.H));
    for (let k = 1; k <= n; k++) out.push(ys[i - 1] + gap * k / n);
  }
  const rings = out.map((y) => {
    let [rx, rz, cz] = profAt(D, y, inflate);
    if (opts.pad) { const w = smooth(0.74 * D.H, 0.785 * D.H, y) * (1 - smooth(0.805 * D.H, 0.825 * D.H, y)); rx += opts.pad * w; }
    if (opts.flare && y < opts.flare.from) {
      const [hrx, hrz, hcz] = profAt(D, opts.flare.from, inflate);
      const t = clamp((opts.flare.from - y) / Math.max(1e-3, opts.flare.from - opts.flare.to), 0, 1);
      rx = hrx * (1 + (opts.flare.k - 1) * t); rz = hrz * (1 + (opts.flare.k * 0.85 - 1) * t); cz = hcz;
    }
    if (opts.hemFlare && y < y0 + 0.02 * D.H) { rx += opts.hemFlare; rz += opts.hemFlare; }
    if (opts.hemTight && y < y0 + 0.02 * D.H) { rx -= opts.hemTight; rz -= opts.hemTight; }
    const sn = opts.superN ? 2 + (opts.superN - 2) * smooth(D.hipY, D.hipY - 0.12 * D.H, y) : 2;
    if (opts.fit && y < D.hipY + 0.03 * D.H) [rx, rz, cz] = fitLegs(D, S, y, rx, rz, cz, opts.fit, opts.fitX, opts.thighOnly, sn);
    return { c: [0, y, cz], rx, ry: rz, f: [X, Z, Y], sn };
  });
  if (opts.flare) {
    // fabric below the knees hangs from the widest fitted ring: never pinch inwards towards the hem
    for (let i = rings.length - 2; i >= 0; i--) {
      if (rings[i].c[1] > opts.flare.from) continue;
      rings[i].rx = Math.max(rings[i].rx, rings[i + 1].rx * 0.995);
      rings[i].ry = Math.max(rings[i].ry, rings[i + 1].ry * 0.995);
    }
  }
  return rings;
}

// Grow a garment ring (rest space) so both posed legs at that height stay inside it.
// The leg circle (centre lx,lz radius r) fits when (lx/(rx-r))^2 + ((lz-cz)/(rz-r))^2 <= 1.
// Where the thigh is wider than the pelvis it may show at the sides (natural); only skirts
// and coats (allowX) widen sideways.
function fitLegs(D, S, yRest, rx, rz, cz, legR, allowX = false, thighOnly = false, sn = 2) {
  const yp = yRest + S.dy;
  const secs = [];
  for (const s of [1, -1]) {
    const L = S.legs[s];
    const segs = thighOnly ? [[L.hip, L.knee, 0, 0.5]] : [[L.hip, L.knee, 0, 0.5], [L.knee, L.ankle, 0.5, 1]];
    for (const [a, b, ta, tb] of segs) {
      if ((a[1] - yp) * (b[1] - yp) > 0) continue;
      const t = (a[1] - yp) / ((a[1] - b[1]) || 1e-6);
      const px = a[0] + (b[0] - a[0]) * t, pz = a[2] + (b[2] - a[2]) * t;
      let q = [px - S.shiftX, 0, pz - (yRest - D.hipY) * Math.tan(S.lean)];
      q = rotY(q, -S.pelvisYaw);
      secs.push([Math.abs(q[0]), q[2], legR(ta + (tb - ta) * t) * 1.06 + 0.005]);
      break;
    }
  }
  if (allowX) for (const [lx, , r] of secs) rx = Math.max(rx, lx + r + 0.004);
  if (secs.length) {
    // below the hips the cloth is carried by the thighs: move the ring centre towards them
    let lo = Infinity, hi = -Infinity;
    for (const [, lz, r] of secs) { lo = Math.min(lo, lz - r); hi = Math.max(hi, lz + r); }
    const wgt = smooth(D.hipY, D.hipY - 0.1 * D.H, yRest) * 0.85;
    cz += ((lo + hi) / 2 - cz) * wgt;
  }
  for (const [lx, lz, r] of secs) {
    const ax = rx - r;
    const dz = Math.abs(lz - cz);
    const need = ax > 1e-3 && lx < ax * 0.96 ? r + dz / Math.pow(1 - Math.pow(lx / ax, sn), 1 / sn) : r + dz;
    rz = Math.max(rz, need);
  }
  return [rx, rz, cz];
}

/** Strip lying on the (inflated) torso surface. rows: [{y, x0, x1}] top->bottom. */
function surfStrip(w, D, S, rows, inflate, off, style, back = false, ncol = 3) {
  const b0 = w.nv;
  const sgn = back ? -1 : 1;
  for (const r of rows) {
    const [rx, rz, cz] = profAt(D, r.y, inflate);
    for (let c = 0; c < ncol; c++) {
      const x = r.x0 + (r.x1 - r.x0) * (c / (ncol - 1));
      const q = clamp(x / rx, -0.97, 0.97);
      const zs = cz + sgn * rz * Math.sqrt(1 - q * q);
      const p = [x * (1 + off / rx), r.y, zs + sgn * off];
      const n0 = nrm([x / (rx * rx), 0, (zs - cz) / (rz * rz)]);
      const [pp, nn] = S.ptx(p, n0);
      w.vert(pp[0], pp[1], pp[2], nn[0], nn[1], nn[2], x, r.y, style, r.col || null);
    }
  }
  for (let i = 0; i < rows.length - 1; i++) for (let c = 0; c < ncol - 1; c++) {
    const a = b0 + i * ncol + c;
    w.quad(a, a + 1, a + ncol + 1, a + ncol);
  }
}

const vRows = (D, yTop, yBot, wTop, n = 4, x0 = 0) => {
  const rows = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const hw = (wTop / 2) * (1 - t); rows.push({ y: yTop + (yBot - yTop) * t, x0: x0 - hw, x1: x0 + hw }); }
  return rows;
};

function emitTie(w, D, S, tie, inflate, yBot) {
  const H = D.H, wd = tie.wide || 1;
  const rows = [
    { y: 0.818 * H, x0: -0.012 * H, x1: 0.012 * H },
    { y: 0.80 * H, x0: -0.009 * H, x1: 0.009 * H },
  ];
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const y = 0.80 * H + (yBot - 0.80 * H) * t;
    const hw = (0.01 + 0.012 * wd * t) * H;
    rows.push({ y, x0: -hw, x1: hw });
  }
  if (yBot < 0.63 * H) rows.push({ y: yBot - 0.022 * H, x0: -0.001 * H, x1: 0.001 * H });
  surfStrip(w, D, S, rows, inflate, 0.006 * H, { ...tie, rough: 0.55 });
}

function emitCollar(w, D, S, style, kind = 'shirt') {
  const H = D.H;
  const c = S.ptx([0, 0.84 * H, -0.006 * H])[0];
  const r0 = D.neckR * (kind === 'coat' ? 1.55 : 1.16), r1 = D.neckR * (kind === 'coat' ? 1.7 : 1.13);
  const y0 = (kind === 'coat' ? 0.818 : 0.826) * H, y1 = (kind === 'high' ? 0.866 : kind === 'coat' ? 0.875 : 0.856) * H;
  const yaw = S.shoulderYaw;
  const ex = rotY(X, yaw), ez = rotY(Z, yaw);
  const rings = [
    { c: [c[0], y0 + S.dy, c[2] - 0.004 * H], rx: r0, ry: r0 * 0.92, f: [ex, ez, Y] },
    { c: [c[0], y1 + S.dy, c[2] - 0.006 * H], rx: r1, ry: r1 * 0.9, f: [ex, ez, Y] },
  ];
  const open = kind === 'high' || kind === 'turtle' ? undefined : kind === 'coat' ? 0.55 : 0.32;
  sweepRings(w, rings, 14, style, open === undefined ? { twoSided: true } : { phi0: open, phi1: Math.PI * 2 - open, twoSided: true });
}

function emitButtons(w, D, S, inflate, ys, col, r = 0.0055) {
  for (const y of ys) {
    const [, rz, cz] = profAt(D, y, inflate);
    const p = S.ptx([0, y, cz + rz + 0.001 * D.H])[0];
    ellipsoid(w, p, null, r * D.H / 1.65 * 1.6, r * D.H / 1.65 * 1.6, r * 0.7, 5, 3, { col, rough: 0.35 });
  }
}

function emitTopAndBottom(w, P, D, S, q) {
  const H = D.H;
  const top = P.top, bot = P.bottom;
  const seg = Math.max(12, Math.round(20 * q));
  const legRTrouser = (t) => {
    const flare = bot.kind === 'flare';
    const r0 = 0.056 * H * (0.8 + 0.2 * D.g), r1 = (flare ? 0.04 : 0.043) * H, r2 = (flare ? 0.058 : 0.038) * H;
    const r = t < 0.5 ? r0 + (r1 - r0) * t * 2 : r1 + (r2 - r1) * (t - 0.5) * 2;
    return r * (0.74 + 0.26 * smooth(0, 0.3, t));
  };
  // under skirts the upper thigh is hidden and merges into the hip volume: slimmer at the top
  const legRSkin = (t) => (t < 0.25 ? (0.042 + 0.02 * t) * H : t < 0.5 ? (0.047 - 0.06 * (t - 0.25)) * H : 0.034 * H);
  const legR = bot.kind === 'trousers' || bot.kind === 'flare' ? legRTrouser : legRSkin;
  const foldOf = (o) => (o.kind === 'jacket' || o.kind === 'coat' || o.kind === 'gakuran' || o.kind === 'blouson' ? 1 : o.kind === 'trousers' || o.kind === 'flare' ? 3 : 2);
  const sty = (o, extra = {}) => ({ col: o.col, col2: o.col2 || o.col, layer: o.layer ?? PAT.plain, scale: o.scale || 0.05, rough: 0.88, fold: foldOf(o), ...extra });
  const T = sty(top);
  const waist = 0.6 * H;

  const pelvis = (style) => {
    // trouser seat: ends just below the crotch with a rounded bottom; the thighs carry the stride
    const rings = torsoRings(D, S, 0.452 * H, waist + 0.006 * H, 0.004 * H);
    const r0 = rings[0];
    rings.unshift({ c: [0, 0.438 * H, r0.c[2]], rx: r0.rx * 0.55, ry: r0.ry * 0.55, f: r0.f });
    sweepRings(w, rings, seg, style, { ptx: S.ptx, capBottom: true });
  };
  const belt = (col) => {
    const rings = torsoRings(D, S, 0.586 * H, 0.606 * H, 0.007 * H);
    sweepRings(w, rings, seg, { col, rough: 0.45 }, { ptx: S.ptx });
    emitButtons(w, D, S, 0.008 * H, [0.596 * H], lin(0x9a8a6a), 0.006);
  };
  const skirt = (style, fromY = waist + 0.008 * H) => {
    const hem = (bot.hem || 0.27) * H;
    const rings = torsoRings(D, S, hem, fromY, 0.008 * H, { flare: { from: 0.5 * H, to: hem, k: bot.flare || 1.1 }, fit: legRSkin, fitX: true, thighOnly: true, superN: 2.8 });
    const n = bot.pleats || 0;
    const sseg = n ? Math.max(seg, n * 2) : seg;
    const nr = rings.length;
    sweepRings(w, rings, sseg, style, {
      ptx: S.ptx,
      rfn: (phi, k) => { const se = superK(phi, rings[k].sn); if (!n) return se; const tt = 1 - k / (nr - 1); const tri = Math.abs(((phi * n) / (Math.PI * 2)) % 1 - 0.5) * 2; return se * (1 + tt * 0.028 * (tri - 0.5)); },
      colFn: n ? (phi, k) => { const tri = Math.abs(((phi * n) / (Math.PI * 2)) % 1 - 0.5) * 2; const sh = 0.82 + 0.18 * tri; return style.col.map((c) => c * sh); } : undefined,
    });
  };

  const inner = P.inner;
  const kind = top.kind;
  let coversPelvis = false;
  if (kind === 'jacket' || kind === 'gakuran') {
    const inf = (top.casual ? 0.008 : 0.01) * H;
    const hem = (top.hem || 0.445) * H;
    const rings = torsoRings(D, S, hem, D.topY, inf, { pad: kind === 'gakuran' ? 0.002 * H : 0.006 * H, hemFlare: 0.0015 * H, fit: legR });
    sweepRings(w, rings, seg, T, { ptx: S.ptx, capTop: true });
    coversPelvis = hem < 0.47 * H;
    if (kind === 'gakuran') {
      emitCollar(w, D, S, T, 'high');
      emitButtons(w, D, S, inf, [0.795, 0.735, 0.675, 0.615, 0.555].map((k) => k * H), GOLD);
    } else {
      const vBot = top.casual ? 0.72 * H : 0.655 * H;
      if (inner) {
        const sh = sty(inner);
        surfStrip(w, D, S, vRows(D, 0.818 * H, vBot, 0.088 * H, 4), inf, 0.003 * H, sh);
        emitCollar(w, D, S, sh, 'shirt');
        if (P.tie) emitTie(w, D, S, P.tie, inf, vBot - 0.004 * H);
      }
      if (!top.casual) {
        // lapels: slightly raised darker bands along both edges of the V
        for (const s of [1, -1]) {
          const rows = [];
          for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            const y = 0.82 * H + (vBot - 0.82 * H) * t;
            const xe = s * 0.044 * H * (1 - t);
            rows.push({ y, x0: xe, x1: xe + s * (0.034 - 0.02 * t) * H });
          }
          surfStrip(w, D, S, rows, inf, 0.0035 * H, { ...T, col: T.col.map((c) => c * 0.82), col2: (T.col2 || T.col).map((c) => c * 0.82) });
        }
        emitButtons(w, D, S, inf, [0.628 * H, 0.578 * H], T.col.map((c) => c * 0.6), 0.005);
      }
      if (top.belted) {
        const rings2 = torsoRings(D, S, 0.585 * H, 0.61 * H, inf + 0.004 * H);
        sweepRings(w, rings2, seg, { ...T, col: T.col.map((c) => c * 0.85) }, { ptx: S.ptx });
      }
    }
  } else if (kind === 'coat') {
    const inf = 0.016 * H;
    const hem = (top.hem || 0.3) * H;
    const upper = torsoRings(D, S, 0.53 * H, D.topY, inf, { pad: 0.008 * H });
    const lower = torsoRings(D, S, hem, 0.53 * H, inf, { flare: { from: 0.53 * H, to: hem, k: 1.06 }, fit: legR, thighOnly: true, superN: 2.6 });
    const coatRings = lower.concat(upper.slice(1));
    sweepRings(w, coatRings, seg, T, { ptx: S.ptx, capTop: true, rfn: (phi, k) => superK(phi, coatRings[k].sn) });
    coversPelvis = true;
    if (inner) {
      const sh = sty(inner);
      surfStrip(w, D, S, vRows(D, 0.818 * H, 0.71 * H, 0.075 * H, 3), inf, 0.003 * H, sh);
      if (P.tie) emitTie(w, D, S, P.tie, inf, 0.714 * H);
    }
    if (P.scarf) {
      const c = S.ptx([0, 0.83 * H, -0.004 * H])[0];
      sweepRings(w, [
        { c: [c[0], 0.815 * H + S.dy, c[2]], rx: D.neckR * 1.75, ry: D.neckR * 1.6, f: [X, Z, Y] },
        { c: [c[0], 0.85 * H + S.dy, c[2] - 0.004 * H], rx: D.neckR * 1.5, ry: D.neckR * 1.4, f: [X, Z, Y] },
      ], 12, { col: P.scarf, col2: P.scarf, layer: PAT.knit, scale: 0.02, rough: 0.9 }, { capBottom: false });
    }
    emitCollar(w, D, S, T, 'coat');
    if (top.belted) {
      const rings2 = torsoRings(D, S, 0.585 * H, 0.612 * H, inf + 0.005 * H);
      sweepRings(w, rings2, seg, { ...T, col: T.col.map((c) => c * 0.88) }, { ptx: S.ptx });
    }
    emitButtons(w, D, S, inf, [0.66 * H, 0.56 * H, 0.46 * H], T.col.map((c) => c * 0.55), 0.006);
  } else if (kind === 'kimono') {
    const inf = 0.01 * H;
    const upper = torsoRings(D, S, 0.53 * H, D.topY, inf);
    const lower = torsoRings(D, S, 0.06 * H, 0.53 * H, inf, { flare: { from: 0.53 * H, to: 0.06 * H, k: 0.86 }, fit: legRSkin, thighOnly: true, superN: 2.6 });
    const kimRings = lower.concat(upper.slice(1));
    sweepRings(w, kimRings, seg, T, { ptx: S.ptx, capTop: true, rfn: (phi, k) => superK(phi, kimRings[k].sn) });
    coversPelvis = true;
    const obi = torsoRings(D, S, 0.6 * H, 0.712 * H, inf + 0.012 * H);
    sweepRings(w, obi, seg, { col: top.obi, col2: top.obi.map((c) => c * 0.7), layer: PAT.stripe, scale: 0.05, rough: 0.6 }, { ptx: S.ptx });
    // collar: white under-collar and kimono lapel crossing left over right
    for (const s of [-1, 1]) {
      const rowsW = [], rowsK = [];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        const y = 0.832 * H + (0.712 * H - 0.832 * H) * t;
        const xc = s * 0.042 * H * (1 - t) - s * 0.006 * H * t;
        rowsW.push({ y, x0: xc - s * 0.002 * H, x1: xc + s * 0.012 * H });
        rowsK.push({ y, x0: xc + s * 0.012 * H, x1: xc + s * 0.03 * H });
      }
      surfStrip(w, D, S, rowsW, inf, (s > 0 ? 0.004 : 0.003) * H, { col: lin(0xe8e4dc), rough: 0.7 });
      surfStrip(w, D, S, rowsK, inf, (s > 0 ? 0.0045 : 0.0035) * H, { ...T, col: T.col.map((c) => c * 0.8) });
    }
    // drum-bow at the back
    const bp = S.ptx([0, 0.665 * H, profAt(D, 0.665 * H, inf)[2] - profAt(D, 0.665 * H, inf)[1] - 0.014 * H])[0];
    ellipsoid(w, bp, [rotY(X, S.pelvisYaw), Y, rotY(Z, S.pelvisYaw)], 0.072 * H, 0.052 * H, 0.024 * H, 10, 6, { col: top.obi.map((c) => c * 0.92), col2: top.obi.map((c) => c * 0.7), layer: PAT.stripe, scale: 0.05, rough: 0.6 });
  } else if (kind === 'dress') {
    const rings = torsoRings(D, S, waist - 0.006 * H, D.topY, 0.006 * H);
    sweepRings(w, rings, seg, T, { ptx: S.ptx, capTop: true });
    surfStrip(w, D, S, [{ y: 0.832 * H, x0: -0.03 * H, x1: 0.03 * H }, { y: 0.815 * H, x0: -0.024 * H, x1: 0.024 * H }, { y: 0.8 * H, x0: -0.01 * H, x1: 0.01 * H }], 0.006 * H, 0.002 * H, { col: P.skin, rough: 0.6 });
    skirt(T);
    coversPelvis = true;
    if (top.belted) belt(T.col.map((c) => c * 0.55));
  } else {
    // shirts, blouses, knits, T-shirts, polos, blousons, cardigans, sailor tops
    const tucked = top.tucked && kind !== 'cardigan' && kind !== 'sailor' && kind !== 'blouson';
    const inf = kind === 'blouson' ? 0.012 * H : kind === 'cardigan' ? 0.01 * H : kind === 'knit' ? 0.007 * H : 0.005 * H;
    const hem = tucked ? waist - 0.008 * H : kind === 'cardigan' ? 0.48 * H : kind === 'sailor' ? 0.555 * H : kind === 'blouson' ? 0.54 * H : 0.505 * H;
    const rings = torsoRings(D, S, hem, D.topY, inf, { hemFlare: !tucked && kind !== 'blouson' ? 0.003 * H : 0, hemTight: kind === 'blouson' ? 0.004 * H : 0, fit: legR });
    sweepRings(w, rings, seg, T, { ptx: S.ptx, capTop: true });
    if (kind === 'cardigan') {
      const innerCol = top.inner || lin(0xe8e4dc);
      surfStrip(w, D, S, [
        { y: 0.82 * H, x0: -0.036 * H, x1: 0.036 * H }, { y: 0.74 * H, x0: -0.024 * H, x1: 0.024 * H },
        { y: 0.62 * H, x0: -0.018 * H, x1: 0.018 * H }, { y: 0.5 * H, x0: -0.02 * H, x1: 0.02 * H },
      ], inf, 0.003 * H, { col: innerCol, rough: 0.85 });
      emitCollar(w, D, S, { col: innerCol, rough: 0.85 }, 'shirt');
      emitButtons(w, D, S, inf, [0.7 * H, 0.64 * H, 0.58 * H], T.col.map((c) => c * 0.5), 0.005);
    } else if (kind === 'sailor') {
      const st = { col: top.stripe, rough: 0.8 };
      const navyD = { ...T, col: T.col.map((c) => c * 0.85) };
      // square collar flap on the back with a white border stripe
      surfStrip(w, D, S, [{ y: 0.835 * H, x0: -0.105 * H, x1: 0.105 * H }, { y: 0.72 * H, x0: -0.11 * H, x1: 0.11 * H }], inf, 0.004 * H, navyD, true);
      for (const s of [1, -1]) surfStrip(w, D, S, [{ y: 0.83 * H, x0: s * 0.088 * H, x1: s * 0.096 * H }, { y: 0.728 * H, x0: s * 0.092 * H, x1: s * 0.1 * H }], inf, 0.0055 * H, st, true, 2);
      surfStrip(w, D, S, [{ y: 0.735 * H, x0: -0.1 * H, x1: 0.1 * H }, { y: 0.728 * H, x0: -0.1 * H, x1: 0.1 * H }], inf, 0.0055 * H, st, true, 2);
      // front V collar edges with stripes, white dickey, scarf knot and tails
      surfStrip(w, D, S, vRows(D, 0.83 * H, 0.73 * H, 0.08 * H, 3), inf, 0.003 * H, { col: lin(0xe6e6e2), rough: 0.8 });
      for (const s of [1, -1]) {
        const rows = [];
        for (let i = 0; i <= 3; i++) { const t = i / 3; const y = 0.83 * H + (0.73 * H - 0.83 * H) * t; const xe = s * 0.04 * H * (1 - t); rows.push({ y, x0: xe, x1: xe + s * 0.03 * H }); }
        surfStrip(w, D, S, rows, inf, 0.0042 * H, navyD);
        const rows2 = rows.map((r) => ({ y: r.y, x0: r.x0 + s * 0.02 * H, x1: r.x0 + s * 0.026 * H }));
        surfStrip(w, D, S, rows2, inf, 0.0052 * H, st, false, 2);
      }
      const [, rz, cz] = profAt(D, 0.735 * H, inf);
      const kp = S.ptx([0, 0.735 * H, cz + rz + 0.008 * H])[0];
      ellipsoid(w, kp, null, 0.02 * H, 0.014 * H, 0.011 * H, 6, 4, { col: top.scarf, rough: 0.6 });
      surfStrip(w, D, S, [{ y: 0.73 * H, x0: -0.012 * H, x1: 0.012 * H }, { y: 0.675 * H, x0: -0.018 * H, x1: 0.018 * H }], inf, 0.008 * H, { col: top.scarf.map((c) => c * 0.9), rough: 0.6 });
    } else if (kind === 'blouson') {
      if (inner) {
        const sh = sty(inner);
        surfStrip(w, D, S, vRows(D, 0.82 * H, 0.76 * H, 0.06 * H, 2), inf, 0.003 * H, sh);
        emitCollar(w, D, S, sh, 'shirt');
      }
      emitCollar(w, D, S, T, 'coat');
    } else {
      if (top.turtle) emitCollar(w, D, S, T, 'turtle');
      else if (kind === 'tshirt' || (kind === 'knit' && !top.turtle)) {
        surfStrip(w, D, S, [{ y: 0.834 * H, x0: -0.034 * H, x1: 0.034 * H }, { y: 0.818 * H, x0: -0.026 * H, x1: 0.026 * H }, { y: 0.806 * H, x0: -0.012 * H, x1: 0.012 * H }], inf, 0.0015 * H, { col: P.skin, rough: 0.6 });
      } else {
        emitCollar(w, D, S, T, 'shirt');
        if (top.bigCollar) {
          for (const s of [1, -1]) surfStrip(w, D, S, [{ y: 0.836 * H, x0: s * 0.012 * H, x1: s * 0.05 * H }, { y: 0.8 * H, x0: s * 0.03 * H, x1: s * 0.07 * H }, { y: 0.77 * H, x0: s * 0.072 * H, x1: s * 0.074 * H }], inf, 0.003 * H, { ...T, col: T.col.map((c) => c * 1.05) });
        }
        if (P.tie) emitTie(w, D, S, P.tie, inf, tucked ? 0.615 * H : 0.6 * H);
        else if (kind === 'shirt' || kind === 'blouse') surfStrip(w, D, S, vRows(D, 0.834 * H, 0.79 * H, 0.05 * H, 2), inf, 0.0015 * H, { col: P.skin, rough: 0.6 });
        if (top.bow) {
          const [, rz, cz] = profAt(D, 0.82 * H, inf);
          const bp = S.ptx([0, 0.82 * H, cz + rz + 0.012 * H])[0];
          for (const s of [1, -1]) ellipsoid(w, add(bp, rotY([s * 0.016 * H, 0, 0], S.shoulderYaw)), null, 0.016 * H, 0.01 * H, 0.007 * H, 6, 4, { col: top.bow, rough: 0.6 });
          surfStrip(w, D, S, [{ y: 0.815 * H, x0: -0.006 * H, x1: 0.006 * H }, { y: 0.76 * H, x0: -0.012 * H, x1: 0.012 * H }], inf, 0.008 * H, { col: top.bow.map((c) => c * 0.9), rough: 0.6 });
        }
      }
    }
    coversPelvis = !tucked && hem < 0.48 * H;
    if (!coversPelvis && (bot.kind === 'trousers' || bot.kind === 'flare')) pelvis(sty(bot));
    if (tucked && (bot.kind === 'trousers' || bot.kind === 'flare') && P.belt) belt(P.belt);
  }
  if (bot.kind === 'skirt' && kind !== 'dress' && kind !== 'kimono') {
    skirt(sty(bot), kind === 'coat' ? waist : waist + 0.008 * H);
  }
  return { legR, legRSkin };
}

// ------------------------------------------------------------------ legs and feet
function emitLegs(w, P, D, S, q) {
  const H = D.H;
  const bot = P.bottom;
  const seg = Math.max(7, Math.round(10 * q));
  const trousers = bot.kind === 'trousers' || bot.kind === 'flare';
  const flare = bot.kind === 'flare';
  for (const s of [1, -1]) {
    const L = S.legs[s];
    const f = L.foot;
    const thighMid = lerp3(L.hip, L.knee, 0.45);
    const shinA = lerp3(L.knee, L.ankle, 0.3);
    const shinB = lerp3(L.knee, L.ankle, 0.72);
    if (trousers) {
      const g = 0.8 + 0.2 * D.g;
      const hemP = add(L.ankle, [0, -0.32 * D.ankleH, 0]);
      const pts = [L.hip, thighMid, L.knee, shinA, shinB, hemP];
      const rad = flare
        ? [0.057 * H * g, 0.05 * H * g, 0.04 * H, 0.042 * H, 0.05 * H, 0.06 * H]
        : [0.057 * H * g, 0.05 * H * g, 0.043 * H, 0.041 * H, 0.039 * H, 0.038 * H];
      const st = { col: bot.col, col2: bot.col2 || bot.col, layer: bot.layer ?? PAT.plain, scale: bot.scale || 0.05, rough: 0.88, fold: 3 };
      tubePath(w, pts, rad, seg, st, { ref: rotY(Z, S.pelvisYaw), capTop: true, capCol: bot.col.map((c) => c * 0.3) });
    } else {
      // bare/hosiery legs (skirts, dresses, coats, kimono)
      const hose = P.legs && P.legs.hose;
      const skin = hose ? P.skin.map((c, i) => c * 0.72 + [0.06, 0.045, 0.035][i] * 0.6) : P.skin;
      const st = { col: skin, rough: hose ? 0.5 : 0.6 };
      const calf = 0.037 * H, ankle = 0.0195 * H;
      const pts = [L.hip, thighMid, L.knee, shinA, shinB, L.ankle];
      tubePath(w, pts, [0.042 * H, 0.047 * H, 0.031 * H, calf, 0.026 * H, ankle], seg, st, { ref: rotY(Z, S.pelvisYaw) });
      if (P.legs && P.legs.socks) {
        const topY = (P.legs.sockTop || 0.09) * H;
        const t = clamp((L.knee[1] - topY) / Math.max(1e-3, L.knee[1] - L.ankle[1]), 0, 1);
        const top = lerp3(L.knee, L.ankle, t);
        tubePath(w, [top, lerp3(top, L.ankle, 0.5), L.ankle], [(t < 0.4 ? calf : 0.028 * H) + 0.003 * H, 0.03 * H, ankle + 0.004 * H], seg, { col: P.legs.socks, rough: 0.9 }, { ref: rotY(Z, S.pelvisYaw) });
      }
    }
    if (P.shoes.kind === 'boot') {
      const top = lerp3(L.knee, L.ankle, 0.12);
      tubePath(w, [top, shinB, add(L.ankle, [0, -0.2 * D.ankleH, 0])], [0.04 * H, 0.032 * H, 0.026 * H], seg, { col: P.shoes.col, rough: 0.4 }, { ref: rotY(Z, S.pelvisYaw), capStart: true });
    }
    emitShoe(w, P, D, f, L.ankle, s);
  }
}

function emitShoe(w, P, D, f, ankle, s) {
  const ez = nrm(f.dir);
  let ex = cross(Y, ez); if (len(ex) < 1e-3) ex = X; ex = nrm(ex);
  const ey = cross(ez, ex);
  const B = [ex, ey, ez];
  const sh = P.shoes;
  const col = sh.col;
  const st = { col, rough: sh.kind === 'sneaker' ? 0.8 : 0.32 };
  if (sh.kind === 'zori') {
    const sock = { col: lin(0xeae8e2), rough: 0.9 };
    ellipsoid(w, madd(madd(ankle, ez, 0.25 * D.footL), ey, -0.38 * D.ankleH), B, D.footW * 0.45, D.ankleH * 0.5, D.footL * 0.5, 8, 5, sock);
    box(w, madd(madd(ankle, ez, 0.22 * D.footL), ey, -0.85 * D.ankleH - f.heelH * 0.5), B, D.footW * 0.5, f.heelH * 0.5, D.footL * 0.54, { col, rough: 0.6 });
    return;
  }
  const low = sh.kind === 'pump' || sh.kind === 'loafer';
  const rx = D.footW * (low ? 0.47 : 0.53), ry = D.ankleH * (low ? 0.5 : 0.64), rz = D.footL * (sh.kind === 'pump' ? 0.53 : 0.54);
  const c = madd(madd(ankle, ez, 0.26 * D.footL), ey, -0.42 * D.ankleH);
  ellipsoid(w, c, B, rx, ry, rz, 10, 6, st, {
    rfn: (lx, ly, lz) => (ly < 0 ? 1 - 0.25 * (-ly) ** 3 : 1) * (lz > 0.5 && sh.kind === 'pump' ? 1 - (lz - 0.5) * 0.25 : 1),
  });
  // sole/welt band: slightly wider, darker (or white rubber for sneakers)
  const soleCol = sh.kind === 'sneaker' ? lin(0xd8d4c8) : col.map((x) => x * 0.55 + 0.004);
  ellipsoid(w, madd(c, ey, -ry * 0.62), B, rx * 1.05, ry * 0.32, rz * 1.03, 10, 4, { col: soleCol, rough: 0.6 });
  if (sh.kind === 'pump' || f.heelH > 0.02) {
    const hc = madd(madd(c, ez, -rz * 0.72), ey, -ry * 0.55 - f.heelH * 0.5);
    box(w, hc, B, rx * 0.4, f.heelH * 0.5 + 0.004, rz * 0.13, { col: col.map((x) => x * 0.6), rough: 0.5 });
  }
  if (sh.platform) box(w, madd(c, ey, -ry * 0.75), B, rx * 0.95, 0.012, rz * 0.9, { col: lin(0x6a5a4a), rough: 0.7 });
}

// ------------------------------------------------------------------ arms and hands
function emitArms(w, P, D, S, q) {
  const H = D.H;
  const top = P.top;
  const seg = Math.max(6, Math.round(9 * q));
  const sleeveSt = { col: top.col, col2: top.col2 || top.col, layer: top.layer ?? PAT.plain, scale: top.scale || 0.05, rough: 0.88, fold: 2 };
  const skinSt = { col: P.skin, rough: 0.6 };
  const loose = top.kind === 'coat' ? 1.18 : top.kind === 'jacket' || top.kind === 'gakuran' || top.kind === 'blouson' ? 1.1 : top.kind === 'knit' || top.kind === 'cardigan' ? 1.04 : 1.0;
  for (const s of [1, -1]) {
    const A = S.arms[s];
    const { SJ, elbow, wrist } = A;
    const upMid = lerp3(SJ, elbow, 0.45);
    const foreMid = lerp3(elbow, wrist, 0.5);
    const sl = top.sleeves || 'long';
    const rS = (D.f ? 0.027 : 0.031) * H * loose, rU = (D.f ? 0.026 : 0.03) * H * loose, rE = (D.f ? 0.022 : 0.026) * H * loose, rW = (D.f ? 0.019 : 0.022) * H * loose;
    if (sl === 'kimono') {
      tubePath(w, [SJ, upMid, elbow, foreMid, wrist], [rS * 1.15, rU * 1.2, rE * 1.25, rE * 1.25, rW * 1.35], seg, sleeveSt, { capStart: true, capTop: true, capCol: P.skin.map((c) => c * 0.4) });
      // hanging sleeve pouch
      const c = add(lerp3(elbow, wrist, 0.35), [0, -0.075 * H, 0]);
      const hd = [A.dir[0], 0, A.dir[2]];
      const ez = len(hd) > 0.2 ? nrm(hd) : [0, 0, 1];
      const ex = nrm(cross(Y, ez));
      ellipsoid(w, c, [ex, Y, ez], 0.022 * H, 0.08 * H, 0.085 * H, 8, 6, sleeveSt);
    } else if (sl === 'long' || sl === 'rolled') {
      const end = sl === 'rolled' ? lerp3(elbow, wrist, 0.3) : wrist;
      const pts = sl === 'rolled' ? [SJ, upMid, elbow, end] : [SJ, upMid, elbow, foreMid, wrist];
      const rad = sl === 'rolled' ? [rS, rU, rE, rE * 1.02] : [rS, rU, rE, rE * 0.92, rW];
      tubePath(w, pts, rad, seg, sleeveSt, { capStart: true, capFlat: 0.6, capTop: true, capCol: P.skin.map((c) => c * 0.5) });
      if (sl === 'rolled') {
        tubePath(w, [lerp3(elbow, wrist, 0.22), end], [rE * 1.12, rE * 1.12], seg, { ...sleeveSt, col: sleeveSt.col.map((c) => c * 0.92) }, {});
        tubePath(w, [lerp3(elbow, wrist, 0.25), foreMid, wrist], [0.022 * H, 0.02 * H, 0.0155 * H], seg, skinSt, {});
      } else if (P.inner && top.kind === 'jacket' && !top.casual) {
        // shirt cuff showing below the jacket sleeve
        tubePath(w, [lerp3(elbow, wrist, 0.93), madd(wrist, A.dir, 0.012 * H)], [0.0175 * H, 0.017 * H], seg, { col: P.inner.col, rough: 0.8 }, {});
      }
    } else {
      // short sleeves
      const end = lerp3(SJ, elbow, 0.55);
      tubePath(w, [SJ, lerp3(SJ, elbow, 0.3), end], [rS * 1.05, rU * 1.12, rU * 1.12], seg, sleeveSt, { capStart: true, capFlat: 0.6, capTop: true, capCol: P.skin.map((c) => c * 0.45) });
      tubePath(w, [lerp3(SJ, elbow, 0.4), elbow, foreMid, wrist], [(D.f ? 0.024 : 0.028) * H, (D.f ? 0.019 : 0.022) * H, (D.f ? 0.018 : 0.021) * H, (D.f ? 0.0135 : 0.0155) * H], seg, skinSt, {});
    }
    if (!A.hidden) emitHand(w, P, D, A, s);
  }
}

function emitHand(w, P, D, A, s) {
  const H = D.H;
  const ez = A.dir;
  let ex = cross(ez, [s, 0, 0]);
  if (len(ex) < 0.2) ex = cross(ez, Y);
  ex = nrm(ex);
  const ey = cross(ez, ex);
  const holding = (P.bag && P.bag.hand === (s > 0 ? 'L' : 'R') && A.mode === 'carry') || (P.umbrella && P.umbrella.hand === (s > 0 ? 'L' : 'R'));
  const fist = holding || A.mode === 'front' || A.mode === 'crossed' || A.mode === 'behind';
  const k = D.f ? 0.9 : 1;
  const c = madd(A.wrist, ez, (fist ? 0.032 : 0.045) * H * k);
  ellipsoid(w, c, [ex, ey, ez], (fist ? 0.025 : 0.024) * H * k, (fist ? 0.018 : 0.0125) * H * k, (fist ? 0.032 : 0.046) * H * k, 7, 5, { col: P.skin, rough: 0.6 });
  if (!fist) {
    // thumb
    ellipsoid(w, madd(c, ex, 0.012 * H * k), [ex, ey, ez], 0.008 * H * k, 0.008 * H * k, 0.02 * H * k, 5, 3, { col: P.skin, rough: 0.6 });
  }
  A.handC = c;
}

// ------------------------------------------------------------------ head, face, hair, hats
function headLocal(hc, B, x, y, z, hh) {
  return [hc[0] + (B[0][0] * x + B[1][0] * y + B[2][0] * z) * hh, hc[1] + (B[0][1] * x + B[1][1] * y + B[2][1] * z) * hh, hc[2] + (B[0][2] * x + B[1][2] * y + B[2][2] * z) * hh];
}

function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w2 = s(zf);
  let r = 0;
  for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
    r += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w2 : 1 - w2);
  }
  return r;
}

function emitHead(w, P, D, S, q, seed) {
  const H = D.H, hh = D.hh;
  const B = basisYawPitch(S.headYaw, S.headPitch);
  const hc = S.headC;
  const skin = { col: P.skin, rough: 0.58 };
  const su = Math.max(10, Math.round(14 * q)), sv = Math.max(6, Math.round(9 * q));
  // neck
  const neckTop = headLocal(hc, B, 0, -0.3, -0.05, hh);
  tubePath(w, [S.neckBase, lerp3(S.neckBase, neckTop, 0.5), neckTop], [D.neckR * 1.08, D.neckR, D.neckR * 0.98], 8, { col: P.skin.map((c) => c * 0.92), rough: 0.6 }, {});
  // skull + jaw
  const socket = P.skin.map((c, i) => c * [0.8, 0.76, 0.76][i]);
  ellipsoid(w, headLocal(hc, B, 0, 0.08, -0.01, hh), B, 0.34 * hh, 0.42 * hh, 0.42 * hh, su, sv, skin, {
    colFn: (lx, ly, lz) => (lz > 0.55 && ly > -0.4 && ly < -0.02 && Math.abs(lx) > 0.12 && Math.abs(lx) < 0.62 ? socket : null),
  });
  const cheek = P.skin.map((c, i) => c * [1.04, 0.96, 0.95][i]);
  ellipsoid(w, headLocal(hc, B, 0, -0.16, 0.07, hh), B, 0.27 * hh, 0.34 * hh, 0.33 * hh, su - 2, sv - 2, skin, {
    colFn: (lx, ly, lz) => (lz > 0.3 && Math.abs(lx) > 0.35 && ly > -0.3 ? cheek : null),
  });
  // face features (small, mostly read as shading at street distances)
  const dark = { col: P.hair.col.map((c) => c * 0.8 + 0.004), rough: 0.5 };
  const eyeC = [0.03, 0.025, 0.024];
  const surfZ = (x, y) => { const a = (x / 0.34) ** 2 + ((y - 0.08) / 0.42) ** 2; return -0.01 + 0.42 * Math.sqrt(Math.max(0, 1 - a)); };
  for (const s of [1, -1]) {
    ellipsoid(w, headLocal(hc, B, s * 0.125, 0.02, surfZ(0.125, 0.02) - 0.004, hh), B, 0.055 * hh, 0.022 * hh, 0.014 * hh, 6, 4, { col: eyeC, rough: 0.3 });
    ellipsoid(w, headLocal(hc, B, s * 0.13, 0.085, surfZ(0.13, 0.085) + 0.003, hh), B, 0.07 * hh, 0.014 * hh, 0.014 * hh, 6, 3, dark);
    ellipsoid(w, headLocal(hc, B, s * 0.335, 0.0, 0.0, hh), B, 0.035 * hh, 0.11 * hh, 0.07 * hh, 6, 4, skin);
  }
  ellipsoid(w, headLocal(hc, B, 0, -0.07, 0.375, hh), B, 0.05 * hh, 0.1 * hh, 0.075 * hh, 6, 4, skin);
  ellipsoid(w, headLocal(hc, B, 0, -0.245, 0.382, hh), B, 0.08 * hh, 0.018 * hh, 0.014 * hh, 6, 3, { col: P.skin.map((c, i) => c * [0.82, 0.62, 0.6][i]), rough: 0.5 });
  emitHair(w, P, D, hc, B, q, seed);
  if (P.hat) emitHat(w, P, D, hc, B);
  if (P.glasses) emitGlasses(w, P, D, hc, B, surfZ);
  if (P.cigarette && S.arms[1].mode !== 'smoke' && S.arms[-1].mode !== 'smoke') {
    // held between fingers of the right hand
    const A = S.arms[-1];
    if (A.handC && !A.hidden) tubePath(w, [madd(A.handC, A.dir, 0.02 * H), madd(madd(A.handC, A.dir, 0.02 * H), Z, 0.07)], [0.0045, 0.0045], 4, { col: lin(0xeeeae0), rough: 0.8 }, {});
  } else if (P.cigarette) {
    const p0 = headLocal(hc, B, 0.06, -0.25, 0.38, hh), p1 = headLocal(hc, B, 0.16, -0.3, 0.62, hh);
    tubePath(w, [p0, p1], [0.0045, 0.0045], 4, { col: lin(0xeeeae0), rough: 0.8 }, {});
  }
}

function emitHair(w, P, D, hc, B, q, seed) {
  const hh = D.hh;
  const st0 = P.hair.style;
  const col = P.hair.col;
  const style = { col, rough: st0 === 'slick' ? 0.42 : 0.6, layer: 20, scale: 0.1 };
  let vol = 1.07, thF = 0.95, thS = 1.45, thB = 2.15, bump = 0, curtain = null, th0 = 0, bun = false, braids = false, liftTop = 0.02;
  switch (st0) {
    case 'side-part': vol = 1.07; thF = 0.92; thS = 1.45; thB = 2.42; liftTop = 0.05; bump = 0.018; break;
    case 'slick': vol = 1.045; thF = 0.78; thS = 1.42; thB = 2.36; bump = 0.01; break;
    case 'balding': vol = 1.035; th0 = 0.62; thF = 1.2; thS = 1.58; thB = 2.36; break;
    case 'perm': vol = 1.17; thF = 0.9; thS = 1.55; thB = 2.4; bump = 0.06; break;
    case 'crew': vol = 1.022; thF = 0.78; thS = 1.62; thB = 2.3; bump = 0.006; break;
    case 'long70': vol = 1.12; thF = 1.22; thS = 1.95; thB = 2.3; bump = 0.025; curtain = { len: 0.64, open: 1.05, flare: 1.04 }; break;
    case 'mop': vol = 1.14; thF = 1.32; thS = 1.9; thB = 2.25; bump = 0.03; curtain = { len: 0.48, open: 1.0, flare: 1.02 }; break;
    case 'long': vol = 1.09; thF = seed % 2 ? 1.3 : 0.88; thS = 1.85; thB = 2.2; curtain = { len: 1.75 + (seed % 5) * 0.08, open: 0.92, flare: 1.18 }; break;
    case 'bob': vol = 1.13; thF = 1.33; thS = 1.95; thB = 2.25; bump = 0.012; curtain = { len: 0.5, open: 0.98, flare: 1.08 }; break;
    case 'shoulder': vol = 1.12; thF = seed % 2 ? 1.25 : 0.95; thS = 1.9; thB = 2.2; curtain = { len: 0.92, open: 0.95, flare: 1.25 }; break;
    case 'short-perm': vol = 1.2; thF = 0.95; thS = 1.75; thB = 2.42; bump = 0.07; curtain = { len: 0.36, open: 1.1, flare: 1.05 }; break;
    case 'bun': vol = 1.045; thF = 0.85; thS = 1.6; thB = 2.3; bun = true; break;
    case 'braids': vol = 1.06; thF = 1.25; thS = 1.75; thB = 2.15; braids = true; break;
    default: break;
  }
  const su = Math.max(12, Math.round((bump ? 20 : 16) * q)), sv = Math.max(6, Math.round((bump ? 11 : 9) * q));
  const thetaMax = (phi) => {
    const c = Math.cos(phi), s2 = Math.sin(phi) ** 2;
    const wf = Math.max(0, c) ** 2, wb = Math.max(0, -c) ** 2;
    return (thF * wf + thS * s2 + thB * wb) / (wf + s2 + wb);
  };
  const sd = (seed % 97) * 0.37;
  const strand = (phi, th) => 0.72 + 0.45 * vnoise(phi * 11 + sd, th * 4, sd);
  const crew = st0 === 'crew';
  const hairCol = crew ? col.map((c, i) => c * 0.75 + P.skin[i] * 0.25) : col;
  ellipsoid(w, headLocal(hc, B, 0, 0.08, -0.01, hh), B, 0.34 * hh, 0.42 * hh, 0.42 * hh, su, sv, { ...style, col: hairCol }, {
    thetaMax, theta0: th0,
    rfn: (lx, ly, lz, phi, th) => {
      const tm = thetaMax(phi);
      const edge = smooth(0.7, 1.0, th / tm);
      let m = 1 + (vol - 1) * (1 - 0.85 * edge);
      if (liftTop) m += liftTop * Math.max(0, ly) * Math.max(0, lz + 0.3);
      if (bump) m += bump * (vnoise(lx * 7 + sd, ly * 7, lz * 7) - 0.5) * (1 - edge * 0.7);
      return m;
    },
    colFn: (lx, ly, lz, phi, th) => {
      const k = strand(phi, th) * (st0 === 'side-part' && Math.abs(lx - 0.32) < 0.035 && lz > -0.2 && ly > 0.55 ? 0.55 : 1);
      return hairCol.map((c) => c * k);
    },
  });
  if (curtain) {
    const rings = [];
    const n = Math.max(3, Math.round(curtain.len / 0.18) + 2);
    const ex = B[0], ey = B[1], ez = B[2];
    const down = [0, -1, 0];
    const top = headLocal(hc, B, 0, 0.06, -0.03, hh);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const dist = (0.0 + curtain.len * t) * hh;
      // follow the head for the first part, then hang vertically
      const c = madd(top, t < 0.4 ? mul(ey, -1) : down, dist);
      const flare = 1 + (curtain.flare - 1) * smooth(0.45, 1, t);
      const rx = 0.34 * hh * vol * flare * (t > 0.5 && curtain.len > 1.2 ? 1.08 : 1);
      const rz = 0.42 * hh * vol * flare * (t > 0.5 && curtain.len > 1.2 ? 0.75 : 0.98);
      rings.push({ c: madd(c, ez, -0.02 * hh - (curtain.len > 1.2 ? 0.08 * hh * smooth(0.3, 1, t) : 0)), rx, ry: rz, f: [ex, ez, mul(ey, -1)] });
    }
    sweepRings(w, rings, su, { ...style }, {
      phi0: curtain.open, phi1: Math.PI * 2 - curtain.open, twoSided: true,
      rfn: bump ? (phi, k) => 1 + bump * 0.6 * (vnoise(phi * 3 + sd, k, 1) - 0.5) : undefined,
      colFn: (phi, k) => col.map((c) => c * strand(phi, k * 0.6)),
    });
  }
  if (bun) ellipsoid(w, headLocal(hc, B, 0, 0.22, -0.44, hh), B, 0.18 * hh, 0.15 * hh, 0.15 * hh, 8, 6, style);
  if (braids) {
    for (const s of [1, -1]) {
      const a = headLocal(hc, B, s * 0.3, -0.15, -0.18, hh);
      const b = add(a, [s * 0.01, -0.9 * hh, -0.03]);
      tubePath(w, [a, lerp3(a, b, 0.5), b], [0.07 * hh, 0.065 * hh, 0.05 * hh], 6, style, { capEnd: true });
    }
  }
}

function emitHat(w, P, D, hc, B) {
  const hh = D.hh;
  const col = P.hat.col;
  if (P.hat.kind === 'fedora') {
    const st = { col, rough: 0.8 };
    ellipsoid(w, headLocal(hc, B, 0, 0.24, -0.02, hh), B, 0.4 * hh, 0.36 * hh, 0.47 * hh, 12, 6, st, {
      thetaMax: () => Math.PI * 0.5,
      rfn: (lx, ly, lz) => 1 - 0.12 * Math.max(0, ly) ** 6 - 0.05 * Math.abs(lz) * Math.max(0, ly),
    });
    ellipsoid(w, headLocal(hc, B, 0, 0.25, -0.02, hh), B, 0.405 * hh, 0.06 * hh, 0.475 * hh, 12, 4, { col: col.map((c) => c * 0.35), rough: 0.6 });
    ellipsoid(w, headLocal(hc, B, 0, 0.2, 0, hh), B, 0.66 * hh, 0.03 * hh, 0.74 * hh, 14, 4, st);
  } else {
    // student cap / worker cap: cylinder crown with a flat top and a front visor
    const st = { col, rough: P.hat.kind === 'student' ? 0.7 : 0.85 };
    const ex = B[0], ey = B[1], ez = B[2];
    const c0 = headLocal(hc, B, 0, 0.18, -0.01, hh);
    const c1 = madd(c0, ey, 0.24 * hh);
    const rings = [
      { c: c0, rx: 0.37 * hh, ry: 0.45 * hh, f: [ex, ez, ey] },
      { c: madd(c0, ey, 0.12 * hh), rx: 0.39 * hh, ry: 0.47 * hh, f: [ex, ez, ey] },
      { c: c1, rx: P.hat.kind === 'student' ? 0.41 * hh : 0.33 * hh, ry: P.hat.kind === 'student' ? 0.49 * hh : 0.4 * hh, f: [ex, ez, ey] },
    ];
    sweepRings(w, rings, 14, st, { capTop: true, capCol: col.map((c) => c * 1.05) });
    ellipsoid(w, headLocal(hc, B, 0, 0.19, 0.42, hh), B, 0.3 * hh, 0.025 * hh, 0.24 * hh, 10, 3, { col: P.hat.kind === 'student' ? lin(0x0c0c0e) : col.map((c) => c * 0.8), rough: 0.3 }, {
      phi0: -Math.PI / 2, phi1: Math.PI / 2,
    });
    if (P.hat.kind === 'student') ellipsoid(w, headLocal(hc, B, 0, 0.3, 0.47, hh), B, 0.05 * hh, 0.05 * hh, 0.01 * hh, 5, 3, { col: GOLD, rough: 0.35 });
  }
}

function emitGlasses(w, P, D, hc, B, surfZ) {
  const hh = D.hh;
  const frame = { col: P.glasses.kind === 'sun' ? lin(0x1a1714) : lin(0x231d18), rough: 0.3 };
  const zF = (x) => surfZ(x, 0.03) + 0.045;
  if (P.glasses.kind === 'sun') {
    for (const s of [1, -1]) ellipsoid(w, headLocal(hc, B, s * 0.13, 0.02, zF(0.13), hh), B, 0.105 * hh, 0.08 * hh, 0.012 * hh, 8, 4, { col: lin(0x0b0b0c), rough: 0.12 });
  } else {
    // brow-line frame: thick upper rims, thin lower rims
    for (const s of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = s * 0.13 + Math.cos(a) * 0.095, y = 0.02 + Math.sin(a) * 0.07;
        pts.push(headLocal(hc, B, x, y, zF(Math.abs(x)), hh));
      }
      tubePath(w, pts, pts.map((_, i) => (Math.sin((i / 8) * Math.PI * 2) > 0.2 ? 0.016 : 0.007) * hh), 4, frame, {});
      tubePath(w, [headLocal(hc, B, s * 0.225, 0.04, zF(0.225), hh), headLocal(hc, B, s * 0.33, 0.04, 0.05, hh)], [0.008 * hh, 0.008 * hh], 4, frame, {});
    }
  }
  tubePath(w, [headLocal(hc, B, -0.04, 0.045, zF(0.04), hh), headLocal(hc, B, 0.04, 0.045, zF(0.04), hh)], [0.01 * hh, 0.01 * hh], 4, frame, {});
}

// ------------------------------------------------------------------ carried items
function emitCarried(w, P, D, S) {
  const H = D.H;
  const handOf = (h) => S.arms[h === 'L' ? 1 : -1];
  if (P.bag) {
    const A = handOf(P.bag.hand);
    const k = P.bag.kind;
    const st = { col: P.bag.col, rough: k === 'paper' ? 0.85 : 0.4 };
    const yaw = S.pelvisYaw;
    const Bb = [rotY(X, yaw), Y, rotY(Z, yaw)];
    if (k === 'shoulder' || (k === 'handbag' && A.mode !== 'carry' && A.mode !== 'crook' && A.mode !== 'front')) {
      const s = P.bag.hand === 'L' ? 1 : -1;
      const top = S.ptx([s * 0.072 * H, 0.84 * H, -0.004 * H])[0];
      const front = S.ptx([s * 0.085 * H, 0.72 * H, (profAt(D, 0.72 * H, 0.012 * H)[1] + profAt(D, 0.72 * H)[2]) + 0.006 * H])[0];
      const bagC = S.ptx([s * 0.135 * H, 0.475 * H, 0.03 * H])[0];
      const back = S.ptx([s * 0.1 * H, 0.7 * H, -profAt(D, 0.7 * H, 0.012 * H)[1] + profAt(D, 0.7 * H)[2] - 0.004 * H])[0];
      tubePath(w, [add(bagC, [0, 0.08 * H * 0.6, 0.06]), front, top, back, add(bagC, [0, 0.05, -0.06])], [0.006, 0.006, 0.006, 0.006, 0.006], 4, { col: P.bag.col.map((c) => c * 0.8), rough: 0.5 }, {});
      box(w, bagC, Bb, 0.03, 0.09 * (k === 'handbag' ? 0.8 : 1), 0.12, st, P.bag.col.map((c) => c * 0.85));
    } else if (k === 'handbag' && (A.mode === 'crook')) {
      const c = add(lerp3(A.elbow, A.wrist, 0.35), [0, -0.1, 0]);
      tubePath(w, [add(c, [0, 0.07, 0.05]), lerp3(A.elbow, A.wrist, 0.35), add(c, [0, 0.07, -0.05])], [0.005, 0.005, 0.005], 4, st, {});
      box(w, c, Bb, 0.04, 0.075, 0.12, st);
    } else if (k === 'handbag' && A.mode === 'front') {
      const c = add(A.handC || A.wrist, [-(P.bag.hand === 'L' ? 1 : -1) * 0.03, -0.08, 0.02]);
      box(w, c, Bb, 0.12, 0.08, 0.04, st);
    } else {
      // carried by the handle in a hanging hand: briefcase, school bag, paper bag, handbag
      const hand = A.handC || A.wrist;
      const dims2 = k === 'briefcase' ? [0.045, 0.16, 0.21] : k === 'school' ? [0.04, 0.14, 0.2] : k === 'paper' ? [0.065, 0.17, 0.15] : [0.035, 0.09, 0.13];
      const hy = k === 'paper' ? 0.1 : 0.035;
      const c = add(hand, [0, -hy - dims2[1], 0]);
      const s = P.bag.hand === 'L' ? 1 : -1;
      c[0] += s * 0.012;
      box(w, c, Bb, dims2[0], dims2[1], dims2[2], st, k === 'paper' ? st.col.map((x) => x * 0.55) : null);
      // handle
      const ht = add(c, [0, dims2[1], 0]);
      tubePath(w, [madd(ht, Bb[2], -0.05), add(hand, [0, -0.005, -0.015]), add(hand, [0, -0.005, 0.015]), madd(ht, Bb[2], 0.05)], [0.007, 0.008, 0.008, 0.007], 4, { col: k === 'paper' ? st.col.map((x) => x * 0.8) : lin(0x15120f), rough: 0.5 }, {});
      if (k === 'briefcase') box(w, add(c, [0, dims2[1] - 0.01, 0]), Bb, dims2[0] + 0.002, 0.004, 0.02, { col: GOLD, rough: 0.3 });
    }
  }
  if (P.umbrella) {
    const A = handOf(P.umbrella.hand);
    const hand = A.handC || A.wrist;
    const s = P.umbrella.hand === 'L' ? 1 : -1;
    let tip;
    if (S.walk) tip = add(hand, rotY([s * 0.05, -0.62, 0.42], S.pelvisYaw));
    else tip = add(hand, [s * 0.12, -(hand[1] - 0.01), 0.18]);
    const dir = nrm(sub(tip, hand));
    const Lr = len(sub(tip, hand));
    const p = (t) => madd(hand, dir, t * Lr);
    const st = { col: P.umbrella.col, rough: 0.55 };
    tubePath(w, [p(0.04), p(0.18), p(0.38), p(0.7), p(0.9)], [0.01, 0.03, 0.036, 0.022, 0.006], 7, st, {});
    tubePath(w, [p(0.88), p(1)], [0.004, 0.003], 4, { col: lin(0x9a9890), rough: 0.3 }, {});
    // crook handle above the hand
    const up = mul(dir, -1);
    const side = nrm(cross(up, rotY(X, S.pelvisYaw)));
    tubePath(w, [p(0.04), madd(hand, up, 0.05), madd(madd(hand, up, 0.09), side, 0.03), madd(madd(hand, up, 0.07), side, 0.06), madd(madd(hand, up, 0.035), side, 0.065)], [0.009, 0.009, 0.009, 0.009, 0.009], 4, { col: lin(0x3a2a1c), rough: 0.35 }, {});
  }
  if (P.newspaper) {
    const s = P.bag ? (P.bag.hand === 'L' ? -1 : 1) : 1;
    const A = S.arms[s];
    const c = lerp3(A.SJ, A.elbow, 0.55);
    const ez = nrm(sub(A.elbow, A.SJ));
    box(w, add(c, rotY([-s * 0.035, 0, 0.04], S.pelvisYaw)), [rotY(X, S.pelvisYaw), ez, nrm(cross(rotY(X, S.pelvisYaw), ez))], 0.008, 0.14, 0.11, { col: lin(0xcfccc2), rough: 0.9 });
  }
  if (P.jacketOverArm) {
    const s = 1;
    const A = S.arms[s];
    const c = add(lerp3(A.elbow, A.wrist, 0.4), [0, -0.12, 0]);
    ellipsoid(w, c, [rotY(X, S.pelvisYaw), Y, rotY(Z, S.pelvisYaw)], 0.035, 0.17, 0.1, 8, 6, { col: P.jacketOverArm, rough: 0.88 });
  }
}

/** Emit one complete person (local frame; the writer transform places it in the world). */
export function emitPerson(w, P, pose, q = 1, seed = 0) {
  const D = dims(P);
  const S = solvePose(P, D, pose);
  w.aoH = D.H;
  emitLegs(w, P, D, S, q);
  emitTopAndBottom(w, P, D, S, q);
  emitArms(w, P, D, S, q);
  emitHead(w, P, D, S, q, seed);
  emitCarried(w, P, D, S);
  return { height: D.H, radius: 0.3 };
}
