-- Preserve discontinued products and their business history without exposing them for new sales.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_marketplace_listing_from_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_shop public.marketplace_shops%rowtype;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.marketplace_listings WHERE product_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT * INTO v_shop
  FROM public.marketplace_shops
  WHERE owner_id = NEW.user_id;

  IF FOUND AND v_shop.is_connected AND v_shop.is_active THEN
    INSERT INTO public.marketplace_listings
      (product_id,owner_id,shop_name,name,category,price,currency,unit,stock_status,is_active,updated_at)
    VALUES
      (
        NEW.id,NEW.user_id,COALESCE(NULLIF(v_shop.name,''),''),
        NEW.name,COALESCE(NEW.category,'Uncategorized'),
        NEW.selling_price,'NGN',COALESCE(NEW.base_unit,'unit'),
        CASE WHEN NEW.stock<=0 THEN 'out_of_stock'
             WHEN NEW.stock<=5 THEN 'low_stock'
             ELSE 'available' END,
        NEW.archived_at IS NULL,pg_catalog.now()
      )
    ON CONFLICT(product_id) DO UPDATE SET
      owner_id=EXCLUDED.owner_id,
      shop_name=EXCLUDED.shop_name,
      name=EXCLUDED.name,
      category=EXCLUDED.category,
      price=EXCLUDED.price,
      currency=EXCLUDED.currency,
      unit=EXCLUDED.unit,
      stock_status=EXCLUDED.stock_status,
      is_active=EXCLUDED.is_active,
      updated_at=pg_catalog.now();
  ELSE
    DELETE FROM public.marketplace_listings WHERE product_id=NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS products_sync_marketplace_listing ON public.products;
CREATE TRIGGER products_sync_marketplace_listing
AFTER INSERT OR DELETE OR UPDATE OF
  name,selling_price,stock,category,base_unit,user_id,archived_at
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_marketplace_listing_from_product();

CREATE OR REPLACE FUNCTION public.sync_owner_marketplace_listings(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_shop public.marketplace_shops%rowtype;
  p record;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_owner_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT private.is_sellbook_pin_verified() THEN
    RAISE EXCEPTION 'Verify your Sellbook security PIN first';
  END IF;

  SELECT * INTO v_shop
  FROM public.marketplace_shops
  WHERE owner_id=p_owner_id;

  IF NOT FOUND OR NOT v_shop.is_connected OR NOT v_shop.is_active THEN
    DELETE FROM public.marketplace_listings
    WHERE owner_id=p_owner_id;
    RETURN;
  END IF;

  UPDATE public.marketplace_listings
  SET shop_name=v_shop.name,updated_at=pg_catalog.now()
  WHERE owner_id=p_owner_id;

  -- Keep archived listing rows for history/reservation references, but never show them to buyers.
  UPDATE public.marketplace_listings ml
  SET is_active=false,updated_at=pg_catalog.now()
  WHERE ml.owner_id=p_owner_id
    AND EXISTS (
      SELECT 1 FROM public.products archived
      WHERE archived.id=ml.product_id
        AND archived.user_id=p_owner_id
        AND archived.archived_at IS NOT NULL
    );

  FOR p IN
    SELECT * FROM public.products
    WHERE user_id=p_owner_id AND archived_at IS NULL
  LOOP
    INSERT INTO public.marketplace_listings
      (product_id,owner_id,shop_name,name,category,price,currency,unit,stock_status,is_active,updated_at)
    VALUES
      (
        p.id,p_owner_id,v_shop.name,p.name,
        COALESCE(p.category,'Uncategorized'),p.selling_price,'NGN',
        COALESCE(p.base_unit,'unit'),
        CASE WHEN p.stock<=0 THEN 'out_of_stock'
             WHEN p.stock<=5 THEN 'low_stock'
             ELSE 'available' END,
        true,pg_catalog.now()
      )
    ON CONFLICT(product_id) DO UPDATE SET
      shop_name=EXCLUDED.shop_name,
      name=EXCLUDED.name,
      category=EXCLUDED.category,
      price=EXCLUDED.price,
      currency=EXCLUDED.currency,
      unit=EXCLUDED.unit,
      stock_status=EXCLUDED.stock_status,
      is_active=true,
      updated_at=pg_catalog.now();
  END LOOP;
END;
$function$;
