create or replace function public.mark_marketplace_conversation_read(p_owner_id uuid, p_buyer_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
 v_user uuid := auth.uid();
 v_count integer := 0;
begin
 if v_user is null or (v_user <> p_owner_id and v_user <> p_buyer_id) then
  raise exception 'You are not a participant in this conversation';
 end if;
 update public.marketplace_messages
 set read_at = now()
 where owner_id = p_owner_id and buyer_id = p_buyer_id
   and sender_id <> v_user and read_at is null;
 get diagnostics v_count = row_count;
 return v_count;
end;
$function$;
revoke all on function public.mark_marketplace_conversation_read(uuid, uuid) from public, anon;
grant execute on function public.mark_marketplace_conversation_read(uuid, uuid) to authenticated;