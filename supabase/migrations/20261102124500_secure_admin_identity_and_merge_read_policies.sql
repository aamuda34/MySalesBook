-- Bind Sellbook administration to the current verified account UUID, not a reusable email.
-- If the admin account is deleted, the row cascades away and a later account using the
-- same email does not silently regain administrative access.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.sellbook_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.sellbook_admins enable row level security;
revoke all on table private.sellbook_admins from public, anon, authenticated;

insert into private.sellbook_admins (user_id)
select id
from auth.users
where lower(email) = 'aamuda34@gmail.com'
  and email_confirmed_at is not null
on conflict (user_id) do nothing;

create or replace function public.is_sellbook_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from private.sellbook_admins a
    where a.user_id = (select auth.uid())
  );
$function$;

revoke all on function public.is_sellbook_admin() from public, anon;
grant execute on function public.is_sellbook_admin() to authenticated;

create or replace function public.sellbook_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_sellbook_admin() then
    raise exception 'Administrator access required';
  end if;

  return jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'new_users_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'feedback_open', (select count(*) from public.user_feedback where status in ('new','in_review')),
    'feedback_total', (select count(*) from public.user_feedback),
    'messages_unread', (
      select count(*) from public.support_messages
      where recipient_id is null
        and read_at is null
        and sender_id <> auth.uid()
    ),
    'notifications_total', (select count(*) from public.app_notifications)
  );
end;
$function$;

create or replace function public.sellbook_admin_platform_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  result jsonb;
begin
  if not public.is_sellbook_admin() then
    raise exception 'Administrator access required';
  end if;

  select jsonb_build_object(
    'total_products', (select count(*) from public.products),
    'total_sales', (select count(*) from public.sales),
    'sales_value', (select coalesce(sum(total), 0) from public.sales),
    'visits_today', (select count(*) from public.app_page_visits where visit_date = (timezone('utc', now()))::date),
    'visits_7d', (select count(*) from public.app_page_visits where visit_date >= (timezone('utc', now()))::date - 6),
    'visits_30d', (select count(*) from public.app_page_visits where visit_date >= (timezone('utc', now()))::date - 29),
    'traffic_daily', coalesce((
      select jsonb_agg(
        jsonb_build_object('day', d.day, 'visits', coalesce(v.visits, 0))
        order by d.day
      )
      from generate_series(
        (timezone('utc', now()))::date - 6,
        (timezone('utc', now()))::date,
        interval '1 day'
      ) as d(day)
      left join (
        select visit_date, count(*) as visits
        from public.app_page_visits
        where visit_date >= (timezone('utc', now()))::date - 6
        group by visit_date
      ) v on v.visit_date = d.day::date
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

create or replace function public.sellbook_admin_users()
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_sellbook_admin() then
    raise exception 'Administrator access required';
  end if;

  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    order by u.created_at desc
    limit 200;
end;
$function$;

revoke all on function public.sellbook_admin_overview() from public, anon;
revoke all on function public.sellbook_admin_platform_metrics() from public, anon;
revoke all on function public.sellbook_admin_users() from public, anon;
grant execute on function public.sellbook_admin_overview() to authenticated;
grant execute on function public.sellbook_admin_platform_metrics() to authenticated;
grant execute on function public.sellbook_admin_users() to authenticated;

-- Consolidate overlapping read policies without changing who can see active public listings
-- or connected public shops, while still allowing owners to see their own inactive rows.
drop policy if exists marketplace_listings_owner_read on public.marketplace_listings;
drop policy if exists marketplace_listings_public_active_read on public.marketplace_listings;
create policy marketplace_listings_read
on public.marketplace_listings
for select
to anon, authenticated
using (
  is_active
  or owner_id = (select auth.uid())
);

drop policy if exists marketplace_shops_owner_read on public.marketplace_shops;
drop policy if exists marketplace_shops_public_active_read on public.marketplace_shops;
create policy marketplace_shops_read
on public.marketplace_shops
for select
to anon, authenticated
using (
  (is_connected and is_active)
  or owner_id = (select auth.uid())
);

-- The former two INSERT policies were permissive and their OR-combination allowed
-- a user to message support, while admins could also reply to a specific user.
drop policy if exists "Admin replies to users" on public.support_messages;
drop policy if exists "Users send support messages to admin" on public.support_messages;
create policy support_messages_insert
on public.support_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and (
    recipient_id is null
    or (select public.is_sellbook_admin())
  )
);
