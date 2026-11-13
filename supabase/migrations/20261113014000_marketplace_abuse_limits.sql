-- Enforce marketplace abuse caps at the database boundary.
-- The client cannot bypass these limits by calling Supabase REST/RPC directly.
BEGIN;

CREATE TABLE IF NOT EXISTS private.marketplace_action_rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('message', 'follow')),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (user_id, action)
);

ALTER TABLE private.marketplace_action_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.marketplace_action_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enforce_marketplace_insert_rate_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
  v_action text;
  v_limit integer;
  v_window interval := interval '1 hour';
  v_count integer;
BEGIN
  -- Trusted backend inserts are not charged against a buyer/seller's UI quota.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'marketplace_messages' THEN
    v_user_id := NEW.sender_id;
    v_action := 'message';
    v_limit := 30;
  ELSIF TG_TABLE_NAME = 'marketplace_store_subscriptions' THEN
    v_user_id := NEW.buyer_id;
    v_action := 'follow';
    v_limit := 20;
  ELSE
    RAISE EXCEPTION 'Unsupported marketplace rate-limit trigger';
  END IF;

  IF v_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only create marketplace activity for your own account';
  END IF;

  INSERT INTO private.marketplace_action_rate_limits AS limits
    (user_id, action, window_started_at, request_count)
  VALUES
    (v_user_id, v_action, now(), 1)
  ON CONFLICT (user_id, action) DO UPDATE
    SET window_started_at = CASE
          WHEN limits.window_started_at <= now() - v_window THEN now()
          ELSE limits.window_started_at
        END,
        request_count = CASE
          WHEN limits.window_started_at <= now() - v_window THEN 1
          ELSE limits.request_count + 1
        END
  RETURNING request_count INTO v_count;

  IF v_count > v_limit THEN
    IF v_action = 'message' THEN
      RAISE EXCEPTION 'You have sent too many messages. Please try again later';
    ELSE
      RAISE EXCEPTION 'You have followed too many shops recently. Please try again later';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_marketplace_insert_rate_limits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marketplace_messages_insert_rate_limit ON public.marketplace_messages;
CREATE TRIGGER marketplace_messages_insert_rate_limit
BEFORE INSERT ON public.marketplace_messages
FOR EACH ROW
EXECUTE FUNCTION private.enforce_marketplace_insert_rate_limits();

DROP TRIGGER IF EXISTS marketplace_store_subscriptions_insert_rate_limit ON public.marketplace_store_subscriptions;
CREATE TRIGGER marketplace_store_subscriptions_insert_rate_limit
BEFORE INSERT ON public.marketplace_store_subscriptions
FOR EACH ROW
EXECUTE FUNCTION private.enforce_marketplace_insert_rate_limits();

-- Serialize buyer/shop reservations and cap pending requests. This function
-- becomes SECURITY DEFINER so it can count pending rows across the shop while
-- returning only the newly-created reservation ID. All authorization checks
-- are explicit and are evaluated against auth.uid() from the caller's JWT.
CREATE OR REPLACE FUNCTION public.create_marketplace_reservation_v2(
  p_product_id uuid,
  p_quantity integer,
  p_buyer_note text,
  p_request_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_buyer_id uuid := auth.uid();
  v_owner_id uuid;
  v_product_name text;
  v_unit_price numeric;
  v_stock_status text;
  v_reservation_id uuid;
  v_buyer_pending integer;
  v_shop_pending integer;
BEGIN
  IF v_buyer_id IS NULL OR NOT public.is_marketplace_registered_user() THEN
    RAISE EXCEPTION 'Sign in with your Buybook account before making a reservation';
  END IF;
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'A reservation request key is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 1000';
  END IF;
  IF char_length(coalesce(p_buyer_note, '')) > 500 THEN
    RAISE EXCEPTION 'The reservation note must be 500 characters or fewer';
  END IF;

  -- Idempotent retry: return the original request before applying a new cap.
  SELECT r.id
    INTO v_reservation_id
    FROM public.marketplace_reservations AS r
   WHERE r.buyer_id = v_buyer_id
     AND r.request_key = p_request_key;
  IF FOUND THEN
    RETURN v_reservation_id;
  END IF;

  SELECT l.owner_id, l.name, l.price, l.stock_status
    INTO v_owner_id, v_product_name, v_unit_price, v_stock_status
    FROM public.marketplace_listings AS l
   WHERE l.product_id = p_product_id
     AND l.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This product is no longer available';
  END IF;
  IF lower(coalesce(v_stock_status, '')) = 'out_of_stock' THEN
    RAISE EXCEPTION 'This product is out of stock';
  END IF;
  IF v_owner_id = v_buyer_id THEN
    RAISE EXCEPTION 'You cannot reserve a product from your own shop';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.marketplace_store_subscriptions AS ss
      JOIN public.marketplace_shops AS s ON s.owner_id = ss.owner_id
     WHERE ss.owner_id = v_owner_id
       AND ss.buyer_id = v_buyer_id
       AND s.is_connected = true
       AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Follow this active shop before making a reservation';
  END IF;

  -- Buyer lock first, then shop lock. All calls use the same order so
  -- simultaneous reservations cannot overrun either cap.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marketplace-reservation-buyer:' || v_buyer_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marketplace-reservation-shop:' || v_owner_id::text, 0)
  );

  SELECT count(*)::integer
    INTO v_buyer_pending
    FROM public.marketplace_reservations AS r
   WHERE r.buyer_id = v_buyer_id
     AND r.status = 'pending'
     AND r.expires_at > now();

  IF v_buyer_pending >= 5 THEN
    RAISE EXCEPTION 'You already have 5 pending reservation requests. Wait for a shop to respond or cancel one before sending another';
  END IF;

  SELECT count(*)::integer
    INTO v_shop_pending
    FROM public.marketplace_reservations AS r
   WHERE r.owner_id = v_owner_id
     AND r.status = 'pending'
     AND r.expires_at > now();

  IF v_shop_pending >= 3 THEN
    RAISE EXCEPTION 'This shop already has 3 pending reservation requests. Please try again after the seller responds';
  END IF;

  INSERT INTO public.marketplace_reservations
    (buyer_id, owner_id, status, buyer_note, request_key)
  VALUES
    (v_buyer_id, v_owner_id, 'pending', left(coalesce(p_buyer_note, ''), 500), p_request_key)
  ON CONFLICT (buyer_id, request_key) WHERE request_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_reservation_id;

  IF v_reservation_id IS NULL THEN
    SELECT r.id
      INTO v_reservation_id
      FROM public.marketplace_reservations AS r
     WHERE r.buyer_id = v_buyer_id
       AND r.request_key = p_request_key;
    IF v_reservation_id IS NULL THEN
      RAISE EXCEPTION 'The reservation could not be confirmed. Please retry';
    END IF;
    RETURN v_reservation_id;
  END IF;

  INSERT INTO public.marketplace_reservation_items
    (reservation_id, product_id, product_name, unit_price, quantity)
  VALUES
    (v_reservation_id, p_product_id, v_product_name, v_unit_price, p_quantity);

  RETURN v_reservation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_marketplace_reservation_v2(uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_marketplace_reservation_v2(uuid, integer, text, uuid) TO authenticated;

COMMIT;
