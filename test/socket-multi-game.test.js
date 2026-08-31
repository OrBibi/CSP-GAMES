const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { startTestServer } = require('./helpers/test-server');

describe('socket multi-game isolation', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('same room code in different games does not cross-emit', async () => {
    const tennisScreen = ioClient(ctx.baseUrl, { transports: ['websocket'] });
    const pingScreen = ioClient(ctx.baseUrl, { transports: ['websocket'] });
    const tennisCtrl = ioClient(ctx.baseUrl, { transports: ['websocket'] });

    await Promise.all([
      new Promise((r) => tennisScreen.on('connect', r)),
      new Promise((r) => pingScreen.on('connect', r)),
      new Promise((r) => tennisCtrl.on('connect', r)),
    ]);

    const tAck = await new Promise((r) => tennisScreen.emit('join', { role: 'screen', game: 'tennis', room: 'TEST' }, r));
    const pAck = await new Promise((r) => pingScreen.emit('join', { role: 'screen', game: 'pingpong', room: 'TEST' }, r));
    assert.equal(tAck.ok, true);
    assert.equal(pAck.ok, true);

    let pingGotSwing = false;
    pingScreen.on('swing', () => {
      pingGotSwing = true;
    });

    await new Promise((r) =>
      tennisCtrl.emit('join', { role: 'controller', room: 'TEST', game: 'tennis' }, r)
    );

    const tennisSwing = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 2000);
      tennisScreen.on('swing', (data) => {
        clearTimeout(t);
        resolve(data);
      });
    });

    tennisCtrl.emit('swing', { side: 'left', intensity: 0.5 });
    await tennisSwing;
    assert.equal(pingGotSwing, false);

    tennisScreen.disconnect();
    pingScreen.disconnect();
    tennisCtrl.disconnect();
  });
});
