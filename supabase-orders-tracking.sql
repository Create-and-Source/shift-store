-- Auto tracking sync — run once in the Supabase SQL editor.
--
-- Ensures the provider backlink columns exist so the webhook can record which
-- Printify/Shopify order each Supabase order maps to, and the /api/sync-tracking
-- poller can read tracking back onto it. Safe to run repeatedly.
--
-- (tracking_number / tracking_url already exist — used by the admin order panel
--  and the customer "My Orders" dashboard.)

alter table orders add column if not exists printify_order_id text;
alter table orders add column if not exists shopify_order_id  text;

-- Speeds up the poller's "in-flight, no tracking yet" scan.
create index if not exists orders_status_tracking_idx
  on orders (status)
  where tracking_number is null;
