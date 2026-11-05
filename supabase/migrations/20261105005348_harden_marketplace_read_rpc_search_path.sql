-- Narrow the SECURITY DEFINER function's search path to prevent object shadowing.
-- All referenced objects are explicitly schema-qualified; participant checks are unchanged.
CREATE OR REPLACE FUNCTION public.mark_marketplace_conversation_read(
  p_owner_id uuid,
  p_buyer_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_user IS NULL OR (v_user <> p_owner_id AND v_user <> p_buyer_id) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation';
  END IF;

  UPDATE public.marketplace_messages
  SET read_at = pg_catalog.now()
  WHERE owner_id = p_owner_id
    AND buyer_id = p_buyer_id
    AND sender_id <> v_user
    AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
