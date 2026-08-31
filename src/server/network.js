const os = require('os');

function getLanIPv4() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family === 4 || net.family === 'IPv4';
      if (family && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  if (!candidates.length) return '127.0.0.1';

  const score = (c) => {
    const a = c.address;
    const n = c.name.toLowerCase();
    let s = 0;
    if (/^192\.168\.(1|0|2|10)\./.test(a)) s += 50;
    else if (/^192\.168\./.test(a)) s += 30;
    else if (/^10\./.test(a)) s += 20;
    else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(a)) s += 15;
    if (/wi-?fi|wlan|wireless|wi fi/.test(n)) s += 40;
    if (/ethernet|eth|en0|lan/.test(n)) s += 10;
    if (/virtual|vbox|vmware|hyper|docker|vethernet|loopback/.test(n)) s -= 80;
    if (/^192\.168\.56\./.test(a)) s -= 60;
    return s;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0].address;
}

function listLanIPv4() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family === 4 || net.family === 'IPv4';
      if (family && !net.internal) out.push(`${net.address} (${name})`);
    }
  }
  return out;
}

module.exports = { getLanIPv4, listLanIPv4 };
