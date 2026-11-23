(function (global) {
  'use strict';

  const VR = global.VectorRacer;
  const TRACKS = VR.TRACKS;
  const STORAGE_BEST_KEY = 'vectorRacer_bestTimes_v1';
  const STORAGE_DRAFT_KEY = 'vectorRacer_drafts_v1';

  // DOM References
  const el = {
    circuitSelect: document.getElementById('circuitSelect'),
    bestTimeBadge: document.getElementById('bestTimeBadge'),
    muteBtn: document.getElementById('muteBtn'),
    trackTitle: document.getElementById('trackTitle'),
    trackDifficulty: document.getElementById('trackDifficulty'),
    trackSubtitle: document.getElementById('trackSubtitle'),
    canvas: document.getElementById('raceCanvas'),
    canvasWrap: document.getElementById('canvasWrap'),
    statusBanner: document.getElementById('statusBanner'),
    teleTime: document.getElementById('teleTime'),
    telePos: document.getElementById('telePos'),
    teleSpeed: document.getElementById('teleSpeed'),
    teleAccel: document.getElementById('teleAccel'),
    teleSectors: document.getElementById('teleSectors'),
    teleCursor: document.getElementById('teleCursor'),
    runBtn: document.getElementById('runBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resetBtn: document.getElementById('resetBtn'),
    timeScrubber: document.getElementById('timeScrubber'),
    scrubCur: document.getElementById('scrubCur'),
    scrubMax: document.getElementById('scrubMax'),
    speedBtns: document.querySelectorAll('.speed-btn'),
    toggleVectors: document.getElementById('toggleVectors'),
    toggleGhost: document.getElementById('toggleGhost'),
    toggleTicks: document.getElementById('toggleTicks'),
    cmdCountMeta: document.getElementById('cmdCountMeta'),
    tabText: document.getElementById('tabText'),
    tabTable: document.getElementById('tabTable'),
    textEditorWrap: document.getElementById('textEditorWrap'),
    tableEditorWrap: document.getElementById('tableEditorWrap'),
    lineNumbers: document.getElementById('lineNumbers'),
    programText: document.getElementById('programText'),
    tableBody: document.getElementById('tableBody'),
    addRowBtn: document.getElementById('addRowBtn'),
    addBrakeBtn: document.getElementById('addBrakeBtn'),
    validationBox: document.getElementById('validationBox'),
    loadDemoBtn: document.getElementById('loadDemoBtn'),
    clearBtn: document.getElementById('clearBtn'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    sumResult: document.getElementById('sumResult'),
    sumPeak: document.getElementById('sumPeak'),
    sumDist: document.getElementById('sumDist'),
    sumClear: document.getElementById('sumClear')
  };

  // Application State
  const state = {
    trackIdx: 0,
    track: TRACKS[0],
    editorMode: 'text', // 'text' | 'table'
    parsed: { commands: [], errors: [] },
    activeRun: null,
    ghostRun: null,
    isPlaying: false,
    isPaused: false,
    playbackTime: 0,
    playbackSpeed: 1,
    currentSample: null,
    currentSampleIdx: 0,
    lastCheckpointPinged: 0,
    endTriggered: false,
    showVectors: true,
    showGhost: true,
    showTimeTicks: true,
    bestTimes: loadJson(STORAGE_BEST_KEY, {}),
    drafts: loadJson(STORAGE_DRAFT_KEY, {})
  };

  const renderer = new VR.ClassicRenderer(el.canvas);
  const audio = new VR.RetroAudio();

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Circuit Setup
  // ---------------------------------------------------------------------------
  function initCircuits() {
    el.circuitSelect.innerHTML = '';
    TRACKS.forEach((tr, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `${idx + 1}. ${tr.name} (${tr.difficulty})`;
      el.circuitSelect.appendChild(opt);
    });
    selectTrack(0);
  }

  function selectTrack(idx) {
    stopPlayback();
    state.trackIdx = idx;
    state.track = TRACKS[idx];
    state.activeRun = null;
    state.ghostRun = null;
    state.playbackTime = 0;
    state.currentSample = null;
    state.currentSampleIdx = 0;
    state.endTriggered = false;

    el.trackTitle.textContent = state.track.name;
    el.trackDifficulty.textContent = ` • ${state.track.difficulty}`;
    el.trackSubtitle.textContent = state.track.subtitle;
    updateBestBadge();

    // Load saved draft or starter template (first circuit loads demo automatically for easy first try)
    const saved = state.drafts[state.track.id];
    if (saved !== undefined) {
      el.programText.value = saved;
    } else if (idx === 0) {
      el.programText.value = state.track.demoProgram;
    } else {
      el.programText.value = `# ${state.track.name}\n# time, duration, acceleration, angle\n0.0, 1.8, 16, 0\n`;
    }

    onProgramChanged();
    resetToStart(false);
  }

  function updateBestBadge() {
    const best = state.bestTimes[state.track.id];
    el.bestTimeBadge.textContent =
      best !== undefined ? `BEST LAP: ${best.toFixed(2)}s` : 'BEST LAP: --.--s';
  }

  // ---------------------------------------------------------------------------
  // Editor Parsing, Line Numbers & Table Builder Sync
  // ---------------------------------------------------------------------------
  function onProgramChanged() {
    const raw = el.programText.value;
    state.drafts[state.track.id] = raw;
    saveJson(STORAGE_DRAFT_KEY, state.drafts);

    state.parsed = VR.parseProgram(raw);
    el.cmdCountMeta.textContent = `${state.parsed.commands.length} command${
      state.parsed.commands.length === 1 ? '' : 's'
    }`;

    updateValidationUI();
    updateLineNumbers([]);
    if (state.editorMode === 'table') {
      renderTableRows();
    }
  }

  function updateValidationUI() {
    const { commands, errors } = state.parsed;
    if (errors.length > 0) {
      el.validationBox.className = 'validation-box has-errors';
      el.validationBox.innerHTML = errors.map((e) => escapeHtml(e.message)).join('<br>');
    } else if (commands.length === 0) {
      el.validationBox.className = 'validation-box';
      el.validationBox.textContent = 'Enter one or more commands (time, duration, acceleration, angle) or click "Load Demo Solution".';
    } else {
      const endT = commands.reduce((m, c) => Math.max(m, c.endTime), 0);
      el.validationBox.className = 'validation-box';
      el.validationBox.textContent = `Valid: ${commands.length} command${
        commands.length === 1 ? '' : 's'
      } spanning 0.00s – ${endT.toFixed(2)}s. Ready to launch (Ctrl+Enter or Space).`;
    }
  }

  function updateLineNumbers(activeLines) {
    const lines = el.programText.value.split(/\r?\n/);
    const errSet = new Set(state.parsed.errors.map((e) => e.line));
    const actSet = new Set(activeLines || []);
    let html = '';
    for (let i = 1; i <= Math.max(1, lines.length); i++) {
      let cls = 'line-num';
      if (errSet.has(i)) cls += ' error-line';
      else if (actSet.has(i)) cls += ' active-line';
      html += `<span class="${cls}">${i}</span>`;
    }
    el.lineNumbers.innerHTML = html;
    el.lineNumbers.scrollTop = el.programText.scrollTop;
  }

  function setEditorMode(mode) {
    state.editorMode = mode;
    el.tabText.classList.toggle('active', mode === 'text');
    el.tabTable.classList.toggle('active', mode === 'table');
    el.textEditorWrap.style.display = mode === 'text' ? 'flex' : 'none';
    el.tableEditorWrap.style.display = mode === 'table' ? 'flex' : 'none';
    if (mode === 'table') {
      renderTableRows();
    }
  }

  function renderTableRows() {
    const cmds = state.parsed.commands;
    el.tableBody.innerHTML = '';

    cmds.forEach((cmd, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.line = String(cmd.line);
      tr.innerHTML = `
        <td><input type="number" step="0.1" min="0" data-field="time" value="${cmd.time}" /></td>
        <td><input type="number" step="0.1" min="0.05" data-field="duration" value="${cmd.duration}" /></td>
        <td><input type="number" step="0.5" data-field="acceleration" value="${cmd.acceleration}" /></td>
        <td>
          <input type="number" step="5" data-field="angle" value="${cmd.angle}" />
          <div class="angle-quick">
            <button type="button" class="angle-chip" data-ang="0" title="Right (0°)">0&deg;</button>
            <button type="button" class="angle-chip" data-ang="90" title="Top (90°)">90&deg;</button>
            <button type="button" class="angle-chip" data-ang="180" title="Left (180°)">180&deg;</button>
            <button type="button" class="angle-chip" data-ang="-90" title="Bottom (-90°)">-90&deg;</button>
          </div>
        </td>
        <td><button type="button" class="del-row-btn" title="Remove row">&times;</button></td>
      `;

      const inputs = tr.querySelectorAll('input[type="number"]');
      inputs.forEach((inp) => {
        inp.addEventListener('change', () => syncTableToText());
      });

      tr.querySelectorAll('.angle-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const angInput = tr.querySelector('input[data-field="angle"]');
          angInput.value = chip.dataset.ang;
          syncTableToText();
        });
      });

      tr.querySelector('.del-row-btn').addEventListener('click', () => {
        tr.remove();
        syncTableToText();
        renderTableRows();
      });

      el.tableBody.appendChild(tr);
    });
  }

  function syncTableToText() {
    const rows = Array.from(el.tableBody.querySelectorAll('tr'));
    const cmds = rows.map((tr) => ({
      time: Number(tr.querySelector('input[data-field="time"]').value) || 0,
      duration: Math.max(0.05, Number(tr.querySelector('input[data-field="duration"]').value) || 0.5),
      acceleration: Number(tr.querySelector('input[data-field="acceleration"]').value) || 0,
      angle: Number(tr.querySelector('input[data-field="angle"]').value) || 0
    }));
    el.programText.value = VR.serializeProgram(cmds);
    state.drafts[state.track.id] = el.programText.value;
    saveJson(STORAGE_DRAFT_KEY, state.drafts);
    state.parsed = VR.parseProgram(el.programText.value);
    el.cmdCountMeta.textContent = `${state.parsed.commands.length} command${
      state.parsed.commands.length === 1 ? '' : 's'
    }`;
    updateValidationUI();
    updateLineNumbers([]);
  }

  function addNextCommandRow(asReverseBrake) {
    const cmds = state.parsed.commands.slice();
    const last = cmds[cmds.length - 1];
    let nextCmd;
    if (!last) {
      nextCmd = { time: 0, duration: 1.5, acceleration: 15, angle: 0 };
    } else if (asReverseBrake) {
      let opp = last.angle + 180;
      while (opp > 180) opp -= 360;
      while (opp <= -180) opp += 360;
      nextCmd = {
        time: Number((last.time + last.duration).toFixed(3)),
        duration: last.duration,
        acceleration: last.acceleration,
        angle: opp
      };
    } else {
      nextCmd = {
        time: Number((last.time + last.duration).toFixed(3)),
        duration: 1.5,
        acceleration: 15,
        angle: 0
      };
    }
    cmds.push(nextCmd);
    el.programText.value = VR.serializeProgram(cmds);
    onProgramChanged();
    renderTableRows();
  }

  function highlightActiveTableRows(activeLines) {
    if (state.editorMode !== 'table') return;
    const actSet = new Set(activeLines || []);
    el.tableBody.querySelectorAll('tr').forEach((tr) => {
      tr.classList.toggle('active-row', actSet.has(Number(tr.dataset.line)));
    });
  }

  // ---------------------------------------------------------------------------
  // Simulation Launch & Playback Controls
  // ---------------------------------------------------------------------------
  function launchSimulation() {
    onProgramChanged();
    if (state.parsed.errors.length > 0) {
      setBanner('SYNTAX ERROR — FIX DATA INPUT FIRST', 'crashed');
      return;
    }
    if (state.parsed.commands.length === 0) {
      setBanner('NO COMMANDS — ADD DATA OR LOAD DEMO', 'crashed');
      return;
    }

    // Preserve previous run as ghost trail
    if (state.activeRun) {
      state.ghostRun = state.activeRun;
    }

    const result = VR.simulateRun(state.track, state.parsed.commands);
    state.activeRun = result;
    state.playbackTime = 0;
    state.isPlaying = true;
    state.isPaused = false;
    state.lastCheckpointPinged = 0;
    state.endTriggered = false;

    el.timeScrubber.disabled = false;
    el.timeScrubber.min = '0';
    el.timeScrubber.max = String(Math.max(0.01, result.totalTime));
    el.timeScrubber.value = '0';
    el.scrubMax.textContent = `${result.totalTime.toFixed(2)}s`;

    el.pauseBtn.disabled = false;
    el.pauseBtn.textContent = 'Pause';
    setBanner('RACING — TELEMETRY LIVE', 'running');

    audio.playStart();
    applySampleAt(0);
    updateSummaryBox(null);
  }

  function togglePause() {
    if (!state.activeRun) return;
    if (state.isPlaying && !state.isPaused) {
      state.isPaused = true;
      el.pauseBtn.textContent = 'Resume';
      audio.stopEngine();
      setBanner(`PAUSED @ ${state.playbackTime.toFixed(2)}s`, '');
    } else if (state.isPaused) {
      state.isPaused = false;
      el.pauseBtn.textContent = 'Pause';
      setBanner('RACING — TELEMETRY LIVE', 'running');
    } else if (!state.isPlaying) {
      // Replay from beginning if finished
      state.playbackTime = 0;
      state.isPlaying = true;
      state.isPaused = false;
      state.lastCheckpointPinged = 0;
      state.endTriggered = false;
      el.pauseBtn.textContent = 'Pause';
      setBanner('REPLAYING RUN', 'running');
    }
  }

  function stopPlayback() {
    state.isPlaying = false;
    state.isPaused = false;
    audio.stopEngine();
  }

  function resetToStart(keepGhost) {
    stopPlayback();
    if (keepGhost && state.activeRun) {
      state.ghostRun = state.activeRun;
    }
    state.activeRun = null;
    state.playbackTime = 0;
    state.currentSampleIdx = 0;
    state.endTriggered = false;
    state.currentSample = {
      t: 0,
      x: state.track.startPos.x,
      y: state.track.startPos.y,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      speed: 0,
      heading: state.track.startHeading || 0,
      activeLines: [],
      checkpointIdx: 0
    };

    el.pauseBtn.disabled = true;
    el.pauseBtn.textContent = 'Pause';
    el.timeScrubber.disabled = true;
    el.timeScrubber.value = '0';
    el.scrubCur.textContent = '0.00s';
    el.scrubMax.textContent = '0.00s';
    setBanner('READY — ENTER COMMANDS & LAUNCH', '');
    updateTelemetry(state.currentSample);
    updateLineNumbers([]);
    highlightActiveTableRows([]);
    updateSummaryBox(null);
  }

  function applySampleAt(t) {
    if (!state.activeRun) return;
    const clamped = Math.max(0, Math.min(t, state.activeRun.totalTime));
    state.playbackTime = clamped;
    const hit = VR.sampleAtTime(state.activeRun.samples, clamped);
    if (!hit) return;

    state.currentSample = hit.sample;
    state.currentSampleIdx = hit.index;
    el.timeScrubber.value = String(clamped);
    el.scrubCur.textContent = `${clamped.toFixed(2)}s`;

    updateTelemetry(hit.sample);
    updateLineNumbers(hit.sample.activeLines);
    highlightActiveTableRows(hit.sample.activeLines);

    if (state.isPlaying && !state.isPaused) {
      if (hit.sample.checkpointIdx > state.lastCheckpointPinged && hit.sample.checkpointIdx <= state.track.checkpoints.length) {
        state.lastCheckpointPinged = hit.sample.checkpointIdx;
        audio.playCheckpoint();
      }
      const aMag = Math.hypot(hit.sample.ax, hit.sample.ay);
      audio.updateEngine(hit.sample.speed, aMag);
    }
  }

  function handleRunComplete() {
    if (state.endTriggered || !state.activeRun) return;
    state.endTriggered = true;
    state.isPlaying = false;
    state.isPaused = false;
    audio.stopEngine();

    const run = state.activeRun;
    el.pauseBtn.textContent = 'Replay';
    updateSummaryBox(run);

    if (run.status === 'finished') {
      const prevBest = state.bestTimes[state.track.id];
      let bestNote = '';
      if (prevBest === undefined || run.finishTime < prevBest) {
        state.bestTimes[state.track.id] = run.finishTime;
        saveJson(STORAGE_BEST_KEY, state.bestTimes);
        updateBestBadge();
        bestNote = ' ★ NEW RECORD!';
      }
      setBanner(`CIRCUIT COMPLETED IN ${run.finishTime.toFixed(2)}s!${bestNote}`, 'finished');
      audio.playFinish();
      renderer.triggerFinish(state.currentSample.x, state.currentSample.y);
    } else if (run.status === 'crashed') {
      setBanner(
        `CRASHED INTO ${run.crashWall.toUpperCase()} WALL @ ${run.crashPoint.t.toFixed(2)}s (SECTORS: ${run.checkpointsCleared}/${run.totalCheckpoints})`,
        'crashed'
      );
      audio.playCrash();
      renderer.triggerCrash(run.crashPoint.x, run.crashPoint.y);
    } else if (run.status === 'stopped') {
      setBanner(
        `CAR STOPPED @ ${run.totalTime.toFixed(2)}s — DID NOT FINISH (${run.checkpointsCleared}/${run.totalCheckpoints} SECTORS)`,
        ''
      );
    } else {
      setBanner(`TIME LIMIT REACHED (${run.totalTime.toFixed(1)}s) — DID NOT FINISH`, '');
    }
  }

  function setBanner(text, cls) {
    el.statusBanner.textContent = text;
    el.statusBanner.className = 'status-banner' + (cls ? ' ' + cls : '');
  }

  function updateTelemetry(s) {
    el.teleTime.textContent = `${s.t.toFixed(2)} s`;
    el.telePos.textContent = `${s.x.toFixed(1)}, ${s.y.toFixed(1)}`;
    el.teleSpeed.textContent = `${s.speed.toFixed(1)} m/s`;
    const aMag = Math.hypot(s.ax, s.ay);
    el.teleAccel.textContent = `${aMag.toFixed(1)} m/s²`;
    const cp = Math.min(s.checkpointIdx, state.track.checkpoints.length);
    el.teleSectors.textContent = `${cp} / ${state.track.checkpoints.length}`;
  }

  function updateSummaryBox(run) {
    if (!run) {
      el.sumResult.textContent = '--';
      el.sumPeak.textContent = '--';
      el.sumDist.textContent = '--';
      el.sumClear.textContent = '--';
      return;
    }
    const labelMap = {
      finished: `FINISH (${run.finishTime.toFixed(2)}s)`,
      crashed: `CRASH @ ${run.crashPoint.t.toFixed(2)}s`,
      stopped: `STOPPED @ ${run.totalTime.toFixed(2)}s`,
      timeout: `TIMEOUT (${run.totalTime.toFixed(1)}s)`
    };
    el.sumResult.textContent = labelMap[run.status] || run.status;
    el.sumPeak.textContent = `${run.metrics.maxSpeed.toFixed(1)} m/s`;
    el.sumDist.textContent = `${run.metrics.totalDistance.toFixed(1)} m`;
    el.sumClear.textContent = `${run.metrics.minClearance.toFixed(2)} m`;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------
  el.circuitSelect.addEventListener('change', (e) => {
    selectTrack(Number(e.target.value));
  });

  el.muteBtn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    el.muteBtn.textContent = audio.muted ? 'SFX: OFF' : 'SFX: ON';
  });

  el.programText.addEventListener('input', onProgramChanged);
  el.programText.addEventListener('scroll', () => {
    el.lineNumbers.scrollTop = el.programText.scrollTop;
  });
  el.programText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      launchSimulation();
    }
  });

  el.tabText.addEventListener('click', () => setEditorMode('text'));
  el.tabTable.addEventListener('click', () => setEditorMode('table'));
  el.addRowBtn.addEventListener('click', () => addNextCommandRow(false));
  el.addBrakeBtn.addEventListener('click', () => addNextCommandRow(true));

  el.runBtn.addEventListener('click', launchSimulation);
  el.pauseBtn.addEventListener('click', togglePause);
  el.resetBtn.addEventListener('click', () => resetToStart(true));

  el.timeScrubber.addEventListener('input', (e) => {
    if (!state.activeRun) return;
    if (state.isPlaying && !state.isPaused) {
      state.isPaused = true;
      el.pauseBtn.textContent = 'Resume';
      audio.stopEngine();
    }
    const t = Number(e.target.value);
    state.endTriggered = t >= state.activeRun.totalTime - 1e-4;
    applySampleAt(t);
  });

  el.speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.playbackSpeed = Number(btn.dataset.speed) || 1;
      el.speedBtns.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  el.toggleVectors.addEventListener('change', () => {
    state.showVectors = el.toggleVectors.checked;
  });
  el.toggleGhost.addEventListener('change', () => {
    state.showGhost = el.toggleGhost.checked;
  });
  el.toggleTicks.addEventListener('change', () => {
    state.showTimeTicks = el.toggleTicks.checked;
  });

  el.loadDemoBtn.addEventListener('click', () => {
    el.programText.value = state.track.demoProgram;
    onProgramChanged();
    resetToStart(false);
    setBanner('DEMO LOADED — PRESS LAUNCH TO WATCH', '');
  });

  el.clearBtn.addEventListener('click', () => {
    el.programText.value = '# time, duration, acceleration, angle\n';
    onProgramChanged();
    resetToStart(true);
  });

  el.exportBtn.addEventListener('click', () => {
    const blob = new Blob([el.programText.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector-racer-${state.track.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      el.programText.value = String(reader.result || '');
      onProgramChanged();
      resetToStart(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Global keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!state.activeRun || !state.isPlaying) launchSimulation();
      else togglePause();
    } else if (e.key === 'r' || e.key === 'R') {
      resetToStart(true);
    }
  });

  // Interactive Canvas Hover & Drafting Ruler
  function canvasEventWorld(e) {
    const rect = el.canvas.getBoundingClientRect();
    return renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  let isDraggingRuler = false;
  el.canvas.addEventListener('pointerdown', (e) => {
    isDraggingRuler = true;
    const pt = canvasEventWorld(e);
    renderer.rulerStart = pt;
    renderer.rulerEnd = pt;
    el.canvas.setPointerCapture(e.pointerId);
  });

  el.canvas.addEventListener('pointermove', (e) => {
    const pt = canvasEventWorld(e);
    renderer.hoverWorld = pt;
    if (pt.x >= 0 && pt.x <= VR.WORLD_W && pt.y >= 0 && pt.y <= VR.WORLD_H) {
      el.teleCursor.textContent = `${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}`;
    } else {
      el.teleCursor.textContent = '-- , --';
    }
    if (isDraggingRuler) {
      renderer.rulerEnd = pt;
    }
  });

  el.canvas.addEventListener('pointerup', () => {
    isDraggingRuler = false;
    renderer.rulerStart = null;
    renderer.rulerEnd = null;
  });

  el.canvas.addEventListener('pointerleave', () => {
    renderer.hoverWorld = null;
    el.teleCursor.textContent = '-- , --';
  });

  window.addEventListener('resize', () => renderer.resize());

  // ---------------------------------------------------------------------------
  // Main Render / Playback Loop
  // ---------------------------------------------------------------------------
  let lastFrameTs = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrameTs) / 1000);
    lastFrameTs = now;

    if (state.isPlaying && !state.isPaused && state.activeRun) {
      const nextT = state.playbackTime + dt * state.playbackSpeed;
      if (nextT >= state.activeRun.totalTime) {
        applySampleAt(state.activeRun.totalTime);
        handleRunComplete();
      } else {
        applySampleAt(nextT);
      }
    }

    renderer.updateEffects(dt);
    renderer.render(state);
    requestAnimationFrame(frame);
  }

  // Expose debug/test handle for easy inspection
  VR._appState = state;
  VR._launch = launchSimulation;
  VR._selectTrack = selectTrack;

  // Boot
  initCircuits();
  renderer.resize();
  requestAnimationFrame(frame);
})(window);
