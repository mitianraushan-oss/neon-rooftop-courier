// WARDEN-9: the level-5 chase boss. It hovers behind the courier and closes in
// whenever you slow down. All attacks are telegraphed:
//   mortars   - red circles on the ground fill up, then explode
//   shockwave - the eye charges, then a ring sweeps across the roofs: jump it
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export class Boss {
  constructor(scene, game) {
    this.scene = scene; this.game = game;
    this.active = false; this.dead = false;
    this.p = new THREE.Vector3();
    this.gap = 30; this.pressure = 0.2;
    this.atk = 4; this.cycle = 0; this.charge = 0;
    this.rings = []; this.mortars = [];
    this.t = 0; this.deathT = 0;
    const g = (this.group = new THREE.Group());
    const hull = new THREE.MeshStandardMaterial({ color: 0x14151c, roughness: 0.3, metalness: 0.85 });
    const red = (this.redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(2.6), toneMapped: false }));
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1, 1), hull);
    core.scale.set(4.6, 1.9, 6.2);
    const mk = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); g.add(o); return o; };
    g.add(core);
    const box = new THREE.BoxGeometry(1, 1, 1);
    mk(box, hull, 5.2, 0.2, -0.5, 1.6, 1, 6); mk(box, hull, -5.2, 0.2, -0.5, 1.6, 1, 6);
    mk(box, hull, 3, 0, 0, 4, 0.4, 1.4); mk(box, hull, -3, 0, 0, 4, 0.4, 1.4);
    mk(box, red, 5.2, 0.2, -3.6, 1.2, 0.6, 0.3); mk(box, red, -5.2, 0.2, -3.6, 1.2, 0.6, 0.3); // engines
    mk(box, red, 0, 0.9, 1.5, 3.2, 0.12, 0.12);
    this.eye = mk(new THREE.SphereGeometry(0.9, 16, 12), red, 0, -0.9, 3.6);
    this.halo = mk(new THREE.TorusGeometry(6.6, 0.14, 8, 48), red, 0, 0, 0);
    this.halo.rotation.x = Math.PI / 2;
    const cone = new THREE.ConeGeometry(7, 26, 24, 1, true);
    cone.translate(0, -13, 0);
    this.spot = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.spot.position.set(0, -1, 3);
    g.add(this.spot);
    this.light = new THREE.PointLight(0xff3020, 0, 60, 1.6);
    g.add(this.light);
    g.visible = false;
    g.traverse((o) => { if (o.isMesh && o.material === hull) o.castShadow = true; });
    scene.add(g);

    // pooled telegraph markers + shockwave rings
    const disc = new THREE.CircleGeometry(1, 36), ringG = new THREE.RingGeometry(0.93, 1, 48), waveG = new THREE.RingGeometry(0.985, 1, 96);
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.pool = new THREE.Group();
    scene.add(this.pool);
    for (let i = 0; i < 8; i++) {
      const fill = new THREE.Mesh(disc, mat()), rim = new THREE.Mesh(ringG, mat());
      fill.rotation.x = rim.rotation.x = -Math.PI / 2;
      fill.visible = rim.visible = false;
      this.pool.add(fill, rim);
      this.mortars.push({ on: false, fill, rim, x: 0, y: 0, z: 0, t: 0, fuse: 1, r: 3 });
    }
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(waveG, mat());
      m.rotation.x = -Math.PI / 2; m.visible = false;
      this.pool.add(m);
      this.rings.push({ on: false, m, x: 0, y: 0, z: 0, r: 0, hit: false });
    }
  }

  start() {
    this.active = true; this.dead = false;
    this.group.visible = true;
    this.gap = 30; this.atk = 4.5; this.cycle = 0; this.charge = 0;
    this.light.intensity = 220;
    this.resetBehind(true);
  }

  // Put the boss back behind the courier (after a respawn).
  resetBehind(first) {
    if (!this.active) return;
    const pl = this.game.player;
    const bx = -Math.sin(pl.yaw), bz = -Math.cos(pl.yaw);
    this.gap = first ? 30 : 26;
    this.p.set(pl.p.x + bx * this.gap, pl.p.y + (first ? -6 : 10), pl.p.z + bz * this.gap);
    this.atk = Math.max(this.atk, 3);
    for (const m of this.mortars) { m.on = false; m.fill.visible = m.rim.visible = false; }
    for (const r of this.rings) { r.on = false; r.m.visible = false; }
    this.charge = 0;
  }

  ringNear(p, d) {
    for (const r of this.rings) {
      if (!r.on || r.hit) continue;
      const dist = Math.hypot(p.x - r.x, p.z - r.z);
      if (dist - r.r > 0 && dist - r.r < d) return true;
    }
    return false;
  }

  mortar(x, y, z, fuse, r) {
    const m = this.mortars.find((k) => !k.on);
    if (!m) return;
    m.on = true; m.x = x; m.y = y; m.z = z; m.t = 0; m.fuse = fuse; m.r = r;
    m.fill.position.set(x, y + 0.07, z); m.rim.position.set(x, y + 0.08, z);
    m.rim.scale.setScalar(r); m.fill.scale.setScalar(0.01);
    m.fill.visible = m.rim.visible = true;
  }

  update(dt, game) {
    if (!this.active) return;
    this.t += dt;
    const pl = game.player, g = this.group, fx = game.fx, a = game.audio;
    if (this.dead) return this.dying(dt, game);

    // ---- pursuit: the gap shrinks when the courier dawdles ----
    const sp = pl.speed;
    if (sp < 6) this.gap -= 2.4 * dt;
    else if (sp > 9.5) this.gap = Math.min(30, this.gap + 3.2 * dt);
    else this.gap -= 0.5 * dt;
    let dx = this.p.x - pl.p.x, dz = this.p.z - pl.p.z;
    let l = Math.hypot(dx, dz);
    if (l < 0.5) { dx = -Math.sin(pl.yaw); dz = -Math.cos(pl.yaw); l = 1; }
    const tx = pl.p.x + (dx / l) * this.gap, tz = pl.p.z + (dz / l) * this.gap;
    const ty = pl.p.y + 6 + clamp(this.gap * 0.22, 0, 6) + Math.sin(this.t * 1.3) * 0.6;
    this.p.x = damp(this.p.x, tx, 2.2, dt); this.p.y = damp(this.p.y, ty, 1.8, dt); this.p.z = damp(this.p.z, tz, 2.2, dt);
    this.pressure = clamp(1 - (this.gap - 5) / 25, 0, 1);
    g.position.copy(this.p);
    g.rotation.y = Math.atan2(pl.p.x - this.p.x, pl.p.z - this.p.z);
    g.rotation.z = Math.sin(this.t * 0.9) * 0.08;
    this.halo.rotation.z += dt * (1.5 + this.charge * 10);
    this.spot.lookAt(pl.p.x, pl.p.y, pl.p.z);
    this.spot.rotateX(-Math.PI / 2);
    const pulse = 1 + Math.sin(this.t * 6) * 0.1 + this.charge * 0.9;
    this.eye.scale.setScalar(pulse);
    this.light.intensity = 200 + this.charge * 500;
    if (this.gap < 5 && pl.invuln <= 0) {
      game.addTime(-7);
      game.rig.shake(1);
      a.explode(0.8);
      game.respawn('CAUGHT BY WARDEN-9');
      return;
    }

    // ---- attacks ----
    const prog = game.reached / (game.route.plats.length - 1);
    this.atk -= dt;
    if (this.charge > 0) {
      this.charge += dt / 0.9;
      if (Math.random() < 0.6) fx.spawn(this.p.x + (Math.random() - 0.5) * 10, this.p.y + (Math.random() - 0.5) * 6, this.p.z + (Math.random() - 0.5) * 10, 0, 0, 0, _c.set(0xff5030), 0.5, 0.3, 0, 0);
      if (this.charge >= 1) {
        this.charge = 0;
        const r = this.rings.find((k) => !k.on);
        if (r) {
          r.on = true; r.hit = false; r.r = 2; r.x = this.p.x; r.z = this.p.z; r.y = game.lastTop;
          r.m.position.set(r.x, r.y + 0.12, r.z); r.m.visible = true;
          a.wave(); game.rig.shake(0.35);
        }
      }
    } else if (this.atk <= 0) {
      this.atk = 3.7 - prog * 1.3;
      const kind = this.cycle++ % 3;
      if (kind === 1) { this.charge = 0.001; a.charge(0.9); }
      else {
        // mortars on where you are now; every other volley adds one where you are heading
        for (let i = 0; i < 3; i++) this.mortar(pl.p.x + (Math.random() - 0.5) * (i ? 5 : 0), game.lastTop, pl.p.z + (Math.random() - 0.5) * (i ? 5 : 0), 1.0 + i * 0.28, 3.1);
        if (kind === 2) this.mortar(pl.p.x + pl.v.x * 0.95, game.lastTop, pl.p.z + pl.v.z * 0.95, 0.95, 2.3);
        a.alert();
      }
    }

    for (const m of this.mortars) {
      if (!m.on) continue;
      m.t += dt;
      const f = m.t / m.fuse;
      m.fill.scale.setScalar(Math.max(0.01, m.r * f));
      m.fill.material.opacity = 0.2 + 0.5 * f;
      m.rim.material.opacity = 0.5 + 0.5 * Math.sin(m.t * 30);
      if (f >= 1) {
        m.on = false; m.fill.visible = m.rim.visible = false;
        fx.burst(m.x, m.y + 0.4, m.z, 0xff6030, { count: 34, speed: 11, up: 12, size: 0.6, life: 0.7 });
        fx.ring(m.x, m.y, m.z, 0xff5030, 0.5, m.r * 1.5, 0.35);
        const d = Math.hypot(pl.p.x - m.x, pl.p.z - m.z);
        a.explode(clamp(1.2 - d / 30, 0.25, 1));
        game.rig.shake(clamp(0.6 - d / 40, 0, 0.6));
        if (d < m.r && Math.abs(pl.p.y - m.y) < 1.4) game.hit(4, m.x, m.z, 'MORTAR');
      }
    }
    for (const r of this.rings) {
      if (!r.on) continue;
      r.r += 20 * dt;
      r.m.scale.setScalar(r.r);
      r.m.material.opacity = clamp(1.4 - r.r / 46, 0, 1);
      const d = Math.hypot(pl.p.x - r.x, pl.p.z - r.z);
      if (!r.hit && Math.abs(d - r.r) < 0.9) {
        const h = pl.p.y - r.y;
        if (h < 0.9 && h > -2) { r.hit = true; game.hit(5, r.x, r.z, 'SHOCKWAVE'); }
        else if (h >= 0.9 && h < 6) { r.hit = true; game.trick('WAVE HOP', 120); }
      }
      if (r.r > 52) { r.on = false; r.m.visible = false; }
    }
  }

  destroy() {
    this.dead = true; this.deathT = 0; this.boomAt = 0;
    for (const m of this.mortars) { m.on = false; m.fill.visible = m.rim.visible = false; }
    for (const r of this.rings) { r.on = false; r.m.visible = false; }
    this.spot.visible = false;
  }
  dying(dt, game) {
    const fx = game.fx, g = this.group;
    this.deathT += dt;
    this.boomAt -= dt;
    g.rotation.z += dt * 1.4; g.rotation.x += dt * 0.6;
    this.p.y -= dt * (2 + this.deathT * 9);
    g.position.copy(this.p);
    this.light.intensity = 300 + Math.random() * 900;
    if (this.boomAt <= 0 && g.visible) {
      this.boomAt = 0.09;
      const x = this.p.x + (Math.random() - 0.5) * 10, y = this.p.y + (Math.random() - 0.5) * 4, z = this.p.z + (Math.random() - 0.5) * 10;
      fx.burst(x, y, z, Math.random() < 0.5 ? 0xffb040 : 0x19f0ff, { count: 26, speed: 14, size: 0.8, life: 0.8 });
      game.audio.explode(0.7);
      game.rig.shake(0.3);
    }
    if (this.deathT > 1.0 && g.visible) {
      g.visible = false; this.light.intensity = 0;
      fx.burst(this.p.x, this.p.y, this.p.z, 0xffffff, { count: 160, speed: 30, size: 1.1, life: 1.4, grav: 4 });
      fx.burst(this.p.x, this.p.y, this.p.z, 0xff7030, { count: 120, speed: 18, size: 0.9, life: 1.6, grav: 6 });
      game.audio.explode(1.6);
      game.rig.shake(1);
      game.env.setProgress(1);
    }
  }

  dispose() {
    this.active = false;
    this.scene.remove(this.group, this.pool);
    const kill = (o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } };
    this.group.traverse(kill); this.pool.traverse(kill);
  }
}
const _c = new THREE.Color();
