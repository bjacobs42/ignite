'use strict';

const { readCell } = require('./client');
const cfg = require('../config');

// Reads Config Sheet!E2 — yesterday's active product count.
// Returns 0 if the cell is empty or non-numeric.
async function getPreviousActiveCount(token) {
  const raw = await readCell(token, cfg.GOOGLE_SHEET_ID, cfg.CONFIG_SHEET_TAB, 'E2');
  const n   = parseInt(raw || '0', 10);
  return isNaN(n) ? 0 : n;
}

module.exports = { getPreviousActiveCount };
