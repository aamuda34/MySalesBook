-- A single basket is stored as multiple sales rows sharing one transaction ID.
-- The transaction ID is a grouping key, not a unique row key.
drop index if exists public.sales_transaction_id_unique_idx;

create index if not exists sales_transaction_id_idx
  on public.sales (transaction_id)
  where transaction_id is not null;
