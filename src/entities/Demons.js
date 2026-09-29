import * as THREE from 'three';

const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

// ---------------------------------------------------------------------------
// Shell-fur material: the same geometry is drawn N times, each shell pushed a
// little further along the normal, with strands carved out by a hash pattern.
// ---------------------------------------------------------------------------
function makeFurMaterial({ color, tip, length, density }) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFurLen = { value: length };
    shader.uniforms.uDensity = { value: density };
    shader.uniforms.uTip = { value: new THREE.Color(tip) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aLayer;
        uniform float uFurLen;
        varying float vLayer;
        varying vec2 vFurUv;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLayer = aLayer;
        vFurUv = uv;
        // Fur length in world units regardless of how each part is scaled
        vec3 furScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        vec3 furOffset = normalize(objectNormal) * aLayer * uFurLen;
        furOffset.y -= aLayer * aLayer * uFurLen * 0.35; // strands droop under gravity
        transformed += furOffset / furScale;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDensity;
        uniform vec3 uTip;
        varying float vLayer;
        varying vec2 vFurUv;
        float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 fuv = vFurUv * vec2(uDensity * 2.0, uDensity);
        vec2 cell = floor(fuv);
        float h = furHash(cell);
        // jitter each strand inside its cell so no grid pattern shows
        vec2 jitter = vec2(furHash(cell + 17.3), furHash(cell + 41.7)) - 0.5;
        vec2 f = fract(fuv) - 0.5 - jitter * 0.35;
        // each strand is a cone: thinner the further out the shell is
        float radius = (1.0 - vLayer / max(h, 0.05)) * 0.55;
        if (vLayer > 0.0 && (h < vLayer || length(f) > radius)) discard;
        float ao = mix(0.28, 1.0, smoothstep(0.0, 1.0, vLayer));
        diffuseColor.rgb = mix(diffuseColor.rgb * ao, uTip, smoothstep(0.55, 1.0, vLayer) * 0.6);`
      );
  };
  mat.customProgramCacheKey = () => 'fur-' + length + '-' + density;
  return mat;
}

/** Tapered horn: a tube along a curve, pinched toward the tip. */
function hornGeometry(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(side * 0.08, 0.1, 0.06),
    new THREE.Vector3(side * 0.12, 0.2, 0.18),
    new THREE.Vector3(side * 0.09, 0.26, 0.32),
  ]);
  const tub = 12;
  const rad = 8;
  const g = new THREE.TubeGeometry(curve, tub, 0.045, rad, false);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= tub; i++) {
    const t = i / tub;
    curve.getPointAt(t, c);
    for (let j = 0; j <= rad; j++) {
      const idx = i * (rad + 1) + j;
      v.fromBufferAttribute(pos, idx);
      v.sub(c).multiplyScalar(1 - t * 0.9).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * One demon monkey: a hunched, muscular, furry body with horns, fangs,
 * claws and glowing eyes, animated with a procedural bounding gallop.
 */
class Demon {
  constructor(kit, seed) {
    this.kit = kit;
    this.seed = seed;
    this.phase = seed * 2.1;
    this.roarT = 2 + seed * 1.7;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    // --- Pelvis & hind legs
    this.pelvis = new THREE.Group();
    this.pelvis.position.set(0, 0.82, 0.38);
    this.body.add(this.pelvis);
    this.part(this.pelvis, 'sphere', [0, 0.02, 0.02], [0.36, 0.33, 0.38]);

    // --- Spine & chest, hunched forward
    this.chest = new THREE.Group();
    this.chest.position.set(0, 0.2, -0.42);
    this.pelvis.add(this.chest);
    this.part(this.pelvis, 'sphere', [0, 0.12, -0.24], [0.34, 0.33, 0.44], [-0.3, 0, 0]); // belly
    this.part(this.chest, 'sphere', [0, 0.08, -0.08], [0.47, 0.42, 0.42]); // chest
    this.part(this.chest, 'sphere', [0, 0.28, 0.06], [0.44, 0.2, 0.34], [0.3, 0, 0]); // hunched back
    // Spine ridges
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(kit.geo.spike, kit.mat.horn);
      const t = i / 5;
      spike.position.set(0, 0.46 - t * 0.12, 0.05 + t * 0.55);
      spike.rotation.x = -0.5 + t * 0.4;
      spike.scale.setScalar(1 - t * 0.5);
      this.chest.add(spike);
    }

    // --- Neck & head
    this.head = new THREE.Group();
    this.head.position.set(0, 0.27, -0.5);
    this.head.scale.setScalar(1.35);
    this.chest.add(this.head);
    this.part(this.head, 'sphere', [0, 0.04, 0], [0.26, 0.24, 0.27]); // skull fur
    const face = this.skin(this.head, kit.geo.sphere, [0, -0.02, -0.16], [0.2, 0.17, 0.14]);
    face.castShadow = false;
    this.skin(this.head, kit.geo.sphere, [0, -0.08, -0.29], [0.13, 0.09, 0.11]); // muzzle
    this.skin(this.head, kit.geo.sphere, [0, 0.07, -0.21], [0.2, 0.06, 0.08]); // heavy brow
    for (const s of [-1, 1]) {
      this.skin(this.head, kit.geo.sphere, [s * 0.05, -0.07, -0.39], [0.025, 0.02, 0.02], kit.mat.nostril);
    }
    // Jaw with fangs
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.12, -0.14);
    this.head.add(this.jaw);
    this.skin(this.jaw, kit.geo.sphere, [0, -0.02, -0.12], [0.12, 0.05, 0.13]);
    const mouth = new THREE.Mesh(kit.geo.sphere, kit.mat.mouth);
    mouth.position.set(0, 0.02, -0.14);
    mouth.scale.set(0.1, 0.03, 0.11);
    this.jaw.add(mouth);
    for (const s of [-1, 1]) {
      const upper = new THREE.Mesh(kit.geo.fang, kit.mat.tooth);
      upper.position.set(s * 0.055, -0.1, -0.33);
      upper.rotation.x = Math.PI;
      this.head.add(upper);
      const lower = new THREE.Mesh(kit.geo.fang, kit.mat.tooth);
      lower.position.set(s * 0.05, 0.03, -0.22);
      lower.scale.setScalar(0.7);
      this.jaw.add(lower);
    }
    // Eyes: emissive cores with a bloom-friendly glow halo
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(kit.geo.sphere, kit.mat.eye);
      eye.position.set(s * 0.085, 0.02, -0.265);
      eye.scale.setScalar(0.034);
      this.head.add(eye);
      const glow = new THREE.Sprite(kit.mat.eyeGlow);
      glow.position.copy(eye.position).z -= 0.02;
      glow.scale.setScalar(0.22);
      this.head.add(glow);
      // Horns and ears
      const horn = new THREE.Mesh(kit.geo.horn[s > 0 ? 1 : 0], kit.mat.horn);
      horn.position.set(s * 0.13, 0.15, -0.05);
      horn.castShadow = true;
      this.head.add(horn);
      this.skin(this.head, kit.geo.sphere, [s * 0.24, 0.04, 0.02], [0.03, 0.08, 0.06], kit.mat.skin, [0, 0, s * 0.5]);
    }

    // --- Long, muscular arms used for knuckle galloping
    this.arms = [];
    this.legs = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.42, 0.12, -0.12);
      this.chest.add(shoulder);
      this.part(shoulder, 'sphere', [0, -0.02, 0], [0.19, 0.2, 0.19]); // deltoid
      this.part(shoulder, 'limb', [0, -0.24, 0], [1.25, 0.95, 1.25]); // upper arm
      const elbow = new THREE.Group();
      elbow.position.y = -0.5;
      shoulder.add(elbow);
      this.part(elbow, 'limb', [0, -0.22, 0], [1.0, 0.9, 1.0]); // forearm
      const hand = new THREE.Group();
      hand.position.y = -0.46;
      elbow.add(hand);
      this.skin(hand, kit.geo.sphere, [0, -0.02, -0.04], [0.1, 0.06, 0.13]);
      this.claws(hand, -0.16);
      shoulder.userData = { elbow, hand };
      this.arms.push(shoulder);

      // Hind legs: thigh -> shin -> foot
      const hip = new THREE.Group();
      hip.position.set(s * 0.26, -0.02, 0.05);
      this.pelvis.add(hip);
      this.part(hip, 'limb', [0, -0.18, 0], [1.35, 0.75, 1.35]);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      this.part(knee, 'limb', [0, -0.17, 0], [0.95, 0.7, 0.95]);
      const foot = new THREE.Group();
      foot.position.y = -0.36;
      knee.add(foot);
      this.skin(foot, kit.geo.sphere, [0, -0.02, -0.07], [0.09, 0.05, 0.15]);
      this.claws(foot, -0.2);
      hip.userData = { knee, foot };
      this.legs.push(hip);
    }

    // --- Curling tail made of a chain of segments
    this.tail = [];
    let parent = this.pelvis;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.12 : 0, i === 0 ? 0.34 : 0.17);
      parent.add(seg);
      this.part(seg, 'sphere', [0, 0, 0.08], [0.07 - i * 0.008, 0.07 - i * 0.008, 0.13]);
      this.tail.push(seg);
      parent = seg;
    }

    const s = 1.08 + (seed % 3) * 0.1;
    this.root.scale.setScalar(s);
  }

  /** Furry body part: solid base plus fur shells. */
  part(parent, geoName, pos, scale, rot = [0, 0, 0]) {
    const k = this.kit;
    const g = new THREE.Group();
    g.position.set(...pos);
    g.scale.set(...scale);
    g.rotation.set(...rot);
    const base = new THREE.Mesh(k.geo[geoName], k.mat.furBase);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    if (k.shells[geoName]) {
      const shells = new THREE.InstancedMesh(k.shells[geoName], k.mat.fur, k.layers);
      shells.frustumCulled = false;
      g.add(shells);
    }
    parent.add(g);
    return g;
  }

  skin(parent, geo, pos, scale, mat = this.kit.mat.skin, rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.rotation.set(...rot);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  claws(parent, z) {
    for (let i = -1; i <= 1; i++) {
      const c = new THREE.Mesh(this.kit.geo.claw, this.kit.mat.horn);
      c.position.set(i * 0.045, -0.04, z);
      c.rotation.x = -Math.PI / 2 - 0.4;
      parent.add(c);
    }
  }

  animate(dt, speed, t, pouncing) {
    const freq = 1.5 + speed * 0.13;
    this.phase += dt * freq * Math.PI * 2;
    const p = this.phase;
    const s = Math.sin(p);
    const c = Math.cos(p);

    // Rotary gallop: front pair then hind pair, slightly offset left/right
    const armSwing = 1.05;
    this.arms.forEach((a, i) => {
      const ph = p + i * 0.4;
      a.rotation.x = Math.sin(ph) * armSwing - 0.15;
      a.rotation.z = (i ? 1 : -1) * 0.12;
      a.userData.elbow.rotation.x = -Math.max(0, Math.cos(ph)) * 1.1 + 0.15;
      a.userData.hand.rotation.x = Math.max(0, -Math.sin(ph)) * 0.8;
    });
    this.legs.forEach((l, i) => {
      const ph = p + Math.PI + i * 0.4;
      l.rotation.x = Math.sin(ph) * 0.95 + 0.25;
      l.userData.knee.rotation.x = Math.max(0, Math.cos(ph)) * 1.3 + 0.1;
      l.userData.foot.rotation.x = -Math.max(0, Math.sin(ph)) * 0.6;
    });

    // Spine flexes and extends with each bound
    this.pelvis.rotation.x = s * 0.14;
    this.chest.rotation.x = -s * 0.2 + 0.1;
    this.body.position.y = Math.max(0, Math.sin(p * 1.0 + 0.6)) * 0.22;
    this.body.rotation.z = Math.sin(p * 0.5) * 0.04;

    // Head stays locked on the prey, with periodic roars
    this.roarT -= dt;
    let roar = 0;
    if (this.roarT < 0) {
      roar = Math.sin(Math.min(1, -this.roarT / 0.9) * Math.PI);
      if (this.roarT < -0.9) this.roarT = 2.5 + Math.random() * 3;
    }
    if (pouncing) roar = Math.max(roar, 0.8);
    this.head.rotation.x = -this.chest.rotation.x * 0.8 - c * 0.08 - roar * 0.35;
    this.jaw.rotation.x = 0.12 + roar * 0.55 + (Math.sin(t * 11 + this.seed) * 0.5 + 0.5) * 0.08;

    this.tail.forEach((seg, i) => {
      seg.rotation.x = -0.25 + Math.sin(p - i * 0.6) * 0.18;
      seg.rotation.y = Math.sin(p * 0.5 - i * 0.7) * 0.25;
    });
  }
}

/**
 * The pack of demons following the runner's exact trail.
 */
export class Demons {
  constructor(scene, textures, quality = { fur: 12 }) {
    this.scene = scene;
    const layers = quality.fur ?? 12;
    const sphere = new THREE.SphereGeometry(1, 28, 18);
    const limb = new THREE.CapsuleGeometry(0.1, 0.3, 6, 14);
    const makeShells = (geo) => {
      if (!layers) return null;
      const g = geo.clone();
      const la = new Float32Array(layers);
      for (let i = 0; i < layers; i++) la[i] = (i + 1) / layers;
      g.setAttribute('aLayer', new THREE.InstancedBufferAttribute(la, 1));
      return g;
    };

    const furColor = 0x33251b;
    this.kit = {
      layers,
      geo: {
        sphere,
        limb,
        spike: new THREE.ConeGeometry(0.035, 0.16, 6),
        fang: new THREE.ConeGeometry(0.014, 0.075, 6),
        claw: new THREE.ConeGeometry(0.016, 0.09, 6),
        horn: [hornGeometry(-1), hornGeometry(1)],
      },
      shells: { sphere: makeShells(sphere), limb: makeShells(limb) },
      mat: {
        furBase: new THREE.MeshStandardMaterial({
          color: new THREE.Color(furColor).multiplyScalar(0.55),
          roughness: 1,
          normalMap: textures.bark.normalMap,
          normalScale: new THREE.Vector2(0.4, 0.4),
        }),
        fur: makeFurMaterial({ color: furColor, tip: 0x7d5c42, length: 0.06, density: 52 }),
        skin: new THREE.MeshPhysicalMaterial({
          color: 0x3b2320,
          roughness: 0.55,
          clearcoat: 0.25,
          clearcoatRoughness: 0.6,
          normalMap: textures.bark.normalMap,
          normalScale: new THREE.Vector2(0.5, 0.5),
        }),
        nostril: new THREE.MeshStandardMaterial({ color: 0x0a0505, roughness: 1 }),
        mouth: new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0x5a0a04, emissiveIntensity: 0.6, roughness: 0.4 }),
        tooth: new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.35 }),
        horn: new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.45, metalness: 0.05 }),
        eye: new THREE.MeshStandardMaterial({ color: 0xff4a1a, emissive: 0xff2a00, emissiveIntensity: 9 }),
        eyeGlow: new THREE.SpriteMaterial({
          map: textures.glow,
          color: 0xff3a10,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      },
    };

    this.demons = [0, 1, 2].map((i) => new Demon(this.kit, i));
    this.offsets = [
      { back: 0, x: 0 },
      { back: 1.4, x: -1.25 },
      { back: 1.9, x: 1.3 },
    ];
    this.group = new THREE.Group();
    for (const d of this.demons) this.group.add(d.root);
    scene.add(this.group);

    this.trail = [];
    this.gap = 2.5;
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
      d.animate(dt, speed, time, pouncing);
    });
  }
}
