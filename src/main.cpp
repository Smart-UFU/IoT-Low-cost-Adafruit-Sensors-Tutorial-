// =============================================================================
// SENSOR TUTORIAL SERIES — main.cpp
// -----------------------------------------------------------------------------
// This file only does three things: bring up Serial/I2C/the active sensor,
// read incoming lines, and hand them to Protocol::handleCommand(). All the
// actual logic lives in core/ and sensors/ — see README.md for the full
// architecture and wire protocol.
//
// Which sensor gets compiled in is decided entirely by the PlatformIO
// environment you build (each one defines a single -D SENSOR_xxx flag and
// restricts build_src_filter to that sensor's .cpp — see platformio.ini).
// =============================================================================
#include <Arduino.h>
#include <Wire.h>
#include "core/Pins.h"
#include "core/SensorManager.h"
#include "core/Measurement.h"
#include "core/Protocol.h"

// Fixed-size line buffer for incoming Serial commands — no String class, so
// nothing here fragments the heap on AVR boards (see core/Utils.h for why
// that matters).
constexpr uint8_t LINE_BUFFER_SIZE = 96;
char    lineBuffer[LINE_BUFFER_SIZE];
uint8_t lineLen = 0;

// I2C diagnostics: lines beginning with # are informational and are ignored
// by the browser interface (it only parses JSON lines).
// NOTE: no Serial.printf here — AVR (Arduino Uno) has no Serial.printf, and
// this function is compiled for the *_uno environments too.
static uint8_t scanI2C() {
  uint8_t found = 0;
  Serial.println(F("# I2C scan (7-bit addresses):"));
  for (uint8_t address = 0x08; address < 0x78; ++address) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.print(F("# I2C ACK at 0x"));
      if (address < 0x10) Serial.print('0');
      Serial.println(address, HEX);
      ++found;
    }
  }
  if (!found) Serial.println(F("# I2C: no ACK. Check 3V/GND, SDA/SCL and power."));
  return found;
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 3000) { /* wait for USB port (native USB boards) */ }

  pinMode(PIN_LED_ABSORBANCE, OUTPUT);
  pinMode(PIN_LED_FLUORESCENCE, OUTPUT);
  digitalWrite(PIN_LED_ABSORBANCE, LOW);
  digitalWrite(PIN_LED_FLUORESCENCE, LOW);

#if defined(ARDUINO_ARCH_ESP32)
  // On the Reverse TFT Feather the STEMMA QT / TFT power rail must be high.
  // The Arduino core normally enables it, but explicit initialization makes
  // this firmware resilient to board-package versions.
  #if defined(TFT_I2C_POWER)
    pinMode(TFT_I2C_POWER, OUTPUT);
    // Power-cycle the STEMMA QT rail so a sensor stuck from a previous run restarts clean.
    digitalWrite(TFT_I2C_POWER, LOW);
    delay(100);
    digitalWrite(TFT_I2C_POWER, HIGH);
    delay(200);
    Serial.print(F("# TFT_I2C_POWER pin="));
    Serial.print((int)TFT_I2C_POWER);
    Serial.print(F(" level="));
    Serial.println(digitalRead(TFT_I2C_POWER));
    Serial.println(F("# TFT_I2C_POWER enabled"));
  #else
    Serial.println(F("# TFT_I2C_POWER not defined by selected board variant"));
  #endif
  // Use the board variant's actual SDA/SCL definitions, not generic 21/22.
  bool i2cOK = Wire.begin(SDA, SCL);
  Serial.print(F("# I2C pins SDA="));
  Serial.print((int)SDA);
  Serial.print(F(" SCL="));
  Serial.print((int)SCL);
  Serial.println(i2cOK ? F(", begin=OK") : F(", begin=FAILED"));
#else
  Wire.begin();
#endif
  Wire.setClock(100000); // Conservative speed for jumpers/long cables.
  delay(100);
  scanI2C(); // MAX17048 (often 0x36) may be visible even with no sensor.

  bool sensorReady = SensorManager::get().begin();
  if (!sensorReady) {
    Serial.println(F("# Driver initialization failed; retrying once..."));
    delay(300);
    scanI2C(); // second scan: shows whether the device appeared late
    sensorReady = SensorManager::get().begin();
  }
  if (!sensorReady) {
    // Keep Serial alive so the browser sees why nothing else works.
    while (true) {
      if (Serial.available()) Serial.read();
      Serial.println(F("{\"evt\":\"error\",\"msg\":\"Sensor driver initialization failed. Check I2C scan and selected firmware.\"}"));
      delay(1000);
    }
  }

  // Measurement::mode defaults to REFLECTANCE at compile time, but that's
  // only a valid default for sensors that can actually drive their own LED
  // (LedType != LED_NONE) — the web UI's default mode tab mirrors this same
  // rule (see Protocol.cpp's sendInfo(): "reflectance" is only the first
  // entry in modes[] when the sensor has an LED). For a photodiode sensor
  // with no LED, both sides should default to ABSORBANCE instead, so pick
  // whichever matches what sendInfo() will actually report, then physically
  // apply it — otherwise the sensor's internal LED (or the external
  // Absorbance LED, for LED-less sensors) sits in the vendor library's own
  // power-on-default state, invisibly out of sync with what the UI displays
  // as active, until the user manually re-clicks a mode tab.
  bool hasReflectance = SensorManager::get().ledType() != LedType::LED_NONE;
  Measurement::setMode(hasReflectance ? Measurement::Mode::REFLECTANCE
                                       : Measurement::Mode::ABSORBANCE);
  Protocol::syncOutputsForMode();
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      lineBuffer[lineLen] = '\0';
      if (lineLen > 0) Protocol::handleCommand(lineBuffer);
      lineLen = 0;
    } else if (c != '\r') {
      if (lineLen < LINE_BUFFER_SIZE - 1) {
        lineBuffer[lineLen++] = c;
      } else {
        // Line too long for the buffer: drop it instead of overrunning memory
        lineLen = 0;
      }
    }
  }
}
