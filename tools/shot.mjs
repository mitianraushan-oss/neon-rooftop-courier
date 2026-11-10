// Quick screenshot helper: node tools/shot.mjs <out.png> [url-suffix] [width] [height] [waitMs] [evalJs]
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const [out = 'shot.png', suffix = '', w = '1280', h = '720', wait = '2500', js = ''] = process.argv.slice(2);
const { url, close } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url + suffix);
await page.waitForTimeout(+wait);
if (js) console.log('eval:', JSON.stringify(await page.evaluate(js)));
if (js) await page.waitForTimeout(600);
await page.screenshot({ path: out });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
close();
