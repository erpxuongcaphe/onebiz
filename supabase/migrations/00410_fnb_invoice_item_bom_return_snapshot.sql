-- 00410: Restore F&B BOM quantities from the exact sale-line consumption.
--
-- Existing invoices and return documents are intentionally untouched. New
-- F&B checkouts snapshot the BOM quantities returned by consume_bom_for_sale;
-- later returns prorate that exact snapshot instead of re-reading today's BOM.
begin;
set local lock_timeout = '1s';

do $preflight$
begin
  if to_regprocedure('public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)') is null
     or to_regprocedure('public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)') is null
     or to_regprocedure('public.restore_bom_for_return(uuid,uuid,uuid,numeric,uuid,uuid,text,uuid)') is null
     or to_regprocedure('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'return_items'
          and column_name = 'invoice_item_id'
     ) then
    raise exception using errcode = 'P0001', message = 'FNB_00410_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create table if not exists public.fnb_invoice_item_bom_snapshots_00410 (
  invoice_item_id uuid primary key references public.invoice_items(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  tenant_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fnb_invoice_item_bom_snapshot_components_00410 (
  id bigint generated always as identity primary key,
  invoice_item_id uuid not null references public.fnb_invoice_item_bom_snapshots_00410(invoice_item_id) on delete restrict,
  material_id uuid not null references public.products(id) on delete restrict,
  unit text not null,
  quantity numeric(18,4) not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists fnb_invoice_item_bom_components_lookup_00410
  on public.fnb_invoice_item_bom_snapshot_components_00410(invoice_item_id, material_id);

alter table public.fnb_invoice_item_bom_snapshots_00410 enable row level security;
alter table public.fnb_invoice_item_bom_snapshot_components_00410 enable row level security;

create or replace function public._capture_fnb_invoice_item_bom_snapshot_00410(
  p_invoice_item_id uuid,
  p_invoice_id uuid,
  p_consumption jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_invoice record;
  v_component jsonb;
  v_material_id uuid;
  v_quantity numeric(18,4);
begin
  if p_invoice_item_id is null or p_invoice_id is null
     or jsonb_typeof(p_consumption) <> 'object'
     or coalesce((p_consumption->>'success')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'FNB_BOM_SNAPSHOT_INPUT_INVALID';
  end if;

  select i.tenant_id, i.branch_id, i.source
    into v_invoice
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
   where ii.id = p_invoice_item_id and ii.invoice_id = p_invoice_id
     and i.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_BOM_SNAPSHOT_INVOICE_INVALID';
  end if;
  if v_invoice.source is distinct from 'fnb' then
    raise exception using errcode = 'P0001', message = 'FNB_BOM_SNAPSHOT_INVOICE_INVALID';
  end if;

  -- No active BOM means no recipe snapshot. This also keeps modifier-only
  -- calls (which deliberately skip the main BOM) out of the recipe ledger.
  if nullif(p_consumption->>'bom_id', '') is null then
    return;
  end if;

  insert into public.fnb_invoice_item_bom_snapshots_00410 (
    invoice_item_id, invoice_id, tenant_id, branch_id
  ) values (
    p_invoice_item_id, p_invoice_id, v_invoice.tenant_id, v_invoice.branch_id
  ) on conflict (invoice_item_id) do nothing;

  if jsonb_typeof(p_consumption->'consumed') <> 'array' then
    raise exception using errcode = 'P0001', message = 'FNB_BOM_SNAPSHOT_COMPONENTS_INVALID';
  end if;

  for v_component in
    select value from jsonb_array_elements(p_consumption->'consumed')
  loop
    -- Toppings are a separate stock-consumption path, not recipe ingredients.
    if coalesce(v_component->>'kind', '') = 'modifier_topping' then
      continue;
    end if;

    begin
      v_material_id := nullif(v_component->>'material_id', '')::uuid;
      v_quantity := nullif(v_component->>'qty', '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'FNB_BOM_SNAPSHOT_COMPONENT_INVALID';
    end;

    if v_material_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = 'P0001', message = 'FNB_BOM_SNAPSHOT_COMPONENT_INVALID';
    end if;

    insert into public.fnb_invoice_item_bom_snapshot_components_00410 (
      invoice_item_id, material_id, unit, quantity
    ) values (
      p_invoice_item_id, v_material_id, coalesce(nullif(v_component->>'unit', ''), ''), v_quantity
    );
  end loop;
end;
$function$;

create or replace function public._restore_fnb_invoice_item_bom_00410(
  p_invoice_item_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_quantity numeric,
  p_return_id uuid,
  p_created_by uuid,
  p_return_code text,
  p_variant_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_return record;
  v_sale record;
  v_component record;
  v_snapshot_exists boolean;
  v_prior_return_qty numeric(18,4);
  v_restore_qty numeric(18,4);
  v_restored jsonb := '[]'::jsonb;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_BOM_QUANTITY_INVALID';
  end if;

  select sr.invoice_id, sr.tenant_id, sr.branch_id, ri.quantity, i.source as invoice_source
    into v_return
    from public.sales_returns sr
    join public.return_items ri on ri.return_id = sr.id
    join public.invoices i on i.id = sr.invoice_id
   where sr.id = p_return_id
     and ri.invoice_item_id = p_invoice_item_id
     and ri.product_id = p_sku_id
     and ri.quantity = p_quantity
     and sr.tenant_id = p_tenant_id
     and sr.branch_id = p_branch_id
     and sr.status = 'completed';
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_BOM_SOURCE_LINE_INVALID';
  end if;

  if v_return.invoice_source is distinct from 'fnb' then
    return public.restore_bom_for_return(
      p_tenant_id, p_branch_id, p_sku_id, p_quantity,
      p_return_id, p_created_by, p_return_code, p_variant_id
    );
  end if;

  select exists (
    select 1 from public.fnb_invoice_item_bom_snapshots_00410 s
     where s.invoice_item_id = p_invoice_item_id
       and s.invoice_id = v_return.invoice_id
       and s.tenant_id = p_tenant_id
       and s.branch_id = p_branch_id
  ) into v_snapshot_exists;

  if not v_snapshot_exists then
    -- Backward-compatible path for invoices created before this migration.
    -- It is surfaced to the return RPC as a warning; no history is backfilled.
    return coalesce(public.restore_bom_for_return(
      p_tenant_id, p_branch_id, p_sku_id, p_quantity,
      p_return_id, p_created_by, p_return_code, p_variant_id
    ), '{}'::jsonb) || jsonb_build_object('snapshot_mode', 'legacy_active_bom');
  end if;

  select ii.quantity, coalesce(ii.returned_qty, 0) as returned_qty
    into v_sale
    from public.invoice_items ii
   where ii.id = p_invoice_item_id
     and ii.invoice_id = v_return.invoice_id
     and ii.product_id = p_sku_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_BOM_QUANTITY_EXCEEDED';
  end if;
  if v_sale.quantity is null or v_sale.quantity <= 0
     or v_sale.returned_qty + p_quantity > v_sale.quantity + 0.0001 then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_BOM_QUANTITY_EXCEEDED';
  end if;
  v_prior_return_qty := v_sale.returned_qty;

  for v_component in
    select c.material_id, c.unit, sum(c.quantity)::numeric(18,4) as source_quantity
      from public.fnb_invoice_item_bom_snapshot_components_00410 c
     where c.invoice_item_id = p_invoice_item_id
     group by c.material_id, c.unit
     order by c.material_id, c.unit
  loop
    -- Compute a cumulative rounded target so a sequence of partial returns
    -- restores exactly the original quantity when the line is fully returned.
    v_restore_qty := round(
      v_component.source_quantity * (v_prior_return_qty + p_quantity) / v_sale.quantity,
      4
    ) - round(
      v_component.source_quantity * v_prior_return_qty / v_sale.quantity,
      4
    );
    if v_restore_qty <= 0 then
      continue;
    end if;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_component.material_id, 'in', v_restore_qty,
      'return_bom_restore', p_return_id,
      format('Hoan NVL theo BOM snapshot - %s - dong HĐ %s',
        coalesce(p_return_code, p_return_id::text), p_invoice_item_id),
      p_created_by
    );

    perform public.increment_product_stock(v_component.material_id, v_restore_qty);
    perform public.upsert_branch_stock(
      p_tenant_id, p_branch_id, v_component.material_id, v_restore_qty
    );
    v_restored := v_restored || jsonb_build_object(
      'material_id', v_component.material_id,
      'quantity', v_restore_qty,
      'unit', v_component.unit
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'bom_found', true,
    'snapshot_mode', 'invoice_item',
    'invoice_item_id', p_invoice_item_id,
    'restored', v_restored
  );
end;
$function$;

alter function public._capture_fnb_invoice_item_bom_snapshot_00410(uuid,uuid,jsonb) owner to postgres;
alter function public._restore_fnb_invoice_item_bom_00410(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,uuid) owner to postgres;
revoke all on function public._capture_fnb_invoice_item_bom_snapshot_00410(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public._restore_fnb_invoice_item_bom_00410(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_payment_oid regprocedure := to_regprocedure(
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
  );
  v_return_oid regprocedure := to_regprocedure(
    'public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)'
  );
  v_payment_definition text;
  v_return_definition text;
  v_old_invoice_item_insert constant text := $old_insert$
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
$old_insert$;
  v_new_invoice_item_insert constant text := $new_insert$
    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, r.product_id,
      case when r.variant_label is not null and r.variant_label <> ''
           then r.product_name || ' (' || r.variant_label || ')'
           else r.product_name end,
      'Cái', r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    ) returning id into v_invoice_item_id;
$new_insert$;
  v_new_return_call constant text := $new_return$
      v_restore_result := public._restore_fnb_invoice_item_bom_00410(
        v_invoice_item_id, v_tenant_id, v_invoice.branch_id, v_line.product_id, v_qty,
        v_return_id, v_actor, v_return_code, v_variant_id
      );
      if v_restore_result->>'snapshot_mode' = 'legacy_active_bom' then
        v_warnings := v_warnings || jsonb_build_object(
          'code', 'FNB_RETURN_LEGACY_BOM_FALLBACK',
          'invoice_item_id', v_invoice_item_id,
          'message', 'Hoa don cu chua co snapshot BOM; he thong dang dung BOM hien hanh.'
        );
      end if;
$new_return$;
  v_count integer;
begin
  if v_payment_oid is null or v_return_oid is null then
    raise exception using errcode = 'P0001', message = 'FNB_00410_PATCH_TARGET_MISSING';
  end if;

  select pg_get_functiondef(v_payment_oid::oid) into v_payment_definition;
  v_payment_definition := replace(v_payment_definition, E'\r\n', E'\n');
  if position('v_invoice_item_id uuid;' in v_payment_definition) = 0 then
    select count(*)::integer into v_count
      from regexp_matches(v_payment_definition, 'v_invoice_id uuid;', 'g');
    if v_count <> 1 then
      raise exception using errcode = 'P0001', message = 'FNB_00410_PAYMENT_DECLARATION_SHAPE_CHANGED';
    end if;
    v_payment_definition := replace(
      v_payment_definition,
      'v_invoice_id uuid;',
      E'v_invoice_id uuid;\n  v_invoice_item_id uuid;'
    );
  end if;

  if position('returning id into v_invoice_item_id' in v_payment_definition) = 0 then
    if position(v_old_invoice_item_insert in v_payment_definition) = 0 then
      raise exception using errcode = 'P0001', message = 'FNB_00410_PAYMENT_INVOICE_ITEM_SHAPE_CHANGED';
    end if;
    v_payment_definition := replace(
      v_payment_definition, v_old_invoice_item_insert, v_new_invoice_item_insert
    );
  end if;

  if position('_capture_fnb_invoice_item_bom_snapshot_00410' in v_payment_definition) = 0 then
    select count(*)::integer into v_count
      from regexp_matches(
        v_payment_definition,
        'v_bom_result := public\.consume_bom_for_sale\(',
        'g'
      );
    if v_count <> 5 then
      raise exception using errcode = 'P0001', message = 'FNB_00410_PAYMENT_CONSUME_CALL_COUNT_CHANGED', detail = v_count::text;
    end if;
    v_payment_definition := regexp_replace(
      v_payment_definition,
      'v_bom_result := public\.consume_bom_for_sale\((.*?)\);',
      $replacement$v_bom_result := public.consume_bom_for_sale(\1);
      perform public._capture_fnb_invoice_item_bom_snapshot_00410(
        v_invoice_item_id, v_invoice_id, v_bom_result
      );$replacement$,
      'gs'
    );
  end if;
  execute v_payment_definition;

  select pg_get_functiondef(v_return_oid::oid) into v_return_definition;
  v_return_definition := replace(v_return_definition, E'\r\n', E'\n');
  if position('_restore_fnb_invoice_item_bom_00410' in v_return_definition) = 0 then
    select count(*)::integer into v_count
      from regexp_matches(
        v_return_definition,
        'v_restore_result := public\.restore_bom_for_return\(\s*v_tenant_id,\s*v_invoice\.branch_id,\s*v_line\.product_id,\s*v_qty,\s*v_return_id,\s*v_actor,\s*v_return_code,\s*v_variant_id\s*\);',
        'g'
      );
    if v_count <> 1 then
      raise exception using errcode = 'P0001', message = 'FNB_00410_RETURN_RESTORE_SHAPE_CHANGED', detail = v_count::text;
    end if;
    v_return_definition := regexp_replace(
      v_return_definition,
      'v_restore_result := public\.restore_bom_for_return\(\s*v_tenant_id,\s*v_invoice\.branch_id,\s*v_line\.product_id,\s*v_qty,\s*v_return_id,\s*v_actor,\s*v_return_code,\s*v_variant_id\s*\);',
      v_new_return_call,
      'g'
    );
  end if;
  execute v_return_definition;
end;
$patch$;

do $verify$
declare
  v_payment_definition text;
  v_return_definition text;
begin
  select pg_get_functiondef(
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'::regprocedure
  ) into v_payment_definition;
  select pg_get_functiondef(
    'public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ) into v_return_definition;

  if position('returning id into v_invoice_item_id' in v_payment_definition) = 0
     or position('_capture_fnb_invoice_item_bom_snapshot_00410' in v_payment_definition) = 0
     or position('_restore_fnb_invoice_item_bom_00410' in v_return_definition) = 0
     or position('FNB_RETURN_LEGACY_BOM_FALLBACK' in v_return_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00410_INSTALL_INCOMPLETE';
  end if;
end;
$verify$;

comment on table public.fnb_invoice_item_bom_snapshots_00410 is
  '00410: future-only F&B invoice-line marker for immutable BOM issue snapshots; historical invoices are not backfilled.';
comment on table public.fnb_invoice_item_bom_snapshot_components_00410 is
  '00410: exact BOM material quantities issued for one F&B invoice line; returns prorate this source instead of reading the active BOM.';

commit;

