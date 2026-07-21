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

## Admin feature inventory (all live, both roles unless noted)

- **Products**: editable name (→ store), Description button/editor (→ store), per-product price (role's own layer), live profit readout, Hide, category assignment, search.
- **Bulk pricing bar**: % or $ over cost, "only unpriced"/all/**ticked products** (checkboxes select bulk targets when no category is chosen), optional .99 ending, live example.
- **Orders**: profit strip (Sales / You earn — role-correct) + per-order "You earn", tracking auto-sync (6h cron + real-time webhooks), manual sync button; "Enable real-time" owner-only.
- **Profit report CSV** (added 2026-07-20): date-range export on the Orders page — one row per item with sale price, cost, profit, and cost basis, plus totals; each role gets its own numbers. Built for the partner's taxes.
- **Media**: category photos, per-product mockup upload/reorder/delete.
- **Subscribers**: the storefront "Join the Movement" form saves to `subscribers`; list + copy-all-emails.
- **Order at Cost**: wholesale cart — any product at this login's cost through the normal Stripe checkout (records + auto-fulfills like a retail order).
- Header shows a **build stamp** (`v-xxxxx`) — read it to know which version a device is running.

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

## Open items

1. **Hand off staff access**: text the partner the STAFF_KEY password + shift-store.vercel.app/dashadmin.
2. ~~Custom SMTP~~ — DONE + PROVEN 2026-07-20: reset email sends via Resend (`SHIFT <shift@createandsource.com>`, smtp.resend.com:587, user `resend`). ⚠️ Gotcha that cost an hour: the Supabase SMTP form **drops the stored password when you save any other change** — re-paste the Resend API key on EVERY save of that form. Also: Resend sends fail silently-ish (auth 500) until the domain is Verified in Resend (createandsource.com verified 07-20 via the Squarespace integration).
3. **First real order**: the checkout→webhook→order pipeline has never fired in production (orders table has zero rows). One cheap live purchase proves the last mile (it will really produce + ship).
4. ~~Snapshot cost/owner-price onto `order_items` at purchase~~ — DONE 2026-07-20 (+ date-range profit CSV).
5. Optional hardening: pin `PRINTIFY_SHOP_ID=26536230`; Shopify auto-"delivered" needs a fulfillment read scope on the "SHIFT Order Sync" app.
