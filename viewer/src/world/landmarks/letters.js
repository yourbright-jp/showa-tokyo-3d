import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JP_FONT } from '../../core/textures.js';
import { normGeo } from './kit.js';

// Dimensional (extruded) letters generated in code from the system CJK font: the string is
// rasterised to a canvas, its outline is traced with marching squares, simplified, nested into
// shapes with holes and extruded. No font files are loaded; IPAGothic / WenQuanYi are used.
// The visible glyph bounding box is fitted to the declared physical height and centred on the
// adopted text-node position (matching the r03 "glyphs fitted to declared height" rule).

const cache = new Map();

function traceString(text, { px = 150, weight = 'bold', stroke = 0, font = JP_FONT, spacing = 0 }) {
  const key = `${text}|${px}|${weight}|${stroke}|${font}|${spacing}`;
  if (cache.has(key)) return cache.get(key);
  const pad = Math.ceil(px * 0.25 + stroke);
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${weight} ${px}px ${font}`;
  let w = 0;
  const adv = [];
  for (const ch of text) { const m = probe.measureText(ch).width; adv.push(m); w += m + spacing * px; }
  const W = Math.ceil(w + pad * 2), H = Math.ceil(px * 1.5 + pad * 2);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.font = `${weight} ${px}px ${font}`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineWidth = stroke;
  let x = pad;
  const yb = pad + px * 1.1;
  let i = 0;
  for (const ch of text) {
    g.fillText(ch, x, yb);
    if (stroke > 0) g.strokeText(ch, x, yb);
    x += adv[i++] + spacing * px;
  }
  const data = g.getImageData(0, 0, W, H).data;
  const v = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) v[k] = data[k * 4] / 255;
  const loops = marchingSquares(v, W, H, 0.5).map((l) => simplifyClosed(l, 0.22)).filter((l) => l.length >= 3 && Math.abs(area(l)) > 2);
  const res = { loops, W, H };
  cache.set(key, res);
  return res;
}

function area(l) { let s = 0; for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

function marchingSquares(v, W, H, iso) {
  // edge ids: horizontal edge (x,y)-(x+1,y): (y*W+x)*2 ; vertical edge (x,y)-(x,y+1): (y*W+x)*2+1
  const pts = new Map();
  const segA = []; const segB = [];
  const at = (x, y) => v[y * W + x];
  const hE = (x, y) => (y * W + x) * 2, vE = (x, y) => (y * W + x) * 2 + 1;
  const point = (id) => {
    let p = pts.get(id);
    if (p) return p;
    const cell = id >> 1, x = cell % W, y = (cell - x) / W;
    if (id & 1) { const a = at(x, y), b = at(x, y + 1); const t = (iso - a) / (b - a || 1e-6); p = [x, y + Math.min(1, Math.max(0, t))]; }
    else { const a = at(x, y), b = at(x + 1, y); const t = (iso - a) / (b - a || 1e-6); p = [x + Math.min(1, Math.max(0, t)), y]; }
    pts.set(id, p); return p;
  };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const tl = at(x, y) > iso, tr = at(x + 1, y) > iso, br = at(x + 1, y + 1) > iso, bl = at(x, y + 1) > iso;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = hE(x, y), B = hE(x, y + 1), L = vE(x, y), R = vE(x + 1, y);
    const add = (a, b) => { segA.push(a); segB.push(b); };
    switch (c) {
      case 1: add(L, B); break; case 2: add(B, R); break; case 3: add(L, R); break;
      case 4: add(T, R); break; case 6: add(T, B); break; case 7: add(T, L); break;
      case 8: add(T, L); break; case 9: add(T, B); break; case 11: add(T, R); break;
      case 12: add(L, R); break; case 13: add(B, R); break; case 14: add(L, B); break;
      case 5: { const ctr = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > iso; if (ctr) { add(T, L); add(B, R); } else { add(T, R); add(L, B); } break; }
      case 10: { const ctr = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > iso; if (ctr) { add(T, R); add(L, B); } else { add(T, L); add(B, R); } break; }
      default: break;
    }
  }
  const byEdge = new Map();
  for (let s = 0; s < segA.length; s++) {
    for (const e of [segA[s], segB[s]]) { const l = byEdge.get(e); if (l) l.push(s); else byEdge.set(e, [s]); }
  }
  const used = new Uint8Array(segA.length);
  const loops = [];
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const loop = [point(segA[s0])];
    let cur = segB[s0];
    let guard = 0;
    while (guard++ < 200000) {
      loop.push(point(cur));
      const l = byEdge.get(cur);
      let next = -1;
      for (const s of l) if (!used[s]) { next = s; break; }
      if (next < 0) break;
      used[next] = 1;
      cur = segA[next] === cur ? segB[next] : segA[next];
    }
    if (loop.length > 3) { loop.pop(); loops.push(loop); }
  }
  return loops;
}

function simplifyClosed(pts, tol) {
  if (pts.length < 8) return pts;
  // split at index 0 and farthest point
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = dp(pts.slice(0, far + 1), tol), b = dp(pts.slice(far).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = pts[i0], [bx, by] = pts[i1];
    const dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function insideLoop(p, l) {
  let inside = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Build extruded letter geometry for `text` in local space: x = reading direction, y = up,
 * z = towards the viewer. The visible glyph box is `height` metres tall, centred at (0,0);
 * the front face lies at z = 0 and the letters extend back to z = -depth.
 * Returns {face: BufferGeometry, side: BufferGeometry, width, height}.
 */
export function letterGeometry(text, height, depth, opts = {}) {
  const { loops } = traceString(text, opts);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of loops) for (const [x, y] of l) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const s = height / (maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const L = loops.map((l) => l.map(([x, y]) => [(x - cx) * s, -(y - cy) * s]));
  const info = L.map((l, i) => ({ i, l, a: Math.abs(area(l)), depth: 0, parent: -1 }));
  info.sort((p, q) => q.a - p.a);
  for (let k = 0; k < info.length; k++) {
    const me = info[k];
    let best = -1, bestA = Infinity, count = 0;
    for (let j = 0; j < k; j++) {
      const o = info[j];
      if (o.a <= me.a) continue;
      if (insideLoop(me.l[0], o.l)) { count++; if (o.a < bestA) { bestA = o.a; best = j; } }
    }
    me.depth = count; me.parent = best;
  }
  const shapes = new Map();
  for (let k = 0; k < info.length; k++) {
    const me = info[k];
    if (me.depth % 2 === 0) shapes.set(k, new THREE.Shape(me.l.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  for (let k = 0; k < info.length; k++) {
    const me = info[k];
    if (me.depth % 2 === 1 && shapes.has(me.parent)) shapes.get(me.parent).holes.push(new THREE.Path(me.l.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  const bevel = opts.bevel ?? Math.min(0.006, height * 0.008);
  const geo = new THREE.ExtrudeGeometry([...shapes.values()], {
    depth: Math.max(0.002, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelOffset: -bevel * 0.6, bevelSegments: 1, curveSegments: 1,
  });
  geo.translate(0, 0, -(depth - bevel));
  // split cap/side groups
  const face = new THREE.BufferGeometry(), side = new THREE.BufferGeometry();
  const src = geo.toNonIndexed ? geo : geo;
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv;
  const take = (g, start, count) => {
    const p = new Float32Array(count * 3), n = new Float32Array(count * 3), u = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      p.set([pos.getX(start + i), pos.getY(start + i), pos.getZ(start + i)], i * 3);
      n.set([nor.getX(start + i), nor.getY(start + i), nor.getZ(start + i)], i * 3);
      u.set([uv.getX(start + i), uv.getY(start + i)], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  };
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const faceParts = [], sideParts = [];
  for (const gr of groups) {
    const g = new THREE.BufferGeometry();
    take(g, gr.start, gr.count);
    (gr.materialIndex === 0 ? faceParts : sideParts).push(normGeo(g));
  }
  geo.dispose();
  const merge = (arr) => (arr.length ? mergeGeometries(arr, false) : null);
  return { face: merge(faceParts), side: merge(sideParts), width: (maxX - minX) * s, height };
}

/** Matrix placing local letter space at an adopted text node (front face on the node plane). */
export function textNodeMatrix(node, zShift = 0) {
  const [bx, bz] = node.baseline_direction_xz;
  const L = Math.hypot(bx, bz);
  const X = new THREE.Vector3(bx / L, 0, bz / L);
  const Z = new THREE.Vector3(-bz / L, 0, bx / L);
  const m = new THREE.Matrix4().makeBasis(X, new THREE.Vector3(0, 1, 0), Z);
  const [px, py, pz] = node.position_m;
  m.setPosition(px + Z.x * zShift, py, pz + Z.z * zShift);
  return m;
}
