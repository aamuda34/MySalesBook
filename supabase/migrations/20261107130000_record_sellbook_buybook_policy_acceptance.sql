create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application text not null check (application in ('sellbook','buybook')),
  privacy_policy_version text not null,
  terms_version text not null,
  accepted_at timestamptz not null,
  acceptance_method text not null check (acceptance_method in ('email_signup','google_oauth')),
  recorded_at timestamptz not null default now()
);

create index if not exists policy_acceptances_user_application_recorded_idx
  on public.policy_acceptances (user_id, application, recorded_at desc);

alter table public.policy_acceptances enable row level security;
revoke all on public.policy_acceptances from anon, authenticated;
grant select, insert on public.policy_acceptances to authenticated;

drop policy if exists policy_acceptances_read_own on public.policy_acceptances;
create policy policy_acceptances_read_own
  on public.policy_acceptances for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists policy_acceptances_insert_own on public.policy_acceptances;
create policy policy_acceptances_insert_own
  on public.policy_acceptances for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and application in ('sellbook','buybook')
    and accepted_at <= now() + interval '5 minutes'
  );

create schema if not exists private;

create or replace function private.capture_sellbook_signup_policy_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_id uuid;
  v_accepted_at timestamptz;
begin
  if v_meta ->> 'sellbook_privacy_policy_version' = '2026-11-06'
     and v_meta ->> 'sellbook_terms_version' = '2026-11-05' then
    begin
      v_id := nullif(v_meta ->> 'sellbook_policy_acceptance_id', '')::uuid;
    exception when invalid_text_representation then
      v_id := null;
    end;
    begin
      v_accepted_at := coalesce(nullif(v_meta ->> 'sellbook_policy_accepted_at', '')::timestamptz, now());
    exception when invalid_datetime_format or invalid_text_representation then
      v_accepted_at := now();
    end;
    insert into public.policy_acceptances (
      id, user_id, application, privacy_policy_version, terms_version,
      accepted_at, acceptance_method
    ) values (
      coalesce(v_id, gen_random_uuid()), new.id, 'sellbook',
      '2026-11-06', '2026-11-05', v_accepted_at, 'email_signup'
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function private.capture_sellbook_signup_policy_acceptance() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_capture_sellbook_policy on auth.users;
create trigger on_auth_user_created_capture_sellbook_policy
  after insert on auth.users
  for each row execute function private.capture_sellbook_signup_policy_acceptance();
