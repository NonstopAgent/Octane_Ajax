-- Public bucket for generated product artwork. gpt-image-1 returns PNG, which
-- the private `product_pdfs` bucket rejected (its allowed_mime_types only permit
-- application/pdf + image/jpeg). Storing artwork here lets us persist a small,
-- stable PUBLIC URL instead of a multi-MB base64 data URI, usable by the Review
-- UI, the storefront, and Printify alike.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-artwork',
  'product-artwork',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
