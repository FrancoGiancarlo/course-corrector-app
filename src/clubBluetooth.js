// Keep these UUIDs and the packet layout in sync with firmware/CourseCorrectorBLE.
export const CLUB_SERVICE = '7b183000-9168-443e-a927-7aeea07e8105';
export const TELEMETRY_CHARACTERISTIC = '7b183001-9168-443e-a927-7aeea07e8105';
export const COMMAND_CHARACTERISTIC = '7b183002-9168-443e-a927-7aeea07e8105';
export const CLUB_COMMANDS = Object.freeze({ start: 1, stop: 2, ping: 3 });
export const STARTER_SERVICE = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const STARTER_CHARACTERISTIC = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const CLUB_PROFILES = Object.freeze({
  courseCorrector: Object.freeze({ label: 'Course Corrector firmware', service: CLUB_SERVICE,
    telemetry: TELEMETRY_CHARACTERISTIC, command: COMMAND_CHARACTERISTIC }),
  adxl345: Object.freeze({ label: 'ADXL345 starter server', service: STARTER_SERVICE,
    telemetry: STARTER_CHARACTERISTIC, command: null }),
});

// The supplied client prints bytes as text but specifies neither fields nor units.
// Preserve both views; do not invent acceleration/rotation from an unknown payload.
export function decodeStarterNotification(value) {
  if (!(value instanceof DataView) || value.byteLength < 1 || value.byteLength > 512) {
    throw new Error('Expected a starter notification containing 1–512 bytes.');
  }
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return {
    rawText: Array.from(new TextDecoder().decode(bytes), (character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127
        ? `\\x${code.toString(16).padStart(2, '0')}` : character;
    }).join(''),
    rawHex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' '),
    byteLength: bytes.length,
  };
}

export function bluetoothSupport(environment = globalThis) {
  if (!environment.isSecureContext) return 'Bluetooth needs HTTPS or localhost. Open the app on a secure address.';
  if (!environment.navigator?.bluetooth?.requestDevice) {
    return 'Web Bluetooth is unavailable here. Open this app in Chrome or Edge on Windows with Bluetooth enabled.';
  }
  return '';
}

export function decodeTelemetry(value) {
  if (!(value instanceof DataView) || value.byteLength !== 20) throw new Error('Expected a 20-byte telemetry packet.');
  if (value.getUint8(0) !== 1) throw new Error('Unsupported telemetry version. Expected version 1.');
  const flags = value.getUint8(1);
  if (flags & ~7) throw new Error('Unknown telemetry flags. Check the firmware protocol.');
  return {
    demo: Boolean(flags & 1), streaming: Boolean(flags & 2), sensorValid: Boolean(flags & 4),
    sequence: value.getUint16(2, true), deviceTimeMs: value.getUint32(4, true),
    acceleration: [8, 10, 12].map((offset) => value.getInt16(offset, true) / 1000),
    gyroscope: [14, 16, 18].map((offset) => value.getInt16(offset, true) / 10),
  };
}

function connectionError(error, stage) {
  if (error.name === 'NotFoundError' && stage === 'choosing') return 'No club selected. Click Connect club to try again.';
  if (error.name === 'NotFoundError') return 'The club is missing the required BLE service or characteristics. Check the firmware UUIDs.';
  if (error.name === 'SecurityError' || error.name === 'NotAllowedError') return 'Bluetooth permission was blocked. Allow Bluetooth for this site and open it directly in Chrome or Edge.';
  if (error.name === 'NetworkError') return 'The club could not be reached. Keep it nearby, enable Bluetooth, and close other apps connected to it.';
  return error.message || 'Bluetooth connection failed. Try reconnecting the club.';
}

// The transport lives outside React so lifecycle races and packet handling can be tested without hardware.
export class ClubBluetooth {
  constructor(environment = globalThis) {
    this.environment = environment;
    this.listeners = new Set();
    this.attempt = null;
    this.rememberedDevice = null;
    this.publishTimer = null;
    this.state = {
      status: 'disconnected', deviceName: '', error: '', notice: '',
      canReconnect: false, commandPending: false, sample: null, packets: 0,
      invalidPackets: 0, lastReceivedAt: null, protocolError: '',
      profile: 'courseCorrector',
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener) => {
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
    // A late completion from a cancelled attempt must not disconnect a newer attempt to the same device.
    if (this.attempt?.device !== attempt.device && attempt.device?.gatt?.connected) attempt.device.gatt.disconnect();
  }

  disconnect = (notice = 'Club disconnected.') => {
    const attempt = this.attempt;
    this.attempt = null;
    this.release(attempt);
    this.update({ status: 'disconnected', commandPending: false, sample: null,
      lastReceivedAt: null, error: '', protocolError: '', notice });
  };

  dispose = () => {
    this.disconnect('');
    clearTimeout(this.publishTimer);
  };

  setProfile = (profile) => {
    if (!Object.hasOwn(CLUB_PROFILES, profile)) throw new Error('Unknown club profile.');
    if (this.attempt || profile === this.state.profile) return;
    this.rememberedDevice = null;
    this.update({ profile, canReconnect: false, deviceName: '', sample: null,
      packets: 0, invalidPackets: 0, lastReceivedAt: null, error: '', notice: '', protocolError: '' });
  };

  connect = async (reuse = false) => {
    if (this.attempt) return;
    const unsupported = bluetoothSupport(this.environment);
    if (unsupported) { this.update({ error: unsupported }); return; }
    const attempt = {};
    const profile = CLUB_PROFILES[this.state.profile];
    this.attempt = attempt;
    let stage = reuse && this.rememberedDevice ? 'connecting' : 'choosing';
    this.update({ status: stage, error: '', notice: '', protocolError: '', sample: null,
      packets: 0, invalidPackets: 0, lastReceivedAt: null, commandPending: false });
    const current = () => this.attempt === attempt;
    try {
      // Invoke the chooser before any await to preserve the button's user activation.
      attempt.device = stage === 'connecting' ? this.rememberedDevice
        : await this.environment.navigator.bluetooth.requestDevice({ filters: [{ services: [profile.service] }] });
      if (!current()) return;
      this.rememberedDevice = attempt.device;
      stage = 'connecting';
      this.update({ status: stage, deviceName: attempt.device.name || 'Course Corrector club', canReconnect: true });
      attempt.onDisconnect = () => {
        if (current()) this.disconnect('Connection lost. Power on the club and click Reconnect club.');
      };
      attempt.device.addEventListener('gattserverdisconnected', attempt.onDisconnect);
      const server = await attempt.device.gatt.connect();
      if (!current()) return;
      const service = await server.getPrimaryService(profile.service);
      if (!current()) return;
      attempt.telemetry = await service.getCharacteristic(profile.telemetry);
      if (!current()) return;
      if (profile.command) {
        attempt.command = await service.getCharacteristic(profile.command);
        if (!current()) return;
      }
      if (!attempt.telemetry.properties.notify || (profile.command && !attempt.command.properties.write)) {
        throw new Error(profile.command
          ? 'Firmware must support telemetry notifications and command writes with response.'
          : 'The starter server characteristic must support notifications.');
      }
      attempt.onValue = (event) => {
        if (!current()) return;
        try {
          const sample = profile.command ? decodeTelemetry(event.target.value) : decodeStarterNotification(event.target.value);
          this.update({ sample, packets: this.state.packets + 1, lastReceivedAt: Date.now(), protocolError: '' }, true);
        } catch (error) {
          this.update({ invalidPackets: this.state.invalidPackets + 1, protocolError: error.message }, true);
        }
      };
      attempt.telemetry.addEventListener('characteristicvaluechanged', attempt.onValue);
      await attempt.telemetry.startNotifications();
      if (!current()) return;
      this.update({ status: 'connected', notice: profile.command
        ? 'Club connected. Start the stream or request a sample.'
        : 'Starter server connected. Listening for notifications; sending is controlled by its firmware.' });
    } catch (error) {
      if (!current()) return;
      this.attempt = null;
      this.release(attempt);
      this.update({ status: 'disconnected', error: connectionError(error, stage), sample: null, lastReceivedAt: null });
    } finally {
      if (!current()) this.release(attempt);
    }
  };

  sendCommand = async (name) => {
    if (!Object.hasOwn(CLUB_COMMANDS, name)) throw new Error('Unknown club command.');
    const attempt = this.attempt;
    if (this.state.status !== 'connected' || !attempt?.command || this.state.commandPending) return;
    this.update({ commandPending: true, error: '', notice: '' });
    try {
      await attempt.command.writeValueWithResponse(Uint8Array.of(CLUB_COMMANDS[name]));
      if (this.attempt !== attempt) return;
      this.update({ notice: `${({ start: 'Start stream', stop: 'Stop stream', ping: 'Request sample' })[name]} sent to club. Check telemetry below for the device state.` });
    } catch (error) {
      if (this.attempt === attempt) this.update({ error: connectionError(error, 'writing') });
    } finally {
      if (this.attempt === attempt) this.update({ commandPending: false });
    }
  };
}
