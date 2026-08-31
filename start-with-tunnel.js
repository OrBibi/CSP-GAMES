/**
 * Start game server + Cloudflare quick tunnel (stable HTTPS for iPhone sensors).
 * If port 3000 is already in use, attaches tunnel to the existing server.
 */
const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const qrcode = require('qrcode-terminal');

const PORT = Number(process.env.PORT) || 3000;
const TUNNEL_FILE = path.join(__dirname, 'public', 'tunnel.json');
const PID_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'PhoneScreenGames');
const PID_FILE = path.join(PID_DIR, 'pids.json');

function writePidFile() {
  try {
    if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR, { recursive: true });
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify(
        {
          startWithTunnel: process.pid,
          server: server?.pid || null,
          cloudflared: tunnelProc?.pid || null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch (_) {
    /* ignore */
  }
}

function clearPidFile() {
  try { fs.unlinkSync(PID_FILE); } catch (_) { /* ignore */ }
}

// Never serve a stale tunnel URL from a previous run
try { fs.unlinkSync(TUNNEL_FILE); } catch (_) { /* ignore */ }

function findCloudflared() {
  const candidates = [
    'cloudflared',
    path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
  ];
  for (const c of candidates) {
    try {
      if (c === 'cloudflared') {
        execSync('cloudflared --version', { stdio: 'ignore' });
        return 'cloudflared';
      }
      if (fs.existsSync(c)) return c;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForHttp(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return true;
    } catch (_) {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let server = null;
let tunnelProc = null;
let ownsServer = false;

function cleanup() {
  try { fs.unlinkSync(TUNNEL_FILE); } catch (_) { /* ignore */ }
  clearPidFile();
  try { if (tunnelProc) tunnelProc.kill(); } catch (_) { /* ignore */ }
  if (ownsServer) {
    try { if (server) server.kill(); } catch (_) { /* ignore */ }
  }
}

function saveTunnelUrl(url) {
  const clean = url.replace(/\/$/, '');
  const info = {
    url: clean,
    https: true,
    provider: 'cloudflare',
    updatedAt: new Date().toISOString(),
    note: 'iPhone must use this HTTPS URL for motion controls',
  };
  fs.writeFileSync(TUNNEL_FILE, JSON.stringify(info, null, 2));

  console.log('');
  console.log('############################################');
  console.log('  IPHONE (HTTPS — Safari):');
  console.log(`  ${clean}`);
  console.log('  Then scan the lobby QR / open /controller?room=CODE');
  console.log('############################################');
  console.log('');
  qrcode.generate(clean, { small: true });
  console.log('');
  console.log('  Desktop lobby: http://localhost:3000');
  console.log('  Refresh the lobby so the QR updates to HTTPS.');
  console.log('');
}

function startTunnel() {
  const bin = findCloudflared();
  if (!bin) {
    console.error('cloudflared not found. Install: winget install Cloudflare.cloudflared');
    process.exit(1);
    return;
  }

  tunnelProc = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  writePidFile();

  let found = false;
  const onChunk = (buf) => {
    const text = buf.toString();
    process.stderr.write(buf);
    if (found) return;
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      found = true;
      saveTunnelUrl(match[0]);
      writePidFile();
    }
  };

  tunnelProc.stdout.on('data', onChunk);
  tunnelProc.stderr.on('data', onChunk);

  tunnelProc.on('exit', (code) => {
    console.log('Cloudflare tunnel exited:', code);
    try { fs.unlinkSync(TUNNEL_FILE); } catch (_) { /* ignore */ }
    if (ownsServer) process.exit(code || 0);
  });
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

(async () => {
  const portBusy = await isPortOpen(PORT);

  if (portBusy) {
    console.error('');
    console.error('ERROR: Port 3000 is already in use.');
    console.error('Run stop.bat first, then start.bat again.');
    console.error('');
    process.exit(1);
    return;
  }

  ownsServer = true;
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  writePidFile();

  server.stdout.on('data', (buf) => process.stdout.write(buf));
  server.stderr.on('data', (buf) => process.stderr.write(buf));

  server.on('exit', (code) => {
    cleanup();
    console.log('Server exited:', code);
    process.exit(code || 0);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error('ERROR: Port 3000 is already in use. Run stop.bat, then start.bat.');
      console.error('');
      process.exit(1);
      return;
    }
    console.error('Server failed to start:', err.message);
    process.exit(1);
  });

  const ok = await waitForHttp(PORT);
  if (!ok) {
    console.error('Server did not become ready in time.');
    cleanup();
    process.exit(1);
    return;
  }

  startTunnel();
})();
