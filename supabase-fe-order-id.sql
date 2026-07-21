-- Fulfill Engine fulfillment backlink (mirrors printify_order_id / shopify_order_id).
-- Run in the Supabase SQL editor. Safe to re-run.
alter table public.orders add column if not exists fe_order_id text;
