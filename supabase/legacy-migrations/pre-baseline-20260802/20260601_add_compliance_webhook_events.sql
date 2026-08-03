CREATE TABLE IF NOT EXISTS public.compliance_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    topic text NOT NULL,
    status text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT compliance_webhook_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS compliance_webhook_events_shop_received_idx
    ON public.compliance_webhook_events USING btree (shop_domain, received_at DESC);

CREATE INDEX IF NOT EXISTS compliance_webhook_events_topic_status_idx
    ON public.compliance_webhook_events USING btree (topic, status, received_at DESC);
