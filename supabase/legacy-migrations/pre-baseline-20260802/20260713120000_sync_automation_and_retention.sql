DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.sync_jobs'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%job_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.sync_jobs DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.sync_jobs
  ADD CONSTRAINT sync_jobs_job_type_check
  CHECK (job_type IN (
    'locations', 'products', 'inventory', 'orders',
    'orders_reconciliation_48h', 'financial_backfill_30d',
    'full', 'full_refresh'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_one_active_full_operation_per_shop_idx
  ON public.sync_jobs (shop_domain)
  WHERE status IN ('pending', 'running')
    AND job_type IN ('full', 'full_refresh');

CREATE TABLE IF NOT EXISTS public.sync_automation_state (
  shop_domain text PRIMARY KEY,
  last_reconciliation_started_at timestamptz,
  last_reconciliation_succeeded_at timestamptz,
  next_reconciliation_due_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sync_automation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_automation_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sync_automation_state TO service_role;

CREATE INDEX IF NOT EXISTS sync_jobs_terminal_finished_idx
  ON public.sync_jobs (status, finished_at)
  WHERE status IN ('success', 'error', 'cancelled');

CREATE INDEX IF NOT EXISTS sync_runs_status_finished_idx
  ON public.sync_runs (status, finished_at);

CREATE OR REPLACE FUNCTION public.cleanup_operational_sync_history(
  p_batch_size integer DEFAULT 500
)
RETURNS TABLE(sync_jobs_deleted integer, sync_runs_deleted integer, webhook_events_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_batch_size, 500), 1), 2000);
BEGIN
  WITH deleted AS (
    DELETE FROM public.sync_jobs
    WHERE id IN (
      SELECT id FROM public.sync_jobs
      WHERE (
        (status = 'success' AND finished_at < now() - interval '30 days')
        OR (status = 'cancelled' AND finished_at < now() - interval '90 days')
      )
      ORDER BY finished_at ASC
      LIMIT v_limit
    )
    RETURNING 1
  ) SELECT count(*)::integer INTO sync_jobs_deleted FROM deleted;

  WITH deleted AS (
    DELETE FROM public.sync_runs
    WHERE id IN (
      SELECT id FROM public.sync_runs
      WHERE (
        (status = 'success' AND finished_at < now() - interval '30 days')
        OR (status = 'error' AND finished_at < now() - interval '90 days')
      )
      ORDER BY finished_at ASC
      LIMIT v_limit
    )
    RETURNING 1
  ) SELECT count(*)::integer INTO sync_runs_deleted FROM deleted;

  WITH deleted AS (
    DELETE FROM public.webhook_events
    WHERE id IN (
      SELECT id FROM public.webhook_events
      WHERE status = 'done'
        AND processed_at < now() - interval '30 days'
      ORDER BY processed_at ASC
      LIMIT v_limit
    )
    RETURNING 1
  ) SELECT count(*)::integer INTO webhook_events_deleted FROM deleted;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_operational_sync_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_operational_sync_history(integer) TO service_role;
