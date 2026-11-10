// Atmosphere: procedural sky dome (day/night palettes), fog, moon/sun light with
// shadows, GPU rain streaks, lightning, and the reflection environment map.
import * as THREE from 'three';

// top/horizon at level start -> top2/horizon2 at level end (the sky drifts as you progress).
export const SKIES = [
  { name: 'dusk', top: 0x1b1147, hor: 0xff7a45, top2: 0x0d0a2c, hor2: 0xc2357a, glow: 0xff4fa0, fog: 0x3b2150, fogD: 0.0048,
    light: 0xffb38a, lightI: 1.5, sun: 0.9, trimA: 0x19f0ff, trimB: 0xff3fa4, stars: 0.3 },
  { name: 'night', top: 0x04050f, hor: 0x12306a, top2: 0x05040f, hor2: 0x2a1a6a, glow: 0x2de2ff, fog: 0x0b1530, fogD: 0.0052,
    light: 0x9fb8ff, lightI: 1.2, sun: 0, trimA: 0xff2fd0, trimB: 0x2de2ff, stars: 1 },
  { name: 'storm', top: 0x030508, hor: 0x16242c, top2: 0x05070b, hor2: 0x1d2f33, glow: 0x35ffb0, fog: 0x0c1519, fogD: 0.0066,
    light: 0x9ad0d8, lightI: 0.9, sun: 0, trimA: 0x3dffb4, trimB: 0xffd23f, stars: 0, storm: true },
  { name: 'predawn', top: 0x0a0726, hor: 0x9a2a7c, top2: 0x1a1048, hor2: 0xff6a8a, glow: 0xff5fd0, fog: 0x2a1244, fogD: 0.005,
    light: 0xd9a0ff, lightI: 1.25, sun: 0.25, trimA: 0xffe14a, trimB: 0xff3fa4, stars: 0.7 },
  { name: 'reddawn', top: 0x14051a, hor: 0xff3a2a, top2: 0x2a2a66, hor2: 0xffb060, glow: 0xff5a2a, fog: 0x3a141c, fogD: 0.0046,
    light: 0xff9a70, lightI: 1.5, sun: 1, trimA: 0x19f0ff, trimB: 0xff3b2f, stars: 0.4 },
];

const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FS = `
varying vec3 vDir;
uniform vec3 uTop, uHor, uGlow, uMoonDir, uSunDir;
uniform float uTime, uFlash, uStars, uSun;
float h31(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHor, uTop, pow(smoothstep(-0.06, 0.7, h), 0.5));
  col += uGlow * pow(1.0 - clamp(abs(h), 0., 1.), 9.0) * 0.45;
  // stars
  vec3 c = floor(d * 190.0);
  float s = h31(c);
  col += vec3(0.8,0.9,1.0) * step(0.9972, s) * smoothstep(0.08, 0.45, h) * (0.55 + 0.45*sin(uTime*2.0 + s*90.0)) * uStars;
  // moon
  float m = dot(d, uMoonDir);
  col += vec3(0.85,0.92,1.0) * (smoothstep(0.9987, 0.9992, m) * 1.4 + pow(max(m, 0.), 220.0) * 0.35) * (1.0 - uSun*0.7);
  // low sun
  float sd = dot(d, uSunDir);
  col += (vec3(1.0,0.75,0.5) * smoothstep(0.9965, 0.998, sd) * 2.5 + uGlow * pow(max(sd,0.), 14.0) * 0.9) * uSun;
  // clouds
  vec2 cp = d.xz / (abs(h) + 0.25) * 1.3 + vec2(uTime*0.012, 0.);
  float cl = smoothstep(0.45, 0.85, fbm(cp)) * smoothstep(-0.02, 0.3, h);
  col = mix(col, col*0.45 + uHor*0.22, cl*0.7);
  col += vec3(0.55,0.62,0.85) * uFlash * (0.25 + cl*1.6);
  gl_FragColor = vec4(col, 1.0);
}`;

const RAIN_VS = `
attribute vec3 aBase; attribute float aEnd;
uniform vec3 uCam; uniform float uTime; uniform vec3 uBox; uniform vec3 uVel; uniform float uLen;
varying float vA;
void main(){
  vec3 p = mod(aBase * uBox + uVel * uTime - uCam, uBox) - uBox * 0.5;
  vec3 w = uCam + p + normalize(uVel) * aEnd * uLen;
  vA = (1.0 - aEnd) * (1.0 - smoothstep(uBox.x*0.3, uBox.x*0.5, length(p.xz)));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_FS = `varying float vA; uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, vA * uOpacity); }`;

export class Env {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.flash = 0;
    this.nextFlash = 6;
    this.onThunder = null;

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(-0.45, 0.62, 0.64).normalize() },
        uSunDir: { value: new THREE.Vector3(0.1, 0.045, 1).normalize() },
        uTime: { value: 0 }, uFlash: { value: 0 }, uStars: { value: 1 }, uSun: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0x8899ff, 0x221133, 0.55);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.lightDir = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();
    scene.fog = new THREE.FogExp2(0x000000, 0.005);

    // rain
    const N = 5000;
    const base = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      base.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: new THREE.Vector3(46, 34, 46) },
        uVel: { value: new THREE.Vector3(-5, -46, 2) }, uLen: { value: 1.3 }, uColor: { value: new THREE.Color(0x9fc4ff) }, uOpacity: { value: 0.5 },
      },
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rainMax = N;
    scene.add(this.rain);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.setQuality(2);
  }

  setQuality(q) {
    this.quality = q;
    const size = q >= 3 ? 2048 : 1024;
    this.sun.castShadow = q >= 1;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    const R = q >= 2 ? 58 : 42;
    const c = this.sun.shadow.camera;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
    this.shadowR = R;
    this.applyRain();
  }

  applyRain() {
    const frac = [0.25, 0.5, 0.8, 1][this.quality] * (this.rainAmt ?? 0.6);
    this.rain.geometry.setDrawRange(0, Math.floor(this.rainMax * frac) * 2);
    this.rain.visible = frac > 0.01;
  }

  setSky(idx, rainAmt) {
    const s = (this.cfg = SKIES[idx]);
    this.rainAmt = rainAmt;
    this.progress = -1;
    this.setProgress(0);
    this.skyMat.uniforms.uGlow.value.set(s.glow);
    this.skyMat.uniforms.uStars.value = s.stars;
    this.skyMat.uniforms.uSun.value = s.sun;
    this.scene.fog.color.set(s.fog).multiplyScalar(0.62);
    this.scene.fog.density = s.fogD;
    this.sun.color.set(s.light);
    this.sun.intensity = s.lightI;
    this.hemi.color.set(s.top).lerp(new THREE.Color(s.glow), 0.3).multiplyScalar(1.3);
    this.hemi.groundColor.set(s.fog);
    this.hemi.intensity = 0.7;
    // dawn levels are lit from the low sun, others from the moon
    if (s.sun > 0.6) this.lightDir.set(0.25, 0.42, 0.87).normalize();
    else this.lightDir.set(-0.45, 0.62, 0.64).normalize();
    this.applyRain();
    this.bakeEnvironment();
  }

  // 0..1 through the level: the sky slowly shifts palette.
  setProgress(p) {
    if (Math.abs(p - this.progress) < 0.004) return;
    this.progress = p;
    const s = this.cfg, u = this.skyMat.uniforms;
    u.uTop.value.set(s.top).lerp(_c.set(s.top2), p);
    u.uHor.value.set(s.hor).lerp(_c.set(s.hor2), p);
  }

  // Small cube-map of the sky plus a few neon blobs: gives wet roofs something to reflect.
  bakeEnvironment() {
    const s = this.cfg;
    const es = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), this.skyMat);
    es.add(dome);
    const cols = [s.trimA, s.trimB, s.glow, 0xffc070, 0x40a0ff];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.sin(i * 7.1);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(5 + (i % 3) * 5, 3 + (i % 4) * 4, 1),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(2.2) })
      );
      m.position.set(Math.cos(a) * 60, 2 + ((i * 13) % 17), Math.sin(a) * 60);
      m.lookAt(0, 0, 0);
      es.add(m);
    }
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(es, 0.02, 1, 300);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.6;
    es.traverse((o) => { if (o.isMesh && o !== dome) { o.geometry.dispose(); o.material.dispose(); } });
    dome.geometry.dispose();
  }

  update(dt, camPos, focus) {
    this.time += dt;
    const u = this.skyMat.uniforms;
    u.uTime.value = this.time;
    this.sky.position.copy(camPos);
    const r = this.rainMat.uniforms;
    r.uTime.value = this.time;
    r.uCam.value.copy(camPos);

    // shadow frustum follows the focus point, snapped to texels to avoid shimmer
    const R = this.shadowR, texel = (R * 2) / this.sun.shadow.mapSize.x;
    _v.copy(focus);
    _v.x = Math.round(_v.x / texel) * texel; _v.y = Math.round(_v.y / texel) * texel; _v.z = Math.round(_v.z / texel) * texel;
    this.sun.target.position.copy(_v);
    this.sun.position.copy(_v).addScaledVector(this.lightDir, 120);

    // lightning
    if (this.cfg && this.cfg.storm) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = 5 + Math.random() * 9;
        this.flash = 1;
        if (this.onThunder) this.onThunder();
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.2);
      const f = this.flash * (0.6 + 0.4 * Math.sin(this.time * 70));
      u.uFlash.value = f;
      this.hemi.intensity = 0.7 + f * 3;
    } else if (u.uFlash.value !== 0) {
      u.uFlash.value = 0;
      this.hemi.intensity = 0.7;
    }
  }
}
const _c = new THREE.Color();
const _v = new THREE.Vector3();
