// DOM heads-up display: timer, score, combo, minimap, objective arrow, toasts, hints.
import * as THREE from 'three';
import { fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = $('hud');
    this.map = $('minimap').getContext('2d');
    this.cache = {};
    this.hintT = 0;
    this.frame = 0;
  }
  show(on) { this.el.classList.toggle('hidden', !on); }
  set(id, text) { if (this.cache[id] !== text) { this.cache[id] = text; $(id).textContent = text; } }
  flash(id, cls, ms = 220) { const e = $(id); e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove(cls), ms); }

  toast(text, color = '#fff', sub = '') {
    const box = $('toast');
    const d = document.createElement('div');
    d.style.color = color;
    d.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; d.appendChild(s); }
    box.innerHTML = '';
    box.appendChild(d);
  }
  hint(html, secs = 5) { const h = $('hint'); h.innerHTML = html; h.classList.add('on'); this.hintT = secs; }
  countdown(text) { $('countdown').innerHTML = text ? `<span>${text}</span>` : ''; }
  damage() { this.flash('vignette', 'on', 90); }
  prompt(text) { const p = $('prompt'); if (this.cache.prompt === text) return; this.cache.prompt = text; p.classList.toggle('hidden', !text); p.textContent = text || ''; }
  boss(frac) { $('bossbar').classList.toggle('hidden', frac == null); if (frac != null) $('bossFill').style.width = Math.round(frac * 100) + '%'; }

  update(dt, g) {
    this.frame++;
    this.set('timer', fmtTime(g.time));
    $('timer').classList.toggle('low', g.time < 10 && g.state === 'play');
    this.set('score', Math.round(g.shownScore).toLocaleString());
    this.set('deliv', `${g.delivered}/${g.world.deliveries.length}`);
    this.set('shards', `${g.shards}/${g.world.shardTotal}`);
    this.set('comboX', 'x' + g.mult.toFixed(1).replace('.0', ''));
    $('combo').classList.toggle('on', g.combo > 0);
    $('comboFill').style.width = Math.round(g.comboT / 4.5 * 100) + '%';
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('hint').classList.remove('on'); }
    $('speed').style.opacity = Math.max(0, Math.min(0.9, (g.player.speed - 12.5) / 8));
    $('vignette').classList.toggle('warn', g.time < 6 && g.state === 'play');
    if (g.time < 6 && g.state === 'play') $('vignette').style.opacity = 0.35 + 0.25 * Math.sin(g.clock * 8); else $('vignette').style.opacity = '';
    this.arrow(g);
    if (this.frame % 2 === 0) this.minimap(g);
  }

  arrow(g) {
    const el = $('arrow'), t = g.target;
    if (!t) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.classList.toggle('final', !!t.final);
    const cam = g.gfx.camera, W = g.gfx.width, H = g.gfx.height;
    _v.set(t.x, t.y + 3, t.z).project(cam);
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
    const m = 46;
    let rot = 180;
    if (behind || x < m || x > W - m || y < m + 40 || y > H - m) {
      let dx = x - W / 2, dy = y - H / 2;
      if (behind) { dx = -dx; dy = Math.abs(dy) + H; }
      const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-3), (H / 2 - m - 20) / Math.abs(dy || 1e-3));
      x = W / 2 + dx * k; y = H / 2 + dy * k;
      rot = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    }
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    el.firstElementChild.style.transform = `rotate(${rot.toFixed(0)}deg)`;
    const d = Math.hypot(t.x - g.player.p.x, t.z - g.player.p.z);
    this.set('arrowDist', Math.round(d) + 'm');
  }

  minimap(g) {
    const c = this.map, S = 168, R = S / 2, scale = 1.25;
    const p = g.player.p, yaw = g.rig.yaw;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.translate(R, R);
    // rotate so camera-forward is up. world (x,z) -> map
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const tx = (x, z) => -((x - p.x) * cs - (z - p.z) * sn) * scale;
    const ty = (x, z) => -((x - p.x) * sn + (z - p.z) * cs) * scale;
    const rect = (b, fill) => {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(tx(b.x - b.hx, b.z - b.hz), ty(b.x - b.hx, b.z - b.hz));
      c.lineTo(tx(b.x + b.hx, b.z - b.hz), ty(b.x + b.hx, b.z - b.hz));
      c.lineTo(tx(b.x + b.hx, b.z + b.hz), ty(b.x + b.hx, b.z + b.hz));
      c.lineTo(tx(b.x - b.hx, b.z + b.hz), ty(b.x - b.hx, b.z + b.hz));
      c.closePath(); c.fill();
    };
    const range = R / scale + 30;
    for (const b of g.route.plats) {
      if (Math.abs(b.x - p.x) > range || Math.abs(b.z - p.z) > range) continue;
      rect(b, b.i <= g.reached ? 'rgba(25,240,255,0.55)' : 'rgba(120,150,200,0.38)');
    }
    if (g.route.secret) rect(g.route.secret, 'rgba(255,95,208,0.4)');
    const dot = (x, z, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(tx(x, z), ty(x, z), r, 0, 7); c.fill(); };
    for (const k of g.world.pickups) if (!k.taken && k.kind !== 'cat' && Math.abs(k.x - p.x) < range && Math.abs(k.z - p.z) < range) dot(k.x, k.z, k.kind === 'chrono' ? 2.4 : 1.2, k.kind === 'chrono' ? '#ffd23f' : '#7df4ff');
    for (const d of g.world.deliveries) {
      if (d.done) continue;
      let x = tx(d.x, d.z), y = ty(d.x, d.z);
      const l = Math.hypot(x, y);
      if (l > R - 9) { x *= (R - 9) / l; y *= (R - 9) / l; }
      c.fillStyle = d.final ? '#ffd23f' : '#5dff9b';
      const r = d.active ? 5 + Math.sin(g.clock * 6) * 1.5 : 3;
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    if (g.drones) for (const d of g.drones.list) if (!d.dead) dot(d.p.x, d.p.z, 3, d.state === 'patrol' ? '#ff9a3d' : '#ff3b3b');
    if (g.boss && g.boss.active) {
      let x = tx(g.boss.p.x, g.boss.p.z), y = ty(g.boss.p.x, g.boss.p.z);
      const l = Math.hypot(x, y);
      if (l > R - 9) { x *= (R - 9) / l; y *= (R - 9) / l; }
      c.fillStyle = '#ff2020'; c.beginPath(); c.arc(x, y, 6.5 + Math.sin(g.clock * 9), 0, 7); c.fill();
    }
    // player arrow (always pointing along facing relative to the camera)
    c.rotate(yaw - g.player.yaw);
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.restore();
  }
}
