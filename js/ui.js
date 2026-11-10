// Menu screens, save data (localStorage) and settings.
import { LEVELS } from './levels.js';
import { SKIES } from './env.js';
import { easeOutCubic } from './util.js';

const KEY = 'neon-rooftop-courier-v1';
const DEFAULTS = { unlocked: 1, best: {}, settings: { quality: 'auto', volume: 80, music: 1, sens: 100, invert: 0, shake: 1 } };

export function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULTS, ...raw, best: raw.best || {}, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
  } catch (e) { /* private mode or corrupt data: fall through to defaults */ }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable: progress lasts for this session only */ }
}

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(save, h) {
    this.save = save;
    this.h = h;
    this.current = 'title';
    this.backTo = 'title';
    this.screens = {};
    document.querySelectorAll('.screen').forEach((s) => (this.screens[s.id.slice(2)] = s));
    const click = (id, fn) => $(id).addEventListener('click', () => { h.sound(); fn(); });
    click('bPlay', () => h.start(Math.min(this.save.unlocked, LEVELS.length) - 1));
    click('bLevels', () => this.show('levels'));
    click('bHelp', () => { this.backTo = 'title'; this.show('help'); });
    click('bSettings', () => { this.backTo = 'title'; this.show('settings'); });
    click('bPSettings', () => { this.backTo = 'pause'; this.show('settings'); });
    click('bResume', () => h.resume());
    click('bRestart', () => h.restart());
    click('bQuit', () => h.quit());
    click('bNext', () => h.next());
    click('bRetry', () => h.restart());
    click('bCMenu', () => h.quit());
    click('bGoRetry', () => h.restart());
    click('bGoMenu', () => h.quit());
    click('bWLevels', () => h.quit('levels'));
    click('bWMenu', () => h.quit());
    click('btnPause', () => h.pause());
    click('bReset', () => {
      if ($('bReset').dataset.arm) {
        Object.assign(this.save, JSON.parse(JSON.stringify(DEFAULTS)), { settings: this.save.settings });
        writeSave(this.save);
        $('bReset').textContent = 'SAVE DATA CLEARED';
        delete $('bReset').dataset.arm;
        this.refresh();
      } else { $('bReset').dataset.arm = 1; $('bReset').textContent = 'TAP AGAIN TO CONFIRM'; }
    });
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { h.sound(); this.show(this.current === 'levels' ? 'title' : this.backTo); }));

    // settings bindings
    const st = this.save.settings;
    const bind = (id, key, num) => {
      const el = $(id);
      el.value = st[key];
      el.addEventListener('input', () => { st[key] = num ? +el.value : el.value; writeSave(this.save); h.settings(st, key); });
    };
    bind('setQuality', 'quality'); bind('setVolume', 'volume', 1); bind('setMusic', 'music', 1);
    bind('setSens', 'sens', 1); bind('setInvert', 'invert', 1); bind('setShake', 'shake', 1);
    this.refresh();
  }

  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('hidden', k !== name);
    this.current = name;
    if (name === 'levels' || name === 'title') this.refresh();
    if (name) { const b = this.screens[name].querySelector('.btn.primary, .card:not(.locked), .btn'); if (b && matchMedia('(pointer:fine)').matches) b.focus({ preventScroll: true }); }
  }
  hide() { this.show(null); }

  refresh() {
    const grid = $('levelGrid');
    grid.innerHTML = '';
    let total = 0;
    LEVELS.forEach((L, i) => {
      const b = this.save.best[L.id];
      if (b) total += b.score;
      const locked = i + 1 > this.save.unlocked;
      const c = document.createElement('button');
      c.className = 'card' + (locked ? ' locked' : '');
      c.style.setProperty('--c1', '#' + SKIES[L.sky].hor.toString(16).padStart(6, '0'));
      const stars = b ? '★'.repeat(b.stars) + '☆'.repeat(3 - b.stars) : '☆☆☆';
      c.innerHTML = `<div class="num">0${L.id}</div><div class="nm">${L.name}</div><div class="ds">${L.district}</div><div class="bl">${L.blurb}</div><div class="st">${stars}${b && b.cat ? ' 🐱' : ''}</div><div class="bs">${b ? 'BEST ' + b.score.toLocaleString() : locked ? '' : 'NEW'}</div>`;
      if (!locked) c.addEventListener('click', () => { this.h.sound(); this.h.start(i); });
      grid.appendChild(c);
    });
    $('titleBest').textContent = total ? `CAREER SCORE ${total.toLocaleString()}` : '';
    $('bPlay').textContent = this.save.unlocked > 1 ? 'CONTINUE SHIFT' : 'START SHIFT';
  }

  // rows: [[label, value]], count-up animation on the total
  tally(tableId, totalId, rows, total) {
    $(tableId).innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
    const el = $(totalId), t0 = performance.now();
    const tick = (now) => {
      const f = Math.min(1, (now - t0) / 1200);
      el.textContent = Math.round(total * easeOutCubic(f)).toLocaleString();
      if (f < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  showComplete(level, res) {
    $('cTitle').textContent = level.name;
    $('cBest').classList.toggle('hidden', !res.newBest);
    $('bNext').classList.toggle('hidden', level.id >= LEVELS.length);
    const stars = $('cStars').children;
    for (let i = 0; i < 3; i++) { stars[i].classList.remove('on'); setTimeout(() => stars[i].classList.toggle('on', i < res.stars), 350 + i * 260); }
    this.tally('cTally', 'cTotal', res.rows, res.total);
    this.show('complete');
  }
  showGameOver(text) { $('goText').textContent = text; this.show('gameover'); }
  showWin(res, career) {
    this.tally('wTally', 'wTotal', res.rows, career);
    this.show('win');
  }
}
