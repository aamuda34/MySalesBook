grant insert on table public.sales to authenticated;

create policy "Users import own sales"
on public.sales
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (
    product_id is null
    or exists (
      select 1
      from public.products p
      where p.id = sales.product_id
        and p.user_id = (select auth.uid())
    )
  )
);