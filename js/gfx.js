// Renderer + bloom post-processing + adaptive quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// scale = render-resolution multiplier, dpr = device-pixel-ratio cap
export const QUALITY = [
  { name: 'Low', scale: 0.62, dpr: 1, bloom: false, shadows: false, msaa: 0 },
  { name: 'Medium', scale: 0.8, dpr: 1, bloom: true, shadows: true, msaa: 0 },
  { name: 'High', scale: 1, dpr: 1.5, bloom: true, shadows: true, msaa: 4 },
  { name: 'Ultra', scale: 1, dpr: 2, bloom: true, shadows: true, msaa: 4 },
];

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.15, 1400);
    this.level = 2;
    this.auto = true;
    this.onQuality = null;
    this.acc = 0; this.frames = 0; this.good = 0; this.holdUp = 0;
    this.build();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
  }

  build() {
    const q = QUALITY[this.level];
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    this.renderer.shadowMap.enabled = q.shadows;
    if (q.bloom) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q.msaa });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.7, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize() {
    const q = QUALITY[this.level];
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, q.dpr) * q.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h; this.pixelH = h * pr;
    if (this.onResize) this.onResize();
  }

  setQuality(v) {
    this.auto = v === 'auto';
    const lvl = this.auto ? Math.min(this.level, 2) : +v;
    this.apply(lvl);
  }
  apply(lvl) {
    if (lvl === this.level && this.built) return;
    this.level = lvl; this.built = true;
    this.build();
    if (this.onQuality) this.onQuality(lvl);
  }

  // Feed real frame times; steps quality down when slow, back up when there is headroom.
  frame(dtMs) {
    if (!this.auto || dtMs > 250) return;
    this.acc += dtMs; this.frames++;
    this.holdUp = Math.max(0, this.holdUp - dtMs);
    if (this.acc < 1500) return;
    const avg = this.acc / this.frames;
    this.acc = 0; this.frames = 0;
    if (avg > 23 && this.level > 0) { this.apply(this.level - 1); this.good = 0; this.holdUp = 12000; }
    else if (avg < 12.6 && this.level < 2 && this.holdUp <= 0) { if (++this.good >= 3) { this.apply(this.level + 1); this.good = 0; this.holdUp = 6000; } }
    else this.good = 0;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
