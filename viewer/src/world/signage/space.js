// Spatial queries for sign placement: building footprints, overhead sign volumes (2D oriented
// boxes with a height range), ground obstacles and the walk corridor.
import { pointInPolygon } from '../../core/facades.js';

export class Space {
  constructor(ctx) {
    this.ctx = ctx;
    this.cell = 12;
    this.bgrid = new Map();
    this.vgrid = new Map();
    this.vols = [];
    for (const b of ctx.data.buildings) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of b.footprint) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      b._bb = [x0, z0, x1, z1];
      this._cells(x0, z0, x1, z1, (k) => { if (!this.bgrid.has(k)) this.bgrid.set(k, []); this.bgrid.get(k).push(b); });
    }
  }
  _cells(x0, z0, x1, z1, fn) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++) for (let gz = Math.floor(z0 / c); gz <= Math.floor(z1 / c); gz++) fn(`${gx},${gz}`);
  }
  /** Building containing (x,z), or null. */
  buildingAt(x, z, margin = 0) {
    const list = this.bgrid.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    if (!list) return null;
    for (const b of list) {
      const bb = b._bb;
      if (x < bb[0] - margin || x > bb[2] + margin || z < bb[1] - margin || z > bb[3] + margin) continue;
      if (pointInPolygon(x, z, b.footprint)) return b;
    }
    return null;
  }
  /** True when (x,z) is inside the footprint of building b (with optional inward margin test). */
  insideBuilding(b, x, z) { return pointInPolygon(x, z, b.footprint); }

  /**
   * Register an overhead/ground volume: centre (cx,cz), unit axis (ax,az) of the first half
   * extent hu, perpendicular half extent hv, height range y0..y1.
   */
  addVolume(v) {
    const r = Math.hypot(v.hu, v.hv);
    v.bb = [v.cx - r, v.cz - r, v.cx + r, v.cz + r];
    this.vols.push(v);
    this._cells(v.bb[0], v.bb[1], v.bb[2], v.bb[3], (k) => { if (!this.vgrid.has(k)) this.vgrid.set(k, []); this.vgrid.get(k).push(v); });
  }
  /** Does volume v (same shape as addVolume, plus margin) overlap any registered volume? */
  hits(v, margin = 0.1, ymargin = 0.04) {
    const r = Math.hypot(v.hu, v.hv) + margin;
    const seen = new Set();
    let hit = false;
    this._cells(v.cx - r, v.cz - r, v.cx + r, v.cz + r, (k) => {
      if (hit) return;
      const list = this.vgrid.get(k);
      if (!list) return;
      for (const w of list) {
        if (seen.has(w)) continue; seen.add(w);
        if (v.y1 + ymargin < w.y0 || w.y1 + ymargin < v.y0) continue;
        if (obbOverlap(v, w, margin)) { hit = true; return; }
      }
    });
    return hit;
  }
}

function obbOverlap(a, b, m) {
  const axes = [[a.ax, a.az], [-a.az, a.ax], [b.ax, b.az], [-b.az, b.ax]];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [x, z] of axes) {
    const ra = a.hu * Math.abs(a.ax * x + a.az * z) + a.hv * Math.abs(-a.az * x + a.ax * z);
    const rb = b.hu * Math.abs(b.ax * x + b.az * z) + b.hv * Math.abs(-b.az * x + b.ax * z);
    if (Math.abs(dx * x + dz * z) > ra + rb + m) return false;
  }
  return true;
}

export function polygonCentroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}
