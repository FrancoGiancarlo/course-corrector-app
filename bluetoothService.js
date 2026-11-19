// Protocol from the supplied service for the already-flashed Course Corrector ESP32.
export const SERVICE_UUID = 'a9081000-17c4-4e70-8c24-174219c76510';
export const TELEMETRY_UUID = 'a9081001-17c4-4e70-8c24-174219c76510';
export const STRAIN_LABELS = Object.freeze(['Strain7', 'Strain8', 'Strain5', 'Strain6', 'Strain3', 'Strain4', 'Strain1', 'Strain2']);

export function decodePacket(view) {
  if (!(view instanceof DataView) || view.byteLength !== 20) throw new Error('Expected a 20-byte telemetry packet.');
  const type = view.getUint8(0) & 15;
  const version = view.getUint8(0) >> 4;
  const flags = view.getUint8(1);
  if (version !== 1 || type < 1 || type > 3 || flags & 0xf0) throw new Error('Invalid telemetry header. Expected Course Corrector BLE v1.');
  const seq = view.getUint16(2, true);
  const vector = (offset, scale) => Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, view.getInt16(offset + 2 * i, true) / scale]));
  if (type === 1) return { type, flags, seq, adc: flags & 1 ? Array.from({ length: 8 }, (_, i) => view.getInt16(4 + 2 * i, true)) : null };
  if (type === 2) return { type, flags, seq, uptimeMs: view.getUint32(4, true), accel: flags & 2 ? vector(8, 100) : null, gyro: flags & 4 ? vector(14, 10) : null };
  return { type, flags, seq, benchmark: flags & 8 ? { sps: view.getUint32(4, true), valid: view.getUint32(8, true), errors: view.getUint32(12, true), ageMs: view.getUint32(16, true) } : null };
}

// Emit only complete snapshots with matching sequence and flags; never mix readings.
export function createAssembler(onSample, onStats = () => {}, onInvalid = () => {}) {
  let pending = null, lastSeq = null, good = 0, missing = 0, invalid = 0;
  const report = () => onStats({ good, missing, invalid });
  return view => {
    let packet;
    try { packet = decodePacket(view); }
    catch (error) { ++invalid; onInvalid(error.message); report(); return; }
    if (!pending || pending.seq !== packet.seq) {
      if (lastSeq !== null) {
        const step = (packet.seq - lastSeq + 65536) % 65536;
        if (step === 0 || step >= 32768) return; // Duplicate or stale sequence.
        missing += step - 1;
      }
      if (pending && !pending.complete) ++missing;
      pending = { seq: packet.seq, flags: packet.flags, parts: {}, complete: false };
      lastSeq = packet.seq;
    }
    if (pending.flags !== packet.flags) {
      ++invalid;
      onInvalid('Snapshot flags disagree. Waiting for a complete matching snapshot.');
      report();
      return;
    }
    if (pending.complete || pending.parts[packet.type]) return;
    pending.parts[packet.type] = packet;
    const { 1: adc, 2: motion, 3: rate } = pending.parts;
    if (adc && motion && rate) {
      pending.complete = true;
      ++good;
      onSample({ seq: packet.seq, uptimeMs: motion.uptimeMs, adc: adc.adc, accel: motion.accel, gyro: motion.gyro, benchmark: rate.benchmark });
    }
    report();
  };
}

export function bluetoothSupport(environment = globalThis) {
  if (!environment.isSecureContext) return 'Bluetooth needs HTTPS or localhost. Open the app on a secure address.';
  if (!environment.navigator?.bluetooth?.requestDevice) {
    return 'Web Bluetooth is unavailable here. Open this app in Chrome or Edge on Windows with Bluetooth enabled.';
  }
  return '';
}

function connectionError(error, stage) {
  if (error.name === 'NotFoundError' && stage === 'choosing') return 'No ESP32 selected. Click Connect ESP32 to try again.';
  if (error.name === 'NotFoundError') return 'The ESP32 is missing the required BLE service or telemetry characteristic. Check the firmware UUIDs.';
  if (error.name === 'SecurityError' || error.name === 'NotAllowedError') return 'Bluetooth permission was blocked. Allow Bluetooth for this site and open it directly in Chrome or Edge.';
  if (error.name === 'NetworkError') return 'The ESP32 could not be reached. Keep it nearby, enable Bluetooth, and close other apps connected to it.';
  return error.message || 'Bluetooth connection failed. Try reconnecting the ESP32.';
}

// A single firmware target. Transport state lives outside React for lifecycle testing.
export class ClubBluetooth {
  constructor(environment = globalThis) {
    this.environment = environment;
    this.listeners = new Set();
    this.attempt = null;
    this.rememberedDevice = null;
    this.publishTimer = null;
    this.state = {
      status: 'disconnected', deviceName: '', error: '', notice: '', canReconnect: false,
      sample: null, stats: { good: 0, missing: 0, invalid: 0 }, lastReceivedAt: null, protocolError: '',
    };
  }

  getSnapshot = () => this.state;
  subscribe = listener => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  publish = () => {
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    for (const listener of this.listeners) listener();
  };
  update(patch, throttle = false) {
    this.state = { ...this.state, ...patch };
    if (!throttle) this.publish();
    else if (!this.publishTimer) this.publishTimer = setTimeout(this.publish, 100);
  }

  release(attempt) {
    if (!attempt) return;
    attempt.telemetry?.removeEventListener('characteristicvaluechanged', attempt.onValue);
    attempt.device?.removeEventListener('gattserverdisconnected', attempt.onDisconnect);
    // A cancelled attempt completing late must not disconnect a newer one to this device.
    if (this.attempt?.device !== attempt.device && attempt.device?.gatt?.connected) attempt.device.gatt.disconnect();
  }

  disconnect = (notice = 'ESP32 disconnected.') => {
    const attempt = this.attempt;
    this.attempt = null;
    this.release(attempt);
    this.update({ status: 'disconnected', sample: null, lastReceivedAt: null, error: '', protocolError: '', notice });
  };

  dispose = () => {
    this.disconnect('');
    clearTimeout(this.publishTimer);
  };

  connect = async (reuse = false) => {
    if (this.attempt) return;
    const unsupported = bluetoothSupport(this.environment);
    if (unsupported) { this.update({ error: unsupported }); return; }
    const attempt = {};
    this.attempt = attempt;
    let stage = reuse && this.rememberedDevice ? 'connecting' : 'choosing';
    this.update({ status: stage, error: '', notice: '', protocolError: '', sample: null,
      stats: { good: 0, missing: 0, invalid: 0 }, lastReceivedAt: null });
    const current = () => this.attempt === attempt;
    try {
      // Invoke the chooser before any await to preserve the button's user activation.
      attempt.device = stage === 'connecting' ? this.rememberedDevice
        : await this.environment.navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
      if (!current()) return;
      this.rememberedDevice = attempt.device;
      stage = 'connecting';
      this.update({ status: stage, deviceName: attempt.device.name || 'Course Corrector ESP32', canReconnect: true });
      attempt.onDisconnect = () => {
        if (current()) this.disconnect('Connection lost. Power on the ESP32 and click Reconnect ESP32.');
      };
      attempt.device.addEventListener('gattserverdisconnected', attempt.onDisconnect);
      const server = await attempt.device.gatt.connect();
      if (!current()) return;
      const service = await server.getPrimaryService(SERVICE_UUID);
      if (!current()) return;
      attempt.telemetry = await service.getCharacteristic(TELEMETRY_UUID);
      if (!current()) return;
      if (!attempt.telemetry.properties.notify) throw new Error('The ESP32 telemetry characteristic must support notifications.');
      const accept = createAssembler(
        sample => this.update({ sample, lastReceivedAt: Date.now(), protocolError: '' }, true),
        stats => this.update({ stats }, true),
        protocolError => this.update({ protocolError }, true),
      );
      attempt.onValue = event => { if (current()) accept(event.target.value); };
      attempt.telemetry.addEventListener('characteristicvaluechanged', attempt.onValue);
      await attempt.telemetry.startNotifications();
      if (!current()) return;
      if (!attempt.device.gatt.connected) throw new Error('BLE disconnected during setup. Try reconnecting the ESP32.');
      this.update({ status: 'connected', notice: 'ESP32 connected. Listening for automatic 10 Hz diagnostic snapshots.' });
    } catch (error) {
      if (!current()) return;
      this.attempt = null;
      this.release(attempt);
      this.update({ status: 'disconnected', error: connectionError(error, stage), sample: null, lastReceivedAt: null });
    } finally {
      if (!current()) this.release(attempt);
    }
  };
}
