-- This trigger only references schema-qualified objects, so it does not need public in its search path.
CREATE OR REPLACE FUNCTION public.notify_marketplace_reservation_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_owner_id uuid;
  v_buyer_id uuid;
BEGIN
  SELECT r.owner_id, r.buyer_id
    INTO v_owner_id, v_buyer_id
  FROM public.marketplace_reservations r
  WHERE r.id = NEW.reservation_id;

  IF v_owner_id IS NOT NULL AND v_buyer_id IS NOT NULL THEN
    INSERT INTO public.app_notifications
      (created_by, recipient_id, kind, title, body)
    VALUES
      (
        v_buyer_id,
        v_owner_id,
        'reservation',
        'New product reservation',
        'A buyer reserved ' || COALESCE(NEW.product_name, 'a product') ||
        ' (quantity: ' || NEW.quantity::text || '). Open Sellbook → Connect to Buybook to review it.'
      );
  END IF;

  RETURN NEW;
END;
$function$;
