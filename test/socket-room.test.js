const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { startTestServer } = require('./helpers/test-server');

describe('socket-room tennis', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({ PUBLIC_URL: 'https://test.example.com' });
  });

  after(async () => {
    await ctx.stop();
  });

  it('screen join → controller join → swing relay', async () => {
    const screen = ioClient(ctx.baseUrl, { transports: ['websocket'] });
    const controller = ioClient(ctx.baseUrl, { transports: ['websocket'] });

    await Promise.all([
      new Promise((r) => screen.on('connect', r)),
      new Promise((r) => controller.on('connect', r)),
    ]);

    const screenAck = await new Promise((resolve) => {
      screen.emit('join', { role: 'screen', game: 'tennis' }, resolve);
    });
    assert.equal(screenAck.ok, true);
    assert.match(screenAck.controllerUrl, /test\.example\.com/);

    const ctrlAck = await new Promise((resolve) => {
      controller.emit('join', { role: 'controller', room: screenAck.room, game: 'tennis' }, resolve);
    });
    assert.equal(ctrlAck.ok, true);
    assert.equal(ctrlAck.slot, 1);

    const swingPromise = new Promise((resolve) => {
      screen.on('swing', resolve);
    });
    controller.emit('swing', { intensity: 0.8, side: 'right', aim: -0.3, powerLevel: 3 });
    const swing = await swingPromise;
    assert.equal(swing.slot, 1);
    assert.equal(swing.side, 'right');

    screen.disconnect();
    controller.disconnect();
  });
});
