// Unified input: keyboard + mouse (pointer lock), touch (virtual stick + buttons)
// and gamepad. poll() returns one normalized state per frame.
const $ = (id) => document.getElementById(id);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mode = matchMedia('(pointer:coarse)').matches ? 'touch' : 'kbm';
    this.sens = 1; this.invert = false;
    this.active = false; // true while gameplay wants input / pointer lock
    this.lookX = 0; this.lookY = 0;
    this.edges = { jump: false, grapple: false, pause: false };
    this.touch = { stickId: null, lookId: null, sx: 0, sy: 0, mx: 0, my: 0, lx: 0, ly: 0, jump: false, slide: false };
    this.padPrev = [];
    this.state = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, jump: false, jumpHeld: false, slide: false, grapple: false, pause: false };
    this.onLockLost = null;
    this.dragging = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.edges.jump = true;
      if (e.code === 'KeyE' || e.code === 'KeyF') this.edges.grapple = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.edges.pause = true;
      if (this.active && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (this.mode !== 'kbm' && e.code.startsWith('Key')) this.setMode('kbm');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); if (this.active) this.edges.pause = true; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.active) this.edges.pause = true; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.active || this.mode === 'touch') return;
      if (document.pointerLockElement !== canvas) { this.lock(); this.dragging = true; }
      else if (e.button === 0) this.edges.grapple = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement === canvas || this.dragging) { this.lookX += e.movementX * 0.0023; this.lookY += e.movementY * 0.0023; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.active && this.locked && this.onLockLost) this.onLockLost();
      this.locked = document.pointerLockElement === canvas;
    });

    // ---- touch ----
    const T = this.touch;
    const onStart = (e) => {
      if (this.mode !== 'touch') this.setMode('touch');
      if (!this.active) return;
      for (const t of e.changedTouches) {
        if (t.target.closest && t.target.closest('button')) continue;
        if (t.clientX < window.innerWidth * 0.42 && T.stickId === null) {
          T.stickId = t.identifier; T.sx = t.clientX; T.sy = t.clientY; T.mx = T.my = 0;
          const st = $('stick');
          st.style.left = t.clientX - st.offsetWidth / 2 + 'px'; st.style.top = t.clientY - st.offsetHeight / 2 + 'px'; st.style.bottom = 'auto';
        } else if (T.lookId === null) { T.lookId = t.identifier; T.lx = t.clientX; T.ly = t.clientY; }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.stickId) {
          let dx = (t.clientX - T.sx) / 52, dy = (t.clientY - T.sy) / 52;
          const l = Math.hypot(dx, dy);
          if (l > 1) { dx /= l; dy /= l; }
          T.mx = dx; T.my = -dy;
          $('knob').style.transform = `translate(${dx * 38}px,${dy * 38}px)`;
        } else if (t.identifier === T.lookId) {
          this.lookX += (t.clientX - T.lx) * 0.0052; this.lookY += (t.clientY - T.ly) * 0.0052;
          T.lx = t.clientX; T.ly = t.clientY;
        }
      }
      if (this.active) e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.stickId) { T.stickId = null; T.mx = T.my = 0; $('knob').style.transform = ''; }
        if (t.identifier === T.lookId) T.lookId = null;
      }
    };
    canvas.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    document.querySelectorAll('.tbtn').forEach((b) => {
      const act = b.dataset.act;
      const down = (e) => {
        e.preventDefault(); b.classList.add('down');
        if (act === 'jump') { this.edges.jump = true; T.jump = true; }
        if (act === 'slide') T.slide = true;
        if (act === 'grapple') this.edges.grapple = true;
      };
      const up = (e) => { e.preventDefault(); b.classList.remove('down'); if (act === 'jump') T.jump = false; if (act === 'slide') T.slide = false; };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
      b.addEventListener('mousedown', down); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);
    });
    this.setMode(this.mode);
  }

  setMode(m) {
    this.mode = m;
    document.body.dataset.input = m;
    if (this.onMode) this.onMode(m);
  }
  setActive(on) {
    this.active = on;
    if (!on) {
      this.keys.clear(); this.dragging = false;
      const T = this.touch; T.stickId = T.lookId = null; T.mx = T.my = 0; T.jump = T.slide = false;
      if (document.pointerLockElement === this.canvas) { this.locked = false; document.exitPointerLock(); }
    }
  }
  lock() {
    if (this.mode === 'touch' || !this.canvas.requestPointerLock) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* lock refused: drag-to-look still works */ }
  }

  poll(dt) {
    const s = this.state, k = this.keys, T = this.touch;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let jumpHeld = k.has('Space'), slide = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC') || k.has('ControlLeft');
    mx += T.mx; my += T.my; jumpHeld = jumpHeld || T.jump; slide = slide || T.slide;
    let lx = this.lookX, ly = this.lookY;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected || gp.axes.length < 2) continue;
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const ax = dz(gp.axes[0]), ay = dz(gp.axes[1]), rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
      const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
      const cur = [b(0), b(1) || b(7), b(2) || b(6) || b(5), b(9)];
      const prev = this.padPrev;
      if (ax || ay || rx || ry || cur.some(Boolean)) { if (this.mode !== 'pad') this.setMode('pad'); }
      mx += ax; my -= ay;
      lx += rx * 2.8 * dt; ly += ry * 2.0 * dt;
      if (cur[0] && !prev[0]) this.edges.jump = true;
      if (cur[2] && !prev[2]) this.edges.grapple = true;
      if (cur[3] && !prev[3]) this.edges.pause = true;
      jumpHeld = jumpHeld || cur[0]; slide = slide || cur[1];
      this.padPrev = cur;
      break;
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    s.moveX = mx; s.moveY = my;
    s.lookX = lx * this.sens; s.lookY = ly * this.sens * (this.invert ? -1 : 1);
    s.jump = this.edges.jump; s.grapple = this.edges.grapple; s.pause = this.edges.pause;
    s.jumpHeld = jumpHeld; s.slide = slide;
    this.lookX = this.lookY = 0;
    this.edges.jump = this.edges.grapple = this.edges.pause = false;
    return s;
  }
}
