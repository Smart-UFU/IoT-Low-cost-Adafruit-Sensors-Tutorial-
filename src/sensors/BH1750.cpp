#include "BH1750.h"

static const uint8_t MODE_VALUES[3] = {
  BH1750::CONTINUOUS_HIGH_RES_MODE, BH1750::CONTINUOUS_HIGH_RES_MODE_2, BH1750::CONTINUOUS_LOW_RES_MODE
};
static const float MODE_MS[3] = { 120.0f, 120.0f, 16.0f };

bool BH1750Sensor::begin() {
  // The BH1750 answers at 0x23 (ADDR pin low/floating) or 0x5C (ADDR high).
  // Probe both so a different breakout wiring still works.
  static const uint8_t ADDRS[2] = { 0x23, 0x5C };
  bool found = false;
  for (uint8_t i = 0; i < 2 && !found; i++) {
    Wire.beginTransmission(ADDRS[i]);
    if (Wire.endTransmission() == 0) { addr_ = ADDRS[i]; found = true; }
  }
  if (!found) {
    Serial.println(F("# BH1750: no ACK at 0x23 or 0x5C"));
    return false;
  }
  Serial.print(F("# BH1750 found at 0x"));
  Serial.println(addr_, HEX);

  if (!sensor_.begin((BH1750::Mode)MODE_VALUES[modeIdx_], addr_)) return false;
  sensor_.setMTreg(mtreg_);
  delay(200); // let the first conversion finish before the first read
  return true;
}

const __FlashStringHelper* BH1750Sensor::name() const { return F("BH1750"); }
const __FlashStringHelper* BH1750Sensor::sensorType() const { return F("photodiode"); }

ChannelInfo BH1750Sensor::channel(uint8_t) const {
  return { F("Lux"), F("#CCCCCC") };
}

bool BH1750Sensor::readChannels(float* out) {
  float lux = sensor_.readLightLevel();
  if (lux < 0) {
    // -1 = the 2-byte I2C read failed, -2 = not configured. Re-send the mode
    // once, wait for a full conversion and try again before giving up.
    sensor_.begin((BH1750::Mode)MODE_VALUES[modeIdx_], addr_);
    sensor_.setMTreg(mtreg_);
    delay(200);
    lux = sensor_.readLightLevel();
    if (lux < 0) {
      static unsigned long lastMsg = 0;
      if (millis() - lastMsg > 2000) {
        lastMsg = millis();
        Serial.print(F("# BH1750 read failed (code "));
        Serial.print(lux);
        Serial.print(F(") at 0x"));
        Serial.println(addr_, HEX);
      }
      return false; // never report -1 as if it were a lux value
    }
  }
  out[0] = lux;
  return true;
}

void BH1750Sensor::setGainContinuous(float value) {
  mtreg_ = (byte)value;
  sensor_.setMTreg(mtreg_);
}

float BH1750Sensor::integrationTimeMs() const {
  return MODE_MS[modeIdx_];
}

const __FlashStringHelper* BH1750Sensor::timePresetLabel(uint8_t idx) const {
  switch (idx) {
    case 0: return F("High Res (1.0 lx, 120ms)");
    case 1: return F("High Res 2 (0.5 lx, 120ms)");
    default: return F("Low Res (4.0 lx, 16ms)");
  }
}

void BH1750Sensor::setTimePreset(uint8_t idx) {
  modeIdx_ = idx;
  applyMode();
}

void BH1750Sensor::applyMode() {
  // The BH1750 library changes resolution mode by re-initializing.
  // The address must be passed again: begin() resets it to 0x23 otherwise.
  sensor_.begin((BH1750::Mode)MODE_VALUES[modeIdx_], addr_);
  sensor_.setMTreg(mtreg_);
  delay(200); // wait for the first conversion in the new mode
}
