-- Capture exact source identity for new F&B sales only. No legacy backfill.
begin;

create table if not exists public.fnb_invoice_kitchen_line_sources (
  invoice_item_id uuid primary key references public.invoice_items(id) on delete restrict,
  kitchen_order_item_id uuid not null unique references public.kitchen_order_items(id) on delete restrict
);
alter table public.fnb_invoice_kitchen_line_sources enable row level security;
revoke all on table public.fnb_invoice_kitchen_line_sources from public, anon, authenticated;

create or replace function public._capture_fnb_kitchen_line_source_00423(
  p_invoice_item_id uuid, p_kitchen_order_item_id uuid
) returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1
      from public.invoice_items ii
      join public.invoices i on i.id = ii.invoice_id
      join public.kitchen_order_items ki on ki.id = p_kitchen_order_item_id
      join public.kitchen_orders ko on ko.id = ki.kitchen_order_id
     where ii.id = p_invoice_item_id
       and i.source = 'fnb'
       and i.tenant_id = ko.tenant_id and i.branch_id = ko.branch_id
       and (ko.invoice_id is null or ko.invoice_id = i.id)
       and ii.product_id = ki.product_id and ii.quantity = ki.quantity
       and ii.quantity > 0
  ) then
    raise exception 'FNB_KITCHEN_LINE_SOURCE_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.fnb_invoice_kitchen_line_sources(invoice_item_id, kitchen_order_item_id)
  values (p_invoice_item_id, p_kitchen_order_item_id)
  on conflict (invoice_item_id) do nothing;

  if not exists (
    select 1 from public.fnb_invoice_kitchen_line_sources s
     where s.invoice_item_id = p_invoice_item_id
       and s.kitchen_order_item_id = p_kitchen_order_item_id
  ) then
    raise exception 'FNB_KITCHEN_LINE_SOURCE_CONFLICT' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public._capture_fnb_kitchen_line_source_00423(uuid,uuid)
  from public, anon, authenticated;

do $patch$
declare
  v_target regprocedure := to_regprocedure(
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
  );
  v_definition text;
  v_count integer;
  v_select text := 'select product_id, variant_id, product_name, variant_label, quantity, unit_price, toppings,';
  v_insert text := 'returning id into v_invoice_item_id;';
begin
  if v_target is null then
    raise exception 'FNB_00423_PAYMENT_TARGET_MISSING' using errcode = 'P0001';
  end if;
  select replace(pg_get_functiondef(v_target::oid), E'\r\n', E'\n') into v_definition;
  if position('_capture_fnb_kitchen_line_source_00423' in v_definition) = 0 then
    select count(*) into v_count from regexp_matches(v_definition,
      'select product_id, variant_id, product_name, variant_label, quantity, unit_price, toppings,', 'g');
    if v_count <> 1 then
      raise exception 'FNB_00423_PAYMENT_SELECT_SHAPE_CHANGED' using errcode = 'P0001';
    end if;
    select count(*) into v_count from regexp_matches(v_definition,
      'returning id into v_invoice_item_id;', 'g');
    if v_count <> 1 then
      raise exception 'FNB_00423_PAYMENT_INSERT_SHAPE_CHANGED' using errcode = 'P0001';
    end if;
    v_definition := replace(v_definition, v_select,
      'select id as kitchen_order_item_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, toppings,');
    v_definition := replace(v_definition, v_insert,
      v_insert || E'\n    perform public._capture_fnb_kitchen_line_source_00423(v_invoice_item_id, r.kitchen_order_item_id);');
    execute v_definition;
  end if;
  select pg_get_functiondef(v_target::oid) into v_definition;
  if position('select id as kitchen_order_item_id,' in v_definition) = 0
     or position('_capture_fnb_kitchen_line_source_00423(v_invoice_item_id, r.kitchen_order_item_id)' in v_definition) = 0 then
    raise exception 'FNB_00423_INSTALL_INCOMPLETE' using errcode = 'P0001';
  end if;
end;
$patch$;

comment on table public.fnb_invoice_kitchen_line_sources is
  'Exact main-item source captured during new F&B checkout; no inferred links for legacy invoices or topping-only rows.';
commit;
