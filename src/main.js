import './styles.css';
import * as THREE from 'three';
import { Engine } from './core/Engine.js';

const engine = new Engine(document.getElementById('game'));
engine.scene.background = new THREE.Color(0x87a5b8);
document.getElementById('loader').classList.remove('visible');

engine.renderer.setAnimationLoop(() => {
  engine.render(engine.clock.getDelta());
});
