-- Disposable schema fixture for the 00410 migration integration test.
-- Run only in fnb_return_snapshot_test, never an application database.
\set ON_ERROR_STOP on

select 'create role anon nologin'
 where not exists (select 1 from pg_roles where rolname = 'anon') \gexec
select 'create role authenticated nologin'
 where not exists (select 1 from pg_roles where rolname = 'authenticated') \gexec
select 'create role service_role nologin'
 where not exists (select 1 from pg_roles where rolname = 'service_role') \gexec

create table public.products (id uuid primary key);
create table public.invoices (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  source text,
  deleted_at timestamptz
);
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit text not null,
  quantity numeric not null,
  unit_price numeric not null,
  discount numeric not null,
  vat_rate numeric not null,
  vat_amount numeric not null,
  total numeric not null,
  returned_qty numeric not null default 0
);
create table public.return_items (
  id bigint generated always as identity primary key,
  return_id uuid not null,
  invoice_item_id uuid references public.invoice_items(id),
  product_id uuid not null references public.products(id),
  quantity numeric not null
);
create table public.sales_returns (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id),
  tenant_id uuid not null,
  branch_id uuid not null,
  status text not null
);
create table public.stock_movements (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null references public.products(id),
  type text not null,
  quantity numeric not null,
  reference_type text not null,
  reference_id uuid,
  note text,
  created_by uuid
);

create function public.increment_product_stock(uuid, numeric)
returns void language plpgsql as $$ begin return; end; $$;
create function public.upsert_branch_stock(uuid, uuid, uuid, numeric)
returns void language plpgsql as $$ begin return; end; $$;
create function public.restore_bom_for_return(uuid, uuid, uuid, numeric, uuid, uuid, text, uuid)
returns jsonb language sql as $$ select '{"success":true,"bom_found":true,"legacy_restore_called":true}'::jsonb; $$;
create function public.consume_bom_for_sale(uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean, uuid)
returns jsonb language sql as $$ select '{"success":true,"bom_id":"00000000-0000-0000-0000-000000000001","consumed":[]}'::jsonb; $$;

create function public._fnb_complete_payment_impl_00230(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_invoice_id uuid;
  v_bom_result jsonb;
  v_vat_rate numeric;
  v_vat_amt numeric;
  v_line_before_tax numeric;
  r record;
begin
    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, r.product_id,
      case when r.variant_label is not null and r.variant_label <> ''
           then r.product_name || ' (' || r.variant_label || ')'
           else r.product_name end,
      'Cái', r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    );
    v_bom_result := public.consume_bom_for_sale(null, null, null, 1, null, null, null, null, false, null);
    v_bom_result := public.consume_bom_for_sale(null, null, null, 1, null, null, null, null, false, null);
    v_bom_result := public.consume_bom_for_sale(null, null, null, 1, null, null, null, null, false, null);
    v_bom_result := public.consume_bom_for_sale(null, null, null, 1, null, null, null, null, false, null);
    v_bom_result := public.consume_bom_for_sale(null, null, null, 1, null, null, null, null, false, null);
    return '{}'::jsonb;
end;
$function$;

create function public._create_sales_return_auth_impl_00244(
  uuid, jsonb, numeric, text, text, text, uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_restore_result jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_tenant_id uuid;
  v_invoice record;
  v_line record;
  v_qty numeric;
  v_return_id uuid;
  v_actor uuid;
  v_return_code text;
  v_variant_id uuid;
  v_invoice_item_id uuid;
begin
  v_restore_result := public.restore_bom_for_return(
        v_tenant_id,
        v_invoice.branch_id,
        v_line.product_id,
        v_qty,
        v_return_id,
        v_actor,
        v_return_code,
        v_variant_id
      );
  return '{}'::jsonb;
end;
$function$;
