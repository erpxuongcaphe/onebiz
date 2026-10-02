-- Disposable test of the real 00123 branch-routing and internal-sale stock-out
-- functions. BOM consumption and stock helpers are bounded fixture functions.
\set ON_ERROR_STOP on

create schema auth;
create table public.branches (
  id uuid primary key, cascade_mode text
);
create table public.products (
  id uuid primary key, has_bom boolean not null, stock numeric not null
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
create table public.bom_calls (
  branch_id uuid not null, product_id uuid not null, quantity numeric not null
);

create function public.consume_bom_for_sale(
  p_tenant_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity numeric,
  p_reference_id uuid, p_created_by uuid, p_reference_code text, p_variant_id uuid
) returns jsonb language plpgsql as $$
begin
  if (select quantity from public.branch_stock
       where branch_id = p_branch_id
         and product_id = '30000000-0000-0000-0000-000000000002') < p_quantity then
    raise exception 'INSUFFICIENT_BOM_MATERIAL';
  end if;
  insert into public.bom_calls values (p_branch_id, p_product_id, p_quantity);
  update public.branch_stock set quantity = quantity - p_quantity
   where branch_id = p_branch_id
     and product_id = '30000000-0000-0000-0000-000000000002';
  insert into public.stock_movements values (
    p_tenant_id, p_branch_id, '30000000-0000-0000-0000-000000000002',
    'out', p_quantity, 'bom_consume', p_reference_id, p_reference_code, p_created_by
  );
  return '{}'::jsonb;
end;
$$;
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

\ir /tmp/fnb-internal-sale-stock-out.sql

insert into public.branches values
  ('20000000-0000-0000-0000-000000000001', 'production'),
  ('20000000-0000-0000-0000-000000000002', 'outlet');
insert into public.products values
  ('30000000-0000-0000-0000-000000000001', true, 4),
  ('30000000-0000-0000-0000-000000000002', false, 5);
insert into public.bom values
  ('30000000-0000-0000-0000-000000000001', null, true);
insert into public.branch_stock values
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002', 3),
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000001', 4);

do $$
declare v_result jsonb;
begin
  if not public.should_cascade_bom_at_branch(
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001')
    or public.should_cascade_bom_at_branch(
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002') then
    raise exception 'Global BOM routing differs between Retail and outlet';
  end if;
  v_result := public.internal_sale_apply_stock_out(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', 2,
    '70000000-0000-0000-0000-000000000001', 'ISOLATED-RETAIL',
    '40000000-0000-0000-0000-000000000001');
  if v_result->>'method' <> 'cascade_bom'
     or (select stock from public.products
           where id = '30000000-0000-0000-0000-000000000001') <> 4
     or (select quantity from public.branch_stock
           where branch_id = '20000000-0000-0000-0000-000000000001'
             and product_id = '30000000-0000-0000-0000-000000000002') <> 1
     or exists (select 1 from public.stock_movements
           where product_id = '30000000-0000-0000-0000-000000000001') then
    raise exception 'Retail source decremented SKU rather than BOM material';
  end if;
end;
$$;

do $$
declare v_result jsonb;
begin
  v_result := public.internal_sale_apply_stock_out(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001', 1,
    '70000000-0000-0000-0000-000000000002', 'ISOLATED-OUTLET',
    '40000000-0000-0000-0000-000000000001');
  if v_result->>'method' <> 'direct_sku'
     or (select quantity from public.branch_stock
           where branch_id = '20000000-0000-0000-0000-000000000002'
             and product_id = '30000000-0000-0000-0000-000000000001') <> 3
     or (select stock from public.products
           where id = '30000000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'Outlet with global-only BOM did not deduct its SKU';
  end if;
end;
$$;

insert into public.bom values
  ('30000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002', true);
do $$
begin
  if not public.should_cascade_bom_at_branch(
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002') then
    raise exception 'Outlet-specific BOM did not enable cascade';
  end if;
  begin
    perform public.internal_sale_apply_stock_out(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001', 2,
      '70000000-0000-0000-0000-000000000003', 'ISOLATED-OVERDRAW',
      '40000000-0000-0000-0000-000000000001');
    raise exception 'Insufficient BOM material was accepted';
  exception when raise_exception then
    if sqlerrm <> 'INSUFFICIENT_BOM_MATERIAL' then raise; end if;
  end;
  if (select count(*) from public.bom_calls) <> 1
     or (select count(*) from public.stock_movements) <> 2
     or (select quantity from public.branch_stock
           where branch_id = '20000000-0000-0000-0000-000000000001'
             and product_id = '30000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'Failed BOM stock-out left a partial movement';
  end if;
end;
$$;
select '00418 internal-sale stock-out routing passed' as result;
