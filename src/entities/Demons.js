import * as THREE from 'three';

const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

/** A capsule limb hanging from a pivot at its top. */
function limb(mat, radius, length) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
  upper.position.y = -length / 2;
  upper.castShadow = true;
  pivot.add(upper);
  const knee = new THREE.Group();
  knee.position.y = -length;
  pivot.add(knee);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.8, length * 0.9, 4, 10), mat);
  lower.position.y = -length * 0.45;
  lower.castShadow = true;
  knee.add(lower);
  pivot.userData.knee = knee;
  return pivot;
}

/**
 * One demon monkey built from primitives, animated with a procedural gallop.
 */
class Demon {
  constructor(furMat, skinMat, eyeMat, seed) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.phase = seed * 1.7;
    this.seed = seed;

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), furMat);
    torso.scale.set(0.95, 0.85, 1.35);
    torso.position.set(0, 0.95, 0.05);
    torso.rotation.x = -0.35;
    torso.castShadow = true;
    this.body.add(torso);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), furMat);
    chest.scale.set(1.15, 1.0, 1.0);
    chest.position.set(0, 1.12, -0.38);
    chest.castShadow = true;
    this.body.add(chest);

    // Head with a snarling muzzle and glowing eyes
    const head = new THREE.Group();
    head.position.set(0, 1.28, -0.78);
    this.body.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), furMat);
    skull.scale.set(1, 0.95, 1.05);
    skull.castShadow = true;
    head.add(skull);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skinMat);
    face.scale.set(0.95, 0.8, 0.7);
    face.position.set(0, -0.04, -0.14);
    head.add(face);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), skinMat);
    muzzle.scale.set(1.2, 0.8, 1);
    muzzle.position.set(0, -0.1, -0.27);
    head.add(muzzle);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), skinMat);
    jaw.scale.set(1.1, 0.5, 1);
    jaw.position.set(0, -0.2, -0.22);
    head.add(jaw);
    this.jaw = jaw;
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), eyeMat);
      eye.position.set(s * 0.085, 0.03, -0.25);
      head.add(eye);
      const brow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), furMat);
      brow.scale.set(1.3, 0.45, 0.8);
      brow.position.set(s * 0.09, 0.09, -0.22);
      brow.rotation.z = s * 0.35;
      head.add(brow);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skinMat);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(s * 0.25, 0.04, -0.02);
      head.add(ear);
    }

    // Long arms (used for knuckle-galloping) and shorter hind legs
    this.arms = [];
    this.legs = [];
    for (const s of [-1, 1]) {
      const arm = limb(furMat, 0.1, 0.55);
      arm.position.set(s * 0.38, 1.18, -0.45);
      this.body.add(arm);
      this.arms.push(arm);
      const leg = limb(furMat, 0.12, 0.42);
      leg.position.set(s * 0.3, 0.9, 0.42);
      this.body.add(leg);
      this.legs.push(leg);
    }

    // Tail
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.9, 4, 8), furMat);
    tail.position.set(0, 1.0, 0.95);
    tail.rotation.x = 1.0;
    this.body.add(tail);
    this.tail = tail;

    const s = 1.05 + (seed % 3) * 0.08;
    this.root.scale.setScalar(s);
  }

  animate(dt, speed, t) {
    // Gallop frequency rises with running speed
    const freq = 1.6 + speed * 0.14;
    this.phase += dt * freq * Math.PI * 2;
    const p = this.phase;
    const swing = 1.0;
    // Front pair and hind pair alternate like a bounding gallop
    this.arms[0].rotation.x = Math.sin(p) * swing - 0.2;
    this.arms[1].rotation.x = Math.sin(p + 0.35) * swing - 0.2;
    this.legs[0].rotation.x = Math.sin(p + Math.PI) * swing * 0.9 + 0.3;
    this.legs[1].rotation.x = Math.sin(p + Math.PI + 0.35) * swing * 0.9 + 0.3;
    for (const l of this.arms) l.userData.knee.rotation.x = -Math.max(0, Math.cos(p)) * 0.8;
    for (const l of this.legs) l.userData.knee.rotation.x = Math.max(0, Math.cos(p + Math.PI)) * 1.1;
    this.body.position.y = Math.abs(Math.sin(p)) * 0.18;
    this.body.rotation.x = Math.sin(p) * 0.12;
    this.head.rotation.x = -Math.sin(p) * 0.15 + 0.1;
    this.jaw.position.y = -0.2 - (Math.sin(t * 9 + this.seed) * 0.5 + 0.5) * 0.05;
    this.tail.rotation.z = Math.sin(p * 0.5) * 0.4;
  }
}

/**
 * The pack of demons following the runner's exact trail.
 */
export class Demons {
  constructor(scene, textures) {
    this.scene = scene;
    const furMat = new THREE.MeshPhysicalMaterial({
      color: 0x1d1612,
      roughness: 0.95,
      sheen: 1,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0x5a4636),
      normalMap: textures.bark.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.7 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3010, emissive: 0xff2200, emissiveIntensity: 6 });
    this.demons = [0, 1, 2].map((i) => new Demon(furMat, skinMat, eyeMat, i));
    this.offsets = [
      { back: 0, x: 0 },
      { back: 1.3, x: -1.2 },
      { back: 1.8, x: 1.25 },
    ];
    this.group = new THREE.Group();
    for (const d of this.demons) this.group.add(d.root);
    scene.add(this.group);

    this.trail = [];
    this.gap = 16;
    this.visible = false;
    this.group.visible = false;
    this._tmp = new THREE.Vector3();
  }

  reset() {
    this.trail.length = 0;
    this.gap = 2.5; // start right behind the runner, then fall back
  }

  record(pos, yaw) {
    const last = this.trail[this.trail.length - 1];
    if (last && last.pos.distanceToSquared(pos) < 0.04) return;
    this.trail.push({ pos: pos.clone().setY(Math.max(pos.y, 0)), yaw });
    if (this.trail.length > 400) this.trail.shift();
  }

  /** Point on the trail `dist` metres behind the newest sample. */
  sample(dist, out) {
    const tr = this.trail;
    if (!tr.length) return null;
    let acc = 0;
    for (let i = tr.length - 1; i > 0; i--) {
      const a = tr[i].pos;
      const b = tr[i - 1].pos;
      const seg = a.distanceTo(b);
      if (acc + seg >= dist) {
        const t = (dist - acc) / seg;
        out.pos.copy(a).lerp(b, t);
        out.yaw = tr[i].yaw;
        return out;
      }
      acc += seg;
    }
    out.pos.copy(tr[0].pos);
    out.yaw = tr[0].yaw;
    return out;
  }

  /**
   * @param closeness 0 = far behind (off-screen), 1 = right on the runner's heels
   */
  update(dt, speed, closeness, time, pouncing = false) {
    const target = pouncing ? 0.3 : THREE.MathUtils.lerp(15, 1.7, Math.pow(closeness, 0.7));
    this.gap = damp(this.gap, target, pouncing ? 5 : 3, dt);
    this.group.visible = this.visible && this.gap < 14;
    if (!this.group.visible) return;
    const s = { pos: this._tmp, yaw: 0 };
    this.demons.forEach((d, i) => {
      const o = this.offsets[i];
      if (!this.sample(this.gap + o.back, s)) return;
      const yaw = s.yaw;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const target = new THREE.Vector3(s.pos.x + rx * o.x, s.pos.y, s.pos.z + rz * o.x);
      if (d.root.position.lengthSq() === 0 || d.root.position.distanceTo(target) > 8) d.root.position.copy(target);
      else d.root.position.lerp(target, 1 - Math.exp(-12 * dt));
      let diff = yaw - d.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      d.root.rotation.y += diff * (1 - Math.exp(-10 * dt));
      d.animate(dt, speed, time);
    });
  }
}
