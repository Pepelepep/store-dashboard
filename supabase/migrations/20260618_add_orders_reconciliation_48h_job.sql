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
  CHECK (
    job_type IN (
      'locations',
      'products',
      'inventory',
      'orders',
      'orders_reconciliation_48h',
      'full'
    )
  );

DO $$
DECLARE
  constraint_name text;
  has_sync_type_check boolean := false;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.sync_runs'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%sync_type%'
  LOOP
    has_sync_type_check := true;
    EXECUTE format('ALTER TABLE public.sync_runs DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF has_sync_type_check THEN
    ALTER TABLE public.sync_runs
      ADD CONSTRAINT sync_runs_sync_type_check
      CHECK (
        sync_type IN (
          'locations',
          'products',
          'inventory',
          'orders',
          'orders_reconciliation_48h',
          'staff_members',
          'full'
        )
      );
  END IF;
END $$;
