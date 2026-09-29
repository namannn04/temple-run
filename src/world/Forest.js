import * as THREE from 'three';
import { mulberry32 } from './Textures.js';

const AREA = 520; // side of the wrapping forest tile
const HALF = AREA / 2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A dense jungle canopy far below the walkway. Trees are anchored in world
 * space and wrap around the runner on a torus, so the forest looks endless
 * and static without ever being regenerated.
 */
export class Forest {
  constructor(scene, assets) {
    const rnd = mulberry32(2024);
    const count = Math.round(520 * assets.quality.trees);
    this.meshes = [];
    this.items = [];
    this.center = new THREE.Vector2(Infinity, Infinity);

    const perVariant = Math.ceil(count / assets.trees.length);
    assets.trees.forEach((tree, v) => {
      const trunks = new THREE.InstancedMesh(tree.trunkGeo, assets.mat.bark, perVariant);
      const leaves = new THREE.InstancedMesh(tree.leafGeo, assets.mat.leaves, perVariant);
      const c = new THREE.Color();
      for (let i = 0; i < perVariant; i++) {
        const scale = 0.9 + rnd() * 0.7;
        const item = {
          mesh: v,
          i,
          x: (rnd() - 0.5) * AREA,
          z: (rnd() - 0.5) * AREA,
          // Keep every canopy well below the walkway
          y: -12 - scale * 48 - rnd() * 10,
          scale,
          rot: rnd() * Math.PI * 2,
          wx: NaN,
          wz: NaN,
        };
        this.items.push(item);
        const t = 0.6 + rnd() * 0.45;
        leaves.setColorAt(i, c.setRGB(t * (0.85 + rnd() * 0.25), t, t * (0.8 + rnd() * 0.2)));
      }
      trunks.frustumCulled = leaves.frustumCulled = false;
      leaves.receiveShadow = false;
      scene.add(trunks, leaves);
      this.meshes.push({ trunks, leaves });
    });
  }

  update(focus) {
    // Only re-wrap when the runner has moved a meaningful amount
    if (Math.abs(focus.x - this.center.x) < 8 && Math.abs(focus.z - this.center.y) < 8) return;
    this.center.set(focus.x, focus.z);
    const dirty = new Set();
    for (const it of this.items) {
      const wx = it.x + Math.round((focus.x - it.x) / AREA) * AREA;
      const wz = it.z + Math.round((focus.z - it.z) / AREA) * AREA;
      if (wx === it.wx && wz === it.wz) continue;
      it.wx = wx;
      it.wz = wz;
      _p.set(wx, it.y, wz);
      _q.setFromAxisAngle(UP, it.rot);
      _m.compose(_p, _q, _s.setScalar(it.scale));
      const m = this.meshes[it.mesh];
      m.trunks.setMatrixAt(it.i, _m);
      m.leaves.setMatrixAt(it.i, _m);
      dirty.add(m);
    }
    for (const m of dirty) {
      m.trunks.instanceMatrix.needsUpdate = true;
      m.leaves.instanceMatrix.needsUpdate = true;
    }
  }
}
