(function () {
  const GAME_ID = 'pingpong';
  const WIN = 11;
  const WIN_BY = 2;

  const els = {
    lobby: document.getElementById('lobby'),
    hud: document.getElementById('hud'),
    roomCode: document.getElementById('room-code'),
    lobbyStatus: document.getElementById('lobby-status'),
    controllerUrl: document.getElementById('controller-url'),
    dotP1: document.getElementById('dot-p1'),
    dotP2: document.getElementById('dot-p2'),
    btnStart: document.getElementById('btn-start'),
    scoreP1: document.getElementById('score-p1'),
    scoreP2: document.getElementById('score-p2'),
    matchStatus: document.getElementById('match-status'),
    canvas: document.getElementById('game-canvas'),
    qr: document.getElementById('qr-img'),
  };

  const socket = io();
  let room = null;
  let controllers = { p1: false, p2: false, ready1: false, ready2: false };
  let running = false;
  let paddle1 = 0;
  let paddle2 = 0;
  let scores = { p1: 0, p2: 0 };

  const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 8 };
  const table = { w: 0, h: 0, padW: 80, padH: 12, margin: 24 };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function isLocalDev() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || /^192\.168\.|^10\./.test(h);
  }

  function drawQr(url) {
    if (els.qr) els.qr.src = `/api/qr?text=${encodeURIComponent(url)}&t=${Date.now()}`;
  }

  function refreshLobby() {
    els.dotP1.classList.toggle('online', controllers.p1);
    els.dotP2.classList.toggle('online', controllers.p2);
    const canStart = controllers.p1 && controllers.ready1;
    els.btnStart.disabled = !canStart;
  }

  function resetBall(toP1) {
    ball.x = table.w / 2;
    ball.y = table.h / 2;
    const speed = 6;
    ball.vx = (toP1 ? -1 : 1) * (speed * 0.6);
    ball.vy = (Math.random() - 0.5) * speed;
  }

  function resize() {
    const rect = els.canvas.parentElement.getBoundingClientRect();
    table.w = rect.width;
    table.h = Math.max(320, rect.height - (running ? 48 : 0));
    els.canvas.width = table.w * devicePixelRatio;
    els.canvas.height = table.h * devicePixelRatio;
    els.canvas.style.width = table.w + 'px';
    els.canvas.style.height = table.h + 'px';
  }

  function render() {
    const ctx = els.canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, table.w, table.h);

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(table.w / 2, table.margin);
    ctx.lineTo(table.w / 2, table.h - table.margin);
    ctx.stroke();
    ctx.setLineDash([]);

    const p1y = table.h - table.margin - table.padH;
    const p2y = table.margin;
    const p1x = (paddle1 * 0.5 + 0.5) * (table.w - table.padW - table.margin * 2) + table.margin;
    const p2x = (paddle2 * 0.5 + 0.5) * (table.w - table.padW - table.margin * 2) + table.margin;

    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(p1x, p1y, table.padW, table.padH);
    ctx.fillStyle = '#f87171';
    ctx.fillRect(p2x, p2y, table.padW, table.padH);

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
  }

  function tick() {
    if (!running) return;
    ball.x += ball.vx;
    ball.y += ball.vy;

    const minX = table.margin + ball.r;
    const maxX = table.w - table.margin - ball.r;
    if (ball.x <= minX) {
      ball.x = minX;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x >= maxX) {
      ball.x = maxX;
      ball.vx = -Math.abs(ball.vx);
    }

    const p1y = table.h - table.margin - table.padH;
    const p2y = table.margin;
    const p1x = (paddle1 * 0.5 + 0.5) * (table.w - table.padW - table.margin * 2) + table.margin;
    const p2x = (paddle2 * 0.5 + 0.5) * (table.w - table.padW - table.margin * 2) + table.margin;

    if (ball.vy > 0 && ball.y + ball.r >= p1y && ball.y <= p1y + table.padH) {
      if (ball.x >= p1x && ball.x <= p1x + table.padW) {
        ball.y = p1y - ball.r;
        ball.vy = -Math.abs(ball.vy) - 0.5;
        ball.vx += (ball.x - (p1x + table.padW / 2)) * 0.08;
      }
    }
    if (ball.vy < 0 && ball.y - ball.r <= p2y + table.padH && ball.y >= p2y) {
      if (ball.x >= p2x && ball.x <= p2x + table.padW) {
        ball.y = p2y + table.padH + ball.r;
        ball.vy = Math.abs(ball.vy) + 0.5;
        ball.vx += (ball.x - (p2x + table.padW / 2)) * 0.08;
      }
    }

    if (ball.y < -ball.r) {
      scores.p1 += 1;
      onScore();
      resetBall(false);
    } else if (ball.y > table.h + ball.r) {
      scores.p2 += 1;
      onScore();
      resetBall(true);
    }

    render();
    requestAnimationFrame(tick);
  }

  function onScore() {
    els.scoreP1.textContent = String(scores.p1);
    els.scoreP2.textContent = String(scores.p2);
    socket.emit('scoreUpdate', { scores, game: GAME_ID });
    const w1 = scores.p1 >= WIN && scores.p1 - scores.p2 >= WIN_BY;
    const w2 = scores.p2 >= WIN && scores.p2 - scores.p1 >= WIN_BY;
    if (w1 || w2) {
      running = false;
      els.matchStatus.textContent = w1 ? 'P1 wins!' : 'P2 wins!';
    }
  }

  function startMatch() {
    scores = { p1: 0, p2: 0 };
    els.scoreP1.textContent = '0';
    els.scoreP2.textContent = '0';
    els.matchStatus.textContent = 'Playing';
    els.lobby.classList.add('hidden');
    els.hud.classList.remove('hidden');
    running = true;
    resize();
    resetBall(Math.random() < 0.5);
    requestAnimationFrame(tick);
    socket.emit('startGame', { mode: controllers.p2 ? 'local' : 'ai' });
  }

  function applyControllerUrl(res) {
    const url =
      res.controllerUrlHttps ||
      res.controllerUrl ||
      `${location.origin}/controller?game=${GAME_ID}&room=${room}`;
    els.controllerUrl.textContent = url;
    drawQr(url);
  }

  function joinScreen() {
    els.lobbyStatus.textContent = 'Creating room…';
    socket.emit('join', { role: 'screen', game: GAME_ID }, (res) => {
      if (!res?.ok) {
        els.lobbyStatus.textContent = res?.error || 'Failed';
        return;
      }
      room = res.room;
      els.roomCode.textContent = room;
      controllers = res.controllers || controllers;
      els.lobbyStatus.textContent = 'Scan QR — P1 must press Ready on phone.';
      applyControllerUrl(res);
      refreshLobby();
    });
  }

  socket.on('connect', joinScreen);
  socket.on('roomState', (snap) => {
    controllers = snap;
    refreshLobby();
  });
  socket.on('controllerJoined', () => refreshLobby());
  socket.on('controllerLeft', () => refreshLobby());
  socket.on('playerReady', () => refreshLobby());
  socket.on('paddle', (data) => {
    const x = clamp(Number(data.x) || 0, -1, 1);
    if (data.slot === 1) paddle1 = x;
    if (data.slot === 2) paddle2 = x;
  });

  els.btnStart.addEventListener('click', startMatch);
  window.addEventListener('resize', resize);
})();
