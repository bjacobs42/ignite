'use strict';

module.exports = {
  SHOPIFY_STORE_URL:            process.env.SHOPIFY_STORE_URL,
  SHOPIFY_ACCESS_TOKEN:         process.env.SHOPIFY_ACCESS_TOKEN,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY:           (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEET_ID:              process.env.GOOGLE_SHEET_ID,
  MAX_DAILY_ACTIVATE:           parseInt(process.env.MAX_DAILY_ACTIVATE || '10', 10),

  STORE_SHEET_TAB:  'Store Sheet',
  CONFIG_SHEET_TAB: 'Config Sheet',

  // Column indices — 0-based for array access after getRows()
  COL_STATUS: 6,   // G
  COL_LINK:   10,  // K

  // Column numbers — 1-based for Sheets API updateCell()
  COL_STATUS_1: 7,   // G
  COL_LINK_1:   11,  // K

  // Config Sheet!E2 — stores previous day's active product count (0–2000)
  // D2 is reserved by product_lister2 as a run lock — use E2 here to avoid collision
  CONFIG_ROW:   2,  // row 2, 1-based
  CONFIG_COL_E: 5,  // column E, 1-based

  DATA_ROW_START:      4,         // rows 1–3 are headers/blank; data starts at row 4
  SHOPIFY_API_VERSION: '2024-04',

  STATUS_LISTED: 'LISTED',
  STATUS_ACTIVE: 'ACTIVE',
};
