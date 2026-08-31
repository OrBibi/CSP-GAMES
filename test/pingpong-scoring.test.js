const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { addPoint, checkWinner, WINNING_SCORE } = require('../src/shared/pingpong');

describe('pingpong scoring', () => {
  it('adds points per player', () => {
    let s = { p1: 0, p2: 0 };
    s = addPoint(s, 1);
    s = addPoint(s, 2);
    assert.equal(s.p1, 1);
    assert.equal(s.p2, 1);
  });

  it('requires win by 2 at 11', () => {
    assert.equal(checkWinner({ p1: WINNING_SCORE, p2: WINNING_SCORE - 2 }), 1);
    assert.equal(checkWinner({ p1: WINNING_SCORE, p2: WINNING_SCORE }), null);
    assert.equal(checkWinner({ p1: WINNING_SCORE + 1, p2: WINNING_SCORE - 1 }), 1);
  });
});
