-- Store-facing description override (editable by owner AND staff in the
-- admin Products tab). Applied to the storefront in ProductsProvider.
-- Ran in the dashboard SQL editor 2026-07-15.
alter table product_overrides add column if not exists description text;
