'use strict';

const cfg = require('../../src/config');
const log = require('../../src/utils/logger');
const { getGoogleAccessToken, withRetry } = require('../../src/sheets/client');
const { getActiveCount }         = require('../../src/shopify/getActiveCount');
const { setPreviousActiveCount } = require('../../src/sheets/updateConfig');

exports.handler = async function () {
  log.info('refresh-count: run started');

  if (!cfg.SHOPIFY_STORE_URL || !cfg.SHOPIFY_ACCESS_TOKEN) {
    log.error('Missing Shopify env vars');
    return { statusCode: 500, body: 'config error: Shopify vars missing' };
  }
  if (!cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL || !cfg.GOOGLE_PRIVATE_KEY || !cfg.GOOGLE_SHEET_ID) {
    log.error('Missing Google env vars');
    return { statusCode: 500, body: 'config error: Google vars missing' };
  }

  try {
    const activeCount = await withRetry(() => getActiveCount(), 'getActiveCount');
    log.info(`Current active products: ${activeCount}`);

    const gToken = await getGoogleAccessToken();
    await withRetry(() => setPreviousActiveCount(gToken, activeCount), 'setPreviousActiveCount');
    log.info(`Config Sheet!E2 updated to ${activeCount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', activeCount }),
    };
  } catch (err) {
    log.error(`Fatal: ${err.message}`);
    return { statusCode: 500, body: err.message };
  }
};
