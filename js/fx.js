// Pooled visual effects: additive point particles, expanding ground rings, and a
// ribbon trail. No allocations after construction.
import * as THREE from 'three';

const P_VS = `
attribute vec3 aColor; attribute vec2 aSA;
varying vec3 vC; varying float vA;
uniform float uScale;
void main(){
  vC = aColor; vA = aSA.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSA.x * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const P_FS = `
varying vec3 vC; varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(d)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC * a, a);
}`;

export class FX {
  constructor(scene, max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.sa = new Float32Array(max * 2);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSA', new THREE.BufferAttribute(this.sa, 2).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VS, fragmentShader: P_FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, fog: false,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // ground rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.86, 1, 48);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 0, life: 0, r0: 0, r1: 0 });
    }
    this._c = new THREE.Color();
  }

  setViewport(h) { this.mat.uniforms.uScale.value = h * 0.9; }

  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size; this.grav[i] = grav; this.drag[i] = drag;
  }

  // Spherical burst. opts: count, speed, size, life, grav, up (bias), spread (0..1 hemisphere), drag
  burst(x, y, z, hexColor, o = {}) {
    const c = this._c.set(hexColor);
    const n = o.count || 12, sp = o.speed || 5;
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const s = sp * (0.35 + Math.random() * 0.65);
      let vy = u * s;
      if (o.up) vy = Math.abs(vy) * 0.6 + o.up * Math.random();
      if (o.flat) vy *= 0.15;
      this.spawn(x + (Math.random() - 0.5) * (o.jitter || 0.2), y + (Math.random() - 0.5) * (o.jitter || 0.2), z + (Math.random() - 0.5) * (o.jitter || 0.2),
        r * Math.cos(th) * s, vy, r * Math.sin(th) * s, c, (o.size || 0.35) * (0.6 + Math.random() * 0.8), (o.life || 0.6) * (0.6 + Math.random() * 0.6), o.grav ?? 9, o.drag ?? 1.5);
    }
  }

  ring(x, y, z, hexColor, r0, r1, life) {
    let best = this.rings[0];
    for (const r of this.rings) { if (r.t >= r.life) { best = r; break; } if (r.life - r.t < best.life - best.t) best = r; }
    best.t = 0; best.life = life; best.r0 = r0; best.r1 = r1;
    best.m.position.set(x, y + 0.08, z);
    best.m.material.color.set(hexColor);
    best.m.visible = true;
    return best;
  }

  update(dt) {
    const { pos, vel, life, maxLife, sa, size, grav, drag, max } = this;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      if (life[i] <= 0) { sa[i * 2] = 0; sa[i * 2 + 1] = 0; continue; }
      const k = Math.max(0, 1 - drag[i] * dt);
      vel[j] *= k; vel[j + 2] *= k; vel[j + 1] = vel[j + 1] * k - grav[i] * dt;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const f = life[i] / maxLife[i];
      sa[i * 2] = size[i] * (0.4 + 0.6 * f);
      sa[i * 2 + 1] = Math.min(1, f * 2.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSA.needsUpdate = true;
    for (const r of this.rings) {
      if (r.t >= r.life) continue;
      r.t += dt;
      if (r.t >= r.life) { r.m.visible = false; continue; }
      const f = r.t / r.life;
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - f, 2.2));
      r.m.scale.setScalar(s);
      r.m.material.opacity = (1 - f) * 0.9;
    }
  }

  clear() {
    this.life.fill(0); this.sa.fill(0);
    for (const r of this.rings) { r.t = r.life = 0; r.m.visible = false; }
  }
}

// Ribbon that trails behind a moving point (the courier's scarf of light).
export class Trail {
  constructor(scene, color, segs = 26, width = 0.34) {
    this.n = segs; this.width = width;
    this.hist = new Float32Array(segs * 3);
    const pos = new Float32Array(segs * 2 * 3), alpha = new Float32Array(segs * 2);
    const idx = [];
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i < segs; i++) alpha[i * 2] = alpha[i * 2 + 1] = 1 - i / (segs - 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(alpha, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 1 } },
      vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; uniform vec3 uColor; uniform float uPower; void main(){ gl_FragColor = vec4(uColor * 1.8, vA * vA * uPower); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.acc = 0;
  }
  reset(x, y, z) { for (let i = 0; i < this.n; i++) this.hist.set([x, y, z], i * 3); }
  update(dt, x, y, z, power) {
    const h = this.hist, n = this.n;
    this.acc += dt;
    if (this.acc > 0.016) {
      this.acc = 0;
      h.copyWithin(3, 0, (n - 1) * 3);
    }
    h[0] = x; h[1] = y; h[2] = z;
    const p = this.mesh.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const w = this.width * (1 - i / n) * 0.5;
      p[i * 6] = h[i * 3]; p[i * 6 + 1] = h[i * 3 + 1] + w; p[i * 6 + 2] = h[i * 3 + 2];
      p[i * 6 + 3] = h[i * 3]; p[i * 6 + 4] = h[i * 3 + 1] - w; p[i * 6 + 5] = h[i * 3 + 2];
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mat.uniforms.uPower.value = power;
  }
}
