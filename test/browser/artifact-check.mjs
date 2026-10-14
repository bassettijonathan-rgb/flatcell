// Loads the built Artifact page inside a sandboxed iframe, the way claude.ai
// shows it, and checks it boots, runs the simulation in a worker and draws.
//   node tools/build-artifact.mjs && node test/browser/artifact-check.mjs
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const body = readFileSync(new URL('../../dist/flatcell.html', import.meta.url), 'utf8');
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${body}</body></html>`;
const host = `<!doctype html><html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="border:0;width:100vw;height:100vh"></iframe>
<script>document.getElementById('f').srcdoc = ${JSON.stringify(doc).replace(/<\//g, '<\\/')};</script></body></html>`;

const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(host); });
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
let failed = false;
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport: vp });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  const frame = page.frameLocator('#f');
  await page.waitForTimeout(5000);
  const clock = await frame.locator('#clock').textContent();
  const hud = await frame.locator('#hud-left').textContent();
  const scroll = await frame.locator('body').evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const onPage = logs.some((l) => l.includes('page thread'));
  const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
  const ok = /steps\/s/.test(clock) && /step [1-9]/.test(hud) && scroll <= 0 && !onPage && errors.length === 0;
  console.log(`${vp.width}px: ${ok ? 'ok' : 'FAIL'} | ${hud} | ${clock} | worker ${onPage ? 'no' : 'yes'} | overflow ${scroll}px`);
  if (errors.length) console.log(errors.join('\n'));
  if (!ok) failed = true;
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
