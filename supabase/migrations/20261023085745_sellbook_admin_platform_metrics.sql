create table if not exists public.app_page_visits (
  id bigint generated always as identity primary key,
  visit_date date not null default (timezone('utc', now()))::date,
  session_key text not null,
  created_at timestamptz not null default now()
);
alter table public.app_page_visits enable row level security;
revoke all on public.app_page_visits from anon, authenticated;
create index if not exists app_page_visits_date_idx on public.app_page_visits (visit_date desc);
create unique index if not exists app_page_visits_session_day_idx on public.app_page_visits (visit_date, session_key);
create or replace function public.record_sellbook_visit(p_session_key text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
 if p_session_key is null or length(p_session_key) < 16 or length(p_session_key) > 100 then return false; end if;
 insert into public.app_page_visits(session_key)
 values (p_session_key)
 on conflict (visit_date, session_key) do nothing;
 return true;
end;
$$;
revoke all on function public.record_sellbook_visit(text) from public;
grant execute on function public.record_sellbook_visit(text) to anon, authenticated;
create or replace function public.sellbook_admin_platform_metrics()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'aamuda34@gmail.com' then
  raise exception 'Administrator access required';
 end if;
 select jsonb_build_object(
  'total_products', (select count(*) from public.products),
  'total_sales', (select count(*) from public.sales),
  'sales_value', (select coalesce(sum(total),0) from public.sales),
  'visits_today', (select count(*) from public.app_page_visits where visit_date=(timezone('utc',now()))::date),
  'visits_7d', (select count(*) from public.app_page_visits where visit_date >= (timezone('utc',now()))::date - 6),
  'visits_30d', (select count(*) from public.app_page_visits where visit_date >= (timezone('utc',now()))::date - 29),
  'traffic_daily', coalesce((select jsonb_agg(jsonb_build_object('day',d.day,'visits',coalesce(v.visits,0)) order by d.day)
    from generate_series((timezone('utc',now()))::date - 6,(timezone('utc',now()))::date,interval '1 day') as d(day)
    left join (select visit_date,count(*) as visits from public.app_page_visits where visit_date >= (timezone('utc',now()))::date - 6 group by visit_date) v on v.visit_date=d.day::date), '[]'::jsonb)
 ) into result;
 return result;
end;
$$;
revoke all on function public.sellbook_admin_platform_metrics() from public;
grant execute on function public.sellbook_admin_platform_metrics() to authenticated;