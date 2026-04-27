'use strict';

const { shopifyRequest } = require('./client');

// Sets the product's status to "active" via Shopify Admin REST API.
// productId: numeric string, e.g. "123456789"
async function activateProduct(productId) {
  const res = await shopifyRequest(
    'PUT',
    `/products/${productId}.json`,
    { product: { id: parseInt(productId, 10), status: 'active' } }
  );
  if (res.status !== 200) {
    throw new Error(`activateProduct ${productId} failed: HTTP ${res.status} — ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body.product;
}

module.exports = { activateProduct };
