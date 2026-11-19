// Optional UI integration check: local Playwright + system Chrome, mocked GATT.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { snapshot } from './bleFixtures.mjs';
import { chromium } from '../.camera-check.local/node_modules/playwright/index.mjs';

const root = resolve('dist');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/models/**', (route) => route.abort());
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.addInitScript(() => {
    const telemetry = new EventTarget();
    telemetry.properties = { notify: true };
    telemetry.startNotifications = async () => telemetry;
    const mock = {
      selections: 0, cancelNext: false,
      emit(packets) {
        for (const bytes of packets) {
          telemetry.value = new DataView(Uint8Array.from(bytes).buffer);
          telemetry.dispatchEvent(new Event('characteristicvaluechanged'));
        }
      },
    };
    const device = new EventTarget();
    device.name = 'CourseCorrector';
    device.gatt = {
      connected: false,
      connect: async () => { device.gatt.connected = true; return device.gatt; },
      getPrimaryService: async (service) => {
        if (service !== 'a9081000-17c4-4e70-8c24-174219c76510') throw new Error('Wrong ESP32 service');
        return { getCharacteristic: async (uuid) => {
          if (uuid !== 'a9081001-17c4-4e70-8c24-174219c76510') throw new Error('Unexpected characteristic');
          return telemetry;
        } };
      },
      disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    };
    mock.drop = () => device.gatt.disconnect();
    window.bleMock = mock;
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async (options) => {
      if (JSON.stringify(options) !== JSON.stringify({ filters: [{ services: ['a9081000-17c4-4e70-8c24-174219c76510'] }] })) throw new Error('Unexpected device filter');
      mock.selections++;
      if (mock.cancelNext) { mock.cancelNext = false; throw new DOMException('Cancelled', 'NotFoundError'); }
      return device;
    } } });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const panel = page.getByRole('region', { name: 'Smart club Bluetooth' });
  const button = (name) => panel.getByRole('button', { name, exact: true });
  const emit = packets => page.evaluate(bytes => window.bleMock.emit(bytes),
    packets.map(value => [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]));
  const metric = label => panel.locator('.club-readings > div').filter({ has: page.getByText(label, { exact: true }) }).locator('strong');
  assert.equal(await panel.getByRole('combobox').count(), 0);
  for (const label of ['Start stream', 'Stop stream', 'Request sample']) assert.equal(await button(label).count(), 0);
  await page.evaluate(() => { window.bleMock.cancelNext = true; });
  await button('Connect ESP32').click();
  await panel.getByRole('alert').filter({ hasText: 'No ESP32 selected' }).waitFor();
  await button('Connect ESP32').click();
  await panel.getByText(/ESP32 connected. Listening/).waitFor();
  await panel.getByText('Live telemetry · Waiting for snapshots', { exact: true }).waitFor();
  await emit(snapshot().slice(0, 2));
  assert.equal(await metric('Acceleration X / Y / Z (g)').innerText(), '—');
  await emit(snapshot().slice(2));
  await panel.getByText('-0.10 / 0.00 / 1.00', { exact: true }).waitFor();
  assert.equal(await metric('Gyroscope X / Y / Z (°/s)').innerText(), '12.30 / -12.30 / 3276.70');
  assert.equal(await metric('Complete snapshots').innerText(), '1');
  await panel.getByText('123.456 kSPS/channel', { exact: true }).waitFor();
  await panel.getByText('4000000000 / 7', { exact: true }).waitFor();
  const rows = panel.getByRole('table', { name: 'Strain gauge readings' }).locator('tbody tr');
  assert.equal(await rows.count(), 8);
  assert.deepEqual(await rows.first().locator('th, td').allTextContents(), ['AIN1', 'Strain7', '-32768', '-5.0000']);
  assert.deepEqual(await rows.last().locator('th, td').allTextContents(), ['AIN8', 'Strain2', '16384', '2.5000']);
  await emit([new DataView(new ArrayBuffer(3))]);
  await panel.getByRole('alert').filter({ hasText: '20-byte' }).waitFor();
  assert.equal(await metric('Invalid packets').innerText(), '1');
  await emit(snapshot(44));
  await panel.getByRole('alert').waitFor({ state: 'hidden' });
  assert.equal(await metric('Missing / incomplete observed').innerText(), '1');
  await panel.getByText('Live telemetry · Stalled', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await metric('Acceleration X / Y / Z (g)').innerText(), '—');
  assert.deepEqual(await rows.first().locator('th, td').allTextContents(), ['AIN1', 'Strain7', '—', '—']);
  assert.equal(await metric('Last measured ADC benchmark').innerText(), 'Not available');
  // Fresh packets with invalid sensor flags must not restore old readings.
  await emit(snapshot(45, 4));
  await panel.getByText('Live telemetry · Receiving', { exact: true }).waitFor();
  assert.equal(await metric('Acceleration X / Y / Z (g)').innerText(), '—');
  assert.equal(await metric('Gyroscope X / Y / Z (°/s)').innerText(), '12.30 / -12.30 / 3276.70');
  assert.equal(await rows.first().locator('td').nth(1).innerText(), '—');
  await page.evaluate(() => window.bleMock.drop());
  await panel.getByText(/Connection lost/).waitFor();
  assert.equal(await panel.getByRole('table').count(), 0);
  await button('Reconnect ESP32').click();
  await panel.getByText(/ESP32 connected. Listening/).waitFor();
  await emit(snapshot(0));
  await panel.getByText('-0.10 / 0.00 / 1.00', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.bleMock.selections), 2);
  assert.equal(await metric('Complete snapshots').innerText(), '1');
  assert.equal(await metric('Invalid packets').innerText(), '0');
  await page.screenshot({ path: '.camera-check.local/bluetooth-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.camera-check.local/bluetooth-mobile.png', fullPage: true });
  await button('Disconnect ESP32').click();
  await panel.getByText('ESP32 disconnected.', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Live telemetry', { exact: false }).count(), 0);

  const unsupported = await browser.newPage();
  await unsupported.route('**/models/**', (route) => route.abort());
  await unsupported.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await unsupported.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { value: undefined }));
  await unsupported.goto(url);
  await unsupported.getByText(/Web Bluetooth is unavailable here/).waitFor();
  assert.equal(await unsupported.getByRole('button', { name: 'Connect ESP32', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: Chrome BLE UI, single firmware filter, chooser cancellation, snapshot assembly, strain/IMU/benchmark display, invalid/stale/unavailable data, disconnect/reconnect, mobile layout, unsupported browser. GATT is mocked; hardware still needs validation.');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
