-- Milestone 2: private product PDF storage (additive only)
-- Path convention: {user_id}/{generation_id}.pdf

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product_pdfs',
  'product_pdfs',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users may read/write only objects under their user_id folder.
drop policy if exists "product_pdfs_select_own" on storage.objects;
create policy "product_pdfs_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'product_pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "product_pdfs_insert_own" on storage.objects;
create policy "product_pdfs_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'product_pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "product_pdfs_update_own" on storage.objects;
create policy "product_pdfs_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'product_pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'product_pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "product_pdfs_delete_own" on storage.objects;
create policy "product_pdfs_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'product_pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
