/**
 * Ping Pong — same swing/return model as tennis, on a table-tennis board.
 * Serves start from the server's end (not mid-table) and travel to the receiver.
 * A pending swing is held until the ball reaches that player's half.
 */
(function () {
  const GAME_ID = 'pingpong';
  const WIN = 11;
  const WIN_BY = 2;

  const i18n = window.CSPI18n;
  const t = (key, params) => i18n.t(key, params);

  /** ITTF table is longer than it is wide; we look down the length toward P2. */
  const TABLE_ASPECT = 1.525 / 2.74;

  const HIT = {
    swingWindowMs: 1100,
    /** Player may swing anywhere on their half, like tennis's deep hit zone. */
    halfPad: 0.08,
    maxLateralMiss: 0.48,
    sideThreshold: 0.22,
    powerSpeeds: [380, 440, 500, 560, 620],
    maxFairAimX: 280,
    aiReturnChance: [0.92, 0.88, 0.84, 0.8, 0.75],
  };

  const PAGE = new URLSearchParams(location.search);
  const GUEST_SCREEN = PAGE.get('guest') === '1';
  const JOIN_ROOM = (PAGE.get('room') || '').trim().toUpperCase();

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function phoneToLogicSide(raw) {
    if (raw === 'left') return 'right';
    if (raw === 'right') return 'left';
    return raw;
  }

  function amplifyAimForCourt(aim) {
    const v = clamp(Number(aim) || 0, -1, 1);
    if (Math.abs(v) < 0.1) return v;
    const sign = Math.sign(v) || 1;
    return clamp(sign * (0.28 + Math.abs(v) * 0.72), -1, 1);
  }

  function powerLevelFromIntensity(intensity) {
    const level = clamp(Number(intensity) || 0.3, 0, 1);
    if (level < 0.22) return 1;
    if (level < 0.4) return 2;
    if (level < 0.58) return 3;
    if (level < 0.76) return 4;
    return 5;
  }

  function aimPlacementLabel(aim) {
    const v = Number(aim) || 0;
    if (v > 0.2) return t('tennis.place.sameSide');
    if (v < -0.2) return t('tennis.place.cross');
    return t('tennis.place.center');
  }

  function drawQr(text, imgId) {
    const img = document.getElementById(imgId);
    if (img) img.src = `/api/qr?text=${encodeURIComponent(text)}&t=${Date.now()}`;
  }

  /** Indoor table-tennis SFX — paddle pop, table tick, point/miss. */
  function createTableSfx() {
    let ctx = null;
    let master = null;

    function ensure() {
      if (ctx) return true;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
        return true;
      } catch (_) {
        return false;
      }
    }

    async function unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (_) {
          /* ignore */
        }
      }
    }

    function noiseBurst(dur, vol, freq) {
      if (!ensure()) return;
      const t0 = ctx.currentTime;
      const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = n.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = n;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t0);
    }

    function tone(freq, dur, vol, type) {
      if (!ensure()) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    return {
      unlock,
      hit(level) {
        const lv = clamp(Number(level) || 3, 1, 5);
        noiseBurst(0.05 + lv * 0.008, 0.12 + lv * 0.03, 1400 + lv * 180);
        tone(420 + lv * 70, 0.07, 0.05 + lv * 0.012, 'sine');
      },
      table() {
        noiseBurst(0.035, 0.08, 900);
        tone(210, 0.05, 0.03, 'sine');
      },
      point() {
        tone(660, 0.12, 0.07, 'triangle');
        tone(880, 0.16, 0.05, 'sine');
      },
      miss() {
        tone(180, 0.18, 0.06, 'sawtooth');
      },
    };
  }

  const sfx = createTableSfx();

  const els = {
    root: document.getElementById('pp-root'),
    lobby: document.getElementById('lobby'),
    hud: document.getElementById('hud'),
    roomCode: document.getElementById('room-code'),
    lobbyStatus: document.getElementById('lobby-status'),
    controllerUrl: document.getElementById('controller-url'),
    dotP1: document.getElementById('dot-p1'),
    dotP2: document.getElementById('dot-p2'),
    pillP1: document.getElementById('pill-p1'),
    pillP2: document.getElementById('pill-p2'),
    readyP1: document.getElementById('ready-p1'),
    readyP2: document.getElementById('ready-p2'),
    btnAi: document.getElementById('btn-ai'),
    btnLocal: document.getElementById('btn-local'),
    btnBack: document.getElementById('btn-back'),
    btnCopyRoom: document.getElementById('btn-copy-room'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    joinRoomInput: document.getElementById('join-room-input'),
    setupMode: document.getElementById('setup-mode'),
    couchPanel: document.getElementById('couch-panel'),
    remoteGuestPanel: document.getElementById('remote-guest-panel'),
    roomCodePill: document.getElementById('room-code-pill'),
    qrBlockP1: document.getElementById('qr-block-p1'),
    qrBlockP2: document.getElementById('qr-block-p2'),
    nameP1: document.getElementById('pp-name-p1'),
    nameP2: document.getElementById('pp-name-p2'),
    sideP1: document.getElementById('pp-side-p1'),
    sideP2: document.getElementById('pp-side-p2'),
    scoreP1: document.getElementById('score-p1'),
    scoreP2: document.getElementById('score-p2'),
    matchStatus: document.getElementById('match-status'),
    message: document.getElementById('message'),
    swingBadge: document.getElementById('swing-badge'),
    victoryOverlay: document.getElementById('victory-overlay'),
    victoryTitle: document.getElementById('victory-title'),
    victorySub: document.getElementById('victory-sub'),
    btnVictoryLobby: document.getElementById('btn-victory-lobby'),
    canvas: document.getElementById('game-canvas'),
  };

  const socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });

  const view = { w: 0, h: 0 };
  const table = { x: 0, y: 0, w: 0, h: 0, rail: 14 };

  let room = null;
  let setupMode = GUEST_SCREEN ? 'remote' : 'couch';
  let isGuestScreen = GUEST_SCREEN;
  let controllers = { p1: false, p2: false, ready1: false, ready2: false };
  let running = false;
  let mode = null;
  let controllerUrl = '';
  let messageTimer = 0;
  let winner = 0;
  /** Player who is serving this point (1 or 2). */
  let servingSlot = 2;
  let lastHitter = 0;
  let lastHumanPower = 3;
  let aiReacted = false;
  let servePause = 0;
  let statusKey = 'status.connecting';
  let statusParams = null;
  let messageKey = null;
  let messageParams = null;

  const playerNames = { p1: '', p2: '' };
  const scores = { p1: 0, p2: 0 };
  const inputs = {
    1: { pendingSwing: false, swingAt: 0, side: null, phoneSide: null, aim: 0, intensity: 0.5, powerLevel: 3 },
    2: { pendingSwing: false, swingAt: 0, side: null, phoneSide: null, aim: 0, intensity: 0.5, powerLevel: 3 },
  };

  const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 8, inPlay: false, squash: 0 };
  const pad = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: 0 },
  };

  function displayName(slot) {
    if (slot === 2 && mode === 'ai') return t('common.computer');
    const stored = slot === 1 ? playerNames.p1 : playerNames.p2;
    if (stored && stored !== 'P1' && stored !== 'P2') return stored;
    return t(slot === 1 ? 'common.player1' : 'common.player2');
  }

  function setStatus(key, params) {
    statusKey = key;
    statusParams = params || null;
    if (els.lobbyStatus) els.lobbyStatus.textContent = t(key, params);
  }

  function setStatusRaw(text) {
    statusKey = null;
    statusParams = null;
    if (els.lobbyStatus) els.lobbyStatus.textContent = text;
  }

  function showMessage(key, params, sec = 1) {
    messageKey = key;
    messageParams = params || null;
    if (els.message) els.message.textContent = t(key, params);
    messageTimer = sec;
  }

  function showSwingBadge(side, modeName) {
    const el = els.swingBadge;
    if (!el) return;
    el.classList.remove('hidden', 'left', 'right', 'center', 'overhead', 'hint');
    if (side === 'left') {
      el.textContent = modeName === 'hint' ? `← ${t('tennis.badge.left')}` : t('tennis.badge.left');
      el.classList.add('left');
    } else if (side === 'right') {
      el.textContent = modeName === 'hint' ? `${t('tennis.badge.right')} →` : t('tennis.badge.right');
      el.classList.add('right');
    } else {
      el.textContent = t('tennis.badge.center');
      el.classList.add('center');
    }
    if (modeName === 'hint') el.classList.add('hint');
    if (modeName === 'hit') {
      clearTimeout(showSwingBadge._t);
      showSwingBadge._t = setTimeout(() => el.classList.add('hidden'), 900);
    }
  }

  function refreshLobby() {
    const c = controllers;
    els.dotP1?.classList.toggle('on', !!c.p1);
    els.dotP2?.classList.toggle('on', !!c.p2);
    els.pillP1?.classList.toggle('is-ready', !!c.ready1);
    els.pillP2?.classList.toggle('is-ready', !!c.ready2);
    if (els.readyP1) {
      els.readyP1.textContent = !c.p1 ? '—' : c.ready1 ? t('common.ready') : '…';
    }
    if (els.readyP2) {
      els.readyP2.textContent = !c.p2 ? '—' : c.ready2 ? t('common.ready') : '…';
    }
    els.qrBlockP1?.classList.toggle('is-connected', !!c.p1);
    els.qrBlockP2?.classList.toggle('is-connected', !!c.p2);
    if (c.name1) playerNames.p1 = c.name1;
    if (c.name2) playerNames.p2 = c.name2;
    applyNames();

    const host = !isGuestScreen;
    if (els.btnAi) els.btnAi.disabled = !host || !(c.p1 && c.ready1);
    if (els.btnLocal) els.btnLocal.disabled = !host || !(c.p1 && c.ready1 && c.p2 && c.ready2);
  }

  function applyNames() {
    if (els.nameP1) els.nameP1.textContent = displayName(1);
    if (els.nameP2) els.nameP2.textContent = displayName(2);
  }

  function updateSetupUi() {
    const remote = setupMode === 'remote';
    els.setupMode?.querySelectorAll('[data-setup]').forEach((btn) => {
      btn.classList.toggle('format-active', (btn.dataset.setup === 'remote') === remote);
    });
    els.couchPanel?.classList.toggle('hidden', remote);
    els.remoteGuestPanel?.classList.toggle('hidden', !remote || isGuestScreen);
    els.roomCodePill?.classList.toggle('hidden', !remote);
    els.qrBlockP1?.classList.toggle('hidden', remote && isGuestScreen);
    els.qrBlockP2?.classList.toggle('hidden', remote && !isGuestScreen);
    els.setupMode?.classList.toggle('hidden', isGuestScreen);
  }

  function applyPhoneUrl(res) {
    if (res) {
      controllerUrl =
        res.controllerUrlHttps ||
        res.controllerUrl ||
        `${location.origin}/controller?game=${GAME_ID}&room=${room}`;
    }
    if (!controllerUrl) return;
    const linked = i18n.withLang(controllerUrl);
    if (els.controllerUrl) els.controllerUrl.textContent = linked;
    drawQr(linked, 'qr-p1');
    drawQr(linked, 'qr-p2');
  }

  function joinHost() {
    setStatus('status.settingUp');
    socket.emit('join', { role: 'screen', game: GAME_ID }, (res) => {
      if (!res?.ok) {
        setStatusRaw(i18n.tError(res, 'status.createFailed'));
        return;
      }
      room = res.room;
      controllers = res.controllers || controllers;
      els.roomCode.textContent = room;
      setStatus('status.scanQr');
      applyPhoneUrl(res);
      refreshLobby();
    });
  }

  function joinGuest(code) {
    socket.emit('join', { role: 'screen', game: GAME_ID, room: code, guestScreen: true }, (res) => {
      if (!res?.ok) {
        setStatusRaw(i18n.tError(res, 'status.joinFailed'));
        return;
      }
      room = res.room;
      isGuestScreen = true;
      controllers = res.controllers || controllers;
      els.roomCode.textContent = room;
      setStatus('status.joinedAsP2');
      applyPhoneUrl(res);
      refreshLobby();
      updateSetupUi();
    });
  }

  function innerRect() {
    return {
      x: table.x + table.rail,
      y: table.y + table.rail,
      w: table.w - table.rail * 2,
      h: table.h - table.rail * 2,
    };
  }

  function layoutPads() {
    const inner = innerRect();
    pad[1].y = inner.y + inner.h - 10;
    pad[2].y = inner.y + 10;
    pad[1].x = clamp(pad[1].x, inner.x + 8, inner.x + inner.w - table.padW - 8);
    pad[2].x = clamp(pad[2].x, inner.x + 8, inner.x + inner.w - table.padW - 8);
  }

  /** ITTF: two serves each until 10–10, then one each. First server is P2 so
   *  the opening ball comes from the far end toward the human (P1). */
  function nextServer() {
    const played = scores.p1 + scores.p2;
    const deuce = scores.p1 >= 10 && scores.p2 >= 10;
    const block = deuce ? 1 : 2;
    return Math.floor(played / block) % 2 === 0 ? 2 : 1;
  }

  function serve() {
    try {
      servingSlot = nextServer();
      const inner = innerRect();
      const speed = HIT.powerSpeeds[1];
      ball.r = Math.max(9, table.w * 0.026);
      ball.x = inner.x + inner.w / 2 + (Math.random() - 0.5) * inner.w * 0.28;
      if (servingSlot === 2) {
        ball.y = inner.y + 28;
        ball.vy = speed;
      } else {
        ball.y = inner.y + inner.h - 28;
        ball.vy = -speed;
      }
      ball.vx = (Math.random() - 0.5) * speed * 0.22;
      ball.inPlay = true;
      ball.squash = 0;
      lastHitter = servingSlot;
      aiReacted = false;
      inputs[1].pendingSwing = false;
      inputs[2].pendingSwing = false;
      updateServeIndicator();
      showMessage(servingSlot === 1 ? 'pingpong.msg.serveNear' : 'pingpong.msg.serveFar', null, 1.4);
      sfx.table();
    } catch (err) {
      console.error('pingpong serve failed', err);
      ball.inPlay = true;
    }
  }

  function updateServeIndicator() {
    els.sideP1?.classList.toggle('is-serving', servingSlot === 1);
    els.sideP2?.classList.toggle('is-serving', servingSlot === 2);
  }

  function normX(x) {
    const inner = innerRect();
    const half = inner.w * 0.5;
    return clamp((x - (inner.x + half)) / half, -1, 1);
  }

  function neededSwingSide(slot) {
    const nx = normX(ball.x);
    const threshold = HIT.sideThreshold;
    if (slot === 2) {
      if (nx > threshold) return 'left';
      if (nx < -threshold) return 'right';
      return null;
    }
    if (nx > threshold) return 'right';
    if (nx < -threshold) return 'left';
    return null;
  }

  function playerRightSign(slot) {
    return slot === 1 ? 1 : -1;
  }

  function approaching(slot) {
    return slot === 1 ? ball.vy > 20 : ball.vy < -20;
  }

  function inHitZone(slot) {
    const inner = innerRect();
    const mid = inner.y + inner.h / 2;
    const padY = HIT.halfPad * inner.h;
    if (slot === 1) return ball.y >= mid - padY && ball.y <= inner.y + inner.h + 36;
    return ball.y <= mid + padY && ball.y >= inner.y - 36;
  }

  function updateSwingHint() {
    if (!running || !ball.inPlay) return;
    const slot = approaching(1) && inHitZone(1) ? 1 : approaching(2) && inHitZone(2) ? 2 : null;
    if (!slot) return;
    const needed = neededSwingSide(slot);
    if (needed === 'right' || needed === 'left') showSwingBadge(needed, 'hint');
  }

  /**
   * Tennis-style return: keep the swing until the ball is on this player's half.
   * Only expire the swing after the window, never while it is still approaching.
   */
  function tryHit(slot) {
    const input = inputs[slot];
    if (!input.pendingSwing) return false;
    if (!ball.inPlay) return false;
    if (mode === 'ai' && slot === 2) return false;

    const fresh = performance.now() - input.swingAt < HIT.swingWindowMs;
    if (!fresh) {
      input.pendingSwing = false;
      showMessage('pingpong.msg.tooEarly', null, 0.9);
      return false;
    }

    if (!(inHitZone(slot) && approaching(slot))) return false;

    input.pendingSwing = false;

    const inner = innerRect();
    const swingSide = input.side === 'left' || input.side === 'right' ? input.side : null;
    if (!swingSide) {
      showMessage('tennis.msg.needSwing', null, 0.9);
      return false;
    }

    showSwingBadge(swingSide, 'hit');

    const needed = neededSwingSide(slot);
    const wrongSide = !!(needed && swingSide !== needed);
    const powerLevel = clamp(
      Number(input.powerLevel) || powerLevelFromIntensity(input.intensity),
      1,
      5
    );
    const speed = HIT.powerSpeeds[powerLevel - 1];
    const aimBias = amplifyAimForCourt(clamp(Number(input.aim) || 0, -1, 1));
    const rightSign = playerRightSign(slot);

    if (wrongSide) {
      const outSign = swingSide === 'right' ? rightSign : -rightSign;
      // Dump the ball off this player's own end — same idea as tennis going long.
      ball.vx = outSign * (inner.w * 0.35);
      ball.vy = slot === 1 ? speed * 0.75 : -speed * 0.75;
      showMessage(
        needed === 'right' ? 'pingpong.msg.wrongSideRight' : 'pingpong.msg.wrongSideLeft',
        null,
        1.1
      );
      socket.emit('haptic', { slot, reason: 'miss' });
      sfx.miss();
      lastHitter = slot;
      return true;
    }

    const placementSide =
      input.phoneSide === 'left' || input.phoneSide === 'right' ? input.phoneSide : swingSide;
    const sameSign = placementSide === 'right' ? rightSign : -rightSign;
    const maxAbs = inner.w * 0.42;
    const landX = inner.x + inner.w / 2 + sameSign * aimBias * maxAbs;
    const flight = inner.h * 0.72;
    ball.vy = slot === 1 ? -speed : speed;
    ball.vx = clamp(((landX - ball.x) / flight) * speed, -HIT.maxFairAimX, HIT.maxFairAimX);
    ball.y = slot === 1 ? pad[slot].y - ball.r - 4 : pad[slot].y + table.padH + ball.r + 4;
    ball.squash = 1;
    lastHitter = slot;
    lastHumanPower = powerLevel;
    aiReacted = false;
    showMessage(
      swingSide === 'right' ? 'pingpong.msg.hitRight' : 'pingpong.msg.hitLeft',
      { place: aimPlacementLabel(aimBias), power: powerLevel },
      0.7
    );
    socket.emit('haptic', { slot, reason: 'hit', powerLevel });
    sfx.hit(powerLevel);
    return true;
  }

  function awardPoint(slot) {
    if (!running) return;
    scores[slot === 1 ? 'p1' : 'p2'] += 1;
    ball.inPlay = false;
    els.scoreP1.textContent = String(scores.p1);
    els.scoreP2.textContent = String(scores.p2);
    socket.emit('scoreUpdate', {
      scores: { ...scores },
      p1: scores.p1,
      p2: scores.p2,
      display: `${scores.p1} – ${scores.p2}`,
      game: GAME_ID,
    });
    socket.emit('haptic', { slot, reason: 'point' });
    socket.emit('haptic', { slot: slot === 1 ? 2 : 1, reason: 'miss' });
    sfx.point();

    if (scores.p1 >= WIN && scores.p1 - scores.p2 >= WIN_BY) finishMatch(1);
    else if (scores.p2 >= WIN && scores.p2 - scores.p1 >= WIN_BY) finishMatch(2);
    else servePause = 0.85;
  }

  function finishMatch(slot) {
    running = false;
    winner = slot;
    ball.inPlay = false;
    showVictory();
  }

  function showVictory() {
    if (!winner) return;
    const wasHidden = els.victoryOverlay?.classList.contains('hidden');
    const name = displayName(winner);
    if (els.matchStatus) els.matchStatus.textContent = t('controller.hudWins', { player: name });
    if (els.victoryTitle) {
      els.victoryTitle.textContent = name;
      els.victoryTitle.classList.toggle('win-p1', winner === 1);
      els.victoryTitle.classList.toggle('win-p2', winner === 2);
    }
    if (els.victorySub) {
      els.victorySub.textContent = t('pingpong.victory.sub', {
        score: `${scores.p1}–${scores.p2}`,
      });
    }
    els.victoryOverlay?.classList.remove('hidden');
    if (wasHidden) {
      socket.emit('hud', {
        slot: winner,
        messageKey: 'controller.hudWins',
        messageParams: { player: name },
      });
      els.btnVictoryLobby?.focus();
    }
  }

  function hideVictory() {
    els.victoryOverlay?.classList.add('hidden');
    winner = 0;
  }

  function updatePads(dt) {
    const inner = innerRect();
    const follow = 1 - Math.exp(-10 * dt);
    [1, 2].forEach((slot) => {
      if (!ball.inPlay) return;
      const coming = approaching(slot);
      const targetX = coming ? ball.x - table.padW / 2 : inner.x + inner.w / 2 - table.padW / 2;
      const next = pad[slot].x + (targetX - pad[slot].x) * follow;
      pad[slot].x = clamp(next, inner.x + 6, inner.x + inner.w - table.padW - 6);
    });
  }

  function aiReturn() {
    if (mode !== 'ai' || !ball.inPlay || !approaching(2) || !inHitZone(2)) return;
    if (aiReacted) return;
    aiReacted = true;
    const lvl = clamp(lastHumanPower || 3, 1, 5);
    const chance = HIT.aiReturnChance[lvl - 1] ?? 0.88;
    if (Math.random() >= chance) return;
    const inner = innerRect();
    const speed = HIT.powerSpeeds[1 + Math.floor(Math.random() * 3)];
    ball.vy = speed;
    ball.vx = (inner.x + inner.w / 2 - ball.x) * 0.9 + (Math.random() - 0.5) * 70;
    ball.y = pad[2].y + table.padH + ball.r + 4;
    ball.squash = 1;
    lastHitter = 2;
    sfx.hit(3);
  }

  function updateBall(dt) {
    if (!ball.inPlay || !running) return;
    if (servePause > 0) return;

    const prevY = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.squash > 0) ball.squash = Math.max(0, ball.squash - dt * 6);

    const inner = innerRect();
    const minX = inner.x + ball.r;
    const maxX = inner.x + inner.w - ball.r;
    if (ball.x <= minX) {
      ball.x = minX;
      ball.vx = Math.abs(ball.vx);
      sfx.table();
    } else if (ball.x >= maxX) {
      ball.x = maxX;
      ball.vx = -Math.abs(ball.vx);
      sfx.table();
    }

    const mid = inner.y + inner.h / 2;
    if ((prevY - mid) * (ball.y - mid) <= 0 && lastHitter) sfx.table();

    tryHit(1);
    tryHit(2);
    aiReturn();

    if (ball.y < inner.y - 28) awardPoint(1);
    else if (ball.y > inner.y + inner.h + 28) awardPoint(2);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, rad);
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  function drawPaddle(ctx, slot) {
    const p = pad[slot];
    const w = table.padW;
    const h = table.padH;
    const rubber = slot === 1 ? '#1d4ed8' : '#b91c1c';
    const wood = '#d6b07a';
    ctx.save();
    ctx.translate(p.x + w / 2, p.y);
    ctx.fillStyle = wood;
    roundRect(ctx, -6, slot === 1 ? h - 2 : -18, 12, 20, 3);
    ctx.fill();
    ctx.fillStyle = rubber;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, h / 2, w * 0.52, h * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const ctx = els.canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    const floor = ctx.createRadialGradient(view.w / 2, view.h / 2, 40, view.w / 2, view.h / 2, view.h * 0.7);
    floor.addColorStop(0, '#24180f');
    floor.addColorStop(1, '#07080c');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, view.w, view.h);

    const rail = table.rail;
    ctx.fillStyle = '#8a5a2b';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 28;
    roundRect(ctx, table.x, table.y, table.w, table.h, 8);
    ctx.fill();
    ctx.shadowBlur = 0;

    const inner = innerRect();
    const surface = ctx.createLinearGradient(inner.x, inner.y, inner.x, inner.y + inner.h);
    surface.addColorStop(0, '#1e6b4a');
    surface.addColorStop(0.5, '#178a58');
    surface.addColorStop(1, '#1e6b4a');
    ctx.fillStyle = surface;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);

    ctx.strokeStyle = 'rgba(248,250,252,0.92)';
    ctx.lineWidth = Math.max(2, inner.w * 0.012);
    ctx.strokeRect(inner.x + 4, inner.y + 4, inner.w - 8, inner.h - 8);

    ctx.beginPath();
    ctx.moveTo(inner.x + inner.w / 2, inner.y + 4);
    ctx.lineTo(inner.x + inner.w / 2, inner.y + inner.h - 4);
    ctx.stroke();

    const netY = inner.y + inner.h / 2;
    ctx.fillStyle = '#c4a574';
    ctx.fillRect(table.x - 6, netY - 7, rail + 10, 14);
    ctx.fillRect(table.x + table.w - rail + 0, netY - 7, rail + 10, 14);
    ctx.fillStyle = 'rgba(248,250,252,0.88)';
    ctx.fillRect(inner.x, netY - 3, inner.w, 6);
    ctx.strokeStyle = 'rgba(15,23,42,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(inner.x, netY);
    ctx.lineTo(inner.x + inner.w, netY);
    ctx.stroke();
    ctx.setLineDash([]);

    drawPaddle(ctx, 2);
    drawPaddle(ctx, 1);

    if (ball.inPlay) {
      const squash = 1 - ball.squash * 0.18;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.scale(1 / squash, squash);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(3, 5, ball.r * 0.9, ball.r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      const glow = ctx.createRadialGradient(-ball.r * 0.3, -ball.r * 0.3, 1, 0, 0, ball.r);
      glow.addColorStop(0, '#fff7ed');
      glow.addColorStop(0.35, '#fb923c');
      glow.addColorStop(1, '#c2410c');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  let lastT = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) {
        messageKey = null;
        messageParams = null;
        if (els.message) els.message.textContent = '';
      }
    }
    if (running && !isGuestScreen) {
      if (servePause > 0) {
        servePause -= dt;
        if (servePause <= 0 && running && !winner && !ball.inPlay) serve();
      } else if (!ball.inPlay && running && !winner) {
        serve();
      } else {
        updatePads(dt);
        updateBall(dt);
        updateSwingHint();
      }
    }
    render();
  }

  function resize() {
    const rect = els.root.getBoundingClientRect();
    view.w = rect.width;
    view.h = rect.height;
    els.canvas.width = view.w * devicePixelRatio;
    els.canvas.height = view.h * devicePixelRatio;
    els.canvas.style.width = `${view.w}px`;
    els.canvas.style.height = `${view.h}px`;

    const padX = Math.max(28, view.w * 0.08);
    const padY = Math.max(96, view.h * 0.14);
    const availW = view.w - padX * 2;
    const availH = view.h - padY * 2;
    let h = availH;
    let w = h * TABLE_ASPECT;
    if (w > availW) {
      w = availW;
      h = w / TABLE_ASPECT;
    }
    table.w = w;
    table.h = h;
    table.x = (view.w - w) / 2;
    table.y = (view.h - h) / 2 + 8;
    table.rail = Math.max(10, w * 0.045);
    table.padW = clamp(w * 0.28, 56, 110);
    table.padH = clamp(h * 0.042, 16, 26);
    pad[1].x = table.x + table.w / 2 - table.padW / 2;
    pad[2].x = table.x + table.w / 2 - table.padW / 2;
    layoutPads();
  }

  function startGame(nextMode) {
    if (!controllers.p1 || !controllers.ready1) {
      setStatus('status.needP1Ready', { player: displayName(1) });
      return;
    }
    if (nextMode === 'local' && (!controllers.p2 || !controllers.ready2)) {
      setStatus('status.needP1Ready', { player: displayName(2) });
      return;
    }
    mode = nextMode;
    running = true;
    scores.p1 = 0;
    scores.p2 = 0;
    winner = 0;
    hideVictory();
    applyNames();
    els.scoreP1.textContent = '0';
    els.scoreP2.textContent = '0';
    if (els.matchStatus) els.matchStatus.textContent = t('pingpong.playing');
    els.lobby.classList.add('hidden');
    els.hud.classList.remove('hidden');
    sfx.unlock();
    resize();
    socket.emit('startGame', { mode: nextMode });
    showMessage(
      nextMode === 'ai' ? 'pingpong.msg.youAreBlue' : 'pingpong.msg.goodLuck',
      null,
      1.4
    );
    servePause = 0.7;
    // Safety: if the animation loop missed the pause edge, still put a ball in play.
    setTimeout(() => {
      if (running && !winner && !ball.inPlay) serve();
    }, 800);
  }

  function returnToLobby() {
    running = false;
    mode = null;
    ball.inPlay = false;
    hideVictory();
    els.hud.classList.add('hidden');
    els.lobby.classList.remove('hidden');
    setStatus('status.backInLobby');
    refreshLobby();
  }

  socket.on('connect', () => {
    if (room) return;
    if (GUEST_SCREEN && JOIN_ROOM) joinGuest(JOIN_ROOM);
    else joinHost();
  });

  socket.on('connect_error', () => setStatus('status.connectionProblem'));
  socket.on('disconnect', () => setStatus('status.connectionLost'));

  socket.on('roomState', (state) => {
    controllers = state;
    refreshLobby();
  });

  socket.on('controllerJoined', (data) => {
    controllers = data.controllers || controllers;
    setStatus('status.playerJoined', { player: displayName(data.slot) });
    refreshLobby();
  });

  socket.on('playerReady', (data) => {
    if (data?.controllers) controllers = data.controllers;
    if (data?.slot) {
      setStatus(data.ready ? 'status.playerIsReady' : 'status.playerNotReady', {
        player: displayName(data.slot),
      });
    }
    refreshLobby();
  });

  socket.on('playerName', (data) => {
    if (data?.controllers) controllers = data.controllers;
    refreshLobby();
  });

  socket.on('controllerLeft', (data) => {
    controllers = data.controllers || controllers;
    setStatus('status.playerLeft', { player: displayName(data.slot) });
    refreshLobby();
    if (running && data.slot === 1) {
      showMessage('pingpong.msg.p1Left', { player: displayName(1) }, 2);
      setTimeout(returnToLobby, 1200);
    }
  });

  socket.on('startDenied', (data) => setStatusRaw(i18n.tError(data, 'status.cannotStart')));

  socket.on('swing', (data) => {
    const slot = data.slot;
    if (!inputs[slot]) return;
    const raw = data.side === 'left' || data.side === 'right' ? data.side : null;
    if (!raw) return;
    inputs[slot].pendingSwing = true;
    const netLag = data.ts ? Math.max(0, Math.min(400, Date.now() - data.ts)) : 0;
    inputs[slot].swingAt = performance.now() - netLag;
    inputs[slot].side = phoneToLogicSide(raw);
    inputs[slot].phoneSide = raw;
    inputs[slot].intensity = clamp(Number(data.intensity) || 0.5, 0.1, 1);
    inputs[slot].aim = clamp(Number(data.aim) || 0, -1, 1);
    inputs[slot].powerLevel = clamp(
      Math.round(Number(data.powerLevel) || 0) ||
        powerLevelFromIntensity(inputs[slot].intensity),
      1,
      5
    );
    if (running && !isGuestScreen) tryHit(slot);
  });

  socket.on('gameStarted', (data) => {
    if (!isGuestScreen) return;
    mode = data?.mode === 'local' ? 'local' : 'ai';
    running = true;
    hideVictory();
    applyNames();
    els.lobby.classList.add('hidden');
    els.hud.classList.remove('hidden');
    if (els.matchStatus) els.matchStatus.textContent = t('pingpong.playing');
    resize();
  });

  socket.on('gameSync', (payload) => {
    if (!isGuestScreen || !payload) return;
    if (payload.scores) {
      scores.p1 = payload.scores.p1 || 0;
      scores.p2 = payload.scores.p2 || 0;
      els.scoreP1.textContent = String(scores.p1);
      els.scoreP2.textContent = String(scores.p2);
    }
    if (payload.ball) {
      ball.x = payload.ball.x;
      ball.y = payload.ball.y;
      ball.vx = payload.ball.vx;
      ball.vy = payload.ball.vy;
      ball.inPlay = payload.ball.inPlay !== false;
    }
    if (payload.table) {
      table.x = payload.table.x;
      table.y = payload.table.y;
      table.w = payload.table.w;
      table.h = payload.table.h;
      table.rail = payload.table.rail;
    }
    if (payload.pad1) pad[1].x = payload.pad1.x;
    if (payload.pad2) pad[2].x = payload.pad2.x;
    if (payload.servingSlot) servingSlot = payload.servingSlot;
    if (payload.winner) {
      winner = payload.winner;
      running = false;
      showVictory();
    }
  });

  socket.on('screenDisconnected', () => setStatus('status.connectionLost'));

  els.btnAi?.addEventListener('click', () => startGame('ai'));
  els.btnLocal?.addEventListener('click', () => startGame('local'));
  els.btnBack?.addEventListener('click', returnToLobby);
  els.btnVictoryLobby?.addEventListener('click', returnToLobby);

  els.btnCopyRoom?.addEventListener('click', async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room);
      setStatus('status.roomCopied', { code: room });
    } catch {
      setStatus('status.roomCode', { code: room });
    }
  });

  els.setupMode?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-setup]');
    if (!btn || isGuestScreen) return;
    setupMode = btn.dataset.setup === 'remote' ? 'remote' : 'couch';
    updateSetupUi();
    if (setupMode === 'remote') {
      if (room) setStatus('status.shareCodeWith', { code: room });
      else setStatus('status.shareCode');
    } else {
      setStatus('status.scanBothQr');
    }
  });

  els.btnJoinRoom?.addEventListener('click', () => {
    const code = (els.joinRoomInput?.value || '').trim().toUpperCase();
    if (code.length !== 4) {
      setStatus('status.codeLength');
      return;
    }
    location.href = `${location.origin}/games/pingpong?guest=1&room=${encodeURIComponent(code)}`;
  });

  window.addEventListener('keydown', (e) => {
    if (!running || isGuestScreen) return;
    let side = null;
    if (e.code === 'KeyQ' || e.code === 'ArrowLeft') side = 'left';
    else if (e.code === 'KeyE' || e.code === 'ArrowRight') side = 'right';
    if (!side) return;
    e.preventDefault();
    const slot = mode === 'local' && controllers.p1 && !controllers.p2 ? 2 : 1;
    inputs[slot].pendingSwing = true;
    inputs[slot].swingAt = performance.now();
    inputs[slot].side = side;
    inputs[slot].phoneSide = side;
    inputs[slot].intensity = 0.75;
    inputs[slot].aim = 0;
    inputs[slot].powerLevel = 3;
    tryHit(slot);
  });

  window.addEventListener('csp:langchange', () => {
    if (statusKey) setStatus(statusKey, statusParams);
    refreshLobby();
    if (messageKey && messageTimer > 0 && els.message) {
      els.message.textContent = t(messageKey, messageParams);
    }
    if (els.matchStatus && !winner && running) {
      els.matchStatus.textContent = t('pingpong.playing');
    }
    if (winner) showVictory();
    applyPhoneUrl(null);
  });

  setInterval(() => {
    if (isGuestScreen || !running) return;
    socket.emit('gameSync', {
      scores: { ...scores },
      ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, inPlay: ball.inPlay },
      table: { x: table.x, y: table.y, w: table.w, h: table.h, rail: table.rail },
      pad1: { x: pad[1].x, y: pad[1].y },
      pad2: { x: pad[2].x, y: pad[2].y },
      servingSlot,
      winner,
    });
  }, 50);

  updateSetupUi();
  updateServeIndicator();
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();
