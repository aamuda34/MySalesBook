REVOKE EXECUTE ON FUNCTION public.record_sale(uuid, integer, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale(uuid, integer, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamptz) TO authenticated;

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
  -- Business tables cascade on auth.users deletion. Product files are removed
  -- through the Storage API before this function is called.
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;