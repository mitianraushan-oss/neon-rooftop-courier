// Builds the playable city from route data: instanced buildings with a procedural
// window / wet-roof shader, neon signs, walls, barriers, pads, grapple buoys,
// pickups, delivery beacons, traffic - plus the collision grid.
import * as THREE from 'three';
import { makeRng } from './util.js';
import { SKIES } from './env.js';

// ---------- collision grid ----------
export class Grid {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); this.stamp = 0; this.out = []; }
  add(box) {
    const c = this.cell;
    for (let x = Math.floor(box.minX / c); x <= Math.floor(box.maxX / c); x++)
      for (let z = Math.floor(box.minZ / c); z <= Math.floor(box.maxZ / c); z++) {
        const k = x * 4096 + z;
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(box);
      }
    box._s = 0;
  }
  query(minX, minZ, maxX, maxZ) {
    const c = this.cell, out = this.out;
    out.length = 0;
    const st = ++this.stamp;
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++)
      for (let z = Math.floor(minZ / c); z <= Math.floor(maxZ / c); z++) {
        const a = this.map.get(x * 4096 + z);
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const b = a[i];
          if (b._s !== st) { b._s = st; out.push(b); }
        }
      }
    return out;
  }
}

// ---------- building shader ----------
const B_VS_DECL = `
attribute vec4 aInfo;
varying vec3 vWPos; varying vec3 vONormal; varying vec3 vOPos; varying vec3 vScale; varying vec4 vInfo;`;
const B_VS_MAIN = `
#ifdef USE_INSTANCING
  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vScale = vec3(instanceMatrix[0][0], instanceMatrix[1][1], instanceMatrix[2][2]);
#else
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vScale = vec3(1.0);
#endif
  vONormal = normal; vOPos = position; vInfo = aInfo;`;
const B_FS_DECL = `
uniform float uTime; uniform vec3 uTrimA; uniform vec3 uTrimB; uniform float uWet;
varying vec3 vWPos; varying vec3 vONormal; varying vec3 vOPos; varying vec3 vScale; varying vec4 vInfo;
float bh21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float bvn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(bh21(i),bh21(i+vec2(1,0)),f.x),mix(bh21(i+vec2(0,1)),bh21(i+vec2(1,1)),f.x),f.y); }
vec3 bEmis = vec3(0.0); float bRough = 0.85; vec3 bPert = vec3(0.0);`;
const B_FS_COLOR = `
{
  float camD = length(vWPos - cameraPosition);
  if (vONormal.y > 0.5) {
    vec2 p = vWPos.xz;
    float n = bvn(p*0.16)*0.62 + bvn(p*0.63)*0.38;
    float puddle = smoothstep(0.50, 0.62, n) * uWet;
    vec3 base = mix(vec3(0.05,0.055,0.07), vec3(0.085,0.09,0.115), vInfo.y);
    vec2 g = abs(fract(p/4.0)-0.5);
    float line = smoothstep(0.47,0.5,max(g.x,g.y));
    base *= 1.0 - 0.4*line*(1.0-puddle);
    base += bvn(p*3.1)*0.012;
    diffuseColor.rgb = mix(base, base*0.35, puddle);
    bRough = mix(0.78, 0.04, puddle);
    // rain ripples in puddles
    vec2 rc = floor(p/1.3); vec2 rf = fract(p/1.3)-0.5;
    float ph = bh21(rc);
    float t = fract(uTime*0.8 + ph*9.0);
    vec2 off = (vec2(bh21(rc+3.1), bh21(rc+7.7))-0.5)*0.5;
    float d = length(rf-off);
    float ring = sin((d - t*0.45)*46.0) * smoothstep(0.45*t+0.05, 0.45*t, d) * smoothstep(0.45*t-0.14, 0.45*t, d) * (1.0-t);
    bPert = vec3(rf.x-off.x, 0.0, rf.y-off.y) * ring * 2.4 * puddle * smoothstep(60.0, 20.0, camD);
    // glowing edge band on route roofs so the path reads at a glance
    float ed = min((0.5-abs(vOPos.x))*vScale.x, (0.5-abs(vOPos.z))*vScale.z);
    float band = smoothstep(0.62,0.45,ed)*smoothstep(0.12,0.22,ed);
    bEmis += uTrimA * band * 1.5 * vInfo.y;
  } else if (vONormal.y > -0.5) {
    float u = abs(vONormal.x) > 0.5 ? vWPos.z : vWPos.x;
    vec2 cell = vec2(u/2.6, vWPos.y/3.4);
    vec2 ci = floor(cell); vec2 cf = fract(cell);
    float win = step(0.16,cf.x)*step(cf.x,0.84)*step(0.24,cf.y)*step(cf.y,0.78);
    float r = bh21(ci + vInfo.x*91.7);
    float lit = step(1.0 - vInfo.w, r);
    float r2 = bh21(ci*1.7 + vInfo.x*13.3);
    vec3 wc = r2 < 0.5 ? vec3(1.0,0.62,0.25) : (r2 < 0.74 ? vec3(0.12,0.7,1.0) : (r2 < 0.9 ? vec3(1.0,0.12,0.55) : vec3(0.7,0.85,1.0)));
    float flick = 0.85 + 0.15*sin(uTime*(0.6+r*2.0)+r*40.0);
    float farFade = mix(1.0, 0.55, smoothstep(120.0, 320.0, camD));
    bEmis += wc * mix(win, 0.42, smoothstep(140.0, 300.0, camD)) * lit * (0.1 + 0.95*r2*r) * flick * farFade;
    diffuseColor.rgb = mix(vec3(0.035,0.04,0.055), vec3(0.015,0.02,0.03), win);
    bRough = mix(0.65, 0.12, win);
    float top = vScale.y;
    float trim = smoothstep(top-0.7, top-0.5, vWPos.y);
    vec3 tc = vInfo.y > 0.5 ? uTrimA*1.5 : (vInfo.z < 0.34 ? uTrimB*1.1 : (vInfo.z > 0.86 ? uTrimA*0.9 : vec3(0.0)));
    bEmis += tc * trim;
    // faint vertical neon seams on some towers
    float seam = step(0.9, vInfo.z) * smoothstep(0.46,0.5,abs(fract(u/vScale.x*0.0+u*0.12)-0.5));
    bEmis += uTrimB * seam * 0.5;
  } else {
    diffuseColor.rgb = vec3(0.02);
  }
}`;

function makeBuildingMaterial(sky, uniforms) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + B_VS_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + B_VS_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + B_FS_DECL)
      .replace('#include <map_fragment>', '#include <map_fragment>' + B_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(bPert, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmis;');
  };
  m.customProgramCacheKey = () => 'nrc-building';
  return m;
}

// ---------- procedural textures ----------
const WORDS = ['RAMEN', 'NOODLE', 'VOLT', 'HOTEL', '24H', 'SYNTH', 'NEO', 'BAR', 'DATA', 'ARCADE', 'TAXI', 'CLUB', 'KIRA', 'OXYGEN', 'ZEN', 'MOTEL', 'SODA', 'PIXEL'];
const VWORDS = ['電脳', '未来', '夜市', 'ラーメン', '酒場', 'NEON', 'OPEN', '光'];
function signTexture(text, color, vertical) {
  const c = document.createElement('canvas');
  c.width = vertical ? 96 : 320; c.height = vertical ? 320 : 112;
  const g = c.getContext('2d');
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = color; g.lineWidth = 5; g.shadowColor = color; g.shadowBlur = 14;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowBlur = 18;
  if (vertical) {
    const chars = [...text];
    const step = Math.min(74, (c.height - 40) / chars.length);
    g.font = `900 ${Math.min(62, step * 0.9)}px "Hiragino Sans","Yu Gothic","Noto Sans CJK JP",system-ui,sans-serif`;
    chars.forEach((ch, i) => { g.fillStyle = i % 2 ? color : '#fff'; g.fillText(ch, c.width / 2, c.height / 2 + (i - (chars.length - 1) / 2) * step); });
  } else {
    let size = 70;
    g.font = `900 ${size}px "Arial Black",Impact,system-ui,sans-serif`;
    const w = g.measureText(text).width;
    if (w > c.width - 44) { size *= (c.width - 44) / w; g.font = `900 ${size}px "Arial Black",Impact,system-ui,sans-serif`; }
    g.fillStyle = color; g.fillText(text, c.width / 2, c.height / 2 + 3);
    g.shadowBlur = 0; g.globalAlpha = 0.85; g.fillStyle = '#fff'; g.fillText(text, c.width / 2, c.height / 2 + 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function stripeTexture(kind, colA, colB) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#04050a'; g.fillRect(0, 0, 512, 128);
  if (kind === 'wall') {
    // mirror-symmetric racing lines + diamonds
    g.shadowColor = colA; g.shadowBlur = 10; g.fillStyle = colA;
    g.fillRect(0, 22, 512, 7); g.fillRect(0, 99, 512, 7);
    g.fillStyle = colB; g.shadowColor = colB;
    for (let i = 0; i < 8; i++) {
      const x = 32 + i * 64;
      g.beginPath(); g.moveTo(x, 44); g.lineTo(x + 18, 64); g.lineTo(x, 84); g.lineTo(x - 18, 64); g.closePath(); g.fill();
    }
  } else {
    g.fillStyle = colA;
    for (let i = -2; i < 12; i++) {
      g.beginPath(); g.moveTo(i * 64, 128); g.lineTo(i * 64 + 32, 128); g.lineTo(i * 64 + 96, 0); g.lineTo(i * 64 + 64, 0); g.closePath(); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const boxFromRect = (r, minY, maxY, extra) => ({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, minY, maxY, ...extra });

export class World {
  constructor(scene, route, quality = 2) {
    this.scene = scene;
    this.route = route;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.grid = new Grid(16);
    this.time = 0;
    this.disposables = [];
    const cfg = route.cfg, sky = SKIES[cfg.sky];
    const R = makeRng(cfg.seed * 7 + 3);
    const track = (o) => { this.disposables.push(o); return o; };
    this.uniforms = {
      uTime: { value: 0 }, uTrimA: { value: new THREE.Color(sky.trimA) }, uTrimB: { value: new THREE.Color(sky.trimB) },
      uWet: { value: 0.35 + cfg.rain * 0.65 },
    };
    const colA = hex(sky.trimA), colB = hex(sky.trimB);

    // ---- colliders ----
    for (const p of route.plats)
      this.grid.add(boxFromRect({ minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz }, 0, p.top, { route: true, kind: 'roof', plat: p.i }));
    if (route.secret) {
      const p = route.secret;
      this.grid.add(boxFromRect({ minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz }, 0, p.top, { route: true, kind: 'roof', plat: -1 }));
    }
    for (const f of route.fillers)
      if (f.near) this.grid.add({ minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2, minY: 0, maxY: f.h, route: false, kind: 'filler' });

    // ---- instanced buildings ----
    const all = [];
    for (const p of route.plats) all.push({ x: p.x, z: p.z, w: p.hx * 2, d: p.hz * 2, h: p.top, route: 1, seed: R(), hue: R(), lit: 0.3 });
    if (route.secret) { const p = route.secret; all.push({ x: p.x, z: p.z, w: 7, d: 7, h: p.top, route: 1, seed: R(), hue: R(), lit: 0.2 }); }
    for (const f of route.fillers) all.push({ x: f.x, z: f.z, w: f.w, d: f.d, h: f.h, route: 0, seed: f.seed, hue: R(), lit: R.range(0.22, 0.6) });
    const geo = track(new THREE.BoxGeometry(1, 1, 1));
    geo.translate(0, 0.5, 0);
    const info = new Float32Array(all.length * 4);
    const mat = track(makeBuildingMaterial(sky, this.uniforms));
    const inst = new THREE.InstancedMesh(geo, mat, all.length);
    const m4 = new THREE.Matrix4();
    all.forEach((b, i) => {
      m4.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
      inst.setMatrixAt(i, m4);
      info.set([b.seed, b.route, b.hue, b.lit], i * 4);
    });
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    inst.castShadow = true; inst.receiveShadow = true;
    inst.frustumCulled = false;
    this.group.add(inst);
    this.buildings = inst;

    // street far below
    const street = new THREE.Mesh(track(new THREE.PlaneGeometry(2400, 2400)), track(new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.25, metalness: 0.2 })));
    street.rotation.x = -Math.PI / 2;
    street.position.set((route.bounds.minX + route.bounds.maxX) / 2, 0, (route.bounds.minZ + route.bounds.maxZ) / 2);
    this.group.add(street);

    // ---- wallrun walls ----
    const wallTex = track(stripeTexture('wall', colA, colB));
    const wallMat = track(new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.35, metalness: 0.6, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 2.0 }));
    const unit = track(new THREE.BoxGeometry(1, 1, 1));
    const addBox = (b, material, shadow = true) => {
      const m = new THREE.Mesh(unit, material);
      m.scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      m.castShadow = shadow; m.receiveShadow = shadow;
      this.group.add(m);
      return m;
    };
    this.pads = [];
    this.anchors = [];
    const padGeo = track(new THREE.CylinderGeometry(1.6, 1.8, 0.25, 24));
    const padMat = track(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: sky.trimB, emissiveIntensity: 2.2, roughness: 0.4 }));
    const padRingGeo = track(new THREE.TorusGeometry(1.5, 0.07, 8, 32));
    const ringMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(sky.trimB).multiplyScalar(2.5), toneMapped: false }));
    const buoyGeo = track(new THREE.TorusGeometry(0.9, 0.12, 10, 28));
    const buoyCore = track(new THREE.OctahedronGeometry(0.42, 0));
    const buoyMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23f).multiplyScalar(2.4), toneMapped: false }));
    for (const L of route.links) {
      if (L.wall) {
        this.grid.add({ ...L.wall, route: true, kind: 'wall', runnable: true });
        addBox(L.wall, wallMat);
      }
      if (L.pad) {
        const m = new THREE.Mesh(padGeo, padMat);
        m.position.set(L.pad.x, L.pad.y + 0.12, L.pad.z);
        const ring = new THREE.Mesh(padRingGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        m.add(ring);
        this.group.add(m);
        this.pads.push({ ...L.pad, mesh: m, ring, cool: 0 });
      }
      if (L.anchor) {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(buoyGeo, buoyMat);
        const core = new THREE.Mesh(buoyCore, buoyMat);
        g.add(ring, core);
        g.position.set(L.anchor.x, L.anchor.y, L.anchor.z);
        this.group.add(g);
        this.anchors.push({ x: L.anchor.x, y: L.anchor.y, z: L.anchor.z, baseY: L.anchor.y, mesh: g, ring, hot: 0 });
      }
    }

    // ---- slide barriers ----
    const barTex = track(stripeTexture('hazard', '#ffd23f', '#000'));
    const barMat = track(new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.5, metalness: 0.5, emissive: 0xffffff, emissiveMap: barTex, emissiveIntensity: 1.5 }));
    const postMat = track(new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.6, metalness: 0.7 }));
    for (const p of route.plats) {
      if (!p.barrier) continue;
      const b = p.barrier;
      this.grid.add({ ...b, route: true, kind: 'barrier' });
      addBox(b, barMat);
      // under-glow strip so the slide gap is obvious
      const strip = addBox({ ...b, minY: b.minY - 0.06, maxY: b.minY }, ringMat, false);
      strip.scale.x *= b.a === 'x' ? 0.5 : 1; strip.scale.z *= b.a === 'z' ? 0.5 : 1;
    }

    // ---- delivery beacons + checkpoints ----
    this.deliveries = [];
    const beamGeo = track(new THREE.CylinderGeometry(2.6, 2.6, 120, 24, 1, true));
    const padDGeo = track(new THREE.RingGeometry(2.4, 3.1, 40));
    const cpGeo = track(new THREE.PlaneGeometry(1, 0.35));
    this.checkpoints = [];
    for (const i of route.deliveries) {
      const p = route.plats[i];
      const final = i === route.plats.length - 1;
      const col = new THREE.Color(final ? 0xffe14a : 0x5dff9b);
      const bm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.55), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const beam = new THREE.Mesh(beamGeo, bm);
      beam.position.set(p.x, p.top + 60, p.z);
      const rm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), toneMapped: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(padDGeo, rm);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, p.top + 0.06, p.z);
      this.group.add(beam, ring);
      this.disposables.push(bm, rm);
      this.deliveries.push({ plat: i, x: p.x, y: p.top, z: p.z, r: 3.4, done: false, final, beam, ring });
    }
    const cpMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(sky.trimA).multiplyScalar(1.6), toneMapped: false }));
    for (const p of route.plats) {
      if (!p.checkpoint || p.delivery) continue;
      const m = new THREE.Mesh(cpGeo, cpMat);
      m.rotation.x = -Math.PI / 2;
      const along = p.inDir.x !== 0;
      m.scale.set(along ? 1 : p.hx * 1.5, along ? p.hz * 1.5 / 0.35 * 0.35 : 1, 1);
      if (along) m.scale.set(1, (p.hz * 1.5) / 0.35, 1);
      m.position.set(p.x - p.inDir.x * (p.hx - 2.2), p.top + 0.05, p.z - p.inDir.z * (p.hz - 2.2));
      this.group.add(m);
    }

    // ---- pickups (instanced) ----
    this.pickups = route.pickups.map((p) => ({ ...p, taken: false }));
    const shardGeo = track(new THREE.OctahedronGeometry(0.34, 0));
    const shardMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.pickMesh = new THREE.InstancedMesh(shardGeo, shardMat, this.pickups.length);
    const cShard = new THREE.Color(0x35e8ff).multiplyScalar(2.0), cChrono = new THREE.Color(0xffc93a).multiplyScalar(2.6), cCat = new THREE.Color(0xff5fd0).multiplyScalar(0.01);
    this.pickups.forEach((p, i) => this.pickMesh.setColorAt(i, p.kind === 'shard' ? cShard : p.kind === 'chrono' ? cChrono : cCat));
    this.pickMesh.frustumCulled = false;
    this.group.add(this.pickMesh);
    this.shardTotal = this.pickups.filter((p) => p.kind === 'shard').length;
    const catP = this.pickups.find((p) => p.kind === 'cat');
    if (catP) { this.cat = makeCat(); this.cat.position.set(catP.x, catP.y - 1.05, catP.z); this.group.add(this.cat); }

    // ---- neon signs ----
    const signCols = [colA, colB, '#ffd23f', '#ff5a3c', '#7dff6b', '#b388ff'];
    const hTex = [], vTex = [];
    for (let i = 0; i < 9; i++) hTex.push(track(signTexture(R.pick(WORDS), signCols[i % signCols.length], false)));
    for (let i = 0; i < 6; i++) vTex.push(track(signTexture(R.pick(VWORDS), signCols[(i + 2) % signCols.length], true)));
    const mkMat = (t) => track(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.9, 1.9, 1.9), toneMapped: false, side: THREE.DoubleSide }));
    const hMat = hTex.map(mkMat), vMat = vTex.map(mkMat);
    const plane = track(new THREE.PlaneGeometry(1, 1));
    let signs = 0;
    const maxSigns = quality >= 2 ? 80 : 40;
    const cx = (route.bounds.minX + route.bounds.maxX) / 2;
    for (const f of route.fillers) {
      if (signs >= maxSigns) break;
      if (f.dist > 95) continue;
      if (f.near && R.chance(0.42)) {
        // rooftop billboard, visible from above
        const w = R.range(7, 11), h = w * 0.35;
        const m = new THREE.Mesh(plane, R.pick(hMat));
        m.scale.set(w, h, 1);
        m.position.set(f.x, f.h + h / 2 + 1.2, f.z);
        m.rotation.y = R.pick([0, Math.PI / 2]) + R.range(-0.15, 0.15);
        this.group.add(m);
        const post = new THREE.Mesh(unit, postMat);
        post.scale.set(0.3, 1.4, 0.3); post.position.set(f.x, f.h + 0.7, f.z);
        this.group.add(post);
        signs++;
      } else if (!f.near && f.dist < 95 && R.chance(0.5)) {
        // vertical blade sign on the side facing the route
        const h = R.range(12, 20), w = h * 0.3;
        const m = new THREE.Mesh(plane, R.pick(vMat));
        m.scale.set(w, h, 1);
        const side = f.x > cx ? -1 : 1;
        m.position.set(f.x + side * (f.w / 2 + 0.4), f.h - h / 2 - R.range(2, 10), f.z + R.range(-3, 3));
        m.rotation.y = Math.PI / 2;
        this.group.add(m);
        signs++;
      }
    }

    // ---- hover traffic ----
    const TN = quality >= 2 ? 90 : 40;
    this.trafficN = TN;
    const carGeo = track(new THREE.BoxGeometry(0.9, 0.35, 3.4));
    const carMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.traffic = new THREE.InstancedMesh(carGeo, carMat, TN);
    this.traffic.frustumCulled = false;
    this.cars = [];
    const cw = new THREE.Color(0xfff0c0).multiplyScalar(2.2), cr = new THREE.Color(0xff2030).multiplyScalar(2.2);
    const B = route.bounds;
    for (let i = 0; i < TN; i++) {
      const alongX = R.chance(0.5), dir = R.chance(0.5) ? 1 : -1;
      const lane = Math.round(R.range(alongX ? B.minZ - 60 : B.minX - 60, alongX ? B.maxZ + 60 : B.maxX + 60) / 27) * 27 + 13.5;
      this.cars.push({ alongX, dir, lane, y: R.range(18, cfg.baseTop - 26), off: R.range(0, 600), speed: R.range(22, 40) });
      this.traffic.setColorAt(i, dir > 0 ? cw : cr);
    }
    this.group.add(this.traffic);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.update(0, new THREE.Vector3());
  }

  update(dt, focus) {
    this.time += dt;
    const t = this.time;
    this.uniforms.uTime.value = t;
    // pickups spin + bob
    const m4 = this._m4, q = this._q, s = this._s, p = this._p;
    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i];
      if (k.taken) { if (!k.hidden) { k.hidden = true; m4.makeScale(0, 0, 0); this.pickMesh.setMatrixAt(i, m4); } continue; }
      const sc = k.kind === 'chrono' ? 1.5 : k.kind === 'cat' ? 0.01 : 1;
      this._e.set(0, t * 2.2 + i, 0.4);
      q.setFromEuler(this._e);
      s.set(sc, sc * 1.35, sc);
      p.set(k.x, k.y + Math.sin(t * 2.4 + i * 0.7) * 0.14, k.z);
      m4.compose(p, q, s);
      this.pickMesh.setMatrixAt(i, m4);
    }
    this.pickMesh.instanceMatrix.needsUpdate = true;
    if (this.cat) { this.cat.rotation.y = t * 1.2; this.cat.children[0].position.y = 0.25 + Math.abs(Math.sin(t * 3)) * 0.12; }
    // traffic
    const B = this.route.bounds, span = 700;
    for (let i = 0; i < this.trafficN; i++) {
      const c = this.cars[i];
      const a = (((c.off + t * c.speed * c.dir) % span) + span) % span - span / 2;
      if (c.alongX) { p.set((B.minX + B.maxX) / 2 + a, c.y, c.lane); q.copy(this._qy); }
      else { p.set(c.lane, c.y, (B.minZ + B.maxZ) / 2 + a); q.identity(); }
      s.set(1, 1, 1);
      m4.compose(p, q, s);
      this.traffic.setMatrixAt(i, m4);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    // pads, buoys, beacons
    for (const pad of this.pads) {
      pad.cool = Math.max(0, pad.cool - dt);
      const k = 1 + 0.25 * Math.sin(t * 6) + pad.cool * 1.5;
      pad.ring.scale.setScalar(k);
      pad.ring.position.y = 0.2 + ((t * 1.2) % 1) * 1.2;
    }
    for (const a of this.anchors) {
      a.y = a.baseY + Math.sin(t * 1.6 + a.x) * 0.25;
      a.mesh.position.y = a.y;
      a.mesh.rotation.y = t * 1.5;
      a.ring.rotation.x = t * 2.1;
      a.hot = Math.max(0, a.hot - dt * 4);
      a.mesh.scale.setScalar(1 + a.hot * 0.5);
    }
    for (const d of this.deliveries) {
      d.beam.material.opacity = d.done ? 0.04 : d.active ? 0.42 + 0.14 * Math.sin(t * 4) : 0.1;
      d.ring.rotation.z = t * 0.8;
      d.ring.scale.setScalar(d.done ? 0.6 : 1 + 0.08 * Math.sin(t * 5));
      d.ring.visible = !d.done;
    }
  }

  // Nearest buoy roughly in the aim direction with clear line of sight.
  findAnchor(px, py, pz, ax, ay, az, range = 34) {
    let best = null, bs = -1;
    for (const a of this.anchors) {
      const dx = a.x - px, dy = a.y - py, dz = a.z - pz;
      const d = Math.hypot(dx, dy, dz);
      if (d > range || d < 3.5) continue;
      const dot = (dx * ax + dy * ay + dz * az) / d;
      if (dot < 0.35) continue;
      const score = dot * 2 - d / range;
      if (score > bs && this.raycast(px, py, pz, dx / d, dy / d, dz / d, d - 0.5) < 0) { bs = score; best = a; }
    }
    return best;
  }

  // Ray vs colliders. Returns hit distance or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxD) {
    const ex = ox + dx * maxD, ez = oz + dz * maxD;
    const boxes = this.grid.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let t0 = 0, t1 = maxD;
      if (Math.abs(dx) < 1e-6) { if (ox < b.minX || ox > b.maxX) continue; }
      else { let a = (b.minX - ox) / dx, c = (b.maxX - ox) / dx; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) continue; }
      if (Math.abs(dy) < 1e-6) { if (oy < b.minY || oy > b.maxY) continue; }
      else { let a = (b.minY - oy) / dy, c = (b.maxY - oy) / dy; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-6) { if (oz < b.minZ || oz > b.maxZ) continue; }
      else { let a = (b.minZ - oz) / dz, c = (b.maxZ - oz) / dz; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) continue; }
      if (best < 0 || t0 < best) best = t0;
    }
    return best;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose && d.dispose();
    this.buildings.dispose(); this.pickMesh.dispose(); this.traffic.dispose();
    if (this.cat) this.cat.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}

// A tiny low-poly lucky cat. Secret collectible.
function makeCat() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffa41a, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.6 });
  const pink = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4fa0).multiplyScalar(2), toneMapped: false });
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); body.add(o); return o; };
  const sph = new THREE.SphereGeometry(0.5, 12, 10), cone = new THREE.ConeGeometry(0.14, 0.26, 4);
  add(sph, gold, 0, 0.42, 0, 0.9, 0.95, 0.8);
  add(sph, gold, 0, 1.0, 0, 0.7, 0.62, 0.62);
  add(cone, gold, -0.2, 1.36, 0); add(cone, gold, 0.2, 1.36, 0);
  add(sph, pink, -0.13, 1.04, 0.29, 0.09, 0.12, 0.05); add(sph, pink, 0.13, 1.04, 0.29, 0.09, 0.12, 0.05);
  add(sph, gold, 0.42, 1.12, 0.08, 0.2, 0.34, 0.2); // raised paw
  add(sph, pink, 0, 0.72, 0.3, 0.14, 0.14, 0.1); // bell
  g.add(body);
  return g;
}
