// Ordered list of world modules. Each module file exports `build(ctx)` returning a THREE.Group
// (or a Promise of one). Modules are imported dynamically so a broken module cannot stop the
// others from rendering. Modules must be deterministic (use ctx.rng(key)) and must call
// ctx.tag({...}) for generated content whose evidence tier matters.
export const WORLD_MODULES = [
  { name: 'terrain', path: './terrain.js' },
  { name: 'buildings', path: './buildings.js' },
  { name: 'signage', path: './signage.js' },
  { name: 'landmarks', path: './landmarks.js' },
  { name: 'streetprops', path: './streetprops.js' },
  { name: 'people', path: './people.js' },
];
