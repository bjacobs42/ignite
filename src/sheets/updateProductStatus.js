'use strict';

const { updateCell } = require('./client');
const cfg = require('../config');

// Updates column G of the given row to "ACTIVE".
// Called immediately after a successful activateProduct() call.
async function markProductActive(token, rowNum) {
  await updateCell(
    token,
    cfg.GOOGLE_SHEET_ID,
    cfg.STORE_SHEET_TAB,
    rowNum,
    cfg.COL_STATUS_1,  // 7 (column G, 1-based)
    cfg.STATUS_ACTIVE
  );
}

module.exports = { markProductActive };
