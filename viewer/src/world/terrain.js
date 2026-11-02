import * as THREE from 'three';

// Baseline: modern PLATEAU DEM TIN as the ground surface (1976 ground levels unverified).
export function build(ctx) {
  const { terrain } = ctx.data;
  const group = new THREE.Group();
  const pos = new Float32Array(terrain.vertices.length * 3);
  terrain.vertices.forEach((v, i) => pos.set(v, i * 3));
  const idx = new Uint32Array(terrain.triangles.flat());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // TIN winding may face down; force up-facing normals by flipping if needed
  const n = geo.attributes.normal;
  let up = 0; for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.index.needsUpdate = true; geo.computeVertexNormals(); }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95 }));
  mesh.castShadow = false;
  group.add(mesh);
  ctx.tag({ id: 'terrain-ground', module: 'terrain', tier: 'source-derived', note: 'PLATEAU 2025 DEM; 1976 ground levels unverified' });
  return group;
}
