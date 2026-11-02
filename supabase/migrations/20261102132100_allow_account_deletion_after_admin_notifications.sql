-- Preserve platform notifications while allowing an account owner to permanently
-- delete their Sellbook account. A deleted creator becomes an anonymous/null author.
alter table public.app_notifications
  alter column created_by drop not null;

alter table public.app_notifications
  drop constraint if exists app_notifications_created_by_fkey;

alter table public.app_notifications
  add constraint app_notifications_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;