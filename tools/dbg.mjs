import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const [lv, secs='20', js=''] = process.argv.slice(2);
const { url, close } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[c]', m.text()));
page.on('pageerror', (e) => console.log('[e]', e.message));
await page.goto(url + `?level=${lv}&bot=1&test=1`);
await page.waitForFunction(() => window.__game && window.__game.state === 'play');
const out = await page.evaluate(({secs, js}) => {
  const g = window.__game, log = [];
  const _r = g.respawn.bind(g);
  g.respawn = (t) => { const p=g.player; const L=g.route.links[g.curPlat]; log.push(`RESPAWN ${t} at plat ${g.curPlat} link ${L&&L.type} g=${L&&L.g.toFixed(1)} dh=${L&&L.dh.toFixed(1)} pos ${p.p.x.toFixed(1)},${p.p.y.toFixed(1)},${p.p.z.toFixed(1)} v ${p.v.x.toFixed(1)},${p.v.y.toFixed(1)},${p.v.z.toFixed(1)} wr=${p.wr.on} gr=${p.gr.on} t=${g.clock.toFixed(1)}`); _r(t); };
  const _h = g.hit.bind(g);
  g.hit = (s,x,z,l) => { const r=_h(s,x,z,l); if(r) log.push(`HIT ${l} plat ${g.curPlat} t=${g.clock.toFixed(1)}`); return r; };
  if (js) eval(js);
  const n = secs*60;
  for (let i=0;i<n;i++){ g.step(1/60); if (g.state!=='play') break; if (log.length>14) break; }
  log.push(`end state ${g.state} plat ${g.curPlat}/${g.route.plats.length-1} time ${g.time.toFixed(1)} clock ${g.clock.toFixed(1)}`);
  return log;
}, {secs:+secs, js});
console.log(out.join('\n'));
await browser.close(); close();
