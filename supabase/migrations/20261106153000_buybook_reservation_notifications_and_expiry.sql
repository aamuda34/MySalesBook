-- Complete Buybook reservation notifications and expire pending requests on schedule.
CREATE OR REPLACE FUNCTION public.notify_marketplace_reservation_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
    )
  ON CONFLICT (reservation_id, kind) DO UPDATE
    SET created_by = EXCLUDED.created_by,
        recipient_id = EXCLUDED.recipient_id,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        created_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_marketplace_reservation_created()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_marketplace_reservation_created_after_insert
  ON public.marketplace_reservations;

CREATE TRIGGER notify_marketplace_reservation_created_after_insert
AFTER INSERT ON public.marketplace_reservations
FOR EACH ROW
EXECUTE FUNCTION public.notify_marketplace_reservation_created();

CREATE OR REPLACE FUNCTION public.notify_marketplace_reservation_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

    INSERT INTO public.app_notifications
      (created_by, recipient_id, reservation_id, kind, title, body)
    VALUES
      (NEW.owner_id, v_recipient, NEW.id, 'update', v_title, v_body)
    ON CONFLICT (reservation_id, kind) DO UPDATE
      SET created_by = EXCLUDED.created_by,
          recipient_id = EXCLUDED.recipient_id,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          created_at = now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_marketplace_reservation_cancellation()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_marketplace_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.marketplace_reservations
     SET status = 'expired',
         updated_at = now()
   WHERE status = 'pending'
     AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_marketplace_reservations()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'expire-marketplace-reservations'
  ) THEN
    PERFORM cron.schedule(
      'expire-marketplace-reservations',
      '*/5 * * * *',
      'select public.expire_marketplace_reservations()'
    );
  END IF;
END;
$$;
