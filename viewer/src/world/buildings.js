import * as THREE from 'three';

// Baseline massing: extruded footprints (modern PLATEAU LOD1 and aerial-interpreted proxies).
export function build(ctx) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 });
  const proxyMat = new THREE.MeshStandardMaterial({ color: 0xc89a6a, roughness: 0.9 });
  for (const b of ctx.data.buildings) {
    const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, b.baseY, 0);
    const mesh = new THREE.Mesh(geo, b.proxy ? proxyMat : mat);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
