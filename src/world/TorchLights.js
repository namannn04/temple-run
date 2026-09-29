import * as THREE from 'three';

/**
 * A small fixed pool of flickering point lights that hop onto the torches
 * nearest the runner, so the flames actually light the stone around them
 * without paying for a light per torch.
 */
export class TorchLights {
  constructor(scene, count = 4) {
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xff8a3c, 0, 11, 2);
      l.userData.seed = i * 13.7;
      scene.add(l);
      this.lights.push(l);
    }
    this._cands = [];
  }

  update(time, focus, segments) {
    const cands = this._cands;
    cands.length = 0;
    for (const seg of segments) {
      if (!seg.torches) continue;
      for (const p of seg.torches) {
        const d = p.distanceToSquared(focus);
        if (d < 900) cands.push({ p, d });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    this.lights.forEach((l, i) => {
      const c = cands[i];
      if (!c) {
        l.intensity = 0;
        return;
      }
      l.position.copy(c.p).setY(c.p.y + 0.35);
      const s = l.userData.seed;
      const flicker = 0.8 + Math.sin(time * 13 + s) * 0.08 + Math.sin(time * 23.7 + s * 2) * 0.06 + Math.sin(time * 5.3 + s) * 0.06;
      // fade lights in/out with distance so hopping between torches is invisible
      const fade = THREE.MathUtils.clamp(1 - (Math.sqrt(c.d) - 18) / 12, 0, 1);
      l.intensity = 14 * flicker * fade;
    });
  }
}
