-- Newsletter signups from the storefront "Join the Movement" form.
-- Writes via /api/subscribe (service role); reads = admin only (owner or staff).
-- Ran in the dashboard SQL editor 2026-07-15.
create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now(),
  source text default 'newsletter'
);
alter table subscribers enable row level security;
