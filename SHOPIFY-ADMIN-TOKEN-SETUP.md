# Getting the Shopify Admin API token (`SHOPIFY_ADMIN_TOKEN`)

**Why:** Paid orders that contain Shopify products need to be pushed into your Shopify
admin so they can be fulfilled (e.g. by Tapstitch). That code is already built and
deployed — it stays dormant until `SHOPIFY_ADMIN_TOKEN` is set in Vercel.

Shopify's **Spring '26** update removed the old one-click "custom app → reveal Admin
API token." So we get an offline Admin token via a one-time OAuth exchange. ~3 minutes.
Best done by whoever's comfortable in a terminal (Saleem).

**Reference values (this store/app):**
- Store: `jxwqu1-0u.myshopify.com`
- App: **SHIFT Order Sync** (in the Shopify Dev Dashboard)
- Client ID: `01b44f04698aeb24bc856b4dcf541ee3`
- Scopes: `write_orders,read_orders`

---

## Step 1 — Prep the app (Dev Dashboard, one time)
1. Dev Dashboard → app **SHIFT Order Sync** → **Versions** → **New version**
   (it copies the current config).
2. In **URLs**:
   - **UNCHECK** "Embed app in Shopify admin".  ← this is what blocked us before;
     embedded install hides the auth code.
   - In **Redirect URLs**, enter: `https://example.com`
3. In **Access**: keep **"Use legacy install flow"** checked; Scopes = `write_orders,read_orders`.
4. Click **Release**.

## Step 2 — Authorize in the browser → get a one-time code
1. Make sure you're logged into the store as the owner, then paste this URL into the
   browser and hit enter:
   ```
   https://jxwqu1-0u.myshopify.com/admin/oauth/authorize?client_id=01b44f04698aeb24bc856b4dcf541ee3&scope=write_orders,read_orders&redirect_uri=https://example.com
   ```
2. Click **Install / Approve** on the consent screen.
3. The browser lands on a URL like:
   `https://example.com/?code=`**`abc123...`**`&hmac=...&shop=jxwqu1-0u.myshopify.com&...`
4. Copy the **`code=`** value (everything between `code=` and the next `&`).
   It's single-use and expires within a couple of minutes — do Step 3 right away.

## Step 3 — Exchange the code for the token (terminal)
Reveal the app's **Client secret**: Dev Dashboard → app → **Settings** → **Credentials**
→ click the eye icon next to **Secret**.

Run this (replace `PASTE_SECRET` and `PASTE_CODE`):
```bash
curl -X POST https://jxwqu1-0u.myshopify.com/admin/oauth/access_token \
  -d client_id=01b44f04698aeb24bc856b4dcf541ee3 \
  -d client_secret=PASTE_SECRET \
  -d code=PASTE_CODE
```
Response:
```json
{"access_token":"shpat_xxxxxxxxxxxxxxxxxxxxxxxx","scope":"read_orders,write_orders"}
```
Copy the `access_token` (starts with `shpat_`). **This is the Admin token — keep it secret.**

## Step 4 — Put it in Vercel + redeploy
1. Vercel → project **shift-store** → Settings → **Environment Variables** → **Add**.
2. Key: `SHOPIFY_ADMIN_TOKEN`  •  Value: the `shpat_...` token.
3. Environments: **Production + Preview**  •  toggle **Sensitive** ON  •  **Save**.
4. **Redeploy** (the toast's Redeploy button, or push any commit).

**Done.** From then on, any paid order containing Shopify products auto-creates a
**paid** order in your Shopify admin for fulfillment.

**Verify:** place a test order with a Shopify product → it should show up under
Shopify → **Orders** within a few seconds.

---

### Troubleshooting
- **Step 2 lands on a page with no `?code=`** (just `hmac`/`host`/`shop`): the "Embed app
  in Shopify admin" box is still checked — redo Step 1.2 (uncheck it), re-release, retry.
- **`invalid_request` / `invalid_code` on the curl:** the code expired or was already used
  — redo Step 2 to get a fresh one, then run the curl immediately.
- **Orders don't appear after a test purchase:** check the Vercel deploy picked up the env
  var (redeploy after saving), and that the token has `write_orders`.

### How it works (for reference)
- `api/_lib/shopify.js` → `createShopifyOrder()` calls the Admin GraphQL `orderCreate`
  mutation (marks the order `PAID`). No-op unless `SHOPIFY_ADMIN_TOKEN` is set.
- `api/create-checkout.js` carries the Shopify variant IDs through Stripe metadata (`sf0..sfN`).
- `api/webhook.js` reassembles them on the paid-order webhook and creates the Shopify order
  (best-effort, non-blocking — a failure never breaks checkout or the other providers).
