import * as THREE from 'three';
import { macroTexture } from './landmarks/kit.js';
import { buildGate } from './landmarks/gate.js';
import { buildKoma } from './landmarks/koma.js';
import { buildToho } from './landmarks/toho.js';
import { buildMilano } from './landmarks/milano.js';
import { buildPlaza } from './landmarks/plaza.js';

// Landmarks module (round r04): the adopted Ichibangai gate, the Koma Theatre, Shinjuku Toho
// Kaikan, Milano-za and the plaza furniture (fountain, multi-globe lamps, planters, benches).
// Adopted forms follow data/decisions/*.json and the adopted fixtures/text nodes exactly;
// authored detailing is tagged period-plausible-generic. Everything is generated in code.
export async function build(ctx) {
  const group = new THREE.Group();
  const t0 = performance.now();
  const kit = {
    night: ctx.look && ctx.look.name === 'neon-night',
    macro: macroTexture(ctx.rng('landmarks/macro')),
  };
  const parts = [
    ['gate', buildGate],
    ['koma', buildKoma],
    ['toho', buildToho],
    ['milano', buildMilano],
    ['plaza', buildPlaza],
  ];
  for (const [name, fn] of parts) {
    const ts = performance.now();
    try {
      const g = await fn(ctx, kit);
      if (g) group.add(g);
      ctx.log(`landmarks/${name}: ${(performance.now() - ts).toFixed(0)} ms`);
    } catch (err) {
      ctx.log(`landmarks/${name} FAILED: ${err && err.stack || err}`);
      throw err;
    }
  }
  ctx.log(`landmarks total build: ${(performance.now() - t0).toFixed(0)} ms`);
  return group;
}
