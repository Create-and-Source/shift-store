-- Transactional-email dedupe stamps (added 2026-07-21 with the Resend email
-- layer). confirmation_email_at is set by the Stripe webhook after the order
-- confirmation sends; shipped_email_at gates the shipped/tracking email so it
-- fires exactly once no matter which path lands tracking first (provider
-- webhook, 6h poller, or manual admin entry). Harmless for customer keys
-- (portal selects * on orders; these are just timestamps).
alter table orders add column if not exists confirmation_email_at timestamptz;
alter table orders add column if not exists shipped_email_at timestamptz;
