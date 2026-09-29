import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Engine } from './core/Engine.js';
import { createTextures } from './world/Textures.js';
import { Environment } from './world/Environment.js';
import { TrackAssets } from './world/TrackAssets.js';
import { Track, LANES } from './world/Track.js';
import { Forest } from './world/Forest.js';
import { Player } from './entities/Player.js';
import { Demons } from './entities/Demons.js';
import { CameraRig } from './systems/CameraRig.js';
import { Input } from './systems/Input.js';
import { UI } from './ui/UI.js';
import { Audio } from './systems/Audio.js';
import { Particles } from './systems/Particles.js';

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
    this.audio = new Audio();
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
    this.demons = new Demons(this.engine.scene, this.textures, this.engine.quality);
    this.particles = new Particles(this.engine.scene, this.textures.glow);
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
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    inp.on('left', () => this.state === 'playing' && this.player.left());
    inp.on('right', () => this.state === 'playing' && this.player.right());
    const jump = () => {
      if (this.state === 'playing' && this.player.jump()) this.audio.jump();
    };
    inp.on('jump', () => {
      if (this.state === 'menu') this.startRun();
      else jump();
    });
    inp.on('tap', jump);
    inp.on('slide', () => {
      if (this.state === 'playing' && this.player.slide()) this.audio.slide();
    });
    inp.on('mute', () => this.toggleMute());
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
    on('mute-btn', () => this.toggleMute());
    this.updateMuteIcon();
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

  toggleMute() {
    this.audio.toggleMute();
    this.updateMuteIcon();
  }

  updateMuteIcon() {
    document.getElementById('mute-btn').textContent = this.audio.muted ? '🔇' : '🔊';
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
    this.chaseGap = 0.3; // 1 = demons far behind, 0 = on your heels
    this.demons.reset();
    this.demons.visible = false;
    // Seed the trail behind the start line so the pack has somewhere to run from
    const first = this.track.first;
    for (let d = -25; d <= 0; d += 1) this.demons.record(first.toWorld(d, 0, 0), first.yaw);
    this.lastStumble = -99;
    this.powerups = {};
    this.shieldInvuln = 0;
    this.overTimer = 0;
    this.hintShown = false;
    this.particles.clear();
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
    this.demons.visible = true;
    this.audio.unlock();
    this.audio.startMusic();
    this.audio.roar(0.7);
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
    this.audio.death(this.player.deathType);
    const p = this.player.worldPos;
    if (this.player.deathType !== 'fall') {
      this.particles.emit('dust', p, { count: 26, color: 0xbfae8e, speed: 3, up: 2.5, size: 0.9, life: 1.2, spread: 0.6 });
    }
    if (this.player.deathType === 'burn') {
      this.particles.emit('spark', p.clone().setY(p.y + 1), { count: 40, color: 0xff7a20, speed: 3, up: 4, size: 0.35, life: 0.9, gravity: 1 });
    }
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
      const mult = 1 + Math.floor(this.distance / 600);
      if (mult !== this.multiplier) {
        this.multiplier = mult;
        this.ui.toast(`x${mult} MULTIPLIER`);
        this.audio.powerup();
      }
      // Teach the corner turn on the very first corner
      if (!this.hintShown && player.seg.index === 0 && player.seg.length - player.d < 26 && this.best < 1500) {
        this.hintShown = true;
        const touch = matchMedia('(pointer: coarse)').matches;
        this.ui.toast(touch ? `SWIPE ${player.seg.turn.toUpperCase()} TO TURN` : `PRESS ${player.seg.turn === 'left' ? '←' : '→'} TO TURN`, 1800);
      }
      this.score += this.speed * dt * this.multiplier;
      this.checkCollisions();
      this.collectItems(dt);
      this.updatePowerups(dt);
      this.updateChase(dt);
      this.track.ensureAhead(player.seg, player.d);
      this.ui.hud(this);
    }

    if (playing || dying) {
      if (player.state !== 'falling') this.demons.record(player.worldPos, player.heading);
      const pounce = dying && player.deathType === 'caught';
      const closeness = dying ? (player.state === 'falling' ? 0.6 : 0.97) : 1 - this.chaseGap;
      this.demons.update(dt, playing ? this.speed : 4, closeness, this.runTime, pounce);
    }

    if (dying) {
      this.overTimer += dt;
      if (this.overTimer > 1.6) this.finishGameOver();
    }

    this.track.update(dt);
    if (player.sliding && player.grounded && playing && Math.random() < 0.6) {
      this.particles.emit('dust', player.worldPos, { count: 1, color: 0xc9b896, speed: 1, up: 0.5, size: 0.6, life: 0.7 });
    }
    this.player.setPowerupVisuals(!!this.powerups.shield || this.shieldInvuln > 0, !!this.powerups.magnet, this.engine.time);
    this.particles.update(dt);
    this.audio.update(dt, {
      speed: this.speed,
      danger: Math.max(0, 1 - this.chaseGap * 1.3),
      running: playing,
    });
    this.rig.baseFov = this.engine.camera.aspect < 1 ? 75 : 62;
    this.rig.update(dt, player, this.speed);
    this.env.update(dt, player.worldPos);
    this.forest.update(player.worldPos);
  }

  onPlayerEvent(e) {
    if (e.type === 'fall') this.gameOver('YOU FELL');
    else if (e.type === 'land') {
      this.rig.addShake(0.05);
      this.audio.land();
      this.particles.emit('dust', this.player.worldPos, { count: 14, color: 0xc9b896, speed: 2.4, up: 0.8, size: 0.7, life: 0.9, spread: 0.5 });
    } else if (e.type === 'turn') this.audio.turn();
    else if (e.type === 'step') {
      this.audio.step();
      if (Math.random() < 0.5) this.particles.emit('dust', this.player.worldPos, { count: 2, color: 0xc9b896, speed: 0.6, up: 0.4, size: 0.45, life: 0.6 });
    }
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
      this.audio.shieldBreak();
      this.ui.toast('SHIELD BROKEN');
      return true;
    }
    return false;
  }

  stumble() {
    const now = this.runTime;
    this.player.stumble();
    this.rig.addShake(0.35);
    this.audio.stumble();
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
          this.audio.coin();
          this.particles.emit('spark', c.world, { count: 6, color: 0xffd35a, speed: 2.2, up: 2, size: 0.22, life: 0.45, gravity: -4 });
        }
      }
      for (const pu of seg.powerups) {
        if (pu.taken) continue;
        if (pu.world.distanceTo(center) < 1.2) {
          pu.taken = true;
          this.powerups[pu.kind] = { t: 10, max: 10 };
          this.audio.powerup();
          this.particles.emit('spark', pu.world, { count: 30, color: pu.kind === 'magnet' ? 0x5fd0ff : 0x7dff9a, speed: 3, up: 2, size: 0.3, life: 0.8, gravity: 0 });
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
    const danger = Math.pow(THREE.MathUtils.clamp(1 - this.chaseGap * 1.4, 0, 1), 2);
    this.engine.grade.uniforms.uDanger.value = danger * 0.35;
    this.ui.danger(danger * 0.5);
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
