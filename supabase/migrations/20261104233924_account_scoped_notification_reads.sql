create table public.notification_reads (
  notification_id uuid not null references public.app_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint notification_reads_pkey primary key (notification_id, user_id)
);

create index notification_reads_user_id_idx
  on public.notification_reads (user_id, read_at desc);

alter table public.notification_reads enable row level security;

create policy "Users read their notification receipts"
  on public.notification_reads
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their notification receipts"
  on public.notification_reads
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.notification_reads from anon;
grant select, insert on public.notification_reads to authenticated;

create or replace function public.get_my_unread_notification_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $function$
  select count(*)::bigint
  from public.app_notifications n
  where (n.recipient_id is null or n.recipient_id = (select auth.uid()))
    and (n.expires_at is null or n.expires_at > now())
    and not exists (
      select 1
      from public.notification_reads r
      where r.notification_id = n.id
        and r.user_id = (select auth.uid())
    );
$function$;

revoke all on function public.get_my_unread_notification_count() from public, anon;
grant execute on function public.get_my_unread_notification_count() to authenticated;

create or replace function public.mark_my_notifications_read()
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_inserted integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  insert into public.notification_reads (notification_id, user_id, read_at)
  select n.id, (select auth.uid()), now()
  from public.app_notifications n
  where (n.recipient_id is null or n.recipient_id = (select auth.uid()))
    and (n.expires_at is null or n.expires_at > now())
  on conflict (notification_id, user_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function public.mark_my_notifications_read() from public, anon;
grant execute on function public.mark_my_notifications_read() to authenticated;
