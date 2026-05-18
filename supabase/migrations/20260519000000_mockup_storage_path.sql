-- Listing mockup image path on product_generations (DALL-E → product_pdfs bucket)
alter table product_generations
  add column if not exists mockup_storage_path text;

-- Allow JPEG mockups alongside PDFs in the private product_pdfs bucket
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg']::text[]
where id = 'product_pdfs';
