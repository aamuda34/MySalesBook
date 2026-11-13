-- Verify the one-shot PIN grant before account deletion begins removing media.
-- The existing delete_my_account() RPC remains responsible for consuming the grant
-- and deleting auth.users after the storage cleanup succeeds.
CREATE OR REPLACE FUNCTION public.assert_account_deletion_authorized()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt() ->> 'session_id';
  v_session_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_session_text IS NULL
     OR v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  v_session_id := v_session_text::uuid;

  IF NOT private.is_sellbook_pin_verified() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM private.sellbook_security_action_grants AS g
     WHERE g.user_id = v_user_id
       AND g.session_id = v_session_id
       AND g.action = 'delete_account'
       AND g.expires_at > pg_catalog.now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_account_deletion_authorized() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_account_deletion_authorized() TO authenticated;
