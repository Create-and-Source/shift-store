-- Collections: curated drops that cut ACROSS categories.
-- Categories answer "what is it" (Hats, T Shirts, Pants). Collections answer
-- "what drop is it part of" (OG, Summer) and can hold products from any category.
--
-- Run in the Supabase SQL editor (project yjepajzpkcnfkzckkeeb), or via the
-- platform pg-meta path when the editor won't mount in an automation tab.

create table if not exists collections (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  slug              text not null unique,
  label             text,                      -- small kicker over the title, e.g. "Our Staples"
  blurb             text,
  image_url         text,
  sort_order        integer not null default 0,
  hidden            boolean not null default false,
  countdown_ends_at timestamptz,               -- null = no timer running
  countdown_label   text,                      -- e.g. "Drops in" / "Ends in"
  created_at        timestamptz not null default now()
);

-- product_id is TEXT, not uuid: Fulfill Engine ids are uuids but Printify and
-- Shopify ids are prefixed strings (pf-…, sh-…). Same choice as the category table.
create table if not exists collection_products (
  collection_id uuid not null references collections(id) on delete cascade,
  product_id    text not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (collection_id, product_id)
);

create index if not exists collection_products_collection_idx
  on collection_products (collection_id);

-- RLS on with NO policies = service-role only. The storefront never talks to these
-- tables directly; it reads them through /api/admin/collections, which holds the
-- service key and strips hidden collections for non-admin callers.
alter table collections enable row level security;
alter table collection_products enable row level security;

-- The two collections to start with. Products are assigned in /dashadmin → Collections.
insert into collections (name, slug, label, blurb, image_url, sort_order) values
  (
    'The "OG" Collection',
    'og',
    'Our Staples',
    'Vintage acid wash. Cool graphics. The pieces the whole brand was built on — heavyweight, faded right, and cut for people who know that life keeps moving, and so should we.',
    '/lifestyle/og-collection.jpg',
    0
  ),
  (
    'Summer Collection',
    'summer',
    'In Season',
    'Long days, salt air, and nowhere in particular to be. Cut for the season that never sits still — coastal graphics, washed crewnecks, and easy layers that carry from a boardwalk morning straight through to sunset.',
    '/lifestyle/summer-collection.jpg',
    1
  )
on conflict (name) do nothing;
