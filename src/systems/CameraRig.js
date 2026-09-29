import * as THREE from 'three';

const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Third-person chase camera with smoothed yaw through corners, a lazy
 * vertical follow during jumps, speed-based FOV kick and screen shake.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.followY = 0;
    this.shake = 0;
    this.mode = 'menu';
    this.menuT = 0;
    this.baseFov = camera.fov;
    this.fovKick = 0;
  }

  snap(player) {
    this.yaw = player.heading;
    this.followY = player.worldPos.y;
    this.update(0, player, 0, true);
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt, player, speed, instant = false) {
    const p = player.worldPos;
    const k = (l) => (instant ? 1 : 1 - Math.exp(-l * dt));

    if (this.mode === 'menu') {
      // Slow orbit in front of the idle runner
      this.menuT += dt;
      const a = player.heading + Math.sin(this.menuT * 0.25) * 0.5 + (this.sideView || 0);
      const target = new THREE.Vector3(p.x - Math.sin(a) * 4.2, p.y + 1.7, p.z - Math.cos(a) * 4.2);
      this.pos.lerp(target, k(2.5));
      // On wide screens aim left of the hero so they stand beside the menu panel
      const wide = this.camera.aspect > 1.3 ? 1.3 : 0;
      const view = new THREE.Vector3(p.x, p.y + 1.25, p.z).sub(this.pos).normalize();
      const right = view.cross(new THREE.Vector3(0, 1, 0)).normalize();
      this.look.lerp(new THREE.Vector3(p.x, p.y + 1.25, p.z).addScaledVector(right, -wide), k(4));
      this.yaw = player.heading;
      this.followY = p.y;
    } else {
      this.yaw += shortestAngle(this.yaw, player.heading) * k(5.5);
      const falling = player.state === 'falling';
      // On the zipline, drift out to the side so the rope doesn't hide the runner
      this.zipMix = damp(this.zipMix || 0, player.zipping ? 1 : 0, 2.5, dt || 1);
      const followK = THREE.MathUtils.lerp(0.55, 0.9, this.zipMix);
      if (!falling) this.followY = damp(this.followY, p.y * followK, instant ? 1e9 : 6, dt);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const dist = 5.4;
      const height = 3.05;
      const side = this.zipMix * 2.2;
      const target = new THREE.Vector3(p.x - fx * dist - fz * side, this.followY + height + this.zipMix * 0.6, p.z - fz * dist + fx * side);
      if (player.state === 'dead') {
        target.set(p.x - fx * 3.8, this.followY + 3.4, p.z - fz * 3.8);
      }
      this.pos.lerp(target, k(player.state === 'run' ? 9 : 3));
      const lookTarget = falling
        ? new THREE.Vector3(p.x, Math.max(p.y, this.followY - 6), p.z)
        : new THREE.Vector3(p.x + fx * 5, this.followY + 1.25, p.z + fz * 5);
      this.look.lerp(lookTarget, k(falling ? 4 : 12));
    }

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.18;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.lookAt(this.look);

    // Subtle FOV widening with speed for a sense of velocity
    this.fovKick = damp(this.fovKick, this.mode === 'play' ? Math.max(0, speed - 10) * 0.45 : 0, 2, dt || 1);
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
