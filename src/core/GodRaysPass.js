import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const quadVS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SKY_MASK = /* glsl */ `
  float skyMask(sampler2D depth, vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return step(0.99999, texture2D(depth, uv).x);
  }
`;

/**
 * Screen-space crepuscular rays + a subtle lens flare.
 *
 * Bright sky pixels (depth == 1) are extracted at quarter resolution and
 * radially blurred toward the sun, so columns, trees and leaves cut real
 * shafts of light out of the haze. A 1x1 pass measures how much of the sun
 * disc is visible, which drives the flare ghosts and halo.
 */
export class GodRaysPass extends Pass {
  constructor(camera, sunDir, { samples = 48 } = {}) {
    super();
    this.camera = camera;
    this.sunDir = sunDir;
    this.needsSwap = true;
    this.strength = 1;
    this.intensity = 0;

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtMask = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtRays = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtVis = new THREE.WebGLRenderTarget(1, 1, rtOpts);

    const sun = { value: new THREE.Vector2(0.5, 0.5) };
    this.sunUniform = sun;

    // 1) Bright, unoccluded sky only
    this.maskMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null } },
      vertexShader: quadVS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        varying vec2 vUv;
        ${SKY_MASK}
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float bright = clamp(dot(c, vec3(0.3, 0.5, 0.2)) - 1.4, 0.0, 2.5);
          gl_FragColor = vec4(vec3(bright * skyMask(tDepth, vUv)), 1.0);
        }
      `,
    });

    // 2) Radial blur toward the sun
    this.raysMat = new THREE.ShaderMaterial({
      defines: { SAMPLES: samples },
      uniforms: { tMask: { value: null }, uSun: sun },
      vertexShader: quadVS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMask;
        uniform vec2 uSun;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 delta = (vUv - uSun) * (0.95 / float(SAMPLES));
          vec2 uv = vUv - delta * hash(vUv * 731.0);
          float illum = 1.0;
          float acc = 0.0;
          for (int i = 0; i < SAMPLES; i++) {
            uv -= delta;
            acc += texture2D(tMask, uv).r * illum;
            illum *= 0.965;
          }
          gl_FragColor = vec4(vec3(acc / float(SAMPLES)), 1.0);
        }
      `,
    });

    // 3) Sun visibility, evaluated once into a single pixel
    this.visMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uSun: sun },
      vertexShader: quadVS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform vec2 uSun;
        ${SKY_MASK}
        void main() {
          float vis = 0.0;
          for (int x = -3; x <= 3; x++)
            for (int y = -3; y <= 3; y++)
              vis += skyMask(tDepth, uSun + vec2(float(x), float(y)) * 0.009);
          gl_FragColor = vec4(vec3(vis / 49.0), 1.0);
        }
      `,
    });

    // 4) Composite rays + flare over the scene
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tRays: { value: this.rtRays.texture },
        tVis: { value: this.rtVis.texture },
        uSun: sun,
        uAspect: { value: 1 },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
      },
      vertexShader: quadVS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tRays;
        uniform sampler2D tVis;
        uniform vec2 uSun;
        uniform float uAspect;
        uniform float uIntensity;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          vec2 toSun = (vUv - uSun) * vec2(uAspect, 1.0);
          float fall = exp(-dot(toSun, toSun) * 1.6);
          color += uColor * min(texture2D(tRays, vUv).r, 1.2) * uIntensity * 0.45 * (0.05 + fall);

          float vis = texture2D(tVis, vec2(0.5)).r;
          vec2 axis = vec2(0.5) - uSun;
          vec3 fc = vec3(0.0);
          for (int g = 1; g <= 4; g++) {
            vec2 gp = uSun + axis * float(g) * 0.5;
            float r = 0.02 + float(g) * 0.018;
            float dd = length((vUv - gp) * vec2(uAspect, 1.0));
            fc += smoothstep(r, r * 0.6, dd) * (0.35 / float(g)) * mix(vec3(1.0, 0.7, 0.4), vec3(0.5, 0.8, 1.0), float(g) / 4.0);
          }
          float halo = exp(-dot(toSun, toSun) * 30.0) * 0.25;
          color += (fc * 0.35 + uColor * halo) * vis * uIntensity;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.quad = new FullScreenQuad(this.maskMat);
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width / 4));
    const h = Math.max(1, Math.round(height / 4));
    this.rtMask.setSize(w, h);
    this.rtRays.setSize(w, h);
  }

  draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    // Sun position in screen space; fade the effect as the sun leaves view
    const cam = this.camera;
    const p = this._v.copy(this.sunDir).multiplyScalar(400).add(cam.position).project(cam);
    const facing = this.sunDir.dot(cam.getWorldDirection(this._dir));
    this.sunUniform.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(p.x), Math.abs(p.y));
    const target = facing > 0 ? THREE.MathUtils.clamp(2.3 - off, 0, 1) * THREE.MathUtils.smoothstep(facing, 0, 0.35) : 0;
    this.intensity += (target * this.strength - this.intensity) * 0.1;

    const comp = this.compMat.uniforms;
    comp.tDiffuse.value = readBuffer.texture;
    comp.uAspect.value = cam.aspect;
    comp.uIntensity.value = this.intensity;

    if (this.intensity > 0.002) {
      this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.maskMat.uniforms.tDepth.value = readBuffer.depthTexture;
      this.visMat.uniforms.tDepth.value = readBuffer.depthTexture;
      this.draw(renderer, this.maskMat, this.rtMask);
      this.raysMat.uniforms.tMask.value = this.rtMask.texture;
      this.draw(renderer, this.raysMat, this.rtRays);
      this.draw(renderer, this.visMat, this.rtVis);
    }
    this.draw(renderer, this.compMat, this.renderToScreen ? null : writeBuffer);
  }

  dispose() {
    for (const m of [this.maskMat, this.raysMat, this.visMat, this.compMat]) m.dispose();
    for (const rt of [this.rtMask, this.rtRays, this.rtVis]) rt.dispose();
    this.quad.dispose();
  }
}
