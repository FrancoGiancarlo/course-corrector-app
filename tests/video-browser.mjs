// Optional browser integration check; setup is documented in README.md.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.camera-check.local/browsers');
const { firefox } = await import('../.camera-check.local/node_modules/playwright/index.mjs');

const root = resolve('dist');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname === '/src/swingVideoStore.js' ? resolve('src/swingVideoStore.js')
    : resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root + sep) && path !== resolve('src/swingVideoStore.js')) {
    res.writeHead(403).end(); return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await firefox.launch({ headless: true, firefoxUserPrefs: {
    'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true,
  } });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Prove recording is independent of model/network availability.
  await page.route('**/models/**', (route) => route.abort());
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const recordButton = page.getByRole('button', { name: 'Record 8s test', exact: true });
  assert.equal(await recordButton.isDisabled(), true);
  await page.getByRole('button', { name: 'Start Camera', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.video-empty'));
  await recordButton.click();
  await page.getByRole('button', { name: /Cancel \(/ }).click();
  assert.match(await page.locator('.recording-info').innerText(), /0\/10/);
  await recordButton.click();
  await page.getByText('Video saved.', { exact: false }).waitFor({ timeout: 20000 });
  assert.match(await page.locator('.recording-info').innerText(), /1\/10/);
  console.log('PASS: countdown cancellation and automatic 8-second recording without pose model');

  await page.getByRole('button', { name: /View all/ }).click();
  const player = page.getByLabel('Recorded swing video');
  await player.evaluate((video) => video.play());
  await page.waitForFunction(() => document.querySelector('.saved-video video').currentTime > 0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download video' }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.webm$/);
  assert.equal(await download.failure(), null);
  await page.reload();
  await page.getByRole('button', { name: /View all/ }).click();
  await page.getByLabel('Recorded swing video').waitFor();
  assert.equal(await page.locator('.saved-video').count(), 1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate swing' }).click();
  await page.getByRole('button', { name: 'Reset session' }).click();
  assert.match(await page.locator('.recording-info').innerText(), /1\/10/);
  console.log('PASS: video playback, download, reload persistence, and session reset preservation');

  await page.getByRole('button', { name: 'Start Camera', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.video-empty'));
  await recordButton.click();
  await page.getByRole('button', { name: /Stop & save/ }).waitFor();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Stop Camera', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.recording-info').textContent.includes('2/10'));
  console.log('PASS: stopping the camera finalizes an active recording');

  const capacity = await page.evaluate(async () => {
    const store = await import('/src/swingVideoStore.js');
    const [original] = await store.listVideos();
    const writes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
      store.saveVideo({ ...original, id: `capacity-${i}`, createdAt: Date.now() + i })));
    const saved = await store.listVideos();
    const rejectEmpty = await store.saveVideo({ ...original, id: 'empty', blob: new Blob([]) }).then(() => false, () => true);
    const rejectOversized = await store.saveVideo({ ...original, id: 'huge', blob: new Blob([new Uint8Array(store.MAX_VIDEO_BYTES + 1)]) }).then(() => false, () => true);
    return { count: saved.length, rejected: writes.filter((r) => r.status === 'rejected').length,
      originalPreserved: saved.some((clip) => clip.id === original.id), rejectEmpty, rejectOversized };
  });
  assert.deepEqual(capacity, { count: 10, rejected: 4, originalPreserved: true, rejectEmpty: true, rejectOversized: true });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.recording-info').textContent.includes('10/10'));
  await page.getByRole('button', { name: 'Start Camera', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.video-empty'));
  assert.equal(await recordButton.isDisabled(), true);
  await page.getByRole('button', { name: /View all/ }).click();
  await page.getByRole('button', { name: 'Delete video', exact: true }).first().click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.saved-video').length === 9);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await recordButton.isEnabled(), true);
  console.log('PASS: atomic 10-video cap, validation, full-library controls, and deletion');

  // Inject a failed IndexedDB write and confirm the clip remains downloadable.
  await page.evaluate(() => {
    window.originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === 'readwrite') throw new DOMException('Test quota', 'QuotaExceededError');
      return window.originalTransaction.apply(this, args);
    };
  });
  await recordButton.click();
  await page.getByRole('button', { name: /Stop & save/ }).waitFor();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Stop & save/ }).click();
  await page.getByRole('button', { name: 'Recover unsaved video' }).click();
  assert.equal(await page.locator('.unsaved-video video').count(), 1);
  await page.locator('.unsaved-video video').evaluate((video) => video.play());
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalTransaction; });
  await page.getByRole('button', { name: 'Retry saving video' }).click();
  await page.waitForFunction(() => !document.querySelector('.unsaved-video'));
  assert.equal(await page.locator('.saved-video').count(), 10);
  console.log('PASS: quota failure recovery and successful retry');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  for (const [width, height] of [[1366, 768], [1280, 600], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `page overflow at ${width}`);
    const overflow = await page.locator('.video-panel').evaluate((panel) => panel.scrollHeight - panel.clientHeight);
    assert.ok(overflow < 3, `camera panel overflow at ${width}: ${overflow}`);
    assert.equal(await page.locator('.video-stage').evaluate((stage) => {
      const bounds = stage.getBoundingClientRect();
      const panel = stage.closest('.video-panel').getBoundingClientRect();
      return bounds.left >= panel.left && bounds.right <= panel.right;
    }), true, `preview outside panel at ${width}`);
  }
  await page.screenshot({ path: '.camera-check.local/video-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /View all/ }).click();
  assert.equal(await page.locator('.shot-menu').evaluate((menu) => menu.scrollWidth <= menu.clientWidth), true);
  await page.screenshot({ path: '.camera-check.local/video-library.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/mobile layout and no uncaught browser errors');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
