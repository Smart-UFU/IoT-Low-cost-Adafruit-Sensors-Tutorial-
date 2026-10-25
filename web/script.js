// =============================================================================
// Sensor Tutorial Series — generic Web Serial client
// -----------------------------------------------------------------------------
// This file has ZERO sensor-specific logic. Every control (modes, gain, LED,
// integration time, extra params, channels) is built at runtime from the
// "info" event the board sends on connect. Swapping firmware to a different
// sensor should require zero changes here — that's the whole point of the
// SensorBase abstraction on the firmware side.
// =============================================================================

(function () {
  'use strict';

  // ── State ──
  let port = null;
  let reader = null;
  let writer = null;
  let sensorInfo = null;

  let currentMode = null;
  let currentSubmode = 'log';
  let selectedChannels = new Set();
  let referenceValid = false;
  let isMeasuring = false;
  let controlsLocked = false;
  let infoForTable = null;        // info of the sensor the table/export currently show

  // What the board has ACKNOWLEDGED (as opposed to the pending* values below,
  // which are only what the dropdowns currently show).
  let timeTouched = false;        // user changed integration time since connect
  let appliedTimeKey = 'default'; // last time config the board acked
  let appliedExtras = {};         // extra-param idx -> value the board acked
  let measureGainLabel = '';      // gain snapshot taken when Measure was pressed
  let refInfo = null;             // config the stored reference was measured with

  let results = [];
  let resultIdCounter = 1;

  // ── DOM references ──
  const btnConnect      = document.getElementById('btn-connect');
  const app             = document.getElementById('app');
  const sensorNameEl    = document.getElementById('sensor-name');
  const sensorTypeEl    = document.getElementById('sensor-type');

  const modeTabsEl       = document.getElementById('mode-tabs');
  const panelLed         = document.getElementById('panel-led');
  const panelSubmode     = document.getElementById('panel-submode');
  const submodeTabs      = document.querySelectorAll('.submode-tab');
  const panelRef         = document.getElementById('panel-ref');
  const btnRef           = document.getElementById('btn-ref');
  const refStatus        = document.getElementById('ref-status');

  const panelGain        = document.getElementById('panel-gain');
  const panelTime        = document.getElementById('panel-time');
  const panelExtras      = document.getElementById('panel-extras');
  const timeHint         = document.getElementById('time-hint');
  const tintValue        = document.getElementById('tint-value');
  const btnApplyConfig   = document.getElementById('btn-apply-config');

  const channelGrid      = document.getElementById('channel-grid');

  const btnMeasure       = document.getElementById('btn-measure');
  const progressArea     = document.getElementById('progress-area');
  const progressText     = document.getElementById('progress-text');
  const progressBar      = document.getElementById('progress-bar');
  const progressLive     = document.getElementById('progress-live');

  const resultsHeadRow   = document.getElementById('results-head-row');
  const resultsBody      = document.getElementById('results-body');
  const btnClearAll      = document.getElementById('btn-clear-all');
  const btnDownloadCsv   = document.getElementById('btn-download-csv');
  const btnDownloadXlsx  = document.getElementById('btn-download-xlsx');

  // Live values the user is editing, sent to the board on "Apply Configuration"
  let pendingGainIdx = 0;
  let pendingGainValue = 0;
  let pendingTimeParams = {};   // { key: value } for TIME_FORMULA sensors
  let pendingTimePreset = 0;    // for TIME_PRESETS sensors
  let pendingLedMA = 0;
  let pendingLedIdx = 0;
  let pendingLedOn = true;

  // =============================================================================
  // WEB SERIAL
  // =============================================================================
  if (!('serial' in navigator)) {
    document.body.innerHTML =
      '<div style="padding:40px;text-align:center;color:#fff;font-family:sans-serif">' +
      '<h2>Web Serial not supported</h2>' +
      '<p style="color:#999;margin-top:10px">Open this page in Google Chrome or Microsoft Edge (desktop).</p>' +
      '</div>';
    return;
  }

  btnConnect.addEventListener('click', async function () {
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      writer = port.writable.getWriter();
      readLoop();
      btnConnect.textContent = 'Connected';
      btnConnect.disabled = true;
      requestInfoUntilReady();
    } catch (e) {
      showToast('Failed to connect: ' + e.message, 'error');
    }
  });

  // Opening the serial port resets the board (DTR toggle), and on Windows the
  // driver can take longer than any single fixed delay to actually finish
  // that reset before the sketch's setup() runs. A one-shot "wait 1.5s then
  // send get_info" can fire while the board is still resetting/bootloading,
  // so the command is silently lost and the page hangs on "waiting for
  // connection" forever. Instead, keep asking every second until sensorInfo
  // actually arrives (onInfo sets it), for up to ~10s.
  function requestInfoUntilReady() {
    let attempts = 0;
    const maxAttempts = 10; // ~10s at 1000ms apart
    const intervalId = setInterval(() => {
      if (sensorInfo) { clearInterval(intervalId); return; }
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(intervalId);
        showToast('Board did not respond. Try reconnecting.', 'error');
        return;
      }
      sendCommand({ cmd: 'get_info' }).catch(() => {});
    }, 1000);
  }

  async function sendCommand(obj) {
    if (!writer) throw new Error('Not connected');
    const line = JSON.stringify(obj) + '\n';
    console.log('[SERIAL TX]', line.trim()); // TEMP DEBUG
    await writer.write(new TextEncoder().encode(line));
  }

  // ---------------------------------------------------------------------------
  // Request queue: ONE command in flight at a time, each waits for the board's
  // answer (ack / result / error) before the next is written.
  // Why: the board only reads Serial between commands (and not at all during
  // the 10 s measurement). On an Uno the RX buffer is 64 bytes, so commands
  // fired back-to-back were truncated/merged -> "Invalid JSON" and settings
  // silently lost (the next valid command got glued onto the broken one).
  // ---------------------------------------------------------------------------
  let pending = null;
  let queueTail = Promise.resolve();

  function request(obj, timeoutMs) {
    const job = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending && pending.timer === timer) pending = null;
        reject(new Error('No response from the board to "' + obj.cmd + '". Check the connection.'));
      }, timeoutMs || 4000);
      pending = { cmd: obj.cmd, resolve, reject, timer };
      sendCommand(obj).catch(err => {
        clearTimeout(timer);
        if (pending && pending.timer === timer) pending = null;
        reject(err);
      });
    });
    const p = queueTail.then(job);
    queueTail = p.catch(() => {});
    return p;
  }

  function settlePending(evt, msg) {
    if (!pending) return;
    let ok = false;
    if (evt === 'ack') ok = (msg.cmd === pending.cmd);
    else if (evt === 'result') ok = (pending.cmd === 'measure');
    else if (evt === 'ref_saved') ok = (pending.cmd === 'measure_ref');
    else if (evt === 'info') ok = (pending.cmd === 'get_info');
    else if (evt === 'error') {
      const p = pending; pending = null; clearTimeout(p.timer);
      const err = new Error(msg.msg || 'Device error');
      err.fromDevice = true; // already shown as a toast by handleIncoming
      p.reject(err);
      return;
    }
    if (ok) { const p = pending; pending = null; clearTimeout(p.timer); p.resolve(msg); }
  }

  function reportError(e) { if (!e.fromDevice) showToast(e.message, 'error'); }
  // fire-and-forget for UI controls that apply immediately (still serialized)
  function fire(obj) { return request(obj).catch(reportError); }

  async function readLoop() {
    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          console.log('[SERIAL RX]', JSON.stringify(line)); // TEMP DEBUG
          if (line.length > 0) handleIncoming(line);
        }
      }
    } catch (e) {
      showToast('Serial connection lost', 'error');
    } finally {
      handleDisconnect();
    }
  }

  function handleDisconnect() {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
      pending = null;
    }
    try { if (writer) writer.releaseLock(); } catch (e) {}
    try { if (port) port.close(); } catch (e) {}
    writer = null; reader = null; sensorInfo = null;
    setMeasuringUI(false);
    btnConnect.textContent = 'Connect via USB';
    btnConnect.disabled = false;
  }

  function handleIncoming(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { console.log('[SERIAL RX] JSON parse FAILED:', e.message); return; } // TEMP DEBUG

    try {
      switch (msg.evt) {
        case 'info':      onInfo(msg); break;
        case 'ack':        onAck(msg); break;
        case 'progress':   onProgress(msg); break;
        case 'ref_saved':  onRefSaved(msg); break;
        case 'result':     onResult(msg); break;
        case 'error':
          // An error while measuring means no "result" will ever arrive, so
          // leave the measuring state instead of spinning forever.
          if (isMeasuring) setMeasuringUI(false);
          showToast(msg.msg || 'Device error', 'error');
          break;
      }
    } catch (e) {
      console.error('Error handling', msg.evt, e);
      if (isMeasuring && (msg.evt === 'result' || msg.evt === 'ref_saved')) setMeasuringUI(false);
    }
    settlePending(msg.evt, msg);
  }

  function onAck(msg) {
    if (msg.cmd === 'set_time' && msg.tint_ms !== undefined) {
      tintValue.textContent = msg.tint_ms.toFixed(2) + ' ms';
    }
  }

  // =============================================================================
  // "info" -> build the entire UI
  // =============================================================================
  function onInfo(msg) {
    // get_info is retried until the first answer arrives, so duplicates can
    // show up late. Rebuilding the UI for them wiped the user's channel and
    // gain selections without telling the board -> ignore every one after the
    // first.
    if (sensorInfo) { applyInfoUpdate(msg); return; }
    sensorInfo = msg;
    infoForTable = msg;
    timeTouched = false; appliedTimeKey = 'default'; appliedExtras = {};
    measureGainLabel = ''; refInfo = null;

    sensorNameEl.textContent = msg.sensor;
    sensorTypeEl.textContent = (msg.sensorType === 'photodiode')
      ? 'Photodiode-Based Irradiance Sensor'
      : 'Color Sensor';

    buildChannelGrid();
    buildModeTabs();
    buildLedPanel();
    buildGainPanel();
    buildTimePanel();
    buildExtraParams();

    tintValue.textContent = (msg.time && msg.time.currentMs !== undefined)
      ? msg.time.currentMs.toFixed(2) + ' ms'
      : '—';

    currentMode = msg.modes[0];
    setActiveModeTab(currentMode);

    // The submode tabs always start with "log" (With Reference) marked
    // active in the HTML/UI, regardless of what a *previous* connection may
    // have left `currentSubmode` as. Reset the JS state to match what the
    // screen actually shows so the sync below sends the right value.
    currentSubmode = 'log';
    submodeTabs.forEach(t => t.classList.toggle('active', t.dataset.sub === currentSubmode));
    referenceValid = false;
    refStatus.classList.add('hidden');

    updateModeUI();

    app.classList.remove('hidden');
    showToast('Sensor connected: ' + msg.sensor, 'success');

    // IMPORTANT — this fixes the "first measurement uses the wrong mode"
    // bug: the board boots with its OWN hardcoded defaults (mode =
    // reflectance, submode = raw — see Measurement.cpp), which do not
    // necessarily match the mode/submode tab shown as "selected" above.
    // Without telling the board explicitly, the first measurement silently
    // runs using the board's default instead of what's highlighted on
    // screen, until the user re-clicks a tab (which is what finally sends
    // the command). Sync the board to the UI's selection right away so the
    // very first measurement after connecting is already correct.
    fire({ cmd: 'set_mode', mode: currentMode });
    fire({ cmd: 'set_submode', sub: currentSubmode });

    // Results of a DIFFERENT sensor have other channels/columns: keep them in
    // memory (nothing is lost) but don't draw them under this sensor's headers.
    renderResults();
    const hidden = results.filter(r => r.sensor && r.sensor !== msg.sensor).length;
    if (hidden > 0) showToast(hidden + ' result(s) from another sensor are kept but hidden until you reconnect it', 'success');
  }

  // A later "info" (after set_extra, or a late duplicate of the first one).
  // Some sensors rename their channel with an extra parameter (LTR390:
  // Ambient Light <-> UV Index), and the integration time can change too. Update
  // names/time IN PLACE, without rebuilding anything the user has selected.
  function applyInfoUpdate(msg) {
    if (msg.time && msg.time.currentMs !== undefined) {
      sensorInfo.time.currentMs = msg.time.currentMs;
      tintValue.textContent = msg.time.currentMs.toFixed(2) + ' ms';
    }
    if (!msg.channels || JSON.stringify(msg.channels) === JSON.stringify(sensorInfo.channels)) return;
    sensorInfo.channels = msg.channels;
    channelGrid.querySelectorAll('.channel-chip').forEach(chip => {
      const ch = msg.channels.find(c => String(c.id) === chip.dataset.id);
      if (!ch) return;
      chip.lastElementChild.textContent = ch.name;
      chip.firstElementChild.style.background = ch.color;
    });
    resultsHeadRow.querySelectorAll('[data-ch-header]').forEach(th => {
      const ch = msg.channels.find(c => String(c.id) === th.dataset.chHeader);
      if (ch) th.textContent = ch.name;
    });
    renderResults();
  }

  // ── Channels ──
  function buildChannelGrid() {
    channelGrid.innerHTML = '';
    resultsHeadRow.querySelectorAll('[data-ch-header]').forEach(el => el.remove());
    selectedChannels.clear();

    sensorInfo.channels.forEach(ch => {
      const chip = document.createElement('div');
      chip.className = 'channel-chip';
      chip.dataset.id = ch.id;
      chip.innerHTML =
        '<span class="channel-swatch" style="background:' + ch.color + '"></span>' +
        '<span>' + ch.name + '</span>';
      chip.addEventListener('click', () => toggleChannel(ch.id, chip));
      channelGrid.appendChild(chip);

      const th = document.createElement('th');
      th.textContent = ch.name;
      th.dataset.chHeader = ch.id;
      resultsHeadRow.insertBefore(th, resultsHeadRow.lastElementChild);
    });
  }

  function toggleChannel(id, chipEl) {
    if (controlsLocked) return;
    if (selectedChannels.has(id)) { selectedChannels.delete(id); chipEl.classList.remove('selected'); }
    else { selectedChannels.add(id); chipEl.classList.add('selected'); }
  }

  // ── Mode tabs ──
  function buildModeTabs() {
    modeTabsEl.innerHTML = '';
    const labels = { reflectance: 'Reflectance', absorbance: 'Absorbance', fluorescence: 'Fluorescence' };
    sensorInfo.modes.forEach(mode => {
      const tab = document.createElement('button');
      tab.className = 'mode-tab';
      tab.dataset.mode = mode;
      tab.textContent = labels[mode] || mode;
      tab.addEventListener('click', () => {
        currentMode = mode;
        referenceValid = false;
        refStatus.classList.add('hidden');
        setActiveModeTab(mode);
        updateModeUI();
        refInfo = null; // switching modes invalidates the reference on the board too
        fire({ cmd: 'set_mode', mode });
      });
      modeTabsEl.appendChild(tab);
    });
  }

  function setActiveModeTab(mode) {
    modeTabsEl.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  }

  function updateModeUI() {
    // LED panel only shown in Reflectance mode
    panelLed.classList.toggle('hidden', currentMode !== 'reflectance');

    // Submode (log/raw) available for Reflectance and Absorbance
    const hasSubmode = (currentMode === 'reflectance' || currentMode === 'absorbance');
    panelSubmode.classList.toggle('hidden', !hasSubmode);

    const showRef = hasSubmode && currentSubmode === 'log';
    panelRef.classList.toggle('hidden', !showRef);
  }

  submodeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      submodeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentSubmode = tab.dataset.sub;
      updateModeUI();
      fire({ cmd: 'set_submode', sub: currentSubmode });
    });
  });

  btnRef.addEventListener('click', async () => {
    if (isMeasuring || controlsLocked) return;
    if (selectedChannels.size === 0) {
      showToast('Select at least one channel before measuring the reference', 'error');
      return;
    }
    setMeasuringUI(true, 'Applying configuration...');
    try {
      // The reference must be taken with EXACTLY the gain/time/channels the
      // sample will use, so apply the on-screen configuration first.
      const cfg = await applyConfig();
      progressText.textContent = 'Measuring reference...';
      await request({ cmd: 'measure_ref' }, 40000);
      refInfo = cfg; // remembered for the consistency check in Measure
    } catch (e) {
      const was = isMeasuring;
      setMeasuringUI(false);
      if (was) reportError(e);
    }
  });

  // ── LED panel (shape depends on info.led.internal.type) ──
  function buildLedPanel() {
    panelLed.innerHTML = '';
    const led = sensorInfo.led.internal;

    if (led.type === 'none') {
      return; // stays hidden; Reflectance won't even be in modes[]
    }

    if (led.type === 'binary') {
      panelLed.innerHTML = '<label>Internal LED</label>';
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline';
      btn.textContent = 'LED: On';
      let on = (led.current === undefined) ? true : (led.current !== 0);
      pendingLedOn = on;
      btn.textContent = 'LED: ' + (on ? 'On' : 'Off');
      btn.addEventListener('click', () => {
        on = !on;
        pendingLedOn = on;
        btn.textContent = 'LED: ' + (on ? 'On' : 'Off');
        fire({ cmd: 'set_led', on });
      });
      panelLed.appendChild(btn);

    } else if (led.type === 'discrete') {
      panelLed.innerHTML = '<label for="led-select">Internal LED Current</label>';
      const select = document.createElement('select');
      select.id = 'led-select';
      led.options.forEach((label, i) => {
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = label;
        select.appendChild(opt);
      });
      pendingLedIdx = (typeof led.current === 'number' && led.current >= 0 && led.current < led.options.length) ? led.current : 0;
      select.value = pendingLedIdx;
      select.addEventListener('change', () => {
        pendingLedIdx = parseInt(select.value, 10);
        fire({ cmd: 'set_led', idx: pendingLedIdx });
      });
      panelLed.appendChild(select);

    } else if (led.type === 'continuous') {
      const ledStart = (typeof led.current === 'number' && led.current >= led.minMA && led.current <= led.maxMA)
        ? led.current : led.minMA;
      panelLed.innerHTML =
        '<label for="led-range">Internal LED Current (mA)</label>' +
        '<div class="slider-row">' +
          '<input type="range" id="led-range" min="' + led.minMA + '" max="' + led.maxMA + '" value="' + ledStart + '">' +
          '<span id="led-range-value" class="value-badge">' + ledStart + ' mA</span>' +
        '</div>';
      const range = document.getElementById('led-range');
      const valueBadge = document.getElementById('led-range-value');
      pendingLedMA = ledStart;
      range.addEventListener('input', () => { valueBadge.textContent = range.value + ' mA'; });
      range.addEventListener('change', () => {
        pendingLedMA = parseInt(range.value, 10);
        fire({ cmd: 'set_led', current: pendingLedMA });
      });
    }
  }

  // ── Gain panel (discrete dropdown or continuous slider) ──
  function buildGainPanel() {
    panelGain.innerHTML = '';
    const gain = sensorInfo.gain;

    if (gain.type === 'discrete') {
      panelGain.innerHTML = '<label for="gain-select">Gain</label>';
      const select = document.createElement('select');
      select.id = 'gain-select';
      gain.options.forEach((label, i) => {
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = label;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => { pendingGainIdx = parseInt(select.value, 10); });
      panelGain.appendChild(select);
      // Start on the gain the chip is ACTUALLY using (reported in "info"), not
      // on option 0: previously the page showed e.g. 0.5X while the chip was
      // still at its boot gain (16X/256X/...), so a measurement taken without
      // pressing Apply was recorded under the wrong gain.
      pendingGainIdx = (typeof gain.current === 'number' && gain.current >= 0 &&
                        gain.current < gain.options.length) ? gain.current : 0;
      select.value = pendingGainIdx;

    } else { // continuous
      const startVal = (typeof gain.current === 'number' && gain.current >= gain.min && gain.current <= gain.max)
        ? gain.current : gain.min;
      panelGain.innerHTML =
        '<label for="gain-range">Gain (sensitivity)</label>' +
        '<div class="slider-row">' +
          '<input type="range" id="gain-range" min="' + gain.min + '" max="' + gain.max + '" value="' + startVal + '">' +
          '<span id="gain-range-value" class="value-badge">' + startVal + '</span>' +
        '</div>';
      const range = document.getElementById('gain-range');
      const valueBadge = document.getElementById('gain-range-value');
      pendingGainValue = startVal;
      range.addEventListener('input', () => {
        valueBadge.textContent = range.value;
        pendingGainValue = parseFloat(range.value);
      });
    }
  }

  // ── Integration time panel (formula params or presets dropdown) ──
  function buildTimePanel() {
    panelTime.innerHTML = '';
    pendingTimeParams = {};
    const time = sensorInfo.time;

    timeHint.textContent = time.formula ? ('Formula: ' + time.formula) : '';

    if (time.type === 'formula') {
      time.params.forEach(p => {
        const startV = (typeof p.value === 'number') ? p.value : p.min;
        pendingTimeParams[p.key] = startV;
        const row = document.createElement('div');
        row.className = 'form-row';
        row.innerHTML =
          '<div class="form-group">' +
            '<label>' + p.label + ' (' + p.min + '\u2013' + p.max + ')</label>' +
            '<input type="number" min="' + p.min + '" max="' + p.max + '" value="' + startV + '" data-key="' + p.key + '">' +
          '</div>';
        row.querySelector('input').addEventListener('input', (e) => {
          pendingTimeParams[p.key] = parseInt(e.target.value, 10) || 0;
          timeTouched = true;
        });
        panelTime.appendChild(row);
      });
    } else { // presets
      panelTime.innerHTML = '<label for="time-select">Integration Time</label>';
      const select = document.createElement('select');
      select.id = 'time-select';
      time.presets.forEach((label, i) => {
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = label;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => { pendingTimePreset = parseInt(select.value, 10); timeTouched = true; });
      panelTime.appendChild(select);
      pendingTimePreset = (typeof time.current === 'number' && time.current >= 0 && time.current < time.presets.length)
        ? time.current : 0;
      select.value = pendingTimePreset;
    }
  }

  // Only a value the board ACKNOWLEDGED counts as applied (fire() swallows
  // errors, so .then() on it would also run after a failure).
  function setExtra(idx, value) {
    return request({ cmd: 'set_extra', idx, value })
      .then(() => { appliedExtras[idx] = value; return request({ cmd: 'get_info' }); })
      .catch(reportError);
  }

  // ── Extra sensor-specific parameters ──
  function buildExtraParams() {
    panelExtras.innerHTML = '';
    const extras = sensorInfo.extraParams || [];
    extras.forEach((ep, idx) => {
      const row = document.createElement('div');
      row.className = 'form-group';
      if (ep.type === 'select') {
        row.innerHTML = '<label>' + ep.label + '</label>';
        const select = document.createElement('select');
        ep.options.forEach((label, i) => {
          const opt = document.createElement('option');
          opt.value = i; opt.textContent = label;
          select.appendChild(opt);
        });
        const curSel = (typeof ep.current === 'number' && ep.current >= 0 && ep.current < ep.options.length) ? ep.current : 0;
        select.value = curSel;
        appliedExtras[idx] = curSel;
        select.addEventListener('change', () => setExtra(idx, parseInt(select.value, 10)));
        row.appendChild(select);
      } else {
        const curNum = (typeof ep.current === 'number' && ep.current >= 0) ? ep.current : ep.min;
        appliedExtras[idx] = curNum;
        row.innerHTML =
          '<label>' + ep.label + ' (' + ep.min + '\u2013' + ep.max + ')</label>' +
          '<input type="number" min="' + ep.min + '" max="' + ep.max + '" value="' + curNum + '">';
        row.querySelector('input').addEventListener('change', (e) => {
          setExtra(idx, parseInt(e.target.value, 10) || 0);
        });
      }
      panelExtras.appendChild(row);
    });
  }

  // ── Apply Configuration ──
  // Sends gain / integration time / channels ONE AT A TIME, waiting for the
  // board's ack after each. Resolves with a snapshot of what was applied.
  // `force` = also (re)send integration time even if the user never touched it
  // (the explicit Apply button does that; Measure only does when it changed,
  // so an untouched form can't overwrite the board's own default time).
  // The internal LED only matters in Reflectance (same rule as the firmware).
  function ledKey() {
    return currentMode === 'reflectance' ? [pendingLedOn, pendingLedIdx, pendingLedMA].join('|') : '';
  }

  async function applyConfig(force) {
    let gainLabel;
    if (sensorInfo.gain.type === 'discrete') {
      await request({ cmd: 'set_gain', idx: pendingGainIdx });
      gainLabel = sensorInfo.gain.options[pendingGainIdx] || '';
    } else {
      await request({ cmd: 'set_gain', value: pendingGainValue });
      gainLabel = String(pendingGainValue);
    }

    if (force || timeTouched) {
      const timeReq = (sensorInfo.time.type === 'formula')
        ? { cmd: 'set_time', params: Object.assign({}, pendingTimeParams) }
        : { cmd: 'set_time', preset: pendingTimePreset };
      await request(timeReq);
      appliedTimeKey = JSON.stringify(timeReq);
      timeTouched = false;
    }

    const chans = Array.from(selectedChannels).sort((a, b) => a - b);
    await request({ cmd: 'set_channels', channels: chans });

    return {
      gainLabel,
      timeKey: appliedTimeKey,
      extrasKey: JSON.stringify(appliedExtras),
      ledKey: ledKey(),
      channels: new Set(chans)
    };
  }

  btnApplyConfig.addEventListener('click', async () => {
    if (isMeasuring || controlsLocked) return;
    if (selectedChannels.size === 0) {
      showToast('Select at least one channel', 'error');
      return;
    }
    setControlsLocked(true);
    try {
      await applyConfig(true);
      showToast('Configuration applied', 'success'); // only after every ack
    } catch (e) {
      reportError(e);
    } finally {
      setControlsLocked(false);
    }
  });

  // =============================================================================
  // MEASUREMENT
  // =============================================================================
  btnMeasure.addEventListener('click', async () => {
    if (isMeasuring || controlsLocked) return;
    if (selectedChannels.size === 0) {
      showToast('Select at least one channel', 'error');
      return;
    }
    const needsRef = (currentMode !== 'fluorescence') && currentSubmode === 'log';
    if (needsRef && !referenceValid) {
      showToast('Measure the reference first (\u2212log\u2081\u2080 I/I\u2080 mode)', 'error');
      return;
    }
    if (needsRef && refInfo) {
      // A reference is only valid for the gain / integration time / extras /
      // channels it was measured with. During a gain sweep this is easy to
      // forget and gives plausible-looking but wrong -log10(I/I0) numbers.
      const gainNow = (sensorInfo.gain.type === 'discrete')
        ? (sensorInfo.gain.options[pendingGainIdx] || '') : String(pendingGainValue);
      const missing = Array.from(selectedChannels).some(c => !refInfo.channels.has(c));
      if (gainNow !== refInfo.gainLabel || timeTouched || appliedTimeKey !== refInfo.timeKey ||
          JSON.stringify(appliedExtras) !== refInfo.extrasKey || ledKey() !== refInfo.ledKey || missing) {
        showToast('Reference was measured with a different configuration (gain ' + refInfo.gainLabel +
                  ', time, LED, extras or channels). Measure the reference again.', 'error');
        return;
      }
    }

    setMeasuringUI(true, 'Applying configuration...');
    try {
      // Always apply what is on screen BEFORE measuring, and wait for the
      // board's acks. The gain label stored with the result is taken from this
      // acknowledged state, never from whatever the dropdown shows later.
      const cfg = await applyConfig(false);
      measureGainLabel = cfg.gainLabel;
      progressText.textContent = 'Measuring sample...';
      await request({ cmd: 'measure' }, 40000);
    } catch (e) {
      const was = isMeasuring;
      setMeasuringUI(false);
      if (was) reportError(e);
    }
  });

  // Safety net: a measurement lasts 10 s on the device. If nothing at all
  // (no progress, result or error) arrives for 20 s, give up and unlock the UI.
  let measureWatchdog = null;
  function armMeasureWatchdog() {
    clearTimeout(measureWatchdog);
    measureWatchdog = setTimeout(() => {
      if (!isMeasuring) return;
      setMeasuringUI(false);
      showToast('No response from the board during the measurement. Check the connection and try again.', 'error');
    }, 20000);
  }

  // Locks every control while the board is busy. During the 10 s measurement the
  // firmware does not read Serial at all, so anything clicked in that window was
  // queued in the chip's tiny RX buffer, overflowed it, and came out as
  // "Invalid JSON" / lost settings (and mode/gain changes mid-run were
  // recorded against the wrong measurement).
  function setControlsLocked(locked) {
    controlsLocked = locked;
    document.body.classList.toggle('busy', locked);
    app.querySelectorAll('select, input, button').forEach(el => { el.disabled = locked; });
  }

  function setMeasuringUI(active, label) {
    isMeasuring = active;
    if (active) armMeasureWatchdog(); else clearTimeout(measureWatchdog);
    setControlsLocked(active);
    progressArea.classList.toggle('hidden', !active);
    if (active) {
      progressText.textContent = label;
      progressBar.style.width = '0%';
      progressLive.innerHTML = '';
    }
  }

  function onProgress(msg) {
    if (isMeasuring) armMeasureWatchdog();
    const pct = Math.min((msg.t / 10.0) * 100, 100);
    progressBar.style.width = pct + '%';
    progressLive.innerHTML = '';
    Object.keys(msg.data || {}).forEach(chId => {
      const ch = sensorInfo.channels.find(c => String(c.id) === chId);
      const span = document.createElement('span');
      span.textContent = (ch ? ch.name : chId) + ': ' + (typeof msg.data[chId] === 'number' ? msg.data[chId].toFixed(3) : '--');
      progressLive.appendChild(span);
    });
  }

  function onRefSaved() {
    referenceValid = true;
    refStatus.classList.remove('hidden');
    setMeasuringUI(false);
    showToast('Reference saved successfully', 'success');
  }

  // Human-readable snapshot of everything that shapes a measurement, taken from
  // the state the board acknowledged (the form now starts from the board's real
  // values, so this is exactly what ran).
  function describeConfig(mode, sub) {
    const info = sensorInfo;
    // integration time
    let timeText = '';
    if (info.time.type === 'formula') {
      timeText = info.time.params.map(p => p.label + '=' + (pendingTimeParams[p.key] !== undefined ? pendingTimeParams[p.key] : '')).join('; ');
    } else {
      timeText = info.time.presets[pendingTimePreset] || '';
    }
    // LED: internal one only matters in Reflectance; the others are fixed externals
    let ledText = '';
    if (mode === 'reflectance') {
      const led = info.led.internal;
      if (led.type === 'binary') ledText = pendingLedOn ? 'On' : 'Off';
      else if (led.type === 'discrete') ledText = (led.options[pendingLedIdx] || '');
      else if (led.type === 'continuous') ledText = pendingLedMA + ' mA';
    } else if (mode === 'absorbance') {
      ledText = 'External ' + info.led.absorbance.angle + '\u00B0';
    } else if (mode === 'fluorescence') {
      ledText = 'External ' + info.led.fluorescence.angle + '\u00B0';
    }
    // sensor-specific extras
    const extrasText = (info.extraParams || []).map((ep, i) => {
      const v = appliedExtras[i];
      return ep.label + '=' + ((ep.type === 'select' && ep.options) ? (ep.options[v] !== undefined ? ep.options[v] : v) : v);
    }).join('; ');
    // reference
    const usedRef = (sub === 'log'); // as reported by the board for THIS measurement
    const refText = usedRef ? ('Yes' + (refInfo ? ' (gain ' + refInfo.gainLabel + ')' : '')) : 'No';
    return { timeText, ledText, extrasText, refText };
  }

  function nowStamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function onResult(msg) {
    setMeasuringUI(false);
    // Prefer the gain the board itself reports it used; fall back to the
    // snapshot taken (after the acks) when Measure was pressed. Never read the
    // live dropdown here: it may have changed since.
    let gainLabel = measureGainLabel;
    if (sensorInfo.gain.type === 'discrete' && typeof msg.gain_idx === 'number') {
      gainLabel = sensorInfo.gain.options[msg.gain_idx] || gainLabel;
    } else if (typeof msg.gain_val === 'number') {
      gainLabel = String(msg.gain_val);
    }
    if (measureGainLabel && gainLabel !== measureGainLabel) {
      console.warn('Gain mismatch: UI applied', measureGainLabel, 'but board reports', gainLabel);
    }
    results.push({
      id: resultIdCounter++,
      mode: msg.mode, sub: msg.sub,
      gain: gainLabel,
      tint_ms: msg.tint_ms,
      data: msg.data,
      time: nowStamp(),
      sensor: sensorInfo.sensor,
      chNames: sensorInfo.channels.map(c => c.name),
      cfg: describeConfig(msg.mode, msg.sub)
    });
    renderResults();
    showToast('Measurement complete', 'success');
  }

  // =============================================================================
  // RESULTS TABLE / EXPORT
  // =============================================================================
  function modeLabel(mode, sub) {
    const names = { reflectance: 'Reflectance', absorbance: 'Absorbance', fluorescence: 'Fluorescence' };
    let label = names[mode] || mode;
    if (sub === 'raw') label += ' (Raw)';
    return label;
  }

  // Rows belonging to the sensor currently shown (older rows of another sensor
  // stay in memory, hidden, so they are never drawn under the wrong columns).
  function visibleResults() {
    if (!infoForTable) return results;
    return results.filter(r => !r.sensor || r.sensor === infoForTable.sensor);
  }

  function renderResults() {
    resultsBody.innerHTML = '';
    const rowsToShow = visibleResults();
    const hiddenCount = results.length - rowsToShow.length;
    if (rowsToShow.length === 0) {
      resultsBody.innerHTML = '<tr><td colspan="99" class="empty-row">No measurements yet' +
        (hiddenCount ? ' (' + hiddenCount + ' from another sensor kept, hidden)' : '') + '</td></tr>';
      return;
    }
    const curNames = infoForTable.channels.map(c => c.name);
    rowsToShow.forEach(r => {
      const tr = document.createElement('tr');
      const renamed = r.chNames && JSON.stringify(r.chNames) !== JSON.stringify(curNames);
      let html =
        '<td>' + r.id + (renamed ? ' <span title="Channel measured as: ' + r.chNames.join(' / ') + '">\u26A0</span>' : '') + '</td>' +
        '<td>' + modeLabel(r.mode, r.sub) + '</td>' +
        '<td>' + (r.gain || '\u2014') + '</td>' +
        '<td>' + (typeof r.tint_ms === 'number' ? r.tint_ms.toFixed(2) : '\u2014') + '</td>';
      infoForTable.channels.forEach(ch => {
        const v = r.data[String(ch.id)];
        html += '<td>' + (typeof v === 'number' ? v.toFixed(3) : '\u2014') + '</td>';
      });
      html += '<td><button class="btn-del-row" data-id="' + r.id + '">Delete</button></td>';
      tr.innerHTML = html;
      if (r.cfg) tr.title = 'Time: ' + r.cfg.timeText + ' | LED: ' + r.cfg.ledText +
        (r.cfg.extrasText ? ' | ' + r.cfg.extrasText : '') + ' | Reference: ' + r.cfg.refText + ' | ' + r.time;
      resultsBody.appendChild(tr);
    });
    if (hiddenCount > 0) {
      const note = document.createElement('tr');
      note.innerHTML = '<td colspan="99" class="empty-row">' + hiddenCount + ' result(s) from another sensor kept, hidden</td>';
      resultsBody.appendChild(note);
    }
    resultsBody.querySelectorAll('.btn-del-row').forEach(btn => {
      btn.addEventListener('click', () => {
        results = results.filter(r => r.id !== parseInt(btn.dataset.id, 10));
        renderResults();
      });
    });
  }

  btnClearAll.addEventListener('click', () => {
    const shown = new Set(visibleResults().map(r => r.id));
    if (shown.size === 0) return;
    results = results.filter(r => !shown.has(r.id)); // other sensors' rows are kept
    renderResults();
  });

  function buildResultRows() {
    const info = infoForTable;
    const chCols = info.channels.map(c => c.name);
    const header = ['id', 'timestamp', 'sensor', 'mode', 'gain', 'tint_ms', 'time_config', 'led', 'extras', 'reference', 'channels_as', ...chCols];
    const rows = [header];
    visibleResults().forEach(r => {
      const c = r.cfg || {};
      // names the measured channels had WHEN measured (they can change with an extra, e.g. LTR390 ALS/UV)
      const namesAtTime = (r.chNames || chCols).filter((n, i) => r.data[String(info.channels[i] ? info.channels[i].id : i)] !== undefined).join(' / ');
      rows.push([
        r.id, r.time || '', r.sensor || info.sensor, modeLabel(r.mode, r.sub), r.gain || '',
        typeof r.tint_ms === 'number' ? Number(r.tint_ms.toFixed(2)) : '',
        c.timeText || '', c.ledText || '', c.extrasText || '', c.refText || '', namesAtTime,
        ...info.channels.map(ch => {
          const v = r.data[String(ch.id)];
          return typeof v === 'number' ? Number(v.toFixed(4)) : '';
        })
      ]);
    });
    return rows;
  }

  // CSV: quote any cell that contains a comma, quote or newline (the new
  // config columns can contain commas / semicolons).
  function csvCell(v) {
    const t = String(v);
    return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  btnDownloadCsv.addEventListener('click', () => {
    if (!infoForTable || visibleResults().length === 0) { showToast('No measurements to export', 'error'); return; }
    const lines = buildResultRows().map(row => row.map(csvCell).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'measurements_' + sensorInfo.sensor + '_' + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  btnDownloadXlsx.addEventListener('click', () => {
    if (!infoForTable || visibleResults().length === 0) { showToast('No measurements to export', 'error'); return; }
    if (typeof XLSX === 'undefined') { showToast('Excel library failed to load', 'error'); return; }
    const worksheet = XLSX.utils.aoa_to_sheet(buildResultRows());
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Measurements');
    XLSX.writeFile(workbook, 'measurements_' + sensorInfo.sensor + '_' + Date.now() + '.xlsx');
  });

  // =============================================================================
  // TOASTS
  // =============================================================================
  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || '');
    toast.textContent = message;
    container.appendChild(toast);
    void toast.offsetWidth;
    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

})();
