import * as THREE from 'three';
import { mulberry32 } from './Textures.js';
import { flameGeometry, sharedUniforms } from './TrackAssets.js';

export const LANE_W = 1.55;
export const LANES = [-LANE_W, 0, LANE_W];
export const HALF_W = 2.6;
const ROW = 2; // paving row length along the path
const CURB_X = HALF_W + 0.35;

// Cardinal directions: forward (f) and right (r) vectors on the XZ plane.
const DIRS = [
  { f: new THREE.Vector3(0, 0, -1), r: new THREE.Vector3(1, 0, 0) },
  { f: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(0, 0, 1) },
  { f: new THREE.Vector3(0, 0, 1), r: new THREE.Vector3(-1, 0, 0) },
  { f: new THREE.Vector3(-1, 0, 0), r: new THREE.Vector3(0, 0, -1) },
];

export const yawOf = (dir) => -dir * (Math.PI / 2);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** BoxGeometry whose UVs are scaled to world size so textures don't stretch. */
function boxUV(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [
    [d, h], [d, h], // +x, -x
    [w, d], [w, d], // +y, -y
    [w, h], [w, h], // +z, -z
  ];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[face][0]) / tile, (uv.getY(i) * dims[face][1]) / tile);
    }
  }
  return g;
}

/**
 * A straight run of temple walkway that ends in a 90° corner.
 * Local coordinates: d = distance along the segment from its start junction,
 * x = lateral offset (positive = right), y = height above the walkway.
 */
export class Segment {
  constructor(index, start, dir, length, turn, prevTurn) {
    this.index = index;
    this.start = start.clone();
    this.dir = dir;
    this.length = length;
    this.turn = turn; // 'left' | 'right' at the end
    this.prevTurn = prevTurn;
    this.f = DIRS[dir].f;
    this.r = DIRS[dir].r;
    this.yaw = yawOf(dir);
    this.dStart = index === 0 ? -30 : HALF_W;
    this.dEnd = length + HALF_W;
    this.gaps = []; // [d0, d1]
    this.obstacles = [];
    this.coins = [];
    this.powerups = [];
    this.group = new THREE.Group();
    this.disposables = [];
  }

  get end() {
    return this.start.clone().addScaledVector(this.f, this.length);
  }

  toWorld(d, x, y = 0, out = new THREE.Vector3()) {
    return out.copy(this.start).addScaledVector(this.f, d).addScaledVector(this.r, x).setY(this.start.y + y);
  }

  toLocal(world) {
    _p.copy(world).sub(this.start);
    return { d: _p.dot(this.f), x: _p.dot(this.r) };
  }

  inGap(d) {
    for (const g of this.gaps) if (d > g[0] && d < g[1]) return true;
    return false;
  }

  /** Is there walkable floor at local (d, x)? */
  hasFloor(d, x) {
    if (d < this.dStart - (this.index === 0 ? 0 : HALF_W * 2) || d > this.dEnd) return false;
    if (Math.abs(x) > HALF_W + 0.2) {
      // Beyond the side edge only the junction square extends sideways.
      return false;
    }
    return !this.inGap(d);
  }
}

/**
 * Procedurally generates an endless temple path made of segments with turns,
 * gaps, obstacles, coins and scenery, and recycles segments behind the runner.
 */
export class Track {
  constructor(scene, assets, seed = Date.now() % 100000) {
    this.scene = scene;
    this.assets = assets;
    this.segments = [];
    this.seed = seed;
    this.rnd = mulberry32(seed);
    this.nextIndex = 0;
    this.difficulty = 0;
    this.coinSpin = 0;
  }

  reset(seed = (Math.random() * 1e6) | 0) {
    for (const s of this.segments) this.disposeSegment(s);
    this.segments = [];
    this.rnd = mulberry32(seed);
    this.nextIndex = 0;
    this.difficulty = 0;
    this.ensureAhead(null, 0);
  }

  get first() {
    return this.segments[0];
  }

  segmentByIndex(i) {
    return this.segments.find((s) => s.index === i);
  }

  /** Make sure there's enough track generated in front of the runner. */
  ensureAhead(currentSeg, distanceInSeg) {
    const need = 320;
    let ahead = 0;
    if (currentSeg) {
      const i = this.segments.indexOf(currentSeg);
      ahead = currentSeg.length - distanceInSeg;
      for (let k = i + 1; k < this.segments.length; k++) ahead += this.segments[k].length;
    }
    while (!currentSeg ? this.segments.length < 4 : ahead < need) {
      const s = this.generateSegment();
      ahead += s.length;
      if (!currentSeg && this.segments.length >= 4) break;
    }
    // Drop segments well behind the runner.
    if (currentSeg) {
      while (this.segments[0] && this.segments[0].index < currentSeg.index - 1) {
        this.disposeSegment(this.segments.shift());
      }
    }
  }

  generateSegment() {
    const rnd = this.rnd;
    const prev = this.segments[this.segments.length - 1];
    const index = this.nextIndex++;
    let start, dir, prevTurn;
    if (!prev) {
      start = new THREE.Vector3(0, 0, 0);
      dir = 0;
      prevTurn = null;
    } else {
      start = prev.end;
      dir = (prev.dir + (prev.turn === 'right' ? 1 : 3)) % 4;
      prevTurn = prev.turn;
    }
    // Never head "backwards" (dir 2) so the path can't loop into itself.
    let turn;
    if (dir === 1) turn = 'left';
    else if (dir === 3) turn = 'right';
    else turn = rnd() < 0.5 ? 'left' : 'right';

    const length = index === 0 ? 110 : Math.round((58 + rnd() * 46) / ROW) * ROW;
    const seg = new Segment(index, start, dir, length, turn, prevTurn);
    this.layoutGameplay(seg);
    this.buildGeometry(seg);
    this.segments.push(seg);
    this.scene.add(seg.group);
    return seg;
  }

  // ---------------------------------------------------------------------------
  // Gameplay layout: obstacles, gaps, coins, power-ups
  // ---------------------------------------------------------------------------
  layoutGameplay(seg) {
    const rnd = this.rnd;
    const diff = Math.min(1, seg.index / 14); // ramps up over the first ~14 segments
    let d = seg.index === 0 ? 46 : 16;
    const endLimit = seg.length - HALF_W - 14;
    const laneX = (i) => LANES[i];

    const addCoinRun = (from, to, lane, arc = null) => {
      const count = Math.floor((to - from) / 1.7);
      for (let i = 0; i <= count; i++) {
        const cd = from + i * 1.7;
        let y = 0.85;
        if (arc) {
          const t = (cd - arc.d0) / (arc.d1 - arc.d0);
          if (t > 0 && t < 1) y += Math.sin(t * Math.PI) * arc.h;
        }
        seg.coins.push({ d: cd, x: laneX(lane), y, taken: false, flyT: null });
      }
    };

    while (d < endLimit) {
      const roll = rnd();
      const types = ['log', 'arch', 'gap', 'block', 'fire', 'block2'];
      const weights = [1, 1, 0.7 + diff * 0.5, 1.1, 0.4 + diff * 0.8, 0.2 + diff * 0.9];
      let acc = 0;
      const total = weights.reduce((a, b) => a + b, 0);
      let type = types[0];
      for (let i = 0; i < types.length; i++) {
        acc += weights[i] / total;
        if (roll <= acc) {
          type = types[i];
          break;
        }
      }

      const coinLane = (rnd() * 3) | 0;
      switch (type) {
        case 'log': {
          seg.obstacles.push({ type: 'log', d0: d - 0.45, d1: d + 0.45, lanes: [0, 1, 2], top: 0.78 });
          if (rnd() < 0.7) addCoinRun(d - 5, d + 5, coinLane, { d0: d - 4.2, d1: d + 4.2, h: 1.5 });
          break;
        }
        case 'arch': {
          seg.obstacles.push({ type: 'arch', d0: d - 0.55, d1: d + 0.55, lanes: [0, 1, 2], bottom: 1.2 });
          if (rnd() < 0.6) addCoinRun(d - 5, d + 5, coinLane);
          break;
        }
        case 'gap': {
          const g0 = Math.round(d / ROW) * ROW - ROW;
          const len = rnd() < 0.35 + diff * 0.3 ? ROW * 2 + ROW : ROW * 2;
          seg.gaps.push([g0, g0 + len]);
          seg.obstacles.push({ type: 'gap', d0: g0, d1: g0 + len, lanes: [0, 1, 2] });
          addCoinRun(g0 - 4, g0 + len + 4, coinLane, { d0: g0 - 3.6, d1: g0 + len + 3.6, h: 1.7 });
          d = g0 + len;
          break;
        }
        case 'block': {
          const lane = (rnd() * 3) | 0;
          seg.obstacles.push({ type: 'block', d0: d - 0.65, d1: d + 0.65, lanes: [lane] });
          const free = (lane + 1 + ((rnd() * 2) | 0)) % 3;
          addCoinRun(d - 6, d + 6, free);
          break;
        }
        case 'block2': {
          const open = (rnd() * 3) | 0;
          const lanes = [0, 1, 2].filter((l) => l !== open);
          seg.obstacles.push({ type: rnd() < 0.5 ? 'block' : 'fire', d0: d - 0.65, d1: d + 0.65, lanes });
          addCoinRun(d - 7, d + 5, open);
          break;
        }
        case 'fire': {
          const lane = (rnd() * 3) | 0;
          seg.obstacles.push({ type: 'fire', d0: d - 0.7, d1: d + 0.7, lanes: [lane] });
          if (rnd() < 0.5) addCoinRun(d - 5, d + 5, (lane + 1) % 3);
          break;
        }
      }

      // Occasionally a power-up floats in a free spot after the obstacle.
      if (rnd() < 0.07 && seg.index > 0) {
        seg.powerups.push({ d: d + 5, x: laneX((rnd() * 3) | 0), y: 1.0, kind: rnd() < 0.5 ? 'magnet' : 'shield', taken: false });
      }

      const spacing = THREE.MathUtils.lerp(24, 12, diff) + rnd() * THREE.MathUtils.lerp(14, 8, diff);
      d += spacing;
    }

    // A coin trail through the corner, hugging the inside lane, rewards turning.
    if (seg.index > 0 && rnd() < 0.5) addCoinRun(seg.length - HALF_W - 12, seg.length - HALF_W - 2, 1);
  }

  // ---------------------------------------------------------------------------
  // Visual construction
  // ---------------------------------------------------------------------------
  buildGeometry(seg) {
    const A = this.assets;
    const rnd = mulberry32(seg.index * 7919 + 17 + (this.seed % 1000));
    const g = seg.group;

    // ---- Paving slabs ----
    const rows = [];
    for (let d = seg.dStart + ROW / 2; d < seg.dEnd; d += ROW) {
      if (!seg.inGap(d)) rows.push(d);
    }
    const slabX = [-1.95, -0.65, 0.65, 1.95];
    const slabs = new THREE.InstancedMesh(A.geo.slab, A.mat.slab, rows.length * 4);
    let n = 0;
    for (const d of rows) {
      for (const x of slabX) {
        // Slabs at a gap's lip are cracked and sunken
        const nearGap = seg.gaps.some((gp) => Math.abs(d - gp[0]) < ROW || Math.abs(d - gp[1]) < ROW);
        const sink = nearGap ? rnd() * 0.08 : rnd() * 0.025;
        const tilt = nearGap ? 0.05 : 0.012;
        seg.toWorld(d, x, -0.2 - sink, _p);
        _e.set((rnd() - 0.5) * tilt, seg.yaw + (rnd() < 0.5 ? 0 : Math.PI), (rnd() - 0.5) * tilt);
        _q.setFromEuler(_e);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        slabs.setMatrixAt(n, _m);
        const tone = 0.82 + rnd() * 0.28;
        _c.setRGB(tone, tone * (0.96 + rnd() * 0.05), tone * (0.9 + rnd() * 0.08));
        slabs.setColorAt(n, _c);
        n++;
      }
    }
    slabs.receiveShadow = true;
    slabs.castShadow = false;
    g.add(slabs);
    seg.disposables.push(slabs);

    // ---- Curbs, columns, torches on both sides ----
    const turnSide = seg.turn === 'right' ? 1 : -1;
    const prevSide = seg.prevTurn === 'right' ? 1 : seg.prevTurn === 'left' ? -1 : 0;
    const curbs = [];
    const columns = [];
    const torches = [];
    const rubble = [];
    for (const d of rows) {
      for (const side of [-1, 1]) {
        // Leave the side open where the next segment branches off
        if (side === turnSide && d > seg.length - HALF_W) continue;
        // And where the previous segment joins us
        if (side === prevSide && d < HALF_W) continue;
        const isColumnRow = Math.abs(((d - seg.dStart) % 10) - 5) < 0.01 && d > 4 && d < seg.length - 6;
        if (isColumnRow) {
          columns.push({ d, side, broken: rnd() < 0.25 });
          continue;
        }
        if (rnd() < 0.07) {
          // Ruined gap in the curb with debris
          rubble.push({ d: d + (rnd() - 0.5), x: side * (CURB_X + 0.4 + rnd() * 0.3), s: 0.5 + rnd() * 0.4 });
          continue;
        }
        curbs.push({ d, side });
      }
    }
    // The outer wall of the corner square, so the corner reads clearly.
    const curbMesh = new THREE.InstancedMesh(A.geo.curb, A.mat.wall, curbs.length);
    curbs.forEach((c, i) => {
      seg.toWorld(c.d, c.side * CURB_X, 0.13 + (rnd() - 0.5) * 0.06, _p);
      _e.set((rnd() - 0.5) * 0.03, seg.yaw, (rnd() - 0.5) * 0.04);
      _q.setFromEuler(_e);
      _s.set(1, 0.9 + rnd() * 0.25, 1);
      _m.compose(_p, _q, _s);
      curbMesh.setMatrixAt(i, _m);
      const t = 0.8 + rnd() * 0.3;
      curbMesh.setColorAt(i, _c.setRGB(t, t, t * 0.97));
    });
    curbMesh.castShadow = curbMesh.receiveShadow = true;
    g.add(curbMesh);
    seg.disposables.push(curbMesh);

    const colMesh = new THREE.InstancedMesh(A.geo.column, A.mat.pillar, Math.max(1, columns.length));
    colMesh.count = columns.length;
    columns.forEach((c, i) => {
      seg.toWorld(c.d, c.side * CURB_X, -0.05, _p);
      _e.set(c.broken ? (rnd() - 0.5) * 0.12 : 0, rnd() * Math.PI, c.broken ? (rnd() - 0.5) * 0.12 : 0);
      _q.setFromEuler(_e);
      const h = c.broken ? 0.3 + rnd() * 0.35 : 0.95 + rnd() * 0.12;
      _s.set(0.85, h, 0.85);
      _m.compose(_p, _q, _s);
      colMesh.setMatrixAt(i, _m);
      if (!c.broken && rnd() < 0.55) torches.push(seg.toWorld(c.d, c.side * CURB_X, 4.2 * h + 0.05));
      if (c.broken && rnd() < 0.8) {
        rubble.push({ d: c.d + (rnd() - 0.5) * 2, x: c.side * (CURB_X + 0.9 + rnd()), s: 0.6 + rnd() * 0.5 });
      }
    });
    colMesh.castShadow = colMesh.receiveShadow = true;
    g.add(colMesh);
    seg.disposables.push(colMesh);

    // Torch flames on column tops (one particle system per segment)
    if (torches.length) {
      const perTorch = 14;
      const geo = flameGeometry(torches.length * perTorch, 0.28, 0.28, seg.index + 3);
      const pos = geo.attributes.position;
      for (let t = 0; t < torches.length; t++) {
        for (let k = 0; k < perTorch; k++) {
          const i = t * perTorch + k;
          pos.setXYZ(i, pos.getX(i) + torches[t].x, pos.getY(i) + torches[t].y, pos.getZ(i) + torches[t].z);
        }
      }
      const pts = new THREE.Points(geo, A.mat.flame);
      pts.frustumCulled = false;
      g.add(pts);
      seg.disposables.push(geo);
      const bowls = new THREE.InstancedMesh(A.geo.grate, A.mat.ember, torches.length);
      torches.forEach((p, i) => {
        _m.compose(p, _q.identity(), _s.set(0.4, 1, 0.4));
        bowls.setMatrixAt(i, _m);
      });
      g.add(bowls);
      seg.disposables.push(bowls);
    }

    if (rubble.length) {
      const rub = new THREE.InstancedMesh(A.geo.rubble, A.mat.wall, rubble.length);
      rubble.forEach((r, i) => {
        seg.toWorld(r.d, r.x, r.s * 0.25, _p);
        _e.set(rnd() * 3, rnd() * 3, rnd() * 3);
        _q.setFromEuler(_e);
        _m.compose(_p, _q, _s.setScalar(r.s));
        rub.setMatrixAt(i, _m);
      });
      rub.castShadow = rub.receiveShadow = true;
      g.add(rub);
      seg.disposables.push(rub);
    }

    // ---- Foundations: a thick masonry deck and huge columns into the abyss ----
    const runs = [];
    let runStart = null;
    let last = null;
    for (const d of rows) {
      if (runStart === null) runStart = d;
      else if (d - last > ROW + 0.01) {
        runs.push([runStart, last]);
        runStart = d;
      }
      last = d;
    }
    if (runStart !== null) runs.push([runStart, last]);
    for (const [a, b] of runs) {
      const len = b - a + ROW;
      const deckGeo = boxUV(HALF_W * 2 + 1.6, 3.2, len, 3);
      seg.disposables.push(deckGeo);
      const deck = new THREE.Mesh(deckGeo, A.mat.support);
      seg.toWorld((a + b) / 2, 0, -2.0, deck.position);
      deck.rotation.y = seg.yaw;
      deck.receiveShadow = true;
      g.add(deck);
    }
    // Colossal support columns
    const supports = [];
    for (let d = seg.dStart + 6; d < seg.dEnd - 2; d += 14 + rnd() * 6) {
      if (!seg.inGap(d) && !seg.inGap(d - 2) && !seg.inGap(d + 2)) supports.push(d);
    }
    if (supports.length) {
      const colGeo = boxUV(3.2, 60, 3.2, 4);
      seg.disposables.push(colGeo);
      const sup = new THREE.InstancedMesh(colGeo, A.mat.support, supports.length);
      supports.forEach((d, i) => {
        seg.toWorld(d, 0, -33.5, _p);
        _q.setFromAxisAngle(_s.set(0, 1, 0), seg.yaw);
        _m.compose(_p, _q, _s.set(1, 1, 1));
        sup.setMatrixAt(i, _m);
      });
      g.add(sup);
      seg.disposables.push(sup);
    }

    this.buildObstacles(seg, rnd);
    this.buildCoins(seg);
    this.buildScenery(seg, rnd, turnSide, prevSide);
  }

  buildObstacles(seg, rnd) {
    const A = this.assets;
    const g = seg.group;
    for (const o of seg.obstacles) {
      const dm = (o.d0 + o.d1) / 2;
      if (o.type === 'log') {
        const log = new THREE.Mesh(A.geo.log, A.mat.bark);
        log.scale.set(HALF_W * 2 + 1.6, 1, 1);
        seg.toWorld(dm, (rnd() - 0.5) * 0.4, 0.4, log.position);
        log.rotation.set(0, seg.yaw + (rnd() - 0.5) * 0.12, 0);
        log.castShadow = log.receiveShadow = true;
        g.add(log);
        // Mossy roots grabbing the log
        for (let i = 0; i < 3; i++) {
          const r = new THREE.Mesh(A.geo.rubble, A.mat.bark);
          r.scale.set(0.5, 0.35, 0.9);
          seg.toWorld(dm + (rnd() - 0.5) * 0.9, (i - 1) * 2.2 + (rnd() - 0.5), 0.1, r.position);
          r.rotation.set(rnd(), rnd() * 3, rnd());
          r.castShadow = true;
          g.add(r);
        }
        o.mesh = log;
      } else if (o.type === 'arch') {
        // A carved stone lintel on two side blocks: slide underneath
        const lintel = new THREE.Mesh(A.geo.lintel, A.mat.pillar);
        lintel.scale.set(HALF_W * 2 + 2.4, 1, 1);
        seg.toWorld(dm, 0, o.bottom + 0.4, lintel.position);
        lintel.rotation.y = seg.yaw;
        lintel.castShadow = lintel.receiveShadow = true;
        g.add(lintel);
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(A.geo.block, A.mat.wall);
          post.scale.set(0.8, 0.75, 0.9);
          seg.toWorld(dm, side * (HALF_W + 0.8), 0.9, post.position);
          post.rotation.y = seg.yaw;
          post.castShadow = post.receiveShadow = true;
          g.add(post);
        }
        // Vines draped over the lintel
        for (let i = 0; i < 5; i++) {
          const v = new THREE.Mesh(A.geo.vine, A.mat.vine);
          seg.toWorld(dm + 0.56, -2.2 + i * 1.1 + (rnd() - 0.5) * 0.4, o.bottom + 0.75, v.position);
          v.rotation.y = seg.yaw;
          v.scale.set(0.8, 0.12 + rnd() * 0.15, 1);
          g.add(v);
        }
        o.mesh = lintel;
      } else if (o.type === 'block') {
        for (const l of o.lanes) {
          const b = new THREE.Mesh(A.geo.block, A.mat.pillar);
          seg.toWorld(dm, LANES[l] + (rnd() - 0.5) * 0.15, 1.18, b.position);
          b.rotation.set((rnd() - 0.5) * 0.08, seg.yaw + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.08);
          b.scale.set(1, 0.85 + rnd() * 0.3, 1);
          b.castShadow = b.receiveShadow = true;
          g.add(b);
          const cap = new THREE.Mesh(A.geo.rubble, A.mat.wall);
          cap.position.copy(b.position).setY(b.position.y + 1.2 * b.scale.y + 0.1);
          cap.scale.setScalar(0.7);
          cap.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
          cap.castShadow = true;
          g.add(cap);
        }
      } else if (o.type === 'fire') {
        for (const l of o.lanes) {
          const grate = new THREE.Mesh(A.geo.grate, A.mat.iron);
          seg.toWorld(dm, LANES[l], 0.01, grate.position);
          grate.rotation.y = seg.yaw;
          grate.receiveShadow = true;
          g.add(grate);
          const embers = new THREE.Mesh(A.geo.grate, A.mat.ember);
          embers.position.copy(grate.position).setY(grate.position.y + 0.02);
          embers.scale.set(0.8, 0.5, 0.8);
          embers.rotation.y = seg.yaw;
          g.add(embers);
          const geo = flameGeometry(70, 1.1, 1.1, seg.index * 13 + l);
          const flames = new THREE.Points(geo, A.mat.flame);
          flames.position.copy(grate.position);
          flames.scale.set(1, 1.35, 1);
          g.add(flames);
          seg.disposables.push(geo);
        }
      }
    }
  }

  buildCoins(seg) {
    const A = this.assets;
    if (seg.coins.length) {
      const mesh = new THREE.InstancedMesh(A.geo.coin, A.mat.gold, seg.coins.length);
      mesh.castShadow = true;
      seg.coinMesh = mesh;
      seg.group.add(mesh);
      seg.disposables.push(mesh);
      seg.coins.forEach((c) => (c.world = seg.toWorld(c.d, c.x, c.y)));
      this.updateCoinMatrices(seg);
    }
    for (const p of seg.powerups) {
      p.world = seg.toWorld(p.d, p.x, p.y);
      const color = p.kind === 'magnet' ? 0x4fc3ff : 0x9dff6b;
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.8,
        metalness: 0.3,
        roughness: 0.2,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), mat);
      mesh.position.copy(p.world);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: A.textures.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 })
      );
      halo.scale.setScalar(1.8);
      mesh.add(halo);
      p.mesh = mesh;
      seg.group.add(mesh);
      seg.disposables.push(mesh.geometry, mat, halo.material);
    }
  }

  updateCoinMatrices(seg) {
    const mesh = seg.coinMesh;
    if (!mesh) return;
    const spin = this.coinSpin;
    for (let i = 0; i < seg.coins.length; i++) {
      const c = seg.coins[i];
      if (c.taken && c.flyT === null) {
        _m.makeScale(0, 0, 0);
      } else {
        _q.setFromAxisAngle(_s.set(0, 1, 0), spin + c.d * 0.25);
        const sc = c.flyT !== null ? Math.max(0, 1 - c.flyT * 3) : 1;
        _m.compose(c.world, _q, _s.setScalar(sc));
      }
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  buildScenery(seg, rnd, turnSide, prevSide) {
    const A = this.assets;
    const density = this.assets.quality.trees;
    const g = seg.group;

    // ---- Jungle trees rising from the chasm ----
    for (let variant = 0; variant < A.trees.length; variant++) {
      const tree = A.trees[variant];
      const spots = [];
      const count = Math.round((seg.length / 7) * density * (variant === 0 ? 0.6 : 0.5));
      for (let i = 0; i < count * 3 && spots.length < count; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const d = seg.dStart - 4 + rnd() * (seg.dEnd - seg.dStart + 8);
        const lateral = 9 + Math.pow(rnd(), 0.8) * 16;
        if (side === turnSide && d > seg.length - 12) continue;
        if (side === prevSide && d < 12) continue;
        const scale = 0.75 + rnd() * 0.55;
        // Trees close to the path keep their canopy below the walkway
        const base = lateral < 13 ? -58 - rnd() * 6 : -50 + rnd() * 8;
        spots.push({ d, x: side * lateral, y: base, scale, rot: rnd() * Math.PI * 2 });
      }
      if (!spots.length) continue;
      const trunks = new THREE.InstancedMesh(tree.trunkGeo, A.mat.bark, spots.length);
      const leaves = new THREE.InstancedMesh(tree.leafGeo, A.mat.leaves, spots.length);
      spots.forEach((s, i) => {
        seg.toWorld(s.d, s.x, s.y, _p);
        _q.setFromAxisAngle(_s.set(0, 1, 0), s.rot);
        _m.compose(_p, _q, _s.setScalar(s.scale));
        trunks.setMatrixAt(i, _m);
        leaves.setMatrixAt(i, _m);
        const t = 0.75 + rnd() * 0.4;
        leaves.setColorAt(i, _c.setRGB(t * (0.9 + rnd() * 0.2), t, t * (0.85 + rnd() * 0.2)));
      });
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      trunks.receiveShadow = true;
      g.add(trunks, leaves);
      seg.disposables.push(trunks, leaves);
    }

    // ---- Vines hanging off the walkway edges ----
    const vines = [];
    for (let d = seg.dStart + 2; d < seg.dEnd - 2; d += 1.5 + rnd() * 3) {
      if (seg.inGap(d)) continue;
      for (const side of [-1, 1]) if (rnd() < 0.45) vines.push({ d, side });
    }
    if (vines.length) {
      const vm = new THREE.InstancedMesh(A.geo.vine, A.mat.vine, vines.length);
      vines.forEach((v, i) => {
        seg.toWorld(v.d, v.side * (HALF_W + 0.82), -0.3, _p);
        _q.setFromAxisAngle(_s.set(0, 1, 0), seg.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.3);
        _m.compose(_p, _q, _s.set(1, 0.6 + rnd() * 1.4, 1));
        vm.setMatrixAt(i, _m);
      });
      g.add(vm);
      seg.disposables.push(vm);
    }

    // ---- A ruined gateway at the start of some segments ----
    if (seg.index > 0 && rnd() < 0.45) {
      const d = HALF_W + 6 + rnd() * 6;
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(A.geo.column, A.mat.pillar);
        seg.toWorld(d, side * (HALF_W + 0.9), -0.05, col.position);
        col.scale.set(1.25, 1.45, 1.25);
        col.castShadow = col.receiveShadow = true;
        g.add(col);
      }
      const lintel = new THREE.Mesh(A.geo.lintel, A.mat.pillar);
      lintel.scale.set(HALF_W * 2 + 4, 1.3, 1.6);
      seg.toWorld(d, 0, 6.6, lintel.position);
      lintel.rotation.set(0, seg.yaw, (rnd() - 0.5) * 0.06);
      lintel.castShadow = lintel.receiveShadow = true;
      g.add(lintel);
    }

    // ---- A distant stepped temple on long straights ----
    if (seg.length > 70 && rnd() < 0.55) {
      const side = rnd() < 0.5 ? -1 : 1;
      const d = 25 + rnd() * (seg.length - 50);
      const lateral = 55 + rnd() * 25;
      const temple = new THREE.Group();
      const tiers = 5 + ((rnd() * 3) | 0);
      let w = 26;
      let y = -40;
      for (let t = 0; t < tiers; t++) {
        const h = t === 0 ? 34 : 5.5;
        const geo = boxUV(w, h, w, 5);
        seg.disposables.push(geo);
        const m = new THREE.Mesh(geo, A.mat.wall);
        m.position.y = y + h / 2;
        temple.add(m);
        y += h;
        w *= 0.8;
      }
      const shrineGeo = boxUV(w * 0.8, 6, w * 0.8, 5);
      seg.disposables.push(shrineGeo);
      const shrine = new THREE.Mesh(shrineGeo, A.mat.pillar);
      shrine.position.y = y + 3;
      temple.add(shrine);
      seg.toWorld(d, side * lateral, 0, temple.position);
      temple.rotation.y = seg.yaw + (rnd() - 0.5) * 0.5;
      g.add(temple);
    }
  }

  disposeSegment(seg) {
    this.scene.remove(seg.group);
    for (const d of seg.disposables) d.dispose?.();
  }

  update(dt) {
    this.coinSpin += dt * 3.2;
    sharedUniforms.uTime.value += dt;
    for (const seg of this.segments) {
      this.updateCoinMatrices(seg);
      for (const p of seg.powerups) {
        if (!p.mesh) continue;
        p.mesh.rotation.y += dt * 2;
        p.mesh.position.y = p.world.y + Math.sin(sharedUniforms.uTime.value * 3 + p.d) * 0.12;
        p.mesh.visible = !p.taken;
      }
    }
  }
}
