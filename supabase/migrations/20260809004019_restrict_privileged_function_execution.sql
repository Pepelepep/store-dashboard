-- These SECURITY DEFINER functions are backend-only. PostgreSQL grants
-- EXECUTE to PUBLIC for new functions unless it is explicitly revoked, which
-- would otherwise expose privileged cross-shop reads/writes through PostgREST.

REVOKE ALL ON FUNCTION public.claim_webhook_events(integer, integer, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_data_quality_report(text, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_order_line_cogs_for_inventory_items(text, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_variant_costs_from_inventory_items(text, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_variant_costs_from_inventory_items_for_shop(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_webhook_events(integer, integer, interval)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_data_quality_report(text, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_order_line_cogs_for_inventory_items(text, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_variant_costs_from_inventory_items(text, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_variant_costs_from_inventory_items_for_shop(text)
  TO service_role;
