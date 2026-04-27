'use strict';

// Input:  "https://admin.shopify.com/store/{storeName}/products/123456789"
// Output: "123456789"
// Returns null for empty, non-string, or malformed URLs.
function extractProductId(adminUrl) {
  if (!adminUrl || typeof adminUrl !== 'string') return null;
  const match = adminUrl.match(/\/products\/(\d+)\s*$/);
  return match ? match[1] : null;
}

module.exports = { extractProductId };
