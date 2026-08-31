const http = require('http');
const { createExpressApp, getLanIPv4 } = require('../../src/server/app');
const { createRoomStore } = require('../../src/server/room-store');
const { attachSocketHandlers } = require('../../src/server/socket-router');
const { Server } = require('socket.io');

async function startTestServer(env = {}) {
  const prev = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'test', ...env });

  const port = 0;
  const lanIp = getLanIPv4();
  const app = createExpressApp({ rootDir: process.cwd(), lanIp, port: 0, httpsPort: 3443 });
  const store = createRoomStore();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  io._cspLanIp = lanIp;
  io._cspHttpPort = 0;
  io._cspHttpsPort = 3443;
  attachSocketHandlers(io, store);

  await new Promise((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
  const address = httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function stop() {
    io.disconnectSockets(true);
    await new Promise((resolve) => io.close(resolve));
    if (typeof httpServer.closeAllConnections === 'function') {
      httpServer.closeAllConnections();
    }
    await new Promise((resolve) => httpServer.close(resolve));
    Object.assign(process.env, prev);
  }

  return { httpServer, io, store, baseUrl, port: address.port, stop };
}

module.exports = { startTestServer };
