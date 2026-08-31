const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listGames, getGame, normalizeGameId, isValidGame } = require('../src/server/game-registry');

describe('game-registry', () => {
  it('lists active games', () => {
    const games = listGames();
    assert.ok(games.some((g) => g.id === 'tennis'));
    assert.ok(games.some((g) => g.id === 'pingpong'));
  });

  it('normalizes unknown game to tennis', () => {
    assert.equal(normalizeGameId('unknown'), 'tennis');
  });

  it('returns game metadata', () => {
    const g = getGame('pingpong');
    assert.equal(g.maxPlayers, 2);
    assert.equal(g.screenPath, '/games/pingpong');
  });

  it('validates game ids', () => {
    assert.equal(isValidGame('tennis'), true);
    assert.equal(isValidGame('chess'), false);
  });
});
