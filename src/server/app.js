const express = require('express');
const path = require('path');
const fs = require('fs');
const { listGames } = require('./game-registry');
const { getPublicBaseUrl, isProduction } = require('../config/public-url');
const { getLanIPv4 } = require('./network');

function createExpressApp({ rootDir, lanIp, port, httpsPort }) {
  const app = express();
  const publicDir = path.join(rootDir, 'public');

  app.use(
    express.static(publicDir, {
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        if (/\.(js|css|html)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      },
    })
  );
  app.use('/vendor/three', express.static(path.join(rootDir, 'node_modules', 'three')));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/games', (_req, res) => {
    res.json({ games: listGames() });
  });

  app.get('/api/network', (req, res) => {
    const publicBase = getPublicBaseUrl(req);
    res.json({
      lanIp,
      httpUrl: publicBase || `http://${lanIp}:${port}`,
      httpsUrl: publicBase || `https://${lanIp}:${httpsPort}`,
      port,
      httpsPort,
      publicBase,
      production: isProduction(),
    });
  });

  app.get('/controller', (req, res) => {
    const game = String(req.query.game || 'tennis').toLowerCase();
    const room = String(req.query.room || '').toUpperCase();
    const qs = new URLSearchParams({ game, ...(room ? { room } : {}) }).toString();
    const file = path.join(publicDir, 'games', game, 'controller.html');
    if (fs.existsSync(file)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(file);
    }
    const legacy = path.join(publicDir, 'controller.html');
    if (fs.existsSync(legacy)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(legacy);
    }
    res.redirect(302, `/games/${game}/controller${qs ? `?${qs}` : ''}`);
  });

  app.get('/controller.html', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `/controller${qs}`);
  });

  app.get('/games/:gameId/controller', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `/controller?game=${req.params.gameId}${qs.replace('?', '&')}`);
  });

  // Legacy tennis at root → hub game path
  app.get('/index.html', (_req, res) => {
    res.redirect(302, '/games/tennis');
  });

  app.get('/tunnel.json', (_req, res) => {
    const file = path.join(publicDir, 'tunnel.json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'Tunnel not ready — run npm run dev and wait for trycloudflare.com URL.' });
      return;
    }
    res.sendFile(file);
  });

  app.get('/api/qr', async (req, res) => {
    try {
      const QRCode = require('qrcode');
      const text = String(req.query.text || '').slice(0, 2048);
      if (!text) {
        res.status(400).send('missing text');
        return;
      }
      res.type('png');
      await QRCode.toFileStream(res, text, {
        width: 280,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    } catch (err) {
      console.error('QR error', err);
      res.status(500).send('qr failed');
    }
  });

  return app;
}

module.exports = { createExpressApp, getLanIPv4 };
