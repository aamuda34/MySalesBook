CREATE OR REPLACE FUNCTION public.create_marketplace_reservation(
  p_product_id uuid,
  p_quantity integer,
  p_buyer_note text DEFAULT ''
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
  v_reservation_id uuid;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before making a reservation';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 1000';
  END IF;
  SELECT l.owner_id, l.name, l.price
    INTO v_owner_id, v_product_name, v_unit_price
    FROM public.marketplace_listings AS l
   WHERE l.product_id = p_product_id
     AND l.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This product is no longer available';
  END IF;
  INSERT INTO public.marketplace_reservations (buyer_id, owner_id, status, buyer_note)
  VALUES (v_buyer_id, v_owner_id, 'pending', left(coalesce(p_buyer_note, ''), 500))
  RETURNING id INTO v_reservation_id;
  INSERT INTO public.marketplace_reservation_items
    (reservation_id, product_id, product_name, unit_price, quantity)
  VALUES
    (v_reservation_id, p_product_id, v_product_name, v_unit_price, p_quantity);
  RETURN v_reservation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_marketplace_reservation(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_marketplace_reservation(uuid, integer, text) TO authenticated;