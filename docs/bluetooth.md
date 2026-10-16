# ESP32 smart club connection

## Integrating the supplied ADXL345 client starter

The supplied [`BLE_Client_Test_Current.ino`](../firmware/BLE_Client_Test_Current/BLE_Client_Test_Current.ino)
is preserved unchanged for reference. It is a **receiver (BLE central/client)**:
it scans for a separate server, subscribes to notifications, and prints `Received:`
followed by the payload to USB Serial at **115200 baud**. It does not read an
ADXL345 locally, advertise a GATT service, or forward readings to this app.
Changing its UUIDs alone will not make it a server.

The app can now perform the same receiver role directly:

```text
ADXL345 + BLE server board  --BLE notifications-->  Chrome/Edge app
```

1. Power on the separate sensor/server board that the starter was intended to
   connect to. Keep its existing server firmware. Power off the starter client
   board if it occupies the server's available connection.
2. Run `npm run dev` and open the localhost address in Chrome or Edge with
   Bluetooth enabled (or serve the app over HTTPS).
3. In **Smart club → Device firmware**, choose **ADXL345 starter server**.
4. Click **Connect club** and choose the sensor server. The chooser filters by
   service UUID, so the board's advertised name may differ from the sketch's name.
5. Watch **Received text** and **Received bytes (hex)**. Notifications start when
   the server firmware sends them. Start/stop/request buttons are hidden because
   the supplied sketch defines no command characteristic.
6. On disconnection, use **Reconnect club**. Disconnect before changing firmware
   profiles; changing profiles clears the remembered device and readings.

| Item | UUID |
| --- | --- |
| Advertised service | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Notification characteristic | `beb5483e-36e1-4688-b7f5-ea07361b26a8` |

This mode keeps only the latest notification (text plus exact hex bytes), counters,
and receive time. Each notification is shown separately; fragmented messages are
not reassembled. Text is decoded as UTF-8, with control bytes escaped and invalid
UTF-8 replaced for display; hex preserves the original payload. Empty packets and
payloads over 512 bytes are rejected. Readings become stale after three seconds.

The starter does not define payload fields, units, scaling, or framing. A few real
`Received:` lines or the **server sketch** are needed before mapping these bytes
to acceleration. No gyroscope, speed, or impact values are inferred from them.

**If you only have one ESP32 running the supplied client:** it will not appear in
the app's chooser because it is scanning, not advertising. Use the existing
Course Corrector demo server below to test that board with the app, or provide the
sensor wiring/server sketch so its firmware can be adapted for actual readings.
The demo produces synthetic data and does not read your ADXL345.

The original client also creates a new client/callback on each connection attempt
and replaces its saved advertised-device allocation without freeing it. It is
retained as supplied, not validated as a long-running receiver.

The application tests cover both UUID profiles, raw payload preservation, missing
notification support, reconnect, profile switching, and existing binary commands.
Physical BLE delivery still requires testing with your board.

## Course Corrector demo firmware

The web app is a BLE central/client; the Course Corrector ESP32-WROOM-32 firmware is a BLE
peripheral/GATT server. This starter contract is defined by this project, not by
the ESP32 board itself. Firmware must implement it before the app can connect.
Use the ESP32 BLE library, not `BluetoothSerial` (Bluetooth Classic SPP).

## First connection on Windows

1. Open the existing app in current Chrome or Microsoft Edge. Run `npm run dev`
   and use the localhost URL printed by Vite. For another computer/tablet, serve
   the app over HTTPS; a plain `http://192.168...` LAN URL is not a secure context.
   Open the app directly, not in a restricted embedded preview.
2. Enable Windows Bluetooth and power the ESP32. In Arduino IDE, install the
   **esp32 by Espressif Systems** board package and select the board matching your
   WROOM-32 development board (often **ESP32 Dev Module**). Open and upload
   [`CourseCorrectorBLE.ino`](../firmware/CourseCorrectorBLE/CourseCorrectorBLE.ino).
   The sketch uses the BLE library included with that board package; no external
   BLE library is needed. It is an unverified-on-hardware starter sketch.
3. Click **Connect club**, select **CourseCorrector**, and allow access in the
   browser chooser. OS settings pairing is not normally necessary.
4. Click **Request sample** to verify a notification; **Start stream** requests
   demo packets at 20 Hz. **Stop stream** requests a final status sample and stops
   periodic notifications. The dashboard labels these packets **Demo firmware data**.
5. Turn off the ESP32 to test connection loss, turn it back on, then use
   **Reconnect club**. **Choose club** opens the chooser for a different board.

The ESP32-WROOM-32 module does not supply accelerometer/gyroscope measurements
by itself. Connect your chosen external sensor and replace the sketch's demo
values when implementing the IMU firmware. Raw telemetry does not yet produce
club speed, impact location, or automatic swing recordings. The existing swing
simulation and camera recording controls are independent of the BLE transport.

Saved videos are scoped to a browser profile and origin. Download important videos
from your old browser before switching; they do not automatically appear in Chrome.

## GATT contract (v1)

| Item | UUID | Properties |
| --- | --- | --- |
| Service (include in advertising) | `7b183000-9168-443e-a927-7aeea07e8105` | Primary service |
| Telemetry, ESP32 → app | `7b183001-9168-443e-a927-7aeea07e8105` | Notify, CCCD `0x2902` |
| Commands, app → ESP32 | `7b183002-9168-443e-a927-7aeea07e8105` | Write with response |

The chooser filters by the advertised service, not by name. The app subscribes to
notifications before enabling command buttons. All GATT operations are sequential;
command buttons disable while a write is pending. A successful write only confirms
GATT delivery. Stream state comes from telemetry, not from assuming a command worked.

### Commands

One binary byte per write (not a string or JSON): `0x01` starts streaming, `0x02`
stops streaming, and `0x03` requests one sample without changing stream state.
Send a telemetry packet in response to each accepted command, including stop.
Start/stop are idempotent. Start each connection with streaming disabled.

### Telemetry

One complete **20-byte** binary packet per notification. All multibyte fields are
**little-endian**. This fits the 20-byte notification payload at the default ATT
MTU of 23, so the protocol does not require MTU negotiation or fragmentation.

| Byte offset | Type | Meaning |
| --- | --- | --- |
| 0 | uint8 | Protocol version, always `1` |
| 1 | uint8 | Flags: bit 0 = demo data; bit 1 = streaming; bit 2 = valid sensor reading. Other bits must be zero. |
| 2–3 | uint16 | Packet sequence, wraps at 65535 |
| 4–7 | uint32 | Device uptime in milliseconds, wraps like Arduino `millis()` |
| 8–9, 10–11, 12–13 | 3 × int16 | Acceleration X/Y/Z in milli-g; app divides by 1000 for g |
| 14–15, 16–17, 18–19 | 3 × int16 | Gyroscope X/Y/Z in 0.1°/s; app divides by 10 for °/s |

For real readings, clear DEMO and set SENSOR_VALID; when no valid reading is
available, clear both and the app hides the vector values. Firmware must clamp
values to int16 bounds rather than allowing overflow. Axes are sensor-local;
mounting orientation and calibration are future sensor integration work.

Example demo packet, streaming, sequence 42, uptime 1000 ms, acceleration
`[-0.1, 0, 1] g` and gyroscope `[0, 0, 0] °/s`:

```text
01 03 2a 00 e8 03 00 00 9c ff 00 00 e8 03 00 00 00 00 00 00
```

Incorrect lengths, versions, or reserved flags are rejected and counted without
replacing the last valid reading. The app retains only the latest sample and
session counters, publishing changes to the UI at most every 100 ms for incoming
telemetry. After three seconds without a valid packet, readings are marked stale.
Packet counters reset on each connection attempt. They count notifications, not
unique sequences; loss estimation, retransmission and data logging are not included.

## Lifecycle and troubleshooting

- Connections require a user click. Reconnect reuses the selected device only
  within the current page session; a reload requires the chooser again.
- Disconnect, connection loss and component unmount remove notification handlers
  and release the GATT connection. Cancelled connection attempts cannot update the
  new session. The browser chooser itself must be dismissed in the browser.
- No automatic reconnect loop runs. If connection setup stalls, cancel and retry.
- Empty chooser: check that the firmware advertises the service UUID, the radio is
  enabled, and no other phone/app/tab has the board connected.
- Service discovery error: match all three UUIDs and the characteristic properties.
  After changing GATT layout, the OS/browser may cache old services; remove the
  device permission, power cycle the board and select it again.
- Connected with no packets: request a sample, check Arduino Serial Monitor and
  ensure firmware sends notifications with a CCCD. A connected radio alone does
  not imply the IMU is working.
- Support varies by browser **and OS**. Chromium branding alone is insufficient.
  The app checks the API and secure context at runtime. Chrome's documentation
  covers Windows, macOS, ChromeOS and Android support and Linux caveats.

## Checks

`npm test` includes packet validation and mocked BLE lifecycle/command tests.
`npm run lint` and `npm run build` check integration. Optional Chromium UI checks
use the existing locally installed Playwright and system Chrome:

```powershell
node tests/bluetooth-browser.mjs
```

These tests simulate GATT; they do not establish a radio connection. Complete the
first-connection steps above on a physical ESP32 to validate firmware, driver,
browser chooser, notification delivery and real disconnection behavior.

References: [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth),
[Espressif Arduino BLE documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ble.html).
