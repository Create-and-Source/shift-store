# SHIFT store — architecture & status

Live: **shift-store.vercel.app** · repo `Create-and-Source/shift-store` (push to `master` → auto-deploy) · Supabase project `yjepajzpkcnfkzckkeeb`

## The two backends (built 2026-07-15)

One login screen at **/dashadmin**, two worlds:

| | Owner (Tovah) | Staff (partner) |
|---|---|---|
| Login | `ADMIN_KEY` env | `STAFF_KEY` env |
| "Cost" shown | TRUE source cost | The owner's price |
| Price field edits | `owner_prices` (private layer) | `product_overrides.price` (store retail) |
| Profit shown | owner price − true cost | retail − her cost |
| Sees the other layer? | yes (grey "Store: $X · her cut $Y") | **no — zero trace** |

**Price chain (storefront sells at):** retail → owner price → true cost.

**Cost masking:** all 3 product feeds (`api/products`, `api/printify/products`, `api/shopify/products`) pass through `maskCosts()` in `api/_lib/adminRole.js`. Non-owner callers (public + staff) get `price = ownerPrice ?? cost`; the true cost never leaves the server except for the owner key. Neither key has a code fallback — env-only, fail closed.

**Sources feed TRUE cost** (aligned 2026-07-15): Fulfill Engine + Printify prices set by Tovah; the 7 Shopify/Tapstitch listings were halved to real production cost (Tapstitch had auto-listed at exactly 2×).

**Shopify orders use the DRAFT-ORDER flow (2026-07-20, proven live)**: `draftOrderCreate` + `draftOrderComplete` — NOT `orderCreate`. Tapstitch only imports orders from Shopify's native channels; direct-API orders (custom-app channel) are invisible to it forever, regardless of shipping/fulfillment-request state. The draft path is the same door as admin "Create order", so Tapstitch imports within a minute. App scopes are now `write_orders,write_draft_orders` (granted via the legacy-install authorize URL + code exchange; token unchanged). Tapstitch store settings: U.S. fulfillment + **auto-submission hourly** (orders pay+submit themselves at the top of each hour; manual Pay in Tapstitch for instant). Admin order detail has **"Send to Shopify"** (draft-flow resubmit, 409+confirm force path for orders whose old Shopify order was cancelled).

## Admin feature inventory (all live, both roles unless noted)

- **Products**: editable name (→ store), Description button/editor (→ store), per-product price (role's own layer), live profit readout, Hide, category assignment, search.
- **Bulk pricing bar**: % or $ over cost, "only unpriced"/all/**ticked products** (checkboxes select bulk targets when no category is chosen), optional .99 ending, live example.
- **Orders**: profit strip (Sales / You earn — role-correct) + per-order "You earn", tracking auto-sync (6h cron + real-time webhooks), manual sync button; "Enable real-time" owner-only.
- **Profit report CSV** (added 2026-07-20): date-range export on the Orders page — one row per item with sale price, cost, profit, and cost basis, plus totals; each role gets its own numbers. Built for the partner's taxes.
- **Friday settlement panel** (added 2026-07-20): Orders page, both roles, same dollar amounts (staff's `cost` = owner price). Groups non-cancelled orders into payout weeks (Fri–Thu, due the following Friday) and shows what the store pays Create & Source: **items at her cost + shipping collected** (C&S fronts production AND real shipping; the flat shipping the customer pays passes through — consistent with profit views, which exclude shipping from her earnings). Open week shows orange "week still open". Only renders on the All filter (needs the full list); pre-snapshot orders estimated at current catalog cost, cancelled excluded. **Mark-paid tracking (same day)**: `settlements` table (`supabase-settlements.sql` — week_start date pk, amount snapshot, paid_by, paid_at; RLS on, no policies), API = `GET /api/admin/orders?view=settlements` + POST `action: markSettled` (paid:false = unmark), both roles. Paid rows show green "Paid ✓ date · $amount" + × undo; if the week later computes a different figure than what was paid, an orange "now computes $Y" drift hint appears. Fail-soft until the migration runs (marking reports the missing table — migration APPLIED 2026-07-20 via the platform pg-meta API; that path, not the SQL-editor UI, is how to run SQL from automation now, see memory/[[supabase-dashboard-automation]]). **Each row self-reconciles**: "customers paid $X, you keep $Y" (owner sees "she keeps") — added after the first real week read as "owes $120.20 of $131.47" (the Sales strip excludes shipping; customers actually paid $161.47). "You keep" = before Stripe card fees (noted in the hint).
- **Media**: category photos, per-product mockup upload/reorder/delete.
- **Subscribers**: the storefront "Join the Movement" form saves to `subscribers`; list + copy-all-emails.
- **Order at Cost**: wholesale cart — any product at this login's cost through the normal Stripe checkout (records + auto-fulfills like a retail order).
- Header shows a **build stamp** (`v-xxxxx`) — read it to know which version a device is running.

## Stock awareness + loud fulfillment failures (added 2026-07-21)

Built after an organic order hit an out-of-stock FE blank: **FE's public shop feed has NO stock data, FE ACCEPTS orders for out-of-stock blanks and silently parks them in "Processing"** — nothing in the store knew inventory existed.

- **`feAvailability()`** (`api/_lib/fulfillengine.js`): campaign products → catalog blanks → `POST /product-catalog/inventory` (authenticated, 50 ids/call) → per-(color,size) `isAvailable`. Keys via `comboKey()` — case-insensitive, `'One Size'` ≡ no size, and **sizes canonicalize to abbreviations** (`SIZE_CANON`, mirrored in App.jsx's `stockKey`): FE's catalog inventory says `3XL` where the shop feed says `XXX-Large` (caught on live data 07-21 — full-name keys silently never match). **Fail-open everywhere**: unknown products/combos sell; an FE error never hides the store or blocks checkout.
- **`/api/stock`** (public, CDN-cached `s-maxage=120`): availability map for the storefront; `?debug=1` adds every combo (for eyeballing FE-vs-feed option names).
- **Storefront**: sold-out sizes struck+disabled per colorway, slashed swatches, "Sold Out" add-button + card/carousel badges; stock loads apart from the product feeds so paint is never delayed.
- **Checkout guard** (`create-checkout.js`): re-checks FE items server-side → 409 `sold_out` with a human message; covers Order-at-Cost too (it sends `source`). Checkout errors are now VISIBLE on /checkout (`checkoutError` — they were console-only before).
- **`orders.fulfillment_error`** (`supabase-fulfillment-error.sql`): stamped by the webhook when any provider submit FAILS (FE/Printify/Shopify) or when an FE item was **out of stock at purchase** (order still submits; FE holds production until restock). Red "⚠ Fulfillment issue" chip on the order row + banner in the detail; cleared by a successful Send to FE / Send to Shopify. Appends, fail-soft until the migration runs. NOT revoked from customer keys (portal selects `*` on orders; text is cost-free).
- FE's order API can NOT see the red-⚠ problem state (status enum is just confirmed→fulfilled) — prevention at checkout is the only real defense.

## Transactional email + FE tracking (added 2026-07-21)

**Email via Resend HTTP API** (`api/_lib/email.js`, sender **`SHIFT <noreply@shiftapparelco.com>`** — Tovah's call. The domain **shiftapparelco.com was added to Resend 07-21** via the Squarespace one-click integration; all three records (DKIM `resend._domainkey`, MX+SPF on `send.`) confirmed resolving in public DNS same hour — if Resend still shows Pending, it just hasn't re-checked yet). **Inert until `RESEND_API_KEY` is set in Vercel** (Sensitive, Prod+Preview — a separate key from the one pasted into Supabase's SMTP form; create a fresh one in Resend → API Keys). Two sends, both best-effort (never block an order/tracking write) and deduped via timestamp columns (`supabase-email-log.sql`, applied 07-21):

- **Order confirmation** — webhook, immediately after the order records (before fulfillment legs, so a provider failure never costs the receipt). Items/totals/address + "View your order" → /account. Stamps `confirmation_email_at`.
- **Shipped/tracking** — `sendShippedEmailOnce(orderId)` fires from EVERY path that lands tracking: provider webhooks (`saveTrackingByColumn`), the 6h poller, and manual admin tracking entry. Reads its own state; sends only when tracking exists and `shipped_email_at` is null. Tracking number + "Track your package" (falls back to /account when no URL).
- Templates: email-safe inline-styled tables, black masthead SHIFT wordmark + red period, white card. Admin order detail shows both sent-stamps under Created/Updated.

**FE tracking now syncs** — `getFEOrderTracking()` (GET `/orders/{feOrderId}/shipments` → first non-canceled shipment's trackingNumber/trackingUrl) wired into `sync-tracking.js` as a third branch on `fe_order_id` (FE orders were previously skipped entirely — tracking would NEVER arrive for them). No FE shipped-webhook yet; the 6h cron + manual "Sync tracking" button cover it.

⚠️ `sync-tracking` auth note: with no `CRON_SECRET` set, the `x-vercel-cron` header path is spoofable by outsiders (they could trigger a sync and read the response's order-id/tracking summaries). Setting `CRON_SECRET` in Vercel closes it — recommended, low urgency.

## Stripe Connect split — "pay C&S first" (built 2026-07-21, Option A)

Tovah's pick over holding the money herself: **the LLC stays merchant of record; every charge carries `application_fee_amount` = the C&S share (items at owner price ?? true cost + shipping — the settlement-panel formula), routed to Tovah's platform account before the partner is paid anything.** Partner nets retail − C&S share − Stripe processing fee (fee burden unchanged from today). Sessions are created ON the LLC account (`stripeAccount` header) THROUGH the platform key — so the existing webhook, secret, and dashboard are untouched. **Refund pass-through (her call: "I should refund too")**: webhook handles `charge.refunded` and refunds the application fee in the same proportion via the platform key — idempotent (computes target from amounts, issues only the delta); works for partner dashboard refunds too.

**SETUP COMPLETED 2026-07-21 (same session)** — falls back to the direct legacy path on missing env or ANY Connect error (checkout never breaks over the split):
1. ✅ Platform = **Create and Source** account `acct_1S6acUIS77PGmiND` (Connect was already enabled on it). OAuth toggled ON + redirect URI `https://shiftapparelco.com/api/connect-exchange` added (Settings → Connect → Onboarding options → OAuth; live client_id `ca_UBc5BXA6nm50GjTvXRMekVFBhnG1rG8R`).
2. ✅ LLC authorized via the OAuth link; the exchange completes SERVER-SIDE at **`api/connect-exchange.js`** (the redirect URI itself — uses the env platform key, shows "Connected ✓"; safe to keep deployed, codes are single-use). Confirmed: `acct_1TvRRgFUHp82gpm3` connected.
3. ✅ `STRIPE_PLATFORM_KEY` in Vercel (fresh key "shift-connect-platform" on the C&S account — in Stripe's create-key dialog pick **"Powering an integration you built"**; the "AI agent" option only mints restricted keys, which can't do the OAuth exchange) + redeployed.
4. ✅ `charge.refunded` added to the "shift-store orders" Workbench destination (now 2 events; signing secret unchanged — no re-registration needed).
5. ⏳ Prove on the next real charge: the payment in the LLC dashboard shows the application fee, C&S balance gains the share. (A cheap Order-at-Cost purchase works as the test.)

Once proven, the Friday settlement panel = verification/history, not a to-do (money already split per-charge). Note: platform payouts follow Tovah's payout schedule. Stripe-dashboard automation gotchas: the account-switcher menu click SIGNS YOU OUT (lost the session once — navigate by direct `/acct_…/` URLs instead); the Workbench event picker's search only filters the ACTIVE tab (switch to "All events" first).

## Real per-supplier shipping (added 2026-07-21)

Trigger: a real $179 order — the C&S app fee ($127) came in $1 under her actual supplier bill ($128) because the store charged the customer a flat $10 shipping while real shipping was ~$22. **The flat $10 is gone**: shipping is now quoted per supplier leg (each supplier ships its own parcel; a mixed cart pays the sum).

- **`api/_lib/shipping.js`** — `computeCartShipping(items)`: Printify = live API rate (falls back to table on error); Fulfill Engine + Shopify/Tapstitch have NO quote APIs, so they price from **first-item + each-additional rate tables** stored in `store_settings` key `shipping_rates` (migration `supabase-store-settings.sql`), merged over `DEFAULT_RATES` per-field. Sources: `fulfillengine` / `shopify` / `printify` / `other`. Every failure charges the table/default — checkout is never blocked.
- **`/api/shipping`** — public quote endpoint; the checkout page shows it live (with a "ships in N packages" note on multi-leg carts) and `create-checkout` recomputes the same quote server-side. **The client-supplied `shipping` field is dead** — it used to be trusted (a shopper could POST `shipping: 0.01`).
- **The app fee / settlement picks the new number up automatically** — shipping was already part of the C&S share formula; now the number is real instead of $10.
- **/dashadmin → Shipping** (new menu page, both roles; staff read-only): edit the per-source tables (owner-only save, `setShippingRates` action in content.js). Owner also gets **"Pull FE actuals"** — FE's invoices API returns per-order `itemCost` / `pickAndPack` / `shipping` actuals keyed by our order uuid (`feShippingActuals()` in the FE lib, `api/admin/shipping-audit.js`). ⚠️ **FE bills pick & pack ON TOP of shipping** — the FE table entry should cover shipping + P&P. Calibrate from that table; defaults shipped as FE $10 + $6/extra, Shopify $5 + $2.50/extra (Tapstitch publishes ~$4.44 + $0.50–$2.20), Printify-fallback $6 + $2, other $10 + $5.
- `api/printify/shipping.js` still exists but nothing calls it (superseded by `/api/shipping`).

## Printify production-push race + owner-only error trail (2026-07-21)

First live Printify order (#72b5834d) hit a race: the webhook creates the Printify order then immediately pushes to production, but Printify holds fresh orders in status `pending` briefly and the push 400s (code 8502 "not allowed … with status pending"). The order EXISTED in Printify (it produced fine) but the banner said "NOT sent" and no backlink was stored (the update ran after the failed push). Fixes:
- `sendPrintifyToProductionWithRetry()` — retries ONLY the 8502/pending race (4 attempts, 4s apart); webhook uses it, and `vercel.json` gives `api/webhook.js` `maxDuration: 60` to fund the waits.
- Webhook stores `printify_order_id` BEFORE the push, and the two failure modes stamp distinct messages (created-but-not-pushed vs not-created).
- **"Send to Printify" admin button** (`api/admin/printify-submit.js`): never creates — finds the existing Printify order (backlink, else external_id scan of the recent-orders list, since their API can't filter by external_id) and pushes it; if it's already moving, it just clears the banner.
- **`fulfillment_error` is OWNER-ONLY now (Tovah's call)**: `api/admin/orders.js` GET deletes it for staff (same server-side posture as cost masking) and the UI chip/banner render only for the owner — the partner never sees raw provider error dumps.

## Customer portal (/account) — reworked 2026-07-20 (email-free auth)

Supabase auth, **Sign In / Sign Up only** (Magic Link removed). **Email confirmation is OFF** — signup logs straight in, no email ever (the built-in sender was dead, and `/checkout` is auth-gated, so unconfirmable accounts blocked ALL purchases). **Forgot password?** on Sign In → reset link → set-new-password card; that reset is the ONLY email the store sends, via custom SMTP (Resend, sender `shift@createandsource.com`, configured in Supabase → Auth → Emails). Buyers auto-created at purchase are passwordless — "Forgot password?" is how they claim their account. RLS verified: customers see only their own orders. Fixed 07-15: Site URL was `localhost:3000`, signup-then-buy account linkage.

## Data (Supabase)

`orders` + `order_items` + `customers` (RLS: own-rows via `auth_id`), `product_overrides` (image_urls / name / price=retail / description), `owner_prices` (private), `categories` + assignments, `subscribers`, storage bucket `store-media`. SQL files in repo root.

**Cost snapshots (added 2026-07-20, migration run):** the webhook stamps `order_items.cost` (true source cost) + `order_items.owner_price` (private layer) at purchase, so profit reports are exact forever — catalog price changes can't rewrite history. The admin orders API masks per role (staff's `cost` = owner price; `owner_price` stripped). Column-level grants revoke both columns from customer keys — which means **any client-side select on `order_items` must name explicit columns; `select(*)` is permission-denied for anon/authenticated.** Profit views prefer snapshots and fall back to live catalog costs for older orders (flagged "estimated").

⚠️ **Any new field on `product_overrides` must be carried by EVERY `setOverride` call site** (price/name/photos/description handlers) or edits wipe it.

## Gotchas

- **Vite 8 hash reuse**: fixed via per-build filename stamp in `vite.config.js` — never remove it (stale immutable caches shipped weeks-old bundles to phones; hard refresh couldn't fix it).
- Verify deploys by **content** (grep the bundle), and check what a real browser sees vs curl when in doubt.
- No node on the dev Mac — verify on the live deploy.
- Supabase auth emails use the built-in sender: **~2/hour**. Fine for testing, not for customers.

## Stripe account (switched 2026-07-20)

Payments run through the **Shift Apparel LLC** Stripe account (`acct_1TvRRgFUHp82gpm3`) — switched from the original shared account. Webhook destination "shift-store orders" (checkout.session.completed, API version 2026-06-24.dahlia) → /api/webhook. At switch time the account was **under Stripe review (2–3 days)** — a "can't accept payments" checkout error before review clears is Stripe, not the store. The two 07-20 test payments live in the OLD account (refund there if desired). Stripe Tax — DECIDED 2026-07-20: **no sales-tax permit / no registrations by choice**. Threshold monitoring is ON (Stripe alerts if any state's economic-nexus numbers approach); checkout charges NO tax anywhere, and `automatic_tax` is intentionally NOT enabled in create-checkout (it would no-op without a registration). If she ever registers: enable `automatic_tax` + move the shipping line-item (now the real per-supplier quote, 2026-07-21) to a Stripe shipping rate + set the Clothing product tax category. `SHOPIFY_WEBHOOK_SECRET` was rotated during the switch — "Enable real-time" must be clicked once after any rotation to re-register with the fresh token.

## State at end of 2026-07-20 (the marathon session)

**LIVE at shiftapparelco.com** (custom domain; Supabase auth Site URL + redirect allow-list updated to it). Stripe = Shift Apparel LLC account (under review at session end). **All three fulfillment legs PROVEN on real orders**: Fulfill Engine (hat, POD catalogProductId+designId shape), Printify (auto-submitted), Shopify→Tapstitch (draft-order flow imported; Tapstitch = U.S. fulfillment + hourly auto-submit). Auth is email-free except password resets (Resend). About page = centered logo (photo removed); footer Info links = real /info/:slug policy pages.

## 2026-07-20 ~9 PM — FIRST ORGANIC SALES NIGHT (3 real customers) + FE auto-fulfillment PROVEN

Three organic orders within ~40 min: Michael Sperando $41.99 (#0e39c000), Genaro Casas $45.49 (#0094e2f1), Nicole Soares $73.99 (#80928148) — all FE products. **The webhook auto-submitted all three to Fulfill Engine hands-free** (FE order ids 4122-0570-0153 / 4122-0570-1004 / 4122-1906-2142, custom id = our order uuid, timestamps matching each purchase) — so FE_API_KEY is live and ALL THREE fulfillment legs are now proven fully automatic on real checkouts. Numbers: collected $161.47 → partner pays C&S $120.20 (settlement panel, verified on real data) → she keeps $41.27; FE's costs $26.88+$31.76+$49.42 = $108.06, so Tovah nets ~$12 on the trio if FE's Cost includes shipping — **owner-price padding on these products is thin**.

⚠ Watch: all three sat "Processing" with a red warning in FE and empty Date-fulfilled — check whether FE needs manual pay/approve for production (like the earlier hat); if so, orders don't produce until she does. **07-21: at least one was an out-of-stock blank** — Tovah handling the order itself; the store-side fix (stock awareness + loud failures) shipped same day, see its section.

## Open items

0. **Calibrate the shipping tables** (/dashadmin → Shipping): pull FE actuals once FE invoices the live orders, set the Fulfill Engine first/additional so it covers shipping + pick & pack; sanity-check a Tapstitch order's real bill against the Shopify table. Until calibrated, the defaults (FE $10+$6) are educated guesses — better than the old flat $10 but not proven.
1. **Hand off staff access**: text the partner the STAFF_KEY password + shiftapparelco.com/dashadmin.
1b. **Stripe review** (Shift Apparel LLC) — clears ~2–3 days from 07-20; charges worked during review but watch for the account-status banner.
1c. **shift@createandsource.com must RECEIVE mail** — the policy pages tell customers to email it; add it as a Google Workspace alias (or tell Claude a different address to print).
1d. **Small cleanups**: ~~run `supabase-fulfillment-error.sql`~~ DONE 2026-07-21 (pg-meta path); ~~run `supabase-email-log.sql`~~ DONE 2026-07-21; ~~set `RESEND_API_KEY`~~ DONE 2026-07-21 (emails LIVE — domain Verified, test confirmation delivered); optionally set `CRON_SECRET`; ~~run `supabase-fe-order-id.sql`~~ DONE 2026-07-20 (via platform pg-meta API — the SQL editor UI never mounts in automation; see the settlement section); ~~delete test auth user `shift-signup-test-0720@…`~~ DONE 2026-07-20 (verified zero linked customers/orders first); cancel/delete leftover test orders in /dashadmin + refund test payments in Stripe (both accounts, her call); pay/verify the Baby T + hat + bag productions.
1e. **Watch on the next organic order**: **the Connect split proof — payment in the LLC dashboard shows the application fee, C&S balance gains cost+shipping** (falls back silently to unsplit if Connect errors — check!); the confirmation email arriving; Tapstitch delivery label (should be U.S., was "Intl" pre-setting); whether draft-flow orders still need the Shopify "Request fulfillment" click or auto-request like admin ones; owner prices — pad every unpriced product (bulk bar, "only unpriced") or her cut is $0 on those sales. **07-20 organic-night additions**: confirm/pay the 3 FE orders' production (red-⚠ Processing state; ≥1 was an OOS blank — Tovah handling) and consider fattening owner prices on the FE items (Tovah's net on the trio ≈ $12 vs her $41.27). When FE ships them, the tracking sync + shipped emails to those 3 customers are automatic now.
2. ~~Custom SMTP~~ — DONE + PROVEN 2026-07-20: reset email sends via Resend (`SHIFT <shift@createandsource.com>`, smtp.resend.com:587, user `resend`). ⚠️ Gotcha that cost an hour: the Supabase SMTP form **drops the stored password when you save any other change** — re-paste the Resend API key on EVERY save of that form. Also: Resend sends fail silently-ish (auth 500) until the domain is Verified in Resend (createandsource.com verified 07-20 via the Squarespace integration).
3. ~~First real order~~ — HAPPENED 2026-07-20 (hat #21239a6c + a Market Bag): pipeline + Printify auto-submission proven live. Caught + fixed: newer Stripe API versions put shipping at `session.collected_information.shipping_details` — the webhook read the legacy field, so those two orders stored no address ("Recover address from Stripe" in the order detail repairs them). Checkout now collects a phone.
3b. **Fulfill Engine auto-fulfillment WORKING — first real FE order submitted 2026-07-20** ("Sent to Fulfill Engine ✓ … will produce and ship"). The store's FE items are **print-on-demand**, and the ONLY order shape FE accepts for them (learned through three validation errors + the FE-debug probe): item = **`catalogProductId` (the blank, e.g. CT103938) + `designId` (the stored design, e.g. d-72452524) + `productColor`/`productSize`** ('One Size' → omit size) + quantity + declaredValue; **NO order-level campaignId** (account-level POD), **NO sku** (campaign variant SKUs price/display only — FE campaign inventory returns empty for them → InvalidSKU if ordered). Both ids resolve at submit time from the authenticated campaign catalog. Webhook auto-submits future FE orders with this same code; admin has validate-then-submit "Send to Fulfill Engine" + an **FE debug** button (campaign catalog + SKU-validity + prices dump). ~~Still pending: `supabase-fe-order-id.sql`~~ — column added 2026-07-20; the admin can now store/display FE order ids on new submissions.
4. ~~Snapshot cost/owner-price onto `order_items` at purchase~~ — DONE 2026-07-20 (+ date-range profit CSV).
5. Optional hardening: pin `PRINTIFY_SHOP_ID=26536230`; Shopify auto-"delivered" needs a fulfillment read scope on the "SHIFT Order Sync" app.
