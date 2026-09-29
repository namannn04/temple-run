import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Engine } from './core/Engine.js';
import { createTextures } from './world/Textures.js';
import { Environment } from './world/Environment.js';
import { TrackAssets } from './world/TrackAssets.js';
import { Track, LANES } from './world/Track.js';
import { Forest } from './world/Forest.js';
import { Player } from './entities/Player.js';
import { CameraRig } from './systems/CameraRig.js';
import { Input } from './systems/Input.js';
import { UI } from './ui/UI.js';

const BASE_SPEED = 10.5;
const MAX_SPEED = 25;
const STORAGE_KEY = 'temple-run-best';

const store = {
  get(k, def) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ui = new UI();
    this.state = 'loading';
    this.best = store.get(STORAGE_KEY, 0);
    this.quality = store.get('temple-run-quality', window.devicePixelRatio > 2 && innerWidth < 900 ? 'medium' : 'high');
  }

  async init() {
    const ui = this.ui;
    ui.progress(0.05, 'Carving stone…');
    await nextFrame();

    this.engine = new Engine(this.canvas, this.quality);
    this.textures = createTextures();
    ui.progress(0.45, 'Growing the jungle…');
    await nextFrame();

    this.env = new Environment(this.engine, this.textures);
    this.assets = new TrackAssets(this.textures, this.engine.quality);
    this.track = new Track(this.engine.scene, this.assets);
    this.forest = new Forest(this.engine.scene, this.assets);
    ui.progress(0.6, 'Summoning the explorer…');

    const gltf = await new GLTFLoader().loadAsync('./models/Soldier.glb', (e) => {
      if (e.total) ui.progress(0.6 + (e.loaded / e.total) * 0.3);
    });
    this.player = new Player(this.engine.scene, gltf);
    this.rig = new CameraRig(this.engine.camera);
    this.input = new Input(window);
    this.bindInput();
    this.bindUI();

    ui.progress(0.95, 'Lighting the torches…');
    this.resetRun();
    // Compile shaders up front so the first frames don't hitch
    this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    await nextFrame();

    ui.progress(1);
    ui.setBest(this.best);
    ui.hideLoader();
    this.toMenu();

    this.engine.timer.reset?.();
    this.engine.renderer.setAnimationLoop(() => this.frame());
    window.game = this; // handy for debugging from the console
  }

  bindInput() {
    const inp = this.input;
    inp.on('left', () => this.state === 'playing' && this.player.left());
    inp.on('right', () => this.state === 'playing' && this.player.right());
    inp.on('jump', () => {
      if (this.state === 'playing') this.player.jump();
      else if (this.state === 'menu') this.startRun();
    });
    inp.on('tap', () => {
      if (this.state === 'playing') this.player.jump();
    });
    inp.on('slide', () => this.state === 'playing' && this.player.slide());
    inp.on('pause', () => {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    inp.on('confirm', () => {
      if (this.state === 'menu') this.startRun();
      else if (this.state === 'over') this.restart();
      else if (this.state === 'paused') this.resume();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  bindUI() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    on('play-btn', () => this.startRun());
    on('retry-btn', () => this.restart());
    on('menu-btn', () => this.toMenu(true));
    on('quit-btn', () => this.toMenu(true));
    on('resume-btn', () => this.resume());
    on('pause-btn', () => this.pause());
    const q = this.ui.el.quality;
    q.value = this.quality;
    q.addEventListener('change', () => {
      this.quality = q.value;
      store.set('temple-run-quality', q.value);
      this.engine.setQuality(q.value);
      this.env.sun.shadow.mapSize.setScalar(this.engine.quality.shadowMap);
      this.env.sun.shadow.map?.dispose();
      this.env.sun.shadow.map = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------------
  resetRun() {
    this.track.reset();
    this.player.reset(this.track.first);
    this.speed = BASE_SPEED;
    this.runTime = 0;
    this.distance = 0;
    this.score = 0;
    this.coins = 0;
    this.multiplier = 1;
    this.chaseGap = 1; // 1 = demons far behind, 0 = caught
    this.lastStumble = -99;
    this.powerups = {};
    this.shieldInvuln = 0;
    this.overTimer = 0;
    this.rig.mode = 'menu';
    this.rig.snap(this.player);
  }

  toMenu(reset = false) {
    if (reset) this.resetRun();
    this.state = 'menu';
    this.rig.mode = 'menu';
    this.ui.setBest(this.best);
    this.ui.show('menu');
    this.engine.grade.uniforms.uDanger.value = 0;
  }

  startRun() {
    if (this.state !== 'menu') return;
    this.state = 'playing';
    this.rig.mode = 'play';
    this.player.start();
    this.ui.show('hud');
    this.ui.toast('RUN!', 900);
  }

  restart() {
    this.resetRun();
    this.state = 'menu';
    this.startRun();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.show('hud');
  }

  gameOver(reason) {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.overTimer = 0;
    this.deathReason = reason;
    this.rig.addShake(0.8);
  }

  finishGameOver() {
    this.state = 'over';
    const isBest = this.score > this.best;
    if (isBest) {
      this.best = Math.floor(this.score);
      store.set(STORAGE_KEY, this.best);
    }
    this.ui.gameOver({
      score: this.score,
      distance: this.distance,
      coins: this.coins,
      best: this.best,
      isBest,
      reason: this.deathReason,
    });
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------
  frame() {
    const engine = this.engine;
    engine.timer.update();
    const dt = Math.min(engine.timer.getDelta(), 1 / 20);

    if (this.state !== 'paused') this.step(dt);
    engine.render(this.state === 'paused' ? 0 : dt);
  }

  step(dt) {
    const player = this.player;
    const playing = this.state === 'playing';
    const dying = this.state === 'dying';

    if (playing) {
      this.runTime += dt;
      const target = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * (1 - Math.exp(-this.runTime / 110));
      this.speed = THREE.MathUtils.lerp(this.speed, target, 1 - Math.exp(-dt));
    }

    const moveSpeed = playing ? this.speed : dying ? this.speed * 0.3 : 0;
    const events = player.update(dt, playing ? this.speed : moveSpeed, this.track);
    for (const e of events) this.onPlayerEvent(e);

    if (playing) {
      this.distance += this.speed * dt;
      this.multiplier = 1 + Math.floor(this.distance / 600);
      this.score += this.speed * dt * this.multiplier;
      this.checkCollisions();
      this.collectItems(dt);
      this.updatePowerups(dt);
      this.updateChase(dt);
      this.track.ensureAhead(player.seg, player.d);
      this.ui.hud(this);
    }

    if (dying) {
      this.overTimer += dt;
      if (this.overTimer > 1.6) this.finishGameOver();
    }

    this.track.update(dt);
    this.rig.baseFov = this.engine.camera.aspect < 1 ? 75 : 62;
    this.rig.update(dt, player, this.speed);
    this.env.update(dt, player.worldPos);
    this.forest.update(player.worldPos);
  }

  onPlayerEvent(e) {
    if (e.type === 'fall') this.gameOver('YOU FELL');
    else if (e.type === 'land') this.rig.addShake(0.05);
  }

  // ---------------------------------------------------------------------------
  // Collisions
  // ---------------------------------------------------------------------------
  checkCollisions() {
    const p = this.player;
    if (p.state !== 'run') return;
    const seg = p.seg;
    for (const o of seg.obstacles) {
      if (o.hit) continue;
      if (p.d < o.d0 - 0.35 || p.d > o.d1 + 0.35) continue;
      let hit = false;
      let glancing = false;
      switch (o.type) {
        case 'log':
          hit = p.y < o.top - 0.12;
          break;
        case 'arch':
          hit = p.y + p.height > o.bottom;
          break;
        case 'block':
        case 'fire':
          for (const l of o.lanes) {
            const dx = Math.abs(p.x - LANES[l]);
            if (dx < 0.62) hit = true;
            else if (dx < 1.0) glancing = true;
          }
          break;
      }
      if (hit) {
        o.hit = true;
        if (this.consumeShield()) continue;
        p.die(o.type === 'fire' ? 'burn' : 'hit');
        this.gameOver(o.type === 'fire' ? 'BURNED' : 'YOU CRASHED');
        return;
      }
      if (glancing) {
        o.hit = true;
        // Clipped the edge: bounce back to the previous lane and stumble
        p.lane = THREE.MathUtils.clamp(p.lane + (p.x < LANES[o.lanes[0]] ? -1 : 1), 0, 2);
        this.stumble();
      }
    }
  }

  consumeShield() {
    if (this.shieldInvuln > 0) return true;
    if (this.powerups.shield) {
      delete this.powerups.shield;
      this.shieldInvuln = 1.0;
      this.rig.addShake(0.4);
      this.ui.toast('SHIELD BROKEN');
      return true;
    }
    return false;
  }

  stumble() {
    const now = this.runTime;
    this.player.stumble();
    this.rig.addShake(0.35);
    if (now - this.lastStumble < 7) {
      this.player.die('caught');
      this.gameOver('CAUGHT BY DEMONS');
      return;
    }
    this.lastStumble = now;
    this.chaseGap = 0.15;
  }

  collectItems(dt) {
    const p = this.player;
    const center = p.worldPos.clone();
    center.y += p.sliding ? 0.5 : 0.95;
    const magnet = !!this.powerups.magnet;
    const radius = magnet ? 6 : 1.05;
    const i = this.track.segments.indexOf(p.seg);
    for (let k = Math.max(0, i - 1); k <= Math.min(this.track.segments.length - 1, i + 1); k++) {
      const seg = this.track.segments[k];
      for (const c of seg.coins) {
        if (c.taken) {
          if (c.flyT !== null) {
            // Coin flying into the runner
            c.flyT += dt;
            c.world.lerp(center, Math.min(1, dt * 18));
            if (c.flyT > 0.33) c.flyT = null;
          }
          continue;
        }
        const dist = c.world.distanceTo(center);
        if (dist < radius) {
          c.taken = true;
          c.flyT = 0;
          this.coins++;
          this.score += 10 * this.multiplier;
          this.onCoin?.();
        }
      }
      for (const pu of seg.powerups) {
        if (pu.taken) continue;
        if (pu.world.distanceTo(center) < 1.2) {
          pu.taken = true;
          this.powerups[pu.kind] = { t: 10, max: 10 };
          this.ui.toast(pu.kind === 'magnet' ? 'COIN MAGNET' : 'SHIELD');
        }
      }
    }
  }

  updatePowerups(dt) {
    if (this.shieldInvuln > 0) this.shieldInvuln -= dt;
    for (const k of Object.keys(this.powerups)) {
      this.powerups[k].t -= dt;
      if (this.powerups[k].t <= 0) delete this.powerups[k];
    }
    this.ui.powerups(Object.entries(this.powerups).map(([kind, v]) => ({ kind, ...v })));
  }

  updateChase(dt) {
    // Demons slowly fall back after a stumble
    this.chaseGap = Math.min(1, this.chaseGap + dt * 0.08);
    const danger = THREE.MathUtils.clamp(1 - this.chaseGap * 1.6, 0, 1);
    this.engine.grade.uniforms.uDanger.value = danger * 0.8;
    this.ui.danger(danger * 0.6);
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
