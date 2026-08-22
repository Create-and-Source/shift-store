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

**⚠️ The Shopify order is INTERNAL — the customer must never see it (fixed 2026-08-10, commit bb4f452)**: this store's listing prices ARE the supplier costs (halved 07-15 to match Tapstitch), so any Shopify-side page shows our wholesale. The webhook used to put the **buyer's email** on the draft order, which made Shopify mail them its own order confirmation and surface the order in their **Shop app** — order #1014/#D12 showed a customer $37.94 + $9.98 + free shipping against the $53.99 + $23.99 + $9.00 she paid SHIFT. Now: (1) every Shopify order books against a house address, `SHOPIFY_ORDER_EMAIL` (default `orders@shiftapparelco.com`) — Tapstitch needs only the items + shipping address, and SHIFT sends its own confirmation/tracking mail; (2) line items carry the **retail price actually paid**, read off the Stripe line items via the cart index `x` now in the `sf` route (never trusted from the client) using `priceOverride` (falls back to the deprecated `originalUnitPrice` if the API version ever rejects it, so a schema miss can't cost a fulfillment); (3) the shipping line is the real Shopify-leg charge, not `0.00`. Same treatment in `api/admin/shopify-submit.js` (uses `order_items.unit_price`). **Rule: never hand a supplier-side system the buyer's email unless that supplier is meant to talk to them.** Printify is already safe (`send_shipping_notification: false`); FE sends no customer mail.
- Shopify's notification setting does NOT need to be switched off — it mails whatever address is on the order, and the Shop app linked the leaked order purely by email match.
- `shiftapparelco.com` has **no MX records** (send-only via Resend), so the house address isn't a real mailbox and Shopify's confirmation bounces into nothing — intended. Point it at a real inbox by setting `SHOPIFY_ORDER_EMAIL` in Vercel; env only, no code change.
- The buyer's **phone** still goes on the Shopify *shipping address* (Tapstitch/carrier need it for delivery). It is not on a Shopify customer record — the customer is created from the house email — so it doesn't link the order back to the buyer.
- Neither change touches fulfillment: Tapstitch imports off the native draft-order channel (the email was never the trigger) and bills its own production cost from the wallet, not the order's sale price. **Unproven on a real paid order** — watch the next organic Shopify/Tapstitch purchase: retail prices + house email in the Shopify admin, buyer receives nothing, Tapstitch imports within the hour.

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
- **/dashadmin → Shipping** (new menu page, both roles; staff read-only): edit the per-source tables (owner-only save, `setShippingRates` action in content.js). Owner also gets **"Pull FE actuals"** — FE's invoices API returns per-order `itemCost` / `pickAndPack` / `shipping` actuals keyed by our order uuid (`feShippingActuals()` in the FE lib, `api/admin/shipping-audit.js`). ⚠️ **FE bills a $0.50/item POD charge ON TOP of the shipping label** — the FE table entry covers both. **Defaults CALIBRATED 2026-07-21 from real supplier bills (commit 2bcbf39): FE $8.50 + $3.00/extra** (FE invoices: 2-item $10.24 / 5-item $16.28 / 7-item $22.26 labels), **Shopify/Tapstitch $4.50 + $4.50/extra** (real 5-item bill $22.30 ≈ $4.46/item FLAT — Tapstitch's published "$0.50/extra" tee rate does not survive contact with an actual invoice), Printify-fallback $6 + $2, other $10 + $5. Verified live: mixed 3-source cart quotes $17.75 (8.50 + 4.50 + 4.75 Printify live).
- `api/printify/shipping.js` still exists but nothing calls it (superseded by `/api/shipping`).

## Printify production-push race + owner-only error trail (2026-07-21)

First live Printify order (#72b5834d) hit a race: the webhook creates the Printify order then immediately pushes to production, but Printify holds fresh orders in status `pending` briefly and the push 400s (code 8502 "not allowed … with status pending"). The order EXISTED in Printify (it produced fine) but the banner said "NOT sent" and no backlink was stored (the update ran after the failed push). Fixes:
- `sendPrintifyToProductionWithRetry()` — retries ONLY the 8502/pending race (4 attempts, 4s apart); webhook uses it, and `vercel.json` gives `api/webhook.js` `maxDuration: 60` to fund the waits.
- Webhook stores `printify_order_id` BEFORE the push, and the two failure modes stamp distinct messages (created-but-not-pushed vs not-created).
- **"Send to Printify" admin button** (`api/admin/printify-submit.js`): never creates — finds the existing Printify order (backlink, else external_id scan of the recent-orders list, since their API can't filter by external_id) and pushes it; if it's already moving, it just clears the banner.
- **`fulfillment_error` is OWNER-ONLY now (Tovah's call)**: `api/admin/orders.js` GET deletes it for staff (same server-side posture as cost masking) and the UI chip/banner render only for the owner — the partner never sees raw provider error dumps.

## Guest checkout — NO ACCOUNT REQUIRED (2026-07-24)

**Buying takes zero signup.** `/checkout` is an open route (the `RequireAuth` wrapper is gone) and the cart drawer goes straight there; "Have an account? Sign in" is a quiet secondary link, never a gate. The backend never required an account — `create-checkout` has always treated `customerEmail` as optional (Stripe Checkout collects it at payment) and the webhook builds the `customers` row **and its Supabase auth user** from `session.customer_details.email` either way. So a guest order is fully recorded, fulfilled, and emailed exactly like a signed-in one.

- **Checkout summary** states it plainly ("Guest checkout — no account needed…") or names the signed-in email ("Ordering as …").
- **/account** shows "Continue as guest" whenever a cart is waiting — nobody who lands there is trapped.
- **/order-success → `/account?claim=1`** opens the page straight in reset mode: the guest's auth user already exists (webhook-created, passwordless), so the reset link is how they set a password and unlock the order history that is already theirs (RLS matches on `auth_id`, which was stamped at purchase).
- **Tracking needs no account** — the shipped email carries it; the portal is a bonus. Shipping policy copy says so.

## Categories vs Collections (2026-08-13)

Two different things that used to share one word. **Categories** answer *what is it* — Hats,
T Shirts, Pants, Hoodies, Shorts, Accessories, Athletic. **Collections** answer *what drop is it
part of* — the OG Collection, the Summer Collection — and can pull products from **any** category
(an OG hoodie is in Hoodies; an OG tee is in T Shirts; both can sit in the OG Collection).

- The storefront board that lists Hats/T Shirts/… was labelled "Collections" while the admin called
  the same rows categories. It now says **Categories** everywhere (header, mobile nav, footer, page
  title) and lives at **`/categories`**. Its behaviour is unchanged — same tiles, same data, same
  `/shop?category=` deep links. **`/collections` (plural) still resolves to that same board** so old
  links, bookmarks and anything indexed don't 404.
- ⚠️ There is still a **category** literally named "Summer Collection" (5 products). Left in place on
  purpose — removing it would change the Shop filters and the homepage deep link
  `/shop?category=Summer%20Collection`. Worth cleaning up once the collection version is populated.
- ⚠️ `/collection` (singular) and `/collections` (plural) are one character apart and go to different
  pages. Deliberate — `/collection` is what was asked for — but worth renaming if it ever confuses.

**Live state 2026-08-14**: migration APPLIED, both collections seeded with their photos and visible,
**0 products assigned** (Tovah is assigning them — "dont add anythign to the collections, I will do
that"). Verified live: public GET returns both, POST 401s unauthenticated and with a wrong key, both
photos load, all three routes serve.

⚠️ **"OG" is a display RENAME across most of the catalog** — Market Bag → "OG Market Bag", the AS Colour
tee → "OG Heavy Tee", the yoga leggings and sports bra too. Matching a collection by product name would
sweep in ~18 unrelated products, which is exactly why membership is explicit ticks only. Don't
"helpfully" add a name-matching fallback.

⚠️ **Two different products both display as "OG Heavy Tee"** (the real OG Heavy T and the renamed
AS Colour Mens Heavy Tee) — they read as duplicates anywhere they appear together.

## Media Gallery — "is this photo being used, and where?" (2026-08-21)

**/dashadmin → Gallery.** Drop in any number of mockups at once; each one is matched against every
image the store is actually showing, **by the picture rather than the filename**, and the answer
comes back per file:

| verdict | what happens |
|---|---|
| already on the store | **her upload is discarded** and the store's own copy is what lands in the gallery, carrying the list of places it appears |
| already uploaded before | matched a file sitting in storage that nothing currently shows — that copy is reused, flagged "not used anywhere" |
| already in the gallery | nothing is stored twice |
| looks like one on the store | **both are kept** and shown side by side — she says same/different |
| new | stored, flagged as used nowhere yet |

**Fingerprinting** (`api/_lib/imagehash.js`) — three signatures per image: `sha256` (exact bytes),
`phash` (1024-bit dHash, 33×32 grayscale) and `chash` (4×4 average-RGB grid). Pure JS on purpose
(`jpeg-js` + `pngjs`, no native binary) so this Mac and a Vercel function compute the same bits — a
perceptual hash that differs per machine is worthless. Alpha composites onto **white** on both sides,
because half the mockups are transparent PNGs and the two copies have to land on the same background.

⚠️ **The thresholds are CALIBRATED against real store images, not guessed** (measured 2026-08-21):

- same photo through the browser's upload pipeline (1400px + JPEG q82) → **19** / 1024
- same photo, FE's "product" vs "zoom" rendition → **9**
- DIFFERENT: **front vs back of the same black leggings → 70**
- DIFFERENT: leggings vs hoodie → 337

Auto-adopt sits at **40** — above every same-image case, well below 70. At the more usual 256-bit
resolution those leggings are **7 bits apart** and would have been silently auto-matched, throwing
away the wrong file; that pair is why this runs at 1024 bits with a colour check beside it. Anything
in 41–110 is a "**maybe**": both files are kept and she decides. FE's 52×78 thumbnails can't match
their own full-size image at any honest threshold, which is why the index treats FE's
`-product`/`-zoom`/`-thumbnail` triplet as **one image** (`canonicalKey`) instead of three.

**Where "used" comes from** (`api/_lib/imageusage.js`, read live on every request — never cached in a
table, so an un-assignment reads as unused immediately): `product_overrides.image_urls`, the three
supplier feeds (through the store's own public endpoints, so it describes exactly what the storefront
shows), `categories.image_url`, `collections.image_url`, `custom_products.image_urls`, and a
hard-coded `SITE_IMAGES` list of the art in `/public` that App.jsx renders. Shopify's `?v=` cache
buster is stripped; **Printify's `?camera_label=` is NOT** — that one picks a different mockup.

**Tables** (`supabase-media-gallery.sql`): `media_library` (the gallery — `storage_path` set only for
files we host, null when it merely points at a store/CDN image) and `media_hashes` (a fingerprint
cache keyed by canonical URL; disposable, a scan rebuilds it). RLS on with no policies = service-role
only, same posture as `owner_prices`/`settlements`/`collections`. `api/admin/gallery.js` answers
"gallery not set up yet" rather than 500ing until the migration is run.

⚠️ **The site list is hand-written, and a WRONG entry is the dangerous direction** (found 2026-08-21
by Tovah, one day after shipping): the pink/red convertible hoodie photo was tagged "Homepage —
Fresh Drops card" when it is on no page at all — App.jsx's `fallbackBoards` are the **Categories**
page's tiles and render **only when the store has no categories**, and it has eight. Six entries were
wrong that way, plus `shift-logo-tagline.png`, which nothing in the codebase references. The list was
rebuilt from an audit of every file in `public/` against App.jsx + index.html + index.css (favicons
and app icons were missing entirely). Conditional entries now carry a `when` evaluated against live
data, so a dormant fallback reports **"in the code, not showing"** and does **not** count as used.
**A missing entry reads "not used" — merely incomplete. A wrong entry reads "used HERE" — a confident
false answer.** Re-audit the list whenever homepage/Categories art changes.

⚠️ **Own-host images key by PATH, not by URL** (same fix): `/lifestyle/car-meet.png` was filing
itself as two different images depending on whether the request arrived on the apex or on `www`, so a
photo could sit in the gallery twice. `canonicalKey` now strips our own hosts (`*.shiftapparelco.com`,
`*.vercel.app`) down to the path, and rows written under the old form **migrate themselves on the
next scan** (`rekeyStaleRows` — rekey if the canonical slot is free, drop the duplicate if it isn't).

- **Fingerprinting the store runs itself** on first open (batched, with a progress line) — matching
  can't work until it has, so it isn't hidden behind a button she'd have to know about.
- **"Add them all"** pulls every in-use store image into the gallery without copying a byte.
- **"Use on…"** puts a gallery photo onto a product / category / collection — the same URL is what
  the store starts serving, which is what keeps "used / not used" answerable afterwards. ⚠️ The
  product path carries name/price/description across, per the `setOverride` rule above.
- **Delete refuses** while anything on the store still shows that photo, and names where.
- Uploads are processed **one at a time on purpose** — two in flight could each decide the other's
  photo was new and store it twice.
- A photo used somewhere under a **different** URL shows as "**Same picture** — …" rather than
  claiming that slot as its own (`viaCopy`). This is how `og-collection.jpg` and `car-meet.png` read:
  the collection photo was made from the car-meet shot, so they fingerprint as one picture.

### What the first real run turned up (2026-08-21, her Desktop `SHIFT` folder, 82 images)

**50 already on the store · 24 new · 7 the same file saved twice · 1 orphan** (`traffic-waffle-knit-t-
89f8ed72.png` — uploaded once, shown nowhere). The nine `b1e7b585-…` files matched **byte-for-byte**;
they are downloads of Fulfill Engine's own photos. Distances on the "same photo, different export"
matches ran **0–20 out of 1024** — nothing came near the 40 line, and nothing landed in the maybe band.

⚠️ **Seven photos are each doing duty on TWO product listings** — same picture, two URLs, two
listings: Unisex Regular Fit Shorts + OG Fit Shorts · OG Kids' Tee + Snow Washed Kids' T-Shirt · OG
Faded Sweatpants + Sunfade Loose Fit Cotton Sweatpants · Summer Blues Crewneck + Summer Collection
Crewneck · OG Yoga Sports Bra + OG Longline Sports Bra · OG Faded Black Hoodie + OG Faded Bone Hoodie.
Same shape as the known duplicate "OG Heavy Tee" pair. Nothing was changed — her call.

## ⚠️ Newsletter capture — zero signups ever (found 2026-08-13)

Measured directly in the database: **`subscribers` = 0 rows · `customers` = 25 (all 25 with an email)
· `orders` = 26.**

- **Buyer emails have always been saved.** The webhook writes `customers` from
  `session.customer_details.email` on every order — that is what confirmation and tracking mail uses.
- **The newsletter list is empty, and the endpoint is fine.** Proven live: `POST /api/subscribe` →
  `200 {"ok":true}` → row appeared → deleted again (back to 0).
- **Root cause of at least some loss: there were TWO copies of the "Join the Movement" form and only
  one was wired.** The copy on the Collections/Categories page was `onSubmit={e => e.preventDefault()}`
  and nothing else — no request, no error, no saved row, so anyone who used it was silently dropped.
  Fixed 2026-08-13 (swapped in `<NewsletterForm />`; the `/collection` page uses the real one too).
  The homepage copy has been correct since 07-15, so its zero is genuine.
- ⚠️ **Reusable**: grep every usage of a form component before trusting that "the form works" — a
  shared-looking component had a hand-rolled dead twin.
- Possible follow-up (not built, Tovah's call): a buyer-email export on the admin Subscribers page, so
  the 25 real customer addresses are reachable there instead of only per-order.

### The collections feature (`/collection`)

**Not in the header** — the route is live but unlinked, pending sign-off. Everything about a
collection is managed in **/dashadmin → Collections** (both roles): photo, name, kicker line,
description, which products are in it, whether it's hidden, and its countdown.

- **Data**: `collections` (name/slug/label/blurb/image_url/sort_order/**hidden**/**countdown_ends_at**/
  countdown_label) + `collection_products` (collection_id, product_id). Migration
  **`supabase-collections.sql`**, which also seeds the two collections with their photos.
  `product_id` is **text**, not uuid — Printify/Shopify ids are prefixed strings.
  RLS on with no policies = service-role only, same as `owner_prices`/`settlements`.
- **API `api/admin/collections.js`**: GET is public and feeds the storefront; POST needs an admin key.
  **Hidden collections are filtered server-side for non-admin callers** (and their assignments with
  them) — the public payload never carries a hidden collection, so nothing can reveal one client-side.
  Every route answers "no collections" instead of 500ing if the migration hasn't been run yet.
- **Countdown**: `countdown_ends_at` is UTC; the admin's `datetime-local` input converts on both
  edges so 6 PM means 6 PM where she is, not on Vercel. The storefront ticks once a second and
  **renders nothing when there's no timer or it has already expired** — the collection stays up, the
  clock just disappears. The admin refuses a time in the past rather than saving a timer that would
  never show.
- **Hiding a product** was already built and is unchanged: `hidden_products` + the Show/Hide button on
  the admin Products row. Hidden products are filtered out of the storefront feed centrally, so a
  hidden product also vanishes from any collection it's in — no second place to remember.

## Customer portal (/account) — reworked 2026-07-20 (email-free auth)

Supabase auth, **Sign In / Sign Up only** (Magic Link removed). **Email confirmation is OFF** — signup logs straight in, no email ever (the built-in sender was dead, and back when `/checkout` was auth-gated an unconfirmable account blocked ALL purchases; guest checkout has since removed that gate entirely). **Forgot password?** on Sign In → reset link → set-new-password card; that reset is the ONLY email the store sends, via custom SMTP (Resend, sender `shift@createandsource.com`, configured in Supabase → Auth → Emails). Buyers auto-created at purchase are passwordless — "Forgot password?" is how they claim their account. RLS verified: customers see only their own orders. Fixed 07-15: Site URL was `localhost:3000`, signup-then-buy account linkage.

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

0. ~~Calibrate the shipping tables~~ **DONE 2026-07-21 from real supplier bills**: FE (3 invoices: 2-item $10.24 / 5-item $16.28 / 7-item $22.26 labels + $0.50/item POD charge) → **$8.50 + $3.00/additional**; Tapstitch (Carly's $179.95 order billed $128.19 incl. **$22.30 shipping on 5 items ≈ $4.46/item FLAT** — that was the "$22 not $10" discovery; published tee rates are fiction) → **$4.50 + $4.50/item**. ⚠️ NEW: that Tapstitch order fulfilled **"International — Special Line", 10–17 days** despite the 07-20 U.S.-fulfillment setting — check in Tapstitch why (products possibly not stocked U.S.); customer is waiting ~2.5 weeks.
1. **Hand off staff access**: text the partner the STAFF_KEY password + shiftapparelco.com/dashadmin.
1b. **Stripe review** (Shift Apparel LLC) — clears ~2–3 days from 07-20; charges worked during review but watch for the account-status banner.
1c. **shift@createandsource.com must RECEIVE mail** — the policy pages tell customers to email it; add it as a Google Workspace alias (or tell Claude a different address to print).
1d. **Small cleanups**: on Jessica's order #72b5834d click **"Send to Printify"** once — the Printify order is already producing, the click just clears the stale red banner (owner login; staff can't see fulfillment errors at all anymore); ~~run `supabase-fulfillment-error.sql`~~ DONE 2026-07-21 (pg-meta path); ~~run `supabase-email-log.sql`~~ DONE 2026-07-21; ~~set `RESEND_API_KEY`~~ DONE 2026-07-21 (emails LIVE — domain Verified, test confirmation delivered); optionally set `CRON_SECRET`; ~~run `supabase-fe-order-id.sql`~~ DONE 2026-07-20 (via platform pg-meta API — the SQL editor UI never mounts in automation; see the settlement section); ~~delete test auth user `shift-signup-test-0720@…`~~ DONE 2026-07-20 (verified zero linked customers/orders first); cancel/delete leftover test orders in /dashadmin + refund test payments in Stripe (both accounts, her call); pay/verify the Baby T + hat + bag productions.
1e. **Watch on the next organic order**: **the Connect split proof — payment in the LLC dashboard shows the application fee, C&S balance gains cost+shipping** (falls back silently to unsplit if Connect errors — check!); the confirmation email arriving; Tapstitch delivery label (should be U.S., was "Intl" pre-setting); whether draft-flow orders still need the Shopify "Request fulfillment" click or auto-request like admin ones; owner prices — pad every unpriced product (bulk bar, "only unpriced") or her cut is $0 on those sales. **07-20 organic-night additions**: confirm/pay the 3 FE orders' production (red-⚠ Processing state; ≥1 was an OOS blank — Tovah handling) and consider fattening owner prices on the FE items (Tovah's net on the trio ≈ $12 vs her $41.27). When FE ships them, the tracking sync + shipped emails to those 3 customers are automatic now.
2. ~~Custom SMTP~~ — DONE + PROVEN 2026-07-20: reset email sends via Resend (`SHIFT <shift@createandsource.com>`, smtp.resend.com:587, user `resend`). ⚠️ Gotcha that cost an hour: the Supabase SMTP form **drops the stored password when you save any other change** — re-paste the Resend API key on EVERY save of that form. Also: Resend sends fail silently-ish (auth 500) until the domain is Verified in Resend (createandsource.com verified 07-20 via the Squarespace integration).
3. ~~First real order~~ — HAPPENED 2026-07-20 (hat #21239a6c + a Market Bag): pipeline + Printify auto-submission proven live. Caught + fixed: newer Stripe API versions put shipping at `session.collected_information.shipping_details` — the webhook read the legacy field, so those two orders stored no address ("Recover address from Stripe" in the order detail repairs them). Checkout now collects a phone.
3b. **Fulfill Engine auto-fulfillment WORKING — first real FE order submitted 2026-07-20** ("Sent to Fulfill Engine ✓ … will produce and ship"). The store's FE items are **print-on-demand**, and the ONLY order shape FE accepts for them (learned through three validation errors + the FE-debug probe): item = **`catalogProductId` (the blank, e.g. CT103938) + `designId` (the stored design, e.g. d-72452524) + `productColor`/`productSize`** ('One Size' → omit size) + quantity + declaredValue; **NO order-level campaignId** (account-level POD), **NO sku** (campaign variant SKUs price/display only — FE campaign inventory returns empty for them → InvalidSKU if ordered). Both ids resolve at submit time from the authenticated campaign catalog. Webhook auto-submits future FE orders with this same code; admin has validate-then-submit "Send to Fulfill Engine" + an **FE debug** button (campaign catalog + SKU-validity + prices dump). ~~Still pending: `supabase-fe-order-id.sql`~~ — column added 2026-07-20; the admin can now store/display FE order ids on new submissions.
4. ~~Snapshot cost/owner-price onto `order_items` at purchase~~ — DONE 2026-07-20 (+ date-range profit CSV).
5. Optional hardening: pin `PRINTIFY_SHOP_ID=26536230`; Shopify auto-"delivered" needs a fulfillment read scope on the "SHIFT Order Sync" app.
6. **Collections (2026-08-14)** — ~~migration~~ DONE, ~~backend + admin + page~~ SHIPPED. Left for Tovah:
   (a) **assign products** to each collection in /dashadmin → Collections (both are empty, so `/collection`
   shows only empty states); (b) **decide whether `/collection` goes in the header** — the route is live but
   deliberately unlinked pending her approval; (c) retire the "Summer Collection" **category** once the
   collection version is populated; (d) the duplicate "OG Heavy Tee" display name.
7. **Newsletter (2026-08-13)** — the dead second form is fixed, but the list is still empty. Worth deciding
   whether the "Join the Movement" copy/placement is doing anything at all, and whether to surface the
   25 real buyer emails in the admin (see the newsletter section above).
