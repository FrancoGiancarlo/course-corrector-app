# Course Corrector Web App

This repository contains the touchscreen web dashboard for the Course Corrector golf training system.

The product concept combines:

- A motion-sensing golf club
- An embedded computing device with a touchscreen display
- An external high-speed camera with vision processing
- A coaching dashboard for swing feedback, strike location, and session insights

## What this app now emphasizes

- Live session readiness across hardware components
- Club-face impact heatmap visualization
- Swing performance metrics that feel useful at a glance
- Actionable coaching prompts instead of filler UI
- A more polished, premium training-bay presentation

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## ESP32 Bluetooth

For the supplied **BLE_Client_Test_Current.ino**, choose **ADXL345 starter server**
in the Smart club panel and connect directly to its separate sensor/server board.
The app uses the starter's UUIDs and shows received text and hex bytes. The client
sketch itself is a receiver and will not appear in the browser chooser. See the
[starter integration steps](docs/bluetooth.md#integrating-the-supplied-adxl345-client-starter).
Payload decoding needs sample messages or the server sketch to confirm units.

Open the app in Chrome or Edge on Windows using localhost or HTTPS. The **Smart
club** panel supports choosing, connecting, disconnecting, reconnecting, starting
and stopping telemetry, and requesting a sample from an ESP32 BLE peripheral
when **Course Corrector firmware** is selected.

See [Bluetooth setup and protocol](docs/bluetooth.md) for the UUIDs, 20-byte sensor
packet format, browser requirements, and a matching Arduino IDE starter sketch.
The sketch sends explicitly labeled demo packets until you integrate your IMU.
Live sensor telemetry is separate from the existing simulated swing metrics.
Download saved videos in your previous browser before switching; browser storage
does not transfer automatically.

## Video recording benchmark

Start Camera, then select **Record 8s test**. A three-second countdown lets you get
into position before eight seconds of video are recorded and saved automatically.
**Stop & save** finishes early; stopping the camera also saves an active recording.
Cancelling during the countdown does not create a clip. This test works even when
the pose model is unavailable and does not depend on impact detection.

Open **Recent swings → View all** to play, download, or delete saved videos.
Recordings use IndexedDB and survive reloads in the same browser and site origin.
The library holds up to **10 videos**, with a **25 MB per-clip limit**; when full,
delete a video before recording another. Existing recordings are never automatically
replaced. Reset session only clears simulated metrics, keeping the video library.

The browser chooses a supported WebM or MP4 format. Clips contain camera video
without audio or the pose overlay. These are labeled recording tests and have no
impact measurements; the separate simulated swing data remains a UI demo.
No server upload is performed. Browser cleanup, clearing site data, and private
browsing can remove local recordings, so download important clips. If a storage
write fails, the current clip remains in memory for download or retry until you
leave the page or discard it.

Run `npm test`, `npm run lint`, and `npm run build` for the standard checks.
The optional Firefox integration check uses a fake camera and verifies actual
recording/playback, download, reload persistence, capacity, deletion, and failed-save
recovery. Install its tools in the ignored local folder (PowerShell):

```powershell
npm install --prefix .camera-check.local --no-save --package-lock=false playwright
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.camera-check.local/browsers"
node .camera-check.local/node_modules/playwright/cli.js install firefox
npm run build
node tests/video-browser.mjs
```
