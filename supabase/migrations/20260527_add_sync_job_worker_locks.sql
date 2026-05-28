alter table public.sync_jobs
  add column if not exists locked_by text,
  add column if not exists locked_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists last_heartbeat_at timestamptz;

create index if not exists sync_jobs_worker_claim_idx
  on public.sync_jobs (status, locked_at, updated_at)
  where status in ('pending', 'running');
