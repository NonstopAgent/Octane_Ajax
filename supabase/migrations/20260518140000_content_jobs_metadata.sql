-- Additive: persist full Pixel promo package on content_jobs (RLS policies unchanged).
alter table public.content_jobs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.content_jobs.metadata is
  'Pixel promo package (captions, hooks, hashtags). Populated by pixel-simulator when scheduled.';
