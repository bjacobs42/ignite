'use strict';

const cfg = require('../../src/config');
const log = require('../../src/utils/logger');
const { extractProductId }      = require('../../src/utils/extractProductId');
const { getGoogleAccessToken, withRetry } = require('../../src/sheets/client');
const { getActiveCount }         = require('../../src/shopify/getActiveCount');
const { activateProduct }        = require('../../src/shopify/activateProduct');
const { getPreviousActiveCount } = require('../../src/sheets/getConfig');
const { getListedProducts }      = require('../../src/sheets/getListedProducts');
const { markProductActive }      = require('../../src/sheets/updateProductStatus');

exports.handler = async function (event) {
  log.info('sync-products: run started');

  if (!cfg.SHOPIFY_STORE_URL || !cfg.SHOPIFY_ACCESS_TOKEN) {
    log.error('Missing Shopify env vars');
    return { statusCode: 500, body: 'config error: Shopify vars missing' };
  }
  if (!cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL || !cfg.GOOGLE_PRIVATE_KEY || !cfg.GOOGLE_SHEET_ID) {
    log.error('Missing Google env vars');
    return { statusCode: 500, body: 'config error: Google vars missing' };
  }

  const body         = (() => { try { return JSON.parse(event.body || '{}'); } catch { return {}; } })();
  const isScheduled  = body.next_run !== undefined;
  if (cfg.TRIGGER_SECRET && !isScheduled && event.headers['x-trigger-secret'] !== cfg.TRIGGER_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const ignoreCap    = body.ignoreCap   === true;
  const activateAll  = body.activateAll === true;
  const customAmount = (typeof body.customAmount === 'number' && body.customAmount > 0)
    ? Math.floor(body.customAmount) : null;
  if (ignoreCap)             log.info('ignoreCap=true — daily delta check skipped');
  if (activateAll)           log.info('activateAll=true — all LISTED products will be processed');
  if (customAmount !== null) log.info(`customAmount=${customAmount}`);

  try {
    // 1. Current active count from Shopify
    const currentActive = await withRetry(() => getActiveCount(), 'getActiveCount');
    log.info(`Current active products: ${currentActive}`);

    // 2. Previous count from Config Sheet!E2
    const gToken         = await getGoogleAccessToken();
    const previousActive = await withRetry(() => getPreviousActiveCount(gToken), 'getPreviousActiveCount');
    log.info(`Previous active count (Config Sheet!E2): ${previousActive}`);

    // 3. Enforce daily cap (skipped for any override mode)
    const dailyDelta   = currentActive - previousActive;
    const overrideMode = ignoreCap || activateAll || customAmount !== null;
    if (!overrideMode && dailyDelta >= cfg.MAX_DAILY_ACTIVATE) {
      log.info(`Daily cap reached (delta=${dailyDelta}, cap=${cfg.MAX_DAILY_ACTIVATE}) — exiting`);
      return { statusCode: 200, body: JSON.stringify({ status: 'cap_reached', dailyDelta }) };
    }

    const remaining = customAmount !== null   ? customAmount
      : ignoreCap                             ? cfg.MAX_DAILY_ACTIVATE
      : cfg.MAX_DAILY_ACTIVATE - dailyDelta;
    log.info(`Remaining activations allowed today: ${remaining}`);

    // 4. Get LISTED rows
    const listedRows = await withRetry(() => getListedProducts(gToken), 'getListedProducts');
    log.info(`Found ${listedRows.length} LISTED row(s)`);

    if (listedRows.length === 0) {
      log.info('Nothing to activate — exiting early');
      return { statusCode: 200, body: JSON.stringify({ status: 'nothing_to_activate' }) };
    }

    // 5. Activate up to `remaining` products
    const toActivate = activateAll ? listedRows : listedRows.slice(0, remaining);
    let activated    = 0;

    for (const row of toActivate) {
      const productId = extractProductId(row.productUrl);
      if (!productId) {
        log.error(`Row ${row.rowNum}: cannot extract product ID from "${row.productUrl}" — skipping`);
        continue;
      }

      try {
        await withRetry(() => activateProduct(productId), `activateProduct row ${row.rowNum}`);
        log.info(`Row ${row.rowNum}: product ${productId} activated on Shopify`);

        await withRetry(() => markProductActive(gToken, row.rowNum), `markProductActive row ${row.rowNum}`);
        log.info(`Row ${row.rowNum}: column G updated to ACTIVE`);

        activated++;
      } catch (err) {
        // Log and continue — row stays LISTED for retry on next daily run
        log.error(`Row ${row.rowNum}: failed — ${err.message}`);
      }
    }

    log.info(`Activated ${activated} product(s) this run`);

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', activated, ignoreCap, activateAll, customAmount }),
    };

  } catch (err) {
    log.error(`Fatal: ${err.message}`);
    return { statusCode: 500, body: err.message };
  }
};
