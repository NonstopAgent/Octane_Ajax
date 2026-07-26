-- Autopilot overlap lease (2026-07-25 audit, M3).
--
-- Replaces the old guard: "has an `autopilot_started` event landed in the last
-- 8 minutes?" against the append-only factory_events table. That guard was
-- shorter than the pass it protected (maxDuration = 800s), was check-then-act
-- with a network round trip between the SELECT and the INSERT, and was never
-- released — so a 90-second pass still blocked the next one for 6½ minutes.
--
-- One row per (user, lock_key). Acquire is a single atomic statement:
--   update autopilot_locks set locked_until = now() + interval '15 minutes'
--    where user_id = $1 and lock_key = $2 and locked_until < now()
--   returning lock_key;
-- Postgres serialises concurrent UPDATEs on the row and re-evaluates the WHERE
-- against the committed version, so exactly one caller sees a returned row.
-- Released in a `finally`; a crashed pass frees the slot when the lease lapses.
-- Apply to production via Supabase MCP (mirrors prior migrations).

create table if not exists public.autopilot_locks (
  user_id uuid not null references auth.users (id) on delete cascade,
  lock_key text not null,
  -- Seeded in the past so a brand-new row is immediately claimable.
  locked_until timestamptz not null default to_timestamp(0),
  locked_at timestamptz,
  holder text,
  created_at timestamptz not null default now(),
  primary key (user_id, lock_key)
);

alter table public.autopilot_locks enable row level security;

-- The operator's own passes run on either the service client (cron) or their
-- session client (manual /api/ajax/run-autopilot), so the owner needs select /
-- insert / update. Delete is nobody's: dropping a lock row is never part of
-- normal operation and would erase an active lease.
create policy "autopilot_locks_select_own"
  on public.autopilot_locks for select
  to authenticated using (auth.uid() = user_id);
create policy "autopilot_locks_insert_own"
  on public.autopilot_locks for insert
  to authenticated with check (auth.uid() = user_id);
create policy "autopilot_locks_update_own"
  on public.autopilot_locks for update
  to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
