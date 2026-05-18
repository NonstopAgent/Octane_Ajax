-- Gumroad product id for API-created listings (checkout URL remains gumroad_url)
alter table public.product_listings
  add column if not exists gumroad_product_id text;

comment on column public.product_listings.gumroad_product_id is
  'Gumroad API product id when auto-published on Review Gate approval.';
