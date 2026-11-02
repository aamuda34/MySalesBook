create function public.record_sale(
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_note text,
  p_units_per_sale integer,
  p_sale_unit text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_sale_id uuid;
  v_base_quantity integer;
  v_unit_cost numeric(12,2);
  v_total numeric(12,2);
  v_profit numeric(12,2);
begin
  if v_user_id is null then raise exception 'You must sign in to record a sale.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Quantity must be at least one.'; end if;
  if p_units_per_sale is null or p_units_per_sale < 1 then raise exception 'Sale unit factor must be positive.'; end if;
  if p_unit_price is null or p_unit_price <= 0 then raise exception 'Enter a valid selling price.'; end if;
  if p_note is not null and char_length(p_note) > 150 then raise exception 'The sale note is too long.'; end if;
  select * into v_product from public.products where id=p_product_id and user_id=v_user_id for update;
  if not found then raise exception 'Product not found in your account.'; end if;
  if p_sale_unit is null or length(trim(p_sale_unit))=0 then raise exception 'Sale unit is required.'; end if;
  if p_units_per_sale > 1 and (coalesce(v_product.pack_unit,'') <> p_sale_unit or coalesce(v_product.units_per_pack,0) <> p_units_per_sale) then
    raise exception 'Pack settings changed. Refresh the app and try again.';
  end if;
  if p_units_per_sale = 1 and p_sale_unit not in (coalesce(v_product.base_unit,'unit'),'unit') then
    raise exception 'Selling unit changed. Refresh the app and try again.';
  end if;
  v_base_quantity := p_quantity * p_units_per_sale;
  if v_base_quantity > v_product.stock then raise exception 'Insufficient stock.'; end if;
  v_unit_cost := round(v_product.cost_price * p_units_per_sale, 2);
  v_total := round(p_quantity * p_unit_price, 2);
  v_profit := round(v_total - p_quantity * v_unit_cost, 2);
  update public.products set stock=stock-v_base_quantity, updated_at=now() where id=p_product_id and user_id=v_user_id;
  insert into public.sales (user_id, product_id, product_name, quantity, unit_price, unit_cost, total, gross_profit, note, base_quantity, sale_unit, units_per_sale)
  values (v_user_id, p_product_id, v_product.name, p_quantity, p_unit_price, v_unit_cost, v_total, v_profit, nullif(trim(p_note),''), v_base_quantity, p_sale_unit, p_units_per_sale)
  returning id into v_sale_id;
  return v_sale_id;
end;
$$;
revoke all on function public.record_sale(uuid, integer, numeric, text, integer, text) from public, anon;
grant execute on function public.record_sale(uuid, integer, numeric, text, integer, text) to authenticated;