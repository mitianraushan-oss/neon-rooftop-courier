// Autopilot used by the automated tests (and `?bot=1`): plays through the same
// input struct a human produces, so a bot clear proves a level is completable.
export class Bot {
  constructor(game) {
    this.g = game;
    this.out = { wx: 0, wz: 0, jump: false, jumpHeld: true, slide: false, grapple: false, ax: 0, ay: 0, az: 1 };
    this.reset();
  }
  reset() { this.lastIdx = -99; this.stage = 0; this.grUsed = false; }

  think() {
    const g = this.g, pl = g.player, p = pl.p, R = g.route, o = this.out;
    o.wx = o.wz = 0; o.jump = false; o.jumpHeld = true; o.slide = false; o.grapple = false;
    const idx = g.curPlat;
    if (idx !== this.lastIdx) { this.lastIdx = idx; this.stage = 0; this.grUsed = false; }
    const plat = R.plats[idx], L = R.links[idx];
    const go = (x, z) => {
      const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz) || 1;
      o.wx = dx / l; o.wz = dz / l;
      return l;
    };
    const onIt = pl.grounded && g.onPlat === idx;
    const del = g.target;
    if (onIt && del && del.plat === idx) { go(del.x, del.z); return o; }
    if (!L) return o;
    const a = L.a, b = L.b, sgn = L.sgn;
    const latT = L.lane + (L.type === 'wallrun' ? L.side * 1.05 : 0);
    const exitAlong = L.type === 'pad' ? L.pad[a] : L.exitA - sgn * 0.15;
    const toEdge = (L.exitA - p[a]) * sgn;
    const pt = (along, lat) => (a === 'x' ? go(along, lat) : go(lat, along));

    if (onIt) {
      if (plat.barrier) {
        const d = (plat[a] - p[a]) * sgn;
        if (d < 5.5 && d > -2.2) o.slide = true;
      }
      const back = L.type === 'wallrun' ? 6 : L.type === 'pad' ? 3.5 : 4;
      if (this.stage === 0) {
        const d = pt(exitAlong - sgn * back, latT);
        if (d < 1.2 || (toEdge < back + 2 && Math.abs(p[b] - latT) < 0.7)) this.stage = 1;
      }
      if (this.stage === 1) {
        pt(exitAlong + (L.type === 'pad' ? 0 : sgn * 3), latT);
        if (L.type !== 'pad' && toEdge < 0.55) o.jump = true;
      }
      // hop over the boss shockwave when there is room to land
      if (g.boss && g.boss.ringNear(p, 2.6) && toEdge > 10 && !plat.barrier) o.jump = true;
    } else if (L.type === 'wallrun') {
      const w = {}; w[a] = sgn; w[b] = L.side * 0.6;
      const l = Math.hypot(w.x, w.z); o.wx = w.x / l; o.wz = w.z / l;
    } else if (L.type === 'grapple') {
      const an = L.anchor;
      if (pl.gr.on) this.grUsed = true;
      if (!pl.gr.on && !this.grUsed && pl.airT > 0.08 && toEdge < 1 && pl.gr.cool <= 0) {
        const dx = an.x - p.x, dy = an.y - p.y - 1, dz = an.z - p.z, d = Math.hypot(dx, dy, dz);
        o.ax = dx / d; o.ay = dy / d; o.az = dz / d;
        o.grapple = true;
      }
      pt(L.entryA + sgn * 5, L.lane);
    } else if (L.type === 'jump') {
      pt(L.entryA + sgn * 4, L.lane);
    }
    return o;
  }
}
