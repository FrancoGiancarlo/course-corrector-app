#include <Arduino.h>

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

// =====================================================
// BLE UUIDs
// =====================================================

static BLEUUID serviceUUID(
  "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
);

static BLEUUID characteristicUUID(
  "beb5483e-36e1-4688-b7f5-ea07361b26a8"
);


// =====================================================
// BLE Variables
// =====================================================

static BLERemoteCharacteristic* pRemoteCharacteristic = nullptr;

static BLEAdvertisedDevice* myDevice = nullptr;

static BLEClient* pClient = nullptr;

bool doConnect = false;
bool connected = false;
bool scanning = false;


// =====================================================
// Notification Callback
// =====================================================

static void notifyCallback(
    BLERemoteCharacteristic* pBLERemoteCharacteristic,
    uint8_t* pData,
    size_t length,
    bool isNotify) {

  Serial.print("Received: ");

  for (size_t i = 0; i < length; i++) {
    Serial.print((char)pData[i]);
  }

  Serial.println();
}


// =====================================================
// Client Disconnect Callback
// =====================================================

class MyClientCallbacks : public BLEClientCallbacks {

  void onConnect(BLEClient* pclient) override {

    Serial.println("Connected to server!");
  }

  void onDisconnect(BLEClient* pclient) override {

    Serial.println();
    Serial.println("Server disconnected!");
    Serial.println("Searching for server again...");

    connected = false;
    doConnect = false;
    scanning = false;
  }
};


// =====================================================
// Advertised Device Callback
// =====================================================

class MyAdvertisedDeviceCallbacks :
    public BLEAdvertisedDeviceCallbacks {

  void onResult(BLEAdvertisedDevice advertisedDevice) override {

    // Only respond to devices advertising our service
    if (advertisedDevice.haveServiceUUID() &&
        advertisedDevice.isAdvertisingService(serviceUUID)) {

      Serial.println();
      Serial.println("Found ADXL345 BLE server!");

      BLEDevice::getScan()->stop();

      scanning = false;

      // Save the device
      myDevice =
        new BLEAdvertisedDevice(advertisedDevice);

      doConnect = true;
    }
  }
};


// =====================================================
// Connect to Server
// =====================================================

bool connectToServer() {

  Serial.println("Connecting to BLE server...");

  // Create BLE client
  pClient = BLEDevice::createClient();

  // Add disconnect callback
  pClient->setClientCallbacks(
    new MyClientCallbacks()
  );

  // Connect to server
  if (!pClient->connect(myDevice)) {

    Serial.println("Failed to connect!");

    return false;
  }

  Serial.println("Connected to server!");


  // Get service
  BLERemoteService* pRemoteService =
      pClient->getService(serviceUUID);

  if (pRemoteService == nullptr) {

    Serial.println("Service not found!");

    pClient->disconnect();

    return false;
  }


  // Get characteristic
  pRemoteCharacteristic =
      pRemoteService->getCharacteristic(
        characteristicUUID
      );

  if (pRemoteCharacteristic == nullptr) {

    Serial.println("Characteristic not found!");

    pClient->disconnect();

    return false;
  }

  Serial.println("Characteristic found!");


  // Register for notifications
  if (pRemoteCharacteristic->canNotify()) {

    pRemoteCharacteristic->registerForNotify(
      notifyCallback
    );

    Serial.println("Notifications enabled!");
  }
  else {

    Serial.println("Characteristic does not support notifications!");

    pClient->disconnect();

    return false;
  }


  connected = true;

  Serial.println("Successfully connected!");

  return true;
}


// =====================================================
// Start BLE Scan
// =====================================================

void startScanning() {

  if (scanning || connected) {
    return;
  }

  Serial.println();
  Serial.println("Scanning for ADXL345 server...");

  scanning = true;

  BLEScan* pBLEScan =
      BLEDevice::getScan();

  pBLEScan->start(5, false);

  scanning = false;
}


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("BLE ADXL345 Client");
  Serial.println("==============================");


  // Initialize BLE
  BLEDevice::init("ESP32-ADXL345-Client");


  // Create scanner
  BLEScan* pBLEScan =
      BLEDevice::getScan();

  pBLEScan->setAdvertisedDeviceCallbacks(
      new MyAdvertisedDeviceCallbacks()
  );

  pBLEScan->setInterval(1349);
  pBLEScan->setWindow(449);

  pBLEScan->setActiveScan(true);

  // Begin scanning
  startScanning();
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  // -------------------------------------------------
  // If we found the server, connect to it
  // -------------------------------------------------

  if (doConnect) {

    doConnect = false;

    if (connectToServer()) {

      Serial.println("Receiving accelerometer data...");

    }
    else {

      Serial.println("Connection failed.");

      connected = false;
    }
  }


  // -------------------------------------------------
  // If we're disconnected, scan again
  // -------------------------------------------------

  if (!connected && !doConnect && !scanning) {

    startScanning();
  }


  delay(100);
}
