-- Atomic stale-product check for queued/offline sales.
-- The product version is checked after the row lock and in the same transaction
-- as stock deduction and sale insertion.
create or replace function public.record_sale_offline(
 p_sale_id uuid,
 p_product_id uuid,
 p_quantity integer,
 p_unit_price numeric,
 p_note text,
 p_sold_at timestamptz,
 p_units_per_sale integer,
 p_sale_unit text,
 p_expected_updated_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_user_id uuid := auth.uid();
 v_existing_user_id uuid;
 v_product public.products%rowtype;
 v_base_quantity bigint;
 v_unit_cost numeric(12,2);
 v_total numeric(12,2);
 v_profit numeric(12,2);
begin
 if v_user_id is null then raise exception 'You must sign in to synchronise a sale.'; end if;
 if p_sale_id is null then raise exception 'A unique sale ID is required.'; end if;
 if p_quantity is null or p_quantity<1 then raise exception 'Quantity must be at least one.'; end if;
 if p_units_per_sale is null or p_units_per_sale<1 then raise exception 'Sale unit factor must be positive.'; end if;
 if p_quantity::bigint * p_units_per_sale::bigint > 2147483647 then raise exception 'Sale quantity is too large.'; end if;
 if p_unit_price is null or p_unit_price<=0 then raise exception 'Enter a valid selling price.'; end if;
 if p_expected_updated_at is null then raise exception 'A product version is required. Refresh Sellbook before synchronising this sale.'; end if;
 if p_note is not null and char_length(p_note)>150 then raise exception 'The sale note is too long.'; end if;

 perform pg_advisory_xact_lock(hashtextextended(p_sale_id::text,0));
 select user_id into v_existing_user_id from public.sales where id=p_sale_id;
 if found then
   if v_existing_user_id<>v_user_id then raise exception 'This sale ID belongs to another account.'; end if;
   return p_sale_id;
 end if;

 select * into v_product
 from public.products
 where id=p_product_id and user_id=v_user_id
 for update;
 if not found then raise exception 'Product not found in your account.'; end if;
 if v_product.updated_at is distinct from p_expected_updated_at then
   raise exception 'Conflict: this product changed on another phone. Check stock and product details before retrying this sale.';
 end if;

 if p_sale_unit is null or length(trim(p_sale_unit))=0 then raise exception 'Sale unit is required.'; end if;
 if p_units_per_sale>1 and (coalesce(v_product.pack_unit,'')<>p_sale_unit or coalesce(v_product.units_per_pack,0)<>p_units_per_sale) then
   raise exception 'Pack settings changed. Refresh the app and try again.';
 end if;
 if p_units_per_sale=1 and p_sale_unit not in (coalesce(v_product.base_unit,'unit'),'unit') then
   raise exception 'Selling unit changed. Refresh the app and try again.';
 end if;

 v_base_quantity:=p_quantity::bigint*p_units_per_sale::bigint;
 if v_base_quantity>v_product.stock then raise exception 'Insufficient stock.'; end if;
 v_unit_cost:=round(v_product.cost_price*p_units_per_sale,2);
 v_total:=round(p_quantity*p_unit_price,2);
 v_profit:=round(v_total-p_quantity*v_unit_cost,2);

 update public.products
 set stock=stock-v_base_quantity::integer,updated_at=now()
 where id=p_product_id and user_id=v_user_id;

 insert into public.sales(
  id,user_id,product_id,product_name,quantity,unit_price,unit_cost,total,gross_profit,
  note,sold_at,base_quantity,sale_unit,units_per_sale
 ) values (
  p_sale_id,v_user_id,p_product_id,v_product.name,p_quantity,p_unit_price,v_unit_cost,
  v_total,v_profit,nullif(trim(p_note),''),coalesce(p_sold_at,now()),v_base_quantity,
  p_sale_unit,p_units_per_sale
 );
 return p_sale_id;
end;
$function$;

revoke all on function public.record_sale_offline(uuid,uuid,integer,numeric,text,timestamptz,integer,text,timestamptz) from public;
revoke all on function public.record_sale_offline(uuid,uuid,integer,numeric,text,timestamptz,integer,text,timestamptz) from anon;
grant execute on function public.record_sale_offline(uuid,uuid,integer,numeric,text,timestamptz,integer,text,timestamptz) to authenticated;
