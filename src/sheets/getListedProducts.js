'use strict';

const { getRows } = require('./client');
const cfg = require('../config');

// Returns all Store Sheet rows where column G === "LISTED".
// Each entry: { rowNum (1-based sheet row), productUrl (Shopify admin URL from col K) }
async function getListedProducts(token) {
  const rows    = await getRows(token, cfg.GOOGLE_SHEET_ID, cfg.STORE_SHEET_TAB);
  const results = [];

  for (let i = cfg.DATA_ROW_START - 1; i < rows.length; i++) {
    const status = (rows[i][cfg.COL_STATUS] || '').trim().toUpperCase();
    if (status === cfg.STATUS_LISTED) {
      results.push({
        rowNum:     i + 1,                               // convert to 1-based sheet row
        productUrl: (rows[i][cfg.COL_LINK] || '').trim(),
      });
    }
  }

  return results;
}

module.exports = { getListedProducts };
