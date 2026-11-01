-- Persist stock levels around each restock and harden quantity arithmetic.
alter table public.stock_purchases
  add column if not exists previous_stock integer,
  add column if not exists new_stock integer;

create or replace function public.restock_product(
  p_purchase_id uuid,
  p_product_id uuid,
  p_purchase_quantity integer,
  p_purchase_unit text,
  p_units_per_purchase integer,
  p_cost_per_purchase_unit numeric,
  p_restocked_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_base_quantity integer;
  v_total_cost numeric(12,2);
  v_base_cost numeric(12,4);
  v_new_stock integer;
  v_new_stock_bigint bigint;
  v_base_quantity_bigint bigint;
  v_avg_before numeric(12,4);
  v_avg_after numeric(12,4);
begin
  if v_user_id is null then raise exception 'Sign in before restocking.'; end if;
  if p_purchase_id is null or p_product_id is null
     or p_purchase_quantity is null or p_purchase_quantity < 1
     or p_units_per_purchase is null or p_units_per_purchase < 1
     or p_cost_per_purchase_unit is null or p_cost_per_purchase_unit < 0
     or p_cost_per_purchase_unit > 9999999999.99 then
    raise exception 'Enter a valid purchase quantity and cost.';
  end if;
  if coalesce(trim(p_purchase_unit),'') = '' or length(trim(p_purchase_unit)) > 30 then
    raise exception 'Enter a valid purchase unit.';
  end if;

  -- Multiply as bigint before casting; integer multiplication can overflow first.
  v_base_quantity_bigint := p_purchase_quantity::bigint * p_units_per_purchase::bigint;
  if v_base_quantity_bigint < 1 or v_base_quantity_bigint > 2000000000 then
    raise exception 'Purchase quantity is too large.';
  end if;
  v_base_quantity := v_base_quantity_bigint::integer;
  v_total_cost := round(p_purchase_quantity::numeric * p_cost_per_purchase_unit,2);
  if v_total_cost > 9999999999.99 then raise exception 'Total purchase cost is too large.'; end if;
  v_base_cost := round(v_total_cost / v_base_quantity,4);

  select * into v_product from public.products
   where id=p_product_id and user_id=v_user_id for update;
  if not found then raise exception 'Product not found in your account.'; end if;

  if exists(select 1 from public.stock_purchases where id=p_purchase_id and user_id=v_user_id) then
    return jsonb_build_object('duplicate',true,'stock',v_product.stock,'cost_price',v_product.cost_price);
  end if;

  v_new_stock_bigint := v_product.stock::bigint + v_base_quantity_bigint;
  if v_new_stock_bigint > 2000000000 then raise exception 'Stock quantity is too large.'; end if;
  v_new_stock := v_new_stock_bigint::integer;
  v_avg_before := coalesce(v_product.cost_price,0);
  if v_product.stock = 0 then
    v_avg_after := v_base_cost;
  else
    v_avg_after := round(((v_product.stock::numeric * v_avg_before) + (v_base_quantity::numeric * v_base_cost)) / v_new_stock,4);
  end if;

  update public.products set stock=v_new_stock,cost_price=v_avg_after,updated_at=now()
   where id=p_product_id and user_id=v_user_id;

  insert into public.stock_purchases(
    id,user_id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,
    base_quantity,cost_per_purchase_unit,total_cost,base_unit_cost,average_cost_before,average_cost_after,
    previous_stock,new_stock,restocked_at
  ) values (
    p_purchase_id,v_user_id,p_product_id,v_product.name,p_purchase_quantity,trim(p_purchase_unit),p_units_per_purchase,
    v_base_quantity,p_cost_per_purchase_unit,v_total_cost,v_base_cost,v_avg_before,v_avg_after,
    v_product.stock,v_new_stock,coalesce(p_restocked_at,now())
  );

  return jsonb_build_object('duplicate',false,'stock',v_new_stock,'cost_price',v_avg_after,
    'base_quantity',v_base_quantity,'previous_stock',v_product.stock,'new_stock',v_new_stock);
end;
$function$;

revoke all on function public.restock_product(uuid,uuid,integer,text,integer,numeric,timestamptz) from public, anon;
grant execute on function public.restock_product(uuid,uuid,integer,text,integer,numeric,timestamptz) to authenticated;
