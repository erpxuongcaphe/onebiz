-- Disposable test of the actual 00243 commercial RPC, 00387 catalog wrapper,
-- 00390 branch-cost wrapper and 00123 stock-out routing. BOM material handling,
-- physical stock helpers and lot reconciliation are bounded fixtures.
\set ON_ERROR_STOP on

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.profiles (
  id uuid primary key, tenant_id uuid not null, is_active boolean not null
);
create table public.branches (
  id uuid primary key, tenant_id uuid not null, cascade_mode text
);
create table public.products (
  id uuid primary key, tenant_id uuid not null, code text not null,
  name text not null, unit text not null, inventory_role text,
  is_active boolean not null, has_bom boolean not null, stock numeric not null
);
create table public.bom (
  product_id uuid not null, branch_id uuid, is_active boolean not null
);
create table public.branch_stock (
  tenant_id uuid not null, branch_id uuid not null, product_id uuid not null,
  quantity numeric not null,
  primary key (tenant_id, branch_id, product_id)
);
create table public.stock_movements (
  tenant_id uuid not null, branch_id uuid not null, product_id uuid not null,
  type text not null, quantity numeric not null, reference_type text not null,
  reference_id uuid not null, note text, created_by uuid
);
create table public.customers (
  id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
  name text not null, is_internal boolean not null
);
create table public.suppliers (
  id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
  name text not null, is_internal boolean not null
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  branch_id uuid not null, code text not null, customer_id uuid,
  customer_name text, status text, subtotal numeric, discount_amount numeric,
  tax_amount numeric, total numeric, paid numeric, debt numeric,
  payment_method text, source text, note text, created_by uuid
);
create table public.invoice_items (
  invoice_id uuid not null, product_id uuid not null, product_name text,
  unit text, quantity numeric, unit_price numeric, discount numeric,
  vat_rate numeric, vat_amount numeric, total numeric
);
create table public.input_invoices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  branch_id uuid not null, code text not null, supplier_id uuid,
  supplier_name text, total_amount numeric, tax_amount numeric,
  status text, note text, created_by uuid
);
create table public.cash_transactions (
  tenant_id uuid, branch_id uuid, code text, type text, category text,
  amount numeric, payment_method text, reference_type text,
  reference_id uuid, note text, created_by uuid
);
create table public.audit_log (
  tenant_id uuid, user_id uuid, action text, entity_type text,
  entity_id uuid, new_data jsonb
);
create table public.fnb_supply_catalog (
  tenant_id uuid not null, branch_id uuid not null, product_id uuid not null
);
create table public.lot_reconciliations (
  branch_id uuid not null, product_id uuid not null
);
create table public.bom_calls (
  branch_id uuid not null, product_id uuid not null, quantity numeric not null
);
create sequence public.document_test_seq;

\ir 00414_fnb_supply_to_bom_cost.setup.sql
drop function public._create_internal_sale_catalog_impl_00390(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
);
alter table public.internal_sales alter column id set default gen_random_uuid();
alter table public.internal_sales
  add column code text, add column invoice_id uuid, add column input_invoice_id uuid,
  add column status text, add column subtotal numeric, add column tax_amount numeric,
  add column total numeric, add column note text, add column created_by uuid;
alter table public.internal_sale_items
  add column product_code text, add column product_name text, add column unit text,
  add column unit_price numeric, add column vat_rate numeric, add column note text;

create function public.user_has_permission(uuid, text) returns boolean
language sql stable as $$ select true $$;
create function public.user_has_branch_access(uuid, uuid) returns boolean
language sql stable as $$
  select $2 in ('20000000-0000-0000-0000-000000000001'::uuid,
                '20000000-0000-0000-0000-000000000002'::uuid);
$$;
create function public.next_code(p_tenant uuid, p_type text) returns text
language sql as $$ select p_type || '-' || nextval('public.document_test_seq')::text $$;
create function public.next_cash_code(p_tenant uuid, p_type text) returns text
language sql as $$ select p_type || '-' || nextval('public.document_test_seq')::text $$;
create function public.increment_product_stock(p_product_id uuid, p_delta numeric)
returns void language sql as $$
  update public.products set stock = stock + p_delta where id = p_product_id;
$$;
create function public.upsert_branch_stock(
  p_tenant_id uuid, p_branch_id uuid, p_product_id uuid, p_delta numeric
) returns void language sql as $$
  insert into public.branch_stock values
    (p_tenant_id, p_branch_id, p_product_id, p_delta)
  on conflict (tenant_id, branch_id, product_id)
  do update set quantity = public.branch_stock.quantity + excluded.quantity;
$$;
create function public.allocate_lots_fifo(
  uuid, uuid, uuid, numeric, text, uuid
) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public._reconcile_product_lots_to_branch_00284(
  p_tenant uuid, p_branch uuid, p_product uuid, p_type text,
  p_reference uuid, p_actor uuid, p_note text
) returns jsonb language plpgsql as $$
begin
  insert into public.lot_reconciliations values (p_branch, p_product);
  return '{}'::jsonb;
end;
$$;
create function public.consume_bom_for_sale(
  p_tenant_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity numeric,
  p_reference_id uuid, p_created_by uuid, p_reference_code text, p_variant_id uuid
) returns jsonb language plpgsql as $$
begin
  if coalesce((select quantity from public.branch_stock
                where branch_id = p_branch_id
                  and product_id = '30000000-0000-0000-0000-000000000002'), 0) < p_quantity then
    raise exception 'INSUFFICIENT_BOM_MATERIAL';
  end if;
  insert into public.bom_calls values (p_branch_id, p_product_id, p_quantity);
  perform public.upsert_branch_stock(
    p_tenant_id, p_branch_id, '30000000-0000-0000-0000-000000000002', -p_quantity
  );
  perform public.increment_product_stock(
    '30000000-0000-0000-0000-000000000002', -p_quantity
  );
  insert into public.stock_movements values (
    p_tenant_id, p_branch_id, '30000000-0000-0000-0000-000000000002',
    'out', p_quantity, 'bom_consume', p_reference_id, p_reference_code, p_created_by
  );
  return '{}'::jsonb;
end;
$$;

\ir /tmp/fnb-internal-sale-stock-out.sql
\ir /tmp/fnb-internal-sale-documents.sql
\ir /tmp/fnb-supply-cost-flow.sql

insert into public.profiles values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', true
);
insert into public.branches values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'production'),
  ('20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'outlet');
insert into public.products values
  ('30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'SKU-ISOLATED',
   'Internal sale SKU', 'Goi', 'retail_sku', true, true, 0),
  ('30000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'NVL-ISOLATED',
   'Retail material', 'Goi', 'material', true, false, 5),
  ('30000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'SKU-NOT-APPROVED',
   'Disallowed SKU', 'Goi', 'retail_sku', true, false, 2);
insert into public.bom values
  ('30000000-0000-0000-0000-000000000001', null, true);
insert into public.branch_stock values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002', 5
);
insert into public.customers values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002', 'XTB', true
);
insert into public.suppliers values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'Retail', true
);
insert into public.fnb_supply_branch_scopes values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002', true
);
insert into public.fnb_supply_catalog values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001'
);
select set_config('request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

select public.create_internal_sale_atomic(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001',
  null, 'XTB', null, 'Retail',
  jsonb_build_array(jsonb_build_object(
    'productId', '30000000-0000-0000-0000-000000000001',
    'quantity', 2, 'unitPrice', 11000
  )), 'transfer', true, 'first isolated receipt'
);
select public.create_internal_sale_atomic(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001',
  null, 'XTB', null, 'Retail',
  jsonb_build_array(jsonb_build_object(
    'productId', '30000000-0000-0000-0000-000000000001',
    'quantity', 1, 'unitPrice', 13000
  )), 'debt', false, 'second isolated receipt'
);

do $$
begin
  if (select count(*) from public.internal_sales where status = 'completed') <> 2
     or (select count(*) from public.invoices
           where branch_id = '20000000-0000-0000-0000-000000000001'
             and status = 'completed') <> 2
     or (select count(*) from public.input_invoices
           where branch_id = '20000000-0000-0000-0000-000000000002'
             and status = 'recorded') <> 2
     or (select count(*) from public.cash_transactions) <> 2
     or (select count(*) from public.audit_log
           where entity_type = 'internal_sale') <> 2
     or (select count(*) from public.bom_calls) <> 2
     or (select quantity from public.branch_stock
           where branch_id = '20000000-0000-0000-0000-000000000001'
             and product_id = '30000000-0000-0000-0000-000000000002') <> 2
     or (select quantity from public.branch_stock
           where branch_id = '20000000-0000-0000-0000-000000000002'
             and product_id = '30000000-0000-0000-0000-000000000001') <> 3
     or exists (select 1 from public.stock_movements
           where branch_id = '20000000-0000-0000-0000-000000000001'
             and product_id = '30000000-0000-0000-0000-000000000001')
     or (select costed_quantity from public.fnb_branch_product_cost_balances
           where branch_id = '20000000-0000-0000-0000-000000000002') <> 3
     or (select total_cost from public.fnb_branch_product_cost_balances
           where branch_id = '20000000-0000-0000-0000-000000000002') <> 35000
     or exists (select 1 from public.fnb_branch_product_cost_events
           where branch_id = '20000000-0000-0000-0000-000000000001') then
    raise exception 'Internal sale did not preserve documents, stock and XTB cost';
  end if;
  if (select count(*) from public.invoices
        where total = 22000 and paid = 22000 and debt = 0) <> 1
     or (select count(*) from public.invoices
        where total = 13000 and paid = 0 and debt = 13000) <> 1 then
    raise exception 'Paid/debt invoice amounts do not match source prices';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.create_internal_sale_atomic(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000001',
      null, 'XTB', null, 'Retail',
      jsonb_build_array(jsonb_build_object(
        'productId', '30000000-0000-0000-0000-000000000003',
        'quantity', 1, 'unitPrice', 10000
      )), 'debt', false, 'not approved'
    );
    raise exception 'Unapproved SKU was accepted';
  exception when check_violation then
    if sqlerrm <> 'FNB_SUPPLY_CATALOG_REQUIRED' then raise; end if;
  end;
  begin
    perform public.create_internal_sale_atomic(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000001',
      null, 'XTB', null, 'Retail',
      jsonb_build_array(jsonb_build_object(
        'productId', '30000000-0000-0000-0000-000000000001',
        'quantity', 3, 'unitPrice', 11000
      )), 'debt', false, 'insufficient material'
    );
    raise exception 'Overdraw was accepted';
  exception when raise_exception then
    if sqlerrm <> 'INSUFFICIENT_BOM_MATERIAL' then raise; end if;
  end;
  if (select count(*) from public.internal_sales) <> 2
     or (select count(*) from public.invoices) <> 2
     or (select count(*) from public.input_invoices) <> 2
     or (select count(*) from public.stock_movements) <> 4
     or (select count(*) from public.fnb_branch_product_cost_events) <> 2 then
    raise exception 'Rejected sale left partial documents, stock or cost';
  end if;
end;
$$;
select '00419 actual internal-sale document/cost chain passed' as result;
