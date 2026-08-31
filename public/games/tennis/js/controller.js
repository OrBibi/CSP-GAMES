/**
 * Phone racket controller.
 * Court movement is automatic on the desktop.
 *
 * Real swing model (not phone tilt L/R):
 * - Hold phone inverted / pointing up (Wii-remote style).
 * - Left AND right swings: thrust the phone UP diagonally toward body center.
 * - Side = which side of the body the swing starts from (inward lateral + up).
 * - Overhead = more vertical smash (up then down / little lateral).
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  const roomParam = (params.get('room') || '').trim().toUpperCase();
  const gameParam = (params.get('game') || 'tennis').trim().toLowerCase();
  const HAND_KEY = 'tennis-handedness';

    const SWING = {
    cooldownMs: 420,
    minPeak: 9,
    bufferMs: 300,
  };

  const NAME_KEY = 'tennis-player-name';

  const els = {
    slotLabel: document.getElementById('slot-label'),
    connPill: document.getElementById('conn-pill'),
    roomLabel: document.getElementById('room-label'),
    statusText: document.getElementById('status-text'),
    btnMotion: document.getElementById('btn-motion'),
    btnCalibrate: document.getElementById('btn-calibrate'),
    btnHandRight: document.getElementById('btn-hand-right'),
    btnHandLeft: document.getElementById('btn-hand-left'),
    btnPractice: document.getElementById('btn-practice'),
    btnPracticeExit: document.getElementById('btn-practice-exit'),
    btnPracticeReset: document.getElementById('btn-practice-reset'),
    btnReady: document.getElementById('btn-ready'),
    readyStatus: document.getElementById('ready-status'),
    playerName: document.getElementById('player-name'),
    btnSaveName: document.getElementById('btn-save-name'),
    practicePanel: document.getElementById('practice-panel'),
    practiceResult: document.getElementById('practice-result'),
    practiceSideLabel: document.getElementById('practice-side-label'),
    practiceDetailLines: document.getElementById('practice-detail-lines'),
    practiceAimBlock: document.getElementById('practice-aim-block'),
    practiceAimValue: document.getElementById('practice-aim-value'),
    practiceAimMarker: document.getElementById('practice-aim-marker'),
    pracCountRight: document.getElementById('prac-count-right'),
    pracCountLeft: document.getElementById('prac-count-left'),
    pracCountSame: document.getElementById('prac-count-same'),
    pracCountCross: document.getElementById('prac-count-cross'),
    pracCountCenter: document.getElementById('prac-count-center'),
    wiiRemote: document.getElementById('wii-remote'),
    wiiLed: document.getElementById('wii-led'),
    wiiSlot: document.getElementById('wii-slot'),
    motionReadout: document.getElementById('motion-readout'),
    hudScore: document.getElementById('hud-score'),
    hudMsg: document.getElementById('hud-msg'),
    touchPad: document.getElementById('touch-pad'),
    secureHint: document.getElementById('secure-hint'),
  };

  const state = {
    slot: null,
    room: roomParam,
    motionEnabled: false,
    calibrated: false,
    handedness: localStorage.getItem(HAND_KEY) === 'left' ? 'left' : 'right',
    lastSwingAt: 0,
    swingArmed: true,
    peakMag: 0,
    samples: [],
    holdGamma: 0,
    holdBeta: 0,
    /** Gravity/orientation frozen while idle — this is the START pose of the next swing */
    startPoseSample: null,
    practiceMode: false,
    practiceCounts: { right: 0, left: 0, sameSide: 0, crossCourt: 0, center: 0 },
    ready: false,
    playerName: (localStorage.getItem(NAME_KEY) || '').trim().slice(0, 16),
    touchId: null,
    touchStartX: 0,
    touchStartY: 0,
    touchStartT: 0,
    touchActive: false,
  };

  const socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function setConnected(on) {
    els.connPill.textContent = on ? 'online' : 'offline';
    els.connPill.style.background = on ? 'rgba(22, 163, 74, 0.45)' : 'rgba(51, 65, 85, 0.7)';
    els.wiiLed.classList.toggle('on', on);
  }

  function vibrate(pattern) {
    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(0);
        navigator.vibrate(pattern);
        return true;
      } catch (_) {
        /* ignore */
      }
    }
    return false;
  }

  /** iOS has no Vibration API — use a short AudioContext buzz as hit feedback. */
  let audioCtx = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {
      /* ignore */
    }
  }

  function buzzAudio(powerLevel = 3) {
    try {
      unlockAudio();
      if (!audioCtx) return;
      const lvl = Math.max(1, Math.min(5, Number(powerLevel) || 3));
      const dur = 0.045 + lvl * 0.028;
      const freq = 140 + lvl * 28;
      const vol = 0.035 + lvl * 0.022;
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (_) {
      /* ignore */
    }
  }

  function patternForHit(powerLevel) {
    const lvl = Math.max(1, Math.min(5, Number(powerLevel) || 3));
    if (lvl <= 1) return [45];
    if (lvl === 2) return [55, 30, 55];
    if (lvl === 3) return [70, 25, 80];
    if (lvl === 4) return [90, 20, 100, 20, 70];
    return [110, 15, 130, 15, 110, 20, 80];
  }

  function playHitFeedback(powerLevel, reason) {
    const lvl = Math.max(1, Math.min(5, Number(powerLevel) || 3));
    let pattern = patternForHit(lvl);
    if (reason === 'point') pattern = [40, 40, 80];
    if (reason === 'miss') pattern = [90];
    const vibrated = vibrate(pattern);
    // Always buzz on iOS / when vibrate is unavailable; also reinforce strong hits
    if (!vibrated || reason === 'hit') buzzAudio(reason === 'hit' ? lvl : Math.min(lvl, 3));
  }

  function updateHandButtons() {
    const right = state.handedness === 'right';
    els.btnHandRight?.classList.toggle('hand-active', right);
    els.btnHandLeft?.classList.toggle('hand-active', !right);
  }

  function updateHoldRules() {
    const el = document.getElementById('hold-rules');
    if (!el) return;
    el.innerHTML = [
      '<li>כדור בצד ימין של המגרש → חבטת ימין</li>',
      '<li>כדור בצד שמאל של המגרש → חבטת שמאל</li>',
      '<li>זווית הפלאפון בסוף החבטה קובעת לאן הכדור נוחת</li>',
      '<li>חבטה חזקה יותר = כדור מהיר יותר</li>',
    ].join('');
  }

  function updateReadyButton() {
    if (!els.btnReady) return;
    els.btnReady.disabled = !state.slot || !state.calibrated;
    els.btnReady.textContent = state.ready ? 'מוכן ✓ (לחץ לביטול)' : 'מוכן למשחק';
    els.btnReady.classList.toggle('btn-primary', state.ready);
    els.btnReady.classList.toggle('btn-secondary', !state.ready);
    if (els.readyStatus) {
      if (!state.slot) els.readyStatus.textContent = 'ממתין לחיבור…';
      else if (!state.calibrated) els.readyStatus.textContent = 'הפעל שלט תנועה, ואז לחץ מוכן.';
      else if (state.ready) els.readyStatus.textContent = `שחקן ${state.slot} מוכן — ממתין להתחלת המשחק מהמסך.`;
      else els.readyStatus.textContent = `אתה שחקן ${state.slot}. לחץ מוכן כשאתה מוכן לשחק.`;
    }
  }

  function setReady(ready) {
    if (!state.slot) return;
    state.ready = !!ready;
    socket.emit('playerReady', { ready: state.ready }, (res) => {
      if (res?.ok) state.ready = !!res.ready;
      updateReadyButton();
    });
    updateReadyButton();
    if (state.ready) vibrate([20, 30, 40]);
  }

  function setHandedness(hand) {
    state.handedness = hand === 'left' ? 'left' : 'right';
    localStorage.setItem(HAND_KEY, state.handedness);
    updateHandButtons();
    updateHoldRules();
    setStatus(
      state.handedness === 'right'
        ? 'נקבע: יד ימין. חבוט ימינה או שמאלה לפי הצד שהכדור מגיע אליו.'
        : 'נקבע: יד שמאל. חבוט ימינה או שמאלה לפי הצד שהכדור מגיע אליו.'
    );
    updateViz();
  }

  function updateViz() {
    if (!els.motionReadout) return;
    if (!state.motionEnabled) {
      els.motionReadout.textContent = 'ממתין להפעלת שלט תנועה…';
    } else if (!state.calibrated) {
      els.motionReadout.textContent = 'לחץ כיול ואז חבוט כמו במחבט';
    } else if (state.practiceMode) {
      els.motionReadout.textContent = 'מצב אימון · חבוט ובדוק לאן הכדור הולך';
    } else {
      els.motionReadout.textContent = 'מוכן — חבוט כשהכדור מגיע אליך';
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function findSwingPeakIndex(samples) {
    let peak = 0;
    let peakI = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].mag > peak) {
        peak = samples[i].mag;
        peakI = i;
      }
    }
    return { peakI, peakMag: peak };
  }

  /** Acceleration component along the active swing direction (matches measureScreenAxisMotion). */
  function swingAxisAccel(sample, towardScreenFace) {
    const az = sample.az || 0;
    const ay = sample.ay || 0;
    return towardScreenFace ? -az : az;
  }

  /**
   * Last sample index still in the forward swing — stops before the pull-back / recovery.
   */
  function findForwardSwingEnd(samples, peakI, motion) {
    if (!samples.length || peakI < 0) return peakI;

    const tPeak = samples[peakI].t;
    const towardScreen = !!motion?.towardScreenFace;
    const maxEndT = tPeak + (towardScreen ? 155 : 120);

    let endI = peakI;
    let opposeRun = 0;

    for (let i = peakI + 1; i < samples.length; i += 1) {
      const s = samples[i];
      if (s.t > maxEndT) break;

      const axis = swingAxisAccel(s, towardScreen);
      if (axis < -3.0) {
        opposeRun += 1;
        if (opposeRun >= 2) break;
      } else {
        opposeRun = 0;
        endI = i;
      }
    }

    return endI;
  }

  /**
   * Beta-only pitch: more sensitive to floor (screen down) than cos(g)*cos(b).
   * Floor often peaks around 110–150° on a right-hand follow-through dip.
   */
  function betaPitchNz(beta) {
    const absB = Math.abs(Number(beta) || 0);
    const sky = clamp((50 - absB) / 50, 0, 1);
    const floor = clamp((absB - 100) / 58, 0, 1);
    return clamp(floor - sky, -1, 1);
  }

  /**
   * World "down" on screen axis (+Z). +1 = screen→floor, −1 = screen→sky.
   */
  function orientationScreenNz(beta, gamma) {
    const b = (Number(beta) || 0) * (Math.PI / 180);
    const g = (Number(gamma) || 0) * (Math.PI / 180);
    const dot = clamp(-Math.cos(g) * Math.cos(b), -1, 1);
    const pitch = betaPitchNz(beta);
    return clamp(dot * 0.4 + pitch * 0.6, -1, 1);
  }

  function sampleTiltNz(sample, towardScreenFace) {
    const orient = orientationScreenNz(sample.beta, sample.gamma);
    const grav = gravityFloorSkyNz(sample, towardScreenFace);
    if (grav != null) return orient * 0.48 + grav * 0.52;
    return orient;
  }

  /** Gravity vector (corrected) in device frame. */
  function correctedGravityVector(sample) {
    const cx = (sample.gx || 0) - (sample.ax || 0);
    const cy = (sample.gy || 0) - (sample.ay || 0);
    const cz = (sample.gz || 0) - (sample.az || 0);
    const mag = Math.hypot(cx, cy, cz);
    if (mag < 4.5) return null;
    return { nx: cx / mag, ny: cy / mag, nz: cz / mag, mag };
  }

  /**
   * Floor/sky from gravity axes.
   * Toward-screen finish (righty right): floor dip often shows on Z and tilted Y (inverted hold).
   */
  function gravityFloorSkyNz(sample, towardScreenFace) {
    const g = correctedGravityVector(sample);
    if (!g) return null;
    if (towardScreenFace) {
      const z = g.nz;
      const yHint = -g.ny;
      if (z > 0.1) return clamp(Math.max(z, yHint * 0.55), -1, 1);
      if (z < -0.1) return clamp(z, -1, 1);
      return clamp(z * 0.7 + yHint * 0.18, -1, 1);
    }
    return clamp(g.nz, -1, 1);
  }

  /** Raw gravity when motion is already low — often cleanest on iOS. */
  function calmRawGravityNz(sample, peakMag, towardScreenFace) {
    if (sample.mag > peakMag * 0.45) return null;
    const mag = Math.hypot(sample.gx || 0, sample.gy || 0, sample.gz || 0);
    if (mag < 5) return null;
    const nz = (sample.gz || 0) / mag;
    const ny = (sample.gy || 0) / mag;
    if (towardScreenFace) {
      if (nz >= 0.15 || nz <= -0.15) return clamp(nz, -1, 1);
      return clamp(nz * 0.75 - ny * 0.25, -1, 1);
    }
    return clamp(nz, -1, 1);
  }

  /** Min/max tilt across forward phase — used only when a clear spike beats coast read. */
  function forwardTiltRange(samples, peakI, endI, towardScreenFace) {
    const forward = samples.slice(peakI, endI + 1);
    if (!forward.length) return null;

    let maxV = -Infinity;
    let minV = Infinity;
    let sum = 0;
    let n = 0;
    for (const s of forward) {
      const v = sampleTiltNz(s, towardScreenFace);
      maxV = Math.max(maxV, v);
      minV = Math.min(minV, v);
      sum += v;
      n += 1;
    }
    if (!n) return null;
    return { coast: sum / n, maxV, minV };
  }

  /**
   * Pick floor vs sky from forward swing: whichever extreme is stronger wins.
   * Toward-screen: +nz floor (cross for righty right), −nz sky (same side).
   * Toward-back:    −nz sky (cross for righty left),  +nz floor (same side).
   */
  function resolveForwardNz(coastNz, maxV, minV, towardScreen) {
    const floorStrength = maxV;
    const skyStrength = -minV;
    const margin = 0.05;
    const crossFloor = maxV > 0.22;
    const crossSky = minV < -0.22;

    if (towardScreen) {
      if (crossFloor && floorStrength >= skyStrength + margin) {
        return clamp(coastNz * 0.22 + maxV * 0.78, -1, 1);
      }
      if (crossSky && skyStrength >= floorStrength + margin) {
        return clamp(coastNz * 0.22 + minV * 0.78, -1, 1);
      }
    } else {
      if (crossSky && skyStrength >= floorStrength + margin) {
        return clamp(coastNz * 0.22 + minV * 0.78, -1, 1);
      }
      if (crossFloor && floorStrength >= skyStrength + margin) {
        return clamp(coastNz * 0.22 + maxV * 0.78, -1, 1);
      }
    }
    return clamp(coastNz, -1, 1);
  }

  /**
   * Index of the calmest moment in the forward swing (best pose read).
   */
  function findCoastIndex(samples, peakI, endI) {
    let coastI = endI;
    let coastMag = samples[endI]?.mag ?? Infinity;
    for (let i = peakI; i <= endI; i += 1) {
      if (samples[i].mag <= coastMag) {
        coastMag = samples[i].mag;
        coastI = i;
      }
    }
    return coastI;
  }

  /**
   * Screen tilt at true swing end — fuses orientation + corrected gravity.
   * Reads a tight window around the forward coast (before pull-back).
   */
  function measureEndScreenTilt(samples, motion) {
    if (!samples.length) return null;

    const towardScreen = !!motion?.towardScreenFace;
    const { peakI, peakMag } = findSwingPeakIndex(samples);
    const endI = findForwardSwingEnd(samples, peakI, motion);
    const coastI = findCoastIndex(samples, peakI, endI);
    const winStart = Math.max(peakI, coastI - 2);
    const winEnd = Math.min(endI, coastI + 1);
    const window = samples.slice(winStart, winEnd + 1);
    if (!window.length) return null;

    let orientSum = 0;
    let orientW = 0;
    let gravSum = 0;
    let gravW = 0;
    let calmSum = 0;
    let calmW = 0;
    let endBeta = window[window.length - 1].beta;

    for (const s of window) {
      const calm = clamp(1.15 - s.mag / Math.max(peakMag, 8), 0.2, 1);

      if (Number.isFinite(s.beta) || Number.isFinite(s.gamma)) {
        const nz = orientationScreenNz(s.beta, s.gamma);
        orientSum += nz * calm;
        orientW += calm;
        endBeta = s.beta;
      }

      const corr = gravityFloorSkyNz(s, towardScreen);
      if (corr != null) {
        gravSum += corr * calm;
        gravW += calm;
      }

      const raw = calmRawGravityNz(s, peakMag, towardScreen);
      if (raw != null) {
        calmSum += raw * calm;
        calmW += calm;
      }
    }

    const orientNz = orientW ? orientSum / orientW : null;
    const gravNz = gravW ? gravSum / gravW : null;
    const calmNz = calmW ? calmSum / calmW : null;

    let nz = 0;
    let totalW = 0;
    if (orientNz != null) {
      const w = 0.58 + clamp(Math.abs(orientNz) / 0.65, 0, 1) * 0.28;
      nz += orientNz * w;
      totalW += w;
    }
    if (gravNz != null) {
      const w = 0.22 + clamp(Math.abs(gravNz) / 0.65, 0, 1) * 0.18;
      nz += gravNz * w;
      totalW += w;
    }
    if (calmNz != null) {
      const w = 0.14 + clamp(Math.abs(calmNz) / 0.65, 0, 1) * 0.12;
      nz += calmNz * w;
      totalW += w;
    }
    if (!totalW) return null;

    nz = clamp(nz / totalW, -1, 1);

    const tiltRange = forwardTiltRange(samples, peakI, endI, towardScreen);
    let tiltMax = null;
    let tiltMin = null;
    if (tiltRange) {
      tiltMax = tiltRange.maxV;
      tiltMin = tiltRange.minV;
      nz = resolveForwardNz(nz, tiltRange.maxV, tiltRange.minV, towardScreen);
    }

    const peakAbs = Math.max(
      Math.abs(nz),
      Math.abs(orientNz ?? 0),
      Math.abs(gravNz ?? 0),
      Math.abs(calmNz ?? 0)
    );
    const forwardMs = window[window.length - 1].t - window[0].t;

    return {
      ny: 0,
      nz,
      orientNz,
      gravNz,
      calmNz,
      endBeta,
      tiltMax,
      tiltMin,
      peakI,
      endI,
      coastI,
      forwardMs,
      orientConf: clamp((peakAbs - 0.1) / 0.42, 0, 1),
    };
  }

  function endScreenLabel(nz) {
    const v = Number(nz) || 0;
    if (v > 0.15) return 'מסך→רצפה';
    if (v < -0.15) return 'מסך→שמיים';
    return 'מסך→אופקי';
  }

  /**
   * Placement from stroke side + end screen tilt (gravity on phone Z / screen axis).
   * nz > 0: screen faces floor; nz < 0: screen faces sky.
   *
   * Righty:  right + floor → cross (−); left + sky → cross (−)
   * Lefty:   left + floor → cross (−); right + sky → cross (−)
   */
  function strokePlacementAim(side, nz, righty) {
    const v = clamp(Number(nz) || 0, -1, 1);
    if (righty) {
      return side === 'right' ? clamp(-v, -1, 1) : clamp(v, -1, 1);
    }
    return side === 'left' ? clamp(-v, -1, 1) : clamp(v, -1, 1);
  }

  function aimPlacementLabel(aim) {
    const v = Number(aim) || 0;
    if (v > 0.2) return 'אותו צד';
    if (v < -0.2) return 'צד נגדי';
    return 'אמצע';
  }

  /** Push aim away from dead-zone center so court placement is clearer in game. */
  function amplifyPlacementAim(aim) {
    const v = clamp(Number(aim) || 0, -1, 1);
    if (Math.abs(v) < 0.1) return v;
    const sign = Math.sign(v) || 1;
    const mag = Math.abs(v);
    return clamp(sign * (0.28 + mag * 0.72), -1, 1);
  }

  function formatAimValue(aim) {
    const v = Math.max(-1, Math.min(1, Number(aim) || 0));
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}`;
  }

  function setAimBar(aim) {
    const v = Math.max(-1, Math.min(1, Number(aim) || 0));
    const pct = ((v + 1) / 2) * 100;
    if (els.practiceAimValue) els.practiceAimValue.textContent = formatAimValue(v);
    if (els.practiceAimMarker) els.practiceAimMarker.style.left = `${pct}%`;
  }

  function resetPracticeDisplay() {
    if (els.practiceResult) els.practiceResult.className = 'practice-result practice-idle';
    if (els.practiceSideLabel) els.practiceSideLabel.textContent = 'חכה לחבטה…';
    els.practiceDetailLines?.classList.add('hidden');
    if (els.practiceDetailLines) els.practiceDetailLines.textContent = '';
    els.practiceAimBlock?.classList.add('hidden');
    setAimBar(0);
  }

  function syncPracticeCounters() {
    if (els.pracCountRight) els.pracCountRight.textContent = String(state.practiceCounts.right);
    if (els.pracCountLeft) els.pracCountLeft.textContent = String(state.practiceCounts.left);
    if (els.pracCountSame) els.pracCountSame.textContent = String(state.practiceCounts.sameSide);
    if (els.pracCountCross) els.pracCountCross.textContent = String(state.practiceCounts.crossCourt);
    if (els.pracCountCenter) els.pracCountCenter.textContent = String(state.practiceCounts.center);
  }

  function bumpAimCounter(aim) {
    const v = Number(aim) || 0;
    if (v > 0.2) state.practiceCounts.sameSide += 1;
    else if (v < -0.2) state.practiceCounts.crossCourt += 1;
    else state.practiceCounts.center += 1;
  }

  function showPracticeStroke(detail) {
    const el = els.practiceResult;
    if (!el) return;

    el.classList.remove(
      'practice-idle',
      'practice-right',
      'practice-left',
      'practice-overhead',
      'practice-miss'
    );

    if (!detail || !detail.side) {
      el.classList.add('practice-miss');
      if (els.practiceSideLabel) els.practiceSideLabel.textContent = 'לא זוהה / חלש מדי';
      els.practiceDetailLines?.classList.add('hidden');
      els.practiceAimBlock?.classList.add('hidden');
      if (els.hudMsg) els.hudMsg.textContent = 'לא זוהה — נסה חבטה חזקה יותר';
      return;
    }

    const aim = Math.max(-1, Math.min(1, Number(detail.aim) || 0));
    const place = aimPlacementLabel(aim);
    const level = detail.powerLevel || 1;

    if (detail.side === 'right') {
      el.classList.add('practice-right');
      if (els.practiceSideLabel) els.practiceSideLabel.textContent = 'חבטת ימין';
      state.practiceCounts.right += 1;
    } else {
      el.classList.add('practice-left');
      if (els.practiceSideLabel) els.practiceSideLabel.textContent = 'חבטת שמאל';
      state.practiceCounts.left += 1;
    }
    bumpAimCounter(aim);

    if (els.practiceDetailLines) {
      els.practiceDetailLines.classList.remove('hidden');
      els.practiceDetailLines.innerHTML = [
        `נחיתה: <strong>${place}</strong> · עוצמה ${level}/5`,
      ].join('<br>');
    }
    els.practiceAimBlock?.classList.remove('hidden');
    setAimBar(aim);
    syncPracticeCounters();

    if (els.hudMsg) {
      els.hudMsg.textContent = `${detail.side === 'right' ? 'ימין' : 'שמאל'} · aim ${formatAimValue(aim)} (${place}) · ${level}/5`;
    }
  }

  function setPracticeMode(on) {
    state.practiceMode = !!on;
    document.body.classList.toggle('practice-active', state.practiceMode);
    els.practicePanel?.classList.toggle('hidden', !state.practiceMode);
    if (els.btnPractice) {
      els.btnPractice.textContent = state.practiceMode
        ? 'מצב אימון פעיל'
        : 'מצב אימון חבטות';
      els.btnPractice.classList.toggle('hand-active', state.practiceMode);
    }
    if (state.practiceMode) {
      setStatus('מצב אימון: חבוט ותראה לאן הכדור היה הולך.');
      if (els.practiceResult) resetPracticeDisplay();
    } else {
      setStatus('יצאת מאימון. אפשר לשחק.');
    }
    updateViz();
  }

  function emitSwing(intensity, side, aimBias = 0, powerLevel = 0, practiceMeta = null) {
    const now = performance.now();
    if (now - state.lastSwingAt < SWING.cooldownMs) return;

    // Only the 3 defined strokes count as a hit — never "center" / unknown
    if (side !== 'left' && side !== 'right') {
      return;
    }

    state.lastSwingAt = now;
    const power = Math.max(0.1, Math.min(1, intensity));
    const hitSide = side;
    const aim = Math.max(-1, Math.min(1, Number(aimBias) || 0));
    let level = Math.round(Number(powerLevel) || 0);
    if (level < 1 || level > 5) {
      level = Math.max(1, Math.min(5, Math.round(power * 5)));
    }

    if (state.practiceMode) {
      showPracticeStroke({
        side: hitSide,
        aim,
        powerLevel: level,
        pose: practiceMeta?.pose,
        toScreen: practiceMeta?.toScreen,
        peak: practiceMeta?.peak ?? practiceMeta?.powerInfo?.peak,
        endScreen: practiceMeta?.endScreen,
        forwardMs: practiceMeta?.forwardMs,
        orientNz: practiceMeta?.orientNz,
        gravNz: practiceMeta?.gravNz,
        endBeta: practiceMeta?.endBeta,
        tiltMax: practiceMeta?.tiltMax,
        tiltMin: practiceMeta?.tiltMin,
      });
    } else if (state.slot) {
      socket.emit('swing', {
        intensity: power,
        side: hitSide,
        aim,
        powerLevel: level,
        ts: Date.now(),
      });
    }

    els.wiiRemote?.classList.add('swing');
    setTimeout(() => els.wiiRemote?.classList.remove('swing'), 180);
    vibrate(hitSide === 'left' ? [20, 30, 40] : [40, 30, 20]);
    if (!state.practiceMode) {
      const sideLabel = hitSide === 'left' ? 'שמאל' : 'ימין';
      const place = aimPlacementLabel(aim);
      els.hudMsg.textContent = `חבטת ${sideLabel} · ${place} · עוצמה ${level}/5`;
    }
  }

  function readLinearAccel(ev) {
    const a = ev.acceleration;
    if (a && (a.x != null || a.y != null || a.z != null)) {
      return { x: a.x || 0, y: a.y || 0, z: a.z || 0, ok: true };
    }
    const ag = ev.accelerationIncludingGravity;
    if (!ag) return { x: 0, y: 0, z: 0, ok: false };
    if (!state._prevAg) state._prevAg = { x: ag.x || 0, y: ag.y || 0, z: ag.z || 0 };
    const x = (ag.x || 0) - state._prevAg.x;
    const y = (ag.y || 0) - state._prevAg.y;
    const z = (ag.z || 0) - state._prevAg.z;
    state._prevAg = { x: ag.x || 0, y: ag.y || 0, z: ag.z || 0 };
    return { x: x * 8, y: y * 8, z: z * 8, ok: true };
  }

  function readGravity(ev) {
    const ag = ev.accelerationIncludingGravity;
    if (ag && (ag.x != null || ag.y != null || ag.z != null)) {
      return { x: ag.x || 0, y: ag.y || 0, z: ag.z || 0 };
    }
    return { x: 0, y: 0, z: 0 };
  }

  function onDeviceOrientation(ev) {
    if (ev.gamma != null) state.holdGamma = ev.gamma;
    if (ev.beta != null) state.holdBeta = ev.beta;
  }

  /**
   * Start pose only: upright ("ישר") vs inverted ("הפוך").
   * L/R is decided later by motion toward screen vs toward back.
   */
  function poseFromGravity(gx, gy, gz, beta) {
    const mag = Math.sqrt(gx * gx + gy * gy + gz * gz) || 9.8;
    const ny = gy / mag;

    let upright = ny < -0.45;
    if (!Number.isFinite(ny) || mag < 4) {
      upright = beta > 25 && beta < 85;
    }
    return { upright, inverted: !upright, ny };
  }

  function inferStartPose(samples) {
    const frozen = state.startPoseSample;
    if (frozen && nowOk(frozen.t)) {
      return poseFromGravity(frozen.gx, frozen.gy, frozen.gz, frozen.beta);
    }

    if (!samples.length) {
      return poseFromGravity(0, -9.8, 0, state.holdBeta);
    }

    let peak = 0;
    let peakI = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].mag > peak) {
        peak = samples[i].mag;
        peakI = i;
      }
    }
    const tPeak = samples[peakI].t;
    const early = samples.filter((s) => s.t >= tPeak - 320 && s.t <= tPeak - 80);
    const use = early.length >= 3 ? early : samples.slice(0, Math.max(3, Math.floor(peakI * 0.35)));

    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    for (const s of use) {
      if (s.gx == null) continue;
      sx += s.gx;
      sy += s.gy;
      sz += s.gz;
      n += 1;
    }
    if (!n) return poseFromGravity(0, -9.8, 0, state.holdBeta);
    return poseFromGravity(sx / n, sy / n, sz / n, state.holdBeta);
  }

  function nowOk(t) {
    return t && performance.now() - t < 2500;
  }

  /**
   * Motion along the phone's screen axis (device Z).
   * On iOS, +Z points out of the screen (direction the face looks).
   * towardScreen > 0  → thrust in the screen-facing direction
   * towardScreen < 0  → thrust toward the back of the phone
   */
  function measureScreenAxisMotion(samples) {
    let peak = 0;
    let peakI = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].mag > peak) {
        peak = samples[i].mag;
        peakI = i;
      }
    }
    const tPeak = samples[peakI].t;
    const win = samples.filter((s) => s.t >= tPeak - 180 && s.t <= tPeak + 120);
    const use = win.length >= 3 ? win : samples;

    let sumAz = 0;
    let sumAy = 0;
    let peakAz = 0;
    for (let i = 1; i < use.length; i += 1) {
      const dt = Math.max(0.008, (use[i].t - use[i - 1].t) / 1000);
      sumAz += use[i].az * dt;
      sumAy += use[i].ay * dt;
      if (Math.abs(use[i].az) > Math.abs(peakAz)) peakAz = use[i].az;
    }

    // Primary: Z through the screen. Flip sign — device +Z was opposite to "toward screen face" in practice.
    let towardScreen = -sumAz;
    if (Math.abs(sumAz) < 0.05 && Math.abs(peakAz) > 2) towardScreen = -peakAz;
    if (Math.abs(towardScreen) < 0.04 && Math.abs(sumAy) > 0.08) {
      towardScreen = sumAy > 0 ? -1 : 1;
    }

    return {
      towardScreen,
      towardScreenFace: towardScreen > 0.02,
      towardBack: towardScreen < -0.02,
      sumAz,
      peakAz,
    };
  }

  /**
   * End pose + stroke side → placement bias for the opponent half.
   * +1 = same side (down the line), −1 = cross-court, 0 = center.
   *
   * Primary signal: screen tilt at end of swing (nz on device Z).
   * Secondary: legacy gravity/beta blend when tilt is ambiguous.
   */
  function measureEndAim(samples, side, motion) {
    const righty = state.handedness !== 'left';
    const endGrav = measureEndScreenTilt(samples, motion);
    const beta = Math.abs(state.holdBeta || 0);
    const betaAim = clamp((beta - 32) / 42, -1, 1);

    if (!endGrav) {
      return {
        aim: betaAim,
        nz: 0,
        strokeAim: 0,
        endScreen: '—',
        orientConf: 0,
        forwardMs: 0,
      };
    }

    const { nz, orientConf, forwardMs, orientNz, gravNz } = endGrav;
    const faceFlat = Math.abs(nz);
    const legacy = betaAim * 0.4;

    const strokeAim = strokePlacementAim(side, nz, righty);
    const tiltClear = faceFlat >= 0.2;
    const strokeWeight = tiltClear
      ? clamp(0.88 + orientConf * 0.08, 0.88, 0.96)
      : clamp(0.65 + orientConf * 0.2, 0.65, 0.85);
    const aim = clamp(strokeAim * strokeWeight + legacy * (1 - strokeWeight), -1, 1);
    const amplified = amplifyPlacementAim(aim);

    return {
      aim: amplified,
      rawAim: aim,
      nz,
      strokeAim,
      legacy,
      orientNz,
      gravNz,
      endBeta: endGrav.endBeta,
      tiltMax: endGrav.tiltMax,
      tiltMin: endGrav.tiltMin,
      endScreen: endScreenLabel(nz),
      orientConf,
      forwardMs,
    };
  }

  /**
   * Estimate swing pace from peak accel, thrust, and impulse around the peak.
   * Tuned so moderate swings reach 3–4 and a hard swing can hit 5.
   */
  function measureSwingPower(samples) {
    let peak = 0;
    let peakI = 0;
    let peakThrust = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].mag > peak) {
        peak = samples[i].mag;
        peakI = i;
      }
      if ((samples[i].thrustMag || 0) > peakThrust) {
        peakThrust = samples[i].thrustMag || 0;
      }
    }
    const tPeak = samples[peakI].t;
    const win = samples.filter((s) => s.t >= tPeak - 160 && s.t <= tPeak + 120);
    const use = win.length >= 3 ? win : samples;

    let impulse = 0;
    let peakAz = 0;
    for (let i = 1; i < use.length; i += 1) {
      const dt = Math.max(0.006, (use[i].t - use[i - 1].t) / 1000);
      impulse += use[i].mag * dt;
      if (Math.abs(use[i].az) > Math.abs(peakAz)) peakAz = use[i].az;
    }

    // Easier score curve — everyday swings fill mid tiers
    const sPeak = Math.max(0, Math.min(1, (peak - 8) / 11));
    const sThrust = Math.max(0, Math.min(1, (peakThrust - 5) / 11));
    const sImpulse = Math.max(0, Math.min(1, (impulse - 0.35) / 2.2));
    const sAz = Math.max(0, Math.min(1, (Math.abs(peakAz) - 2.5) / 12));
    const score = Math.max(
      0,
      Math.min(1, sPeak * 0.42 + sThrust * 0.3 + sImpulse * 0.18 + sAz * 0.1)
    );

    // Low thresholds so level 5 is reachable without extreme swings
    let powerLevel = 1;
    if (score >= 0.1) powerLevel = 2;
    if (score >= 0.22) powerLevel = 3;
    if (score >= 0.38) powerLevel = 4;
    if (score >= 0.55) powerLevel = 5;

    // Peak shortcuts — hard physical swings always climb
    if (peak >= 11 || peakThrust >= 9) powerLevel = Math.max(powerLevel, 2);
    if (peak >= 13 || peakThrust >= 11) powerLevel = Math.max(powerLevel, 3);
    if (peak >= 15.5 || peakThrust >= 13.5) powerLevel = Math.max(powerLevel, 4);
    if (peak >= 18.5 || peakThrust >= 16) powerLevel = Math.max(powerLevel, 5);

    return { score, powerLevel, peak, peakThrust, impulse };
  }

  /**
   * Start pose + motion along screen/back axis.
   * Overhead temporarily disabled.
   * Right-handed inverted: toward screen → right, toward back → left
   * Left-handed inverted: opposite
   */
  function classifyStroke(samples) {
    if (!samples.length) return null;

    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].mag > peak) peak = samples[i].mag;
    }
    let energyThrust = 0;
    for (const s of samples) {
      energyThrust += s.ay * s.ay + s.az * s.az;
    }
    if (peak < SWING.minPeak * 0.85 && energyThrust < 80) return null;

    const powerInfo = measureSwingPower(samples);
    const powerLevel = powerInfo.powerLevel;
    const intensity = powerLevel / 5;

    const pose = inferStartPose(samples);
    const motion = measureScreenAxisMotion(samples);
    const righty = state.handedness !== 'left';

    if (!motion.towardScreenFace && !motion.towardBack) {
      return null;
    }

    // Overhead off for now — upright start does not count as a swing
    if (pose.upright || !pose.inverted) {
      return null;
    }

    const toScreen = motion.towardScreenFace;
    const side = righty
      ? toScreen
        ? 'right'
        : 'left'
      : toScreen
        ? 'left'
        : 'right';

    const aimInfo = measureEndAim(samples, side, motion);
    const aim = aimInfo.aim;

    return {
      side,
      intensity,
      powerLevel,
      aim,
      aimInfo,
      pose,
      motion,
      toScreen,
      powerInfo,
    };
  }

  function onDeviceMotion(ev) {
    if (!state.calibrated) return;

    const now = performance.now();
    const lin = readLinearAccel(ev);
    if (!lin.ok) return;
    const g = readGravity(ev);

    const ax = lin.x;
    const ay = lin.y;
    const az = lin.z;
    const thrustMag = Math.sqrt(ay * ay + az * az);
    const mag = Math.sqrt(ax * ax * 0.35 + ay * ay + az * az);
    const rr = ev.rotationRate || {};

    state.samples.push({
      t: now,
      ax,
      ay,
      az,
      gx: g.x,
      gy: g.y,
      gz: g.z,
      beta: state.holdBeta,
      gamma: state.holdGamma,
      rg: rr.gamma || 0,
      rb: rr.beta || 0,
      mag,
      thrustMag,
    });
    const cutoff = now - SWING.bufferMs;
    while (state.samples.length && state.samples[0].t < cutoff) state.samples.shift();

    if (state.swingArmed && mag < SWING.minPeak * 0.5) {
      state.startPoseSample = {
        t: now,
        gx: g.x,
        gy: g.y,
        gz: g.z,
        beta: state.holdBeta,
        gamma: state.holdGamma,
      };
    }

    state.peakMag *= 0.84;
    if (mag > state.peakMag) state.peakMag = mag;

    const strong = mag >= SWING.minPeak && thrustMag >= SWING.minPeak * 0.55;
    if (!strong && mag < SWING.minPeak * 0.4) {
      state.swingArmed = true;
      return;
    }

    if (strong && state.swingArmed && mag >= state.peakMag * 0.9) {
      state.swingArmed = false;
      const result = classifyStroke(state.samples.slice());
      if (result && result.side) {
        emitSwing(result.intensity, result.side, result.aim, result.powerLevel, {
          pose: result.pose,
          toScreen: result.toScreen,
          powerInfo: result.powerInfo,
          peak: result.powerInfo?.peak,
          endScreen: result.aimInfo?.endScreen,
          forwardMs: result.aimInfo?.forwardMs,
          orientNz: result.aimInfo?.orientNz,
          gravNz: result.aimInfo?.gravNz,
          endBeta: result.aimInfo?.endBeta,
          tiltMax: result.aimInfo?.tiltMax,
          tiltMin: result.aimInfo?.tiltMin,
        });
      } else {
        if (state.practiceMode) showPracticeStroke(null);
        state.swingArmed = true;
      }
      state.peakMag = 0;
    }
  }

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  function isSecureEnough() {
    if (!isIOS()) return true;
    return window.isSecureContext || location.protocol === 'https:';
  }

  async function ensureIosHttps() {
    if (!isIOS()) return true;
    if (isSecureEnough()) return true;

    els.secureHint.classList.remove('hidden');
    setStatus('מכין את חיישני התנועה…');

    try {
      const res = await fetch(`/tunnel.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.url) {
          const next = `${data.url.replace(/\/$/, '')}${location.pathname}${location.search}`;
          els.secureHint.innerHTML =
            `<a class="text-sky-300 underline" href="${next}">המשך כאן</a>`;
          location.replace(next);
          return false;
        }
      }
    } catch (_) {
      /* ignore */
    }

    els.secureHint.textContent = 'סרוק שוב את הקוד מהמסך של המשחק.';
    return false;
  }

  async function enableMotion() {
    const okHttps = await ensureIosHttps();
    if (!okHttps) return;

    if (!isSecureEnough()) {
      els.secureHint.classList.remove('hidden');
      els.secureHint.textContent = 'לא ניתן להפעיל חיישני תנועה בדף הזה.';
      setStatus('סרוק שוב את הקוד מהמסך של המשחק.');
      return;
    }

    try {
      if (
        typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function'
      ) {
        const motion = await DeviceMotionEvent.requestPermission();
        if (motion !== 'granted') {
          setStatus('נדחתה גישה לתנועה. אשר בפופאפ של ספארי.');
          return;
        }
      }
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        try {
          await DeviceOrientationEvent.requestPermission();
        } catch (_) {
          /* optional */
        }
      }

      window.removeEventListener('devicemotion', onDeviceMotion, true);
      window.addEventListener('devicemotion', onDeviceMotion, true);
      window.removeEventListener('deviceorientation', onDeviceOrientation, true);
      window.addEventListener('deviceorientation', onDeviceOrientation, true);

      state.motionEnabled = true;
      els.btnCalibrate.disabled = false;
      if (els.btnPractice) els.btnPractice.disabled = false;
      els.btnMotion.textContent = 'שלט תנועה פעיל';
      els.btnMotion.disabled = true;
      els.secureHint.classList.add('hidden');
      setStatus('החזק את הפלאפון הפוך כלפי מעלה · דחף באלכסון למרכז הגוף');
      updateViz();
      setTimeout(() => {
        if (!state.calibrated && state.motionEnabled) calibrate(true);
      }, 500);
    } catch (err) {
      console.warn(err);
      setStatus('לא ניתן להפעיל חיישנים. אשר את בקשת ההרשאה ונסה שוב.');
    }
  }

  function calibrate(silent) {
    state.calibrated = true;
    state.samples = [];
    state.peakMag = 0;
    state.swingArmed = true;
    socket.emit('calibrate');
    setStatus('כויל! מחזיקים זקוף · חבטה = דחיפה באלכסון לכיוון מרכז הגוף');
    if (!silent) vibrate([15, 30, 15]);
    if (els.btnPractice) els.btnPractice.disabled = false;
    updateViz();
    updateReadyButton();
  }

  function applyPlayerTheme(slot) {
    document.body.classList.remove('player-p1', 'player-p2', 'bg-slate-950');
    const n = Number(slot);
    const nameBit = state.playerName ? ` · ${state.playerName}` : '';
    if (n === 1) {
      document.body.classList.add('player-p1');
      if (els.slotLabel) els.slotLabel.textContent = `שחקן 1 · כחול${nameBit}`;
      const accent = document.getElementById('player-accent-label');
      if (accent) accent.textContent = 'שחקן 1 — כחול';
    } else if (n === 2) {
      document.body.classList.add('player-p2');
      if (els.slotLabel) els.slotLabel.textContent = `שחקן 2 · אדום${nameBit}`;
      const accent = document.getElementById('player-accent-label');
      if (accent) accent.textContent = 'שחקן 2 — אדום';
    }
  }

  function savePlayerName(showStatus) {
    const raw = (els.playerName?.value || '').trim().slice(0, 16);
    state.playerName = raw;
    localStorage.setItem(NAME_KEY, raw);
    if (!state.slot) {
      if (showStatus) setStatus('השם נשמר במכשיר. יתעדכן אחרי החיבור לחדר.');
      return;
    }
    socket.emit('setPlayerName', { name: raw || (state.slot === 1 ? 'P1' : 'P2') }, (res) => {
      if (res?.ok) {
        state.playerName = res.name;
        if (els.playerName) els.playerName.value = res.name === 'P1' || res.name === 'P2' ? raw : res.name;
        applyPlayerTheme(state.slot);
        if (showStatus) setStatus(`השם עודכן: ${res.name}`);
      }
    });
  }

  function joinRoom() {
    if (!state.room) {
      setStatus('סרוק את קוד ה־QR מהמסך של המשחק כדי להתחבר.');
      els.slotLabel.textContent = 'לא מחובר לחדר';
      return;
    }
    els.roomLabel.textContent = `חדר ${state.room}`;
    if (els.playerName && state.playerName) els.playerName.value = state.playerName;
    socket.emit(
      'join',
      {
        role: 'controller',
        room: state.room,
        game: gameParam,
        name: state.playerName || undefined,
      },
      (res) => {
        if (!res?.ok) {
          setStatus(res?.error || 'לא ניתן להצטרף.');
          els.slotLabel.textContent = 'לא מחובר';
          return;
        }
        state.slot = res.slot;
        state.ready = !!res.ready;
        if (res.name) {
          state.playerName = res.name;
          if (els.playerName && (res.name !== 'P1' && res.name !== 'P2')) {
            els.playerName.value = res.name;
          }
        }
        applyPlayerTheme(res.slot);
        if (els.wiiSlot) els.wiiSlot.textContent = String(res.slot);
        setStatus(
          res.slot === 1
            ? 'מחובר כשחקן 1 (כחול). הזן שם, הפעל תנועה, ואז לחץ מוכן.'
            : 'מחובר כשחקן 2 (אדום). הזן שם, הפעל תנועה, ואז לחץ מוכן.'
        );
        setConnected(true);
        updateReadyButton();
        if (state.playerName) savePlayerName(false);
      }
    );
  }

  if (els.touchPad) {
    els.touchPad.addEventListener('pointerdown', (e) => {
      els.touchPad.setPointerCapture(e.pointerId);
      state.touchId = e.pointerId;
      state.touchActive = true;
      state.touchStartX = e.clientX;
      state.touchStartY = e.clientY;
      state.touchStartT = performance.now();
    });
    function endTouch(e) {
      if (!state.touchActive || e.pointerId !== state.touchId) return;
      const dt = performance.now() - state.touchStartT;
      const dy = state.touchStartY - e.clientY; // up on screen = positive
      const dx = e.clientX - state.touchStartX;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const speed = dist / Math.max(dt, 1);
      if (dist < 40 || speed < 0.22) {
        state.touchActive = false;
        state.touchId = null;
        return;
      }
      // Touch mimics diagonal-up toward center: flick upward, side from start half
      // Touch: left/right only (overhead disabled)
      let side;
      if (Math.abs(dx) < 20 && dy > 40) {
        state.touchActive = false;
        state.touchId = null;
        return; // ignore vertical-only (was overhead)
      }
      const startRight = state.touchStartX > window.innerWidth * 0.5;
      side = startRight ? 'right' : 'left';
      if (state.handedness === 'left') side = side === 'left' ? 'right' : 'left';
      let touchLevel = 1;
      if (speed >= 0.28) touchLevel = 2;
      if (speed >= 0.45) touchLevel = 3;
      if (speed >= 0.7) touchLevel = 4;
      if (speed >= 1.05) touchLevel = 5;
      emitSwing(touchLevel / 5, side, 0, touchLevel);
      state.touchActive = false;
      state.touchId = null;
    }
    els.touchPad.addEventListener('pointerup', endTouch);
    els.touchPad.addEventListener('pointercancel', endTouch);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') emitSwing(0.8, 'left');
    if (e.code === 'KeyE') emitSwing(0.8, 'right');
  });

  els.btnSaveName?.addEventListener('click', () => savePlayerName(true));
  els.playerName?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      savePlayerName(true);
    }
  });
  if (els.playerName && state.playerName) els.playerName.value = state.playerName;

  els.btnMotion.addEventListener('click', () => {
    unlockAudio();
    enableMotion();
  });
  els.btnCalibrate.addEventListener('click', () => {
    unlockAudio();
    calibrate(false);
  });
  els.btnReady?.addEventListener('click', () => {
    unlockAudio();
    if (!state.slot || !state.calibrated) {
      setStatus('קודם הפעל שלט תנועה.');
      return;
    }
    setReady(!state.ready);
  });
  els.btnHandRight?.addEventListener('click', () => setHandedness('right'));
  els.btnHandLeft?.addEventListener('click', () => setHandedness('left'));
  els.btnPractice?.addEventListener('click', () => {
    if (!state.motionEnabled || !state.calibrated) {
      setStatus('קודם הפעל שלט תנועה.');
      return;
    }
    setPracticeMode(!state.practiceMode);
  });
  els.btnPracticeExit?.addEventListener('click', () => setPracticeMode(false));
  els.btnPracticeReset?.addEventListener('click', () => {
    state.practiceCounts = { right: 0, left: 0, sameSide: 0, crossCourt: 0, center: 0 };
    syncPracticeCounters();
    resetPracticeDisplay();
  });

  socket.on('connect', () => {
    setConnected(true);
    joinRoom();
  });
  socket.on('disconnect', () => {
    setConnected(false);
    setStatus('נותק. מתחבר מחדש…');
  });
  socket.on('screenDisconnected', () => {
    setStatus('מסך המשחק נסגר.');
  });
  socket.on('gameStarted', (data) => {
    unlockAudio();
    els.hudMsg.textContent = data.mode === 'ai' ? 'מול מחשב — בהצלחה!' : '2 שחקנים — בהצלחה!';
    playHitFeedback(3, 'point');
  });
  socket.on('haptic', (data) => {
    unlockAudio();
    const reason = data?.reason || 'hit';
    const lvl = data?.powerLevel || 3;
    if (Array.isArray(data?.pattern) && data.pattern.length) {
      vibrate(data.pattern);
      if (reason === 'hit') buzzAudio(lvl);
    } else {
      playHitFeedback(lvl, reason);
    }
    if (reason === 'point') els.hudMsg.textContent = 'נקודה!';
    if (reason === 'miss') els.hudMsg.textContent = 'פספוס / צד לא נכון';
    if (reason === 'hit') els.hudMsg.textContent = `פגיעה! עוצמה ${lvl}/5`;
  });
  socket.on('hud', (data) => {
    if (data.display) els.hudScore.textContent = data.display;
    else if (data.sets && data.games)
      els.hudScore.textContent = `${data.sets.p1}-${data.sets.p2} | ${data.games.p1}-${data.games.p2} | ${data.pointsP1}-${data.pointsP2}`;
    else if (data.p1 != null && data.p2 != null) els.hudScore.textContent = `${data.p1} – ${data.p2}`;
    if (data.message) els.hudMsg.textContent = data.message;
  });
  socket.on('scoreUpdate', (data) => {
    if (data.display) els.hudScore.textContent = data.display;
    else if (data.sets && data.games)
      els.hudScore.textContent = `${data.sets.p1}-${data.sets.p2} | ${data.games.p1}-${data.games.p2} | ${data.pointsP1}-${data.pointsP2}`;
  });

  document.body.addEventListener(
    'touchmove',
    (e) => {
      if (e.target.closest('.wii-stage') || e.target.closest('.touch-pad')) e.preventDefault();
    },
    { passive: false }
  );

  if (isIOS() && !isSecureEnough()) {
    ensureIosHttps();
  }

  if (!roomParam) setStatus('סרוק את קוד ה־QR מהמסך של המשחק כדי להתחבר.');
  updateHandButtons();
  updateHoldRules();
  updateViz();
  updateReadyButton();
})();
