const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  getPublicBaseUrl,
  buildControllerUrl,
  stripTrailingSlash,
  isProduction,
} = require('../src/config/public-url');

describe('public-url', () => {
  it('prefers PUBLIC_URL env', () => {
    const prev = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = 'https://csp-games.onrender.com/';
    assert.equal(getPublicBaseUrl(), 'https://csp-games.onrender.com');
    process.env.PUBLIC_URL = prev;
  });

  it('builds controller URL with game param', () => {
    const url = buildControllerUrl('ABCD', 'https://example.com', 'tennis');
    assert.match(url, /room=ABCD/);
    assert.match(url, /game=tennis/);
  });

  it('strips trailing slashes', () => {
    assert.equal(stripTrailingSlash('https://x.com/'), 'https://x.com');
  });

  it('detects production NODE_ENV', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.equal(isProduction(), true);
    process.env.NODE_ENV = prev;
  });
});
