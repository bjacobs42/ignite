'use strict';

const { shopifyRequest } = require('./client');
const cfg = require('../config');

// Fetches all active products from Shopify using cursor-based pagination.
// Shopify REST returns max 250/page; the Link response header carries the next-page cursor.
async function getActiveCount() {
  let count = 0;
  let path  = `/products.json?status=active&limit=250`;

  while (path) {
    const res = await shopifyRequest('GET', path);
    if (res.status !== 200) {
      throw new Error(`getActiveCount failed: HTTP ${res.status} — ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    count += (res.body.products || []).length;

    // Parse Link header for next cursor
    // Format: <https://store.myshopify.com/admin/api/.../products.json?page_info=XXX&limit=250>; rel="next"
    const linkHeader = res.headers['link'] || '';
    const nextMatch  = linkHeader.match(/<([^>]+)>;\s*rel="?next"?/);
    if (nextMatch) {
      const u = new URL(nextMatch[1]);
      // Strip the /admin/api/{version} prefix so shopifyRequest can re-add it
      path = u.pathname.replace(`/admin/api/${cfg.SHOPIFY_API_VERSION}`, '') + u.search;
    } else {
      path = null;
    }
  }

  return count;
}

module.exports = { getActiveCount };
