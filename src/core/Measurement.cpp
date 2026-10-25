#include "Measurement.h"
#include "SensorManager.h"
#include <math.h>

namespace Measurement {

Mode    mode          = Mode::REFLECTANCE;
Submode submode       = Submode::RAW;
bool    selectedChannels[MAX_CHANNELS] = { false };
float   referenceValues[MAX_CHANNELS]  = { 0 };
bool    referenceValid = false;
uint32_t configSignature = 0;

static uint32_t refSignature = 0;                    // configSignature of the stored reference
static bool     refChannels[MAX_CHANNELS] = { false }; // channels the reference was measured on

static const __FlashStringHelper* g_error = nullptr;

const __FlashStringHelper* lastError() { return g_error; }

void setMode(Mode m) {
  mode = m;
  referenceValid = false; // switching modes invalidates any previous reference
}

void setSubmode(Submode s) { submode = s; }

void clearChannelSelection() {
  for (uint8_t i = 0; i < MAX_CHANNELS; i++) selectedChannels[i] = false;
}

void selectChannel(uint8_t idx) {
  if (idx < MAX_CHANNELS) selectedChannels[idx] = true;
}

bool anyChannelSelected() {
  for (uint8_t i = 0; i < MAX_CHANNELS; i++) {
    if (selectedChannels[i]) return true;
  }
  return false;
}

static constexpr unsigned long DURATION_MS      = 10000;
static constexpr unsigned long SAMPLE_PERIOD_MS = 200;

bool run(bool isReference, ProgressCallback onProgress, float* avgOut, bool* usedLogOut) {
  g_error = nullptr;
  SensorBase& sensor = SensorManager::get();

  if (isReference && mode == Mode::FLUORESCENCE) {
    g_error = F("Fluorescence has no reference measurement.");
    return false;
  }
  if (!anyChannelSelected()) {
    g_error = F("No channel selected.");
    return false;
  }

  bool useLog = (!isReference) && (submode == Submode::LOG) &&
                (mode == Mode::REFLECTANCE || mode == Mode::ABSORBANCE);

  if (useLog && !referenceValid) {
    g_error = F("Measure the reference first (log / -log10 submode).");
    return false;
  }
  if (useLog) {
    if (refSignature != configSignature) {
      g_error = F("Gain, time, LED or extras changed since the reference. Measure the reference again.");
      return false;
    }
    for (uint8_t i = 0; i < MAX_CHANNELS; i++) {
      if (!selectedChannels[i]) continue;
      if (!refChannels[i]) {
        g_error = F("The reference does not cover a selected channel. Measure the reference again.");
        return false;
      }
      if (referenceValues[i] <= 0.0f) {
        g_error = F("Reference is zero on a selected channel. Raise gain/LED and measure it again.");
        return false;
      }
    }
  }

  const uint8_t n = sensor.channelCount();

  float sum[MAX_CHANNELS]   = { 0 };
  int   count[MAX_CHANNELS] = { 0 };
  float sample[MAX_CHANNELS];

  // Samples read during the settling window are read (to flush stale data) but
  // neither averaged nor counted — see SensorBase::settleMs().
  const unsigned long settleMs = sensor.settleMs();
  unsigned long startTime  = millis();
  unsigned long lastSample = 0;
  int sampleCount = 0;

  while (millis() - startTime < DURATION_MS) {
    if (millis() - lastSample < SAMPLE_PERIOD_MS) {
      delay(2); // briefly frees the CPU (avoids ESP32 watchdog, no cost on AVR)
      continue;
    }
    lastSample = millis();

    if (!sensor.readChannels(sample)) continue;
    if (millis() - startTime < settleMs) continue; // old-gain/old-time leftovers
    sampleCount++;

    for (uint8_t i = 0; i < n && i < MAX_CHANNELS; i++) {
      if (!selectedChannels[i]) continue;

      // The average is taken on the raw intensity; -log10(I/I0) is applied to
      // the MEAN afterwards. (Averaging per-sample logs biases noisy/low
      // signals, and a zero reading used to be silently replaced by 1.0.)
      sum[i]   += sample[i];
      count[i] += 1;

      if (useLog) { // live display only
        sample[i] = (sample[i] > 0.0f) ? -log10f(sample[i] / referenceValues[i]) : NAN;
      }
    }

    if (onProgress) onProgress((millis() - startTime) / 1000.0f, sampleCount, sample);
  }

  if (sampleCount == 0) {
    g_error = F("Sensor read failed: no valid samples. Check wiring/address.");
    return false;
  }

  // Pass 1: compute and validate everything BEFORE touching the stored
  // reference, so a failed run can never leave a half-overwritten reference.
  for (uint8_t i = 0; i < n && i < MAX_CHANNELS; i++) {
    if (!selectedChannels[i]) continue;
    float meanRaw = (count[i] > 0) ? (sum[i] / count[i]) : 0.0f;
    if (isReference && meanRaw <= 0.0f) {
      g_error = F("Reference signal is zero on a selected channel. Raise gain/LED and try again.");
      return false;
    }
    if (useLog) {
      if (meanRaw <= 0.0f) {
        g_error = F("Signal is zero on a selected channel: -log10 is undefined. Raise gain/LED.");
        return false;
      }
      avgOut[i] = -log10f(meanRaw / referenceValues[i]);
    } else {
      avgOut[i] = meanRaw; // raw (reference, explicit raw mode, or fluorescence)
    }
  }

  // Pass 2: commit.
  if (isReference) {
    for (uint8_t i = 0; i < MAX_CHANNELS; i++) {
      refChannels[i] = selectedChannels[i];
      if (selectedChannels[i] && i < n) referenceValues[i] = avgOut[i];
    }
    refSignature   = configSignature;
    referenceValid = true;
  }
  if (usedLogOut) *usedLogOut = useLog;

  return true;
}

} // namespace Measurement
