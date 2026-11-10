// Fully procedural WebAudio: a layered synthwave sequencer whose intensity follows
// the action, plus every sound effect. No audio files.
const NOTE = (semi) => 55 * Math.pow(2, semi / 12); // A1 = 55 Hz
// i - VI - III - VII in natural minor (root offsets + triads)
const PROG = [
  { root: 0, chord: [0, 3, 7] },
  { root: -4, chord: [-4, 0, 3] },
  { root: 3, chord: [3, 7, 10] },
  { root: -2, chord: [-2, 2, 5] },
];
const PENTA = [0, 3, 5, 7, 10, 12, 15];

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicOn = true;
    this.intensity = 0.15;
    this.targetIntensity = 0.15;
    this.tempo = 104;
    this.rootShift = 0;
    this.step = 0;
    this.nextTime = 0;
    this.loops = {};
    this.seed = 1;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    // echo send for leads/arps
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.32;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.musicBus);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // rain bed
    this.rain = this.loop('rain', 'bandpass', 5200, 0.4);
    this.wind = this.loop('wind', 'lowpass', 500, 0.6);
    this.loop('slide', 'bandpass', 1600, 1.4);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 40);
  }

  loop(name, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start();
    return (this.loops[name] = { f, g });
  }
  setLoop(name, gain, freq) {
    const l = this.loops[name];
    if (!l) return;
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(gain, t, 0.08);
    if (freq) l.f.frequency.setTargetAtTime(freq, t, 0.08);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  setSong(tempo, rootShift) { this.tempo = tempo; this.rootShift = rootShift; this.delay && (this.delay.delayTime.value = (60 / tempo) * 0.75); }
  setIntensity(v) { this.targetIntensity = v; }
  setRain(a) { this.setLoop('rain', a * 0.09, 5200); }
  duck(on) { if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.2 : 0.55, this.ctx.currentTime, 0.15); }

  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  // ---- synth voices ----
  tone(bus, type, freq, t, dur, vol, o = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t + (o.slideTime || dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t); f.Q.value = o.q ?? 1;
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur);
      node = osc.connect(f);
    }
    node.connect(g);
    g.connect(bus);
    if (o.echo) { const s = ctx.createGain(); s.gain.value = o.echo; g.connect(s).connect(this.delay); }
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  noise(bus, t, dur, vol, type, freq, o = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = o.q ?? 0.8;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  // ---- sequencer (16th-note grid, 4 bars = one chord cycle) ----
  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.intensity += (this.targetIntensity - this.intensity) * 0.06;
    const spb = 60 / this.tempo / 4;
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.18) {
      if (this.musicOn) this.playStep(this.step, this.nextTime, spb);
      this.step++;
      this.nextTime += spb;
    }
  }
  playStep(step, t, spb) {
    const I = this.intensity, bus = this.musicBus, rs = this.rootShift;
    const s16 = step % 16, bar = Math.floor(step / 16) % 4, beat = s16 % 4;
    const ch = PROG[bar];
    // pad: one soft chord per bar
    if (s16 === 0) {
      for (const n of ch.chord) {
        this.tone(bus, 'sawtooth', NOTE(n + 24 + rs), t, spb * 16.5, 0.035, { attack: 0.5, lp: 500 + I * 900, detune: -7 });
        this.tone(bus, 'sawtooth', NOTE(n + 24 + rs), t, spb * 16.5, 0.035, { attack: 0.5, lp: 500 + I * 900, detune: 8 });
      }
    }
    // bass: driving 8ths when intense, long notes when calm
    if (I > 0.3 ? s16 % 2 === 0 : s16 === 0 || s16 === 10) {
      const oct = I > 0.3 && s16 % 8 === 6 ? 12 : 0;
      this.tone(bus, 'sawtooth', NOTE(ch.root + 12 + oct + rs), t, I > 0.3 ? spb * 1.8 : spb * 7, 0.16, { lp: 380 + I * 500, lpTo: 140, q: 4 });
      this.tone(bus, 'sine', NOTE(ch.root + rs + 12), t, spb * 2, 0.14);
    }
    // drums
    if (I > 0.22) {
      const four = I > 0.7;
      if (beat === 0 && (four || s16 === 0 || s16 === 8 || (s16 === 12 && bar === 3))) {
        this.tone(bus, 'sine', 150, t, 0.22, 0.5, { slideTo: 42, slideTime: 0.12 });
      }
      if (s16 === 4 || s16 === 12) {
        if (I > 0.4) {
          this.noise(bus, t, 0.16, 0.22, 'bandpass', 1800, { q: 0.7 });
          this.tone(bus, 'triangle', 190, t, 0.09, 0.12, { slideTo: 120 });
        }
      }
      const hat = I > 0.75 ? true : s16 % 2 === 0;
      if (hat) this.noise(bus, t, s16 % 4 === 2 ? 0.07 : 0.03, 0.05 + (s16 % 4 === 2 ? 0.03 : 0), 'highpass', 8000);
    }
    // arp
    if (I > 0.45) {
      const pat = [0, 1, 2, 1, 0, 2, 1, 2];
      const n = ch.chord[pat[s16 % 8]] + 36 + (s16 % 16 >= 8 ? 12 : 0) + rs;
      this.tone(bus, 'square', NOTE(n), t, spb * 0.9, 0.035, { lp: 1400 + I * 2200, lpTo: 500, echo: 0.5 });
    }
    // lead: seeded pentatonic phrase on top at high intensity
    if (I > 0.72 && s16 % 2 === 0) {
      if (s16 === 0) this.seed = 97 + bar * 31 + (Math.floor(step / 64) % 2) * 7;
      if (this.rnd() < 0.62) {
        const n = PENTA[Math.floor(this.rnd() * PENTA.length)] + 48 + rs;
        this.tone(bus, 'sawtooth', NOTE(n), t, spb * (this.rnd() < 0.3 ? 4 : 1.8), 0.045, { lp: 2600, lpTo: 900, echo: 0.6, attack: 0.01 });
      }
    }
  }

  // ---- sound effects ----
  get ok() { return this.ctx && this.ctx.state === 'running'; }
  get now() { return this.ctx.currentTime; }
  jump() { if (!this.ok) return; this.tone(this.sfxBus, 'square', 260, this.now, 0.14, 0.1, { slideTo: 620, lp: 1800 }); }
  land(v = 1) { if (!this.ok) return; this.noise(this.sfxBus, this.now, 0.14, 0.16 * v, 'lowpass', 500, { to: 90 }); this.tone(this.sfxBus, 'sine', 110, this.now, 0.12, 0.2 * v, { slideTo: 50 }); }
  pad() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'sawtooth', 120, t, 0.5, 0.2, { slideTo: 900, lp: 3000 }); this.noise(this.sfxBus, t, 0.5, 0.15, 'bandpass', 600, { to: 5000 }); }
  grapple() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'sawtooth', 900, t, 0.25, 0.12, { slideTo: 2400, lp: 5000 }); this.noise(this.sfxBus, t, 0.2, 0.12, 'highpass', 3000); }
  release() { if (!this.ok) return; this.tone(this.sfxBus, 'triangle', 700, this.now, 0.12, 0.12, { slideTo: 300 }); }
  deny() { if (!this.ok) return; this.tone(this.sfxBus, 'square', 140, this.now, 0.1, 0.08, { lp: 800 }); }
  pickup(combo = 0) {
    if (!this.ok) return;
    const t = this.now, n = PENTA[Math.min(combo, 20) % PENTA.length] + 48 + Math.floor(Math.min(combo, 20) / PENTA.length) * 12;
    this.tone(this.sfxBus, 'triangle', NOTE(n), t, 0.16, 0.16);
    this.tone(this.sfxBus, 'sine', NOTE(n + 12), t + 0.05, 0.2, 0.1);
  }
  chrono() { if (!this.ok) return; const t = this.now; [0, 4, 7, 12, 16].forEach((n, i) => this.tone(this.sfxBus, 'triangle', NOTE(n + 48), t + i * 0.05, 0.25, 0.14)); }
  trick() { if (!this.ok) return; this.tone(this.sfxBus, 'sine', 880, this.now, 0.1, 0.07, { slideTo: 1320 }); }
  deliver() {
    if (!this.ok) return;
    const t = this.now;
    [0, 7, 12, 16, 19, 24].forEach((n, i) => { this.tone(this.sfxBus, 'square', NOTE(n + 36), t + i * 0.07, 0.4, 0.12, { lp: 3000 }); this.tone(this.sfxBus, 'triangle', NOTE(n + 48), t + i * 0.07, 0.5, 0.12); });
    this.noise(this.sfxBus, t, 0.6, 0.12, 'highpass', 5000);
  }
  checkpoint() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'triangle', NOTE(43), t, 0.18, 0.13); this.tone(this.sfxBus, 'triangle', NOTE(50), t + 0.09, 0.3, 0.13); }
  alert() { if (!this.ok) return; const t = this.now; for (let i = 0; i < 2; i++) this.tone(this.sfxBus, 'square', 1040, t + i * 0.12, 0.08, 0.09, { lp: 3000 }); }
  charge(dur = 0.8) { if (!this.ok) return; this.tone(this.sfxBus, 'sawtooth', 180, this.now, dur, 0.09, { slideTo: 1400, lp: 2500, attack: dur * 0.6 }); }
  shot() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'sawtooth', 1800, t, 0.2, 0.16, { slideTo: 200, lp: 5000 }); this.noise(this.sfxBus, t, 0.12, 0.14, 'highpass', 2000); }
  zap() { if (!this.ok) return; const t = this.now; this.noise(this.sfxBus, t, 0.35, 0.3, 'bandpass', 2500, { to: 300, q: 2 }); this.tone(this.sfxBus, 'square', 90, t, 0.3, 0.22, { slideTo: 40, lp: 900 }); }
  explode(v = 1) { if (!this.ok) return; const t = this.now; this.noise(this.sfxBus, t, 0.7 * v, 0.5 * v, 'lowpass', 1400, { to: 60 }); this.tone(this.sfxBus, 'sine', 90, t, 0.5 * v, 0.5 * v, { slideTo: 28 }); }
  roar() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'sawtooth', 70, t, 1.4, 0.3, { slideTo: 38, lp: 500, lpTo: 1800, q: 6, attack: 0.2 }); this.tone(this.sfxBus, 'sawtooth', 74, t, 1.4, 0.25, { slideTo: 41, lp: 600, attack: 0.2 }); this.noise(this.sfxBus, t, 1.2, 0.18, 'bandpass', 300, { to: 900, attack: 0.3 }); }
  wave() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'sine', 60, t, 0.9, 0.5, { slideTo: 30 }); this.noise(this.sfxBus, t, 0.9, 0.25, 'bandpass', 200, { to: 2400 }); }
  fall() { if (!this.ok) return; this.tone(this.sfxBus, 'sawtooth', 500, this.now, 0.5, 0.12, { slideTo: 70, lp: 1500 }); }
  countdown(go) { if (!this.ok) return; this.tone(this.sfxBus, 'square', go ? 880 : 440, this.now, go ? 0.5 : 0.14, 0.14, { lp: 2500 }); }
  tick() { if (!this.ok) return; this.tone(this.sfxBus, 'square', 1500, this.now, 0.04, 0.07, { lp: 4000 }); }
  ui() { if (!this.ok) return; this.tone(this.sfxBus, 'triangle', 660, this.now, 0.07, 0.1, { slideTo: 990 }); }
  thunder() { if (!this.ok) return; const t = this.now + 0.25; this.noise(this.sfxBus, t, 2.6, 0.5, 'lowpass', 900, { to: 50, attack: 0.05 }); }
  meow() { if (!this.ok) return; const t = this.now; this.tone(this.sfxBus, 'sawtooth', 620, t, 0.45, 0.14, { slideTo: 880, slideTime: 0.15, lp: 2200, q: 8, attack: 0.04 }); this.tone(this.sfxBus, 'sawtooth', 880, t + 0.15, 0.4, 0.12, { slideTo: 480, lp: 1800, q: 8, attack: 0.02 }); }
  win() { if (!this.ok) return; const t = this.now; [0, 4, 7, 12, 7, 12, 16, 24].forEach((n, i) => { this.tone(this.sfxBus, 'square', NOTE(n + 36), t + i * 0.11, 0.5, 0.12, { lp: 2600 }); this.tone(this.sfxBus, 'sawtooth', NOTE(n + 24), t + i * 0.11, 0.5, 0.08, { lp: 1200 }); }); }
  lose() { if (!this.ok) return; const t = this.now; [12, 10, 7, 3, 0].forEach((n, i) => this.tone(this.sfxBus, 'sawtooth', NOTE(n + 24), t + i * 0.16, 0.5, 0.14, { lp: 1200 })); }
}
