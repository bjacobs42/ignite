# CLAUDE.md — Ignite

## Project goal

Ignite is a scheduled Netlify function (Node.js, no npm dependencies) that runs daily at 18:00 Amsterdam time. It reads a queue of Shopify draft products from Google Sheets, activates up to `MAX_DAILY_ACTIVATE` of them on Shopify, and updates the sheet status from `LISTED` → `ACTIVE`. A daily activation cap is enforced by comparing the current Shopify active count against yesterday's count stored in `Config Sheet!E2`.

The companion project `product_lister2` (at `../product_lister2`) creates the Shopify products as drafts and marks them `LISTED` in the sheet. Ignite is the second step in that pipeline.

A web UI (`index.html`) is served on the same Netlify site for manual triggering — including an "Override Cap" mode that bypasses the daily delta check.

## Running locally

```bash
# Install Netlify CLI if needed
npm install -g netlify-cli

# Copy and fill in env vars
cp .env.example .env

# Start local dev server
netlify dev

# Open the web UI
open http://localhost:8888

# Read-only diagnostic (no writes) — run this first
curl http://localhost:8888/.netlify/functions/test-sync

# Trigger a normal run
curl -X POST http://localhost:8888/.netlify/functions/sync-products

# Trigger a run ignoring the daily cap
curl -X POST http://localhost:8888/.netlify/functions/sync-products \
  -H 'Content-Type: application/json' \
  -d '{"ignoreCap": true}'
```

## Project structure

```
index.html              Web UI — status dashboard + manual trigger buttons

netlify/functions/
  sync-products.js        Scheduled handler — full production run; accepts ignoreCap via POST body
  refresh-count.js        Scheduled at 17:00 UTC — snapshots Shopify active count to Config Sheet!E2
  test-sync.js            Read-only diagnostic — zero writes

src/
  config.js               All constants and env var bindings (single source of truth)
  shopify/
    client.js             shopifyRequest() — HTTPS wrapper with 429 auto-retry
    getActiveCount.js     getActiveCount() — paginated count of active products
    activateProduct.js    activateProduct(productId) — PUT status=active
  sheets/
    client.js             getGoogleAccessToken(), getRows(), updateCell(),
                          readCell(), withRetry()
    getConfig.js          getPreviousActiveCount(token) — reads Config Sheet!E2
    updateConfig.js       setPreviousActiveCount(token, count) — writes Config Sheet!E2
    getListedProducts.js  getListedProducts(token) — finds all LISTED rows
    updateProductStatus.js markProductActive(token, rowNum) — writes ACTIVE to col G
  utils/
    extractProductId.js   extractProductId(adminUrl) — parses numeric ID from URL
    logger.js             log.info(), log.error(), log.debug()
```

## Google Sheets structure

### Store Sheet tab — `'Store Sheet'`

Data rows start at **row 4** (rows 1–3 are headers/blank). All column indices are referenced from `src/config.js`.

| Column | Letter | 0-based index | 1-based (API) | Field | Read/Write |
|--------|--------|---------------|---------------|-------|------------|
| G | G | `COL_STATUS = 6` | `COL_STATUS_1 = 7` | STATUS | Read + Write |
| K | K | `COL_LINK = 10` | `COL_LINK_1 = 11` | SHOPIFY LINK | Read |

STATUS values relevant to Ignite:
- `LISTED` — product exists on Shopify as a draft; ready to activate
- `ACTIVE` — product has been activated by Ignite

SHOPIFY LINK format (written by `product_lister2`):
```
https://admin.shopify.com/store/{storeName}/products/{numericId}
```

### Config Sheet tab — `'Config Sheet'`

| Cell | Purpose | Notes |
|------|---------|-------|
| D2 | Run lock | Used by `product_lister2` — **do not touch** |
| E2 | Previous day's active count | Written by `refresh-count` at 17:00 UTC; read by `sync-products` at 18:00 UTC |

**First-run requirement:** manually write `0` into `Config Sheet!E2` before the first deploy. If left empty, `getPreviousActiveCount` defaults to 0, which means `currentActive - 0` will likely exceed `MAX_DAILY_ACTIVATE` on a store with existing products, causing an early exit.

## Config constants (`src/config.js`)

All magic numbers live here. Never hardcode column indices or tab names elsewhere.

```js
STORE_SHEET_TAB:  'Store Sheet'
CONFIG_SHEET_TAB: 'Config Sheet'

COL_STATUS:   6    // G, 0-based — for array access after getRows()
COL_LINK:     10   // K, 0-based
COL_STATUS_1: 7    // G, 1-based — for updateCell()
COL_LINK_1:   11   // K, 1-based

CONFIG_ROW:   2    // E2 row
CONFIG_COL_E: 5    // E2 column (1-based); String.fromCharCode(64+5) = 'E'

DATA_ROW_START:      4         // first data row in Store Sheet
SHOPIFY_API_VERSION: '2024-04'
STATUS_LISTED: 'LISTED'
STATUS_ACTIVE: 'ACTIVE'
MAX_DAILY_ACTIVATE: parseInt(process.env.MAX_DAILY_ACTIVATE || '10', 10)
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_STORE_URL` | Store domain, e.g. `yourstore.myshopify.com` (no `https://`) |
| `SHOPIFY_ACCESS_TOKEN` | Admin API token from Shopify custom app (`shpat_...`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from service account JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from JSON key — store with literal `\n` for newlines |
| `GOOGLE_SHEET_ID` | Spreadsheet ID from URL: `.../spreadsheets/d/{ID}/edit` |
| `MAX_DAILY_ACTIVATE` | Products to activate per day (default: `10`) |

`GOOGLE_PRIVATE_KEY` processing in `config.js`:
```js
(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
```
This converts the stored literal `\n` sequences back into real newlines for the RSA signing step.

## Orchestrator logic (`netlify/functions/sync-products.js`)

```
1. Validate env vars
2. Parse POST body → ignoreCap, activateAll, customAmount
3. getActiveCount()                    → currentActive  (Shopify, paginated)
4. getGoogleAccessToken()             → gToken          (RS256 JWT, 1h TTL)
5. getPreviousActiveCount(gToken)     → previousActive  (Config Sheet!E2)
6. dailyDelta = currentActive - previousActive
   overrideMode = ignoreCap || activateAll || customAmount !== null
   if !overrideMode && dailyDelta >= MAX_DAILY_ACTIVATE → exit 200 "cap_reached"
7. remaining = customAmount ?? (ignoreCap ? MAX_DAILY_ACTIVATE : MAX_DAILY_ACTIVATE - dailyDelta)
8. getListedProducts(gToken)          → listedRows
   if listedRows.length === 0         → exit 200 "nothing_to_activate" (no writes)
9. toActivate = activateAll ? listedRows : listedRows.slice(0, remaining)
   for row of toActivate:
     productId = extractProductId(row.productUrl)
     if !productId → log error, skip row
     activateProduct(productId)        (Shopify PUT, withRetry)
     markProductActive(gToken, rowNum) (Sheet col G → ACTIVE, withRetry)
10. return 200 { activated, ignoreCap, activateAll, customAmount }
```

E2 is **not written** by `sync-products`. The count snapshot is handled exclusively by `refresh-count` (see below).

`ignoreCap: true` is sent via POST body by the web UI's "Override Cap & Run" button. The scheduled cron never sets it — it always runs with the cap enforced.

## `refresh-count` logic (`netlify/functions/refresh-count.js`)

Runs at 17:00 UTC (1h before `sync-products`). No activation logic — only snapshots the baseline.

```
1. Validate env vars
2. getActiveCount()                    → activeCount  (Shopify, paginated)
3. getGoogleAccessToken()             → gToken
4. setPreviousActiveCount(gToken, activeCount)  (Config Sheet!E2)
5. return 200 { activeCount }
```

Daily flow: 17:00 UTC — E2 written → 18:00 UTC — sync-products reads E2, activates products, E2 unchanged for the rest of the day. Any manual re-trigger after 18:00 sees the full day's delta in E2, so the cap is enforced correctly.

If `activateProduct` or `markProductActive` throws after retries, the row stays `LISTED` and will be retried on the next daily run. The Shopify PUT is idempotent — activating an already-active product returns 200 with no side effects.

## Key function signatures

### `src/sheets/client.js`

```js
getGoogleAccessToken() → Promise<string>
// Creates RS256 JWT, posts to oauth2.googleapis.com/token
// Token is valid for 1 hour — sufficient for a single run

getRows(token, sheetId, tabName) → Promise<string[][]>
// GET /v4/spreadsheets/{sheetId}/values/{tabName}!A:Z
// Returns 2D array; empty cells may be missing (shorter row arrays)

updateCell(token, sheetId, tabName, rowNum, colNum, value) → Promise<void>
// rowNum and colNum are 1-based
// colNum → letter via String.fromCharCode(64 + colNum)
// PUT /v4/spreadsheets/{sheetId}/values/{range}?valueInputOption=RAW

readCell(token, sheetId, tabName, cellAddress) → Promise<string>
// cellAddress is a literal like 'E2'
// Returns '' if the cell is empty

withRetry(fn, label, maxAttempts=2, delayMs=3000) → Promise<any>
// Retries fn up to maxAttempts times with delayMs between attempts
// Logs each retry attempt with label
// Throws the last error if all attempts fail
```

### `src/shopify/client.js`

```js
shopifyRequest(method, path, body) → Promise<{ status, body, headers }>
// path is relative, e.g. '/products.json?status=active&limit=250'
// Prefixed with /admin/api/{SHOPIFY_API_VERSION} internally
// Auto-handles 429: reads Retry-After header, sleeps, retries once
// Timeout: 30s
```

### `src/shopify/getActiveCount.js`

```js
getActiveCount() → Promise<number>
// GET /products.json?status=active&limit=250
// Follows Shopify cursor pagination via Link response header
// Link header regex: /<([^>]+)>;\s*rel="?next"?/  (handles quoted and unquoted)
// Strips /admin/api/{version} from next-page URLs before re-requesting
// Returns total count across all pages
```

### `src/shopify/activateProduct.js`

```js
activateProduct(productId) → Promise<object>
// productId: numeric string extracted from admin URL
// PUT /admin/api/2024-04/products/{productId}.json
// Body: { product: { id: parseInt(productId, 10), status: 'active' } }
// Throws on non-200 response
// Idempotent — safe to call on an already-active product
```

### `src/utils/extractProductId.js`

```js
extractProductId(adminUrl) → string | null
// Input:  'https://admin.shopify.com/store/{store}/products/123456789'
// Output: '123456789'
// Returns null for empty, non-string, or URLs without a numeric /products/{id} segment
// Regex: /\/products\/(\d+)\s*$/
```

## Shopify API reference

**Base URL:** `https://{SHOPIFY_STORE_URL}/admin/api/2024-04/`

**Auth header:** `X-Shopify-Access-Token: {token}`

**Get active products (paginated):**
```
GET /products.json?status=active&limit=250
```
- Returns up to 250 products per page
- Next page cursor is in the `Link` response header: `<URL>; rel="next"`
- Subsequent pages use `?page_info={cursor}&limit=250` — do NOT add `status=active` again (Shopify rejects mixing `page_info` with other filters)

**Activate a product:**
```
PUT /products/{id}.json
Body: { "product": { "id": 123456789, "status": "active" } }
```
- Returns 200 on success with the full updated product object
- Returns 422 on validation error

**Rate limits:**
- Leaky bucket: 40 request bucket, refills at 2/s (standard plan)
- 429 response includes `Retry-After` header (seconds to wait)
- `X-Shopify-Shop-Api-Call-Limit` header shows current usage, e.g. `12/40`
- `shopifyRequest()` handles one automatic 429 retry via `Retry-After`

**Deprecation note:** REST Product API is deprecated for new public apps after April 1, 2025. Private/custom apps are unaffected but a GraphQL migration is worth planning.

## Google Sheets API reference

**Base URL:** `https://sheets.googleapis.com/v4/spreadsheets/{sheetId}/`

**Auth:** Bearer token from RS256 JWT service account flow (see `getGoogleAccessToken`)

**Scope required:** `https://www.googleapis.com/auth/spreadsheets`

**Read a range:**
```
GET /values/{range}
// range example: Store%20Sheet!A:Z
// Response: { values: string[][] }  (empty cells are absent from rows)
```

**Write a single cell:**
```
PUT /values/{range}?valueInputOption=RAW
Body: { range: "Store Sheet!G5", majorDimension: "ROWS", values: [["ACTIVE"]] }
```

**Cell addressing in `updateCell`:**
- `rowNum` and `colNum` are 1-based
- Column letter: `String.fromCharCode(64 + colNum)` — works for columns A–Z only
- Example: colNum=7 → `'G'`, colNum=5 → `'E'`, colNum=11 → `'K'`

## Scheduling

Two scheduled functions in `netlify.toml`:

| Function | Cron | UTC | CEST | CET |
|---|---|---|---|---|
| `refresh-count` | `0 17 * * *` | 17:00 | 19:00 | 18:00 |
| `sync-products` | `0 18 * * *` | 18:00 | 20:00 | 19:00 |

`refresh-count` always runs 1 hour before `sync-products` to ensure E2 is up to date before the activation run reads it. Netlify cron runs in UTC only — no timezone support.

## Important constraints and gotchas

- **No npm dependencies.** Uses only Node built-ins: `https`, `crypto`. Do not add packages.
- **Files stay under ~150 lines.** Keep modules small and single-purpose.
- **Column indices must come from `config.js`.** Never hardcode `6`, `7`, `10`, `11` in module files.
- **`getRows` returns a ragged array.** Rows shorter than column K will have `rows[i][10] === undefined`. All column accesses use `(rows[i][col] || '')` to guard against this.
- **`withRetry` default is 2 attempts.** The first failure is retried once after 3s. Permanent errors (bad credentials, wrong sheet ID) will surface after the second attempt.
- **Google token TTL is 1 hour.** A single run completes in well under 60s so no refresh is needed.
- **D2 is off-limits.** `Config Sheet!D2` is used by `product_lister2` as a run lock. Ignite uses `E2` exclusively.
- **`activateProduct` is idempotent.** If the sheet update fails after a successful Shopify activation, the row stays `LISTED`. On next run it will be re-activated (Shopify returns 200 for an already-active product) and the sheet update retried.
- **`test-sync` makes no writes.** It is always safe to call. Use it to verify sheet column layout and product URL formats on any new spreadsheet before the first live run.
- **`ignoreCap` only skips the delta check.** It still respects `MAX_DAILY_ACTIVATE` as a per-run limit — it will never activate more than that number in a single run. The scheduled cron always runs without `ignoreCap`.
- **`index.html` is served statically.** Netlify serves it from the publish root (`"."`). No extra config needed.
