-- Close broad Data API privileges and protect private shop-pin columns.
-- Public catalogue fields remain available through a deliberately narrow view.
BEGIN;

-- TRUNCATE bypasses RLS. Browser roles must never be able to truncate app tables.
REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- Keep the same least-privilege rule for tables created by either project owner.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- Remove table-wide and any pre-existing column-level reads on shop records.
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

-- Browser clients can read only catalogue-safe columns from the base table.
-- Exact address, coordinates, location accuracy, confirmation metadata and
-- storage paths are never directly selectable through the Data API.
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

-- Stable public catalogue projection. security_invoker ensures the underlying
-- marketplace_shops RLS policy and the caller's narrow column grants apply.
CREATE OR REPLACE VIEW public.marketplace_shops_public
WITH (security_invoker = true, security_barrier = true) AS
SELECT
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
FROM public.marketplace_shops
WHERE is_connected IS TRUE
  AND is_active IS TRUE
  AND shop_front_image_url IS NOT NULL;

REVOKE ALL ON TABLE public.marketplace_shops_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.marketplace_shops_public TO anon, authenticated;

-- The seller's private shop setup remains readable, but only through an
-- owner-scoped SECURITY DEFINER RPC rather than a broad browser SELECT grant.
CREATE OR REPLACE FUNCTION public.get_my_marketplace_shop()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_shop jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_marketplace_registered_user() THEN
    RAISE EXCEPTION 'Sign in to view your Buybook shop settings';
  END IF;

  SELECT to_jsonb(s)
    INTO v_shop
    FROM public.marketplace_shops AS s
   WHERE s.owner_id = v_user_id;

  RETURN v_shop;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_marketplace_shop() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_marketplace_shop() TO authenticated;

-- Route destinations are revealed only when a signed-in or CAPTCHA-created
-- anonymous Buybook session explicitly opens the Locate seller flow or starts
-- optional live sharing. This does not expose coordinates in catalogue reads.
CREATE TABLE IF NOT EXISTS private.marketplace_route_target_limits (
  buyer_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0 AND request_count <= 41)
);

ALTER TABLE private.marketplace_route_target_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.marketplace_route_target_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_marketplace_shop_route_target(p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_buyer_id uuid := auth.uid();
  v_request_count integer;
  v_shop jsonb;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Open Buybook before requesting shop directions';
  END IF;
  IF p_owner_id IS NULL OR p_owner_id = v_buyer_id THEN
    RAISE EXCEPTION 'Choose a different shop';
  END IF;

  INSERT INTO private.marketplace_route_target_limits AS limits
    (buyer_id, window_started_at, request_count)
  VALUES
    (v_buyer_id, now(), 1)
  ON CONFLICT (buyer_id) DO UPDATE
    SET window_started_at = CASE
          WHEN limits.window_started_at <= now() - interval '1 hour' THEN now()
          ELSE limits.window_started_at
        END,
        request_count = CASE
          WHEN limits.window_started_at <= now() - interval '1 hour' THEN 1
          ELSE LEAST(limits.request_count + 1, 41)
        END
  RETURNING request_count INTO v_request_count;

  IF v_request_count > 40 THEN
    RAISE EXCEPTION 'Too many shop-location requests. Please try again later';
  END IF;

  SELECT jsonb_build_object(
    'owner_id', s.owner_id,
    'name', s.name,
    'address', s.address,
    'latitude', s.latitude,
    'longitude', s.longitude,
    'location_accuracy_m', s.location_accuracy_m,
    'location_captured_at', s.location_captured_at,
    'location_confirmed_at', s.location_confirmed_at,
    'location_source', s.location_source,
    'is_connected', s.is_connected,
    'is_active', s.is_active
  )
    INTO v_shop
    FROM public.marketplace_shops AS s
   WHERE s.owner_id = p_owner_id
     AND s.is_connected IS TRUE
     AND s.is_active IS TRUE;

  RETURN v_shop;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_marketplace_shop_route_target(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketplace_shop_route_target(uuid) TO authenticated;

-- Use an empty search path for this public reservation RPC as well; all
-- application objects it references are already schema-qualified.
ALTER FUNCTION public.create_marketplace_reservation_v2(uuid, integer, text, uuid)
  SET search_path = '';

COMMIT;
