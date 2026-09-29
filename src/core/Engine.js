import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GradeShader } from './GradeShader.js';

export const QUALITY = {
  high: { pixelRatio: 2, shadowMap: 4096, bloom: true, smaa: true, trees: 1, shadowSoft: true, fur: 16, ao: true },
  medium: { pixelRatio: 1.5, shadowMap: 2048, bloom: true, smaa: false, trees: 0.7, shadowSoft: true, fur: 10, ao: false },
  low: { pixelRatio: 1, shadowMap: 1024, bloom: false, smaa: false, trees: 0.4, shadowSoft: false, fur: 0, ao: false },
};

/**
 * Owns the WebGL renderer, the main scene/camera and the post-processing chain.
 */
export class Engine {
  constructor(canvas, qualityName = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.time = 0;
    this.shake = 0;

    this.setQuality(qualityName);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'high';
    this.quality = QUALITY[this.qualityName];
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) this.composer.dispose();
    const q = this.quality;
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: q.smaa ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (q.bloom) {
      this.bloom = new UnrealBloomPass(size, 0.28, 0.55, 1.0);
      this.composer.addPass(this.bloom);
    } else {
      this.bloom = null;
    }

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    if (q.smaa) this.composer.addPass(new SMAAPass());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Widen the field of view a little on portrait screens so lanes stay visible.
    this.camera.fov = w < h ? 75 : 62;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  render(dt) {
    this.time += dt;
    this.grade.uniforms.uTime.value = this.time;
    this.composer.render(dt);
  }
}
