# Media back end — one-time setup

The admin **Media** tab (upload mockups, category photos, custom products) is
built and deployed. It stays dormant until two quick Supabase steps are done.
**No new Vercel env vars are needed** — it reuses the existing Supabase keys.

## Step 1 — Run the SQL (creates the tables)
1. Supabase → your SHIFT project → **SQL Editor** → **New query**.
2. Paste the contents of **`supabase-media-backend.sql`** (in the repo root) and click **Run**.
   - It adds `image_url` to `categories` and creates `product_overrides` + `custom_products`.
   - Safe to re-run.

## Step 2 — Create the image bucket
1. Supabase → **Storage** → **New bucket**.
2. Name it exactly **`store-media`**.
3. Toggle **Public bucket ON** (so uploaded photos can display on the storefront).
4. **Create.**

That's it. Go to **shift-store.vercel.app/admin → Media**:
- **Category Photos** — give each category a photo → shows in the homepage “Shop by Category” grid + Shop page tiles.
- **Custom Products** — upload mockups + set name/price/sizes to add your own products (they sell through the normal Stripe checkout; you fulfill these yourself).
- **Product Photos** — replace the plain feed mockups on any existing product with your own shots.

Uploads are auto-resized in the browser before saving, so they stay fast.

### Notes
- Custom products can be sorted into categories from the **Products** tab, just like feed products.
- If an upload says *“Create a public Storage bucket named store-media”*, Step 2 wasn’t done (or the bucket isn’t public).
