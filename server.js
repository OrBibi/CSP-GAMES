/**
 * CSP-GAMES server entry.
 * Production (Render): single HTTP port, PUBLIC_URL for controller links.
 * Development (LAN): HTTP + alt port + HTTPS for iOS motion sensors.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const qrcode = require('qrcode-terminal');
const selfsigned = require('selfsigned');

const { createExpressApp, getLanIPv4 } = require('./src/server/app');
const { createRoomStore } = require('./src/server/room-store');
const { attachSocketHandlers } = require('./src/server/socket-router');
const { isProduction, getPublicBaseUrl } = require('./src/config/public-url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const ALT_PORT = Number(process.env.ALT_PORT) || 8080;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const HOST = '0.0.0.0';
const CERT_DIR = path.join(ROOT, 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

async function ensureTlsCerts(lanIp) {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    };
  }
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  const attrs = [{ name: 'commonName', value: lanIp || 'localhost' }];
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...(lanIp ? [{ type: 7, ip: lanIp }] : []),
        ],
      },
    ],
  });

  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

async function main() {
  const prod = isProduction();
  const lanIp = getLanIPv4();
  const app = createExpressApp({ rootDir: ROOT, lanIp, port: PORT, httpsPort: HTTPS_PORT });
  const store = createRoomStore();

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingInterval: 8000,
    pingTimeout: 4000,
    perMessageDeflate: false,
  });
  io._cspLanIp = lanIp;
  io._cspHttpPort = PORT;
  io._cspHttpsPort = HTTPS_PORT;
  attachSocketHandlers(io, store);

  if (prod) {
    await new Promise((resolve) => httpServer.listen(PORT, HOST, resolve));
    const publicBase = getPublicBaseUrl() || `(port ${PORT})`;
    console.log('');
    console.log('========================================');
    console.log('  CSP-GAMES — production');
    console.log('========================================');
    console.log(`  Listening on ${HOST}:${PORT}`);
    console.log(`  Public URL: ${publicBase}`);
    console.log(`  Health: /health`);
    console.log('========================================');
    console.log('');
    return;
  }

  const tls = await ensureTlsCerts(lanIp);
  const httpsServer = https.createServer(tls, app);
  const ioHttps = new Server(httpsServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingInterval: 8000,
    pingTimeout: 4000,
    perMessageDeflate: false,
  });
  ioHttps._cspLanIp = lanIp;
  ioHttps._cspHttpPort = PORT;
  ioHttps._cspHttpsPort = HTTPS_PORT;
  attachSocketHandlers(ioHttps, store);

  await new Promise((resolve) => httpServer.listen(PORT, HOST, resolve));
  const httpAlt = http.createServer(app);
  const ioAlt = new Server(httpAlt, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingInterval: 8000,
    pingTimeout: 4000,
    perMessageDeflate: false,
  });
  ioAlt._cspLanIp = lanIp;
  ioAlt._cspHttpPort = PORT;
  ioAlt._cspHttpsPort = HTTPS_PORT;
  attachSocketHandlers(ioAlt, store);
  await new Promise((resolve) => httpAlt.listen(ALT_PORT, HOST, resolve));
  await new Promise((resolve) => httpsServer.listen(HTTPS_PORT, HOST, resolve));

  const desktopUrl = `http://${lanIp}:${PORT}`;
  const altUrl = `http://${lanIp}:${ALT_PORT}`;

  console.log('');
  console.log('========================================');
  console.log('  CSP-GAMES — LAN dev');
  console.log('========================================');
  console.log(`  Hub:        ${desktopUrl}/`);
  console.log(`  Tennis:     ${desktopUrl}/games/tennis`);
  console.log(`  HTTP backup: ${altUrl}`);
  console.log(`  HTTPS (iOS): https://${lanIp}:${HTTPS_PORT}`);
  console.log(`  Localhost:  http://localhost:${PORT}`);
  console.log('');
  qrcode.generate(desktopUrl, { small: true });
  console.log('');
  console.log('========================================');
  console.log('');
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = { main };
