-- Buybook reservation reliability: idempotent creation, stock validation and buyer cancellation.
-- Additive migration. Existing Sellbook reservation screens and stored rows remain compatible.

ALTER TABLE public.marketplace_reservations
  ADD COLUMN IF NOT EXISTS request_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reservations_buyer_request_key_uidx
  ON public.marketplace_reservations (buyer_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_marketplace_reservation_v2(
  p_product_id uuid,
  p_quantity integer,
  p_buyer_note text,
  p_request_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_buyer_id uuid := auth.uid();
  v_owner_id uuid;
  v_product_name text;
  v_unit_price numeric;
  v_stock_status text;
  v_reservation_id uuid;
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

  -- Repeated submission with the same key returns the original reservation.
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
$$;

REVOKE ALL ON FUNCTION public.create_marketplace_reservation_v2(uuid, integer, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_marketplace_reservation_v2(uuid, integer, text, uuid)
  TO authenticated;

-- Keep older Buybook clients safe during rollout: the legacy RPC delegates to
-- the same validated/idempotent implementation with a one-time request key.
CREATE OR REPLACE FUNCTION public.create_marketplace_reservation(
  p_product_id uuid,
  p_quantity integer,
  p_buyer_note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $
BEGIN
  RETURN public.create_marketplace_reservation_v2(
    p_product_id,
    p_quantity,
    p_buyer_note,
    gen_random_uuid()
  );
END;
$;

REVOKE ALL ON FUNCTION public.create_marketplace_reservation(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_marketplace_reservation(uuid, integer, text)
  TO authenticated;

-- Direct table writes must not bypass the same out-of-stock rule as the RPC.
DROP POLICY IF EXISTS marketplace_reservation_items_buyer_insert
  ON public.marketplace_reservation_items;

CREATE POLICY marketplace_reservation_items_buyer_insert
ON public.marketplace_reservation_items
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT public.is_marketplace_registered_user())
  AND EXISTS (
    SELECT 1
      FROM public.marketplace_reservations AS r
      JOIN public.marketplace_listings AS l
        ON l.product_id = marketplace_reservation_items.product_id
       AND l.owner_id = r.owner_id
       AND l.is_active = true
       AND lower(coalesce(l.stock_status, '')) <> 'out_of_stock'
     WHERE r.id = marketplace_reservation_items.reservation_id
       AND r.buyer_id = (SELECT auth.uid())
  )
);

-- Buyers may change a reservation only from pending to cancelled.
DROP POLICY IF EXISTS marketplace_reservations_buyer_cancel
  ON public.marketplace_reservations;

CREATE POLICY marketplace_reservations_buyer_cancel
ON public.marketplace_reservations
FOR UPDATE
TO authenticated
USING (
  buyer_id = (SELECT auth.uid())
  AND status = 'pending'
  AND expires_at > now()
)
WITH CHECK (
  buyer_id = (SELECT auth.uid())
  AND status = 'cancelled'
);

CREATE OR REPLACE FUNCTION public.cancel_marketplace_reservation(p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cancelled_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_marketplace_registered_user() THEN
    RAISE EXCEPTION 'Sign in with your Buybook account before cancelling a reservation';
  END IF;
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'A reservation reference is required';
  END IF;

  UPDATE public.marketplace_reservations
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = p_reservation_id
     AND buyer_id = auth.uid()
     AND status = 'pending'
     AND expires_at > now()
  RETURNING id INTO v_cancelled_id;

  IF v_cancelled_id IS NULL THEN
    RAISE EXCEPTION 'This reservation can no longer be cancelled';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_marketplace_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_marketplace_reservation(uuid) TO authenticated;

-- Notify the selected shop when a buyer cancels a still-pending reservation.
CREATE OR REPLACE FUNCTION public.notify_marketplace_reservation_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    INSERT INTO public.app_notifications
      (created_by, recipient_id, reservation_id, kind, title, body)
    VALUES
      (
        NEW.buyer_id,
        NEW.owner_id,
        NEW.id,
        'update',
        'Reservation cancelled',
        'A buyer has cancelled a pending reservation. Open Sellbook → Connect to Buybook to review it.'
      )
    ON CONFLICT (reservation_id, kind) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_marketplace_reservation_cancellation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_marketplace_reservation_cancellation_after_update
  ON public.marketplace_reservations;

CREATE TRIGGER notify_marketplace_reservation_cancellation_after_update
AFTER UPDATE OF status ON public.marketplace_reservations
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notify_marketplace_reservation_cancellation();
