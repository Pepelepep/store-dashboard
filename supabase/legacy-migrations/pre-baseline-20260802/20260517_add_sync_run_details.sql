alter table public.sync_runs
add column if not exists details jsonb;