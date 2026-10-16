import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubBluetooth, bluetoothSupport, decodeTelemetry, CLUB_SERVICE,
  TELEMETRY_CHARACTERISTIC, COMMAND_CHARACTERISTIC, STARTER_SERVICE,
  STARTER_CHARACTERISTIC, decodeStarterNotification } from '../src/clubBluetooth.js';

function packet() {
  return new DataView(Uint8Array.from([
    1, 3, 42, 0, 232, 3, 0, 0, 156, 255, 0, 0, 232, 3, 123, 0, 133, 255, 0, 0,
  ]).buffer);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(starter = false) {
  const serviceUuid = starter ? STARTER_SERVICE : CLUB_SERVICE;
  const telemetryUuid = starter ? STARTER_CHARACTERISTIC : TELEMETRY_CHARACTERISTIC;
  const telemetry = new EventTarget();
  telemetry.properties = { notify: true };
  let subscribed = false;
  telemetry.startNotifications = async () => { subscribed = true; };
  const writes = [];
  const command = { properties: { write: true }, writeValueWithResponse: async (bytes) => {
    assert.equal(subscribed, true);
    writes.push([...bytes]);
  } };
  const service = { getCharacteristic: async (uuid) => {
    assert.ok((starter ? [telemetryUuid] : [telemetryUuid, COMMAND_CHARACTERISTIC]).includes(uuid));
    return uuid === telemetryUuid ? telemetry : command;
  } };
  const device = new EventTarget();
  device.name = 'CourseCorrector';
  let disconnects = 0;
  device.gatt = {
    connected: false,
    connect: async () => { device.gatt.connected = true; return device.gatt; },
    getPrimaryService: async (uuid) => { assert.equal(uuid, serviceUuid); return service; },
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
      assert.deepEqual(options, { filters: [{ services: [serviceUuid] }] });
      return device;
    },
  } } };
  const client = new ClubBluetooth(environment);
  if (starter) client.setProfile('adxl345');
  return { client, environment, device, telemetry, command, writes, service,
    get selections() { return selections; }, get disconnects() { return disconnects; },
    notify(value = packet()) {
      telemetry.value = value;
      telemetry.dispatchEvent(new Event('characteristicvaluechanged'));
    },
  };
}

test('starter preserves text and exact bytes without assuming fields, units or binary v1', () => {
  const bytes = new TextEncoder().encode('xxX:1,Y:2,Z:3\nzz');
  const sample = decodeStarterNotification(new DataView(bytes.buffer, 2, bytes.length - 4));
  assert.equal(sample.rawText, 'X:1,Y:2,Z:3\n');
  assert.equal(sample.rawHex, '58 3a 31 2c 59 3a 32 2c 5a 3a 33 0a');
  assert.equal(sample.byteLength, 12);
  assert.equal(sample.acceleration, undefined);
  assert.equal(decodeStarterNotification(packet()).byteLength, 20);
  assert.equal(decodeStarterNotification(new DataView(Uint8Array.of(0, 255).buffer)).rawHex, '00 ff');
  for (const value of [null, new Uint8Array(2), new DataView(new ArrayBuffer(0)), new DataView(new ArrayBuffer(513))]) {
    assert.throws(() => decodeStarterNotification(value), /1–512 bytes/);
  }
});

test('starter subscribes using supplied UUIDs without a command characteristic and reconnects', async () => {
  const h = harness(true);
  await h.client.connect();
  assert.equal(h.client.state.status, 'connected');
  assert.match(h.client.state.notice, /Listening for notifications/);
  h.client.setProfile('courseCorrector');
  assert.equal(h.client.state.profile, 'adxl345');
  await h.client.sendCommand('start');
  assert.deepEqual(h.writes, []);
  h.notify(new DataView(new TextEncoder().encode('1,2,3').buffer));
  assert.equal(h.client.state.sample.rawText, '1,2,3');
  assert.equal(h.client.state.sample.gyroscope, undefined);
  h.notify(new DataView(new ArrayBuffer(0)));
  assert.equal(h.client.state.invalidPackets, 1);
  assert.equal(h.client.state.sample.rawText, '1,2,3');
  h.device.gatt.disconnect();
  assert.equal(h.client.state.sample, null);
  await h.client.connect(true);
  assert.equal(h.client.state.status, 'connected');
  assert.equal(h.selections, 1);
  h.notify();
  assert.equal(h.client.state.packets, 1);
  h.client.disconnect();
  h.client.setProfile('courseCorrector');
  assert.equal(h.client.state.canReconnect, false);
  assert.equal(h.client.rememberedDevice, null);
  assert.equal(h.client.state.packets, 0);
  assert.throws(() => h.client.setProfile('missing'), /Unknown club profile/);
  h.client.dispose();
});

test('starter rejects a server without notifications and releases it', async () => {
  const h = harness(true);
  h.telemetry.properties.notify = false;
  await h.client.connect();
  assert.equal(h.client.state.status, 'disconnected');
  assert.match(h.client.state.error, /must support notifications/);
  assert.equal(h.device.gatt.connected, false);
});

test('decodes signed little-endian data, units, flags and offsets into a larger buffer', () => {
  const bytes = new Uint8Array(30);
  bytes.set(new Uint8Array(packet().buffer), 5);
  assert.deepEqual(decodeTelemetry(new DataView(bytes.buffer, 5, 20)), {
    demo: true, streaming: true, sensorValid: false, sequence: 42, deviceTimeMs: 1000,
    acceleration: [-0.1, 0, 1], gyroscope: [12.3, -12.3, 0],
  });
  const value = packet();
  value.setUint8(1, 4);
  value.setUint16(2, 65535, true);
  value.setUint32(4, 0xffffffff, true);
  const sample = decodeTelemetry(value);
  assert.equal(sample.demo, false);
  assert.equal(sample.sensorValid, true);
  assert.equal(sample.streaming, false);
  assert.equal(sample.sequence, 65535);
  assert.equal(sample.deviceTimeMs, 0xffffffff);
});

test('rejects wrong sizes, versions and reserved flags', () => {
  for (const value of [null, new Uint8Array(20), new DataView(new ArrayBuffer(19)), new DataView(new ArrayBuffer(21))]) {
    assert.throws(() => decodeTelemetry(value), /20-byte/);
  }
  const value = packet();
  value.setUint8(0, 2);
  assert.throws(() => decodeTelemetry(value), /version/);
  value.setUint8(0, 1);
  value.setUint8(1, 8);
  assert.throws(() => decodeTelemetry(value), /flags/);
});

test('detects insecure and unsupported environments before opening chooser', async () => {
  assert.match(bluetoothSupport({ isSecureContext: false }), /HTTPS/);
  assert.match(bluetoothSupport({ isSecureContext: true, navigator: {} }), /Chrome or Edge/);
  const h = harness();
  h.environment.isSecureContext = false;
  await h.client.connect();
  assert.equal(h.selections, 0);
  assert.equal(h.client.state.status, 'disconnected');
});

test('connects, receives packets, writes binary controls and reconnects without another chooser', async () => {
  const h = harness();
  await h.client.connect();
  assert.equal(h.client.state.status, 'connected');
  await h.client.sendCommand('start');
  await h.client.sendCommand('stop');
  await h.client.sendCommand('ping');
  assert.deepEqual(h.writes, [[1], [2], [3]]);
  h.notify();
  assert.equal(h.client.state.packets, 1);
  assert.equal(h.client.state.sample.sequence, 42);
  h.client.disconnect();
  assert.equal(h.disconnects, 1);
  assert.equal(h.client.state.sample, null);
  h.notify();
  assert.equal(h.client.state.packets, 1);
  await h.client.connect(true);
  assert.equal(h.selections, 1);
  assert.equal(h.client.state.packets, 0);
  h.notify();
  assert.equal(h.client.state.packets, 1); // No duplicate notification listeners.
  h.client.dispose();
});

test('bad packets do not replace valid samples, later valid packets clear protocol errors', async () => {
  const h = harness();
  await h.client.connect();
  h.notify();
  const sample = h.client.state.sample;
  h.notify(new DataView(new ArrayBuffer(2)));
  assert.equal(h.client.state.sample, sample);
  assert.equal(h.client.state.invalidPackets, 1);
  assert.match(h.client.state.protocolError, /20-byte/);
  h.notify();
  assert.equal(h.client.state.packets, 2);
  assert.equal(h.client.state.protocolError, '');
  h.client.dispose();
});

test('radio loss clears live readings and preserves manual reconnect', async () => {
  const h = harness();
  await h.client.connect();
  h.notify();
  h.device.gatt.disconnect();
  assert.equal(h.client.state.status, 'disconnected');
  assert.equal(h.client.state.sample, null);
  assert.equal(h.client.state.lastReceivedAt, null);
  assert.equal(h.client.state.canReconnect, true);
  assert.match(h.client.state.notice, /Connection lost/);
  h.notify();
  assert.equal(h.client.state.packets, 1);
  h.client.dispose();
});

test('chooser cancellation and missing firmware have distinct actionable messages', async () => {
  const h = harness();
  const error = Object.assign(new Error(), { name: 'NotFoundError' });
  h.environment.navigator.bluetooth.requestDevice = async () => { throw error; };
  await h.client.connect();
  assert.match(h.client.state.error, /No club selected/);
  h.environment.navigator.bluetooth.requestDevice = async () => h.device;
  h.service.getCharacteristic = async () => { throw error; };
  await h.client.connect();
  assert.match(h.client.state.error, /firmware UUIDs/);
  assert.equal(h.device.gatt.connected, false);
});

test('failed subscription and incompatible properties release the connection', async () => {
  for (const failure of ['properties', 'subscription']) {
    const h = harness();
    if (failure === 'properties') h.command.properties.write = false;
    else h.telemetry.startNotifications = async () => { throw new Error('Subscription failed'); };
    await h.client.connect();
    assert.equal(h.client.state.status, 'disconnected');
    assert.equal(h.device.gatt.connected, false);
    assert.ok(h.client.state.error);
    h.notify();
    assert.equal(h.client.state.packets, 0);
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
  h.notify();
  assert.equal(h.client.state.status, 'disconnected');
  assert.equal(h.client.state.packets, 0);
  assert.equal(h.device.gatt.connected, false);
});

test('pending writes cannot overlap or update a new connection after disconnect', async () => {
  const h = harness();
  await h.client.connect();
  const write = deferred();
  let writes = 0;
  h.command.writeValueWithResponse = () => { writes++; return write.promise; };
  const sending = h.client.sendCommand('start');
  await h.client.sendCommand('stop');
  assert.equal(writes, 1);
  assert.equal(h.client.state.commandPending, true);
  h.client.disconnect();
  await h.client.connect(true);
  write.reject(new Error('Old write failed'));
  await sending;
  assert.equal(h.client.state.error, '');
  assert.equal(h.client.state.commandPending, false);
  assert.match(h.client.state.notice, /Club connected/);
  h.client.dispose();
});

test('write errors allow retries and do not invent stream confirmation', async () => {
  const h = harness();
  await h.client.connect();
  h.command.writeValueWithResponse = async () => { throw new Error('Write failed'); };
  await h.client.sendCommand('start');
  assert.equal(h.client.state.error, 'Write failed');
  assert.equal(h.client.state.commandPending, false);
  assert.equal(h.client.state.sample, null);
  h.command.writeValueWithResponse = async () => {};
  await h.client.sendCommand('start');
  assert.equal(h.client.state.error, '');
  assert.match(h.client.state.notice, /Check telemetry below/);
  assert.equal(h.client.state.sample, null);
  await assert.rejects(h.client.sendCommand('unknown'), /Unknown club command/);
  h.client.dispose();
});

test('burst notifications are published in batches, and cleanup clears the timer', async () => {
  const h = harness();
  await h.client.connect();
  let publications = 0;
  const unsubscribe = h.client.subscribe(() => publications++);
  for (let i = 0; i < 100; i++) h.notify();
  assert.equal(publications, 0);
  assert.equal(h.client.state.packets, 100);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(publications, 1);
  h.notify();
  h.client.dispose();
  assert.equal(h.client.publishTimer, null);
  unsubscribe();
});
