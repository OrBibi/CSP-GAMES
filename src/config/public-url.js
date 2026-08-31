/**
 * Public base URL for controller links (cloud + LAN fallback).
 */

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function header(req, name) {
  if (!req) return null;
  if (typeof req.get === 'function') return req.get(name);
  const key = String(name).toLowerCase();
  return req.headers?.[key] || null;
}

function getPublicBaseUrl(req) {
  const fromEnv = stripTrailingSlash(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
  if (fromEnv) return fromEnv;

  if (req) {
    const proto = header(req, 'x-forwarded-proto') || req.protocol || 'http';
    const host = header(req, 'x-forwarded-host') || header(req, 'host');
    if (host) return `${proto}://${host}`;
  }

  return null;
}

function buildControllerUrl(room, baseUrl, gameId = 'tennis') {
  const base = stripTrailingSlash(baseUrl);
  const params = new URLSearchParams({ room: String(room || '').toUpperCase(), game: gameId });
  return `${base}/controller?${params.toString()}`;
}

function resolveControllerUrls(room, { req, lanIp, port, httpsPort, gameId = 'tennis' }) {
  const publicBase = getPublicBaseUrl(req);
  if (publicBase) {
    const url = buildControllerUrl(room, publicBase, gameId);
    return {
      controllerUrl: url,
      controllerUrlHttps: url,
      publicBase,
      protocol: publicBase.startsWith('https') ? 'https' : 'http',
    };
  }

  const httpUrl = `http://${lanIp}:${port}`;
  const httpsUrl = `https://${lanIp}:${httpsPort}`;
  return {
    controllerUrl: `${httpUrl}/controller?room=${room}&game=${gameId}`,
    controllerUrlHttps: `${httpsUrl}/controller?room=${room}&game=${gameId}`,
    publicBase: null,
    protocol: 'http',
  };
}

module.exports = {
  isProduction,
  getPublicBaseUrl,
  buildControllerUrl,
  resolveControllerUrls,
  stripTrailingSlash,
};
