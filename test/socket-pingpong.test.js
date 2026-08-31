const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { startTestServer } = require('./helpers/test-server');

describe('socket pingpong', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('relays paddle input to screen', async () => {
    const screen = ioClient(ctx.baseUrl, { transports: ['websocket'] });
    const controller = ioClient(ctx.baseUrl, { transports: ['websocket'] });

    await Promise.all([
      new Promise((r) => screen.on('connect', r)),
      new Promise((r) => controller.on('connect', r)),
    ]);

    const screenAck = await new Promise((r) => screen.emit('join', { role: 'screen', game: 'pingpong' }, r));
    assert.equal(screenAck.ok, true);

    await new Promise((r) =>
      controller.emit('join', { role: 'controller', room: screenAck.room, game: 'pingpong' }, r)
    );

    const paddlePromise = new Promise((resolve) => screen.on('paddle', resolve));
    controller.emit('paddle', { x: 0.75 });
    const paddle = await paddlePromise;
    assert.equal(paddle.slot, 1);
    assert.equal(paddle.x, 0.75);

    screen.disconnect();
    controller.disconnect();
  });
});
