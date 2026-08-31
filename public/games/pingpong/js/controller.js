(function () {
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').trim().toUpperCase();
  const game = (params.get('game') || 'pingpong').trim().toLowerCase();

  const els = {
    slotLabel: document.getElementById('slot-label'),
    connPill: document.getElementById('conn-pill'),
    statusText: document.getElementById('status-text'),
    btnMotion: document.getElementById('btn-motion'),
    btnReady: document.getElementById('btn-ready'),
    readyStatus: document.getElementById('ready-status'),
  };

  const socket = io({ transports: ['websocket', 'polling'] });
  let slot = null;
  let ready = false;
  let motionEnabled = false;
  let tiltX = 0;

  function setConnected(on) {
    els.connPill.textContent = on ? 'online' : 'offline';
    els.connPill.classList.toggle('online', on);
  }

  function joinRoom() {
    if (!room) {
      els.slotLabel.textContent = 'Missing room code';
      return;
    }
    socket.emit(
      'join',
      { role: 'controller', room, game },
      (res) => {
        if (!res?.ok) {
          els.slotLabel.textContent = res?.error || 'Join failed';
          return;
        }
        slot = res.slot;
        ready = !!res.ready;
        els.slotLabel.textContent = `P${slot}`;
        setConnected(true);
        updateReadyUi();
      }
    );
  }

  function updateReadyUi() {
    els.btnReady.textContent = ready ? 'Not ready' : 'Ready';
    els.readyStatus.textContent = ready ? 'Waiting for desktop start…' : 'Press Ready when motion is on.';
  }

  function emitPaddle() {
    if (!slot || !motionEnabled) return;
    socket.emit('paddle', { x: tiltX });
  }

  function onOrientation(e) {
    if (!motionEnabled) return;
    const gamma = Number(e.gamma) || 0;
    tiltX = Math.max(-1, Math.min(1, gamma / 45));
    emitPaddle();
  }

  async function enableMotion() {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') {
          els.statusText.textContent = 'Motion permission denied.';
          return;
        }
      } catch (_) {
        els.statusText.textContent = 'Could not request motion permission.';
        return;
      }
    }
    motionEnabled = true;
    window.addEventListener('deviceorientation', onOrientation, true);
    els.statusText.textContent = 'Motion on — tilt left/right to move paddle.';
    els.btnMotion.textContent = 'Motion enabled';
    els.btnMotion.disabled = true;
  }

  els.btnMotion.addEventListener('click', enableMotion);
  els.btnReady.addEventListener('click', () => {
    if (!slot) return;
    ready = !ready;
    socket.emit('playerReady', { ready }, (res) => {
      if (res?.ok) {
        ready = !!res.ready;
        updateReadyUi();
      }
    });
  });

  socket.on('connect', joinRoom);
  socket.on('disconnect', () => setConnected(false));
  socket.on('gameStarted', () => {
    els.readyStatus.textContent = 'Match started!';
  });

  setInterval(emitPaddle, 50);
})();
