import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './Textures.js';

/** Shared uniforms for animated materials (wind, flames). */
export const sharedUniforms = { uTime: { value: 0 } };

/** Adds a gentle wind sway to a standard material (used by foliage). */
function addWind(material, strength = 0.35, heightScale = 0.05) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float sway = sin(uTime * 1.3 + wp.x * 0.15 + wp.z * 0.1) * 0.6 + sin(uTime * 2.7 + wp.z * 0.3) * 0.25;
          float h = clamp(abs(position.y) * ${heightScale.toFixed(3)}, 0.0, 1.0);
          transformed.x += sway * ${strength.toFixed(2)} * h;
          transformed.z += sway * ${(strength * 0.6).toFixed(2)} * h;
        }`
      );
  };
  return material;
}

/** Tapered, slightly bent trunk + canopy of crossed leaf cards. */
function buildTreeGeometries(seed, { height = 38, canopy = 9, cards = 16 } = {}) {
  const rnd = mulberry32(seed);
  const trunk = new THREE.CylinderGeometry(0.45, 1.1, height, 9, 10, true);
  trunk.translate(0, height / 2, 0);
  const pos = trunk.attributes.position;
  const bendA = rnd() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / height;
    const bend = Math.sin(t * Math.PI * 0.9) * 1.6;
    pos.setX(i, pos.getX(i) + Math.cos(bendA) * bend);
    pos.setZ(i, pos.getZ(i) + Math.sin(bendA) * bend);
  }
  // Stretch the UVs so bark doesn't look smeared along a tall trunk.
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * (height / 6));
  trunk.computeVertexNormals();

  // A few branches reaching into the canopy
  const branches = [];
  for (let b = 0; b < 4; b++) {
    const len = canopy * (0.6 + rnd() * 0.4);
    const br = new THREE.CylinderGeometry(0.12, 0.35, len, 6, 1, true);
    br.translate(0, len / 2, 0);
    br.rotateZ(0.7 + rnd() * 0.5);
    br.rotateY((b / 4) * Math.PI * 2 + rnd());
    br.translate(Math.cos(bendA) * 1.2, height * (0.72 + rnd() * 0.15), Math.sin(bendA) * 1.2);
    branches.push(br);
  }
  const trunkGeo = mergeGeometries([trunk, ...branches]);

  const leafParts = [];
  const top = new THREE.Vector3(Math.cos(bendA) * 1.2, height * 0.92, Math.sin(bendA) * 1.2);
  for (let i = 0; i < cards; i++) {
    const s = canopy * (0.45 + rnd() * 0.45);
    const card = new THREE.PlaneGeometry(s, s * 0.8);
    card.rotateX(-Math.PI / 2 + (rnd() - 0.5) * 1.3);
    card.rotateY(rnd() * Math.PI);
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * canopy * 0.8;
    card.translate(top.x + Math.cos(a) * r, top.y + (rnd() - 0.4) * canopy * 0.55, top.z + Math.sin(a) * r);
    leafParts.push(card);
  }
  const leafGeo = mergeGeometries(leafParts);
  // Bake a simple canopy ambient-occlusion into vertex colours: darker inside/below.
  const lp = leafGeo.attributes.position;
  const colors = new Float32Array(lp.count * 3);
  for (let i = 0; i < lp.count; i++) {
    const dy = (lp.getY(i) - top.y) / canopy;
    const dx = lp.getX(i) - top.x;
    const dz = lp.getZ(i) - top.z;
    const radial = Math.min(1, Math.hypot(dx, dz) / canopy);
    const ao = THREE.MathUtils.clamp(0.45 + dy * 0.45 + radial * 0.35, 0.3, 1.15);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
  }
  leafGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return { trunkGeo, leafGeo };
}

/** Classical column profile turned on a lathe. */
function columnGeometry(height = 4.2) {
  const pts = [];
  const p = (r, y) => pts.push(new THREE.Vector2(r, y));
  p(0.0, 0);
  p(0.62, 0);
  p(0.62, 0.22);
  p(0.52, 0.3);
  p(0.5, 0.42);
  p(0.42, 0.5);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    p(0.42 - t * 0.06 + Math.sin(t * Math.PI) * 0.02, 0.5 + t * (height - 1.1));
  }
  p(0.46, height - 0.55);
  p(0.55, height - 0.4);
  p(0.66, height - 0.25);
  p(0.66, height);
  p(0.0, height);
  const g = new THREE.LatheGeometry(pts, 16);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  return g;
}

function flameMaterial(glowTex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: sharedUniforms.uTime, uMap: { value: glowTex } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      varying float vLife;
      void main() {
        float life = fract(uTime * (0.9 + aSeed * 0.6) + aSeed * 7.0);
        vLife = life;
        vec3 p = position;
        p.y += life * (1.6 + aSeed * 0.8);
        p.x += sin(uTime * 6.0 + aSeed * 30.0) * 0.08 * life;
        p.z += cos(uTime * 5.0 + aSeed * 20.0) * 0.08 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.0 - life * 0.6) * 260.0 / -mv.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vLife;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        vec3 hot = vec3(1.0, 0.85, 0.45);
        vec3 cool = vec3(1.0, 0.25, 0.03);
        vec3 c = mix(hot, cool, smoothstep(0.0, 0.7, vLife));
        float fade = (1.0 - vLife) * smoothstep(0.0, 0.08, vLife);
        gl_FragColor = vec4(c * 2.2, a * fade);
      }
    `,
  });
}

export function flameGeometry(count, spreadX, spreadZ, seed = 1) {
  const rnd = mulberry32(seed);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd() - 0.5) * spreadX;
    pos[i * 3 + 1] = rnd() * 0.15;
    pos[i * 3 + 2] = (rnd() - 0.5) * spreadZ;
    seeds[i] = rnd();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return g;
}

/**
 * Every geometry and material the track uses, created once and shared by all
 * segments.
 */
export class TrackAssets {
  constructor(textures, quality) {
    const T = textures;
    this.textures = T;
    this.quality = quality;

    // ---------- Materials ----------
    this.mat = {
      slab: new THREE.MeshStandardMaterial({ ...T.path, roughness: 1, metalness: 0, color: 0xffffff }),
      wall: new THREE.MeshStandardMaterial({ ...T.wall, roughness: 1, color: 0xe6ddd0 }),
      pillar: new THREE.MeshStandardMaterial({ ...T.pillar, roughness: 1, color: 0xd9cfbf }),
      support: new THREE.MeshStandardMaterial({ ...T.wall, roughness: 1, color: 0xa39a8c }),
      bark: new THREE.MeshStandardMaterial({ ...T.bark, roughness: 0.95, color: 0xbfae98 }),
      leaves: addWind(
        new THREE.MeshStandardMaterial({
          map: T.leaves,
          alphaTest: 0.42,
          side: THREE.DoubleSide,
          roughness: 0.75,
          vertexColors: true,
          color: 0xd0e0b0,
        })
      ),
      vine: addWind(
        new THREE.MeshStandardMaterial({
          map: T.leavesDry,
          alphaTest: 0.4,
          side: THREE.DoubleSide,
          roughness: 0.8,
          color: 0xc8d8a0,
        }),
        0.25,
        0.3
      ),
      iron: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6, metalness: 0.85 }),
      ember: new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff5a10, emissiveIntensity: 2.5 }),
      flame: flameMaterial(T.glow),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.22, emissive: 0x4a2c00, emissiveIntensity: 0.6 }),
    };
    for (const k of ['slab', 'wall', 'pillar', 'support']) {
      // Keep texture detail crisp at grazing angles
      const m = this.mat[k];
      m.normalScale = new THREE.Vector2(1.2, 1.2);
    }

    // ---------- Geometries ----------
    this.geo = {
      slab: new RoundedBoxGeometry(1.3, 0.4, 1.98, 2, 0.07),
      curb: new RoundedBoxGeometry(0.7, 0.7, 1.96, 2, 0.08),
      support: new THREE.BoxGeometry(1, 1, 1),
      column: columnGeometry(4.2),
      bigColumn: new THREE.CylinderGeometry(1.1, 1.5, 1, 12, 1),
      lintel: new RoundedBoxGeometry(1, 0.8, 1.1, 2, 0.08),
      log: new THREE.CylinderGeometry(0.42, 0.46, 1, 14, 1),
      rubble: new THREE.IcosahedronGeometry(0.5, 2),
      block: new RoundedBoxGeometry(1.3, 2.4, 1.3, 3, 0.12),
      grate: new THREE.BoxGeometry(1.4, 0.08, 1.4),
      coin: new THREE.CylinderGeometry(0.34, 0.34, 0.07, 28),
    };
    // Rough up the rubble so it looks like broken stone
    this.geo.rubble.deleteAttribute('normal');
    this.geo.rubble.deleteAttribute('uv');
    this.geo.rubble = mergeVertices(this.geo.rubble);
    const rp = this.geo.rubble.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < rp.count; i++) {
      v.fromBufferAttribute(rp, i);
      // Chunky, faceted-but-smooth broken stone
      const n = Math.sin(v.x * 7.1) * Math.sin(v.y * 6.3 + 1) * Math.sin(v.z * 5.7 + 2);
      const f = 0.85 + n * 0.25 + Math.max(0, v.y) * -0.3;
      rp.setXYZ(i, v.x * f, v.y * f * 0.75, v.z * f);
    }
    this.geo.rubble.computeVertexNormals();
    // Planar UVs so the rock texture maps onto it
    const ruv = new Float32Array(rp.count * 2);
    for (let i = 0; i < rp.count; i++) {
      ruv[i * 2] = rp.getX(i) + rp.getZ(i) * 0.5;
      ruv[i * 2 + 1] = rp.getY(i) + rp.getZ(i) * 0.5;
    }
    this.geo.rubble.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
    this.geo.coin.rotateX(Math.PI / 2);
    this.geo.log.rotateZ(Math.PI / 2);

    // Scale the support box UVs so masonry isn't stretched.
    this.trees = [
      buildTreeGeometries(12, { height: 42, canopy: 10, cards: 46 }),
      buildTreeGeometries(31, { height: 34, canopy: 8, cards: 36 }),
    ];

    // Hanging vine strip
    const vine = new THREE.PlaneGeometry(0.9, 3.2, 1, 6);
    vine.translate(0, -1.6, 0);
    this.geo.vine = vine;
  }
}
