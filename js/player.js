// Player controller: AABB character with smooth acceleration, coyote time, jump
// buffering, slide, wall-run, grapple hook, ledge mantle and launch pads - plus the
// procedural courier model and its animation.
import * as THREE from 'three';
import { clamp, damp, angleDelta, approach } from './util.js';
import { Trail } from './fx.js';

// Movement constants. route.js sizes every gap from these - change with care.
export const PHYS = {
  half: 0.4, height: 1.8, slideHeight: 0.9,
  run: 11, accel: 70, friction: 60, airAccel: 30,
  gravity: 30, jump: 11.5, coyote: 0.12, buffer: 0.14,
  slideSpeed: 14.5, slideDecel: 5, boostDecay: 7,
  wallSpeed: 12.5, wallGravity: 7, wallTime: 1.75,
  grappleSpeed: 26, grappleAccel: 95, grappleRange: 34,
};

export class Player {
  constructor(scene, fx, emit) {
    this.fx = fx;
    this.emit = emit;
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.yaw = 0;
    this.h = PHYS.height;
    this.grounded = false;
    this.groundBox = null;
    this.coyote = 0; this.buffer = 0;
    this.sliding = false; this.slideT = 0; this.slideCool = 0; this.underDuct = false;
    this.wr = { on: false, nx: 0, nz: 0, tx: 0, tz: 0, t: 0, cool: 0 };
    this.gr = { on: false, a: null, t: 0, cool: 0 };
    this.launchT = 0; this.invuln = 0; this.airT = 0; this.jumping = false;
    this.speed = 0;
    this.buildModel(scene);
    this.trail = new Trail(scene, 0x19f0ff);
    this.light = new THREE.PointLight(0x35e8ff, 9, 16, 1.8);
    scene.add(this.light);
    // grapple rope
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23f).multiplyScalar(2.5), toneMapped: false }));
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    scene.add(this.rope);
    this.phase = 0; this.squash = 0; this.tiltX = 0; this.tiltZ = 0;
  }

  buildModel(scene) {
    const root = (this.root = new THREE.Group());
    const tilt = (this.tilt = new THREE.Group());
    root.add(tilt);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e2a, roughness: 0.55, metalness: 0.3 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0xff3fa4, roughness: 0.4, metalness: 0.2, emissive: 0xff1f8a, emissiveIntensity: 0.35 });
    const glowC = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x19f0ff).multiplyScalar(2.6), toneMapped: false });
    const glowY = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23f).multiplyScalar(2.4), toneMapped: false });
    const box = (w, h, d, m, x, y, z, parent = tilt) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
    };
    box(0.5, 0.62, 0.3, jacket, 0, 1.22, 0);
    box(0.44, 0.2, 0.28, dark, 0, 0.86, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), dark);
    head.position.set(0, 1.7, 0); head.castShadow = true; tilt.add(head);
    box(0.3, 0.09, 0.12, glowC, 0, 1.72, 0.14); // visor
    // delivery pack
    this.pack = box(0.46, 0.5, 0.24, dark, 0, 1.25, -0.27);
    box(0.3, 0.3, 0.02, glowY, 0, 0, -0.125, this.pack);
    box(0.5, 0.04, 0.26, glowC, 0, 0.27, 0, this.pack);
    const limb = (x, y, len, w, m, glow) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      box(w, len, w, m, 0, -len / 2, 0, g);
      if (glow) box(w + 0.02, 0.07, w + 0.06, glow, 0, -len + 0.04, 0.02, g);
      tilt.add(g);
      return g;
    };
    this.armL = limb(0.33, 1.48, 0.58, 0.13, jacket);
    this.armR = limb(-0.33, 1.48, 0.58, 0.13, jacket);
    this.legL = limb(0.14, 0.86, 0.86, 0.17, dark, glowC);
    this.legR = limb(-0.14, 0.86, 0.86, 0.17, dark, glowC);
    scene.add(root);
  }

  reset(x, y, z, yaw) {
    this.p.set(x, y, z); this.v.set(0, 0, 0);
    this.yaw = yaw; this.h = PHYS.height;
    this.grounded = false; this.groundBox = null; this.sliding = false;
    this.wr.on = false; this.gr.on = false; this.gr.a = null;
    this.launchT = 0; this.airT = 0; this.coyote = 0; this.buffer = 0; this.jumping = false;
    this.rope.visible = false;
    this.trail.reset(x, y + 1.2, z);
    this.syncModel(0);
  }

  // ---- collision helpers ----
  overlaps(b, h) {
    const p = this.p, w = PHYS.half;
    return p.y < b.maxY - 0.001 && p.y + h > b.minY + 0.001 && p.x + w > b.minX && p.x - w < b.maxX && p.z + w > b.minZ && p.z - w < b.maxZ;
  }
  canStand(world) {
    const p = this.p, w = PHYS.half;
    const boxes = world.grid.query(p.x - w, p.z - w, p.x + w, p.z + w);
    for (let i = 0; i < boxes.length; i++) if (this.overlaps(boxes[i], PHYS.height)) return false;
    return true;
  }
  // Is there a runnable billboard within `reach` on the side opposite to normal (nx,nz)?
  wallNear(world, nx, nz, reach = 0.25) {
    const p = this.p, w = PHYS.half, ox = -nx * reach, oz = -nz * reach;
    const boxes = world.grid.query(p.x - w + ox, p.z - w + oz, p.x + w + ox, p.z + w + oz);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.runnable && b.maxY > p.y + 1.0 && b.minY < p.y + 0.6 && p.x + ox + w > b.minX && p.x + ox - w < b.maxX && p.z + oz + w > b.minZ && p.z + oz - w < b.maxZ) return true;
    }
    return false;
  }

  move(world, dx, dy, dz) {
    const p = this.p, w = PHYS.half, h = this.h;
    let hitX = 0, hitZ = 0;
    this.hitWall = null;
    const air = !this.grounded;
    if (dx !== 0) {
      p.x += dx;
      const boxes = world.grid.query(p.x - w, p.z - w, p.x + w, p.z + w);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!this.overlaps(b, h)) continue;
        if (this.mantle(b, air)) continue;
        if (dx > 0) { p.x = b.minX - w; hitX = -1; } else { p.x = b.maxX + w; hitX = 1; }
        this.hitWall = b;
      }
    }
    if (dz !== 0) {
      p.z += dz;
      const boxes = world.grid.query(p.x - w, p.z - w, p.x + w, p.z + w);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!this.overlaps(b, h)) continue;
        if (this.mantle(b, air)) continue;
        if (dz > 0) { p.z = b.minZ - w; hitZ = -1; } else { p.z = b.maxZ + w; hitZ = 1; }
        this.hitWall = b;
      }
    }
    p.y += dy;
    let ground = null;
    const boxes = world.grid.query(p.x - w, p.z - w, p.x + w, p.z + w);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!this.overlaps(b, h)) continue;
      if (dy <= 0) { p.y = b.maxY; ground = b; }
      else { p.y = b.minY - h; if (this.v.y > 0) this.v.y = 0; }
    }
    this.hitX = hitX; this.hitZ = hitZ;
    return ground;
  }

  // Pop up onto a ledge we almost cleared - forgiving parkour.
  mantle(b, air) {
    const up = b.maxY - this.p.y;
    if (!air || up <= 0 || up > 1.25 || this.v.y < -16 || b.kind === 'barrier') return false;
    this.p.y = b.maxY + 0.02;
    if (this.v.y < 2) this.v.y = 2;
    this.emit('mantle');
    return true;
  }

  // inp: { wx, wz, jump, jumpHeld, slide, grapple, ax, ay, az }
  update(dt, inp, world) {
    const P = PHYS, p = this.p, v = this.v, wr = this.wr, gr = this.gr;
    const wl = Math.hypot(inp.wx, inp.wz);
    this.buffer = inp.jump ? P.buffer : Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? P.coyote : Math.max(0, this.coyote - dt);
    this.slideCool = Math.max(0, this.slideCool - dt);
    wr.cool = Math.max(0, wr.cool - dt);
    gr.cool = Math.max(0, gr.cool - dt);
    this.launchT = Math.max(0, this.launchT - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    let hs = Math.hypot(v.x, v.z);

    // ---- grapple start ----
    if (inp.grapple && !gr.on && gr.cool <= 0) {
      const a = world.findAnchor(p.x, p.y + 1.0, p.z, inp.ax, inp.ay, inp.az, P.grappleRange);
      if (a) {
        gr.on = true; gr.a = a; gr.t = 0; a.hot = 1;
        wr.on = false; this.sliding = false; this.h = P.height; this.grounded = false; this.jumping = false;
        p.y += 0.05;
        this.emit('grapple', a);
      } else this.emit('deny');
    }

    if (gr.on) {
      // ---- grapple pull ----
      gr.t += dt;
      const a = gr.a, dx = a.x - p.x, dy = a.y - (p.y + 1.0), dz = a.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 3 || gr.t > 1.8 || (this.buffer > 0 && gr.t > 0.12)) {
        const byJump = this.buffer > 0;
        gr.on = false; gr.cool = 0.35; this.buffer = 0;
        hs = Math.hypot(v.x, v.z);
        if (hs > 12.5) { v.x *= 12.5 / hs; v.z *= 12.5 / hs; }
        v.y = clamp(v.y, 3, 7.5);
        if (byJump) v.y = Math.max(v.y, 8.5);
        this.emit('release');
      } else {
        const s = P.grappleSpeed / d, k = P.grappleAccel * dt;
        v.x = approach(v.x, dx * s, k); v.y = approach(v.y, dy * s, k); v.z = approach(v.z, dz * s, k);
      }
    } else if (wr.on) {
      // ---- wall-run ----
      wr.t += dt;
      const sp = Math.max(approach(hs, P.wallSpeed, 20 * dt), P.wallSpeed * 0.9);
      v.x = wr.tx * sp - wr.nx * 1.5; v.z = wr.tz * sp - wr.nz * 1.5;
      v.y = Math.max(v.y - P.wallGravity * dt, -7);
      const away = wl > 0 ? inp.wx * wr.nx + inp.wz * wr.nz : 0;
      if (this.buffer > 0) {
        // wall-jump: kick away and up, keep forward speed
        v.x = wr.tx * sp + wr.nx * 7; v.z = wr.tz * sp + wr.nz * 7; v.y = 10.2;
        wr.on = false; wr.cool = 0.3; this.buffer = 0;
        this.emit('walljump');
      } else if (away > 0.6) { wr.on = false; wr.cool = 0.3; v.x += wr.nx * 3; v.z += wr.nz * 3; }
      else if (wr.t > P.wallTime) { wr.on = false; wr.cool = 0.5; }
      else if (!this.wallNear(world, wr.nx, wr.nz)) { wr.on = false; wr.cool = 0.15; v.x = wr.tx * sp; v.z = wr.tz * sp; }
    } else {
      // ---- ground / air ----
      if (this.grounded) {
        if (!this.sliding && inp.slide && this.slideCool <= 0 && hs > 3) {
          this.sliding = true; this.slideT = 0; this.h = P.slideHeight; this.underDuct = false;
          const ns = Math.min(17, Math.max(hs + 3.5, P.slideSpeed));
          v.x *= ns / hs; v.z *= ns / hs; hs = ns;
          this.emit('slide');
        }
        if (this.sliding) {
          this.slideT += dt;
          const free = this.canStand(world);
          if (!free && !this.underDuct) { this.underDuct = true; this.emit('duct'); }
          let ns = Math.max(hs - P.slideDecel * dt, free ? 0 : 6.5);
          if (hs > 0.01) {
            let dxn = v.x / hs, dzn = v.z / hs;
            if (wl > 0) { // gentle steering
              dxn += inp.wx * 1.6 * dt; dzn += inp.wz * 1.6 * dt;
              const n = Math.hypot(dxn, dzn); dxn /= n; dzn /= n;
            }
            v.x = dxn * ns; v.z = dzn * ns;
          }
          if (free && ((!inp.slide && this.slideT > 0.3) || ns < 4.5 || this.slideT > 1.4)) this.endSlide();
        } else if (hs > P.run + 0.3 && wl > 0 && (v.x * inp.wx + v.z * inp.wz) / (hs * wl) > 0.3) {
          // carrying extra momentum (after a slide/pad): steer, bleed speed slowly
          let dxn = v.x / hs + (inp.wx / wl) * 9 * dt, dzn = v.z / hs + (inp.wz / wl) * 9 * dt;
          const n = Math.hypot(dxn, dzn), ns = hs - P.boostDecay * dt;
          v.x = (dxn / n) * ns; v.z = (dzn / n) * ns;
        } else {
          const k = (wl > 0 ? P.accel : P.friction) * dt;
          v.x = approach(v.x, inp.wx * P.run, k); v.z = approach(v.z, inp.wz * P.run, k);
        }
      } else if (wl > 0) {
        // air control that never bleeds existing momentum
        const nx = inp.wx / wl, nz = inp.wz / wl;
        const add = clamp(P.run * wl - (v.x * nx + v.z * nz), 0, P.airAccel * dt);
        v.x += nx * add; v.z += nz * add;
      }
      // jump (buffered, with coyote time)
      if (this.buffer > 0 && (this.grounded || this.coyote > 0) && this.launchT <= 0 && (!this.sliding || this.canStand(world))) {
        if (this.sliding) this.endSlide();
        v.y = P.jump; this.grounded = false; this.coyote = 0; this.buffer = 0; this.jumping = true;
        this.emit('jump');
      }
      if (this.jumping && !inp.jumpHeld && v.y > 4) v.y -= 45 * dt; // short hop when released early
      v.y = Math.max(v.y - P.gravity * dt, -55);
    }

    // ---- integrate + collide (sub-stepped so fast moves never tunnel) ----
    const wasGrounded = this.grounded, vyBefore = v.y, hvx = v.x, hvz = v.z;
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt) / 0.35));
    const sdt = dt / steps;
    let ground = null, hx = 0, hz = 0, wall = null;
    for (let i = 0; i < steps; i++) {
      const g = this.move(world, v.x * sdt, v.y * sdt, v.z * sdt);
      if (g) ground = g;
      if (this.hitX) { hx = this.hitX; v.x = 0; wall = this.hitWall; }
      if (this.hitZ) { hz = this.hitZ; v.z = 0; wall = this.hitWall; }
      if (g && v.y < 0) v.y = 0;
    }
    this.grounded = !!ground && !gr.on;
    if (ground) this.groundBox = ground;
    if (this.grounded) {
      this.jumping = false;
      if (!wasGrounded) {
        this.squash = Math.min(1, -vyBefore / 22);
        this.emit('land', { speed: -vyBefore, air: this.airT });
        wr.on = false; wr.cool = 0.35;
      }
      this.airT = 0;
      // launch pads
      if (this.launchT <= 0) {
        for (const pad of world.pads) {
          if (Math.abs(p.x - pad.x) < pad.r && Math.abs(p.z - pad.z) < pad.r && Math.abs(p.y - pad.y) < 0.4) {
            p.x = pad.x; p.z = pad.z;
            v.set(pad.vx, pad.vy, pad.vz);
            this.grounded = false; this.launchT = 0.3; pad.cool = 0.5;
            if (this.sliding) { this.sliding = false; this.h = P.height; }
            this.emit('pad', pad);
            break;
          }
        }
      }
    } else {
      this.airT += dt;
      if (this.sliding && this.canStand(world)) this.endSlide();
      // wall-run attach
      // wall-run attach: airborne, moving along a billboard that is within arm's reach
      if (!wr.on && !gr.on && wr.cool <= 0 && this.launchT <= 0 && v.y > -9) {
        for (let k = 0; k < 4; k++) {
          const nx = k === 0 ? 1 : k === 1 ? -1 : 0, nz = k === 2 ? 1 : k === 3 ? -1 : 0;
          const ts = nx ? hvz : hvx, into = -(hvx * nx + hvz * nz);
          if (Math.abs(ts) < 5 || into < -1.5 || !this.wallNear(world, nx, nz, 0.5)) continue;
          wr.on = true; wr.t = 0; wr.nx = nx; wr.nz = nz;
          wr.tx = nx ? 0 : Math.sign(ts); wr.tz = nx ? Math.sign(ts) : 0;
          v.y = clamp(v.y, 2.5, 7); this.jumping = false;
          this.emit('wallrun');
          break;
        }
      }
    }
    if (gr.on && ground && gr.t > 0.25) { gr.on = false; gr.cool = 0.3; this.emit('release'); }
    this.speed = Math.hypot(v.x, v.z);
    // facing
    if (wr.on) this.yaw += angleDelta(this.yaw, Math.atan2(wr.tx, wr.tz)) * Math.min(1, 16 * dt);
    else if (this.speed > 1.2) this.yaw += angleDelta(this.yaw, Math.atan2(v.x, v.z)) * Math.min(1, 14 * dt);
  }

  endSlide() { this.sliding = false; this.h = PHYS.height; this.slideCool = 0.25; this.emit('slideEnd'); }

  // ---- visuals ----
  syncModel(dt, time = 0) {
    const p = this.p, s = this.speed, wr = this.wr, gr = this.gr;
    this.root.position.copy(p);
    this.root.rotation.y = this.yaw;
    const k = Math.min(1, s / 8);
    this.phase += s * dt * 0.95;
    const sw = Math.sin(this.phase);
    let legA = sw * 0.95 * k, legB = -sw * 0.95 * k, armA = -sw * 0.85 * k, armB = sw * 0.85 * k, armZ = 0.08;
    let tx = 0.14 * k, tz = 0, bob = Math.abs(sw) * 0.07 * k;
    if (gr.on) { tx = 0.7; armA = armB = -2.7; legA = 0.3; legB = 0.6; bob = 0; }
    else if (wr.on) {
      const right = -Math.cos(this.yaw) * wr.nx + Math.sin(this.yaw) * wr.nz;
      tz = 0.4 * Math.sign(right); legA *= 1.1; legB *= 1.1; tx = 0.2;
    } else if (this.sliding) { tx = -1.12; legA = 1.0; legB = 0.75; armA = armB = 0.5; armZ = 0.5; bob = 0; }
    else if (!this.grounded) {
      const up = clamp(this.v.y / 10, -1, 1);
      legA = -0.7 + up * 0.2; legB = 0.55; armA = armB = -1.1 - up * 0.9; armZ = 0.45; tx = 0.1 - up * 0.1; bob = 0;
    } else if (k < 0.1) { // idle breathing
      bob = Math.sin(time * 2) * 0.012; armA = armB = Math.sin(time * 2) * 0.04;
    }
    const r = dt > 0 ? 1 - Math.exp(-16 * dt) : 1;
    this.tiltX += (tx - this.tiltX) * r; this.tiltZ += (tz - this.tiltZ) * r;
    this.tilt.rotation.set(this.tiltX, 0, this.tiltZ);
    this.legL.rotation.x += (legA - this.legL.rotation.x) * r; this.legR.rotation.x += (legB - this.legR.rotation.x) * r;
    this.armL.rotation.x += (armA - this.armL.rotation.x) * r; this.armR.rotation.x += (armB - this.armR.rotation.x) * r;
    this.armL.rotation.z = damp(this.armL.rotation.z, armZ, 12, dt || 1); this.armR.rotation.z = -this.armL.rotation.z;
    this.squash = Math.max(0, this.squash - dt * 5);
    const sq = this.squash * 0.35;
    this.tilt.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    this.tilt.position.y = bob;
    // blink while invulnerable
    this.root.visible = this.invuln <= 0 || Math.floor(time * 20) % 2 === 0;
    this.light.position.set(p.x, p.y + 1.7, p.z);
    const bx = p.x - Math.sin(this.yaw) * 0.32, bz = p.z - Math.cos(this.yaw) * 0.32;
    this.trail.update(dt, bx, p.y + (this.sliding ? 0.5 : 1.3), bz, clamp((s - 5) / 8, 0, 1) * 0.85 + (gr.on ? 0.3 : 0));
    if (gr.on) {
      const a = gr.a, hx = p.x, hy = p.y + 1.5, hz = p.z;
      const dx = a.x - hx, dy = a.y - hy, dz = a.z - hz, d = Math.hypot(dx, dy, dz);
      this.rope.visible = true;
      this.rope.position.set(hx + dx / 2, hy + dy / 2, hz + dz / 2);
      this.rope.scale.set(1, d, 1);
      _up.set(0, 1, 0); _d.set(dx / d, dy / d, dz / d);
      this.rope.quaternion.setFromUnitVectors(_up, _d);
    } else this.rope.visible = false;
  }
}
const _up = new THREE.Vector3(), _d = new THREE.Vector3();
