const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { reflectY, paddleBounceAngle, wallBounceX } = require('../src/shared/pingpong');

describe('pingpong collision', () => {
  it('reflects vertical velocity', () => {
    assert.equal(reflectY(4), -4);
    assert.equal(reflectY(-3), 3);
  });

  it('computes paddle bounce angle from offset', () => {
    assert.ok(paddleBounceAngle(0, 2, 10) > 0);
    assert.ok(paddleBounceAngle(0, -2, 10) < 0);
  });

  it('bounces off side walls', () => {
    const hit = wallBounceX(0, -5, 0, 100);
    assert.equal(hit.x, 5);
    assert.equal(hit.vx, 5);
  });
});
