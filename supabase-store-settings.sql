-- Key/value store settings — first use: shipping rate tables (key
-- 'shipping_rates') for the suppliers with no quote API (Fulfill Engine,
-- Shopify/Tapstitch), edited at /dashadmin → Shipping. RLS on with no
-- policies: service-role only, same posture as owner_prices.
create table if not exists store_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table store_settings enable row level security;
