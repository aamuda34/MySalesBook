-- Trigger-only function: callers must not be able to invoke it through PostgREST RPC.
-- PostgreSQL checks this privilege when the trigger is created; revoking client EXECUTE
-- does not stop the already-installed trigger from running on sales inserts.
REVOKE ALL ON FUNCTION public.reject_sale_for_archived_product() FROM PUBLIC, anon, authenticated;