const { resolveControllerUrls } = require('../config/public-url');
const { normalizeGameId, getGame } = require('./game-registry');

function attachSocketHandlers(io, store) {
  io.on('connection', (socket) => {
    socket.data.role = null;
    socket.data.room = null;
    socket.data.gameId = null;
    socket.data.slot = null;

    socket.on('join', (payload = {}, ack) => {
      const role = payload.role === 'controller' ? 'controller' : 'screen';
      const gameId = normalizeGameId(payload.game);
      const game = getGame(gameId);
      let roomCode = typeof payload.room === 'string' ? payload.room.trim().toUpperCase() : '';
      const channel = store.roomKey(gameId, roomCode);

      if (role === 'screen') {
        const isGuest = !!payload.guestScreen;
        if (!roomCode) roomCode = store.createRoomCode(gameId);
        const room = store.getOrCreateRoom(gameId, roomCode);
        const joinChannel = store.roomKey(gameId, roomCode);

        if (room.screenId && room.screenId !== socket.id) {
          if (isGuest && !room.guestScreenId) {
            room.guestScreenId = socket.id;
            socket.data.role = 'screen';
            socket.data.room = roomCode;
            socket.data.gameId = gameId;
            socket.data.isGuestScreen = true;
            socket.join(joinChannel);

            const urls = resolveControllerUrls(roomCode, {
              req: socket.request,
              lanIp: io._cspLanIp,
              port: io._cspHttpPort,
              httpsPort: io._cspHttpsPort,
              gameId,
            });

            if (typeof ack === 'function') {
              ack({
                ok: true,
                room: roomCode,
                game: gameId,
                isGuestScreen: true,
                viewSlot: 2,
                controllerUrl: urls.controllerUrl,
                controllerUrlHttps: urls.controllerUrlHttps,
                controllers: store.roomSnapshot(room),
                gameTitle: game.title,
              });
            }
            io.to(room.screenId).emit('guestScreenJoined', { room: roomCode });
            return;
          }
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'Room already has a game screen.' });
          }
          return;
        }

        if (isGuest) {
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'Open the host screen first, then join with the room code.' });
          }
          return;
        }

        room.screenId = socket.id;
        socket.data.role = 'screen';
        socket.data.room = roomCode;
        socket.data.gameId = gameId;
        socket.data.isGuestScreen = false;
        socket.join(joinChannel);

        const urls = resolveControllerUrls(roomCode, {
          req: socket.request,
          lanIp: io._cspLanIp,
          port: io._cspHttpPort,
          httpsPort: io._cspHttpsPort,
          gameId,
        });

        if (typeof ack === 'function') {
          ack({
            ok: true,
            room: roomCode,
            game: gameId,
            isGuestScreen: false,
            controllerUrl: urls.controllerUrl,
            controllerUrlHttps: urls.controllerUrlHttps,
            lanIp: io._cspLanIp,
            port: io._cspHttpPort,
            httpsPort: io._cspHttpsPort,
            protocol: urls.protocol,
            publicBase: urls.publicBase,
            controllers: store.roomSnapshot(room),
            gameTitle: game.title,
          });
        }

        socket.to(joinChannel).emit('roomState', store.roomSnapshot(room));
        return;
      }

      const existing = store.getRoom(gameId, roomCode);
      if (!roomCode || !existing) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Room not found. Open the desktop lobby first.' });
        }
        return;
      }

      const room = existing;
      if (!room.screenId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Game screen is not connected yet.' });
        }
        return;
      }

      let slot = store.findControllerSlot(room, socket.id);
      if (!slot) {
        if (!room.controllers.has(1)) slot = 1;
        else if (!room.controllers.has(2) && store.maxPlayersFor(gameId) >= 2) slot = 2;
        else {
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'Room already has two controllers.' });
          }
          return;
        }
        room.controllers.set(slot, socket.id);
        room.ready.set(slot, false);
        if (!room.names.has(slot)) {
          room.names.set(slot, slot === 1 ? 'P1' : 'P2');
        }
      }

      if (typeof payload.name === 'string' && payload.name.trim()) {
        room.names.set(slot, store.sanitizeName(payload.name, slot === 1 ? 'P1' : 'P2'));
      }

      socket.data.role = 'controller';
      socket.data.room = roomCode;
      socket.data.gameId = gameId;
      socket.data.slot = slot;
      socket.join(store.roomKey(gameId, roomCode));

      if (typeof ack === 'function') {
        ack({
          ok: true,
          room: roomCode,
          game: gameId,
          slot,
          ready: !!room.ready.get(slot),
          name: room.names.get(slot) || (slot === 1 ? 'P1' : 'P2'),
          controllers: store.roomSnapshot(room),
        });
      }

      io.to(store.roomKey(gameId, roomCode)).emit('roomState', store.roomSnapshot(room));
      if (room.screenId) {
        io.to(room.screenId).emit('controllerJoined', { slot, controllers: store.roomSnapshot(room) });
      }
    });

    socket.on('tilt', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'controller' || !room.screenId) return;
      io.to(room.screenId).emit('tilt', {
        slot: socket.data.slot,
        x: Number(data?.x) || 0,
        y: Number(data?.y) || 0,
        ts: Date.now(),
      });
    });

    socket.on('paddle', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'controller' || !room.screenId) return;
      io.to(room.screenId).emit('paddle', {
        slot: socket.data.slot,
        x: Math.max(-1, Math.min(1, Number(data?.x) || 0)),
        ts: Date.now(),
      });
    });

    socket.on('swing', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'controller' || !room.screenId) return;
      const side =
        data?.side === 'left' || data?.side === 'right' || data?.side === 'overhead'
          ? data.side
          : 'center';
      io.to(room.screenId).emit('swing', {
        slot: socket.data.slot,
        intensity: Math.max(0, Math.min(1, Number(data?.intensity) || 0.5)),
        side,
        aim: Math.max(-1, Math.min(1, Number(data?.aim) || 0)),
        powerLevel: Math.max(1, Math.min(5, Math.round(Number(data?.powerLevel) || 0) || 0)),
        ts: Number(data?.ts) || Date.now(),
      });
    });

    socket.on('swingGate', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'screen') return;
      const slot = Number(data?.slot);
      const open = !!data?.open;
      const targetId = room.controllers.get(slot);
      if (targetId) io.to(targetId).emit('swingGate', { open, slot });
    });

    socket.on('calibrate', () => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'controller' || !room.screenId) return;
      io.to(room.screenId).emit('calibrate', { slot: socket.data.slot, ts: Date.now() });
    });

    socket.on('setPlayerName', (data, ack) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'controller') return;
      const slot = socket.data.slot;
      if (!slot || !room.controllers.has(slot)) return;
      const name = store.sanitizeName(data?.name, slot === 1 ? 'P1' : 'P2');
      room.names.set(slot, name);
      const snap = store.roomSnapshot(room);
      io.to(store.roomKey(socket.data.gameId, socket.data.room)).emit('roomState', snap);
      if (room.screenId) {
        io.to(room.screenId).emit('playerName', { slot, name, controllers: snap });
      }
      if (typeof ack === 'function') ack({ ok: true, name, controllers: snap });
    });

    socket.on('playerReady', (data, ack) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'controller') return;
      const slot = socket.data.slot;
      if (!slot || !room.controllers.has(slot)) return;
      const ready = data?.ready !== false;
      room.ready.set(slot, !!ready);
      const snap = store.roomSnapshot(room);
      io.to(store.roomKey(socket.data.gameId, socket.data.room)).emit('roomState', snap);
      if (room.screenId) {
        io.to(room.screenId).emit('playerReady', { slot, ready: !!ready, controllers: snap });
      }
      if (typeof ack === 'function') ack({ ok: true, ready: !!ready, controllers: snap });
    });

    socket.on('startGame', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'screen') return;
      const mode = data?.mode === 'local' ? 'local' : 'ai';
      if (!room.controllers.has(1) || !room.ready.get(1)) {
        socket.emit('startDenied', { error: 'P1 must be connected and Ready.' });
        return;
      }
      if (mode === 'local' && room.controllers.has(2) && !room.ready.get(2)) {
        socket.emit('startDenied', { error: 'P2 must press Ready.' });
        return;
      }
      room.mode = mode;
      io.to(store.roomKey(socket.data.gameId, socket.data.room)).emit('gameStarted', {
        mode,
        controllers: store.roomSnapshot(room),
      });
    });

    socket.on('haptic', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'screen') return;
      const slot = Number(data?.slot);
      const pattern = Array.isArray(data?.pattern) ? data.pattern : null;
      const powerLevel = Math.max(1, Math.min(5, Math.round(Number(data?.powerLevel) || 3)));
      const targetId = room.controllers.get(slot);
      if (targetId) {
        io.to(targetId).emit('haptic', {
          pattern,
          reason: data?.reason || 'hit',
          powerLevel,
        });
      }
    });

    socket.on('hud', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'screen') return;
      const slot = Number(data?.slot);
      const targetId = room.controllers.get(slot);
      if (targetId) {
        io.to(targetId).emit('hud', data);
      } else {
        socket.to(store.roomKey(socket.data.gameId, socket.data.room)).emit('hud', data);
      }
    });

    socket.on('scoreUpdate', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'screen') return;
      io.to(store.roomKey(socket.data.gameId, socket.data.room)).emit('scoreUpdate', data);
    });

    socket.on('gameSync', (data) => {
      const room = store.getRoom(socket.data.gameId, socket.data.room);
      if (!room || socket.data.role !== 'screen' || socket.data.isGuestScreen) return;
      if (room.guestScreenId) {
        io.to(room.guestScreenId).emit('gameSync', data);
      }
    });

    socket.on('disconnect', () => {
      const code = socket.data.room;
      const gameId = socket.data.gameId;
      if (!code || !gameId) return;
      const room = store.getRoom(gameId, code);
      if (!room) return;
      const channel = store.roomKey(gameId, code);

      if (socket.data.role === 'screen' && room.screenId === socket.id) {
        room.screenId = null;
        room.mode = null;
        io.to(channel).emit('screenDisconnected');
        store.freeRoomIfEmpty(gameId, code);
        return;
      }

      if (socket.data.role === 'screen' && room.guestScreenId === socket.id) {
        room.guestScreenId = null;
        if (room.screenId) {
          io.to(room.screenId).emit('guestScreenLeft');
        }
        return;
      }

      if (socket.data.role === 'controller') {
        const slot = socket.data.slot;
        if (slot && room.controllers.get(slot) === socket.id) {
          room.controllers.delete(slot);
          room.ready.delete(slot);
          room.names.delete(slot);
        }
        io.to(channel).emit('roomState', store.roomSnapshot(room));
        if (room.screenId) {
          io.to(room.screenId).emit('controllerLeft', {
            slot,
            controllers: store.roomSnapshot(room),
          });
        }
        store.freeRoomIfEmpty(gameId, code);
      }
    });
  });
}

module.exports = { attachSocketHandlers };
