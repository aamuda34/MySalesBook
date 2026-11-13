-- Bind shop-front approval to the exact Storage object, cap AI verification,
-- and ensure reservation status notifications become unread new events.
BEGIN;

ALTER TABLE private.buybook_shop_front_verifications
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;

UPDATE private.buybook_shop_front_verifications AS v
SET storage_object_id = o.id,
    updated_at = now()
FROM storage.objects AS o
WHERE v.storage_object_id IS NULL
  AND o.bucket_id = 'marketplace-shop-fronts'
  AND o.name = v.storage_path
  AND o.owner_id = v.user_id::text
  AND o.is_delete_marker = false
  AND o.archived_at IS NULL;

DO $backfill_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.buybook_shop_front_verifications
    WHERE status = 'approved'
      AND (verified_at IS NULL OR storage_object_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'An approved shop-front photo could not be bound to its current Storage object. Re-verify the affected photo before applying this migration.';
  END IF;
END
$backfill_guard$;

CREATE TABLE IF NOT EXISTS private.buybook_shop_front_check_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_day date NOT NULL,
  attempt_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buybook_shop_front_check_attempts_nonnegative CHECK (attempt_count >= 0)
);

ALTER TABLE private.buybook_shop_front_check_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.buybook_shop_front_check_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_buybook_shop_front_check(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_attempt_count bigint;
  v_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User is required';
  END IF;

  INSERT INTO private.buybook_shop_front_check_limits
    (user_id, window_day, attempt_count, updated_at)
  VALUES (p_user_id, v_day, 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET window_day = EXCLUDED.window_day,
        attempt_count = CASE
          WHEN private.buybook_shop_front_check_limits.window_day = EXCLUDED.window_day
            THEN private.buybook_shop_front_check_limits.attempt_count + 1
          ELSE 1
        END,
        updated_at = now()
  RETURNING attempt_count INTO v_attempt_count;

  RETURN v_attempt_count <= 8;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_buybook_shop_front_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_buybook_shop_front_check(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_buybook_shop_front_verification(
  p_user_id uuid,
  p_storage_path text,
  p_status text,
  p_reason text DEFAULT NULL,
  p_model text DEFAULT '@cf/mistralai/mistral-small-3.1-24b-instruct'
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_verified_at timestamptz;
  v_object_id uuid;
  v_metadata jsonb;
BEGIN
  IF p_user_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path = ''
     OR p_storage_path NOT LIKE p_user_id::text || '/%'
     OR p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid shop-front verification record.';
  END IF;

  SELECT o.id, o.metadata
    INTO v_object_id, v_metadata
  FROM storage.objects AS o
  WHERE o.bucket_id = 'marketplace-shop-fronts'
    AND o.name = p_storage_path
    AND o.owner_id = p_user_id::text
    AND o.is_delete_marker = false
    AND o.archived_at IS NULL
  LIMIT 1;

  IF v_object_id IS NULL OR v_metadata IS NULL THEN
    RAISE EXCEPTION 'The uploaded shop-front photo no longer exists in the seller storage folder.';
  END IF;

  IF coalesce(v_metadata->>'mimetype', '') NOT IN ('image/jpeg', 'image/png', 'image/webp')
     OR coalesce((v_metadata->>'size')::bigint, 0) <= 0
     OR (v_metadata->>'size')::bigint > 5242880 THEN
    RAISE EXCEPTION 'The uploaded shop-front photo has an invalid type or size.';
  END IF;

  v_verified_at := CASE WHEN p_status = 'approved' THEN now() ELSE NULL END;

  INSERT INTO private.buybook_shop_front_verifications
    (user_id, storage_path, storage_object_id, status, reason, model, verified_at, updated_at)
  VALUES
    (p_user_id, p_storage_path, v_object_id, p_status,
     left(coalesce(p_reason, ''), 240), p_model, v_verified_at, now())
  ON CONFLICT (user_id, storage_path) DO UPDATE
    SET storage_object_id = EXCLUDED.storage_object_id,
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        model = EXCLUDED.model,
        verified_at = EXCLUDED.verified_at,
        updated_at = now();

  RETURN v_verified_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_buybook_shop_front_verification(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_buybook_shop_front_verification(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_buybook_shop_profile_before_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_metadata jsonb;
  v_verified_at timestamptz;
  v_verified_object_id uuid;
  v_current_object_id uuid;
BEGIN
  IF NOT (NEW.is_connected AND NEW.is_active) THEN
    RETURN NEW;
  END IF;

  IF NEW.phone IS NULL
     OR char_length(btrim(NEW.phone)) < 3
     OR char_length(btrim(NEW.phone)) > 40 THEN
    RAISE EXCEPTION 'Enter the WhatsApp contact number customers should use for your shop.';
  END IF;

  IF NEW.shop_front_image_url IS NULL
     OR btrim(NEW.shop_front_image_url) = ''
     OR NEW.shop_front_image_path IS NULL
     OR btrim(NEW.shop_front_image_path) = ''
     OR NEW.shop_front_image_path NOT LIKE NEW.owner_id::text || '/%' THEN
    RAISE EXCEPTION 'Upload a clear shop-front photo and let Sellbook check it automatically before connecting.';
  END IF;

  SELECT v.verified_at, v.storage_object_id
    INTO v_verified_at, v_verified_object_id
  FROM private.buybook_shop_front_verifications AS v
  WHERE v.user_id = NEW.owner_id
    AND v.storage_path = NEW.shop_front_image_path
    AND v.status = 'approved'
    AND v.verified_at IS NOT NULL
    AND v.storage_object_id IS NOT NULL
  LIMIT 1;

  IF v_verified_at IS NULL OR v_verified_object_id IS NULL THEN
    RAISE EXCEPTION 'This photo has not passed Sellbook automatic shop-front checking. Choose another photo and try again.';
  END IF;

  NEW.shop_front_confirmed_at := v_verified_at;

  IF position(
    '/storage/v1/object/public/marketplace-shop-fronts/' || NEW.shop_front_image_path
    IN NEW.shop_front_image_url
  ) = 0 THEN
    RAISE EXCEPTION 'The shop-front image URL does not match the uploaded shop-front file.';
  END IF;

  SELECT o.id, o.metadata
    INTO v_current_object_id, v_metadata
  FROM storage.objects AS o
  WHERE o.bucket_id = 'marketplace-shop-fronts'
    AND o.name = NEW.shop_front_image_path
    AND o.owner_id = NEW.owner_id::text
    AND o.is_delete_marker = false
    AND o.archived_at IS NULL
  LIMIT 1;

  IF v_metadata IS NULL OR v_current_object_id IS NULL THEN
    RAISE EXCEPTION 'The shop-front photo must be uploaded to Buybook storage before the shop can be connected.';
  END IF;

  IF v_current_object_id IS DISTINCT FROM v_verified_object_id THEN
    RAISE EXCEPTION 'The shop-front photo was replaced after approval. Upload it again so Sellbook can re-check it.';
  END IF;

  IF coalesce(v_metadata->>'mimetype', '') NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'The shop-front file must be a JPG, PNG or WebP image.';
  END IF;

  IF coalesce((v_metadata->>'size')::bigint, 0) <= 0
     OR (v_metadata->>'size')::bigint > 5242880 THEN
    RAISE EXCEPTION 'The shop-front image must be between 1 byte and 5 MB.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_marketplace_reservation_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- A retry creates a fresh event so an earlier read receipt cannot mark it read.
  DELETE FROM public.app_notifications
  WHERE reservation_id = NEW.id
    AND kind = 'reservation';

  INSERT INTO public.app_notifications
    (created_by, recipient_id, reservation_id, kind, title, body)
  VALUES
    (
      NEW.buyer_id,
      NEW.owner_id,
      NEW.id,
      'reservation',
      'New reservation request',
      'A buyer has requested a reservation from your shop. Open Sellbook → Connect to Buybook to review it.'
    );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_marketplace_reservation_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recipient uuid;
  v_title text;
  v_body text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'cancelled' THEN
      v_recipient := NEW.owner_id;
      v_title := 'Reservation cancelled';
      v_body := 'A buyer has cancelled a pending reservation. Open Sellbook → Connect to Buybook to review it.';
    ELSIF NEW.status = 'expired' THEN
      v_recipient := NEW.buyer_id;
      v_title := 'Reservation expired';
      v_body := 'Your reservation request expired before the shop confirmed it.';
    ELSIF NEW.status IN ('approved', 'accepted', 'ready') THEN
      v_recipient := NEW.buyer_id;
      v_title := 'Reservation approved';
      v_body := 'The shop has approved your reservation. Open Buybook → Reservations for details.';
    ELSIF NEW.status IN ('rejected', 'declined') THEN
      v_recipient := NEW.buyer_id;
      v_title := 'Reservation declined';
      v_body := 'The shop could not accept your reservation. Open Buybook → Reservations for details.';
    ELSE
      v_recipient := NEW.buyer_id;
      v_title := 'Reservation updated';
      v_body := 'Your reservation status has changed. Open Buybook → Reservations for details.';
    END IF;

    -- Replacing an event deletes its read receipt through the existing CASCADE FK.
    DELETE FROM public.app_notifications
    WHERE reservation_id = NEW.id
      AND kind = 'update';

    INSERT INTO public.app_notifications
      (created_by, recipient_id, reservation_id, kind, title, body)
    VALUES
      (NEW.owner_id, v_recipient, NEW.id, 'update', v_title, v_body);
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
