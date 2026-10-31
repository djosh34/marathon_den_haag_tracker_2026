// iPhone 17 Pro check in WebKit: screenshots when opening the site at fixed times on race day,
// time travel, a live check across a closure change, the runner view, then an offline reload
// that must not touch the network.
// Usage: node tools/test.mjs [url]   (default http://127.0.0.1:8643/, serving build/ with an empty base path)
import { webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8643/';
const dir = 'screenshots/svelte';
mkdirSync(dir, { recursive: true });
const times = ['07:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '14:00', '15:00', '18:00'];
const at = (t) => new Date(`2026-11-01T${t}+01:00`);
const shot = (page, name) => page.screenshot({ path: `${dir}/iphone17pro-${name}.png` });

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices['iPhone 17 Pro'], timezoneId: 'Europe/Amsterdam' });
const errors = [];
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

async function open(time, ready = '#rows li') {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  await page.clock.install({ time: at(time) });
  await page.goto(url);
  await page.waitForSelector(ready, { timeout: 30e3 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60e3 });
  await page.waitForTimeout(8000); // software WebGL in the container needs a while to paint
  return page;
}
const text = (page, sel) => page.textContent(sel).then((t) => t.trim().replace(/\s+/g, ' '));
const badges = (page) => page.$$eval('.badge:not([hidden])', (b) => b.map((x) => x.textContent).join(' '));
const kms = (page) => page.$$eval('.km:not([hidden])', (b) => b.map((x) => x.textContent));
// Svelte listens for input events on the document, so the synthetic event bubbles like a real one.
const slide = (page, t) => page.$eval('#slider', (s, v) => { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }, at(t).getTime());

// First visit installs the service worker and caches everything.
await (await open('07:00')).close();

for (const t of times) {
  const page = await open(`${t}:00`);
  await shot(page, t.replace(':', ''));
  const b = await badges(page);
  console.log(`${t}: ${await text(page, '#clock')} "${await text(page, '#summary')}" "${await text(page, '#next')}" badges: ${b}`);
  if (t === '11:30') {
    check(/^\d+ of 19 roads closed$/.test(await text(page, '#summary')) && b.length > 0, '11:30 shows closed roads with badges');
    await page.click('#handle');
    await page.waitForTimeout(600);
    await shot(page, '1130-list');
  }
  if (t === '07:00') check(await text(page, '#summary') === '1 of 19 roads closed', '07:00 shows 1 of 19 roads closed');
  if (t === '18:00') check(await text(page, '#summary') === '1 of 19 roads closed', '18:00 shows 1 road still closed (Koningskade)');
  await page.close();
}

// Time travel: open live at 07:00, then slide to 13:30.
const tt = await open('07:00:00');
await tt.click('#clock');
await slide(tt, '13:30:00');
await tt.waitForTimeout(3000);
await shot(tt, 'timetravel-1330');
const ttText = `${await text(tt, '#clock')} "${await text(tt, '#summary')}"`;
await tt.click('#live');
await tt.waitForTimeout(500);
const back = await text(tt, '#clock');
console.log(`time travel: slider to 13:30 shows ${ttText}, back to live shows ${back}`);
check(ttText.startsWith('13:30 preview') && back.startsWith('07:00 live'), 'time travel to 13:30 and back to live');
await tt.close();

// Live: closure 12 closes at 10:30. Open at 10:29:40 and let 35 real seconds pass.
const live = await open('10:29:40');
const row12 = (page) => page.$$eval('#rows li', (l) => l.find((e) => e.textContent.includes('Closed 10:30')).querySelector('.left').textContent.trim());
const before = await row12(live);
await live.waitForTimeout(35e3);
const after = await row12(live);
await shot(live, 'live-1030');
console.log(`live: closure 12 before "${before}", after "${after}"`);
check(before.includes('closes in') && after.includes('opens in'), 'closure 12 flips from "closes in" to "opens in" live');
await live.close();

// Runner view: toggle, slide through the race, km markers, settings.
const rn = await open('09:00:00');
await rn.click('#mode-runner');
await rn.waitForTimeout(1500);
check(await rn.getAttribute('#mode-runner', 'aria-pressed') === 'true', 'runner toggle is pressed');
check(await rn.$$eval('#rows li', (l) => l.length) === 0, 'runner view hides the closure list');
await rn.click('#clock');
const runnerAt = {};
for (const t of ['10:00', '11:00', '12:30', '14:15']) {
  await slide(rn, `${t}:00`);
  await rn.waitForTimeout(3000);
  await shot(rn, `runner-${t.replace(':', '')}`);
  runnerAt[t] = { summary: await text(rn, '#summary'), next: await text(rn, '#next'), badges: await badges(rn) };
  console.log(`runner ${t}: "${runnerAt[t].summary}" "${runnerAt[t].next}" badges: "${runnerAt[t].badges}"`);
}
check(runnerAt['10:00'].summary === 'Starts in 15m', 'runner 10:00: "Starts in 15m"');
check(/^Between km \d+\.\d and \d+\.\d$/.test(runnerAt['12:30'].summary), 'runner 12:30: "Between km A.B and C.D"');
check(/^Between km \d+\.\d and the finish$/.test(runnerAt['14:15'].summary), 'runner 14:15: "Between km A.B and the finish"');
check(runnerAt['12:30'].next === 'Pace 5:20 to 6:03 per km, finish 14:00 to 14:30', 'runner pace line');
check(Object.values(runnerAt).every((r) => r.badges === ''), 'no closure badges in runner mode');

await slide(rn, '12:30:00');
await rn.waitForTimeout(1000);
const out = await kms(rn);
console.log(`km markers zoomed out: ${out.join(' ')}`);
check(out.join(' ') === '10 20 30 40', '4 km markers zoomed out');
const box = await rn.locator('#map canvas').boundingBox();
for (let i = 0; i < 2; i++) {
  await rn.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.35);
  await rn.waitForTimeout(2500);
}
const near = await kms(rn);
console.log(`km markers zoomed in: ${near.join(' ')}`);
check(near.length > 4 && near.includes('2.5'), 'more km markers zoomed in (every 2.5 km)');
await shot(rn, 'runner-1230-zoomed');

await rn.click('#handle');
await rn.waitForTimeout(600);
await shot(rn, 'runner-1230-settings');
const was = await text(rn, '#summary');
await rn.selectOption('#runner-start', '10:45');
await rn.waitForTimeout(1000);
const now = await text(rn, '#summary');
console.log(`runner start 10:15 -> 10:45: "${was}" -> "${now}", "${await text(rn, '#next')}"`);
check(now !== was && now.startsWith('Between km'), 'changing the start time to 10:45 changes the summary');
await shot(rn, 'runner-1230-start1045');
await rn.evaluate(() => localStorage.clear());
await rn.close();

// Offline: every response after the reload must come from the service worker.
await context.setOffline(true);
const page = await context.newPage();
const network = [];
page.on('response', (r) => !r.fromServiceWorker() && !/^(data|blob):/.test(r.url()) && network.push(r.url()));
page.on('requestfailed', (r) => errors.push(`offline request failed (service-worker.js update check is expected): ${r.url()}`));
await page.clock.install({ time: at('11:30:00') });
await page.goto(url);
await page.waitForSelector('#rows li');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.waitForTimeout(3000);
await shot(page, 'offline-1130');
const rows = await page.$$eval('#rows li', (l) => l.length);
console.log(`offline: ${rows} closures listed, requests that reached the network: ${network.length}`);
network.forEach((u) => console.log('  network:', u));
check(rows === 19 && network.length === 0, 'offline reload lists 19 closures with 0 network requests');
await page.evaluate(() => localStorage.clear());
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'errors: none');
console.log(failures.length ? `${failures.length} check(s) failed` : 'all checks passed');

await browser.close();
process.exit(failures.length ? 1 : 0);
