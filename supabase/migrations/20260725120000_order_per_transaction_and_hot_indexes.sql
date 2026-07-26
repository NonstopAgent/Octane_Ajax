-- 2026-07-25 audit remediation (H5 + M12).
-- Applied to production via Supabase MCP on 2026-07-25 (column + constraint +
-- all 5 indexes verified live; 1 existing row, 0 dupes at apply time).
--
-- H5: one order_queue row PER LINE ITEM. The unique key was
-- (user_id, etsy_order_id) — receipt-level — so the second personalized item
-- in one checkout could never be queued: every pass hit the constraint and
-- reported "duplicate". Re-key on (user_id, etsy_order_id, transaction_id),
-- with '' for legacy rows and payloads that carry no per-line id (those keep
-- the exact old one-row-per-receipt semantics).

alter table public.order_queue
  add column if not exists transaction_id text not null default '';

comment on column public.order_queue.transaction_id is
  'Etsy transaction_id of the line item this row fulfills; '''' for legacy/receipt-level rows. Part of the dedupe key so multi-item receipts queue every personalized item (2026-07-25 audit, H5).';

alter table public.order_queue
  drop constraint if exists order_queue_user_etsy_order_unique;

alter table public.order_queue
  add constraint order_queue_user_order_txn_unique
    unique (user_id, etsy_order_id, transaction_id);

-- M12: indexes for the hot lookups that currently sequential-scan.
-- product_listings is filtered by gumroad_product_id / external_listing_id on
-- every order webhook (order-processor), at production submit
-- (order-fulfillment), hourly by the autopilot binding pass, and daily by the
-- analytics snapshot.

create index if not exists product_listings_gumroad_product_id_idx
  on public.product_listings (gumroad_product_id);

create index if not exists product_listings_external_listing_id_idx
  on public.product_listings (external_listing_id);

create index if not exists order_queue_listing_id_idx
  on public.order_queue (listing_id);

create index if not exists listing_performance_snapshots_listing_id_idx
  on public.listing_performance_snapshots (listing_id);

create index if not exists video_jobs_etsy_listing_id_idx
  on public.video_jobs (etsy_listing_id);
