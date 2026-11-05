-- Platform-wide sales metrics must use the same active-sale definition as business reports.
-- Reversed receipts remain in history but no longer contribute to sales count or value.
CREATE OR REPLACE FUNCTION public.sellbook_admin_platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_sellbook_admin() OR NOT private.is_sellbook_pin_verified() THEN
    RAISE EXCEPTION 'Administrator access and a verified Sellbook PIN are required';
  END IF;

  SELECT jsonb_build_object(
    'total_products', (SELECT count(*) FROM public.products),
    'total_sales', (
      SELECT count(*)
      FROM public.sales
      WHERE reversed_at IS NULL
    ),
    'sales_value', (
      SELECT coalesce(sum(total), 0)
      FROM public.sales
      WHERE reversed_at IS NULL
    ),
    'visits_today', (
      SELECT count(*)
      FROM public.app_page_visits
      WHERE visit_date = (timezone('utc', now()))::date
    ),
    'visits_7d', (
      SELECT count(*)
      FROM public.app_page_visits
      WHERE visit_date >= (timezone('utc', now()))::date - 6
    ),
    'visits_30d', (
      SELECT count(*)
      FROM public.app_page_visits
      WHERE visit_date >= (timezone('utc', now()))::date - 29
    ),
    'traffic_daily', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('day', d.day, 'visits', coalesce(v.visits, 0))
        ORDER BY d.day
      )
      FROM generate_series(
        (timezone('utc', now()))::date - 6,
        (timezone('utc', now()))::date,
        interval '1 day'
      ) AS d(day)
      LEFT JOIN (
        SELECT visit_date, count(*) AS visits
        FROM public.app_page_visits
        WHERE visit_date >= (timezone('utc', now()))::date - 6
        GROUP BY visit_date
      ) AS v ON v.visit_date = d.day::date
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$;
