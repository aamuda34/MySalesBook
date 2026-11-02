create or replace function public.sync_marketplace_listing_from_product()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_shop public.marketplace_shops%rowtype;
begin
 if tg_op = 'DELETE' then
   delete from public.marketplace_listings where product_id = old.id;
   return old;
 end if;
 select * into v_shop from public.marketplace_shops where owner_id = new.user_id;
 if found and v_shop.is_connected and v_shop.is_active then
   insert into public.marketplace_listings(product_id,owner_id,shop_name,name,category,price,currency,unit,stock_status,is_active,updated_at)
   values(new.id,new.user_id,coalesce(nullif(v_shop.name,''),''),new.name,coalesce(new.category,'Uncategorized'),new.selling_price,'NGN',coalesce(new.base_unit,'unit'),
     case when new.stock<=0 then 'out_of_stock' when new.stock<=5 then 'low_stock' else 'available' end,true,now())
   on conflict(product_id) do update set owner_id=excluded.owner_id,shop_name=excluded.shop_name,name=excluded.name,category=excluded.category,
     price=excluded.price,currency=excluded.currency,unit=excluded.unit,stock_status=excluded.stock_status,is_active=true,updated_at=now();
 else
   delete from public.marketplace_listings where product_id=new.id;
 end if;
 return new;
end; $$;
drop trigger if exists products_sync_marketplace_listing on public.products;
create trigger products_sync_marketplace_listing after insert or update of name,selling_price,stock,category,base_unit,user_id or delete
on public.products for each row execute function public.sync_marketplace_listing_from_product();
create or replace function public.sync_owner_marketplace_listings(p_owner_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_shop public.marketplace_shops%rowtype; p record;
begin
 if auth.uid() is null or auth.uid() <> p_owner_id then raise exception 'Not authorized'; end if;
 select * into v_shop from public.marketplace_shops where owner_id=p_owner_id;
 if not found or not v_shop.is_connected or not v_shop.is_active then
   delete from public.marketplace_listings where owner_id=p_owner_id; return;
 end if;
 update public.marketplace_listings set shop_name=v_shop.name,updated_at=now() where owner_id=p_owner_id;
 for p in select * from public.products where user_id=p_owner_id loop
   insert into public.marketplace_listings(product_id,owner_id,shop_name,name,category,price,currency,unit,stock_status,is_active,updated_at)
   values(p.id,p_owner_id,v_shop.name,p.name,coalesce(p.category,'Uncategorized'),p.selling_price,'NGN',coalesce(p.base_unit,'unit'),
    case when p.stock<=0 then 'out_of_stock' when p.stock<=5 then 'low_stock' else 'available' end,true,now())
   on conflict(product_id) do update set shop_name=excluded.shop_name,name=excluded.name,category=excluded.category,price=excluded.price,
    currency=excluded.currency,unit=excluded.unit,stock_status=excluded.stock_status,is_active=true,updated_at=now();
 end loop;
end; $$;
revoke all on function public.sync_owner_marketplace_listings(uuid) from public, anon;
grant execute on function public.sync_owner_marketplace_listings(uuid) to authenticated;