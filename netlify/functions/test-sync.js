'use strict';

// Read-only diagnostic function — makes ZERO writes to Shopify or Google Sheets.
// Returns a JSON report of what sync-products.js would do on the next run.
// Invoke: GET/POST http://localhost:8888/.netlify/functions/test-sync

const cfg = require('../../src/config');
const log = require('../../src/utils/logger');
const { extractProductId }      = require('../../src/utils/extractProductId');
const { getGoogleAccessToken }  = require('../../src/sheets/client');
const { getActiveCount }         = require('../../src/shopify/getActiveCount');
const { getPreviousActiveCount } = require('../../src/sheets/getConfig');
const { getListedProducts }      = require('../../src/sheets/getListedProducts');

exports.handler = async function () {
  log.info('test-sync: run started (read-only)');

  if (!cfg.SHOPIFY_STORE_URL || !cfg.SHOPIFY_ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Shopify env vars' }) };
  }
  if (!cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL || !cfg.GOOGLE_PRIVATE_KEY || !cfg.GOOGLE_SHEET_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Google env vars' }) };
  }

  try {
    const currentActive  = await getActiveCount();
    const gToken         = await getGoogleAccessToken();
    const previousActive = await getPreviousActiveCount(gToken);
    const dailyDelta     = currentActive - previousActive;
    const capAlreadyReached = dailyDelta >= cfg.MAX_DAILY_ACTIVATE;
    const slotsRemaining    = Math.max(0, cfg.MAX_DAILY_ACTIVATE - dailyDelta);

    const listedRows = await getListedProducts(gToken);

    // Annotate each row with parsed product ID and validity
    const annotated = listedRows.map(row => {
      const productId = extractProductId(row.productUrl);
      return {
        rowNum:     row.rowNum,
        productUrl: row.productUrl,
        productId:  productId || null,
        valid:      productId !== null,
      };
    });

    const wouldActivateCount = capAlreadyReached
      ? 0
      : Math.min(annotated.filter(r => r.valid).length, slotsRemaining);

    const report = {
      currentActive,
      previousActive,
      dailyDelta,
      maxDailyActivate:   cfg.MAX_DAILY_ACTIVATE,
      capAlreadyReached,
      slotsRemaining,
      wouldActivateCount,
      listedRowsTotal:    listedRows.length,
      listedRows:         annotated,
    };

    log.info(`test-sync: currentActive=${currentActive}, previousActive=${previousActive}, listed=${listedRows.length}, wouldActivate=${wouldActivateCount}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report, null, 2),
    };

  } catch (err) {
    log.error(`test-sync fatal: ${err.message}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
