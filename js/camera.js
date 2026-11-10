// Third-person orbit camera with collision, speed FOV, wall-run roll and trauma shake.
import { clamp, damp, angleDelta } from './util.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0; this.pitch = -0.28;
    this.dist = 6.6; this.cur = 6.6;
    this.trauma = 0; this.shakeOn = true;
    this.roll = 0; this.fov = 68;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.idle = 0; this.assist = false;
    this.t = 0;
  }
  snap(player, yaw) {
    this.yaw = yaw; this.pitch = -0.28; this.cur = this.dist;
    this.tx = player.p.x; this.ty = player.p.y + 1.5; this.tz = player.p.z;
    this.roll = 0; this.trauma = 0;
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }

  update(dt, player, world, lookX, lookY) {
    this.t += dt;
    this.yaw -= lookX;
    this.pitch = clamp(this.pitch - lookY, -1.25, 0.95);
    // touch / pad players get a gentle auto-follow when they are not steering the camera
    this.idle = lookX || lookY ? 0 : this.idle + dt;
    if (this.assist && this.idle > 0.7 && player.speed > 4) {
      this.yaw += angleDelta(this.yaw, Math.atan2(player.v.x, player.v.z)) * Math.min(1, 1.8 * dt);
    }
    const p = player.p;
    const th = player.h - 0.25;
    this.tx = damp(this.tx, p.x, 30, dt); this.tz = damp(this.tz, p.z, 30, dt);
    this.ty = damp(this.ty, p.y + th, 14, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cp, fy = sp, fz = Math.cos(this.yaw) * cp;
    // collision: pull the camera in when geometry is between it and the player
    let want = this.dist;
    const hit = world.raycast(this.tx, this.ty, this.tz, -fx, -fy, -fz, this.dist + 0.4);
    if (hit >= 0) want = Math.max(0.7, hit - 0.35);
    this.cur = want < this.cur ? want : damp(this.cur, want, 5, dt);
    const c = this.cam;
    c.position.set(this.tx - fx * this.cur, this.ty - fy * this.cur + 0.35, this.tz - fz * this.cur);
    c.lookAt(this.tx + fx * 4, this.ty + fy * 4 + 0.5, this.tz + fz * 4);
    // roll while wall-running
    let rollT = 0;
    if (player.wr.on) {
      const right = -Math.cos(this.yaw) * player.wr.nx + Math.sin(this.yaw) * player.wr.nz;
      rollT = 0.14 * Math.sign(right);
    }
    this.roll = damp(this.roll, rollT, 7, dt);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    let sx = 0, sy = 0, sr = 0;
    if (this.shakeOn && this.trauma > 0) {
      const a = this.trauma * this.trauma, t = this.t * 43;
      sx = Math.sin(t * 1.3) * Math.cos(t * 0.7 + 1) * a * 0.5;
      sy = Math.sin(t * 1.7 + 2) * a * 0.5;
      sr = Math.sin(t * 2.1) * a * 0.05;
    }
    c.rotateZ(this.roll + sr);
    c.translateX(sx); c.translateY(sy);
    const fovT = 68 + clamp((player.speed - 10) / 9, 0, 1) * 15 + (player.gr.on ? 8 : 0);
    this.fov = damp(this.fov, fovT, 5, dt);
    if (Math.abs(c.fov - this.fov) > 0.05) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }
}
