-- Keep the marketplace guest/registered-user gate reproducible in source,
-- and require a verified PIN for every administrator-only RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_marketplace_registered_user()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true';
$function$;

REVOKE ALL ON FUNCTION public.is_marketplace_registered_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_marketplace_registered_user() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_sellbook_pin_verified()
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

  -- Admin capabilities always require a PIN enrolment. The legacy no-PIN
  -- compatibility remains available only to non-admin accounts during rollout.
  IF EXISTS (
    SELECT 1
      FROM private.sellbook_admins AS a
     WHERE a.user_id = v_user_id
  ) AND NOT EXISTS (
    SELECT 1
      FROM private.user_app_pins AS p
     WHERE p.user_id = v_user_id
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM private.user_app_pins AS p
     WHERE p.user_id = v_user_id
  ) THEN
    RETURN true;
  END IF;

  IF v_session_text IS NULL
     OR v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  v_session_id := v_session_text::uuid;
  RETURN EXISTS (
    SELECT 1
      FROM private.user_app_pin_sessions AS s
     WHERE s.user_id = v_user_id
       AND s.session_id = v_session_id
       AND s.expires_at > now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.is_sellbook_pin_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_sellbook_pin_verified() TO authenticated;

COMMIT;
