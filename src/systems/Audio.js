/**
 * Fully synthesized audio: a tribal drum score whose tempo follows the run,
 * jungle ambience, and all sound effects. No audio files are shipped.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('temple-run-muted') === '1';
    } catch {
      /* storage unavailable */
    }
    this.musicOn = false;
    this.tempo = 108;
    this.nextBeat = 0;
    this.beat = 0;
    this.coinCombo = 0;
    this.lastCoin = 0;
    this.growlLevel = 0;
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // Shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Simple convolution reverb for a big stone space
    this.reverb = ctx.createConvolver();
    const irLen = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.reverb.connect(wet).connect(this.master);

    this.buildAmbience();
    this.buildGrowl();
  }

  buildAmbience() {
    const ctx = this.ctx;
    // Wind through the canyon: slowly modulated band-passed noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(bp.frequency);
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.windGain = g;
  }

  buildGrowl() {
    // Continuous demon growl whose level follows how close the pack is
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 62;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 91;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 14;
    lfo.connect(lfoG).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(g).connect(this.sfxBus);
    osc.start();
    osc2.start();
    lfo.start();
    this.growl = g;
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('temple-run-muted', m ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ---------------------------------------------------------------------------
  // Primitive voices
  // ---------------------------------------------------------------------------
  env(gainNode, t, attack, decay, peak) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone({ freq, type = 'sine', t = this.ctx.currentTime, attack = 0.005, decay = 0.2, gain = 0.3, slide = null, bus = this.sfxBus, verb = false }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, decay, gain);
    o.connect(g).connect(bus);
    if (verb) g.connect(this.reverb);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  noiseHit({ t = this.ctx.currentTime, type = 'bandpass', freq = 1000, q = 1, attack = 0.002, decay = 0.1, gain = 0.3, sweep = null, bus = this.sfxBus, verb = false }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, decay, gain);
    src.connect(f).connect(g).connect(bus);
    if (verb) g.connect(this.reverb);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Music: layered tribal drums, scheduled ahead of time
  // ---------------------------------------------------------------------------
  startMusic() {
    if (!this.ctx) return;
    this.musicOn = true;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beat = 0;
    this.musicBus.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.3);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
  }

  scheduleMusic() {
    const ctx = this.ctx;
    const spb = 60 / this.tempo / 4; // 16th notes
    while (this.nextBeat < ctx.currentTime + 0.15) {
      const t = this.nextBeat;
      const step = this.beat % 16;
      const bar = Math.floor(this.beat / 16) % 4;
      const bus = this.musicBus;
      // Deep tom / taiko
      if (step === 0 || step === 7 || step === 10 || (bar === 3 && step === 14)) {
        this.tone({ freq: 95, slide: 42, t, attack: 0.003, decay: 0.35, gain: 0.7, bus, verb: true });
        this.noiseHit({ t, type: 'lowpass', freq: 300, decay: 0.08, gain: 0.25, bus });
      }
      // Mid toms
      if (step === 4 || step === 12) this.tone({ freq: 180, slide: 110, t, decay: 0.18, gain: 0.35, bus, verb: true });
      if (bar % 2 === 1 && (step === 13 || step === 15)) this.tone({ freq: 220, slide: 140, t, decay: 0.12, gain: 0.25, bus });
      // Shaker on every 16th with accents
      this.noiseHit({ t, type: 'highpass', freq: 6000, decay: 0.035, gain: step % 4 === 2 ? 0.07 : 0.03, bus });
      // Wooden click
      if (step % 8 === 6) this.tone({ freq: 900, type: 'triangle', t, decay: 0.04, gain: 0.12, bus });
      // A haunting flute-like drone note every other bar
      if (step === 0 && bar % 2 === 0) {
        const notes = [220, 196, 233.1, 174.6];
        const n = notes[Math.floor(this.beat / 32) % notes.length];
        this.tone({ freq: n, type: 'sine', t, attack: 0.4, decay: 2.6, gain: 0.07, bus, verb: true });
        this.tone({ freq: n * 1.5, type: 'sine', t: t + 0.05, attack: 0.5, decay: 2.2, gain: 0.03, bus, verb: true });
      }
      this.nextBeat += spb;
      this.beat++;
    }
  }

  // ---------------------------------------------------------------------------
  // Sound effects
  // ---------------------------------------------------------------------------
  coin() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.coinCombo = now - this.lastCoin < 0.35 ? Math.min(this.coinCombo + 1, 12) : 0;
    this.lastCoin = now;
    const base = 1320 * Math.pow(2, this.coinCombo / 24);
    this.tone({ freq: base, type: 'sine', attack: 0.002, decay: 0.12, gain: 0.16 });
    this.tone({ freq: base * 1.5, type: 'sine', t: now + 0.05, attack: 0.002, decay: 0.2, gain: 0.12, verb: true });
  }

  jump() {
    if (!this.ctx) return;
    this.noiseHit({ type: 'bandpass', freq: 500, sweep: 2200, q: 1.2, attack: 0.02, decay: 0.22, gain: 0.25 });
    this.tone({ freq: 160, slide: 260, type: 'triangle', decay: 0.12, gain: 0.1 });
  }

  slide() {
    if (!this.ctx) return;
    this.noiseHit({ type: 'lowpass', freq: 1800, sweep: 400, q: 0.7, attack: 0.01, decay: 0.45, gain: 0.3 });
  }

  land() {
    if (!this.ctx) return;
    this.tone({ freq: 110, slide: 50, decay: 0.12, gain: 0.35 });
    this.noiseHit({ type: 'lowpass', freq: 700, decay: 0.07, gain: 0.25 });
  }

  step() {
    if (!this.ctx) return;
    this.noiseHit({ type: 'bandpass', freq: 900 + Math.random() * 300, q: 1.5, decay: 0.05, gain: 0.08 });
    this.tone({ freq: 70, decay: 0.06, gain: 0.12 });
  }

  turn() {
    if (!this.ctx) return;
    this.noiseHit({ type: 'bandpass', freq: 1400, sweep: 500, q: 2, attack: 0.02, decay: 0.2, gain: 0.18 });
  }

  stumble() {
    if (!this.ctx) return;
    this.tone({ freq: 90, slide: 40, decay: 0.3, gain: 0.5, verb: true });
    this.roar(0.5);
  }

  roar(gain = 0.6) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 140, slide: 70, type: 'sawtooth', t, attack: 0.05, decay: 0.7, gain: gain * 0.35, verb: true });
    this.noiseHit({ t, type: 'bandpass', freq: 700, sweep: 300, q: 3, attack: 0.05, decay: 0.7, gain: gain * 0.4, verb: true });
  }

  powerup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [660, 880, 1100, 1320].forEach((f, i) => this.tone({ freq: f, type: 'triangle', t: t + i * 0.06, decay: 0.25, gain: 0.14, verb: true }));
  }

  shieldBreak() {
    if (!this.ctx) return;
    this.noiseHit({ type: 'highpass', freq: 3000, decay: 0.4, gain: 0.3, verb: true });
    this.tone({ freq: 1200, slide: 300, type: 'triangle', decay: 0.3, gain: 0.15 });
  }

  death(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 70, slide: 30, t, attack: 0.005, decay: 1.2, gain: 0.8, verb: true });
    this.noiseHit({ t, type: 'lowpass', freq: 1200, sweep: 100, decay: 0.8, gain: 0.5, verb: true });
    if (kind === 'fall') this.noiseHit({ t, type: 'bandpass', freq: 2500, sweep: 300, q: 0.8, attack: 0.1, decay: 1.6, gain: 0.25 });
    if (kind === 'caught') this.roar(1);
    this.stopMusic();
  }

  // ---------------------------------------------------------------------------
  update(dt, { speed = 0, danger = 0, running = false } = {}) {
    if (!this.ctx) return;
    const target = 104 + Math.max(0, speed - 10) * 2.6;
    this.tempo += (target - this.tempo) * Math.min(1, dt * 0.5);
    if (this.musicOn) this.scheduleMusic();
    const g = running ? danger * 0.22 : 0;
    this.growl.gain.setTargetAtTime(g, this.ctx.currentTime, 0.2);
  }
}
