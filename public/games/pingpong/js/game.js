/**
 * Ping Pong — 2D table view with the same phone swing logic as tennis.
 */
(function () {
  const GAME_ID = 'pingpong';
  const WIN = 11;
  const WIN_BY = 2;

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
    const t = clamp(Number(intensity) || 0.3, 0, 1);
    if (t < 0.22) return 1;
    if (t < 0.4) return 2;
    if (t < 0.58) return 3;
    if (t < 0.76) return 4;
    return 5;
  }

  function drawQr(text, imgId) {
    const img = document.getElementById(imgId);
    if (img) img.src = `/api/qr?text=${encodeURIComponent(text)}&t=${Date.now()}`;
  }

  const els = {
    lobby: document.getElementById('lobby'),
    hud: document.getElementById('hud'),
    roomCode: document.getElementById('room-code'),
    lobbyStatus: document.getElementById('lobby-status'),
    controllerUrl: document.getElementById('controller-url'),
    dotP1: document.getElementById('dot-p1'),
    dotP2: document.getElementById('dot-p2'),
    readyP1: document.getElementById('ready-p1'),
    readyP2: document.getElementById('ready-p2'),
    btnAi: document.getElementById('btn-ai'),
    btnLocal: document.getElementById('btn-local'),
    btnCopyUrl: document.getElementById('btn-copy-url'),
    btnCopyRoom: document.getElementById('btn-copy-room'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    joinRoomInput: document.getElementById('join-room-input'),
    setupMode: document.getElementById('setup-mode'),
    couchPanel: document.getElementById('couch-panel'),
    remoteGuestPanel: document.getElementById('remote-guest-panel'),
    roomCodePill: document.getElementById('room-code-pill'),
    qrBlockP1: document.getElementById('qr-block-p1'),
    qrBlockP2: document.getElementById('qr-block-p2'),
    scoreP1: document.getElementById('score-p1'),
    scoreP2: document.getElementById('score-p2'),
    matchStatus: document.getElementById('match-status'),
    message: document.getElementById('message'),
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

  function isLocalDev() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || /^192\.168\.|^10\./.test(h);
  }

  function showMessage(text, sec = 1) {
    if (els.message) els.message.textContent = text;
    messageTimer = sec;
  }

  function refreshLobby() {
    const c = controllers;
    els.dotP1?.classList.toggle('on', !!c.p1);
    els.dotP2?.classList.toggle('on', !!c.p2);
    if (els.readyP1) {
      els.readyP1.textContent = !c.p1 ? '—' : c.ready1 ? 'Ready' : '…';
    }
    if (els.readyP2) {
      els.readyP2.textContent = !c.p2 ? '—' : c.ready2 ? 'Ready' : '…';
    }
    const host = !isGuestScreen;
    if (els.btnAi) els.btnAi.disabled = !host || !(c.p1 && c.ready1);
    if (els.btnLocal) els.btnLocal.disabled = !host || !(c.p1 && c.ready1 && c.p2 && c.ready2);
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
    controllerUrl =
      res.controllerUrlHttps ||
      res.controllerUrl ||
      `${location.origin}/controller?game=${GAME_ID}&room=${room}`;
    if (els.controllerUrl) els.controllerUrl.textContent = controllerUrl;
    drawQr(controllerUrl, 'qr-p1');
    drawQr(controllerUrl, 'qr-p2');
  }

  function joinHost() {
    els.lobbyStatus.textContent = 'Setting up…';
    socket.emit('join', { role: 'screen', game: GAME_ID }, (res) => {
      if (!res?.ok) {
        els.lobbyStatus.textContent = res?.error || 'Could not start a game. Please reload.';
        return;
      }
      room = res.room;
      controllers = res.controllers || controllers;
      els.roomCode.textContent = room;
      els.lobbyStatus.textContent = 'Scan the QR code with your phone.';
      applyPhoneUrl(res);
      refreshLobby();
    });
  }

  function joinGuest(code) {
    socket.emit('join', { role: 'screen', game: GAME_ID, room: code, guestScreen: true }, (res) => {
      if (!res?.ok) {
        els.lobbyStatus.textContent = res?.error || 'Could not join that room.';
        return;
      }
      room = res.room;
      isGuestScreen = true;
      controllers = res.controllers || controllers;
      els.roomCode.textContent = room;
      els.lobbyStatus.textContent =
        'Joined as Player 2 — scan the QR code below. Player 1 starts the match.';
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
    ball.x = TABLE.w / 2;
    ball.y = TABLE.h / 2;
    const speed = HIT.powerSpeeds[2];
    ball.vx = (Math.random() - 0.5) * 3;
    ball.vy = toSlot === 1 ? speed : -speed;
    ball.inPlay = true;
  }

  function normX(x) {
    const half = (TABLE.w - TABLE.margin * 2) * 0.5;
    return clamp((x - TABLE.w / 2) / half, -1, 1);
  }

  function neededSwingSide(slot) {
    const nx = normX(ball.x);
    const t = HIT.sideThreshold;
    if (slot === 2) {
      if (nx > t) return 'left';
      if (nx < -t) return 'right';
      return null;
    }
    if (nx > t) return 'right';
    if (nx < -t) return 'left';
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
    const depth = slot === 1 ? ball.y >= padY - HIT.zoneDepth : ball.y <= padY + TABLE.padH + HIT.zoneDepth;
    const lateral = Math.abs(ball.x - (pad[slot].x + TABLE.padW / 2));
    const fresh = performance.now() - input.swingAt < HIT.swingWindowMs;

    const swingSide = input.side === 'left' || input.side === 'right' ? input.side : null;
    if (!(depth && approaching && lateral < HIT.maxLateralMiss && fresh && swingSide)) {
      showMessage('Too early — swing when the ball is near you', 0.8);
      return false;
    }

    const needed = neededSwingSide(slot);
    if (needed && swingSide !== needed) {
      showMessage(`Wrong side! Need ${needed.toUpperCase()}`, 0.9);
      scores[slot === 1 ? 2 : 1] += 1;
      onScore();
      resetBall(slot === 1 ? 2 : 1);
      return false;
    }

    const powerLevel = clamp(Number(input.powerLevel) || powerLevelFromIntensity(input.intensity), 1, 5);
    const speed = HIT.powerSpeeds[powerLevel - 1];
    const aimBias = amplifyAimForCourt(clamp(Number(input.aim) || 0, -1, 1));
    const placementSide = input.phoneSide === 'left' || input.phoneSide === 'right' ? input.phoneSide : swingSide;
    const sameSign = placementSide === 'right' ? playerRightSign(slot) : -playerRightSign(slot);
    const maxAbs = (TABLE.w - TABLE.margin * 2) * 0.42;
    const targetX = TABLE.w / 2 + sameSign * aimBias * maxAbs;

    ball.vy = slot === 1 ? -speed : speed;
    ball.vx = clamp((targetX - ball.x) * 0.08, -HIT.maxFairAimX, HIT.maxFairAimX);
    ball.y = slot === 1 ? padY - ball.r - 1 : padY + TABLE.padH + ball.r + 1;
    showMessage(`P${slot} hit · power ${powerLevel}`, 0.5);
    return true;
  }

  function onScore() {
    els.scoreP1.textContent = String(scores.p1);
    els.scoreP2.textContent = String(scores.p2);
    socket.emit('scoreUpdate', { scores, game: GAME_ID });
    if (scores.p1 >= WIN && scores.p1 - scores.p2 >= WIN_BY) {
      running = false;
      els.matchStatus.textContent = 'P1 wins!';
    } else if (scores.p2 >= WIN && scores.p2 - scores.p1 >= WIN_BY) {
      running = false;
      els.matchStatus.textContent = 'P2 wins!';
    }
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

  function updateBall(dt) {
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

    ctx.fillStyle = '#0c4a6e';
    ctx.fillRect(TABLE.margin, TABLE.margin, TABLE.w - TABLE.margin * 2, TABLE.h - TABLE.margin * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(TABLE.margin, TABLE.h / 2);
    ctx.lineTo(TABLE.w - TABLE.margin, TABLE.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(pad[1].x, pad[1].y, TABLE.padW, TABLE.padH);
    ctx.fillStyle = '#f87171';
    ctx.fillRect(pad[2].x, pad[2].y, TABLE.padW, TABLE.padH);

    if (ball.inPlay) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
    }
  }

  let lastT = performance.now();
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0 && els.message) els.message.textContent = '';
    }
    if (running && !isGuestScreen) {
      updatePads(dt);
      updateBall(dt);
    }
    render();
  }

  function resize() {
    const rect = els.canvas.parentElement.getBoundingClientRect();
    TABLE.w = rect.width;
    TABLE.h = Math.max(360, rect.height - (running ? 52 : 0));
    els.canvas.width = TABLE.w * devicePixelRatio;
    els.canvas.height = TABLE.h * devicePixelRatio;
    els.canvas.style.width = TABLE.w + 'px';
    els.canvas.style.height = TABLE.h + 'px';
    pad[1].x = TABLE.w / 2 - TABLE.padW / 2;
    pad[2].x = TABLE.w / 2 - TABLE.padW / 2;
    layoutPads();
  }

  function startGame(nextMode) {
    if (!controllers.p1 || !controllers.ready1) {
      els.lobbyStatus.textContent = 'Player 1 needs to tap Ready on the phone first.';
      return;
    }
    if (nextMode === 'local' && (!controllers.p2 || !controllers.ready2)) {
      els.lobbyStatus.textContent = 'Player 2 needs to tap Ready on the phone first.';
      return;
    }
    mode = nextMode;
    running = true;
    scores.p1 = 0;
    scores.p2 = 0;
    els.scoreP1.textContent = '0';
    els.scoreP2.textContent = '0';
    els.matchStatus.textContent = 'Playing';
    els.lobby.classList.add('hidden');
    els.hud.classList.remove('hidden');
    resize();
    resetBall(1);
    socket.emit('startGame', { mode: nextMode });
    showMessage(nextMode === 'ai' ? 'You are the blue paddle — good luck!' : 'Good luck!');
  }

  socket.on('connect', () => {
    if (room) return;
    if (GUEST_SCREEN && JOIN_ROOM) joinGuest(JOIN_ROOM);
    else joinHost();
  });

  socket.on('roomState', (s) => {
    controllers = s;
    refreshLobby();
  });
  socket.on('controllerJoined', (d) => {
    controllers = d.controllers || controllers;
    refreshLobby();
  });
  socket.on('playerReady', () => refreshLobby());

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
      Math.round(Number(data.powerLevel) || 0) || powerLevelFromIntensity(inputs[slot].intensity),
      1,
      5
    );
    if (running && !isGuestScreen) tryHit(slot);
  });

  socket.on('gameStarted', (data) => {
    if (!isGuestScreen) return;
    mode = data?.mode === 'local' ? 'local' : 'ai';
    running = true;
    els.lobby.classList.add('hidden');
    els.hud.classList.remove('hidden');
    els.matchStatus.textContent = 'Playing';
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
  });

  els.btnAi?.addEventListener('click', () => startGame('ai'));
  els.btnLocal?.addEventListener('click', () => startGame('local'));
  els.btnCopyUrl?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(controllerUrl);
      els.lobbyStatus.textContent = 'Phone URL copied.';
    } catch {
      els.lobbyStatus.textContent = controllerUrl;
    }
  });
  els.btnCopyRoom?.addEventListener('click', async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room);
      els.lobbyStatus.textContent = `Room code ${room} copied.`;
    } catch {
      els.lobbyStatus.textContent = `Room: ${room}`;
    }
  });
  els.setupMode?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-setup]');
    if (!btn || isGuestScreen) return;
    setupMode = btn.dataset.setup === 'remote' ? 'remote' : 'couch';
    updateSetupUi();
    els.lobbyStatus.textContent =
      setupMode === 'remote' && room
        ? `Your room code is ${room} — give it to the other player, then scan the QR with your phone.`
        : 'Scan the QR codes — one phone per player.';
  });
  els.btnJoinRoom?.addEventListener('click', () => {
    const code = (els.joinRoomInput?.value || '').trim().toUpperCase();
    if (code.length !== 4) {
      els.lobbyStatus.textContent = 'Room codes are 4 characters.';
      return;
    }
    location.href = `${location.origin}/games/pingpong?guest=1&room=${encodeURIComponent(code)}`;
  });

  setInterval(() => {
    if (isGuestScreen || !running) return;
    socket.emit('gameSync', {
      scores: { ...scores },
      ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, inPlay: ball.inPlay },
      pad1: { x: pad[1].x },
      pad2: { x: pad[2].x },
    });
  }, 50);

  updateSetupUi();
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();
