/**
 * In-memory room store with game-scoped room keys.
 */

const { getGame, DEFAULT_GAME_ID } = require('./game-registry');

function roomKey(gameId, code) {
  return `${gameId}:${String(code || '').toUpperCase()}`;
}

function createRoomStore() {
  /** @type {Map<string, object>} */
  const rooms = new Map();

  function createRoomCode(gameId = DEFAULT_GAME_ID) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (rooms.has(roomKey(gameId, code))) return createRoomCode(gameId);
    return code;
  }

  function getOrCreateRoom(gameId, code) {
    const key = roomKey(gameId, code);
    if (!rooms.has(key)) {
      rooms.set(key, {
        gameId,
        code: String(code).toUpperCase(),
        screenId: null,
        guestScreenId: null,
        controllers: new Map(),
        ready: new Map(),
        names: new Map(),
        mode: null,
      });
    }
    return rooms.get(key);
  }

  function getRoom(gameId, code) {
    return rooms.get(roomKey(gameId, code)) || null;
  }

  function sanitizeName(raw, fallback) {
    const cleaned = String(raw || '')
      .replace(/[^\p{L}\p{N} _\-.'']/gu, '')
      .trim()
      .slice(0, 16);
    return cleaned || fallback;
  }

  function roomSnapshot(room) {
    if (!room) return null;
    if (!room.ready) room.ready = new Map();
    if (!room.names) room.names = new Map();
    return {
      p1: room.controllers.has(1),
      p2: room.controllers.has(2),
      ready1: !!room.ready.get(1),
      ready2: !!room.ready.get(2),
      name1: room.names.get(1) || 'P1',
      name2: room.names.get(2) || 'P2',
      mode: room.mode,
      gameId: room.gameId,
    };
  }

  function findControllerSlot(room, socketId) {
    for (const [slot, id] of room.controllers.entries()) {
      if (id === socketId) return slot;
    }
    return null;
  }

  function freeRoomIfEmpty(gameId, code) {
    const room = getRoom(gameId, code);
    if (!room) return;
    if (!room.screenId && room.controllers.size === 0) {
      rooms.delete(roomKey(gameId, code));
    }
  }

  function maxPlayersFor(gameId) {
    return getGame(gameId).maxPlayers;
  }

  return {
    rooms,
    roomKey,
    createRoomCode,
    getOrCreateRoom,
    getRoom,
    sanitizeName,
    roomSnapshot,
    findControllerSlot,
    freeRoomIfEmpty,
    maxPlayersFor,
  };
}

module.exports = { createRoomStore, roomKey };
