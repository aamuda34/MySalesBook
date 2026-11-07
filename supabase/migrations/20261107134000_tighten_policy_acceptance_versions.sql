drop policy if exists policy_acceptances_insert_own on public.policy_acceptances;

create policy policy_acceptances_insert_own
  on public.policy_acceptances
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and accepted_at <= now() + interval '5 minutes'
    and (
      (
        application = 'sellbook'
        and privacy_policy_version = '2026-11-06'
        and terms_version = '2026-11-05'
      )
      or
      (
        application = 'buybook'
        and privacy_policy_version = '2026-11-06'
        and terms_version = '2026-11-07'
      )
    )
  );
