-- Owner's private price layer (the "two back ends" model).
-- The owner marks up the true source cost here; every non-owner view of the
-- catalog (public storefront, staff admin) sees this price AS the product
-- cost. The true cost never leaves the server for non-owner callers.
-- Run once in the Supabase SQL editor (shift-store project).

create table if not exists owner_prices (
  product_id text primary key,
  price      numeric not null,
  updated_at timestamptz not null default now()
);

-- All access goes through the serverless API with the service-role key; no
-- public policy — nothing is directly reachable from the browser.
alter table owner_prices enable row level security;
