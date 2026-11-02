
create or replace function public.is_sellbook_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'aamuda34@gmail.com'
$$;

revoke all on function public.is_sellbook_admin() from public, anon;
grant execute on function public.is_sellbook_admin() to authenticated;

create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'suggestion' check (category in ('bug','suggestion','complaint','other')),
  subject text not null check (char_length(trim(subject)) between 1 and 120),
  message text not null check (char_length(trim(message)) between 1 and 4000),
  status text not null default 'new' check (status in ('new','in_review','resolved','declined')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) <= 4000),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from anon, public;
grant select, insert on public.user_feedback to authenticated;
grant update on public.user_feedback to authenticated;
drop policy if exists "Users create own feedback" on public.user_feedback;
create policy "Users create own feedback" on public.user_feedback for insert to authenticated with check (user_id = (select auth.uid()) and status = 'new' and admin_reply is null and replied_at is null);
drop policy if exists "Users read own feedback and admins read all" on public.user_feedback;
create policy "Users read own feedback and admins read all" on public.user_feedback for select to authenticated using (user_id = (select auth.uid()) or (select public.is_sellbook_admin()));
drop policy if exists "Admins update feedback" on public.user_feedback;
create policy "Admins update feedback" on public.user_feedback for update to authenticated using ((select public.is_sellbook_admin())) with check ((select public.is_sellbook_admin()));

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint support_messages_not_self check (recipient_id is null or recipient_id <> sender_id)
);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon, public;
grant select, insert, update on public.support_messages to authenticated;
drop policy if exists "Users read their support messages" on public.support_messages;
create policy "Users read their support messages" on public.support_messages for select to authenticated using (
 sender_id = (select auth.uid()) or recipient_id = (select auth.uid()) or ((select public.is_sellbook_admin()))
);
drop policy if exists "Users send support messages to admin" on public.support_messages;
create policy "Users send support messages to admin" on public.support_messages for insert to authenticated with check (
 sender_id = (select auth.uid()) and (recipient_id is null or (select public.is_sellbook_admin()))
);
drop policy if exists "Admin replies to users" on public.support_messages;
create policy "Admin replies to users" on public.support_messages for insert to authenticated with check (
 (select public.is_sellbook_admin()) and sender_id = (select auth.uid()) and recipient_id is not null
);
drop policy if exists "Participants mark messages read" on public.support_messages;
create policy "Participants mark messages read" on public.support_messages for update to authenticated using (
 sender_id = (select auth.uid()) or recipient_id = (select auth.uid()) or (select public.is_sellbook_admin())
) with check (
 sender_id = (select auth.uid()) or recipient_id = (select auth.uid()) or (select public.is_sellbook_admin())
);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  kind text not null default 'announcement' check (kind in ('announcement','maintenance','update','support')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table public.app_notifications enable row level security;
revoke all on public.app_notifications from anon, public;
grant select, insert, delete on public.app_notifications to authenticated;
drop policy if exists "Users read notifications for them" on public.app_notifications;
create policy "Users read notifications for them" on public.app_notifications for select to authenticated using (
 recipient_id = (select auth.uid()) or recipient_id is null or (select public.is_sellbook_admin())
);
drop policy if exists "Admins create notifications" on public.app_notifications;
create policy "Admins create notifications" on public.app_notifications for insert to authenticated with check (
 (select public.is_sellbook_admin()) and created_by = (select auth.uid())
);
drop policy if exists "Admins delete notifications" on public.app_notifications;
create policy "Admins delete notifications" on public.app_notifications for delete to authenticated using ((select public.is_sellbook_admin()));

create index if not exists user_feedback_user_created_idx on public.user_feedback(user_id, created_at desc);
create index if not exists user_feedback_status_created_idx on public.user_feedback(status, created_at desc);
create index if not exists support_messages_sender_created_idx on public.support_messages(sender_id, created_at desc);
create index if not exists support_messages_recipient_created_idx on public.support_messages(recipient_id, created_at desc);
create index if not exists app_notifications_recipient_created_idx on public.app_notifications(recipient_id, created_at desc);

create or replace function public.sellbook_admin_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'new_users_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'feedback_open', (select count(*) from public.user_feedback where status in ('new','in_review')),
    'feedback_total', (select count(*) from public.user_feedback),
    'messages_unread', (select count(*) from public.support_messages where recipient_id is null),
    'notifications_total', (select count(*) from public.app_notifications)
  )
  where public.is_sellbook_admin()
$$;
revoke all on function public.sellbook_admin_overview() from public, anon;
grant execute on function public.sellbook_admin_overview() to authenticated;
