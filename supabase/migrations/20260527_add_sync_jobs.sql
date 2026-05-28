create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  job_type text not null check (
    job_type in ('locations', 'products', 'inventory', 'orders', 'full')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'success', 'error', 'cancelled')
  ),
  current_step text,
  progress jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  error_message text,
  details jsonb,
  locked_by text,
  locked_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sync_jobs_shop_status_idx
  on public.sync_jobs (shop_domain, status, updated_at desc);

create index if not exists sync_jobs_shop_type_status_idx
  on public.sync_jobs (shop_domain, job_type, status, updated_at desc);

create index if not exists sync_jobs_worker_claim_idx
  on public.sync_jobs (status, locked_at, updated_at)
  where status in ('pending', 'running');

create unique index if not exists sync_jobs_one_active_per_shop_type_idx
  on public.sync_jobs (shop_domain, job_type)
  where status in ('pending', 'running');
