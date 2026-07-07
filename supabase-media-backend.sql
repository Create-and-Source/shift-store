-- ════════════════════════════════════════════════════════════════════════
-- SHIFT store — Media back end schema
-- Run this once in Supabase → SQL Editor. Idempotent (safe to re-run).
-- ════════════════════════════════════════════════════════════════════════

-- 1) Category photos — give each category a hero/tile image.
alter table categories add column if not exists image_url text;

-- 2) Product overrides — upload your own mockups (and optionally override the
--    name/price) for any feed product (Fulfill Engine / Printify / Shopify).
--    product_id matches the storefront product id (e.g. "pf-123", "sh-456").
create table if not exists product_overrides (
  product_id  text primary key,
  image_urls  jsonb        default '[]'::jsonb,  -- uploaded mockup URLs, in order
  name        text,                              -- optional name override
  price       numeric,                           -- optional price override
  updated_at  timestamptz  default now()
);

-- 3) Custom products — products created entirely in the admin (not from a feed).
create table if not exists custom_products (
  id          uuid         primary key default gen_random_uuid(),
  name        text         not null,
  description text         default '',
  price       numeric      not null default 0,
  image_urls  jsonb        default '[]'::jsonb,   -- uploaded mockup URLs
  sizes       jsonb        default '[]'::jsonb,   -- e.g. ["S","M","L","XL"]
  active      boolean      default true,
  sort_order  int          default 0,
  created_at  timestamptz  default now()
);

-- RLS: the app only ever touches these tables through /api routes using the
-- Supabase service-role key (which bypasses RLS), so we enable RLS with no
-- public policy — nothing is directly reachable from the browser.
alter table product_overrides enable row level security;
alter table custom_products   enable row level security;
