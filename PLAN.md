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

## Stripe account (switched 2026-07-20)

Payments run through the **Shift Apparel LLC** Stripe account (`acct_1TvRRgFUHp82gpm3`) — switched from the original shared account. Webhook destination "shift-store orders" (checkout.session.completed, API version 2026-06-24.dahlia) → /api/webhook. At switch time the account was **under Stripe review (2–3 days)** — a "can't accept payments" checkout error before review clears is Stripe, not the store. The two 07-20 test payments live in the OLD account (refund there if desired). Stripe Tax — DECIDED 2026-07-20: **no sales-tax permit / no registrations by choice**. Threshold monitoring is ON (Stripe alerts if any state's economic-nexus numbers approach); checkout charges NO tax anywhere, and `automatic_tax` is intentionally NOT enabled in create-checkout (it would no-op without a registration). If she ever registers: enable `automatic_tax` + move the flat-$10 shipping line-item to a real shipping rate + set the Clothing product tax category. `SHOPIFY_WEBHOOK_SECRET` was rotated during the switch — "Enable real-time" must be clicked once after any rotation to re-register with the fresh token.

## State at end of 2026-07-20 (the marathon session)

**LIVE at shiftapparelco.com** (custom domain; Supabase auth Site URL + redirect allow-list updated to it). Stripe = Shift Apparel LLC account (under review at session end). **All three fulfillment legs PROVEN on real orders**: Fulfill Engine (hat, POD catalogProductId+designId shape), Printify (auto-submitted), Shopify→Tapstitch (draft-order flow imported; Tapstitch = U.S. fulfillment + hourly auto-submit). Auth is email-free except password resets (Resend). About page = centered logo (photo removed); footer Info links = real /info/:slug policy pages.

## Open items

1. **Hand off staff access**: text the partner the STAFF_KEY password + shiftapparelco.com/dashadmin.
1b. **Stripe review** (Shift Apparel LLC) — clears ~2–3 days from 07-20; charges worked during review but watch for the account-status banner.
1c. **shift@createandsource.com must RECEIVE mail** — the policy pages tell customers to email it; add it as a Google Workspace alias (or tell Claude a different address to print).
1d. **Small cleanups**: run `supabase-fe-order-id.sql` (FE backlink column; dashboard SQL editor was frozen all session); delete test auth user `shift-signup-test-0720@…`; cancel/delete leftover test orders in /dashadmin + refund test payments in Stripe (both accounts, her call); pay/verify the Baby T + hat + bag productions.
1e. **Watch on the next organic order**: Tapstitch delivery label (should be U.S., was "Intl" pre-setting); whether draft-flow orders still need the Shopify "Request fulfillment" click or auto-request like admin ones; owner prices — pad every unpriced product (bulk bar, "only unpriced") or her cut is $0 on those sales.
2. ~~Custom SMTP~~ — DONE + PROVEN 2026-07-20: reset email sends via Resend (`SHIFT <shift@createandsource.com>`, smtp.resend.com:587, user `resend`). ⚠️ Gotcha that cost an hour: the Supabase SMTP form **drops the stored password when you save any other change** — re-paste the Resend API key on EVERY save of that form. Also: Resend sends fail silently-ish (auth 500) until the domain is Verified in Resend (createandsource.com verified 07-20 via the Squarespace integration).
3. ~~First real order~~ — HAPPENED 2026-07-20 (hat #21239a6c + a Market Bag): pipeline + Printify auto-submission proven live. Caught + fixed: newer Stripe API versions put shipping at `session.collected_information.shipping_details` — the webhook read the legacy field, so those two orders stored no address ("Recover address from Stripe" in the order detail repairs them). Checkout now collects a phone.
3b. **Fulfill Engine auto-fulfillment WORKING — first real FE order submitted 2026-07-20** ("Sent to Fulfill Engine ✓ … will produce and ship"). The store's FE items are **print-on-demand**, and the ONLY order shape FE accepts for them (learned through three validation errors + the FE-debug probe): item = **`catalogProductId` (the blank, e.g. CT103938) + `designId` (the stored design, e.g. d-72452524) + `productColor`/`productSize`** ('One Size' → omit size) + quantity + declaredValue; **NO order-level campaignId** (account-level POD), **NO sku** (campaign variant SKUs price/display only — FE campaign inventory returns empty for them → InvalidSKU if ordered). Both ids resolve at submit time from the authenticated campaign catalog. Webhook auto-submits future FE orders with this same code; admin has validate-then-submit "Send to Fulfill Engine" + an **FE debug** button (campaign catalog + SKU-validity + prices dump). Still pending: `supabase-fe-order-id.sql` (backlink column — submissions work without it, but the admin can't display the FE order id and the Send button stays visible; re-clicking is safe, FE dedupes by order id via customIdIsUniqueKey).
4. ~~Snapshot cost/owner-price onto `order_items` at purchase~~ — DONE 2026-07-20 (+ date-range profit CSV).
5. Optional hardening: pin `PRINTIFY_SHOP_ID=26536230`; Shopify auto-"delivered" needs a fulfillment read scope on the "SHIFT Order Sync" app.
