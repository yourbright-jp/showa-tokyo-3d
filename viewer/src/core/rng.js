// Deterministic randomness. Every procedural decision must draw from a keyed stream so
// that the same world is rebuilt for every frame, camera and render run.
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keyed stream with helpers. rng('signage/bldg_123') always yields the same sequence. */
export function makeRng(globalSeed = 1976) {
  return function rng(key) {
    const r = mulberry32(hashString(`${globalSeed}:${key}`));
    r.range = (a, b) => a + (b - a) * r();
    r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
    r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
    r.chance = (p) => r() < p;
    r.normal = () => {
      const u = Math.max(1e-9, r());
      const v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return r;
  };
}
