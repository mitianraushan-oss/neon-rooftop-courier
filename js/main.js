// Milestone 1: title screen over a live procedural city.
import * as THREE from 'three';
import { Gfx } from './gfx.js';
import { Env } from './env.js';
import { World } from './world.js';
import { generateRoute } from './route.js';
import { LEVELS } from './levels.js';
import { GameAudio } from './audio.js';
import { UI, loadSave } from './ui.js';

const save = loadSave();
const gfx = new Gfx(document.getElementById('game'));
const env = new Env(gfx.scene, gfx.renderer);
const audio = new GameAudio();
const route = generateRoute(LEVELS[0]);
env.setSky(LEVELS[0].sky, LEVELS[0].rain);
const world = new World(gfx.scene, route, gfx.level);
gfx.onQuality = (q) => env.setQuality(q);
gfx.setQuality(save.settings.quality);

const ui = new UI(save, {
  sound: () => { audio.init(); audio.ui(); },
  start: () => {}, resume: () => {}, restart: () => {}, quit: () => ui.show('title'), next: () => {}, pause: () => {},
  settings: (st, key) => { if (key === 'quality') gfx.setQuality(st.quality); audio.setVolume(st.volume / 100); audio.musicOn = !!st.music; },
});
audio.volume = save.settings.volume / 100;
window.addEventListener('pointerdown', () => { audio.init(); audio.setRain(LEVELS[0].rain); }, { once: true });

const focus = new THREE.Vector3();
let last = performance.now(), t = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  gfx.frame(now - last);
  last = now; t += dt;
  const p = route.plats[2];
  focus.set(p.x, p.top + 2, p.z);
  gfx.camera.position.set(p.x + Math.cos(t * 0.07) * 34, p.top + 9 + Math.sin(t * 0.11) * 3, p.z + Math.sin(t * 0.07) * 34);
  gfx.camera.lookAt(focus.x, focus.y + 4, focus.z + 30);
  env.update(dt, gfx.camera.position, focus);
  world.update(dt, focus);
  gfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById('boot').classList.add('done');
window.__game = { gfx, env, world, route };
