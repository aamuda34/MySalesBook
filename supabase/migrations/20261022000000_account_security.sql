-- My Sales Book account security hardening.
-- This migration assumes the existing sales-book schema and sale RPCs are present.
-- No business records are deleted or rewritten by this migration.

REVOKE EXECUTE ON FUNCTION public.record_sale(uuid, integer, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale(uuid, integer, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamptz) TO authenticated;

-- This is an event-trigger helper, not an application API.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must sign in before deleting your account.';
  END IF;

  -- Remove the user's private product photos first. The business tables
  -- reference auth.users with ON DELETE CASCADE.
  DELETE FROM storage.objects
  WHERE bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = v_user_id::text;

  DELETE FROM auth.users WHERE id = v_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
