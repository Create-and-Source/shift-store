-- Cost snapshot at purchase — exact, tax-grade profit that can't drift when
-- catalog prices change later.
--   cost        = true source cost at the moment of purchase (owner eyes only)
--   owner_price = the owner's private price at the moment of purchase
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.order_items add column if not exists cost numeric;
alter table public.order_items add column if not exists owner_price numeric;

-- The customer portal reads order_items with the anon/authenticated keys (RLS
-- limits rows to the buyer's own orders). Buyers must never see cost columns,
-- so: revoke table-wide SELECT and grant it back on every column EXCEPT the
-- two cost columns. The admin APIs use the service role and are unaffected.
revoke select on table public.order_items from anon, authenticated;

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'order_items'
    and column_name not in ('cost', 'owner_price');
  execute format('grant select (%s) on public.order_items to anon, authenticated', cols);
end $$;
