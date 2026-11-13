-- Apply only after the new Sellbook and Buybook clients are deployed.
-- Existing live clients still read private shop fields directly, so this is
-- the final enforcement step in the staged rollout.
BEGIN;

REVOKE SELECT ON TABLE public.marketplace_shops FROM anon, authenticated;
DO $revoke_shop_columns$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketplace_shops'
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I) ON TABLE public.marketplace_shops FROM anon, authenticated',
      item.column_name
    );
  END LOOP;
END
$revoke_shop_columns$;

GRANT SELECT (
  owner_id,
  name,
  description,
  phone,
  city,
  state,
  country,
  shop_front_image_url,
  is_connected,
  is_active
) ON TABLE public.marketplace_shops TO anon, authenticated;

COMMIT;
