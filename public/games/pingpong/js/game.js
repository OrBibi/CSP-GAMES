/**
 * Ping Pong — 2D table view driven by the same phone swing logic as tennis.
 */
(function () {
  const GAME_ID = 'pingpong';
  const WIN = 11;
  const WIN_BY = 2;

  const i18n = window.CSPI18n;
  const t = (key, params) => i18n.t(key, params);

  const TABLE = { w: 0, h: 0, margin: 28, padW: 90, padH: 12 };
  const HIT = {
    swingWindowMs: 550,
    zoneDepth: 70,
    maxLateralMiss: 55,
    sideThreshold: 0.22,
    powerSpeeds: [7.5, 8.5, 9.5, 10.5, 11.5],
    maxFairAimX: 4.5,
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

  function drawQr(text, imgId) {
    const img = document.getElementById(imgId);
    if (img) img.src = `/api/qr?text=${encodeURIComponent(text)}&t=${Date.now()}`;
  }

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
    victoryOverlay: document.getElementById('victory-overlay'),
    victoryTitle: document.getElementById('victory-title'),
    victorySub: document.getElementById('victory-sub'),
    btnVictoryLobby: document.getElementById('btn-victory-lobby'),
    canvas: document.getElementById('game-canvas'),
  };

  const socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });

  let room = null;
  let setupMode = GUEST_SCREEN ? 'remote' : 'couch';
  let isGuestScreen = GUEST_SCREEN;
  let controllers = { p1: false, p2: false, ready1: false, ready2: false };
  let running = false;
  let mode = null;
  let controllerUrl = '';
  let messageTimer = 0;
  let winner = 0;
  let servingSlot = 1;
  /** Last status shown, kept as a key so it can be re-rendered on language change. */
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

  const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 9, inPlay: false };
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

  /** Set the lobby status from a translation key so it survives a language switch. */
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

  /**
   * Show a transient message on the table. The key is kept so the line can be
   * re-rendered if the player switches language mid-rally.
   */
  function showMessage(key, params, sec = 1) {
    messageKey = key;
    messageParams = params || null;
    if (els.message) els.message.textContent = t(key, params);
    messageTimer = sec;
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

  /**
   * One screen: both QR codes, no room code.
   * Two computers: room code plus only this screen's own QR.
   */
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
    // Carry the screen's language so the phone opens the controller in it too.
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

  function layoutPads() {
    const innerW = TABLE.w - TABLE.margin * 2 - TABLE.padW;
    pad[1].y = TABLE.h - TABLE.margin - TABLE.padH;
    pad[2].y = TABLE.margin;
    pad[1].x = clamp(pad[1].x, TABLE.margin, TABLE.margin + innerW);
    pad[2].x = clamp(pad[2].x, TABLE.margin, TABLE.margin + innerW);
  }

  function resetBall(toSlot) {
    servingSlot = toSlot === 1 ? 2 : 1;
    updateServeIndicator();
    ball.x = TABLE.w / 2;
    ball.y = TABLE.h / 2;
    const speed = HIT.powerSpeeds[2];
    ball.vx = (Math.random() - 0.5) * 3;
    ball.vy = toSlot === 1 ? speed : -speed;
    ball.inPlay = true;
  }

  function updateServeIndicator() {
    els.sideP1?.classList.toggle('is-serving', servingSlot === 1);
    els.sideP2?.classList.toggle('is-serving', servingSlot === 2);
  }

  function normX(x) {
    const half = (TABLE.w - TABLE.margin * 2) * 0.5;
    return clamp((x - TABLE.w / 2) / half, -1, 1);
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

  function tryHit(slot) {
    const input = inputs[slot];
    if (!input.pendingSwing) return false;
    input.pendingSwing = false;
    if (!ball.inPlay) return false;
    if (mode === 'ai' && slot === 2) return false;

    const padY = pad[slot].y;
    const approaching = slot === 1 ? ball.vy > 0 : ball.vy < 0;
    const depth =
      slot === 1
        ? ball.y >= padY - HIT.zoneDepth
        : ball.y <= padY + TABLE.padH + HIT.zoneDepth;
    const lateral = Math.abs(ball.x - (pad[slot].x + TABLE.padW / 2));
    const fresh = performance.now() - input.swingAt < HIT.swingWindowMs;

    const swingSide = input.side === 'left' || input.side === 'right' ? input.side : null;
    if (!(depth && approaching && lateral < HIT.maxLateralMiss && fresh && swingSide)) {
      showMessage('pingpong.msg.tooEarly', null, 0.8);
      return false;
    }

    const needed = neededSwingSide(slot);
    if (needed && swingSide !== needed) {
      showMessage(
        needed === 'right' ? 'pingpong.msg.wrongSideRight' : 'pingpong.msg.wrongSideLeft',
        null,
        0.9
      );
      scores[slot === 1 ? 'p2' : 'p1'] += 1;
      onScore();
      if (running) resetBall(slot === 1 ? 2 : 1);
      return false;
    }

    const powerLevel = clamp(
      Number(input.powerLevel) || powerLevelFromIntensity(input.intensity),
      1,
      5
    );
    const speed = HIT.powerSpeeds[powerLevel - 1];
    const aimBias = amplifyAimForCourt(clamp(Number(input.aim) || 0, -1, 1));
    const placementSide =
      input.phoneSide === 'left' || input.phoneSide === 'right' ? input.phoneSide : swingSide;
    const sameSign =
      placementSide === 'right' ? playerRightSign(slot) : -playerRightSign(slot);
    const maxAbs = (TABLE.w - TABLE.margin * 2) * 0.42;
    const targetX = TABLE.w / 2 + sameSign * aimBias * maxAbs;

    ball.vy = slot === 1 ? -speed : speed;
    ball.vx = clamp((targetX - ball.x) * 0.08, -HIT.maxFairAimX, HIT.maxFairAimX);
    ball.y = slot === 1 ? padY - ball.r - 1 : padY + TABLE.padH + ball.r + 1;
    showMessage('pingpong.msg.hit', { player: displayName(slot), power: powerLevel }, 0.5);
    socket.emit('haptic', { slot, reason: 'hit', powerLevel });
    return true;
  }

  function onScore() {
    els.scoreP1.textContent = String(scores.p1);
    els.scoreP2.textContent = String(scores.p2);
    socket.emit('scoreUpdate', { scores, game: GAME_ID });

    if (scores.p1 >= WIN && scores.p1 - scores.p2 >= WIN_BY) finishMatch(1);
    else if (scores.p2 >= WIN && scores.p2 - scores.p1 >= WIN_BY) finishMatch(2);
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
      // Send the key, not the text: each phone renders it in its own language.
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
    const innerW = TABLE.w - TABLE.margin * 2 - TABLE.padW;
    [1, 2].forEach((slot) => {
      if (!ball.inPlay) return;
      const target = clamp(ball.x - TABLE.padW / 2, TABLE.margin, TABLE.margin + innerW);
      pad[slot].x += (target - pad[slot].x) * clamp(dt * 6, 0, 1);
    });
  }

  function aiReturn() {
    if (mode !== 'ai' || !ball.inPlay || ball.vy >= 0) return;
    if (ball.y > pad[2].y + HIT.zoneDepth) return;
    if (Math.abs(ball.x - (pad[2].x + TABLE.padW / 2)) > HIT.maxLateralMiss) return;
    ball.vy = Math.abs(HIT.powerSpeeds[2]);
    ball.vx = (TABLE.w / 2 - ball.x) * 0.06 + (Math.random() - 0.5) * 2;
  }

  function updateBall() {
    if (!ball.inPlay || !running) return;
    ball.x += ball.vx;
    ball.y += ball.vy;

    const minX = TABLE.margin + ball.r;
    const maxX = TABLE.w - TABLE.margin - ball.r;
    if (ball.x <= minX) {
      ball.x = minX;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x >= maxX) {
      ball.x = maxX;
      ball.vx = -Math.abs(ball.vx);
    }

    tryHit(1);
    tryHit(2);
    aiReturn();

    if (ball.y < -ball.r) {
      scores.p1 += 1;
      onScore();
      if (running) resetBall(2);
    } else if (ball.y > TABLE.h + ball.r) {
      scores.p2 += 1;
      onScore();
      if (running) resetBall(1);
    }
  }

  function render() {
    const ctx = els.canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, TABLE.w, TABLE.h);

    const innerW = TABLE.w - TABLE.margin * 2;
    const innerH = TABLE.h - TABLE.margin * 2;

    const table = ctx.createLinearGradient(0, TABLE.margin, 0, TABLE.h - TABLE.margin);
    table.addColorStop(0, '#0e4a72');
    table.addColorStop(0.5, '#0c5f8f');
    table.addColorStop(1, '#0e4a72');
    ctx.fillStyle = table;
    ctx.fillRect(TABLE.margin, TABLE.margin, innerW, innerH);

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(TABLE.margin, TABLE.margin, innerW, innerH);

    // Centre line along the length of the table.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(TABLE.w / 2, TABLE.margin);
    ctx.lineTo(TABLE.w / 2, TABLE.h - TABLE.margin);
    ctx.stroke();

    // The net.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    ctx.moveTo(TABLE.margin, TABLE.h / 2);
    ctx.lineTo(TABLE.w - TABLE.margin, TABLE.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    drawPaddle(ctx, pad[1].x, pad[1].y, '#38bdf8');
    drawPaddle(ctx, pad[2].x, pad[2].y, '#fb7185');

    if (ball.inPlay) {
      ctx.shadowColor = 'rgba(248, 250, 252, 0.8)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawPaddle(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, TABLE.padW, TABLE.padH, TABLE.padH / 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, TABLE.padW, TABLE.padH);
    }
    ctx.shadowBlur = 0;
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
      updatePads(dt);
      updateBall();
    }
    render();
  }

  function resize() {
    const rect = els.root.getBoundingClientRect();
    TABLE.w = rect.width;
    TABLE.h = rect.height;
    els.canvas.width = TABLE.w * devicePixelRatio;
    els.canvas.height = TABLE.h * devicePixelRatio;
    els.canvas.style.width = `${TABLE.w}px`;
    els.canvas.style.height = `${TABLE.h}px`;
    // Keep the table a sensible shape on very wide screens.
    TABLE.margin = Math.max(20, Math.min(TABLE.w, TABLE.h) * 0.05);
    TABLE.padW = clamp(TABLE.w * 0.14, 70, 160);
    pad[1].x = TABLE.w / 2 - TABLE.padW / 2;
    pad[2].x = TABLE.w / 2 - TABLE.padW / 2;
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
    hideVictory();
    applyNames();
    els.scoreP1.textContent = '0';
    els.scoreP2.textContent = '0';
    if (els.matchStatus) els.matchStatus.textContent = t('pingpong.playing');
    els.lobby.classList.add('hidden');
    els.hud.classList.remove('hidden');
    resize();
    resetBall(1);
    socket.emit('startGame', { mode: nextMode });
    showMessage(
      nextMode === 'ai' ? 'pingpong.msg.youAreBlue' : 'pingpong.msg.goodLuck',
      null,
      1.6
    );
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
    if (payload.pad1) pad[1].x = payload.pad1.x;
    if (payload.pad2) pad[2].x = payload.pad2.x;
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
      pad1: { x: pad[1].x },
      pad2: { x: pad[2].x },
      winner,
    });
  }, 50);

  updateSetupUi();
  updateServeIndicator();
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();
