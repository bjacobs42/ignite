# Daybreak

A scheduled Netlify function that drip-releases Shopify draft products to active every day at 18:00 Amsterdam time. It reads a queue of products from Google Sheets, enforces a daily activation cap, activates each product on Shopify, and updates the sheet status — all automatically.

---

## How it works

1. Fetches the current number of active products from Shopify.
2. Compares that with yesterday's count stored in `Config Sheet!E2`.
3. If the difference already meets or exceeds `MAX_DAILY_ACTIVATE`, it exits — nothing more to do today.
4. Otherwise it reads all rows in `Store Sheet` where column G is `LISTED`.
5. For each of those rows (up to the remaining daily allowance):
   - Sets the product to `active` on Shopify via the Admin API.
   - Updates column G to `ACTIVE` in the sheet.
6. Writes the new active product count back to `Config Sheet!E2`.
7. Runs again tomorrow at 18:00.

---

## Prerequisites

- A [Netlify](https://netlify.com) account (free tier works)
- A Shopify store with a custom app access token
- A Google Cloud service account with access to the target spreadsheet
- Node.js 18+ (for local testing only)

---

## Google Sheets setup

Your spreadsheet needs two tabs:

**Store Sheet** — one product per row, data starts at row 4 (rows 1–3 are headers/blank):

| Column | Field | Notes |
|--------|-------|-------|
| G | STATUS | Daybreak reads `LISTED`, writes `ACTIVE` |
| K | SHOPIFY LINK | Shopify admin URL, e.g. `https://admin.shopify.com/store/{store}/products/{id}` |

**Config Sheet** — state storage:

| Cell | Field | Notes |
|------|-------|-------|
| E2 | Previous active count | **Set this to `0` manually before first deploy** |

> Column D2 is intentionally left for other tools. Daybreak only reads/writes E2.

**Service account access:**
1. Create a service account in [Google Cloud Console](https://console.cloud.google.com).
2. Generate a JSON key — you'll need `client_email` and `private_key` from it.
3. Share the spreadsheet with the service account email (Editor access).

---

## Shopify setup

1. In your Shopify Admin, go to **Settings → Apps and sales channels → Develop apps**.
2. Create a custom app and grant it the `write_products` Admin API scope.
3. Install the app and copy the **Admin API access token** (shown once).

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_STORE_URL` | Your store domain, e.g. `yourstore.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Admin API access token from your custom app |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the service account JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key — paste with literal `\n` for newlines |
| `GOOGLE_SHEET_ID` | The spreadsheet ID from its URL: `.../spreadsheets/d/{ID}/edit` |
| `MAX_DAILY_ACTIVATE` | Maximum products to activate per day (default: `10`) |

Copy `.env.example` to `.env` and fill in all values for local testing.

---

## Deployment

1. Connect your repository to Netlify (or use `netlify deploy`).
2. Add all environment variables under **Site configuration → Environment variables**.
3. Deploy — Netlify will automatically pick up the cron schedule from `netlify.toml`.

The function runs daily at 16:00 UTC, which is **18:00 CEST** (summer) and **17:00 CET** (winter).

---

## Testing

Daybreak includes a read-only test function that shows exactly what the next production run would do — no Shopify activations, no sheet writes.

**With Netlify Dev (recommended):**

```bash
npm install -g netlify-cli
netlify dev
```

Then in another terminal:

```bash
curl http://localhost:8888/.netlify/functions/test-sync
```

**Example response:**

```json
{
  "currentActive": 142,
  "previousActive": 135,
  "dailyDelta": 7,
  "maxDailyActivate": 10,
  "capAlreadyReached": false,
  "slotsRemaining": 3,
  "wouldActivateCount": 3,
  "listedRowsTotal": 8,
  "listedRows": [
    { "rowNum": 5, "productUrl": "https://admin.shopify.com/store/.../products/123", "productId": "123", "valid": true },
    { "rowNum": 6, "productUrl": "", "productId": null, "valid": false }
  ]
}
```

Run `test-sync` first on every new deployment to verify the sheet columns and product URLs are parsing correctly before letting the scheduled function run live.

---

## Project structure

```
netlify/functions/
  sync-products.js      Production handler — runs on schedule
  test-sync.js          Read-only diagnostic endpoint

src/
  config.js             All constants and env var bindings
  shopify/
    client.js           Shopify HTTP client with 429 handling
    getActiveCount.js   Paginated active product count
    activateProduct.js  PUT product status to active
  sheets/
    client.js           Google JWT auth + Sheets API helpers
    getConfig.js        Read previous count from Config Sheet!E2
    updateConfig.js     Write new count to Config Sheet!E2
    getListedProducts.js  Find all LISTED rows in Store Sheet
    updateProductStatus.js  Mark a row ACTIVE in column G
  utils/
    extractProductId.js  Parse numeric product ID from admin URL
    logger.js            Timestamped console logging
```
