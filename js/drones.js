// Patrol drones (vision cone + line of sight -> alert -> chase) and sniper drones
// (tracking laser that locks, then fires). Getting hit costs seconds.
import * as THREE from 'three';
import { angleDelta } from './util.js';

const COL = { patrol: 0x35e8ff, alert: 0xffd23f, chase: 0xff3030 };
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();

export class Drones {
  constructor(scene, route, game) {
    this.scene = scene;
    this.game = game;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.geo = {
      body: new THREE.SphereGeometry(0.42, 14, 10),
      eye: new THREE.SphereGeometry(0.16, 10, 8),
      ring: new THREE.TorusGeometry(0.66, 0.05, 6, 20),
      cone: new THREE.ConeGeometry(3.6, 10, 20, 1, true),
      beam: new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
    };
    this.geo.cone.translate(0, -5, 0);
    this.geo.cone.rotateX(-Math.PI / 2); // apex at origin, opening toward +Z
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x20232e, roughness: 0.35, metalness: 0.8 });
    for (const d of route.drones) this.add(d);
  }

  add(d) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geo.body, this.bodyMat);
    body.castShadow = true;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const eye = new THREE.Mesh(this.geo.eye, eyeMat);
    eye.position.set(0, -0.05, 0.36);
    const ring = new THREE.Mesh(this.geo.ring, eyeMat);
    ring.rotation.x = Math.PI / 2;
    g.add(body, eye, ring);
    const o = {
      kind: d.kind, plat: d.plat, p: new THREE.Vector3(d.ax, d.y, d.az), a: new THREE.Vector3(d.ax, d.y, d.az), b: new THREE.Vector3(d.bx, d.y, d.bz),
      dir: 1, yaw: 0, state: 'patrol', t: 0, cool: 0, mesh: g, ring, eyeMat, close: false, bob: Math.random() * 6,
      lock: new THREE.Vector3(),
    };
    if (d.kind === 'patrol') {
      o.coneMat = new THREE.MeshBasicMaterial({ color: COL.patrol, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false });
      o.cone = new THREE.Mesh(this.geo.cone, o.coneMat);
      o.cone.rotation.x = 0.16;
      g.add(o.cone);
    } else {
      o.beamMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      o.beam = new THREE.Mesh(this.geo.beam, o.beamMat);
      o.beam.visible = false; o.beam.frustumCulled = false;
      this.group.add(o.beam);
      g.scale.setScalar(1.25);
    }
    this.setColor(o, COL.patrol);
    this.group.add(g);
    this.list.push(o);
  }
  setColor(o, hex) {
    o.eyeMat.color.set(hex).multiplyScalar(2.6);
    if (o.coneMat) o.coneMat.color.set(hex);
  }
  onPlat(i) { return this.list.some((d) => d.plat === i); }

  update(dt, game, idle) {
    const pl = game.player, w = game.world, a = game.audio;
    const px = pl.p.x, py = pl.p.y + pl.h * 0.55, pz = pl.p.z;
    for (const d of this.list) {
      d.bob += dt;
      d.cool = Math.max(0, d.cool - dt);
      d.ring.rotation.z += dt * (d.state === 'chase' ? 14 : 4);
      const dx = px - d.p.x, dy = py - d.p.y, dz = pz - d.p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (d.kind === 'patrol') {
        if (d.state === 'patrol' || d.state === 'return') {
          const tgt = d.dir > 0 ? d.b : d.a;
          const tx = tgt.x - d.p.x, ty = tgt.y - d.p.y, tz = tgt.z - d.p.z, tl = Math.hypot(tx, ty, tz);
          const sp = d.state === 'return' ? 6 : 3.2;
          if (tl < 0.3) { d.dir = -d.dir; d.state = 'patrol'; this.setColor(d, COL.patrol); }
          else { d.p.x += (tx / tl) * sp * dt; d.p.y += (ty / tl) * sp * dt; d.p.z += (tz / tl) * sp * dt; d.yaw += angleDelta(d.yaw, Math.atan2(tx, tz)) * Math.min(1, 5 * dt); }
          // vision: range + cone + line of sight
          if (!idle && d.cool <= 0 && dist < 15 && Math.abs(dy) < 5 && pl.invuln <= 0) {
            const ang = Math.abs(angleDelta(d.yaw, Math.atan2(dx, dz)));
            if (ang < 0.75 && w.raycast(d.p.x, d.p.y, d.p.z, dx / dist, dy / dist, dz / dist, dist - 0.4) < 0) {
              d.state = 'alert'; d.t = 0.55; this.setColor(d, COL.alert); a.alert();
            }
          }
        } else if (d.state === 'alert') {
          d.t -= dt;
          d.yaw += angleDelta(d.yaw, Math.atan2(dx, dz)) * Math.min(1, 10 * dt);
          if (d.t <= 0) { d.state = 'chase'; d.t = 4.2; d.close = false; this.setColor(d, COL.chase); }
        } else if (d.state === 'chase') {
          d.t -= dt;
          const sp = 8.4;
          if (dist > 0.01) { d.p.x += (dx / dist) * sp * dt; d.p.y += (dy / dist) * sp * dt; d.p.z += (dz / dist) * sp * dt; }
          d.yaw = Math.atan2(dx, dz);
          if (dist < 3.2) d.close = true;
          if (dist < 1.25) {
            game.hit(5, d.p.x, d.p.z, 'DRONE ZAP');
            d.state = 'return'; d.cool = 2.5; d.close = false; this.setColor(d, COL.patrol);
          } else if (d.t <= 0 || dist > 30 || idle) {
            if (d.close || dist > 12) game.trick('SHAKEN OFF', 80);
            d.state = 'return'; d.cool = 1.5; this.setColor(d, COL.patrol);
          }
        }
        if (d.coneMat) d.coneMat.opacity = d.state === 'chase' ? 0.1 : d.state === 'alert' ? 0.16 : 0.06;
      } else {
        // ---- sniper ----
        d.yaw += angleDelta(d.yaw, Math.atan2(dx, dz)) * Math.min(1, 4 * dt);
        if (d.state === 'patrol') {
          if (!idle && d.cool <= 0 && dist < 40 && pl.invuln <= 0 && Math.abs(game.curPlat - d.plat) <= 2 &&
            w.raycast(d.p.x, d.p.y, d.p.z, dx / dist, dy / dist, dz / dist, dist - 0.4) < 0) {
            d.state = 'aim'; d.t = 1.15; a.charge(1.1); this.setColor(d, COL.alert);
          }
        } else if (d.state === 'aim') {
          d.t -= dt;
          if (d.t > 0.32) d.lock.set(dx / dist, dy / dist, dz / dist); // tracks, then locks for the last 0.32 s
          else this.setColor(d, COL.chase);
          d.beam.visible = true;
          d.beamMat.opacity = d.t > 0.32 ? 0.35 : 0.9;
          this.placeBeam(d, d.t > 0.32 ? 1 : 2.4);
          if (d.t <= 0 || idle) {
            if (!idle) {
              a.shot();
              // distance from player to the locked ray
              const t = Math.max(0, dx * d.lock.x + dy * d.lock.y + dz * d.lock.z);
              const ex = dx - d.lock.x * t, ey = dy - d.lock.y * t, ez = dz - d.lock.z * t;
              if (Math.hypot(ex, ey, ez) < 0.95) game.hit(4, d.p.x, d.p.z, 'SNIPED');
              else if (Math.hypot(ex, ey, ez) < 3.5) game.trick('DODGED', 80);
              const hitD = w.raycast(d.p.x, d.p.y, d.p.z, d.lock.x, d.lock.y, d.lock.z, 46);
              const L = hitD > 0 ? hitD : 46;
              game.fx.burst(d.p.x + d.lock.x * L, d.p.y + d.lock.y * L, d.p.z + d.lock.z * L, 0xff5030, { count: 18, speed: 7, size: 0.45, life: 0.45 });
            }
            d.state = 'patrol'; d.cool = 2.4; d.beam.visible = false; this.setColor(d, COL.patrol);
          }
        }
      }
      d.mesh.position.set(d.p.x, d.p.y + Math.sin(d.bob * 2.2) * 0.14, d.p.z);
      d.mesh.rotation.y = d.yaw;
    }
  }

  placeBeam(d, thick) {
    const L = 46;
    d.beam.position.set(d.p.x + d.lock.x * L / 2, d.p.y + d.lock.y * L / 2, d.p.z + d.lock.z * L / 2);
    d.beam.scale.set(thick, L, thick);
    d.beam.quaternion.setFromUnitVectors(_up, _d.copy(d.lock));
  }

  dispose() {
    this.scene.remove(this.group);
    for (const k in this.geo) this.geo[k].dispose();
    this.bodyMat.dispose();
    for (const d of this.list) { d.eyeMat.dispose(); d.coneMat && d.coneMat.dispose(); d.beamMat && d.beamMat.dispose(); }
  }
}
