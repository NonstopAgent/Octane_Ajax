-- Gumroad checkout URL + public read of published listings (buyer-facing /store)

alter table public.product_listings
  add column if not exists gumroad_url text;

comment on column public.product_listings.gumroad_url is
  'External Gumroad product URL; set when operator publishes to the public store.';

-- Public catalog: read-only published listings (no user_id leak beyond storefront fields)
create policy "product_listings_select_published_public"
  on public.product_listings
  for select
  to anon, authenticated
  using (status = 'published');

-- SEO/tags for published products (ideas linked to a published listing only)
create policy "product_ideas_select_published_listing"
  on public.product_ideas
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.product_listings pl
      where pl.product_idea_id = product_ideas.id
        and pl.status = 'published'
    )
  );
