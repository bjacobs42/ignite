'use strict';

const { updateCell } = require('./client');
const cfg = require('../config');

// Writes the new active product count to Config Sheet!E2.
async function setPreviousActiveCount(token, count) {
  await updateCell(
    token,
    cfg.GOOGLE_SHEET_ID,
    cfg.CONFIG_SHEET_TAB,
    cfg.CONFIG_ROW,    // 2
    cfg.CONFIG_COL_E,  // 5 (column E)
    String(count)
  );
}

module.exports = { setPreviousActiveCount };
