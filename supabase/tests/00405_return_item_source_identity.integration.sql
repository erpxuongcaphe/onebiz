-- Disposable PostgreSQL integration check for exact sales-return source identity.
-- Run only against a fresh test database, never against an application database.
\set ON_ERROR_STOP on

create table public.invoice_items (
  id uuid primary key,
  invoice_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  unit text not null,
  quantity numeric not null,
  total numeric not null
);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  unit text not null,
  quantity numeric not null,
  unit_price numeric not null,
  total numeric not null
);

create or replace function public._create_sales_return_auth_impl_00244(
  p_invoice_id uuid,
  p_items jsonb,
  p_refund_amount numeric,
  p_refund_method text,
  p_reason text,
  p_note text,
  p_actor uuid
) returns jsonb
language plpgsql
as $function$
declare
  v_return_id uuid := '30000000-0000-0000-0000-000000000001';
  v_invoice_item_id uuid;
  v_line record;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_invoice_item_id := (v_item->>'invoiceItemId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    select ii.id, ii.product_id, ii.product_name, ii.unit, ii.quantity, ii.total
      into strict v_line
      from public.invoice_items ii
     where ii.id = v_invoice_item_id and ii.invoice_id = p_invoice_id;

    v_unit_price := v_line.total / v_line.quantity;
    v_line_total := round(v_qty * v_unit_price, 2);
    insert into public.return_items (
      return_id, product_id, product_name, unit, quantity, unit_price, total
    ) values (
      v_return_id, v_line.product_id, v_line.product_name, v_line.unit,
      v_qty, v_unit_price, v_line_total
    );
  end loop;

  return jsonb_build_object('returnId', v_return_id);
end;
$function$;

insert into public.invoice_items(
  id, invoice_id, product_id, product_name, unit, quantity, total
) values (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  'Xuong Gu Viet (Size L)', 'Ly', 2, 54000
);

-- A historical row must remain unlinked after the migration.
insert into public.return_items(
  return_id, product_id, product_name, unit, quantity, unit_price, total
) values (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  'Legacy item', 'Cai', 1, 10000, 10000
);

\ir ../migrations/00405_return_item_source_identity.sql

select public._create_sales_return_auth_impl_00244(
  '10000000-0000-0000-0000-000000000002',
  '[{"invoiceItemId":"10000000-0000-0000-0000-000000000001","quantity":1}]',
  27000, 'cash', 'Test', null,
  '10000000-0000-0000-0000-000000000004'
);

do $$
declare
  v_new record;
  v_legacy record;
begin
  select * into strict v_new
    from public.return_items
   where return_id = '30000000-0000-0000-0000-000000000001';

  if v_new.invoice_item_id <> '10000000-0000-0000-0000-000000000001'::uuid
     or v_new.product_name <> 'Xuong Gu Viet (Size L)'
     or v_new.unit_price <> 27000 then
    raise exception 'new return row lost exact source identity: %', row_to_json(v_new);
  end if;

  select * into strict v_legacy
    from public.return_items
   where return_id = '20000000-0000-0000-0000-000000000001';

  if v_legacy.invoice_item_id is not null then
    raise exception 'historical return row was unexpectedly rewritten: %', row_to_json(v_legacy);
  end if;
end;
$$;
