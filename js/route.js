// Procedural route generation. Pure data (no Three.js) so it can be unit-tested
// and driven by the autopilot bot.
//
// A route is a chain of rooftop platforms joined by typed links:
//   jump     - plain gap
//   wallrun  - long gap bridged by a neon billboard wall
//   pad      - launch pad that throws you on a ballistic arc
//   grapple  - long, rising gap with a hover buoy to hook onto
// Every gap is sized from the player's movement constants (see player.js) so the
// route is always completable.
import { makeRng } from './util.js';

const DIRS = [
  { x: 0, z: 1 },
  { x: 1, z: 0 },
  { x: -1, z: 0 },
];

function rectOverlap(a, b, m) {
  return a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
}
const rectOf = (p) => ({ minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz });

// Build an axis-aligned rect from along/lateral ranges for a given link axis.
function axisRect(a, a0, a1, b0, b1) {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const l2 = Math.min(b0, b1), h2 = Math.max(b0, b1);
  return a === 'x' ? { minX: lo, maxX: hi, minZ: l2, maxZ: h2 } : { minX: l2, maxX: h2, minZ: lo, maxZ: hi };
}

function weighted(R, w) {
  let tot = 0;
  for (const k in w) tot += w[k];
  let v = R() * tot;
  for (const k in w) {
    v -= w[k];
    if (v <= 0) return k;
  }
  return 'jump';
}

export function generateRoute(cfg) {
  const R = makeRng(cfg.seed);
  const N = cfg.platforms;
  const deliverySet = new Set();
  for (let k = 1; k <= cfg.deliveries; k++) deliverySet.add(Math.round((k * (N - 1)) / cfg.deliveries));

  const plats = [];
  const links = [];
  const blockers = []; // rects of walls / side platforms for overlap tests
  const pickups = [];

  plats.push({ i: 0, x: 0, z: 0, hx: 9, hz: 9, top: cfg.baseTop, inDir: DIRS[0], checkpoint: true });
  let lastDir = DIRS[0];
  let lastType = 'jump';

  for (let i = 1; i < N; i++) {
    const prev = plats[i - 1];
    let type = (cfg.script && cfg.script[i]) || weighted(R, cfg.weights);
    // after a special link always give a plain jump: time to breathe and re-aim
    if (!(cfg.script && cfg.script[i]) && type !== 'jump' && lastType !== 'jump') type = 'jump';
    const isDelivery = deliverySet.has(i);
    let made = null;

    for (let attempt = 0; attempt < 40 && !made; attempt++) {
      if (attempt === 30) type = 'jump';
      // --- direction ---
      let dir;
      if (attempt >= 24) dir = DIRS[0];
      else {
        const r = R();
        dir = r < 0.56 ? DIRS[0] : r < 0.78 ? DIRS[1] : DIRS[2];
        if (lastDir.x !== 0 && dir.x === -lastDir.x) dir = DIRS[0];
      }
      // a billboard wall must run parallel to the way you arrive, never across it
      if (type === 'wallrun') dir = prev.inDir;
      const a = dir.x !== 0 ? 'x' : 'z';
      const b = a === 'x' ? 'z' : 'x';
      const sgn = a === 'x' ? dir.x : dir.z;
      const ha = a === 'x' ? 'hx' : 'hz';
      const hb = a === 'x' ? 'hz' : 'hx';

      // --- dimensions per link type ---
      let g, dh, L = R.range(12, 18), W = R.range(11, 16);
      if (type === 'jump') {
        g = R.range(cfg.gap[0], cfg.gap[1]);
        dh = R.range(cfg.rise[0], cfg.rise[1]);
        if (dh > 0.5) g = Math.min(g, 5.2);
      } else if (type === 'wallrun') {
        g = R.range(12, 15.5);
        dh = R.range(-1.5, 0.6);
      } else if (type === 'pad') {
        g = R.range(14, 22);
        dh = R.range(-2, 6);
        L = R.range(19, 23);
      } else {
        g = R.range(16, 22);
        dh = R.range(3, 8);
        L = R.range(18, 22);
      }
      if (isDelivery) { L = 20; W = 20; }
      if (attempt >= 34) { L = 12; W = 10; }
      // keep the route inside a height band
      if (prev.top + dh > cfg.baseTop + 34) dh = -Math.abs(dh) * 0.5;
      if (prev.top + dh < cfg.baseTop - 22) dh = Math.abs(dh) * (type === 'jump' ? 0.3 : 1);

      // --- placement ---
      let jitter = 0;
      if (type === 'jump') {
        const room = Math.min(2.5, Math.max(0, Math.min(prev[hb], W / 2) - 4));
        jitter = R.range(-room, room);
      }
      const lane = prev[b] + jitter;
      const exitA = prev[a] + sgn * prev[ha];
      const entryA = exitA + sgn * g;
      const np = { i, hx: 0, hz: 0, top: prev.top + dh, inDir: dir, delivery: isDelivery };
      np[a] = entryA + (sgn * L) / 2;
      np[b] = lane;
      np[ha] = L / 2;
      np[hb] = W / 2;

      const link = { type, from: i - 1, to: i, dir, a, b, sgn, lane, exitA, entryA, g, dh };
      let wallRect = null;
      if (type === 'wallrun') {
        link.side = R.chance(0.5) ? 1 : -1;
        const f0 = lane + link.side * 1.6, f1 = lane + link.side * 2.8;
        wallRect = axisRect(a, exitA - sgn * 4, entryA + sgn * 4, f0, f1);
        link.wall = {
          ...wallRect,
          minY: Math.min(prev.top, np.top) - 3,
          maxY: Math.max(prev.top, np.top) + 8,
        };
      }

      // --- overlap tests against everything already placed ---
      const nr = rectOf(np);
      const corridor = axisRect(a, exitA, entryA, lane - 3.5, lane + 3.5);
      let bad = false;
      for (let k = 0; k < plats.length && !bad; k++) {
        const pr = rectOf(plats[k]);
        if (rectOverlap(nr, pr, 2.5)) bad = true;
        if (k !== i - 1 && rectOverlap(corridor, pr, 1)) bad = true;
        if (wallRect && k !== i - 1 && rectOverlap(wallRect, pr, 1)) bad = true;
      }
      for (let k = 0; k < blockers.length && !bad; k++) {
        if (rectOverlap(nr, blockers[k], 2) || rectOverlap(corridor, blockers[k], 1)) bad = true;
        if (wallRect && rectOverlap(wallRect, blockers[k], 1)) bad = true;
      }
      if (bad) continue;

      // --- accept ---
      if (wallRect) blockers.push(wallRect);
      if (type === 'pad') {
        // Launch pad sits just before the exit edge; velocity is solved so the
        // arc lands ~6 m inside the next roof (gravity = 30).
        const padA = exitA - sgn * 2.4;
        const dist = 2.4 + g + 6;
        const T = dist / 15;
        const vy = (dh + 15 * T * T) / T;
        link.pad = { y: prev.top, r: 1.6, vx: dir.x * 15, vy, vz: dir.z * 15, T };
        link.pad[a] = padA;
        link.pad[b] = lane;
      }
      if (type === 'grapple') {
        link.anchor = { y: np.top + 5.5 };
        link.anchor[a] = entryA - sgn * 3;
        link.anchor[b] = lane;
      }
      prev.outDir = dir;
      made = np;
      links.push(link);
      plats.push(np);
      lastDir = dir;
      lastType = type;
    }
    if (!made) throw new Error('route generation failed at ' + i);
  }
  plats[N - 1].outDir = plats[N - 1].inDir;

  // --- checkpoints + slide barriers ---
  let sinceCp = 0;
  for (let i = 1; i < N; i++) {
    const p = plats[i];
    const inL = links[i - 1], outL = links[i];
    sinceCp++;
    if (p.delivery || sinceCp >= 4) { p.checkpoint = true; sinceCp = 0; }
    if (!outL || p.delivery || i < (cfg.barrierFrom || 1)) continue;
    const straight = inL.dir === outL.dir;
    const along = p[inL.a === 'x' ? 'hx' : 'hz'] * 2;
    if (straight && along >= 13 && inL.type === 'jump' && outL.type !== 'wallrun' && R.chance(cfg.barrier)) {
      const a = inL.a, b = inL.b;
      const lat = p[a === 'x' ? 'hz' : 'hx'];
      const rect = axisRect(a, p[a] - 0.8, p[a] + 0.8, p[b] - lat - 0.4, p[b] + lat + 0.4);
      p.barrier = { ...rect, minY: p.top + 1.15, maxY: p.top + 4.4, a };
    }
  }

  // --- pickups ---
  const pt = (L, along, latOff, y) => {
    const o = { y };
    o[L.a] = along;
    o[L.b] = L.lane + latOff;
    return o;
  };
  for (const L of links) {
    const A = plats[L.from], B = plats[L.to];
    if (L.type === 'jump') {
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        pickups.push({ kind: 'shard', ...pt(L, L.exitA + L.sgn * L.g * t, 0, A.top + (B.top - A.top) * t + 1.3 + Math.sin(t * Math.PI) * 1.3) });
      }
    } else if (L.type === 'wallrun') {
      for (let k = 1; k <= 5; k++) {
        const t = k / 6;
        pickups.push({ kind: 'shard', ...pt(L, L.exitA + L.sgn * L.g * t, L.side * 1.0, A.top + 1.6 + Math.sin(t * Math.PI) * 2.2) });
      }
    } else if (L.type === 'pad') {
      for (let k = 1; k <= 5; k++) {
        const t = (k / 6) * L.pad.T;
        pickups.push({ kind: 'shard', ...pt(L, L.pad[L.a] + L.sgn * 15 * t, 0, A.top + L.pad.vy * t - 15 * t * t + 1) });
      }
    } else {
      for (let k = 1; k <= 4; k++) {
        const t = k / 5;
        pickups.push({ kind: 'shard', ...pt(L, L.exitA + (L.anchor[L.a] - L.exitA) * t, 0, A.top + 1.2 + (L.anchor.y - A.top - 2.5) * t) });
      }
    }
    // ground line on the destination roof
    if (!B.delivery && R.chance(0.6)) {
      const half = B[L.a === 'x' ? 'hx' : 'hz'];
      for (let k = -1; k <= 1; k++) {
        const y = B.barrier && k === 0 ? B.top + 0.5 : B.top + 1.0;
        pickups.push({ kind: 'shard', ...pt(L, B[L.a] + k * Math.min(3.2, half * 0.4), 0, y) });
      }
    }
    if (L.to % 6 === 3 && !B.barrier) {
      const lat = B[L.a === 'x' ? 'hz' : 'hx'];
      pickups.push({ kind: 'chrono', ...pt(L, B[L.a], (R.chance(0.5) ? 1 : -1) * (lat - 2.2), B.top + 1.2) });
    }
  }

  // --- secret side platform with a lucky cat ---
  let secret = null;
  for (let tries = 0; tries < 60 && !secret; tries++) {
    const i = R.int(Math.floor(N * 0.3), N - 3);
    const p = plats[i], L = links[i];
    if (p.delivery || !L || L.type !== 'jump') continue;
    const s = R.chance(0.5) ? 1 : -1;
    const lat = p[L.a === 'x' ? 'hz' : 'hx'];
    const sp = { hx: 3.5, hz: 3.5, top: p.top - 0.6, side: true };
    sp[L.a] = p[L.a];
    sp[L.b] = p[L.b] + s * (lat + 4 + 3.5);
    const sr = rectOf(sp);
    let bad = false;
    for (const q of plats) if (q !== p && rectOverlap(sr, rectOf(q), 3)) bad = true;
    for (const q of blockers) if (rectOverlap(sr, q, 2)) bad = true;
    if (bad) continue;
    secret = sp;
    blockers.push(sr);
    pickups.push({ kind: 'cat', x: sp.x, z: sp.z, y: sp.top + 1.1 });
  }

  // --- drones ---
  const drones = [];
  const cand = [];
  for (let i = 2; i < N - 1; i++) {
    const p = plats[i];
    if (!p.barrier && !p.delivery && links[i - 1].type === 'jump' && Math.min(p.hx, p.hz) >= 5.5) cand.push(i);
  }
  const take = (n, kind) => {
    for (let k = 0; k < n && cand.length; k++) {
      const idx = Math.floor(R() * cand.length);
      const i = cand.splice(idx, 1)[0];
      const p = plats[i], L = links[i - 1];
      const lat = p[L.a === 'x' ? 'hz' : 'hx'];
      if (kind === 'patrol') {
        const A = {}, B = {};
        const along = p[L.a] + L.sgn * 1.5;
        A[L.a] = along; A[L.b] = p[L.b] - lat + 1.5;
        B[L.a] = along; B[L.b] = p[L.b] + lat - 1.5;
        drones.push({ kind, plat: i, ax: A.x, az: A.z, bx: B.x, bz: B.z, y: p.top + 1.7 });
      } else {
        const o = {};
        const s = R.chance(0.5) ? 1 : -1;
        o[L.a] = p[L.a] + L.sgn * (p[L.a === 'x' ? 'hx' : 'hz'] - 1.5);
        o[L.b] = p[L.b] + s * (lat - 1.5);
        drones.push({ kind, plat: i, ax: o.x, az: o.z, bx: o.x, bz: o.z, y: p.top + 3.4 });
      }
    }
  };
  take(cfg.drones, 'patrol');
  take(cfg.snipers, 'sniper');

  // --- bounds ---
  const bounds = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minTop: 1e9, maxTop: -1e9 };
  for (const p of plats) {
    bounds.minX = Math.min(bounds.minX, p.x - p.hx); bounds.maxX = Math.max(bounds.maxX, p.x + p.hx);
    bounds.minZ = Math.min(bounds.minZ, p.z - p.hz); bounds.maxZ = Math.max(bounds.maxZ, p.z + p.hz);
    bounds.minTop = Math.min(bounds.minTop, p.top); bounds.maxTop = Math.max(bounds.maxTop, p.top);
  }

  // --- filler city ---
  const fillers = [];
  const CELL = 27, M = 190;
  const occupied = plats.map(rectOf).concat(blockers);
  for (let gx = Math.floor((bounds.minX - M) / CELL); gx <= Math.ceil((bounds.maxX + M) / CELL); gx++) {
    for (let gz = Math.floor((bounds.minZ - M) / CELL); gz <= Math.ceil((bounds.maxZ + M) / CELL); gz++) {
      if (R.chance(0.1)) continue;
      const w = R.range(13, 21), d = R.range(13, 21);
      const x = gx * CELL + R.range(-2.5, 2.5), z = gz * CELL + R.range(-2.5, 2.5);
      const rect = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
      let bad = false, best = 1e9, top = cfg.baseTop;
      for (const o of occupied) if (rectOverlap(rect, o, 4)) { bad = true; break; }
      if (bad) continue;
      for (const p of plats) {
        const dx = Math.max(Math.abs(x - p.x) - p.hx, 0), dz = Math.max(Math.abs(z - p.z) - p.hz, 0);
        const dd = Math.hypot(dx, dz);
        if (dd < best) { best = dd; top = p.top; }
      }
      let h;
      if (best < 48) h = top - R.range(9, 34);
      else if (best < 110) h = top + R.range(-40, 28);
      else h = top + R.range(-45, 70) * (R.chance(0.12) ? 1.6 : 1);
      h = Math.max(14, h);
      fillers.push({ x, z, w, d, h, near: best < 48, dist: best, seed: R() });
    }
  }

  return { cfg, plats, links, pickups, drones, secret, bounds, fillers, deliveries: [...deliverySet].sort((a, b) => a - b) };
}
