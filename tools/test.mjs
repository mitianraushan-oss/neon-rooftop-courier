// End-to-end test: every level must load without console errors and be completed
// by the autopilot bot, on desktop and mobile viewports. Screenshots go to tools/out/.
//   node tools/test.mjs [levels=1,2,3,4,5] [--fast]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(OUT, { recursive: true });
const levels = (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '1,2,3,4,5').split(',').map(Number);
const fast = process.argv.includes('--fast');
const { url, close } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };

async function open(ctxOpts, suffix) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url + suffix);
  await page.waitForFunction(() => window.__game && window.__game.state !== 'boot', null, { timeout: 30000 });
  return { ctx, page, errors };
}

const desktop = { viewport: { width: 1280, height: 720 } };
const mobile = { ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true };
const mobileP = { ...devices['iPhone 13'] };

// ---- menus ----
for (const [name, opts] of [['desktop', desktop], ['mobile-landscape', mobile], ['mobile-portrait', mobileP]]) {
  console.log(`menus @ ${name}`);
  const { ctx, page, errors } = await open(opts, '');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/title-${name}.png` });
  for (const [btn, shot] of [['#bLevels', 'levels'], ['#bHelp', 'help'], ['#bSettings', 'settings']]) {
    await page.click(btn);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${shot}-${name}.png` });
    const over = await page.evaluate(() => { const s = document.querySelector('.screen:not(.hidden)'); return s.scrollWidth > s.clientWidth + 2; });
    if (over) fail(`${shot} overflows horizontally @ ${name}`);
    await page.click('.screen:not(.hidden) [data-back]');
    await page.waitForTimeout(200);
  }
  // start a level from the menu and make sure play begins
  await page.click('#bPlay');
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 15000 }).catch(() => fail(`play did not start @ ${name}`));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/play-${name}.png` });
  if (name !== 'desktop') {
    const vis = await page.evaluate(() => !document.getElementById('touch').classList.contains('hidden'));
    if (!vis) fail(`touch controls hidden @ ${name}`);
  }
  // pause + resume
  await page.evaluate(() => window.__game.pause());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/pause-${name}.png` });
  if (await page.evaluate(() => window.__game.state) !== 'paused') fail('pause');
  await page.click('#bResume');
  if (await page.evaluate(() => window.__game.state) !== 'play') fail('resume');
  if (errors.length) fail(`console errors @ ${name}: ${errors.join(' | ')}`);
  await ctx.close();
}

// ---- every level, bot-completed ----
for (const lv of levels) {
  for (const [name, opts] of fast ? [['desktop', desktop]] : [['desktop', desktop], ['mobile-landscape', mobile]]) {
    const { ctx, page, errors } = await open(opts, `?level=${lv}&bot=1&test=1`);
    let res, shots = 0, t = 0;
    for (let i = 0; i < 80; i++) {
      res = await page.evaluate(() => window.__game.simulate(4));
      t += 4;
      if (name === 'desktop' && (i === 1 || i === 5 || i === 10) && res.state === 'play') await page.screenshot({ path: `${OUT}/level${lv}-${++shots}.png` });
      if (res.state !== 'play' && res.state !== 'ending') break;
    }
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => { const g = window.__game; return { state: g.state, total: g.result && g.result.total, stars: g.result && g.result.stars, shards: g.shards, of: g.world.shardTotal, respawns: g.respawns, left: g.time, calls: g.gfx.renderer.info.render.calls, saved: localStorage.getItem('neon-rooftop-courier-v1') }; });
    const ok = info.state === 'complete' || info.state === 'won';
    console.log(`level ${lv} @ ${name}: ${ok ? 'COMPLETED' : 'NOT COMPLETED (' + info.state + ', plat ' + res.plat + ')'} in ~${t}s sim, time left ${info.left.toFixed(1)}s, respawns ${info.respawns}, shards ${info.shards}/${info.of}, score ${info.total}, stars ${info.stars}`);
    if (!ok) fail(`level ${lv} not completed @ ${name}`);
    if (ok && !(info.saved && JSON.parse(info.saved).best[lv])) fail(`best score not saved for level ${lv}`);
    await page.screenshot({ path: `${OUT}/level${lv}-end-${name}.png` });
    if (errors.length) fail(`console errors level ${lv} @ ${name}: ${errors.join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();
close();
console.log(failed ? `\n${failed} FAILURE(S)` : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
