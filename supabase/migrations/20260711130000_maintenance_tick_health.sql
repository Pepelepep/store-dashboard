CREATE TABLE IF NOT EXISTS public.maintenance_tick_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_tick_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_tick_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.maintenance_tick_state TO service_role;
