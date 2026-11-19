# ESP32 Bluetooth

The dashboard now targets only the already-flashed **Course Corrector BLE v1**
board, using the contract supplied in `bluetoothService.js` and
`BluetoothPanel.jsx`. The previous demo, ADXL345 starter and MPU6050 client
connection paths have been removed. There is no firmware selector, raw-text
fallback or command characteristic.

## Connect

1. Power on the ESP32 with its existing firmware.
2. Run `npm run dev` and open the localhost URL in Chrome or Edge on Windows,
   with Bluetooth enabled. A hosted version needs HTTPS.
3. In **Smart club**, click **Connect ESP32** and select the board. The chooser
   filters by the service below; its display name is not used as an identifier.
4. Notifications start automatically after subscription. **Receiving** means a
   complete three-part snapshot has arrived. A connected radio by itself does
   not establish that any sensor is valid.
5. Use **Disconnect ESP32** or **Reconnect ESP32** as needed. Reconnect remembers
   only the device selected in this page session; reloading requires the chooser.

## GATT contract

| Item | UUID | Required property |
| --- | --- | --- |
| Advertised service | `a9081000-17c4-4e70-8c24-174219c76510` | Primary service |
| Telemetry | `a9081001-17c4-4e70-8c24-174219c76510` | Notify |

The GUI subscribes to telemetry without sending start, stop or sample commands.
The flashed firmware supplies approximately **10 snapshots per second**, each
consisting of **three 20-byte notifications**. These are diagnostic snapshots,
not the full ADC waveform.

All multibyte fields are little-endian. Each packet starts with:

| Offset | Format | Meaning |
| --- | --- | --- |
| 0 | uint8 | High nibble: version 1. Low nibble: packet type 1, 2 or 3 (`0x11`, `0x12`, `0x13`). |
| 1 | uint8 | Validity flags: bit 0 ADC, bit 1 acceleration, bit 2 gyroscope, bit 3 benchmark. Upper bits must be zero. |
| 2–3 | uint16 | Snapshot sequence; wraps at 65535. |

The remaining fields depend on packet type:

| Type | Offsets | Content |
| --- | --- | --- |
| 1: ADC | 4–19 | Eight signed int16 ADC codes in AIN1–AIN8 order. |
| 2: Motion | 4–7 | uint32 ESP32 uptime in milliseconds. |
| 2: Motion | 8, 10, 12 | Signed int16 acceleration X/Y/Z; divide by 100 for g. |
| 2: Motion | 14, 16, 18 | Signed int16 gyroscope X/Y/Z; divide by 10 for °/s. |
| 3: Benchmark | 4, 8, 12, 16 | Four uint32 values: samples/sec/channel, valid count, error count, benchmark age in milliseconds. |

AIN1–AIN8 map to **Strain7, Strain8, Strain5, Strain6, Strain3, Strain4,
Strain1, Strain2**. Approximate voltage is `raw × 5 / 32768`, assuming a nominal
±5 V range. This is not a calibrated strain or force measurement.

## Snapshot integrity and display

- All three parts must have the same sequence and flags before the GUI displays
  them. Arrival order within a snapshot does not matter.
- Invalid lengths, headers and inconsistent flags are counted as invalid packets.
  Duplicate parts and older sequences are ignored.
- Complete snapshots, skipped sequences and observed incomplete snapshots are
  counted separately from invalid packets. An unfinished snapshot is counted
  missing when a newer sequence arrives. Loss before the first observed sequence
  or after the last notification cannot be inferred.
- Missing sensors are shown as — according to their individual validity flags.
- After two seconds without a complete snapshot, telemetry is marked **Stalled**
  and live readings are hidden. Partial, duplicate or invalid packets do not
  refresh the reading timestamp.
- Benchmark rate is the last measured benchmark, not BLE throughput. Its displayed
  age is the firmware-reported age at the snapshot.
- Disconnect clears readings. Every connection attempt starts a new assembler
  and resets counters. There is no automatic reconnect loop.
- Swing metrics and the impact map remain separate simulated data.

## Troubleshooting

If the chooser is empty, verify that the board is powered and advertising the
service above, and that another phone, app or browser tab has not occupied its
connection. The filter identifies this firmware; if multiple boards advertise
the same service, select the intended board in the chooser.

If service discovery fails, check the UUIDs against the flashed sketch. Browser
or OS GATT caches may need refreshing after a firmware change. Remove the site's
device permission, power cycle the board and choose it again.

If connected but waiting or stalled, inspect the board's Serial Monitor and
verify that all three notification types use matching sequences and flags.
The GUI cannot request a snapshot through this protocol.

The Arduino sketch flashed in the earlier conversation is not included in this
repository. The supplied JavaScript contract is the integration reference; the
retired demo/client sketches have been removed to avoid using the wrong firmware.

## Validation

Run `npm test`, `npm run lint` and `npm run build`. Optional Chrome UI checks:

```powershell
node tests/bluetooth-browser.mjs
```

The UI check uses Playwright from the existing ignored `.camera-check.local`
folder and system Chrome. Tests simulate GATT and verify parsing, assembly,
connection cleanup, reconnects and telemetry presentation. Physical radio
delivery still requires a connection to the flashed ESP32.
