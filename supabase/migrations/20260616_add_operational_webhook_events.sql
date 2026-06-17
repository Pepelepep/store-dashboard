CREATE TABLE IF NOT EXISTS public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    topic text NOT NULL,
    shopify_webhook_id text,
    resource_gid text,
    parent_resource_gid text,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_started_at timestamp with time zone,
    processed_at timestamp with time zone,
    CONSTRAINT webhook_events_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_events_status_check CHECK (
        status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text])
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_shop_webhook_id_uidx
    ON public.webhook_events USING btree (shop_domain, shopify_webhook_id)
    WHERE shopify_webhook_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_events_status_available_received_idx
    ON public.webhook_events USING btree (status, available_at, received_at);

CREATE INDEX IF NOT EXISTS webhook_events_shop_topic_received_idx
    ON public.webhook_events USING btree (shop_domain, topic, received_at DESC);

CREATE OR REPLACE FUNCTION public.claim_webhook_events(
    p_batch_size integer DEFAULT 25,
    p_max_attempts integer DEFAULT 5,
    p_stale_after interval DEFAULT '15 minutes'::interval
)
RETURNS SETOF public.webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT id
        FROM public.webhook_events
        WHERE attempt_count < p_max_attempts
            AND (
                (status IN ('pending', 'error') AND available_at <= now())
                OR (
                    status = 'processing'
                    AND processing_started_at IS NOT NULL
                    AND processing_started_at < now() - p_stale_after
                )
            )
        ORDER BY available_at ASC, received_at ASC
        LIMIT GREATEST(p_batch_size, 0)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.webhook_events AS event
    SET
        status = 'processing',
        processing_started_at = now(),
        processed_at = NULL
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.*;
END;
$$;
