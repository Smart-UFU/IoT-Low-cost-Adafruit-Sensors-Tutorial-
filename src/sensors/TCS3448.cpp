#include "TCS3448.h"
#include "../core/Utils.h"

// Same reasoning as AS7343Sensor::readChannels(): the library fills a flat
// buffer indexed by TCS3448_CHANNEL_* constants (18 raw ADC slots, because
// the 6 physical ADCs are time-multiplexed across 3 SMUX cycles to cover 14
// logical channels + repeated Clear/NIR readings used for saturation
// bookkeeping — confirmed against the CircuitPython driver's own 18-entry
// `all_channels` example in the PyPI README, since the Arduino header itself
// wasn't reachable to read directly; see README.md "What's verified").
static uint16_t g_rawBuffer[18];

// Channel center wavelengths (typ.) straight from ams-OSRAM datasheet
// DS001121 v1-01, Table 7 "Optical characteristics of TCS3448" — these are
// the TCS3448-specific values, NOT copy-pasted from AS7343: Adafruit's
// product page explicitly says "retuned optical filters: channel centers
// move by a few nanometers" versus AS7343, and the datasheet confirms it
// (e.g. F1 407nm here vs. ~405nm on AS7343, FY 560nm here vs. ~555nm on
// AS7343). Order matches AS7343Sensor's CHANNEL_INDEX convention: F1, F2,
// FZ, F3, F4, F5, FY, FXL, F6, F7, F8, NIR, Clear.
static const char CH_NAME_0[]  PROGMEM = "407nm";
static const char CH_NAME_1[]  PROGMEM = "424nm";
static const char CH_NAME_2[]  PROGMEM = "450nm";
static const char CH_NAME_3[]  PROGMEM = "473nm";
static const char CH_NAME_4[]  PROGMEM = "516nm";
static const char CH_NAME_5[]  PROGMEM = "546nm";
static const char CH_NAME_6[]  PROGMEM = "560nm";
static const char CH_NAME_7[]  PROGMEM = "596nm";
static const char CH_NAME_8[]  PROGMEM = "636nm";
static const char CH_NAME_9[]  PROGMEM = "687nm";
static const char CH_NAME_10[] PROGMEM = "748nm";
static const char CH_NAME_11[] PROGMEM = "855nm";
static const char CH_NAME_12[] PROGMEM = "Clear";
static const char* const CH_NAMES[] PROGMEM = {
  CH_NAME_0, CH_NAME_1, CH_NAME_2, CH_NAME_3, CH_NAME_4, CH_NAME_5, CH_NAME_6,
  CH_NAME_7, CH_NAME_8, CH_NAME_9, CH_NAME_10, CH_NAME_11, CH_NAME_12
};

// Same violet->red visual gradient as AS7343Sensor, reused on purpose so the
// two sensors' UIs read consistently — these are swatch colors for the web
// UI, not measured spectral colors.
static const char CH_COLOR_0[]  PROGMEM = "#8B00FF";
static const char CH_COLOR_1[]  PROGMEM = "#6A00FF";
static const char CH_COLOR_2[]  PROGMEM = "#0000FF";
static const char CH_COLOR_3[]  PROGMEM = "#00BFFF";
static const char CH_COLOR_4[]  PROGMEM = "#00C000";
static const char CH_COLOR_5[]  PROGMEM = "#ADFF2F";
static const char CH_COLOR_6[]  PROGMEM = "#CCFF00";
static const char CH_COLOR_7[]  PROGMEM = "#FFA500";
static const char CH_COLOR_8[]  PROGMEM = "#FF3300";
static const char CH_COLOR_9[]  PROGMEM = "#CC0000";
static const char CH_COLOR_10[] PROGMEM = "#800000";
static const char CH_COLOR_11[] PROGMEM = "#400000";
static const char CH_COLOR_12[] PROGMEM = "#FFFFFF";
static const char* const CH_COLORS[] PROGMEM = {
  CH_COLOR_0, CH_COLOR_1, CH_COLOR_2, CH_COLOR_3, CH_COLOR_4, CH_COLOR_5, CH_COLOR_6,
  CH_COLOR_7, CH_COLOR_8, CH_COLOR_9, CH_COLOR_10, CH_COLOR_11, CH_COLOR_12
};

// Index into g_rawBuffer for each of our 13 reported channels. Uses the
// TCS3448-named channel constants the Adafruit_TCS3448 library's README says
// it adds (mirroring AS7343_CHANNEL_* 1:1, since the register map is
// identical) — see README.md "What's verified" for why this one specific
// detail (the exact enum spelling) is flagged as inferred-by-analogy rather
// than independently confirmed, and what to check if it doesn't compile.
static const uint8_t CHANNEL_INDEX[13] = {
  TCS3448_CHANNEL_F1, TCS3448_CHANNEL_F2, TCS3448_CHANNEL_FZ, TCS3448_CHANNEL_F3,
  TCS3448_CHANNEL_F4, TCS3448_CHANNEL_F5, TCS3448_CHANNEL_FY, TCS3448_CHANNEL_FXL,
  TCS3448_CHANNEL_F6, TCS3448_CHANNEL_F7, TCS3448_CHANNEL_F8, TCS3448_CHANNEL_NIR,
  TCS3448_CHANNEL_VIS_TL_0
};

// Gain table — VALUE 0-12 -> 0.5X..2048X, confirmed identical to AS7343
// straight from ams-OSRAM datasheet DS001121 Table 7's gain code list.
static const char GAIN_0[]  PROGMEM = "0.5X";
static const char GAIN_1[]  PROGMEM = "1X";
static const char GAIN_2[]  PROGMEM = "2X";
static const char GAIN_3[]  PROGMEM = "4X";
static const char GAIN_4[]  PROGMEM = "8X";
static const char GAIN_5[]  PROGMEM = "16X";
static const char GAIN_6[]  PROGMEM = "32X";
static const char GAIN_7[]  PROGMEM = "64X";
static const char GAIN_8[]  PROGMEM = "128X";
static const char GAIN_9[]  PROGMEM = "256X";
static const char GAIN_10[] PROGMEM = "512X";
static const char GAIN_11[] PROGMEM = "1024X";
static const char GAIN_12[] PROGMEM = "2048X";
static const char* const GAIN_NAMES[] PROGMEM = {
  GAIN_0, GAIN_1, GAIN_2, GAIN_3, GAIN_4, GAIN_5, GAIN_6,
  GAIN_7, GAIN_8, GAIN_9, GAIN_10, GAIN_11, GAIN_12
};

static const tcs3448_gain_t GAIN_VALUES[13] = {
  TCS3448_GAIN_0_5X, TCS3448_GAIN_1X,   TCS3448_GAIN_2X,   TCS3448_GAIN_4X,
  TCS3448_GAIN_8X,   TCS3448_GAIN_16X,  TCS3448_GAIN_32X,  TCS3448_GAIN_64X,
  TCS3448_GAIN_128X, TCS3448_GAIN_256X, TCS3448_GAIN_512X, TCS3448_GAIN_1024X,
  TCS3448_GAIN_2048X
};

bool TCS3448Sensor::begin() {
  if (!sensor_.begin()) return false;
  applyGainAndTiming();
  return true;
}

const __FlashStringHelper* TCS3448Sensor::name() const { return F("TCS3448"); }
const __FlashStringHelper* TCS3448Sensor::sensorType() const { return F("color"); }

ChannelInfo TCS3448Sensor::channel(uint8_t idx) const {
  return { Utils::flashStr(CH_NAMES, idx), Utils::flashStr(CH_COLORS, idx) };
}

bool TCS3448Sensor::readChannels(float* out) {
  if (!sensor_.readAllChannels(g_rawBuffer)) return false;
  for (uint8_t i = 0; i < 13; i++) out[i] = g_rawBuffer[CHANNEL_INDEX[i]];
  return true;
}

const __FlashStringHelper* TCS3448Sensor::gainOptionLabel(uint8_t idx) const {
  return Utils::flashStr(GAIN_NAMES, idx);
}

void TCS3448Sensor::setGainIndex(uint8_t idx) {
  gainIdx_ = idx;
  sensor_.setGain(GAIN_VALUES[gainIdx_]);
}

const __FlashStringHelper* TCS3448Sensor::integrationFormula() const {
  return F("(ATIME+1) x (ASTEP+1) x 2.78us");
}

float TCS3448Sensor::integrationTimeMs() const {
  return (float)(atime_ + 1) * (float)(astep_ + 1) * 2.78e-3f;
}

const char* TCS3448Sensor::timeParamKey(uint8_t idx) const {
  return idx == 0 ? "atime" : "astep";
}
const __FlashStringHelper* TCS3448Sensor::timeParamLabel(uint8_t idx) const {
  return idx == 0 ? F("ATIME") : F("ASTEP");
}
int32_t TCS3448Sensor::timeParamMin(uint8_t) const { return 0; }
int32_t TCS3448Sensor::timeParamMax(uint8_t idx) const { return idx == 0 ? 255 : 65535; }

void TCS3448Sensor::setTimeParam(uint8_t idx, int32_t value) {
  if (idx == 0) atime_ = value; else astep_ = value;
  applyGainAndTiming();
}

void TCS3448Sensor::setLedOn(bool on) {
  sensor_.enableLED(on);
}

void TCS3448Sensor::setLedContinuous(int mA) {
  sensor_.setLEDCurrent((uint16_t)mA);
}

void TCS3448Sensor::applyGainAndTiming() {
  sensor_.setGain(GAIN_VALUES[gainIdx_]);
  sensor_.setATIME((uint8_t)atime_);
  sensor_.setASTEP((uint16_t)astep_);
}
