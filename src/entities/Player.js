import * as THREE from 'three';
import { LANES, LANE_W, HALF_W } from '../world/Track.js';

const GRAVITY = 30;
const JUMP_V = 10.2;
const SLIDE_TIME = 0.78;
const TURN_WINDOW = 7.5; // how far before the corner a turn can be queued
const LATERAL_SPEED = 13;
const HANG = 1.9; // hands-to-feet distance while hanging from the zipline
const ZIP_BOOST = 1.3;
const ZIP_SWING = 0.6; // lateral swing per lane on the rope

const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Additive pose offsets (Euler XYZ, radians) per bone for jump & slide.
const POSES = {
  jump: {
    mixamorigLeftUpLeg: [-1.1, 0, 0.05],
    mixamorigRightUpLeg: [-0.5, 0, -0.05],
    mixamorigLeftLeg: [1.5, 0, 0],
    mixamorigRightLeg: [1.2, 0, 0],
    mixamorigLeftArm: [-0.4, 0, -0.5],
    mixamorigRightArm: [-0.4, 0, 0.5],
    mixamorigSpine: [0.18, 0, 0],
  },
  hang: {
    mixamorigLeftArm: [-2.7, 0, 0.15],
    mixamorigRightArm: [-2.7, 0, -0.15],
    mixamorigLeftUpLeg: [-0.55, 0, 0.08],
    mixamorigRightUpLeg: [-0.35, 0, -0.08],
    mixamorigLeftLeg: [0.7, 0, 0],
    mixamorigRightLeg: [0.9, 0, 0],
    mixamorigSpine: [0.08, 0, 0],
  },
  slide: {
    mixamorigSpine: [-0.25, 0, 0],
    mixamorigSpine1: [-0.15, 0, 0],
    mixamorigHead: [0.55, 0, 0],
    mixamorigLeftUpLeg: [-0.5, 0, 0.06],
    mixamorigRightUpLeg: [0.3, 0, -0.06],
    mixamorigLeftLeg: [0.4, 0, 0],
    mixamorigRightLeg: [1.6, 0, 0],
    mixamorigLeftArm: [0.3, 0, -0.7],
    mixamorigRightArm: [0.3, 0, 0.7],
  },
};

/**
 * The runner: kinematics in track-local space (segment, distance, lateral,
 * height), jumping, sliding, turning corners and the animated character.
 */
export class Player {
  constructor(scene, gltf) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    scene.add(this.root);

    const model = gltf.scene;
    // The soldier model already faces -Z, which is our forward direction
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material.envMapIntensity = 0.8;
        }
      }
    });
    this.model = model;
    this.pivot.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name) => gltf.animations.find((a) => a.name === name);
    this.actions = {
      idle: this.mixer.clipAction(clip('Idle')),
      run: this.mixer.clipAction(clip('Run')),
    };
    this.actions.idle.play();
    this.actions.run.play();
    this.actions.run.setEffectiveWeight(0);

    this.bones = {};
    model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
    });
    this.poseQuats = {};
    for (const [poseName, pose] of Object.entries(POSES)) {
      this.poseQuats[poseName] = {};
      for (const [bone, e] of Object.entries(pose)) {
        this.poseQuats[poseName][bone] = new THREE.Quaternion().setFromEuler(new THREE.Euler(...e));
      }
    }

    // Power-up visuals: a fresnel shield bubble and a spinning magnet ring
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 32, 20),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x7dff9a) } },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vV;
          varying vec3 vP;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            vP = position;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uColor;
          varying vec3 vN;
          varying vec3 vV;
          varying vec3 vP;
          void main() {
            float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
            float bands = 0.5 + 0.5 * sin(vP.y * 14.0 - uTime * 4.0);
            gl_FragColor = vec4(uColor * (f * 1.6 + bands * 0.08), f * 0.9 + 0.04);
          }
        `,
      })
    );
    this.shieldMesh.position.y = 0.95;
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);

    this.magnetMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.035, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.magnetMesh.rotation.x = Math.PI / 2;
    this.magnetMesh.position.y = 1.0;
    this.magnetMesh.visible = false;
    this.root.add(this.magnetMesh);

    // Zipline handle held above the head
    const handle = new THREE.Group();
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.75, 10).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3b3530, metalness: 0.85, roughness: 0.35 })
    );
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.03), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 }));
    strap.position.y = 0.085;
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.06, 14).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.9, roughness: 0.4 })
    );
    wheel.position.y = 0.17;
    handle.add(bar, strap, wheel);
    for (const m of [bar, strap, wheel]) m.castShadow = true;
    handle.position.y = HANG;
    handle.visible = false;
    this.handle = handle;
    this.root.add(handle);

    this.worldPos = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.reset(null);
  }

  reset(seg) {
    this.seg = seg;
    this.d = 0;
    this.x = 0;
    this.lane = 1;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.slideT = 0;
    this.jumpBlend = 0;
    this.slideBlend = 0;
    this.hangBlend = 0;
    this.zipping = false;
    this.zipT = 0;
    this.runBlend = 0;
    this.pendingTurn = null;
    this.turnBuffer = 0;
    this.heading = seg ? seg.yaw : 0;
    this.lean = 0;
    this.state = 'idle'; // idle | run | falling | dead
    this.deathType = null;
    this.deathT = 0;
    this.stumbleT = 0;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    this.model.visible = true;
    if (seg) this.syncTransform();
  }

  get sliding() {
    return this.slideT > 0;
  }

  /** Height of the runner's collision box. */
  get height() {
    return this.sliding ? 0.85 : 1.75;
  }

  start() {
    this.state = 'run';
  }

  // ---------- Input actions ----------
  left() {
    this.steer('left');
  }

  right() {
    this.steer('right');
  }

  steer(side) {
    if (this.state !== 'run') return;
    const seg = this.seg;
    if (side !== 'left' && side !== 'right') return;
    if (this.zipping || seg.turn === 'zip') {
      // No corner here: left/right just changes lane (or swings on the rope)
      this.lane = THREE.MathUtils.clamp(this.lane + (side === 'left' ? -1 : 1), 0, 2);
      return;
    }
    const remaining = seg.length - this.d;
    const inWindow = remaining < TURN_WINDOW && remaining > -HALF_W + 0.3;
    if (side === seg.turn && inWindow && !this.pendingTurn) {
      this.pendingTurn = side;
      return;
    }
    if (side === seg.turn && remaining >= TURN_WINDOW && remaining < TURN_WINDOW + 5) {
      // Slightly early: remember the intent for a moment.
      this.turnBuffer = 0.35;
    }
    this.lane = THREE.MathUtils.clamp(this.lane + (side === 'left' ? -1 : 1), 0, 2);
  }

  jump() {
    if (this.state !== 'run' || this.zipping) return false;
    if (this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.slideT = 0;
      return true;
    }
    return false;
  }

  slide() {
    if (this.state !== 'run' || this.zipping) return false;
    if (!this.grounded) {
      this.vy = Math.min(this.vy, -16); // slam down, slide on landing
      this.slideQueued = true;
      return true;
    }
    this.slideT = SLIDE_TIME;
    return true;
  }

  // ---------- Simulation ----------
  update(dt, speed, track) {
    const events = [];
    this.mixer.update(dt * (this.state === 'run' ? THREE.MathUtils.clamp(speed / 10.5, 0.85, 1.7) : 1));

    if (this.state === 'run') {
      this.stepRun(dt, speed, track, events);
      // Footstep events, twice per run cycle
      const run = this.actions.run;
      const phase = (run.time / run.getClip().duration) * 2;
      const stepIdx = Math.floor(phase);
      if (stepIdx !== this.lastStep && this.grounded && !this.sliding && !this.zipping) events.push({ type: 'step' });
      this.lastStep = stepIdx;
    } else if (this.state === 'falling' || this.state === 'dead') {
      this.stepDeath(dt, speed);
    }

    this.animate(dt);
    this.syncTransform(dt);
    return events;
  }

  stepRun(dt, speed, track, events) {
    const seg = this.seg;

    // Grab the zipline handle at the cliff edge
    if (!this.zipping && seg.turn === 'zip' && this.d >= seg.zipA - 1.4) {
      this.zipping = true;
      this.zipT = 0;
      this.slideT = 0;
      this.slideQueued = false;
      this.lane = 1;
      events.push({ type: 'zipStart' });
    }
    if (this.zipping) {
      this.stepZip(dt, speed, track, events);
      return;
    }

    this.d += speed * dt;

    // Queued (buffered) turn intent
    if (this.turnBuffer > 0) {
      this.turnBuffer -= dt;
      if (seg.length - this.d < TURN_WINDOW && !this.pendingTurn && seg.turn !== 'zip') {
        this.pendingTurn = seg.turn;
        this.turnBuffer = 0;
        // Undo the lane change the early press caused
        this.lane = THREE.MathUtils.clamp(this.lane + (seg.turn === 'left' ? 1 : -1), 0, 2);
      }
    }

    // Execute the turn once the new lane lines up
    if (this.pendingTurn && seg.length - this.d <= LANE_W) {
      const next = track.segmentByIndex(seg.index + 1);
      if (next) {
        const world = seg.toWorld(this.d, this.x, 0);
        const local = next.toLocal(world);
        this.seg = next;
        this.d = local.d;
        this.x = local.x;
        this.lane = Math.round(THREE.MathUtils.clamp(local.x / LANE_W, -1, 1)) + 1;
        this.pendingTurn = null;
        events.push({ type: 'turn' });
      }
    }

    // Lateral movement toward the target lane
    const targetX = LANES[this.lane];
    const dx = targetX - this.x;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), LATERAL_SPEED * dt * (0.4 + Math.min(1, Math.abs(dx))));
    this.x += step;
    this.lean = damp(this.lean, THREE.MathUtils.clamp(-dx * 0.25, -0.3, 0.3), 10, dt);

    // Vertical
    const hasFloor = this.seg.hasFloor(this.d, this.x);
    if (!this.grounded || !hasFloor) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      this.grounded = false;
      if (this.y <= 0 && hasFloor && this.y > -0.6) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        events.push({ type: 'land' });
        if (this.slideQueued) {
          this.slideQueued = false;
          this.slideT = SLIDE_TIME;
        }
      } else if (this.y < -0.6) {
        this.state = 'falling';
        this.deathType = 'fall';
        events.push({ type: 'fall' });
      }
    }

    if (this.slideT > 0) this.slideT -= dt;
    if (this.stumbleT > 0) this.stumbleT -= dt;
  }

  stepZip(dt, speed, track, events) {
    const seg = this.seg;
    this.zipT += dt;
    this.d += speed * ZIP_BOOST * dt;
    // Leap up to the handle, then ride the rope
    const ropeFeet = seg.ropeY(this.d) - HANG;
    this.y = this.zipT < 0.3 ? damp(this.y, ropeFeet, 14, dt) : ropeFeet;
    this.vy = 0;
    this.grounded = false;
    const targetX = (this.lane - 1) * ZIP_SWING;
    const dx = targetX - this.x;
    this.x = damp(this.x, targetX, 5, dt);
    this.lean = damp(this.lean, THREE.MathUtils.clamp(-dx * 0.6, -0.35, 0.35), 6, dt);

    if (this.d >= seg.zipB) {
      // Let go over the landing pad of the next segment
      const next = track.segmentByIndex(seg.index + 1);
      if (!next) return;
      const local = next.toLocal(seg.toWorld(this.d, this.x, 0));
      this.seg = next;
      this.d = local.d;
      this.x = local.x;
      this.lane = 1;
      this.vy = -1;
      this.zipping = false;
      events.push({ type: 'zipEnd' });
    }
  }

  /** Called by the game when the runner hits something solid. */
  die(type) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.deathType = type;
    this.deathT = 0;
    this.slideT = 0;
  }

  stumble() {
    this.stumbleT = 0.5;
  }

  setPowerupVisuals(shield, magnet, time) {
    this.shieldMesh.visible = shield;
    this.magnetMesh.visible = magnet;
    this.shieldMesh.material.uniforms.uTime.value = time;
    this.shieldMesh.position.y = this.sliding ? 0.55 : 0.95;
    this.magnetMesh.position.y = 1.0 + Math.sin(time * 5) * 0.4;
    this.magnetMesh.scale.setScalar(1 + Math.sin(time * 9) * 0.06);
  }

  stepDeath(dt, speed) {
    this.deathT += dt;
    if (this.state === 'falling') {
      // Keep momentum and tumble into the abyss
      this.d += speed * 0.6 * dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      this.pivot.rotation.x = damp(this.pivot.rotation.x, -1.2, 2, dt);
      if (this.y < -40) this.model.visible = false;
    } else {
      // Knocked back onto the ground
      const t = Math.min(1, this.deathT / 0.6);
      if (this.deathType !== 'caught') this.d -= (1 - t) * 4 * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      this.vy -= GRAVITY * dt;
      this.pivot.rotation.x = damp(this.pivot.rotation.x, 1.45, 7, dt);
      this.pivot.position.y = damp(this.pivot.position.y, 0.2, 7, dt);
    }
  }

  animate(dt) {
    const running = this.state === 'run';
    this.runBlend = damp(this.runBlend, running && !this.zipping ? 1 : 0, 6, dt);
    this.actions.run.setEffectiveWeight(this.runBlend);
    this.actions.idle.setEffectiveWeight(1 - this.runBlend);

    const airborne = running && !this.grounded && !this.zipping;
    this.jumpBlend = damp(this.jumpBlend, airborne ? 1 : 0, airborne ? 14 : 18, dt);
    this.slideBlend = damp(this.slideBlend, running && this.sliding ? 1 : 0, 16, dt);

    this.hangBlend = damp(this.hangBlend, this.zipping ? 1 : 0, 12, dt);
    this.handle.visible = this.hangBlend > 0.5;
    this.applyPose('jump', this.jumpBlend * (1 - this.hangBlend));
    this.applyPose('slide', this.slideBlend);
    this.applyPose('hang', this.hangBlend);

    if (this.state === 'run' || this.state === 'idle') {
      // Slide: lean the whole body back and drop low
      this.pivot.rotation.x = this.slideBlend * 1.05;
      this.pivot.position.y = -this.slideBlend * 0.05;
      this.pivot.position.z = this.slideBlend * 0.35;
      // Stumble wobble
      this.pivot.rotation.z = this.stumbleT > 0 ? Math.sin(this.stumbleT * 30) * 0.12 : damp(this.pivot.rotation.z, 0, 10, dt);
    }
  }

  applyPose(name, w) {
    if (w < 0.001) return;
    const q = new THREE.Quaternion();
    for (const [bone, pq] of Object.entries(this.poseQuats[name])) {
      const b = this.bones[bone];
      if (!b) continue;
      q.identity().slerp(pq, w);
      b.quaternion.multiply(q);
    }
  }

  syncTransform(dt = 0) {
    if (!this.seg) return;
    this.seg.toWorld(this.d, this.x, this.y, this.worldPos);
    this.root.position.copy(this.worldPos);
    // Smoothly rotate toward the segment heading (turn animation)
    if (dt > 0) {
      const diff = shortestAngle(this.heading, this.seg.yaw);
      this.heading += diff * (1 - Math.exp(-14 * dt));
    } else {
      this.heading = this.seg.yaw;
    }
    this.root.rotation.set(0, this.heading, 0);
    this.model.rotation.z = this.lean * 0.4;
    this.forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }
}
