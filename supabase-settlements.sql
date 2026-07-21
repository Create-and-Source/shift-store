-- Friday settlement paid-tracking: one row per payout week marked paid.
-- week_start = the Friday (date) that opens the Fri–Thu payout week.
-- amount = the dollar figure showing when it was marked (so later order
-- edits/cancellations can't silently rewrite what was actually paid).
-- Service-role only (RLS on, no policies) — same posture as owner_prices.
create table if not exists settlements (
  week_start date primary key,
  amount numeric,
  paid_by text,
  paid_at timestamptz not null default now()
);
alter table settlements enable row level security;
