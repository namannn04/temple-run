import * as THREE from 'three';

/**
 * A single pooled GPU point system for short-lived effects: dust puffs,
 * coin sparkles and stone debris. Particles are simulated on the CPU (only
 * a few hundred) and drawn in one call.
 */
export class Particles {
  constructor(scene, glowTex, max = 600) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    const makeMat = (blending) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending,
        uniforms: { uMap: { value: glowTex }, uScale: { value: 300 } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aAlpha;
          varying vec3 vColor;
          varying float vAlpha;
          uniform float uScale;
          void main() {
            vColor = color;
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * uScale / -mv.z;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor, a);
          }
        `,
        vertexColors: true,
      });

    // Two layers: soft normal-blended dust and additive sparks
    this.dust = new THREE.Points(this.geo, makeMat(THREE.NormalBlending));
    this.sparkGeo = this.geo.clone();
    this.sparks = new THREE.Points(this.sparkGeo, makeMat(THREE.AdditiveBlending));
    this.dust.frustumCulled = this.sparks.frustumCulled = false;
    scene.add(this.dust, this.sparks);

    this.pools = {
      dust: { geo: this.geo, items: [] },
      spark: { geo: this.sparkGeo, items: [] },
    };
  }

  emit(kind, origin, { count = 10, color = 0xffffff, speed = 2, up = 1, size = 0.4, life = 0.8, gravity = -2, spread = 0.3 } = {}) {
    const pool = this.pools[kind];
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (pool.items.length >= this.max) pool.items.shift();
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      pool.items.push({
        p: new THREE.Vector3(origin.x + Math.cos(a) * spread * r, origin.y, origin.z + Math.sin(a) * spread * r),
        v: new THREE.Vector3(Math.cos(a) * speed * (0.3 + r), up * (0.5 + Math.random()), Math.sin(a) * speed * (0.3 + r)),
        c: c.clone().multiplyScalar(0.8 + Math.random() * 0.4),
        size: size * (0.6 + Math.random() * 0.8),
        life,
        t: 0,
        gravity,
      });
    }
  }

  update(dt) {
    for (const key of Object.keys(this.pools)) {
      const pool = this.pools[key];
      const geo = pool.geo;
      const pos = geo.attributes.position.array;
      const col = geo.attributes.color.array;
      const size = geo.attributes.aSize.array;
      const alpha = geo.attributes.aAlpha.array;
      let n = 0;
      pool.items = pool.items.filter((it) => (it.t += dt) < it.life);
      for (const it of pool.items) {
        it.v.y += it.gravity * dt;
        it.v.multiplyScalar(1 - dt * 1.5);
        it.p.addScaledVector(it.v, dt);
        const k = it.t / it.life;
        pos[n * 3] = it.p.x;
        pos[n * 3 + 1] = it.p.y;
        pos[n * 3 + 2] = it.p.z;
        col[n * 3] = it.c.r;
        col[n * 3 + 1] = it.c.g;
        col[n * 3 + 2] = it.c.b;
        size[n] = it.size * (key === 'dust' ? 1 + k * 1.5 : 1 - k * 0.5);
        alpha[n] = (key === 'dust' ? 0.45 : 1) * (1 - k) * Math.min(1, it.t * 20);
        n++;
      }
      geo.setDrawRange(0, n);
      for (const a of ['position', 'color', 'aSize', 'aAlpha']) geo.attributes[a].needsUpdate = true;
    }
  }

  clear() {
    for (const pool of Object.values(this.pools)) pool.items.length = 0;
  }
}
