// Arduino IDE: install "esp32 by Espressif Systems"; select your ESP32 board.
// Transport demo only. Replace demo samples with readings from your external IMU.
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <atomic>

constexpr char SERVICE_UUID[] = "7b183000-9168-443e-a927-7aeea07e8105";
constexpr char TELEMETRY_UUID[] = "7b183001-9168-443e-a927-7aeea07e8105";
constexpr char COMMAND_UUID[] = "7b183002-9168-443e-a927-7aeea07e8105";
constexpr uint32_t SAMPLE_INTERVAL_MS = 50;  // 20 Hz transport demonstration.
BLECharacteristic* telemetry;
std::atomic<bool> connected{false};
std::atomic<bool> streaming{false};
std::atomic<bool> sampleRequested{false};
std::atomic<bool> restartAdvertising{false};
uint16_t sequence = 0;
uint32_t lastSampleMs = 0;

class ConnectionCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    streaming = false;
    sampleRequested = false;
    connected = true;
  }
  void onDisconnect(BLEServer*) override {
    connected = false;
    streaming = false;
    sampleRequested = false;
    restartAdvertising = true;
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    const auto command = characteristic->getValue();
    if (command.length() != 1) return;
    switch (static_cast<uint8_t>(command[0])) {
      case 1: streaming = true; break;
      case 2: streaming = false; break;
      case 3: break;
      default: return;
    }
    sampleRequested = true;  // Also report stream state after start/stop.
  }
};

void put16(uint8_t* packet, size_t offset, uint16_t value) {
  packet[offset] = value & 0xff;
  packet[offset + 1] = (value >> 8) & 0xff;
}

void sendSample(uint32_t now) {
  uint8_t packet[20] = {};
  packet[0] = 1;  // Protocol version.
  packet[1] = 0x01 | (streaming.load() ? 0x02 : 0);  // DEMO, optionally STREAMING.
  put16(packet, 2, sequence++);
  for (size_t i = 0; i < 4; ++i) packet[4 + i] = (now >> (8 * i)) & 0xff;

  // Demo acceleration in milli-g and rotation in tenths of degrees/second.
  // Replace all six values with scaled, clamped int16_t IMU readings.
  // Then clear flag 0x01 and set 0x04 only when the sensor reading is valid.
  const int16_t demoAx = static_cast<int16_t>((now / 50) % 201) - 100;
  put16(packet, 8, static_cast<uint16_t>(demoAx));
  put16(packet, 10, 0);
  put16(packet, 12, 1000);
  put16(packet, 14, 0);
  put16(packet, 16, 0);
  put16(packet, 18, 0);
  telemetry->setValue(packet, sizeof(packet));
  telemetry->notify();
}

void setup() {
  Serial.begin(115200);
  BLEDevice::init("CourseCorrector");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ConnectionCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);
  telemetry = service->createCharacteristic(TELEMETRY_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  telemetry->addDescriptor(new BLE2902());
  BLECharacteristic* command = service->createCharacteristic(COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
  command->setCallbacks(new CommandCallbacks());
  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("CourseCorrector BLE ready. Connect from the web app.");
}

void loop() {
  if (restartAdvertising.exchange(false)) {
    delay(500);  // Let the stack finish disconnecting before advertising again.
    if (!connected.load()) BLEDevice::startAdvertising();
  }
  const uint32_t now = millis();
  if (connected.load()) {
    const bool requested = sampleRequested.exchange(false);
    if (requested || (streaming.load() && now - lastSampleMs >= SAMPLE_INTERVAL_MS)) {
      lastSampleMs = now;
      sendSample(now);
    }
  }
  delay(5);
}
