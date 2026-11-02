
-- Safe, additive launch-hardening migration. No business rows are changed or deleted.
CREATE INDEX IF NOT EXISTS sales_product_id_idx ON public.sales (product_id);
CREATE INDEX IF NOT EXISTS stock_adjustments_product_id_idx ON public.stock_adjustments (product_id);

ALTER POLICY "Users can view their own profile" ON public.user_profiles
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can create their own profile" ON public.user_profiles
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can update their own profile" ON public.user_profiles
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can delete their own profile" ON public.user_profiles
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users can view their own stock adjustments" ON public.stock_adjustments
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can create their own stock adjustments" ON public.stock_adjustments
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can update their own stock adjustments" ON public.stock_adjustments
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can delete their own stock adjustments" ON public.stock_adjustments
  USING ((SELECT auth.uid()) = user_id);

-- Keep privileged RPCs callable only by signed-in users; explicitly deny anonymous/PUBLIC execution.
REVOKE ALL ON FUNCTION public.record_sale(uuid, integer, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamp with time zone) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale(uuid, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
