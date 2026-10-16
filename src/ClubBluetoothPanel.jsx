import { useEffect, useState } from 'react';
import { CLUB_PROFILES } from './clubBluetooth';

export function ClubBluetoothPanel({ club }) {
  const [now, setNow] = useState(() => Date.now());
  const connected = club.status === 'connected';
  const starter = club.profile === 'adxl345';
  const pending = ['choosing', 'connecting'].includes(club.status);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connected]);
  const age = club.lastReceivedAt ? Math.max(0, Math.floor((now - club.lastReceivedAt) / 1000)) : null;
  const stale = age !== null && age >= 3;
  const sample = club.sample;
  const sensorLabel = !sample ? 'Waiting for telemetry' : starter ? 'Starter notifications (unparsed)' : sample.demo ? 'Demo firmware data'
    : sample.sensorValid ? 'Sensor data' : 'Sensor unavailable';
  const vector = (values, digits) => sample && (sample.demo || sample.sensorValid)
    ? values.map((value) => value.toFixed(digits)).join(' / ') : '—';

  return (
    <section className="panel club-panel" aria-label="Smart club Bluetooth">
      <div className="club-heading">
        <div><p className="eyebrow">ESP32 / Bluetooth LE</p><h2>Smart club</h2></div>
        <span className={`badge ${connected ? 'badge-live' : 'badge-neutral'}`} role="status">
          <i />{connected ? `Connected · ${club.deviceName}` : pending ? 'Connecting…' : 'Disconnected'}
        </span>
        <div className="club-actions">
          <label className="club-profile">Device firmware
            <select value={club.profile} disabled={connected || pending} onChange={(event) => club.setProfile(event.target.value)}>
              {Object.entries(CLUB_PROFILES).map(([id, profile]) => <option key={id} value={id}>{profile.label}</option>)}
            </select>
          </label>
          {connected || pending ? (
            <button className="secondary-button" onClick={() => club.disconnect(pending ? 'Connection cancelled. Close the Bluetooth chooser if it is still open.' : undefined)}>
              {pending ? 'Cancel connection' : 'Disconnect club'}
            </button>
          ) : <>
            {club.canReconnect && <button className="secondary-button" disabled={!!club.supportError} onClick={() => club.connect(true)}>Reconnect club</button>}
            <button className="primary-button" disabled={!!club.supportError} onClick={() => club.connect()}>{club.canReconnect ? 'Choose club' : 'Connect club'}</button>
          </>}
          {!starter && <>
          <button className="secondary-button" disabled={!connected || club.commandPending} onClick={() => club.sendCommand('start')}>Start stream</button>
          <button className="secondary-button" disabled={!connected || club.commandPending} onClick={() => club.sendCommand('stop')}>Stop stream</button>
          <button className="secondary-button" disabled={!connected || club.commandPending} onClick={() => club.sendCommand('ping')}>Request sample</button>
          </>}
        </div>
      </div>
      {club.supportError && <p className="club-warning" role="status">{club.supportError}</p>}
      {club.error && <p className="club-warning" role="alert">{club.error}</p>}
      {club.notice && <p className="club-note" role="status">{club.notice}</p>}
      {starter && <p className="club-note">Connect to the sensor’s BLE server. The supplied ESP32 client sketch only receives data and will not appear in this chooser. Power off that client if it is occupying the server’s connection.</p>}
      {!connected && !pending && !club.supportError && <p className="club-note">Power on your club, then select it in the browser’s Bluetooth chooser.</p>}
      {pending && <p className="club-note">{club.status === 'choosing' ? 'Select the club in the browser’s Bluetooth chooser.' : 'Discovering services and enabling notifications. Cancel and retry if the club does not respond.'}</p>}
      {connected && <details className="club-telemetry" open>
        <summary>Live telemetry · {sensorLabel}{stale ? ' · Last sample is stale' : ''}</summary>
        <div className="club-readings">
          {!starter && <>
          <div><span>Acceleration X / Y / Z (g)</span><strong>{vector(sample?.acceleration, 3)}</strong></div>
          <div><span>Gyroscope X / Y / Z (°/s)</span><strong>{vector(sample?.gyroscope, 1)}</strong></div>
          </>}
          <div><span>Packets / rejected</span><strong>{club.packets} / {club.invalidPackets}</strong></div>
          <div><span>Last received</span><strong>{age === null ? 'No samples yet' : `${age}s ago`}</strong></div>
          {!starter && <div><span>Device stream state</span><strong>{sample ? sample.streaming ? 'Streaming' : 'Stopped' : 'Unknown'}</strong></div>}
        </div>
        {starter && <div className="club-raw">
          <p className="club-note">Latest notification{sample ? ` · ${sample.byteLength} bytes` : ''}. Fields and units need verification before these can become sensor readings.</p>
          <span>Received text</span><pre>{sample?.rawText || 'Waiting for a notification…'}</pre>
          <span>Received bytes (hex)</span><pre>{sample?.rawHex || '—'}</pre>
        </div>}
        {club.protocolError && <p className="club-warning" role="alert">{club.protocolError}</p>}
        {stale && (starter || sample.streaming) && <p className="club-warning" role="status">{starter ? 'No recent notifications. Check the sensor server or reconnect the club.' : 'No recent telemetry. Request a sample or reconnect the club.'}</p>}
        <p className="club-note">Raw club readings appear here. Swing metrics and the impact map currently use simulated data.</p>
      </details>}
    </section>
  );
}
