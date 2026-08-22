-- ════════════════════════════════════════════════════════════════════════
-- SHIFT store — Media Gallery
-- Run once in Supabase → SQL Editor. Idempotent (safe to re-run).
--
-- media_library — the gallery itself: every image she has put in it, whether
--   it's a file we host (storage_path set) or one already living on the store
--   / a supplier CDN that the gallery merely points at (storage_path null).
--
-- media_hashes — a fingerprint cache for every image the store USES, keyed by
--   canonical URL. Nothing about it is precious: delete a row and the next
--   scan recomputes it. It exists so matching an upload is a fast lookup
--   instead of re-downloading 200 images.
--
-- RLS on with no policies = service-role only, reachable exclusively through
-- /api/admin/gallery — same posture as owner_prices, settlements, collections.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists media_library (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,                 -- where the image is served from
  url_key       text not null unique,          -- canonical form of url (dedupes)
  storage_path  text,                          -- set only for files WE host
  origin        text not null default 'upload',-- 'upload' = she added the file
                                               -- 'store'  = adopted from the live store
  filename      text,                          -- what she called it on her machine
  sha256        text,
  phash         text,                          -- 1024-bit dHash, hex
  chash         text,                          -- 4x4 average-RGB signature, hex
  width         int,
  height        int,
  bytes         bigint,
  content_type  text,
  tags          jsonb        default '[]'::jsonb,
  note          text,
  pending_match jsonb,                         -- a "possible match" awaiting her yes/no
  created_at    timestamptz  default now(),
  updated_at    timestamptz  default now()
);

create index if not exists media_library_sha256_idx on media_library (sha256);
create index if not exists media_library_created_idx on media_library (created_at desc);

create table if not exists media_hashes (
  url_key       text primary key,
  url           text not null,
  sha256        text,
  phash         text,
  chash         text,
  width         int,
  height        int,
  bytes         bigint,
  content_type  text,
  error         text,                          -- why this one couldn't be read
  checked_at    timestamptz  default now()
);

create index if not exists media_hashes_sha256_idx on media_hashes (sha256);

alter table media_library enable row level security;
alter table media_hashes  enable row level security;
