// iPhone 17 Pro check in WebKit: screenshots when opening the site at fixed times on race day,
// a live check across a closure change, then an offline reload that must not touch the network.
// Usage: node tools/test.mjs [url]   (default http://127.0.0.1:8642/)
import { webkit, devices } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8642/';
const times = ['07:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '14:00', '15:00', '18:00'];
const at = (t) => new Date(`2026-11-01T${t}+01:00`);

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices['iPhone 17 Pro'], timezoneId: 'Europe/Amsterdam' });
const errors = [];

async function open(time) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  await page.clock.install({ time: at(time) });
  await page.goto(url);
  await page.waitForSelector('#rows li', { timeout: 30e3 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60e3 });
  await page.waitForTimeout(8000); // software WebGL in the container needs a while to paint
  return page;
}
const badges = (page) => page.$$eval('.badge:not([hidden])', (b) => b.map((x) => x.textContent).join(' '));

// First visit installs the service worker and caches everything.
await (await open('07:00')).close();

for (const t of times) {
  const page = await open(`${t}:00`);
  await page.screenshot({ path: `screenshots/iphone17pro-${t.replace(':', '')}.png` });
  console.log(`${t}: ${await page.textContent('#clock')} "${await page.textContent('#summary')}" "${await page.textContent('#next')}" badges: ${await badges(page)}`);
  if (t === '11:30') {
    await page.click('#handle');
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'screenshots/iphone17pro-1130-list.png' });
  }
  await page.close();
}

// Time travel: open live at 07:00, then slide to 13:30.
const tt = await open('07:00:00');
await tt.click('#clock');
await tt.$eval('#slider', (s) => { s.value = Date.parse('2026-11-01T13:30:00+01:00'); s.dispatchEvent(new Event('input')); });
await tt.waitForTimeout(3000);
await tt.screenshot({ path: 'screenshots/iphone17pro-timetravel-1330.png' });
const ttText = `${await tt.textContent('#clock')} "${await tt.textContent('#summary')}"`;
await tt.click('#live');
await tt.waitForTimeout(500);
console.log(`time travel: slider to 13:30 shows ${ttText}, back to live shows ${await tt.textContent('#clock')}`);
await tt.close();

// Runner view: the same slider, the course with the runner's range and km markers.
const rv = await open('07:00:00');
await rv.click('#mode [data-mode=runner]');
await rv.click('#clock');
const kms = (page) => page.$$eval('.km', (k) => k.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent).join(' '));
const runnerAt = async (t, shot) => {
  await rv.$eval('#slider', (s, t) => { s.value = Date.parse(`2026-11-01T${t}:00+01:00`); s.dispatchEvent(new Event('input')); }, t);
  await rv.waitForTimeout(3000);
  if (shot) await rv.screenshot({ path: `screenshots/iphone17pro-runner-${t.replace(':', '')}.png` });
  const text = `"${await rv.textContent('#summary')}" "${await rv.textContent('#next')}"`;
  console.log(`runner ${t}: ${text} km: ${await kms(rv)}`);
  return text;
};
await runnerAt('10:00', true);
await runnerAt('11:00', true);
const r1230 = await runnerAt('12:30', true);
await runnerAt('14:15', true);
await runnerAt('15:00', false);
const roadBadges = await rv.$$eval('.badge', (b) => b.filter((e) => getComputedStyle(e).display !== 'none').length);
await runnerAt('12:30', false);
for (let i = 0; i < 2; i++) { await rv.dblclick('#map canvas', { position: { x: 75, y: 380 } }); await rv.waitForTimeout(1500); }
await rv.screenshot({ path: 'screenshots/iphone17pro-runner-1230-zoomed.png' });
console.log(`runner zoomed in: km: ${await kms(rv)}`);
// Settings: a later start moves the range back.
await rv.click('#handle');
await rv.waitForTimeout(600);
await rv.selectOption('#settings [name=start]', '10:45');
await rv.waitForTimeout(1500);
await rv.screenshot({ path: 'screenshots/iphone17pro-runner-settings.png' });
const r1230late = `"${await rv.textContent('#summary')}" "${await rv.textContent('#next')}"`;
console.log(`runner settings: start 10:45 at 12:30 shows ${r1230late}, closure badges visible: ${roadBadges}`);
const runnerOk = r1230.includes('Between km') && r1230late !== r1230 && roadBadges === 0;
await rv.evaluate(() => localStorage.clear());
await rv.close();

// Live: closure 12 closes at 10:30. Open at 10:29:40 and let 35 real seconds pass.
const live = await open('10:29:40');
const row12 = (page) => page.$$eval('#rows li', (l) => l.find((e) => e.textContent.includes('Closed 10:30')).querySelector('.left').textContent);
const before = await row12(live);
await live.waitForTimeout(35e3);
const after = await row12(live);
await live.screenshot({ path: 'screenshots/iphone17pro-live-1030.png' });
console.log(`live: closure 12 before "${before}", after "${after}"`);
const liveOk = after.includes('opens in');

// Offline: every response after the reload must come from the service worker.
await context.setOffline(true);
const page = await context.newPage();
const network = [];
page.on('response', (r) => !r.fromServiceWorker() && !/^(data|blob):/.test(r.url()) && network.push(r.url()));
page.on('requestfailed', (r) => errors.push(`offline request failed (sw.js update check is expected): ${r.url()}`));
await page.clock.install({ time: at('11:30:00') });
await page.goto(url);
await page.waitForSelector('#rows li');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.waitForTimeout(3000);
await page.screenshot({ path: 'screenshots/iphone17pro-offline-1130.png' });
const rows = await page.$$eval('#rows li', (l) => l.length);
console.log(`offline: ${rows} closures listed, requests that reached the network: ${network.length}`);
network.forEach((u) => console.log('  network:', u));
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'errors: none');

await browser.close();
console.log(`runner view: ${runnerOk ? 'ok' : 'FAILED'}`);
process.exit(rows === 19 && network.length === 0 && liveOk && runnerOk ? 0 : 1);
