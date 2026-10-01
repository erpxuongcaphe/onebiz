-- Disposable fixture for the real 00390 cost helpers and internal-sale wrapper.
-- Never run against an application database.
\set ON_ERROR_STOP on

create table public.fnb_supply_branch_scopes (
  tenant_id uuid not null,
  branch_id uuid not null,
  enforcement_enabled boolean not null,
  primary key (tenant_id, branch_id)
);

create table public.fnb_branch_product_cost_balances (
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  costed_quantity numeric(18,4) not null default 0,
  total_cost numeric(18,4) not null default 0,
  unit_cost numeric(18,6) not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, product_id)
);

create table public.fnb_branch_product_cost_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  direction text not null,
  source_type text not null,
  source_reference_type text not null,
  source_reference_id uuid not null,
  source_stock_movement_id uuid,
  quantity numeric(18,4) not null,
  unit_cost numeric(18,6) not null,
  total_cost numeric(18,4) not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index on public.fnb_branch_product_cost_events(source_stock_movement_id)
  where source_stock_movement_id is not null;

create table public.internal_sales (
  id uuid primary key,
  tenant_id uuid not null,
  from_branch_id uuid not null,
  to_branch_id uuid not null
);
create table public.internal_sale_items (
  internal_sale_id uuid not null references public.internal_sales(id),
  product_id uuid not null,
  quantity numeric(18,4) not null,
  amount numeric(18,4) not null
);

-- The underlying commercial RPC is represented only at its document boundary.
-- The extracted production wrapper and ledger helpers are the code under test.
create function public._create_internal_sale_catalog_impl_00390(
  p_tenant_id uuid, p_from_branch_id uuid, p_to_branch_id uuid, p_created_by uuid,
  p_int_customer_id uuid, p_int_customer_name text, p_int_supplier_id uuid,
  p_int_supplier_name text, p_items jsonb, p_payment_method text,
  p_paid_full boolean, p_note text
) returns jsonb language plpgsql as $$
declare
  v_sale_id uuid := gen_random_uuid();
  v_item jsonb;
begin
  insert into public.internal_sales(id, tenant_id, from_branch_id, to_branch_id)
  values (v_sale_id, p_tenant_id, p_from_branch_id, p_to_branch_id);
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.internal_sale_items(internal_sale_id, product_id, quantity, amount)
    values (
      v_sale_id, (v_item->>'productId')::uuid,
      (v_item->>'quantity')::numeric,
      (v_item->>'quantity')::numeric * (v_item->>'unitPrice')::numeric
    );
  end loop;
  return jsonb_build_object('internal_sale_id', v_sale_id, 'code', 'TEST-ONLY');
end;
$$;
