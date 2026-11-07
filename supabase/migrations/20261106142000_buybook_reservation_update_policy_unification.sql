-- Consolidate owner reservation updates and buyer pending cancellation in one policy.
-- This preserves the existing owner scope and avoids multiple permissive UPDATE policies.
DROP POLICY IF EXISTS marketplace_reservations_buyer_cancel
  ON public.marketplace_reservations;
DROP POLICY IF EXISTS marketplace_reservations_owner_update
  ON public.marketplace_reservations;

CREATE POLICY marketplace_reservations_participant_update
ON public.marketplace_reservations
FOR UPDATE
TO authenticated
USING (
  (SELECT public.is_marketplace_registered_user())
  AND (
    owner_id = (SELECT auth.uid())
    OR (
      buyer_id = (SELECT auth.uid())
      AND status = 'pending'
      AND expires_at > now()
    )
  )
)
WITH CHECK (
  (SELECT public.is_marketplace_registered_user())
  AND (
    owner_id = (SELECT auth.uid())
    OR (
      buyer_id = (SELECT auth.uid())
      AND status = 'cancelled'
    )
  )
);
