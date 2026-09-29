import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mulberry32 } from './Textures.js';

const FOG_COLOR = new THREE.Color(0x9daab0);

/** Sky whose HDR output is scaled into a range that plays well with bloom. */
function makeSky(brightness = 0.36) {
  const sky = new Sky();
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    `gl_FragColor = vec4( min( texColor * ${brightness.toFixed(3)}, vec3( 2.6 ) ), 1.0 );`
  );
  return sky;
}

/**
 * Sky, sun, image based lighting, fog, distant mountains, the jungle far
 * below the walkway and drifting mist. Things that should feel "infinitely
 * far away" follow the player on the XZ plane.
 */
export class Environment {
  constructor(engine, textures) {
    this.engine = engine;
    this.scene = engine.scene;
    this.textures = textures;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.sunDir = new THREE.Vector3();
    this.buildSky();
    this.buildLights();
    this.buildFog();
    this.buildMountains();
    this.buildJungleFloor();
    this.buildMist();
    this.buildDust();
  }

  buildSky() {
    const sky = makeSky();
    sky.scale.setScalar(800);
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = 4.2;
    u.rayleigh.value = 1.25;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.86;
    u.cloudCoverage.value = 0.42;
    u.cloudDensity.value = 0.55;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00022;

    // Golden-hour sun, low over the jungle
    const elevation = 19;
    const azimuth = 140;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.engine.sunDir.copy(this.sunDir);
    this.sky = sky;
    this.scene.add(sky);

    // Image based lighting from the sky itself
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky();
    envSky.scale.setScalar(100);
    envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity', 'cloudElevation', 'cloudScale']) {
      envSky.material.uniforms[k].value = u[k].value;
    }
    envScene.add(envSky);
    // A dim ground hemisphere so reflections below the horizon aren't sky-blue
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2c3320, side: THREE.BackSide })
    );
    envScene.add(ground);
    const env = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  buildLights() {
    const sun = new THREE.DirectionalLight(0xffd6a0, 3.6);
    sun.castShadow = true;
    const size = this.engine.quality.shadowMap;
    sun.shadow.mapSize.set(size, size);
    const s = 26;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 160 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a3222, 0.5);
    this.scene.add(this.hemi);

    // Warm fill from the opposite side to lift the shadows a touch
    const fill = new THREE.DirectionalLight(0x8fa6c4, 0.35);
    fill.position.set(-this.sunDir.x, 0.6, -this.sunDir.z).multiplyScalar(50);
    this.fill = fill;
    this.scene.add(fill, fill.target);
  }

  buildFog() {
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0019);
  }

  buildMountains() {
    // A ring of ridged, noise-displaced mountains around the horizon.
    const rnd = mulberry32(99);
    const perm = Array.from({ length: 512 }, () => rnd());
    const hash = (i, j) => perm[((i * 73856093) ^ (j * 19349663)) & 511];
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const ridged = (x, y) => {
      let sum = 0, amp = 0.6, f = 1;
      for (let o = 0; o < 5; o++) {
        const n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
        sum += Math.pow(n, 1.6) * amp;
        amp *= 0.45;
        f *= 2.0;
      }
      return sum;
    };

    const seg = 480;
    const rings = 48;
    const rMin = 330;
    const rMax = 760;
    const positions = [];
    const colors = [];
    const indices = [];
    const low = new THREE.Color(0x3d4a2c);
    const mid = new THREE.Color(0x59604f);
    const high = new THREE.Color(0x8a8a82);
    const col = new THREE.Color();
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = rMin + (rMax - rMin) * t;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        // sample noise on a circle so the ring wraps seamlessly
        const nx = Math.cos(a) * 4 + t * 2.2;
        const ny = Math.sin(a) * 4 + t * 2.2;
        const profile = Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.85 + 0.15;
        const h = ridged(nx, ny) * profile * 230 - 85;
        positions.push(Math.cos(a) * r, h, Math.sin(a) * r);
        const k = THREE.MathUtils.clamp((h + 60) / 220, 0, 1);
        if (k < 0.5) col.copy(low).lerp(mid, k * 2);
        else col.copy(mid).lerp(high, (k - 0.5) * 2);
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i;
        const b = a + seg + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const mountains = new THREE.Mesh(geo, mat);
    mountains.frustumCulled = false;
    this.mountains = mountains;
    this.group.add(mountains);
  }

  buildJungleFloor() {
    const tex = this.textures.ground.clone();
    tex.repeat.set(60, 60);
    tex.needsUpdate = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: 0x9aa58a })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -75;
    this.floorTex = tex;
    this.floor = floor;
    this.group.add(floor);
  }

  buildMist() {
    // Animated noise mist hanging in the chasm below the walkway.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uOffset: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0xc9d0cc) } },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec2 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
        void main() {
          vec2 p = vWorld * 0.018;
          float n = fbm(p + vec2(uTime * 0.02, uTime * 0.013));
          n = smoothstep(0.45, 0.95, n + fbm(p * 2.3 - uTime * 0.015) * 0.35);
          gl_FragColor = vec4(uColor, n * 0.16);
          #include <fog_fragment>
        }
      `,
    });
    this.mistLayers = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = -22 - i * 10;
      m.renderOrder = -1;
      this.mistLayers.push(m);
      this.group.add(m);
    }
    this.mistMat = mat;
  }

  buildDust() {
    // Sunlit dust motes floating around the runner.
    const count = 260;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rnd = mulberry32(5);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 40;
      pos[i * 3 + 1] = rnd() * 10 - 1;
      pos[i * 3 + 2] = (rnd() - 0.5) * 40;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09,
      map: this.textures.glow,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      color: 0xffe2a8,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** Keep far-away things centred on the player and move the shadow camera. */
  update(dt, focus) {
    const t = this.engine.time;
    this.sky.position.copy(this.engine.camera.position);
    this.mountains.position.set(focus.x, 0, focus.z);

    this.floor.position.x = focus.x;
    this.floor.position.z = focus.z;
    this.floorTex.offset.set(focus.x / (1600 / 60), -focus.z / (1600 / 60));

    for (const m of this.mistLayers) m.position.set(focus.x, m.position.y, focus.z);
    this.mistMat.uniforms.uTime.value = t;
    this.sky.material.uniforms.time.value = t;

    this.dust.position.set(focus.x, focus.y, focus.z);
    this.dust.rotation.y = t * 0.02;

    // Shadow camera follows the runner, snapped to texels to avoid shimmering.
    const texel = (26 * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 80, this.sunDir.y * 80 + 20, fz + this.sunDir.z * 80);
    this.fill.position.set(fx - this.sunDir.x * 50, 30, fz - this.sunDir.z * 50);
    this.fill.target.position.set(fx, 0, fz);
  }
}
