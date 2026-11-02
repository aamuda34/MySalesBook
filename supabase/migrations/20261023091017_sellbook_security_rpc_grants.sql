-- Lock down SECURITY DEFINER RPCs to only the roles that need them.
-- Authenticated users retain sales/account functions; admin functions keep internal admin checks.
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

REVOKE ALL ON FUNCTION public.record_sale(uuid, integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale(uuid, integer, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_offline(uuid, uuid, integer, numeric, text, timestamp with time zone) TO authenticated;

REVOKE ALL ON FUNCTION public.sellbook_admin_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sellbook_admin_overview() TO authenticated;

REVOKE ALL ON FUNCTION public.sellbook_admin_platform_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sellbook_admin_platform_metrics() TO authenticated;

REVOKE ALL ON FUNCTION public.sellbook_admin_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sellbook_admin_users() TO authenticated;

-- Public visit tracking is intentional; the function validates its input and writes no user business data.
REVOKE ALL ON FUNCTION public.record_sellbook_visit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sellbook_visit(text) TO anon, authenticated;

-- Keep visit rows inaccessible directly; only the validated RPC can add visit counts.
REVOKE ALL ON TABLE public.app_page_visits FROM PUBLIC, anon, authenticated;