-- Phase 3: production_submitted status after Printify order submission

alter table public.order_queue
  drop constraint if exists order_queue_status_check;

alter table public.order_queue
  add constraint order_queue_status_check check (
    status in (
      'pending_personalization',
      'processing_artwork',
      'fulfillment_ready',
      'production_submitted',
      'failed'
    )
  );
