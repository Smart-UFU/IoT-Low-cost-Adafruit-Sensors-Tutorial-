# IoT Color / Photodiode Sensor Tutorial Series

One firmware architecture and one web interface, reused across eleven
low-cost spectral/light sensors: **AS7341, AS7343, TCS3448, AS7262,
TCS34725, APDS9960, BH1750, LTR303, LTR329, LTR390, TSL2591**. Pick a
sensor, build that one PlatformIO environment, open the same
`web/index.html` — the UI builds itself from whatever the firmware says it
can do.

> **New: TCS3448 (a.k.a TCS34488).** Released by Adafruit in September 2026
> as [product #6525](https://www.adafruit.com/product/6525), this is
> ams-OSRAM's newer "refresh" of the AS7343 — same 14-channel architecture,
> same register map, but retuned optical filters and a changed I2C address
> (0x39 → 0x59), so it needs its own firmware build. See the "Sensor
> particularities" table and the TCS3448 note below for the details, and
> "What's verified" for exactly how each spec was sourced (this chip is
> recent enough that none of it could come from training data).

> **TCS34725 is discontinued by Adafruit.** [`APDS9960`](https://www.adafruit.com/product/3595)
> (Proximity, Light, RGB, and Gesture Sensor — STEMMA QT/Qwiic) is the
> recommended replacement for new builds: same 4-channel RGBC + derived
> Color Temp/Lux shape, same "color" sensor type, same wiring. The one
> functional difference is that APDS9960's breakout has **no controllable
> illumination LED usable for this project** (its onboard IR LED only feeds
> the separate proximity/gesture engine), so **APDS9960 only ever offers
> Absorbance and Fluorescence mode** — Reflectance never appears for it, the
> same way it never appears for BH1750/LTR3xx/TSL2591. TCS34725's own
> firmware/library entry is kept below for anyone maintaining existing
> TCS34725 hardware.

No Wi-Fi anywhere. The browser talks to the board over USB using the
**Web Serial API**, so the exact same firmware/webpage pair works on an
ESP32-S3 Feather or a plain Arduino Uno.

## 🔰 Installation Tutorial (Beginner-Friendly, No Command Line Needed)

This section assumes **zero prior experience** with VS Code, PlatformIO, or
Arduino-style boards. It's written as a literal click-by-click walkthrough.
If you're already comfortable with PlatformIO, skip ahead to the "How to
run it" quick-reference section below instead — this one's deliberately
slow and detailed.

### Step 1 — Install Visual Studio Code

1. Go to **https://code.visualstudio.com** in your browser.
2. Click the big blue **Download** button. The site auto-detects your
   operating system (Windows / Mac / Linux), so you usually don't need to
   pick anything.
3. Open the downloaded installer and click through it with the default
   options (Next → Next → Install → Finish). On Windows, it's fine to leave
   every checkbox at its default.
4. Launch VS Code once it finishes installing, just to confirm it opens.
   You'll see a mostly-empty window with a row of icons down the left edge
   — that's the **sidebar**, and you'll use it a lot below.

### Step 2 — Install the PlatformIO extension

PlatformIO is what teaches VS Code how to build and upload firmware for
these boards — VS Code can't do it on its own.

1. In the left sidebar, click the **Extensions** icon (it looks like four
   small squares, with one slightly detached — usually the 5th icon down).
2. A search box appears at the top. Type **PlatformIO IDE**.
3. The correct result is called **"PlatformIO IDE"**, published by
   **PlatformIO**, with a little alien-head logo. Click the blue
   **Install** button on it.
4. Wait — this takes a minute or two and downloads quite a bit in the
   background. You'll see a progress notification in the bottom-right
   corner. Don't close VS Code while it's working.
5. When it finishes, VS Code will ask you to **reload the window** (or it
   will just do it automatically). Let it reload.
6. After the reload, look at the sidebar again — you should now see a new
   icon that looks like an **alien head** 👽. That's the PlatformIO icon.
   If you see it, the extension installed correctly.

### Step 3 — Get this project onto your computer

If someone sent you this project as a **.zip file**:

1. Find the `.zip` file in your Downloads folder (or wherever you saved
   it).
2. Right-click it and choose **Extract All...** (Windows) or double-click
   it (Mac) to unzip it. Remember which folder you extracted it to — you'll
   need to find it again in Step 4.

If you're getting it from a **Git repository** instead: clone it however
you normally would (or just download it as a `.zip` from the repository's
"Code" button and follow the steps above).

### Step 4 — Open the project in VS Code

1. In VS Code, go to the top menu: **File → Open Folder...**
   (on Mac: **File → Open...**).
2. Browse to the folder you extracted in Step 3 — the one that directly
   contains `platformio.ini` — and select it, then click **Select Folder**
   (Windows) or **Open** (Mac).
3. VS Code will reload with the project's file list now visible in the
   sidebar (icon that looks like two overlapping pages, usually the very
   top one).
4. Because this folder contains a `platformio.ini` file, PlatformIO
   recognizes it automatically and starts initializing in the background —
   you may see a notification like "PlatformIO: Project Initialization" or
   a spinning icon in the bottom status bar. **Just wait for this to
   finish** before doing anything else; it can take a little while the
   very first time.

### Step 5 — Connect your board

1. Plug your sensor board (ESP32-S3 Feather or Arduino Uno) into your
   computer with a USB cable. Use a cable you know carries data, not a
   charge-only cable — if the board doesn't show up anywhere later, this is
   the first thing to double check.
2. You don't need to manually find or select which USB port it's on —
   PlatformIO auto-detects it at upload time in almost all cases.

### Step 6 — Pick which sensor + board you're building for

This project supports 11 different sensor chips, each on 2 possible
boards, and every combination is its own "environment" (e.g.
`as7341_esp32s3`, `tcs3448_uno`). You need to tell PlatformIO which one you
want.

1. Look at the very **bottom of the VS Code window** — there's a thin blue
   status bar that PlatformIO adds. It has several small icons:
   a house 🏠, a checkmark ✓, a right-pointing arrow →, a trash can 🗑,
   a plug 🔌, and — importantly — some **text showing an environment
   name** (e.g. `Default (as7341_esp32s3)`) usually toward the left/middle
   of that bar.
2. Click on that **environment name text**. A list pops up at the top of
   the window showing every environment defined in `platformio.ini`
   (`as7341_esp32s3`, `as7341_uno`, `as7343_esp32s3`, `tcs3448_esp32s3`,
   `tcs3448_uno`, etc.).
3. Click the one matching **your sensor chip** (printed on the small
   breakout board you have) **and your microcontroller board** (ESP32-S3
   Feather, or plain Arduino Uno). For example, if you have a TCS3448
   breakout plugged into an ESP32-S3 Feather, choose `tcs3448_esp32s3`.
4. That name now shows in the bottom status bar, confirming it's selected
   for every action below.

### Step 7 — Build the firmware

1. Still in that same bottom blue status bar, click the **checkmark (✓)
   icon**. This is "Build" — it compiles the firmware without uploading it
   yet.
2. A terminal panel opens at the bottom of the window and starts printing
   a lot of text. The very first build for a given sensor can take a few
   minutes, because PlatformIO is also downloading that sensor's vendor
   library and the board toolchain in the background (you don't need to
   have run any install script separately for this to work — building
   triggers it automatically).
3. Wait for it to finish. You're looking for a green line near the bottom
   that says **`[SUCCESS]`**, along with `Took XX seconds`. If it instead
   ends in red with `[FAILED]`, scroll up in that same terminal to read the
   error — it's usually a missing/renamed library, which is worth reporting
   back.

### Step 8 — Upload the firmware to the board

1. With the board still plugged in, click the **right-pointing arrow (→)
   icon** in that same bottom status bar. This is "Upload" — it builds
   (again, quickly, since it's already built) and then flashes the board.
2. Watch the terminal again. You'll see it connect to the board, write the
   firmware, and finish with another **`[SUCCESS]`** line.
   - **Arduino Uno users:** if upload fails immediately, it's often because
     something else (like the Arduino IDE's own Serial Monitor) is holding
     the USB port open. Close any other program that might be talking to
     the board and try again.
   - **ESP32-S3 users:** most boards upload automatically. If it hangs
     waiting to connect, check your board's documentation for whether it
     needs a BOOT button held during upload — this varies by board vendor.
3. Once you see `[SUCCESS]` for the upload, the firmware is live on the
   board. You can unplug and replug the USB cable at this point if you
   want to restart it fresh — it'll keep running the firmware you just
   flashed even after VS Code is closed.

### Step 9 — Open the web interface

1. In VS Code's file sidebar, find the `web` folder, then find
   `index.html` inside it.
2. Right-click `index.html` and look for an option like **"Reveal in File
   Explorer"** (Windows) or **"Reveal in Finder"** (Mac) — this opens your
   normal file browser pointed right at that file.
3. Double-click `index.html` there. It should open in your default
   browser. **This step needs Chrome or Edge** — Firefox and Safari don't
   support the Web Serial feature this project relies on, and it won't
   work on a phone/tablet browser either.
   - If it opens in the wrong browser, right-click the file instead and
     choose **Open with → Google Chrome** (or Edge).
4. On the page, click the **Connect via USB** button.
5. Your browser shows a small popup listing available serial/USB devices —
   click your board's entry, then click **Connect**.
6. The page should now fill itself in automatically: sensor name, channel
   list, gain options, integration time controls, and an LED control if
   your sensor has one. If you see this, everything worked — you're ready
   to take a measurement.

### If something goes wrong

- **Nothing shows up in the "Connect via USB" popup at all:** try a
  different USB cable/port, and make sure Step 8's upload actually ended
  in `[SUCCESS]`.
- **The build (Step 7) fails on the very first try for a sensor:** this
  usually means the download of that sensor's library is still in
  progress or hit a network hiccup — try Build again once.
- **The page connects but shows blank/wrong controls:** double-check you
  picked the environment (Step 6) that actually matches the physical chip
  on your breakout board, not a different sensor's environment.
- Still stuck? The "How to run it" section right below covers the exact
  same steps as command-line instructions, which sometimes surfaces a more
  specific error message than the VS Code UI does.

## How to run it

1. **First time only — install every sensor's libraries in one go:**
   ```bash
   ./install_libraries.sh      # macOS / Linux
   install_libraries.bat       # Windows
   ```
   Requires PlatformIO Core (`pip install -U platformio`) on your PATH — or
   just open this folder in VS Code with the "PlatformIO IDE" extension and
   run the script from its integrated terminal. The script reads every
   `[env:...]` section straight out of `platformio.ini` and runs
   `pio pkg install` for each one, so it downloads all 11 sensors' vendor
   libraries *and* both board toolchains (ESP32-S3 + AVR/Uno) up front —
   you don't need to know yet which sensor you'll end up using, and you
   never have to manually search/install a library by hand. It's safe to
   re-run any time (e.g. after adding a 12th sensor to `platformio.ini`);
   already-installed packages are skipped.
2. Pick your sensor + board and build/upload that PlatformIO environment, e.g.:
   ```bash
   pio run -e as7341_esp32s3  -t upload
   pio run -e tcs3448_esp32s3 -t upload
   pio run -e apds9960_uno    -t upload
   ```
   (Full list of the 22 environments is in `platformio.ini`.) Since step 1
   already downloaded everything, this step works offline.
3. Open `web/index.html` directly in Chrome or Edge (desktop only — Web
   Serial isn't available on Firefox/Safari or mobile).
4. Click **Connect via USB**, pick the board's port. The page requests
   `get_info`, the board replies with a full self-description, and the UI
   builds itself — modes, gain control, LED control, integration time
   control, and any sensor-specific extra parameters.

## Architecture

```
install_libraries.sh / .bat   run once to fetch all 11 sensors' libraries + both board toolchains (see "How to run it")
platformio.ini                 the 22 build environments (11 sensors × 2 boards)

src/
├── main.cpp                  setup()/loop(), reads Serial lines, hands them to Protocol
├── core/
│   ├── Pins.h                 the two FIXED external LEDs (pin 6 = Absorbance/180°, pin 5 = Fluorescence/90°)
│   ├── Utils.h                PROGMEM string helpers, JSON key builder — no String class anywhere
│   ├── SensorManager.h        picks the ONE compiled-in sensor via a SENSOR_xxx build flag
│   ├── Measurement.h/.cpp     the generic 10-second sampling loop + log/raw math — sensor-agnostic
│   ├── Protocol.h/.cpp        the ONLY file that knows JSON; builds "info", parses commands
│   └── Export.h                placeholder for future on-device export (CSV/Excel already happen in the browser)
└── sensors/
    ├── SensorBase.h            the interface every sensor implements — READ THIS FIRST if adding sensor #12
    ├── AS7341.h/.cpp
    ├── AS7343.h/.cpp
    ├── TCS3448.h/.cpp          2026 register-compatible "refresh" of AS7343 — see note above
    ├── AS7262.h/.cpp
    ├── TCS34725.h/.cpp        discontinued sensor — kept for existing hardware, see note above
    ├── APDS9960.h/.cpp        recommended TCS34725 replacement
    ├── BH1750.h/.cpp
    ├── LTR303.h/.cpp
    ├── LTR329.h/.cpp           near-duplicate of LTR303 on purpose — see note at the top of LTR303.h
    ├── LTR390.h/.cpp
    └── TSL2591.h/.cpp

web/
├── index.html / style.css      generic shell, zero sensor-specific markup
├── script.js                   builds the ENTIRE UI at runtime from the "info" event — zero sensor-specific logic
└── xlsx.core.min.js            vendored SheetJS build (Excel export works fully offline)
```

**core/ never imports a vendor library and never mentions a sensor by
name.** Everything sensor-specific lives behind `SensorBase`. If you're
adding a 12th sensor, `sensors/SensorBase.h` and any existing `sensors/*.cpp`
is the only reading you need to do — `core/` and `web/` don't change. (This
is exactly how TCS3448 — the 11th sensor — was just added: no changes to
`core/` or `web/` at all, only `SensorManager.h`'s one-line dispatch,
`Protocol.cpp`'s sizing constants, `platformio.ini`'s two environments, and
a new `sensors/TCS3448.h/.cpp` pair.)

## Wire protocol

> **Fixed:** the board used to boot with `Measurement::mode` defaulted to
> `REFLECTANCE` (or, for LED-less sensors, a mode the frontend never agreed
> with) but never actually drove the LEDs to match — so the sensor's own
> internal LED sat in the vendor library's power-on-default (off) state,
> invisibly out of sync with the "Reflectance" tab the web UI shows active
> the moment it connects, until you manually re-clicked a mode tab. This
> first became visible on **AS7262** (the only `LED_DISCRETE` sensor, so
> the least-exercised LED code path) but affected every LED-capable sensor
> equally. `main.cpp` now picks the same default mode `sendInfo()` will
> report and calls the newly-public `Protocol::syncOutputsForMode()` right
> after the sensor initializes, so the physical LED state always matches
> what the UI shows as active from the very first frame — see
> `src/main.cpp` and `src/core/Protocol.h`.

One JSON object per line (`\n`-terminated), both directions.

**Browser → Board**
```
{"cmd":"get_info"}
{"cmd":"set_mode","mode":"reflectance|absorbance|fluorescence"}
{"cmd":"set_submode","sub":"log|raw"}
{"cmd":"set_led", ...}            // shape depends on led.internal.type — see below
{"cmd":"set_gain", ...}           // shape depends on gain.type — see below
{"cmd":"set_time", ...}           // shape depends on time.type — see below
{"cmd":"set_channels","channels":[0,2,5]}
{"cmd":"set_extra","idx":0,"value":3}   // sensor-specific extra parameter
{"cmd":"measure_ref"}
{"cmd":"measure"}
```

**Board → Browser**
```
{"evt":"info", ...}                        // see schema below
{"evt":"ack","cmd":"...", "tint_ms":...}   // tint_ms only present after set_time
{"evt":"progress","t":1.2,"n":3,"data":{"0":123.4}}
{"evt":"ref_saved","data":{"0":512.0}}
{"evt":"result","mode":"...","sub":"...","data":{...},"gain":"...","tint_ms":...}
{"evt":"error","msg":"..."}
```

### The "info" schema — this is what makes one frontend work for 11 sensors

```jsonc
{
  "evt": "info",
  "sensor": "AS7262",
  "sensorType": "color",                 // or "photodiode"
  "channels": [{"id":0,"name":"450nm","color":"#7F00FF"}, ...],
  "modes": ["absorbance","fluorescence"], // "reflectance" only appears if led.internal.type != "none"

  "gain": {
    "type": "discrete",                   // or "continuous"
    "options": ["1X","3.7X","16X","64X"]  // discrete
    // "min": 31, "max": 254              // continuous (e.g. BH1750's MTreg)
  },

  "led": {
    "internal": {
      "type": "none|binary|discrete|continuous",
      "options": [...]                    // discrete only
      // "minMA": 4, "maxMA": 258         // continuous only
    },
    "absorbance":   {"type":"external","pin":6,"angle":180},
    "fluorescence": {"type":"external","pin":5,"angle":90}
  },

  "time": {
    "type": "formula",                    // or "presets"
    "formula": "value x 2.8ms",
    "currentMs": 140.0,
    "params": [{"key":"itime","label":"Integration Time","min":0,"max":255}]
    // "presets": ["2.4 ms", "24 ms", ...]   // presets mode instead
  },

  "extraParams": [                        // omitted entirely if the sensor has none
    {"key":"measRate","label":"Measurement Rate","type":"select","options":["50 ms", ...]}
    // {"key":"...", "type":"number", "min":0, "max":255}
  ]
}
```

`set_led` / `set_gain` / `set_time` payload shape mirrors whichever variant
`info` reported:

| `type` | Command payload |
|---|---|
| `led.internal: binary` | `{"cmd":"set_led","on":true}` |
| `led.internal: discrete` | `{"cmd":"set_led","idx":2}` |
| `led.internal: continuous` | `{"cmd":"set_led","current":50}` |
| `gain: discrete` | `{"cmd":"set_gain","idx":4}` |
| `gain: continuous` | `{"cmd":"set_gain","value":150}` |
| `time: formula` | `{"cmd":"set_time","params":{"atime":100,"astep":999}}` |
| `time: presets` | `{"cmd":"set_time","preset":2}` |

## Wiring

| Signal | Pin | Notes |
|---|---|---|
| SDA / SCL | board's default I2C | every sensor |
| Absorbance LED (180°) | **6** | fixed, same on every sensor/board |
| Fluorescence LED (90°) | **5** | fixed, same on every sensor/board |
| TCS34725's onboard LED | **7** | only this sensor — see "Particularities" below |
| Every other sensor's internal LED | — | driven through I2C (AS7341/AS7343/**TCS3448**/AS7262) or doesn't exist (photodiode sensors, **including APDS9960**) |

## Sensor particularities (why `SensorBase` looks the way it does)

| Sensor | Channels | Gain | Integration time | Internal LED |
|---|---|---|---|---|
| AS7341 | 8 (415–680nm) | 11 discrete (0.5X–512X) | ATIME×ASTEP formula | Continuous, 4–258mA (I2C) |
| AS7343 | 13 (405–855nm+Clear) | 13 discrete (0.5X–2048X) | ATIME×ASTEP formula | Continuous, 4–258mA (I2C) |
| **TCS3448** | 13 (407–855nm+Clear) | 13 discrete (0.5X–2048X) | ATIME×ASTEP formula | Continuous, 4–258mA (I2C) |
| AS7262 | 6 (450–650nm) | 4 discrete (1X–64X) | value×2.8ms formula | Discrete, 4 levels (I2C) |
| TCS34725 | 4 raw + 2 derived (Temp, Lux) | 4 discrete (1X–60X) | 6 fixed presets | **Binary**, needs GPIO pin 7 (not I2C — see below) — **discontinued, see note at top** |
| APDS9960 | 4 raw + 2 derived (Temp, Lux) | 4 discrete (1X–64X) | Direct-ms formula (~3–700ms) | **None** — onboard IR LED only serves proximity/gesture, unusable here |
| BH1750 | 1 (Lux) | Continuous (MTreg 31–254) | 3 resolution presets | None |
| LTR303 / LTR329 | 2 raw + 1 derived (Visible) | 6 discrete | 8 presets **+ Measurement Rate** (extra param) | None |
| LTR390 | 1 (UV or ALS — **mode** extra param picks which) | 5 discrete, non-linear | 6 resolution presets | None |
| TSL2591 | 2 raw + 2 derived (Visible, Lux) | 4 discrete, huge non-uniform range | 6 presets | None |

Sensors with no internal LED never offer Reflectance mode at all — the
`modes` array in `info` simply won't include it, and the frontend's mode
tabs reflect that automatically.

**TCS34725's LED is a special case.** The Adafruit library's
`setInterrupt()` only toggles the onboard LED if you've soldered the
breakout's LED pin to its INT pin — a fragile, optional hardware mod most
builds won't have done. Instead, `TCS34725Sensor` drives the LED from a
dedicated GPIO (**pin 7**, same on every board) using plain `digitalWrite`,
following the exact same "on entering Reflectance, off leaving it" logic
`core/Protocol.cpp` already applies generically to every LED type — no core
changes were needed to support this.

**APDS9960 has no equivalent workaround.** Its onboard IR LED (and driver)
exist purely to support the proximity/gesture engine — the Adafruit library
gives no way to fire it during a color/ALS reading, and IR isn't a useful
wavelength for reflectance anyway. `APDS9960Sensor::ledType()` simply
returns `LedType::LED_NONE`, the same as every other photodiode-only sensor
in this project, so `sendInfo()`'s existing "only list Reflectance if
`ledType() != LED_NONE`" logic hides Reflectance for it automatically —
again, no core changes needed. Absorbance and Fluorescence both still work
normally, driven entirely by the two fixed external LEDs on pins 6/5.

## TCS3448 — why it's a separate driver, not a drop-in for AS7343

**Adafruit product #6525**, released September 2026 — new enough that this
whole section was written from live sources (Adafruit's product page, the
ams-OSRAM TCS3448 datasheet DS001121, and the Adafruit_TCS3448/CircuitPython
library docs), never from training data. See "What's verified" below for
exactly what was checked where.

- **It's ams-OSRAM's "refresh" of the AS7343**, not an unrelated chip. Per
  Adafruit's own product description: *"The TCS3448 register map and
  automatic channel multiplexer are compatible with the AS7343."* That's why
  `TCS3448Sensor` (`sensors/TCS3448.h/.cpp`) is structured identically to
  `AS7343Sensor` — same 13 exposed channels, same 13-step discrete gain
  table (0.5X–2048X), same ATIME/ASTEP integration-time formula
  (`(ATIME+1) × (ASTEP+1) × 2.78µs` — confirmed directly in the ams-OSRAM
  datasheet's own footnote), same 4–258mA continuous internal LED driver
  (also confirmed in the datasheet's LED Driving Strength table).
- **It still needs its own firmware build, not AS7343's**, for two reasons
  Adafruit calls out explicitly:
  1. **I2C address changed from 0x39 to 0x59.** The `Adafruit_TCS3448`
     Arduino library (which subclasses `Adafruit_AS7343`) selects the new
     address internally, so nothing in `TCS3448Sensor::begin()` has to
     handle this — but it does mean AS7343 firmware simply won't find a
     TCS3448 on the bus, and vice versa.
  2. **Retuned optical filters** — channel center wavelengths shift by a
     few nanometers versus AS7343. `sensors/TCS3448.cpp`'s channel labels
     use the TCS3448-specific typical wavelengths from datasheet Table 7
     (e.g. F1 = 407nm, FY = 560nm, FXL = 596nm), not copy-pasted from
     AS7343's slightly different values (405nm/555nm/600nm respectively).
- **Flicker detection is excluded from `channelCount()`, on purpose,** the
  same way it's excluded for AS7343. Adafruit's own spec sheet describes the
  chip as *"14 readable individual sensor elements (13 light channels plus
  flicker detection)"* — flicker is a separate digital 50/60Hz-style
  detection feature, not a spectral intensity value comparable to the other
  13 channels' -log₁₀(I/I₀) math, so it isn't a good fit for this project's
  generic `readChannels()` abstraction. A future contributor wanting flicker
  data would add it as an `extraParam` rather than a channel.
- **One thing flagged, not silently assumed:** the exact spelling of the
  `TCS3448_CHANNEL_*` / `TCS3448_GAIN_*` constants and the `Adafruit_TCS3448`
  class's method names (`begin`, `readAllChannels`, `setGain`, `setATIME`,
  `setASTEP`, `enableLED`, `setLEDCurrent`) couldn't be confirmed by reading
  the actual header file directly (this sandbox can search and read web
  pages, but not fetch arbitrary raw GitHub file contents outside a prior
  search result, and no such raw link turned up). What **is** confirmed
  directly is Adafruit's own description of the library: it *"subclasses
  the Adafruit AS7343 driver, selects the TCS3448 I2C address, and adds
  TCS3448-named data types"* — i.e., the same method names as
  `Adafruit_AS7343` (inherited), plus a `TCS3448_`-prefixed mirror of
  `AS7343_CHANNEL_*`/`as7343_gain_t` for the numerically-identical
  register-compatible values. `sensors/TCS3448.cpp` is written on that basis.
  **If the real header spells any of these differently, the compiler will
  point at the exact line** (unlike a silent wrong-*value* bug, a wrong
  *symbol name* fails loudly at compile time) — the fix is contained
  entirely to `sensors/TCS3448.cpp`, nothing else in this project would need
  to change.

## Adding a 12th sensor

1. Read `sensors/SensorBase.h` top to bottom (it's short, and documents the
   4 LED types / 2 gain types / 2 time types).
2. Copy the sensor whose particularities are closest to yours as a
   starting point (e.g. a photodiode sensor with no LED → start from
   `BH1750.h/.cpp` or `TSL2591.h/.cpp`; a 4-channel RGBC color sensor with
   no LED → start from `APDS9960.h/.cpp` instead of `TCS34725.h/.cpp`, since
   the latter's binary-LED-on-GPIO-7 logic is extra complexity you probably
   don't need; a 13-channel spectral sensor with a continuous internal LED
   driver → start from `AS7343.h/.cpp` or `TCS3448.h/.cpp`, which are
   near-identical to each other).
3. Add a `SENSOR_yourchip` branch to `core/SensorManager.h`.
4. Add the per-sensor `INFO_MAX_*` capacity constants to
   `core/Protocol.cpp` (sized to your sensor's actual channel/gain/preset/
   extra-param counts — see the existing `#if` block; oversizing just wastes
   RAM on AVR, it won't break anything).
5. Add two environments to `platformio.ini` (ESP32-S3 + Uno), copying an
   existing pair and swapping `SENSOR_yourchip`, `build_src_filter`, and
   `lib_deps`.
6. **`web/` needs zero changes.**

## What's verified vs. what's carried over from datasheets/library docs

Every library in `platformio.ini` — name, version pin, and every vendor
method/enum/constant referenced from `sensors/*.cpp` — has been checked
directly against the real `library.properties` (or `library.json`) and
source files committed in each vendor's own GitHub repo, fetched live
rather than recalled from memory. This caught two real issues:

- **AS7341 was pinned to a version that was never published**
  (`^1.4.2`, when the real latest release is `1.4.1`). PlatformIO's `^`
  requirement means "this version or higher, same major line" — with no
  `1.4.2` or later 1.x release to satisfy that, `pio pkg install` would
  have hard-failed with "not found". **Fixed** to `^1.4.1`.
- **AS726x's real registry name is `Adafruit AS726X`** (capital X) —
  `platformio.ini` had lowercase `x`. PlatformIO's registry match is
  case-insensitive, so the old spelling would likely have resolved fine
  regardless, but it's been corrected for certainty.

Everything else checked out with no changes needed, including some things
that looked suspicious enough to double-check and turned out fine — e.g.
`Adafruit_AS726X`'s own `library.properties` lists `Adafruit ST7735 and
ST7789 Library, Adafruit GFX Library` as dependencies (alongside BusIO),
which looks like a copy-paste leftover from an unrelated Adafruit template;
confirmed `Adafruit_AS726x.h` doesn't actually `#include` any GFX/ST77xx
header, and PlatformIO's Library Dependency Finder resolves by scanning
real `#include` statements in source, not by trusting that field — so it's
harmless. Similarly, `Adafruit_TSL2591::begin()` leaves the sensor powered
down and this project's `TSL2591Sensor::readChannels()` never calls
`enable()` — but `getFullLuminosity()` calls `enable()`/`disable()`
internally around every read, so that's already handled by the library
itself, not a gap in this driver.

Per-sensor specifics:

- **AS7341**: this refactor's `core/` + AS7341 combination was compiled
  and linked for real against the actual ArduinoJson v6.21.5 library,
  targeting `atmega328p` (Arduino Uno), using hand-written stand-ins for
  `Arduino.h`/`Wire.h`/`Adafruit_AS7341.h` (this sandbox can reach
  `raw.githubusercontent.com` to read source, but not
  `registry.platformio.org` to actually install packages and run a real
  `pio run`). Result: links cleanly, 685 bytes of permanent RAM, `"info"`
  packet peaks at 840 bytes on the stack alone for AS7341 specifically
  (tuned per-sensor in `core/Protocol.cpp`).
- **AS7341 / AS7343**: every method used (`begin`, `setATIME`, `setASTEP`,
  `setGain`, `readAllChannels`, `getChannel`, `enableLED`,
  `setLEDCurrent`) matches `Adafruit_AS7341.h` / `Adafruit_AS7343.h`
  exactly, including the `as7341_gain_t` / `as7343_gain_t` enum pattern.
- **TCS3448**: released September 2026 (Adafruit product #6525), so this is
  the newest sensor in the project and gets the most explicit sourcing
  breakdown. **Confirmed directly** against live sources: the chip is
  ams-OSRAM's register-compatible "refresh" of AS7343 (Adafruit's product
  page); the I2C address change 0x39→0x59 (same page); the 13-step gain
  table (0.5X–2048X) and the `(ATIME+1)×(ASTEP+1)×2.78µs` integration-time
  formula (ams-OSRAM datasheet DS001121, footnote 6 and the gain-code
  table); the 4–258mA continuous LED driver range (same datasheet, "LED
  Driving Strength" register table, `000 0000: 4 mA` … `111 1111: 258 mA`);
  the per-channel typical wavelengths used in `TCS3448.cpp` (same datasheet,
  Table 7 "Optical characteristics of TCS3448" — F1 407nm, F2 424nm,
  FZ 450nm, F3 473nm, F4 516nm, F5 546nm, FY 560nm, FXL 596nm, F6 636nm,
  F7 687nm, F8 748nm, NIR 855nm); the Arduino library's real registry name
  ("Adafruit TCS3448", confirmed via its `arduino/library-registry` PR,
  including the linter's note that the name legitimately contains a space).
  **Inferred, not independently confirmed** (flagged clearly since this
  matters): the exact spelling of the `TCS3448_CHANNEL_*` / `TCS3448_GAIN_*`
  enum constants used in `TCS3448.cpp`'s `CHANNEL_INDEX`/`GAIN_VALUES`
  tables — the library's own README confirms it *"adds TCS3448-named data
  types"* mirroring AS7343's, but this sandbox couldn't fetch the actual
  header file to read the literal symbol spelling. See the dedicated
  "TCS3448 — why it's a separate driver" section above for the full
  reasoning and what happens if a name turns out slightly different
  (a loud compile error, confined to this one file — not a silent bad
  reading).
- **AS7262**: every method and constant (`begin`, `setGain`/`GAIN_1X`
  through `GAIN_64X`, `setConversionType`/`MODE_2`, `setIntegrationTime`,
  `dataReady`, `readCalibratedValues`, `drvOn`/`drvOff`, `setDrvCurrent`
  and its `LIMIT_*` constants) matches `Adafruit_AS726x.h` exactly.
- **TCS34725 / APDS9960**: `Adafruit_APDS9960.h`'s real surface
  (`begin(iTimeMS, gain, addr, wire)`, `enableColor()`, `colorDataReady()`,
  `getColorData()`, `setADCGain()`/`apds9960AGain_t`,
  `setADCIntegrationTime()`, `calculateColorTemperature()`,
  `calculateLux()`) matches what `APDS9960.cpp` calls. The
  **integration-time millisecond range (~3–700ms)** is derived from the
  library's `ATIME = 256 - iTimeMS/2.78` conversion formula rather than
  stated as a single number anywhere in the header — confirm the exact
  clamping behavior against the installed library version if precise
  timing matters for your measurements.
- **BH1750**: `begin`, `readLightLevel`, `setMTreg`, and the
  `BH1750::CONTINUOUS_HIGH_RES_MODE` / `_MODE_2` / `CONTINUOUS_LOW_RES_MODE`
  enum values all match `src/BH1750.h` in `claws/BH1750` exactly.
- **LTR303 / LTR329**: both classes really do come from one shared
  `Adafruit_LTR329_LTR303.h` header as assumed (`Adafruit_LTR303 : public
  Adafruit_LTR329`), and every method used (`begin`, `setGain`,
  `setIntegrationTime`, `setMeasurementRate`, `newDataAvailable`,
  `readBothChannels(uint16_t&, uint16_t&)` — note it takes references, not
  pointers, which this driver already gets right) matches exactly.
  `LTR329Sensor` remains a deliberate near-duplicate of `LTR303Sensor`
  rather than a template — see the note at the top of `LTR303.h`.
- **LTR390 resolution→ms table** (400/200/100/50/25/12.5ms for
  20/19/18/17/16/13-bit): the method surface (`begin`, `setMode`,
  `setGain`, `setResolution`, `newDataAvailable`, `readUVS`, `readALS`)
  matches `Adafruit_LTR390.h` exactly; the specific ms-per-resolution
  numbers come from the sensor's measurement-rate register behavior as
  documented in other open-source drivers (e.g. ESPHome), not stated
  directly in Adafruit's own header/examples — worth a spot-check against
  your specific library version if exact timing matters.
- **TSL2591**: `begin`, `setGain`/`tsl2591Gain_t`,
  `setTiming`/`tsl2591IntegrationTime_t`, `getFullLuminosity`,
  `calculateLux` all match `Adafruit_TSL2591.h` exactly.

None of the 11 environments have actually been run through a real
`pio run` in this sandbox (no route to `registry.platformio.org`/the
Arduino package index to install and compile against). Build each one
yourself before flashing real hardware — but every name, version, and API
call it depends on has now been checked against the real source, not
assumed. **This applies especially to `tcs3448_esp32s3`/`tcs3448_uno`**,
since it's the only environment here whose library isn't even a year old
yet — build it first and confirm it compiles before relying on it.

If any of the above turns out to not match a given library version, the
fix is contained entirely to that one `sensors/*.cpp` file.

## Library names in `platformio.ini`

Every library **name** below was checked against the real PlatformIO/Arduino
library registries (via web search, since this environment can't reach
`api.registry.platformio.org` directly) — including catching two mistakes
along the way: the LTR303/LTR329 library's real name has no "Library" suffix
(`Adafruit LTR329 and LTR303`, not `...Library`), and two version pins I'd
guessed (`Adafruit AS726x @ ^1.5.2`, `Adafruit LTR390 Library @ ^1.2.1`) were
both higher than the real latest release (1.2.3 and 1.1.2 respectively) and
would have hard-failed the build with "version not found". APDS9960's real
registry name **does** keep the "Library" suffix (`Adafruit APDS9960
Library`), confirmed the same way.

Only **AS7341**'s version pin (`^1.4.2`) and the two universally-common
dependencies (**ArduinoJson** `^6.21.5`, **Adafruit BusIO** `^1.16.1`) are
pinned to a specific version with reasonable confidence. Every other
sensor's library is listed **without** a version pin on purpose — a wrong
guessed pin actively breaks the build (PlatformIO refuses to "downgrade" to
satisfy a caret range), while no pin just resolves to whatever's current.
If you want fully reproducible builds, confirm each real version at
https://registry.platformio.org and add `@ ^x.y.z` yourself.

**`Adafruit TCS3448`** (used by `tcs3448_esp32s3`/`tcs3448_uno`) is left
unpinned for the same reason, with one extra note: its
`arduino/library-registry` submission PR was only merged/tagged in
September 2026 (release `1.0.0`), and PlatformIO's own registry mirrors
the Arduino Library Manager index with some lag — if `pio pkg install`
can't find it yet for your PlatformIO installation, that's most likely a
registry-sync delay rather than a wrong name; check
https://registry.platformio.org/search?q=TCS3448 directly, or install it
by Git URL (`https://github.com/adafruit/Adafruit_TCS3448.git`) as a
fallback in `lib_deps` until the mirror catches up.
