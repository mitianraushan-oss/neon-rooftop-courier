// Game orchestration: state machine, level flow, scoring, and the frame loop.
import * as THREE from 'three';
import { Gfx } from './gfx.js';
import { Env, SKIES } from './env.js';
import { World } from './world.js';
import { generateRoute } from './route.js';
import { LEVELS } from './levels.js';
import { GameAudio } from './audio.js';
import { UI, loadSave, writeSave } from './ui.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Bot } from './bot.js';
import { Drones } from './drones.js';
import { Boss } from './boss.js';
import { clamp } from './util.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const HINTS = {
  start: ['<b>WASD</b> move &middot; <b>Mouse</b> look &middot; <b>Space</b> jump. Follow the green arrow.', 'Left stick to run, drag right side to look, <b>JUMP</b> to leap. Follow the green arrow.'],
  barrier: ['Hold <b>Shift</b> while running to slide under striped ducts.', 'Hold <b>SLIDE</b> while running to get under striped ducts.'],
  pad: ['Step on the glowing <b>launch pad</b> - it does the rest.', 'Step on the glowing <b>launch pad</b> - it does the rest.'],
  wallrun: ['Jump along the <b>neon billboard</b> to wall-run. <b>Space</b> again to kick off.', 'Jump along the <b>neon billboard</b> to wall-run. <b>JUMP</b> again to kick off.'],
  grapple: ['Jump, look at the <b>yellow buoy</b> and press <b>E</b> (or click) to grapple.', 'Jump, face the <b>yellow buoy</b> and tap <b>HOOK</b> to grapple.'],
  drone: ['Drones cost you seconds. Stay out of the light cone or outrun them.', 'Drones cost you seconds. Stay out of the light cone or outrun them.'],
  boss: ['<b>WARDEN-9</b> punishes standing still. Jump its shockwaves. Keep moving!', '<b>WARDEN-9</b> punishes standing still. Jump its shockwaves. Keep moving!'],
};

class Game {
  constructor() {
    this.save = loadSave();
    this.gfx = new Gfx($('game'));
    this.scene = this.gfx.scene;
    this.env = new Env(this.scene, this.gfx.renderer);
    this.audio = new GameAudio();
    this.fx = new FX(this.scene);
    this.player = new Player(this.scene, this.fx, (t, d) => this.onPlayer(t, d));
    this.rig = new CameraRig(this.gfx.camera);
    this.input = new Input($('game'));
    this.hud = new HUD();
    this.bot = params.has('bot') ? new Bot(this) : null;
    this.manual = params.has('test'); // tests step the simulation themselves
    this.state = 'boot';
    this.clock = 0; this.time = 0; this.score = 0; this.shownScore = 0;
    this.combo = 0; this.comboT = 0; this.mult = 1;
    this.world = null; this.drones = null; this.boss = null; this.levelIdx = -1;
    this.inp = { wx: 0, wz: 0, jump: false, jumpHeld: false, slide: false, grapple: false, ax: 0, ay: 0, az: 1 };
    this.stats = { fps: 60 };

    this.gfx.onQuality = (q) => { this.env.setQuality(q); };
    this.gfx.onResize = () => this.fx.setViewport(this.gfx.pixelH);
    this.gfx.setQuality(this.save.settings.quality);
    this.fx.setViewport(this.gfx.pixelH);
    this.env.onThunder = () => { this.audio.thunder(); this.rig.shake(0.15); };
    this.applySettings();

    this.ui = new UI(this.save, {
      sound: () => { this.audio.init(); this.audio.ui(); },
      start: (i) => this.begin(i),
      resume: () => this.resume(),
      restart: () => this.begin(this.levelIdx),
      quit: (to) => this.toTitle(to),
      next: () => this.begin(Math.min(this.levelIdx + 1, LEVELS.length - 1)),
      pause: () => this.pause(),
      settings: () => this.applySettings(),
    });
    this.input.onLockLost = () => this.pause();
    this.input.onMode = () => this.syncTouch();
    window.addEventListener('pointerdown', () => { this.audio.init(); this.audio.setRain(this.cfg ? this.cfg.rain : 0.4); }, { once: true });
    window.addEventListener('keydown', (e) => {
      this.audio.init();
      if (e.code === 'Escape' && this.state === 'paused') this.resume();
      if (e.code === 'KeyR' && (this.state === 'play' || this.state === 'gameover')) this.begin(this.levelIdx);
      if (e.code === 'KeyM') { this.save.settings.music = this.save.settings.music ? 0 : 1; this.applySettings(); }
    });

    this.loadLevel(params.has('level') ? clamp(+params.get('level') - 1, 0, LEVELS.length - 1) : 0);
    if (params.has('level')) this.startPlay(true);
    else this.toTitle();
    $('boot').classList.add('done');
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  applySettings() {
    const s = this.save.settings;
    this.gfx.setQuality(s.quality);
    this.audio.setVolume(s.volume / 100);
    this.audio.musicOn = !!s.music;
    this.input.sens = s.sens / 100;
    this.input.invert = !!s.invert;
    this.rig.shakeOn = !!s.shake;
  }
  syncTouch() {
    const touch = this.input.mode === 'touch';
    $('touch').classList.toggle('hidden', !(touch && (this.state === 'play' || this.state === 'intro')));
    this.rig.assist = this.input.mode !== 'kbm';
  }

  // ---------- level lifecycle ----------
  loadLevel(i) {
    const cfg = (this.cfg = LEVELS[i]);
    this.levelIdx = i;
    if (this.world) this.world.dispose();
    if (this.drones) this.drones.dispose();
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    this.fx.clear();
    this.route = generateRoute(cfg);
    this.env.setSky(cfg.sky, cfg.rain);
    this.world = new World(this.scene, this.route, this.gfx.level);
    this.drones = new Drones(this.scene, this.route, this);
    if (cfg.boss) this.boss = new Boss(this.scene, this);
    this.audio.setSong(cfg.tempo, cfg.root);
    if (this.audio.ctx) this.audio.setRain(cfg.rain);
    this.time = cfg.time; this.score = 0; this.shownScore = 0;
    this.combo = 0; this.comboT = 0; this.mult = 1; this.bestCombo = 0;
    this.delivered = 0; this.shards = 0; this.cat = false; this.respawns = 0;
    this.cp = 0; this.curPlat = 0; this.onPlat = 0; this.reached = 0;
    this.hinted = {}; this.slowT = 0; this.tickAt = 10;
    this.setTarget();
    this.spawnAt(0);
    this.hud.set('levelName', `${cfg.id} / ${cfg.name}`);
    this.hud.boss(cfg.boss ? 0.5 : null);
    this.hud.prompt('');
    if (this.bot) this.bot.reset();
  }

  spawnAt(i) {
    const p = this.route.plats[i], d = p.outDir || p.inDir;
    let x = p.x, z = p.z;
    if (i > 0) { x -= p.inDir.x * Math.max(0, p.hx - 3); z -= p.inDir.z * Math.max(0, p.hz - 3); }
    const yaw = Math.atan2(i > 0 ? p.inDir.x : d.x, i > 0 ? p.inDir.z : d.z);
    this.player.reset(x, p.top + 0.05, z, yaw);
    this.rig.snap(this.player, yaw);
    this.lastTop = p.top; this.curPlat = i; this.onPlat = i;
  }

  setTarget() {
    this.target = null;
    for (const d of this.world.deliveries) { d.active = false; }
    for (const d of this.world.deliveries) if (!d.done) { d.active = true; this.target = d; break; }
  }

  begin(i) {
    this.audio.init();
    $('fade').classList.add('on');
    this.state = 'loading';
    this.ui.hide();
    setTimeout(() => {
      this.loadLevel(i);
      this.startPlay(false);
      $('fade').classList.remove('on');
    }, 380);
  }

  startPlay(skipIntro) {
    this.ui.hide();
    this.hud.show(true);
    this.input.setActive(true);
    if (!this.manual) this.input.lock();
    this.audio.duck(false);
    this.audio.setIntensity(this.cfg.boss ? 0.85 : 0.5);
    if (skipIntro) { this.state = 'play'; this.onGo(); }
    else { this.state = 'intro'; this.introT = 2.4; this.introN = 4; }
    this.syncTouch();
  }
  onGo() {
    this.hint('start');
    if (this.boss) { this.boss.start(); this.hud.toast('WARDEN-9 ONLINE', '#ff3b3b', 'RUN'); this.audio.roar(); this.rig.shake(0.6); }
  }

  toTitle(screen = 'title') {
    this.state = 'title';
    this.hud.show(false);
    this.input.setActive(false);
    this.audio.setIntensity(0.15);
    this.audio.duck(false);
    this.audio.setLoop('slide', 0); this.audio.setLoop('wind', 0);
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    this.hud.boss(null);
    const p = this.route.plats[1];
    this.player.reset(p.x - 2, p.top, p.z - p.hz + 1.2, Math.PI);
    this.player.grounded = true;
    this.ui.show(screen);
    this.syncTouch();
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'intro') return;
    this.prev = this.state;
    this.state = 'paused';
    this.input.setActive(false);
    this.audio.duck(true);
    this.audio.setLoop('slide', 0); this.audio.setLoop('wind', 0);
    this.ui.show('pause');
    this.syncTouch();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.ui.hide();
    this.state = this.prev;
    this.input.setActive(true);
    this.input.lock();
    this.audio.duck(false);
    this.syncTouch();
  }

  hint(key) {
    if (this.hinted[key] || this.bot) return;
    this.hinted[key] = true;
    this.hud.hint(HINTS[key][this.input.mode === 'touch' ? 1 : 0], 6);
  }

  // ---------- scoring ----------
  trick(name, pts) {
    this.combo++;
    this.comboT = 4.5;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const m = 1 + 0.5 * Math.min(6, Math.floor(this.combo / 5));
    if (m > this.mult) { this.hud.flash('comboX', 'bump', 260); this.audio.trick(); }
    this.mult = m;
    this.score += Math.round(pts * m);
    if (name) this.hud.set('comboName', name);
    this.hud.flash('score', 'bump', 120);
  }
  addTime(s) { this.time += s; this.hud.flash('timer', s > 0 ? 'gain' : 'loss', 350); this.tickAt = Math.min(10, Math.floor(this.time)); }

  // Something hurt the courier: lose seconds, get shoved, brief invulnerability.
  hit(seconds, fromX, fromZ, label = 'ZAPPED') {
    const pl = this.player;
    if (pl.invuln > 0 || this.state !== 'play') return false;
    this.addTime(-seconds);
    pl.invuln = 1.3;
    let dx = pl.p.x - fromX, dz = pl.p.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    pl.v.x += (dx / l) * 6; pl.v.z += (dz / l) * 6; pl.v.y = Math.max(pl.v.y, 5);
    pl.gr.on = false; pl.wr.on = false;
    this.combo = 0; this.mult = 1; this.comboT = 0;
    this.rig.shake(0.7);
    this.hud.damage();
    this.hud.toast(`-${seconds}s`, '#ff3b3b', label);
    this.audio.zap();
    this.fx.burst(pl.p.x, pl.p.y + 1, pl.p.z, 0xff4040, { count: 26, speed: 9, size: 0.5, life: 0.5 });
    this.slowT = 0.12;
    return true;
  }

  respawn(text) {
    this.respawns++;
    this.addTime(-3);
    this.combo = 0; this.mult = 1; this.comboT = 0;
    this.spawnAt(this.cp);
    this.player.invuln = 1.6;
    this.hud.toast('-3s', '#ff3b3b', text);
    this.audio.fall();
    this.hud.damage();
    if (this.boss) this.boss.resetBehind();
    if (this.bot) this.bot.reset();
  }

  // ---------- player events -> juice ----------
  onPlayer(type, d) {
    const p = this.player.p, a = this.audio, fx = this.fx, trim = SKIES[this.cfg.sky].trimA;
    if (this.state === 'title') return;
    switch (type) {
      case 'jump': a.jump(); fx.burst(p.x, p.y + 0.1, p.z, 0xbfe8ff, { count: 8, speed: 3, flat: true, size: 0.3, life: 0.35, grav: 0 }); break;
      case 'land':
        a.land(clamp(d.speed / 20, 0.3, 1.2));
        fx.burst(p.x, p.y + 0.1, p.z, 0xbfe8ff, { count: 6 + Math.min(18, d.speed), speed: 2 + d.speed * 0.25, flat: true, size: 0.32, life: 0.4, grav: 0 });
        if (d.speed > 14) { fx.ring(p.x, p.y, p.z, trim, 0.4, 2 + d.speed * 0.12, 0.4); this.rig.shake(clamp((d.speed - 12) / 30, 0, 0.5)); }
        if (d.air > 1.25) { this.trick('BIG AIR', 40); }
        break;
      case 'slide': a.setLoop('slide', 0.22, 1600); break;
      case 'slideEnd': a.setLoop('slide', 0); break;
      case 'duct': this.trick('DUCT SLIDE', 60); break;
      case 'wallrun': this.trick('WALL RUN', 40); a.trick(); break;
      case 'walljump': a.jump(); this.trick('WALL KICK', 25); fx.burst(p.x, p.y + 0.8, p.z, trim, { count: 14, speed: 6, size: 0.4, life: 0.4 }); break;
      case 'grapple': a.grapple(); this.trick('HOOK', 40); fx.burst(d.x, d.y, d.z, 0xffd23f, { count: 16, speed: 5, size: 0.45, life: 0.4, grav: 0 }); break;
      case 'release': a.release(); break;
      case 'deny': a.deny(); break;
      case 'mantle': a.land(0.4); fx.burst(p.x, p.y, p.z, 0xbfe8ff, { count: 6, speed: 2, flat: true, size: 0.3, life: 0.3, grav: 0 }); break;
      case 'pad':
        a.pad(); this.rig.shake(0.3); this.trick('LAUNCH', 30);
        fx.ring(d.x, d.y, d.z, SKIES[this.cfg.sky].trimB, 0.5, 5, 0.5);
        fx.burst(d.x, d.y + 0.3, d.z, SKIES[this.cfg.sky].trimB, { count: 30, speed: 9, up: 8, size: 0.5, life: 0.6 });
        break;
    }
  }

  // ---------- simulation ----------
  step(dt) {
    this.clock += dt;
    const pl = this.player, st = this.state;
    if (st === 'title' || st === 'loading' || st === 'boot') {
      this.titleCam(dt);
      pl.speed = 0;
      pl.syncModel(dt, this.clock);
    } else if (st === 'intro') {
      const before = Math.ceil(this.introT / 0.6);
      this.introT -= dt;
      const n = Math.ceil(this.introT / 0.6);
      if (n !== before || this.introN === 4) {
        this.introN = n;
        this.hud.countdown(n > 0 ? String(n) : 'GO!');
        this.audio.countdown(n <= 0);
      }
      const s = this.input.poll(dt);
      this.rig.update(dt, pl, this.world, s.lookX, s.lookY);
      pl.syncModel(dt, this.clock);
      if (this.introT <= 0) { this.state = 'play'; this.onGo(); setTimeout(() => this.hud.countdown(''), 700); }
    } else if (st === 'play') {
      if (this.slowT > 0) { this.slowT -= dt; dt *= 0.3; }
      this.play(dt);
    } else if (st === 'ending') {
      this.endT -= dt;
      const sdt = dt * 0.35;
      this.inp.wx = this.inp.wz = 0; this.inp.jump = this.inp.grapple = this.inp.slide = false;
      pl.update(sdt, this.inp, this.world);
      pl.syncModel(sdt, this.clock);
      this.rig.update(dt, pl, this.world, dt * 0.9, 0);
      if (this.boss) this.boss.update(sdt, this);
      if (this.endT <= 0) this.results();
    }
    if (st !== 'paused') {
      this.world.update(dt, pl.p);
      this.fx.update(dt);
      this.env.update(dt, this.gfx.camera.position, pl.p);
      if (this.drones && st !== 'play') this.drones.update(dt, this, true);
    }
  }

  titleCam(dt) {
    const p = this.route.plats[1], t = this.clock, c = this.gfx.camera;
    const a = t * 0.06 + 2.2;
    c.position.set(p.x + Math.sin(a) * 9, p.top + 3.2 + Math.sin(t * 0.13) * 0.8, p.z - p.hz - 7 + Math.cos(a) * 3);
    c.lookAt(p.x + 6, p.top + 5.5, p.z + 40);
    if (c.fov !== 62) { c.fov = 62; c.updateProjectionMatrix(); }
  }

  play(dt) {
    const pl = this.player, w = this.world, R = this.route, inp = this.inp;
    const s = this.input.poll(dt);
    if (s.pause) { this.pause(); return; }
    // camera-relative wish direction
    const yaw = this.rig.yaw, cp = Math.cos(this.rig.pitch);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    inp.wx = fx * s.moveY - fz * s.moveX; inp.wz = fz * s.moveY + fx * s.moveX;
    inp.jump = s.jump; inp.jumpHeld = s.jumpHeld; inp.slide = s.slide; inp.grapple = s.grapple;
    inp.ax = fx * cp; inp.ay = Math.sin(this.rig.pitch) + 0.3; inp.az = fz * cp;
    let lookX = s.lookX, lookY = s.lookY;
    if (this.bot) {
      Object.assign(inp, this.bot.think());
      if (Math.hypot(inp.wx, inp.wz) > 0.1) lookX = -clamp(Math.atan2(Math.sin(Math.atan2(inp.wx, inp.wz) - yaw), Math.cos(Math.atan2(inp.wx, inp.wz) - yaw)), -1, 1) * 3 * dt;
    }
    pl.update(dt, inp, w);

    // ---- where are we standing? ----
    if (pl.grounded && pl.groundBox) {
      const b = pl.groundBox;
      if (!b.route) { this.respawn('OFF ROUTE'); return; }
      this.lastTop = pl.p.y;
      if (b.kind === 'roof' && b.plat >= 0) {
        const i = b.plat, p = R.plats[i];
        this.onPlat = i;
        if (i !== this.curPlat) {
          this.curPlat = i;
          if (i > this.reached) {
            this.reached = i;
            this.env.setProgress(i / (R.plats.length - 1));
            const L = R.links[i];
            if (p.barrier) this.hint('barrier');
            else if (L && L.type !== 'jump') this.hint(L.type);
            if (this.drones.onPlat(i)) this.hint('drone');
            if (this.boss && i === 2) this.hint('boss');
          }
          if (p.checkpoint && i > this.cp) {
            this.cp = i;
            if (!p.delivery) { this.audio.checkpoint(); this.hud.toast('CHECKPOINT', '#19f0ff'); this.fx.ring(pl.p.x, p.top, pl.p.z, 0x19f0ff, 0.5, 6, 0.6); }
          }
        }
      }
    } else this.onPlat = -2;
    if (pl.p.y < this.lastTop - 17 || pl.p.y < 4) { this.respawn('FELL'); return; }

    // ---- deliveries ----
    const t = this.target;
    if (t && Math.abs(pl.p.x - t.x) < t.r && Math.abs(pl.p.z - t.z) < t.r && Math.abs(pl.p.y - t.y) < 2.5) this.deliver(t);

    // ---- pickups ----
    const px = pl.p.x, py = pl.p.y + pl.h * 0.5, pz = pl.p.z;
    for (let i = 0; i < w.pickups.length; i++) {
      const k = w.pickups[i];
      if (k.taken) continue;
      const dx = k.x - px, dy = k.y - py, dz = k.z - pz;
      if (dx > 3 || dx < -3 || dz > 3 || dz < -3) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 2.6) this.collect(k);
      else if (d2 < 9 && k.kind === 'shard') { k.x -= dx * 6 * dt; k.y -= dy * 6 * dt; k.z -= dz * 6 * dt; } // magnet
    }

    // ---- enemies ----
    this.drones.update(dt, this, false);
    if (this.boss) { this.boss.update(dt, this); this.hud.boss(this.boss.pressure); }

    // ---- continuous juice ----
    if (pl.sliding && pl.grounded) this.fx.spawn(pl.p.x, pl.p.y + 0.08, pl.p.z, (Math.random() - 0.5) * 3 - pl.v.x * 0.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3 - pl.v.z * 0.2, _cSpark, 0.28, 0.3, 9, 1);
    if (pl.wr.on && Math.random() < 0.7) this.fx.spawn(pl.p.x - pl.wr.nx * 0.4, pl.p.y + 0.15, pl.p.z - pl.wr.nz * 0.4, pl.wr.nx * 2, 1 + Math.random() * 2, pl.wr.nz * 2, _cTrim.set(SKIES[this.cfg.sky].trimA), 0.3, 0.35, 9, 1);
    this.audio.setLoop('wind', clamp((pl.speed - 8) / 30, 0, 0.25) + (pl.grounded ? 0 : 0.06), 300 + pl.speed * 40);
    const an = pl.gr.on ? null : w.findAnchor(px, pl.p.y + 1, pz, inp.ax, inp.ay, inp.az);
    if (an) an.hot = Math.max(an.hot, 0.5);
    this.hud.prompt(an ? (this.input.mode === 'touch' ? 'HOOK' : this.input.mode === 'pad' ? 'X  GRAPPLE' : 'E  GRAPPLE') : '');

    // ---- combo + clock ----
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.mult = 1; this.hud.set('comboName', ''); } }
    this.time -= dt;
    if (this.time < this.tickAt && this.time > 0) { this.tickAt = Math.floor(this.time); this.audio.tick(); }
    this.audio.setIntensity(clamp((this.cfg.boss ? 0.85 : 0.5) + this.combo * 0.03 + (this.time < 10 ? 0.25 : 0), 0, 1));
    if (this.time <= 0) { this.time = 0; this.gameOver(); return; }

    this.shownScore += (this.score - this.shownScore) * Math.min(1, 10 * dt);
    this.rig.update(dt, pl, w, lookX, lookY);
    pl.syncModel(dt, this.clock);
    this.hud.update(dt, this);
  }

  collect(k) {
    k.taken = true;
    const a = this.audio, fx = this.fx;
    if (k.kind === 'shard') {
      this.shards++;
      this.trick('', 50);
      a.pickup(this.combo);
      fx.burst(k.x, k.y, k.z, 0x35e8ff, { count: 9, speed: 4, size: 0.34, life: 0.4, grav: 0 });
    } else if (k.kind === 'chrono') {
      this.addTime(5); this.trick('TIME CELL', 100);
      a.chrono();
      this.hud.toast('+5s', '#ffd23f', 'TIME CELL');
      fx.burst(k.x, k.y, k.z, 0xffc93a, { count: 30, speed: 7, size: 0.5, life: 0.7, grav: 0 });
      fx.ring(k.x, k.y - 1, k.z, 0xffc93a, 0.3, 4, 0.5);
    } else {
      this.cat = true; this.trick('LUCKY CAT', 1000);
      a.meow();
      this.hud.toast('LUCKY CAT!', '#ff5fd0', '+1000');
      fx.burst(k.x, k.y, k.z, 0xff5fd0, { count: 60, speed: 9, up: 6, size: 0.55, life: 1.1 });
      if (this.world.cat) this.world.cat.visible = false;
    }
  }

  deliver(t) {
    t.done = true;
    this.delivered++;
    this.trick('DELIVERED', 500);
    this.combo += 2;
    this.cp = Math.max(this.cp, t.plat);
    const col = t.final ? 0xffe14a : 0x5dff9b;
    this.fx.burst(t.x, t.y + 1, t.z, col, { count: 90, speed: 13, up: 12, size: 0.6, life: 1.2 });
    this.fx.ring(t.x, t.y, t.z, col, 1, 16, 0.9);
    this.fx.ring(t.x, t.y, t.z, 0xffffff, 0.5, 8, 0.5);
    this.rig.shake(0.35);
    this.audio.deliver();
    this.slowT = 0.22;
    this.setTarget();
    if (!this.target) return this.finish();
    this.addTime(this.cfg.bonus);
    this.hud.toast('DELIVERED', '#5dff9b', `+${this.cfg.bonus}s`);
  }

  finish() {
    this.state = 'ending';
    this.endT = this.boss ? 3.4 : 1.7;
    this.input.setActive(false);
    this.audio.setLoop('slide', 0); this.audio.setLoop('wind', 0);
    this.hud.prompt('');
    this.hud.toast(this.boss ? 'EMP DELIVERED' : 'SHIFT COMPLETE', '#ffe14a');
    if (this.boss) this.boss.destroy();
    this.audio.win();
    this.syncTouch();
  }

  results() {
    const cfg = this.cfg, w = this.world;
    const timeBonus = Math.round(this.time) * 20;
    const total = this.score + timeBonus;
    const frac = w.shardTotal ? this.shards / w.shardTotal : 1;
    const stars = 1 + (frac >= 0.5 ? 1 : 0) + (frac >= 0.85 && this.respawns <= 2 ? 1 : 0);
    const prev = this.save.best[cfg.id];
    const newBest = !prev || total > prev.score;
    this.save.best[cfg.id] = { score: Math.max(total, prev ? prev.score : 0), stars: Math.max(stars, prev ? prev.stars : 0), cat: this.cat || !!(prev && prev.cat) };
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVELS.length, cfg.id + 1));
    writeSave(this.save);
    const rows = [
      ['DELIVERIES', `${this.delivered}/${w.deliveries.length}`],
      ['DATA SHARDS', `${this.shards}/${w.shardTotal}`],
      ['BEST COMBO', String(this.bestCombo)],
      ['TIME LEFT BONUS', `+${timeBonus.toLocaleString()}`],
      ['RESPAWNS', String(this.respawns)],
      ['LUCKY CAT', this.cat ? 'FOUND' : '- - -'],
    ];
    this.result = { total, stars, rows, newBest };
    this.hud.show(false);
    this.audio.setIntensity(0.3);
    if (cfg.boss) {
      this.state = 'won';
      let career = 0;
      for (const k in this.save.best) career += this.save.best[k].score;
      this.ui.showWin(this.result, career);
    } else {
      this.state = 'complete';
      this.ui.showComplete(cfg, this.result);
    }
  }

  gameOver() {
    this.state = 'gameover';
    this.input.setActive(false);
    this.hud.show(false);
    this.audio.lose();
    this.audio.setIntensity(0.15);
    this.audio.setLoop('slide', 0); this.audio.setLoop('wind', 0);
    const left = this.world.deliveries.length - this.delivered;
    this.ui.showGameOver(`${left} package${left === 1 ? '' : 's'} undelivered in ${this.cfg.district}. Grab time cells and keep your combo alive.`);
    this.syncTouch();
  }

  // Headless fast-forward used by tests.
  simulate(seconds, dt = 1 / 60) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) { this.step(dt); if (this.state !== 'play' && this.state !== 'ending') break; }
    return { state: this.state, plat: this.curPlat, time: this.time, delivered: this.delivered, respawns: this.respawns, score: this.score };
  }

  frame(now) {
    const raw = now - this.last;
    this.last = now;
    this.gfx.frame(raw);
    this.stats.fps += (1000 / Math.max(1, raw) - this.stats.fps) * 0.05;
    if (!this.manual) {
      let dt = Math.min(0.05, raw / 1000);
      const n = Math.ceil(dt / (1 / 60) - 0.001);
      for (let i = 0; i < n; i++) this.step(dt / n);
    }
    this.gfx.render();
    requestAnimationFrame((t) => this.frame(t));
  }
}
const _cSpark = new THREE.Color(0xffc060), _cTrim = new THREE.Color();
window.__game = new Game();
