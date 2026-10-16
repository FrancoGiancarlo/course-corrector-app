// Optional UI integration check: local Playwright + system Chrome, mocked GATT.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
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
    let sequence = 0;
    let streaming = false;
    const mock = {
      commands: [], selections: 0, cancelNext: false, starter: false,
      emitText(text) {
        telemetry.value = new DataView(new TextEncoder().encode(text).buffer);
        telemetry.dispatchEvent(new Event('characteristicvaluechanged'));
      },
      emit(malformed = false) {
        const value = new DataView(new ArrayBuffer(malformed ? 3 : 20));
        if (!malformed) {
          value.setUint8(0, 1);
          value.setUint8(1, 1 | (streaming ? 2 : 0));
          value.setUint16(2, sequence++, true);
          value.setUint32(4, 1000, true);
          value.setInt16(8, -100, true);
          value.setInt16(12, 1000, true);
        }
        telemetry.value = value;
        telemetry.dispatchEvent(new Event('characteristicvaluechanged'));
      },
    };
    const command = { properties: { write: true }, writeValueWithResponse: async (bytes) => {
      mock.commands.push(bytes[0]);
      if (bytes[0] === 1) streaming = true;
      if (bytes[0] === 2) streaming = false;
      mock.emit();
    } };
    const device = new EventTarget();
    device.name = 'CourseCorrector';
    device.gatt = {
      connected: false,
      connect: async () => { device.gatt.connected = true; return device.gatt; },
      getPrimaryService: async (service) => {
        if (mock.starter && service !== '4fafc201-1fb5-459e-8fcc-c5c9c331914b') throw new Error('Wrong starter service');
        return { getCharacteristic: async (uuid) => {
          if (mock.starter) {
            if (uuid !== 'beb5483e-36e1-4688-b7f5-ea07361b26a8') throw new Error('Wrong starter characteristic');
            return telemetry;
          }
          return uuid.startsWith('7b183001') ? telemetry : command;
        } };
      },
      disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    };
    mock.drop = () => device.gatt.disconnect();
    window.bleMock = mock;
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async (options) => {
      mock.selections++;
      mock.starter = options.filters[0].services[0] === '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
      if (mock.cancelNext) { mock.cancelNext = false; throw new DOMException('Cancelled', 'NotFoundError'); }
      return device;
    } } });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const panel = page.getByRole('region', { name: 'Smart club Bluetooth' });
  const button = (name) => panel.getByRole('button', { name, exact: true });
  assert.equal(await button('Start stream').isDisabled(), true);
  await page.evaluate(() => { window.bleMock.cancelNext = true; });
  await button('Connect club').click();
  await panel.getByRole('alert').filter({ hasText: 'No club selected' }).waitFor();
  await button('Connect club').click();
  await button('Start stream').waitFor();
  await button('Start stream').click();
  await panel.getByText('-0.100 / 0.000 / 1.000', { exact: true }).waitFor();
  await panel.getByText('Streaming', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /Demo firmware data/);
  await button('Stop stream').click();
  await panel.getByText('Stopped', { exact: true }).waitFor();
  await button('Request sample').click();
  assert.deepEqual(await page.evaluate(() => window.bleMock.commands), [1, 2, 3]);
  await page.evaluate(() => window.bleMock.emit(true));
  await panel.getByRole('alert').filter({ hasText: '20-byte' }).waitFor();
  await page.evaluate(() => window.bleMock.emit());
  await panel.getByRole('alert').waitFor({ state: 'hidden' });
  await panel.getByText(/Last sample is stale/).waitFor({ timeout: 6000 });
  await page.evaluate(() => window.bleMock.drop());
  await panel.getByText(/Connection lost/).waitFor();
  assert.equal(await button('Start stream').isDisabled(), true);
  await button('Reconnect club').click();
  await button('Request sample').click();
  assert.equal(await page.evaluate(() => window.bleMock.selections), 2);
  assert.equal(await panel.getByText('1 / 0', { exact: true }).count(), 1);
  await page.screenshot({ path: '.camera-check.local/bluetooth-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.camera-check.local/bluetooth-mobile.png', fullPage: true });
  await button('Disconnect club').click();
  await panel.getByText('Club disconnected.', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Live telemetry', { exact: false }).count(), 0);

  await panel.getByLabel('Device firmware').selectOption('adxl345');
  assert.equal(await button('Reconnect club').count(), 0);
  assert.equal(await button('Start stream').count(), 0);
  await button('Connect club').click();
  await panel.getByText(/Starter server connected/).waitFor();
  assert.equal(await panel.getByLabel('Device firmware').isDisabled(), true);
  await page.evaluate(() => window.bleMock.emitText('X:1,Y:2,Z:3'));
  await panel.getByText('X:1,Y:2,Z:3', { exact: true }).waitFor();
  await panel.getByText('58 3a 31 2c 59 3a 32 2c 5a 3a 33', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Gyroscope X / Y / Z (°/s)', { exact: true }).count(), 0);
  await page.evaluate(() => window.bleMock.emitText('<script>alert(1)</script>' + 'x'.repeat(300)));
  await panel.getByText(/<script>alert\(1\)<\/script>/).waitFor();
  assert.equal(await panel.locator('script').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => window.bleMock.drop());
  await panel.getByText(/Connection lost/).waitFor();
  await button('Reconnect club').click();
  await panel.getByText(/Starter server connected/).waitFor();
  await page.evaluate(() => window.bleMock.emitText('reconnected'));
  await panel.getByText('reconnected', { exact: true }).waitFor();
  assert.equal(await panel.getByText('1 / 0', { exact: true }).count(), 1);
  await page.screenshot({ path: '.camera-check.local/bluetooth-starter-mobile.png', fullPage: true });
  await button('Disconnect club').click();
  await panel.getByLabel('Device firmware').selectOption('courseCorrector');
  assert.equal(await button('Start stream').isDisabled(), true);

  const unsupported = await browser.newPage();
  await unsupported.route('**/models/**', (route) => route.abort());
  await unsupported.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await unsupported.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { value: undefined }));
  await unsupported.goto(url);
  await unsupported.getByText(/Web Bluetooth is unavailable here/).waitFor();
  assert.equal(await unsupported.getByRole('button', { name: 'Connect club', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: Chrome BLE UI, chooser cancellation, commands, notifications, invalid/stale data, disconnect/reconnect, mobile layout, unsupported browser. GATT is mocked; hardware still needs validation.');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
