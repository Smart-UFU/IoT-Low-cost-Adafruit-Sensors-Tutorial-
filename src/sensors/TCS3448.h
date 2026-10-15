#pragma once
#include "SensorBase.h"
#include <Adafruit_TCS3448.h>

// -----------------------------------------------------------------------------
// TCS3448 (a.k.a. TCS34488) — ams-OSRAM's 2026 "refresh" of the AS7343.
// Released by Adafruit as product #6525 in September 2026. Per Adafruit's own
// product page and the Adafruit_TCS3448 Arduino library README: "The TCS3448
// register map and automatic channel multiplexer are compatible with the
// AS7343. This library subclasses the Adafruit AS7343 driver, selects the
// TCS3448 I2C address, and adds TCS3448-named data types." That's why this
// driver is structured identically to AS7343Sensor (same gain table, same
// ATIME/ASTEP integration-time formula, same 4-258mA continuous LED driver) —
// see README.md's "What's verified" section for exactly what was confirmed
// against ams-OSRAM's datasheet vs. inferred from that subclassing
// relationship, since this chip is too new for any of this to come from
// training data.
//
// Differences from AS7343 (per Adafruit's product page):
//   - I2C address changed from 0x39 to 0x59 (handled internally by the
//     Adafruit_TCS3448 library's begin() — nothing to do here).
//   - Retuned optical filters: channel center wavelengths shift by a few nm
//     (confirmed against ams-OSRAM datasheet DS001121 Table 7 — see the .cpp).
//   - 4 additional raw ADC slots due to the retuned SMUX cycling, but the
//     same 13 *named* channels this project exposes (F1-F8, FZ/FY/FXL, NIR,
//     Clear) as AS7343 — flicker detection is a separate digital feature,
//     not a spectral channel, so it's excluded here exactly like AS7343.
// -----------------------------------------------------------------------------
class TCS3448Sensor : public SensorBase {
 public:
  bool begin() override;

  const __FlashStringHelper* name() const override;
  const __FlashStringHelper* sensorType() const override;

  uint8_t channelCount() const override { return 13; }
  ChannelInfo channel(uint8_t idx) const override;
  bool readChannels(float* out) override;

  GainType gainType() const override { return GainType::GAIN_DISCRETE; }
  uint8_t gainOptionCount() const override { return 13; }
  const __FlashStringHelper* gainOptionLabel(uint8_t idx) const override;
  void setGainIndex(uint8_t idx) override;

  TimeType timeType() const override { return TimeType::TIME_FORMULA; }
  const __FlashStringHelper* integrationFormula() const override;
  float integrationTimeMs() const override;
  uint8_t timeParamCount() const override { return 2; }
  const char* timeParamKey(uint8_t idx) const override;
  const __FlashStringHelper* timeParamLabel(uint8_t idx) const override;
  int32_t timeParamMin(uint8_t idx) const override;
  int32_t timeParamMax(uint8_t idx) const override;
  void setTimeParam(uint8_t idx, int32_t value) override;

  LedType ledType() const override { return LedType::LED_CONTINUOUS; }
  int ledMinMA() const override { return 4; }
  int ledMaxMA() const override { return 258; }
  void setLedOn(bool on) override;
  void setLedContinuous(int mA) override;

 private:
  Adafruit_TCS3448 sensor_;
  uint8_t gainIdx_ = 9; // 256X (same library-default convention as AS7343)
  // int32_t, not int: on Uno, plain `int` is 16-bit (max 32767), but ASTEP
  // goes up to 65535 (see timeParamMax() below and SensorBase.h's own NOTE
  // on this exact pitfall). AS7343.cpp still uses a 16-bit `int` here, which
  // makes its integrationTimeMs() display an incorrect negative value on Uno
  // for any ASTEP above 32767 (the ATIME/ASTEP registers themselves still
  // get the correct bits via the (uint16_t) cast in applyGainAndTiming(), so
  // measurements aren't wrong — just the on-screen integration-time readout
  // is, for that one edge case). TCS3448 doesn't inherit that bug.
  int32_t atime_ = 100;
  int32_t astep_ = 999;

  void applyGainAndTiming();
};
