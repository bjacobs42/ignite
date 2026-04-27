'use strict';

const https = require('https');
const cfg   = require('../config');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _rawRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: cfg.SHOPIFY_STORE_URL,
      path: `/admin/api/${cfg.SHOPIFY_API_VERSION}${path}`,
      method,
      headers: {
        'X-Shopify-Access-Token': cfg.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: raw, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Shopify request timed out')); });
    if (data) req.write(data);
    req.end();
  });
}

// Returns { status, body, headers }
// Automatically handles a single 429 by respecting the Retry-After header.
async function shopifyRequest(method, path, body) {
  const res = await _rawRequest(method, path, body);
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers['retry-after'] || '10');
    console.log(`[shopify] 429 rate limited — waiting ${retryAfter}s (Retry-After header)`);
    await sleep(retryAfter * 1000);
    return _rawRequest(method, path, body);
  }
  return res;
}

module.exports = { shopifyRequest };
