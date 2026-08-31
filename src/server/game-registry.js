const DEFAULT_GAME_ID = 'tennis';

const GAMES = {
  tennis: {
    id: 'tennis',
    title: 'Phone Tennis',
    description: 'Phone as racket, desktop as 3D court.',
    maxPlayers: 2,
    screenPath: '/games/tennis',
    controllerPath: '/controller',
    active: true,
    events: ['swing', 'tilt', 'calibrate', 'playerReady', 'startGame', 'haptic', 'hud', 'scoreUpdate'],
  },
  pingpong: {
    id: 'pingpong',
    title: 'Ping Pong',
    description: 'Phone paddle, desktop table — first to 11.',
    maxPlayers: 2,
    screenPath: '/games/pingpong',
    controllerPath: '/controller',
    active: true,
    events: ['paddle', 'swing', 'tilt', 'playerReady', 'startGame', 'haptic', 'scoreUpdate'],
  },
};

function normalizeGameId(raw) {
  const id = String(raw || DEFAULT_GAME_ID).trim().toLowerCase();
  return GAMES[id] ? id : DEFAULT_GAME_ID;
}

function getGame(gameId) {
  return GAMES[normalizeGameId(gameId)];
}

function listGames({ includeInactive = false } = {}) {
  return Object.values(GAMES).filter((g) => includeInactive || g.active);
}

function isValidGame(gameId) {
  const id = String(gameId || '').trim().toLowerCase();
  return !!GAMES[id];
}

module.exports = {
  GAMES,
  DEFAULT_GAME_ID,
  normalizeGameId,
  getGame,
  listGames,
  isValidGame,
};
