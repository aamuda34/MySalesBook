-- Remove the temporary Tier 2 / Tier 3 identity gates. Existing Buybook shops
-- and listings remain untouched; marketplace publishing returns to its
-- pre-tier, PIN-protected behavior.
drop trigger if exists guard_sellbook_tier3_connection on public.marketplace_shops;
drop trigger if exists guard_sellbook_tier3_listing on public.marketplace_listings;
drop function if exists private.guard_sellbook_tier3_connection();
drop function if exists private.guard_sellbook_tier3_listing();
drop function if exists public.get_my_account_tier_status();
drop function if exists public.get_pending_identity_verification_attempt();

-- Restore the pre-tier listing sync implementation. It remains account-scoped
-- and requires the existing Sellbook PIN session for connected sellers.
create or replace function public.sync_owner_marketplace_listings(p_owner_id uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_shop public.marketplace_shops%rowtype;
  p record;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then
    raise exception 'Not authorized';
  end if;
  if not private.is_sellbook_pin_verified() then
    raise exception 'Verify your Sellbook security PIN first';
  end if;
  select * into v_shop from public.marketplace_shops where owner_id = p_owner_id;
  if not found or not v_shop.is_connected or not v_shop.is_active then
    delete from public.marketplace_listings where owner_id = p_owner_id;
    return;
  end if;
  update public.marketplace_listings
    set shop_name = v_shop.name, updated_at = now()
    where owner_id = p_owner_id;
  for p in select * from public.products where user_id = p_owner_id loop
    insert into public.marketplace_listings(
      product_id, owner_id, shop_name, name, category, price, currency,
      unit, stock_status, is_active, updated_at
    )
    values(
      p.id, p_owner_id, v_shop.name, p.name,
      coalesce(p.category, 'Uncategorized'), p.selling_price, 'NGN',
      coalesce(p.base_unit, 'unit'),
      case when p.stock <= 0 then 'out_of_stock'
           when p.stock <= 5 then 'low_stock' else 'available' end,
      true, now()
    )
    on conflict(product_id) do update set
      shop_name = excluded.shop_name,
      name = excluded.name,
      category = excluded.category,
      price = excluded.price,
      currency = excluded.currency,
      unit = excluded.unit,
      stock_status = excluded.stock_status,
      is_active = true,
      updated_at = now();
  end loop;
end;
$function$;
revoke all on function public.sync_owner_marketplace_listings(uuid) from public, anon;
grant execute on function public.sync_owner_marketplace_listings(uuid) to authenticated;
