'use strict';

const https  = require('https');
const crypto = require('crypto');
const cfg    = require('../config');

// ── HTTPS helper ──────────────────────────────────────────────────────────────

function request(options, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out')); });
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Google JWT auth ───────────────────────────────────────────────────────────

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGoogleAccessToken() {
  const now     = Math.floor(Date.now() / 1000);
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify({
    iss:   cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })));

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = base64url(sign.sign(cfg.GOOGLE_PRIVATE_KEY));
  const jwt = `${header}.${payload}.${sig}`;

  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res  = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });

  if (!res.access_token) throw new Error(`Google auth failed: ${JSON.stringify(res)}`);
  return res.access_token;
}

// ── Google Sheets helpers ─────────────────────────────────────────────────────

async function getRows(token, sheetId, tabName) {
  const range = encodeURIComponent(`${tabName}!A:Z`);
  const res   = await request({
    hostname: 'sheets.googleapis.com',
    path: `/v4/spreadsheets/${sheetId}/values/${range}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return res.body.values || [];
}

async function updateCell(token, sheetId, tabName, rowNum, colNum, value) {
  // rowNum and colNum are 1-based
  const colLetter = String.fromCharCode(64 + colNum);
  const range     = encodeURIComponent(`${tabName}!${colLetter}${rowNum}`);
  await request({
    hostname: 'sheets.googleapis.com',
    path: `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, {
    range: `${tabName}!${colLetter}${rowNum}`,
    majorDimension: 'ROWS',
    values: [[value]],
  });
}

async function readCell(token, sheetId, tabName, cellAddress) {
  const range = encodeURIComponent(`${tabName}!${cellAddress}`);
  const res   = await request({
    hostname: 'sheets.googleapis.com',
    path: `/v4/spreadsheets/${sheetId}/values/${range}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return ((res.body.values || [[]])[0] || [])[0] || '';
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry(fn, label, maxAttempts = 2, delayMs = 3000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.log(`[product-activator] ${label} attempt ${attempt} failed: ${err.message} — retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

module.exports = { getGoogleAccessToken, getRows, updateCell, readCell, withRetry };
