create or replace function public.record_buybook_shop_front_verification(
  p_user_id uuid,
  p_storage_path text,
  p_status text,
  p_reason text default null,
  p_model text default '@cf/moondream/moondream3.1-9B-A2B'
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_verified_at timestamptz;
begin
  if p_user_id is null
     or p_storage_path is null
     or p_storage_path = ''
     or p_storage_path not like p_user_id::text || '/%'
     or p_status not in ('approved', 'rejected') then
    raise exception 'Invalid shop-front verification record.';
  end if;

  v_verified_at := case when p_status = 'approved' then now() else null end;

  insert into private.buybook_shop_front_verifications
    (user_id, storage_path, status, reason, model, verified_at, updated_at)
  values
    (p_user_id, p_storage_path, p_status, left(coalesce(p_reason, ''), 240), p_model, v_verified_at, now())
  on conflict (user_id, storage_path) do update
    set status = excluded.status,
        reason = excluded.reason,
        model = excluded.model,
        verified_at = excluded.verified_at,
        updated_at = now();

  return v_verified_at;
end;
$function$;

revoke all on function public.record_buybook_shop_front_verification(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_buybook_shop_front_verification(uuid, text, text, text, text) to service_role;
