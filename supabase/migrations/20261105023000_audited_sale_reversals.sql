-- Audited sale corrections. Original sale rows are retained; a reversal marks
-- the complete sale transaction and optionally restores the sold stock atomically.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS stock_returned boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_reversal_reason_length_check;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_reversal_reason_length_check
  CHECK (reversal_reason IS NULL OR char_length(reversal_reason) BETWEEN 3 AND 200);

CREATE OR REPLACE FUNCTION public.reverse_sale_transaction(
  p_transaction_id uuid,
  p_reason text,
  p_return_to_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_now timestamptz := pg_catalog.now();
  v_sale_count integer := 0;
  v_updated_count integer := 0;
  v_adjustment_count integer := 0;
  v_line record;
  v_product public.products%rowtype;
  v_new_stock bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before correcting a sale.';
  END IF;
  IF NOT private.is_sellbook_pin_verified() THEN
    RAISE EXCEPTION 'Verify your Sellbook security PIN before correcting a sale.';
  END IF;
  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'This sale is missing its reference. Refresh Sales history and try again.';
  END IF;
  IF pg_catalog.char_length(v_reason) < 3 OR pg_catalog.char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'Enter a reason between 3 and 200 characters.';
  END IF;

  -- Serialize two correction attempts for the same receipt. Keep this lock
  -- separate from the product-row locks used by normal sale recording.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_transaction_id::text, 0)
  );

  PERFORM 1
  FROM public.sales s
  WHERE s.user_id = v_user_id
    AND COALESCE(s.transaction_id, s.id) = p_transaction_id
  ORDER BY s.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This sale could not be found in your account. Refresh Sales history.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.user_id = v_user_id
      AND COALESCE(s.transaction_id, s.id) = p_transaction_id
      AND s.reversed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This sale has already been reversed.';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_sale_count
  FROM public.sales s
  WHERE s.user_id = v_user_id
    AND COALESCE(s.transaction_id, s.id) = p_transaction_id;

  IF p_return_to_stock THEN
    IF EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.user_id = v_user_id
        AND COALESCE(s.transaction_id, s.id) = p_transaction_id
        AND s.product_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Some products in this sale no longer exist. Reverse the sale without returning stock, or review the product records first.';
    END IF;

    FOR v_line IN
      SELECT
        s.product_id,
        pg_catalog.max(s.product_name) AS product_name,
        pg_catalog.sum(
          COALESCE(s.base_quantity, s.quantity * COALESCE(s.units_per_sale, 1))::bigint
        )::bigint AS returned_quantity
      FROM public.sales s
      WHERE s.user_id = v_user_id
        AND COALESCE(s.transaction_id, s.id) = p_transaction_id
      GROUP BY s.product_id
      ORDER BY s.product_id
    LOOP
      SELECT *
      INTO v_product
      FROM public.products p
      WHERE p.id = v_line.product_id
        AND p.user_id = v_user_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A product from this sale is no longer available in your account. No stock was changed.';
      END IF;

      IF v_line.returned_quantity < 1 OR v_line.returned_quantity > 2000000000 THEN
        RAISE EXCEPTION 'The quantity to return is outside the supported stock limit.';
      END IF;

      v_new_stock := v_product.stock::bigint + v_line.returned_quantity;
      IF v_new_stock > 2000000000 THEN
        RAISE EXCEPTION 'Returning these items would exceed the stock limit for %.', v_product.name;
      END IF;

      UPDATE public.products
      SET stock = v_new_stock::integer,
          updated_at = v_now
      WHERE id = v_product.id
        AND user_id = v_user_id;

      INSERT INTO public.stock_adjustments (
        id, user_id, product_id, product_name,
        previous_stock, new_stock, quantity_change, reason, adjusted_at
      ) VALUES (
        pg_catalog.gen_random_uuid(), v_user_id, v_product.id, v_product.name,
        v_product.stock, v_new_stock::integer, v_line.returned_quantity::integer,
        'Sale return: ' || v_reason || ' · Receipt ' || p_transaction_id::text,
        v_now
      );
      v_adjustment_count := v_adjustment_count + 1;
    END LOOP;
  END IF;

  UPDATE public.sales s
  SET reversed_at = v_now,
      reversal_reason = v_reason,
      stock_returned = COALESCE(p_return_to_stock, false)
  WHERE s.user_id = v_user_id
    AND COALESCE(s.transaction_id, s.id) = p_transaction_id
    AND s.reversed_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_sale_count THEN
    RAISE EXCEPTION 'The sale changed while it was being corrected. No changes were saved. Refresh and try again.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'transaction_id', p_transaction_id,
    'reversed_lines', v_updated_count,
    'stock_adjustments', v_adjustment_count,
    'stock_returned', COALESCE(p_return_to_stock, false),
    'reversed_at', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_sale_transaction(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_sale_transaction(uuid, text, boolean)
  TO authenticated;
