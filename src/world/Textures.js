import * as THREE from 'three';

/**
 * Procedural PBR texture generation. Everything is generated on a canvas at
 * load time so the game ships without any image assets, while still getting
 * albedo + normal + roughness maps for physically based shading.
 */

// ---------- Seeded random + tileable noise ----------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class TileNoise {
  constructor(seed = 1, size = 256) {
    const rnd = mulberry32(seed);
    this.size = size;
    this.values = new Float32Array(size * size);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rnd();
  }

  // Value noise that wraps with the given period (in lattice cells).
  sample(x, y, period) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = this.size;
    const p = period;
    const x0 = ((xi % p) + p) % p;
    const y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const v = this.values;
    const a = v[(y0 % s) * s + (x0 % s)];
    const b = v[(y0 % s) * s + (x1 % s)];
    const c = v[(y1 % s) * s + (x0 % s)];
    const d = v[(y1 % s) * s + (x1 % s)];
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }

  // Fractal Brownian motion on normalized (0..1) coords, tileable.
  fbm(u, v, baseFreq = 4, octaves = 5, gain = 0.5) {
    let amp = 0.5;
    let freq = baseFreq;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.sample(u * freq, v * freq, freq);
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }
}

// ---------- Helpers ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = [1, 1] } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Build a tangent-space normal map from a height field (wrapping). */
function heightToNormal(height, w, h, strength = 2.5) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function writeRGB(img, i, r, g, b, a = 255) {
  img[i] = r * 255;
  img[i + 1] = g * 255;
  img[i + 2] = b * 255;
  img[i + 3] = a;
}

// ---------- Stone paving (the path) ----------
function stonePaving(size = 512, seed = 7, rows = 4, cols = 2) {
  const noise = new TileNoise(seed);
  const rnd = mulberry32(seed * 13);
  const albedo = makeCanvas(size);
  const rough = makeCanvas(size);
  const aCtx = albedo.getContext('2d');
  const rCtx = rough.getContext('2d');
  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  // A running-bond layout of slabs, offset every other row.
  const blockTone = [];
  for (let r = 0; r < rows; r++) {
    blockTone[r] = [];
    for (let c = 0; c < cols + 1; c++) blockTone[r][c] = rnd();
  }

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const row = Math.floor(v * rows);
    const fy = v * rows - row;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const shift = row % 2 ? 0.5 / cols : 0;
      const uu = (u + shift) % 1;
      const col = Math.floor(uu * cols);
      const fx = uu * cols - col;

      // Distance to slab edge (in slab-local units) -> grout.
      const warp = (noise.fbm(u, v, 8, 3) - 0.5) * 0.06;
      const ex = Math.min(fx, 1 - fx) / cols + warp;
      const ey = Math.min(fy, 1 - fy) / rows + warp;
      const edge = Math.min(ex, ey);
      const grout = 1 - clamp01((edge - 0.004) / 0.012);

      const tone = blockTone[row][col % cols];
      const n1 = noise.fbm(u, v, 6, 5);
      const n2 = noise.fbm(u + 0.37, v + 0.71, 24, 3);
      const crack = Math.pow(1 - Math.abs(noise.fbm(u + 0.2, v, 5, 4) - 0.5) * 2, 60) * 0.6;
      const moss = clamp01((noise.fbm(u + 0.5, v + 0.3, 4, 4) - 0.52) * 4) * (0.35 + grout * 0.65);

      // Weathered sandstone palette
      let r = lerp(0.46, 0.62, tone) * (0.72 + n1 * 0.5) + n2 * 0.06;
      let g = lerp(0.4, 0.53, tone) * (0.72 + n1 * 0.5) + n2 * 0.05;
      let b = lerp(0.32, 0.42, tone) * (0.72 + n1 * 0.48) + n2 * 0.04;

      const dark = grout * 0.7 + crack * 0.5;
      r *= 1 - dark;
      g *= 1 - dark * 0.95;
      b *= 1 - dark * 0.9;

      // Moss creeping in the grout
      r = lerp(r, 0.16, moss * 0.8);
      g = lerp(g, 0.24, moss * 0.8);
      b = lerp(b, 0.08, moss * 0.8);

      const i = (y * size + x) * 4;
      writeRGB(aImg.data, i, clamp01(r), clamp01(g), clamp01(b));

      const bevel = clamp01(edge * 40);
      height[y * size + x] = bevel * 0.6 + n1 * 0.35 + n2 * 0.08 - crack * 0.3 - grout * 0.3;

      const ro = clamp01(0.78 + n2 * 0.18 - moss * 0.1 + grout * 0.1);
      writeRGB(rImg.data, i, ro, ro, ro);
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  const normal = heightToNormal(height, size, size, 3.5);
  return { albedo, normal, rough };
}

// ---------- Rough rock / masonry blocks (walls, pillars, cliffs) ----------
function rockBlocks(size = 512, seed = 21, { rows = 5, cols = 3, mossAmt = 0.5 } = {}) {
  const noise = new TileNoise(seed);
  const rnd = mulberry32(seed * 7);
  const albedo = makeCanvas(size);
  const rough = makeCanvas(size);
  const aCtx = albedo.getContext('2d');
  const rCtx = rough.getContext('2d');
  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const tones = Array.from({ length: rows * (cols + 1) }, () => rnd());

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const row = Math.floor(v * rows);
    const fy = v * rows - row;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const shift = row % 2 ? 0.5 / cols : 0;
      const uu = (u + shift) % 1;
      const col = Math.floor(uu * cols);
      const fx = uu * cols - col;

      const warp = (noise.fbm(u, v, 6, 3) - 0.5) * 0.05;
      const edge = Math.min(Math.min(fx, 1 - fx) / cols, Math.min(fy, 1 - fy) / rows) + warp;
      const grout = 1 - clamp01((edge - 0.003) / 0.01);

      const tone = tones[row * (cols + 1) + col];
      const n1 = noise.fbm(u, v, 8, 5);
      const n2 = noise.fbm(u + 0.4, v + 0.9, 32, 2);
      const moss = clamp01((noise.fbm(u + 0.1, v * 0.7 + 0.3, 3, 4) - 0.5 + v * 0.25 - 0.1) * 3.5) * mossAmt;

      let r = lerp(0.36, 0.5, tone) * (0.7 + n1 * 0.55) + n2 * 0.05;
      let g = lerp(0.33, 0.45, tone) * (0.7 + n1 * 0.55) + n2 * 0.05;
      let b = lerp(0.28, 0.37, tone) * (0.7 + n1 * 0.5) + n2 * 0.04;
      const dark = grout * 0.75;
      r *= 1 - dark;
      g *= 1 - dark;
      b *= 1 - dark;
      r = lerp(r, 0.13, moss);
      g = lerp(g, 0.22, moss);
      b = lerp(b, 0.07, moss);

      const i = (y * size + x) * 4;
      writeRGB(aImg.data, i, clamp01(r), clamp01(g), clamp01(b));
      height[y * size + x] = clamp01(edge * 30) * 0.7 + n1 * 0.5 + n2 * 0.1;
      const ro = clamp01(0.85 + n2 * 0.12 - moss * 0.05);
      writeRGB(rImg.data, i, ro, ro, ro);
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  return { albedo, normal: heightToNormal(height, size, size, 3), rough };
}

// ---------- Natural cliff rock ----------
function cliffRock(size = 512, seed = 5) {
  const noise = new TileNoise(seed);
  const albedo = makeCanvas(size);
  const aCtx = albedo.getContext('2d');
  const aImg = aCtx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n = noise.fbm(u, v, 4, 6);
      const strata = Math.sin((v + n * 0.25) * Math.PI * 18) * 0.5 + 0.5;
      const moss = clamp01((noise.fbm(u + 0.3, v, 3, 4) - 0.48) * 3);
      let r = 0.34 + n * 0.25 + strata * 0.05;
      let g = 0.31 + n * 0.22 + strata * 0.04;
      let b = 0.27 + n * 0.18 + strata * 0.03;
      r = lerp(r, 0.14, moss * 0.85);
      g = lerp(g, 0.24, moss * 0.85);
      b = lerp(b, 0.08, moss * 0.85);
      writeRGB(aImg.data, (y * size + x) * 4, clamp01(r), clamp01(g), clamp01(b));
      height[y * size + x] = n + strata * 0.15;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  return { albedo, normal: heightToNormal(height, size, size, 5) };
}

// ---------- Tree bark ----------
function bark(size = 256, seed = 3) {
  const noise = new TileNoise(seed);
  const albedo = makeCanvas(size);
  const aCtx = albedo.getContext('2d');
  const aImg = aCtx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n = noise.fbm(u * 1, v * 0.25, 16, 4);
      const ridges = Math.pow(Math.abs(Math.sin((u * 12 + n * 2.5) * Math.PI)), 0.6);
      const r = 0.23 + ridges * 0.16 + n * 0.08;
      const g = 0.18 + ridges * 0.12 + n * 0.06;
      const b = 0.12 + ridges * 0.08 + n * 0.04;
      writeRGB(aImg.data, (y * size + x) * 4, r, g, b);
      height[y * size + x] = ridges * 0.8 + n * 0.4;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  return { albedo, normal: heightToNormal(height, size, size, 4) };
}

// ---------- Foliage card (alpha) ----------
function foliage(size = 512, seed = 11, palette = 'jungle') {
  const rnd = mulberry32(seed);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const hues = palette === 'jungle' ? [95, 125] : [70, 100];
  const count = 260;
  for (let i = 0; i < count; i++) {
    // Leaves cluster toward the middle of the card
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * size * 0.42;
    const x = size / 2 + Math.cos(a) * rr;
    const y = size / 2 + Math.sin(a) * rr * 0.85;
    const len = size * (0.035 + rnd() * 0.05);
    const wid = len * (0.32 + rnd() * 0.2);
    const rot = a + (rnd() - 0.5) * 1.4;
    const h = lerp(hues[0], hues[1], rnd());
    const s = 35 + rnd() * 30;
    const l = 14 + rnd() * 22 + (1 - rr / (size * 0.42)) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const grad = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
    grad.addColorStop(0, `hsl(${h}, ${s}%, ${l * 0.7}%)`);
    grad.addColorStop(1, `hsl(${h}, ${s}%, ${l * 1.25}%)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -wid, len / 2, 0);
    ctx.quadraticCurveTo(0, wid, -len / 2, 0);
    ctx.fill();
    // midrib
    ctx.strokeStyle = `hsla(${h}, ${s}%, ${l * 1.6}%, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(len / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
  return canvas;
}

// ---------- Jungle ground far below ----------
function jungleFloor(size = 256, seed = 17) {
  const noise = new TileNoise(seed);
  const albedo = makeCanvas(size);
  const aCtx = albedo.getContext('2d');
  const aImg = aCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = noise.fbm(u, v, 4, 5);
      const m = noise.fbm(u + 0.5, v + 0.5, 16, 3);
      writeRGB(aImg.data, (y * size + x) * 4, 0.08 + n * 0.1 + m * 0.04, 0.14 + n * 0.14 + m * 0.05, 0.05 + n * 0.05);
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  return { albedo };
}

// ---------- Soft radial sprite (fire, glow, dust) ----------
function radialSprite(size = 128) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

// ---------- Public API ----------
export function createTextures(onProgress = () => {}) {
  const T = {};
  const steps = [
    () => {
      // A single weathered slab, used per paving stone instance.
      const p = stonePaving(512, 7, 1, 1);
      T.path = {
        map: toTexture(p.albedo),
        normalMap: toTexture(p.normal, { srgb: false }),
        roughnessMap: toTexture(p.rough, { srgb: false }),
      };
    },
    () => {
      const w = rockBlocks(512, 21, { rows: 4, cols: 2, mossAmt: 0.6 });
      T.wall = {
        map: toTexture(w.albedo),
        normalMap: toTexture(w.normal, { srgb: false }),
        roughnessMap: toTexture(w.rough, { srgb: false }),
      };
    },
    () => {
      const w = rockBlocks(512, 33, { rows: 6, cols: 2, mossAmt: 0.8 });
      T.pillar = {
        map: toTexture(w.albedo),
        normalMap: toTexture(w.normal, { srgb: false }),
        roughnessMap: toTexture(w.rough, { srgb: false }),
      };
    },
    () => {
      const c = cliffRock(512, 5);
      T.cliff = { map: toTexture(c.albedo), normalMap: toTexture(c.normal, { srgb: false }) };
    },
    () => {
      const b = bark(256, 3);
      T.bark = { map: toTexture(b.albedo), normalMap: toTexture(b.normal, { srgb: false }) };
    },
    () => {
      T.leaves = toTexture(foliage(512, 11, 'jungle'));
      T.leavesDry = toTexture(foliage(512, 29, 'dry'));
    },
    () => {
      T.ground = toTexture(jungleFloor(256, 17).albedo);
      T.glow = toTexture(radialSprite(128));
    },
  ];
  steps.forEach((s, i) => {
    s();
    onProgress((i + 1) / steps.length);
  });
  return T;
}

export { mulberry32 };
