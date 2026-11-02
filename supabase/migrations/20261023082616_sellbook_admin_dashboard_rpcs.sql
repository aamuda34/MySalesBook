
create or replace function public.sellbook_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'aamuda34@gmail.com' then
    raise exception 'Administrator access required';
  end if;
  return jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'new_users_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'feedback_open', (select count(*) from public.user_feedback where status in ('new','in_review')),
    'feedback_total', (select count(*) from public.user_feedback),
    'messages_unread', (select count(*) from public.support_messages where recipient_id is null),
    'notifications_total', (select count(*) from public.app_notifications)
  );
end;
$$;
revoke all on function public.sellbook_admin_overview() from public, anon;
grant execute on function public.sellbook_admin_overview() to authenticated;

create or replace function public.sellbook_admin_users()
returns table(user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'aamuda34@gmail.com' then
    raise exception 'Administrator access required';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    order by u.created_at desc
    limit 200;
end;
$$;
revoke all on function public.sellbook_admin_users() from public, anon;
grant execute on function public.sellbook_admin_users() to authenticated;
