import { useEffect, useState } from 'react';
import { STRAIN_LABELS } from './bluetoothService.js';

export default function BluetoothPanel({ club }) {
  const [now, setNow] = useState(() => Date.now());
  const connected = club.status === 'connected';
  const pending = ['choosing', 'connecting'].includes(club.status);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [connected]);
  const ageMs = club.lastReceivedAt === null ? null : Math.max(0, now - club.lastReceivedAt);
  const stale = ageMs !== null && ageMs >= 2000;
  const data = connected && !stale ? club.sample : null;
  const telemetryStatus = !connected ? 'Offline' : stale ? 'Stalled' : data ? 'Receiving' : 'Waiting for snapshots';
  const vector = values => values ? ['x', 'y', 'z'].map(axis => values[axis].toFixed(2)).join(' / ') : '—';

  return (
    <section className="panel club-panel" aria-label="Smart club Bluetooth">
      <div className="club-heading">
        <div><p className="eyebrow">ESP32 / Bluetooth LE</p><h2>Smart club</h2></div>
        <span className={`badge ${connected ? 'badge-live' : 'badge-neutral'}`} role="status">
          <i />{connected ? `Connected · ${club.deviceName}` : pending ? 'Connecting…' : 'Disconnected'}
        </span>
        <div className="club-actions">
          {connected || pending ? (
            <button className="secondary-button" onClick={() => club.disconnect(pending ? 'Connection cancelled. Close the Bluetooth chooser if it is still open.' : undefined)}>
              {pending ? 'Cancel connection' : 'Disconnect ESP32'}
            </button>
          ) : <>
            {club.canReconnect && <button className="secondary-button" disabled={!!club.supportError} onClick={() => club.connect(true)}>Reconnect ESP32</button>}
            <button className="primary-button" disabled={!!club.supportError} onClick={() => club.connect()}>{club.canReconnect ? 'Choose ESP32' : 'Connect ESP32'}</button>
          </>}
        </div>
      </div>
      <p className="club-note">Course Corrector BLE v1 · Telemetry: <strong>{telemetryStatus}</strong></p>
      {club.supportError && <p className="club-warning" role="status">{club.supportError}</p>}
      {club.error && <p className="club-warning" role="alert">{club.error}</p>}
      {club.notice && <p className="club-note" role="status">{club.notice}</p>}
      {!connected && !pending && !club.supportError && <p className="club-note">Power on the flashed ESP32, then select it in the browser’s Bluetooth chooser.</p>}
      {pending && <p className="club-note">{club.status === 'choosing' ? 'Select the ESP32 in the browser’s Bluetooth chooser.' : 'Discovering the ESP32 service and enabling notifications. Cancel and retry if the board does not respond.'}</p>}
      {connected && <details className="club-telemetry" open>
        <summary>Live telemetry · {telemetryStatus}</summary>
        <div className="club-readings">
          <div><span>Acceleration X / Y / Z (g)</span><strong>{vector(data?.accel)}</strong></div>
          <div><span>Gyroscope X / Y / Z (°/s)</span><strong>{vector(data?.gyro)}</strong></div>
          <div><span>Complete snapshots</span><strong>{club.stats.good}</strong></div>
          <div><span>Missing / incomplete observed</span><strong>{club.stats.missing}</strong></div>
          <div><span>Invalid packets</span><strong>{club.stats.invalid}</strong></div>
          <div><span>Last complete snapshot</span><strong>{ageMs === null ? 'No samples yet' : `${(ageMs / 1000).toFixed(1)}s ago`}</strong></div>
          <div><span>Sequence</span><strong>{data?.seq ?? '—'}</strong></div>
          <div><span>ESP32 uptime (ms)</span><strong>{data?.uptimeMs ?? '—'}</strong></div>
        </div>
        <div className="club-strain-table">
          <table aria-label="Strain gauge readings">
            <thead><tr><th scope="col">ADC</th><th scope="col">Strain gauge</th><th scope="col">Raw code</th><th scope="col">Approx. V</th></tr></thead>
            <tbody>{STRAIN_LABELS.map((label, i) => <tr key={label}>
              <th scope="row">AIN{i + 1}</th><td>{label}</td><td>{data?.adc?.[i] ?? '—'}</td><td>{data?.adc ? (data.adc[i] * 5 / 32768).toFixed(4) : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="club-readings">
          <div><span>Last measured ADC benchmark</span><strong>{data?.benchmark ? `${(data.benchmark.sps / 1000).toFixed(3)} kSPS/channel` : 'Not available'}</strong></div>
          <div><span>Benchmark age at snapshot</span><strong>{data?.benchmark ? `${(data.benchmark.ageMs / 1000).toFixed(1)} s` : '—'}</strong></div>
          <div><span>Benchmark valid / errors</span><strong>{data?.benchmark ? `${data.benchmark.valid} / ${data.benchmark.errors}` : '—'}</strong></div>
        </div>
        {club.protocolError && <p className="club-warning" role="alert">{club.protocolError}</p>}
        {stale && <p className="club-warning" role="status">No complete snapshot for two seconds. Check the ESP32 or reconnect.</p>}
        <p className="club-note">10 Hz diagnostic snapshots, not the full ADC waveform. Voltage assumes a nominal ±5 V range. Unavailable or stale readings are shown as —.</p>
        <p className="club-note">Swing metrics and the impact map currently use simulated data.</p>
      </details>}
    </section>
  );
}
