import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubBluetooth, bluetoothSupport, decodePacket, createAssembler, SERVICE_UUID, TELEMETRY_UUID } from '../bluetoothService.js';
import { packet, snapshot } from './bleFixtures.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const telemetry = new EventTarget();
  telemetry.properties = { notify: true };
  telemetry.startNotifications = async () => telemetry;
  const service = { getCharacteristic: async (uuid) => {
    assert.equal(uuid, TELEMETRY_UUID); // No command characteristic may be requested.
    return telemetry;
  } };
  const device = new EventTarget();
  device.name = 'CourseCorrector';
  let disconnects = 0;
  device.gatt = {
    connected: false,
    connect: async () => { device.gatt.connected = true; return device.gatt; },
    getPrimaryService: async (uuid) => { assert.equal(uuid, SERVICE_UUID); return service; },
    disconnect: () => {
      disconnects++;
      device.gatt.connected = false;
      device.dispatchEvent(new Event('gattserverdisconnected'));
    },
  };
  let selections = 0;
  const environment = { isSecureContext: true, navigator: { bluetooth: {
    requestDevice: async (options) => {
      selections++;
      assert.deepEqual(options, { filters: [{ services: [SERVICE_UUID] }] });
      return device;
    },
  } } };
  const client = new ClubBluetooth(environment);
  return { client, environment, device, telemetry, service,
    get selections() { return selections; }, get disconnects() { return disconnects; },
    notify(value = packet()) {
      telemetry.value = value;
      telemetry.dispatchEvent(new Event('characteristicvaluechanged'));
    },
    snapshot(seq = 42, flags = 15) { snapshot(seq, flags).forEach(value => this.notify(value)); },
  };
}

test('detects insecure and unsupported environments before opening chooser', async () => {
  assert.match(bluetoothSupport({ isSecureContext: false }), /HTTPS/);
  assert.match(bluetoothSupport({ isSecureContext: true, navigator: {} }), /Chrome or Edge/);
  const h = harness();
  h.environment.isSecureContext = false;
  await h.client.connect();
  assert.equal(h.selections, 0);
  assert.equal(h.client.state.status, 'disconnected');
});

test('connects only to the flashed protocol, receives snapshots and reconnects without another chooser', async () => {
  const h = harness();
  await h.client.connect();
  assert.equal(h.client.state.status, 'connected');
  h.snapshot();
  assert.equal(h.client.state.stats.good, 1);
  assert.equal(h.client.state.sample.seq, 42);
  h.client.disconnect();
  assert.equal(h.disconnects, 1);
  assert.equal(h.client.state.sample, null);
  h.snapshot();
  assert.equal(h.client.state.stats.good, 1);
  await h.client.connect(true);
  assert.equal(h.selections, 1);
  assert.equal(h.client.state.stats.good, 0);
  h.snapshot();
  assert.equal(h.client.state.stats.good, 1); // No duplicate notification listeners.
  h.client.dispose();
});

test('bad packets do not replace valid samples, later valid packets clear protocol errors', async () => {
  const h = harness();
  await h.client.connect();
  h.snapshot();
  const sample = h.client.state.sample;
  h.notify(new DataView(new ArrayBuffer(2)));
  assert.equal(h.client.state.sample, sample);
  assert.equal(h.client.state.stats.invalid, 1);
  assert.match(h.client.state.protocolError, /20-byte/);
  h.snapshot(43);
  assert.equal(h.client.state.stats.good, 2);
  assert.equal(h.client.state.protocolError, '');
  h.client.dispose();
});

test('radio loss clears live readings and preserves manual reconnect', async () => {
  const h = harness();
  await h.client.connect();
  h.snapshot();
  h.device.gatt.disconnect();
  assert.equal(h.client.state.status, 'disconnected');
  assert.equal(h.client.state.sample, null);
  assert.equal(h.client.state.lastReceivedAt, null);
  assert.equal(h.client.state.canReconnect, true);
  assert.match(h.client.state.notice, /Connection lost/);
  h.snapshot();
  assert.equal(h.client.state.stats.good, 1);
  h.client.dispose();
});

test('chooser cancellation and missing firmware have distinct actionable messages', async () => {
  const h = harness();
  const error = Object.assign(new Error(), { name: 'NotFoundError' });
  h.environment.navigator.bluetooth.requestDevice = async () => { throw error; };
  await h.client.connect();
  assert.match(h.client.state.error, /No ESP32 selected/);
  h.environment.navigator.bluetooth.requestDevice = async () => h.device;
  h.service.getCharacteristic = async () => { throw error; };
  await h.client.connect();
  assert.match(h.client.state.error, /firmware UUIDs/);
  assert.equal(h.device.gatt.connected, false);
});

test('failed subscription and incompatible properties release the connection', async () => {
  for (const failure of ['properties', 'subscription']) {
    const h = harness();
    if (failure === 'properties') h.telemetry.properties.notify = false;
    else h.telemetry.startNotifications = async () => { throw new Error('Subscription failed'); };
    await h.client.connect();
    assert.equal(h.client.state.status, 'disconnected');
    assert.equal(h.device.gatt.connected, false);
    assert.ok(h.client.state.error);
    h.snapshot();
    assert.equal(h.client.state.stats.good, 0);
  }
});

test('cancelled chooser cannot take over a new connection', async () => {
  const h = harness();
  const choice = deferred();
  h.environment.navigator.bluetooth.requestDevice = () => choice.promise;
  const oldConnect = h.client.connect();
  h.client.disconnect();
  h.environment.navigator.bluetooth.requestDevice = async () => h.device;
  await h.client.connect();
  choice.resolve(h.device);
  await oldConnect;
  assert.equal(h.client.state.status, 'connected');
  assert.equal(h.device.gatt.connected, true);
  h.client.dispose();
});

test('late GATT completion after cancellation releases its connection', async () => {
  const h = harness();
  const connection = deferred();
  h.device.gatt.connect = () => connection.promise;
  const connect = h.client.connect();
  await Promise.resolve(); // Chooser completed, GATT connection pending.
  h.client.disconnect();
  h.device.gatt.connected = true;
  connection.resolve(h.device.gatt);
  await connect;
  assert.equal(h.device.gatt.connected, false);
  assert.equal(h.client.state.status, 'disconnected');
});

test('late subscription completion cannot revive disposed client', async () => {
  const h = harness();
  const subscription = deferred();
  const reached = deferred();
  h.telemetry.startNotifications = () => { reached.resolve(); return subscription.promise; };
  const connect = h.client.connect();
  await reached.promise;
  h.client.dispose();
  subscription.resolve();
  await connect;
  h.snapshot();
  assert.equal(h.client.state.status, 'disconnected');
  assert.equal(h.client.state.stats.good, 0);
  assert.equal(h.device.gatt.connected, false);
});

test('burst notifications are published in batches, and cleanup clears the timer', async () => {
  const h = harness();
  await h.client.connect();
  let publications = 0;
  const unsubscribe = h.client.subscribe(() => publications++);
  for (let i = 0; i < 100; i++) h.snapshot(i);
  assert.equal(publications, 0);
  assert.equal(h.client.state.stats.good, 100);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(publications, 1);
  h.snapshot();
  h.client.dispose();
  assert.equal(h.client.publishTimer, null);
  unsubscribe();
});
test('decodes signed ADC, IMU scaling, unsigned benchmark values and buffer offsets', () => {
  const bytes = new Uint8Array(30);
  bytes.set(new Uint8Array(packet(1).buffer), 5);
  assert.deepEqual(decodePacket(new DataView(bytes.buffer, 5, 20)).adc, [-32768, -1, 0, 1, 32767, 100, -100, 16384]);
  assert.deepEqual(decodePacket(packet(2)), {
    type: 2, flags: 15, seq: 42, uptimeMs: 1000,
    accel: { x: -0.1, y: 0, z: 1 }, gyro: { x: 12.3, y: -12.3, z: 3276.7 },
  });
  assert.deepEqual(decodePacket(packet(3)).benchmark, { sps: 123456, valid: 4000000000, errors: 7, ageMs: 1500 });
});

test('honors each sensor validity bit independently', () => {
  for (let flags = 0; flags < 16; flags++) {
    assert.equal(decodePacket(packet(1, 0, flags)).adc !== null, Boolean(flags & 1));
    assert.equal(decodePacket(packet(2, 0, flags)).accel !== null, Boolean(flags & 2));
    assert.equal(decodePacket(packet(2, 0, flags)).gyro !== null, Boolean(flags & 4));
    assert.equal(decodePacket(packet(3, 0, flags)).benchmark !== null, Boolean(flags & 8));
  }
});

test('rejects malformed lengths, old protocol, unknown versions/types and reserved flags', () => {
  for (const value of [null, new Uint8Array(20), new DataView(new ArrayBuffer(19)), new DataView(new ArrayBuffer(21))]) {
    assert.throws(() => decodePacket(value), /20-byte/);
  }
  for (const header of [0x01, 0x10, 0x14, 0x21, 0xff]) {
    const value = packet();
    value.setUint8(0, header);
    assert.throws(() => decodePacket(value), /header/);
  }
  assert.throws(() => decodePacket(packet(1, 0, 16)), /header/);
});

test('assembles reordered parts exactly once, rejects inconsistent flags and ignores duplicates', () => {
  const samples = [];
  let stats;
  const accept = createAssembler(sample => samples.push(sample), value => { stats = value; });
  accept(packet(3));
  accept(packet(1));
  accept(packet(1));
  accept(packet(2, 42, 0));
  assert.equal(samples.length, 0);
  assert.deepEqual(stats, { good: 0, missing: 0, invalid: 1 });
  accept(packet(2));
  snapshot().forEach(accept);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].adc[0], -32768);
  assert.equal(samples[0].accel.x, -0.1);
  assert.equal(samples[0].benchmark.sps, 123456);
  assert.deepEqual(stats, { good: 1, missing: 0, invalid: 1 });
});

test('counts incomplete and skipped snapshots immediately without mixing sequences', () => {
  const samples = [];
  let stats;
  const accept = createAssembler(sample => samples.push(sample), value => { stats = value; });
  accept(packet(1, 10));
  accept(packet(2, 10));
  accept(packet(3, 12));
  assert.deepEqual(stats, { good: 0, missing: 2, invalid: 0 });
  accept(packet(3, 10)); // Late part cannot resurrect the incomplete snapshot.
  assert.equal(samples.length, 0);
  accept(packet(1, 12));
  accept(packet(2, 12));
  assert.equal(samples.length, 1);
  assert.equal(samples[0].seq, 12);
  assert.deepEqual(stats, { good: 1, missing: 2, invalid: 0 });
});

test('sequence rollover accepts zero and ignores duplicates and older notifications', () => {
  const samples = [];
  let stats;
  const accept = createAssembler(sample => samples.push(sample), value => { stats = value; });
  for (const seq of [65535, 0, 65535, 0, 1]) snapshot(seq).forEach(accept);
  assert.deepEqual(samples.map(sample => sample.seq), [65535, 0, 1]);
  assert.deepEqual(stats, { good: 3, missing: 0, invalid: 0 });
});

test('partial, invalid and duplicate packets never refresh the live reading timestamp', async () => {
  const h = harness();
  await h.client.connect();
  h.notify(packet(1));
  assert.equal(h.client.state.lastReceivedAt, null);
  assert.equal(h.client.state.sample, null);
  h.snapshot();
  const timestamp = h.client.state.lastReceivedAt;
  const sample = h.client.state.sample;
  h.snapshot();
  h.notify(packet(1, 43));
  h.notify(new DataView(new ArrayBuffer(2)));
  assert.equal(h.client.state.lastReceivedAt, timestamp);
  assert.equal(h.client.state.sample, sample);
  assert.equal(h.client.state.stats.good, 1);
  h.client.dispose();
});

test('reconnection discards partial snapshots from the previous session', async () => {
  const h = harness();
  await h.client.connect();
  h.notify(packet(1));
  h.client.disconnect();
  await h.client.connect(true);
  h.notify(packet(2));
  h.notify(packet(3));
  assert.equal(h.client.state.sample, null);
  h.notify(packet(1));
  assert.equal(h.client.state.stats.good, 1);
  h.client.dispose();
});

test('disconnect during notification setup cannot report connected', async () => {
  const h = harness();
  h.telemetry.startNotifications = async () => { h.device.gatt.connected = false; };
  await h.client.connect();
  assert.equal(h.client.state.status, 'disconnected');
  assert.match(h.client.state.error, /disconnected during setup/);
  h.client.dispose();
});
