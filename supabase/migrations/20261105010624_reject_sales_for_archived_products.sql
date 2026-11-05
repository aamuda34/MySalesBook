-- Enforce product archive state for every sale path, including legacy and offline RPCs.
-- The row lock serializes sale inserts with concurrent archive/restore updates.
CREATE OR REPLACE FUNCTION public.reject_sale_for_archived_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_archived_at timestamptz;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.archived_at
    INTO v_archived_at
  FROM public.products p
  WHERE p.id = NEW.product_id
    AND p.user_id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The product for this sale is no longer available in this account.';
  END IF;

  IF v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This product is archived and cannot be sold. Restore it before recording a new sale.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sales_reject_archived_product ON public.sales;
CREATE TRIGGER sales_reject_archived_product
BEFORE INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.reject_sale_for_archived_product();
