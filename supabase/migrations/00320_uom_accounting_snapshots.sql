-- 00320: Unit conversion snapshots for purchasing and BOM accounting.
-- Additive only: no existing business row is updated.

begin;

-- Preserve supplier prices and stock quantities after division by a UOM
-- factor. This widens precision only; existing numeric values are unchanged.
alter table public.purchase_order_items
  alter column quantity type numeric(18,4),
  alter column received_quantity type numeric(18,4),
  alter column unit_price type numeric(24,8);

alter table public.purchase_order_items
  add column if not exists transaction_quantity numeric(18,4),
  add column if not exists transaction_unit text,
  add column if not exists transaction_unit_price numeric(24,8),
  add column if not exists conversion_factor numeric(20,8);

comment on column public.purchase_order_items.transaction_quantity is
  'Quantity entered on the supplier document; null on legacy rows.';
comment on column public.purchase_order_items.transaction_unit is
  'Unit entered on the supplier document; null on legacy rows.';
comment on column public.purchase_order_items.transaction_unit_price is
  'Price per transaction unit; null on legacy rows.';
comment on column public.purchase_order_items.conversion_factor is
  'Snapshot: stock quantity represented by one transaction unit.';

alter table public.bom_items
  add column if not exists input_quantity numeric(18,8),
  add column if not exists input_unit text,
  add column if not exists conversion_factor numeric(20,8);

comment on column public.bom_items.input_quantity is
  'Recipe quantity entered by the user; null on legacy rows.';
comment on column public.bom_items.input_unit is
  'Recipe unit entered by the user; null on legacy rows.';
comment on column public.bom_items.conversion_factor is
  'Snapshot: stock quantity represented by one recipe unit.';

create unique index if not exists idx_uom_conversions_active_pair_unique
on public.uom_conversions (
  tenant_id, product_id, lower(trim(from_unit)), lower(trim(to_unit))
)
where is_active;

do $$
begin
  if exists (
    select 1 from public.uom_conversions
    where is_active
      and (
        factor is null
        or factor < 0.0001
        or nullif(trim(from_unit), '') is null
        or nullif(trim(to_unit), '') is null
        or lower(trim(from_unit)) = lower(trim(to_unit))
      )
  ) then
    raise exception using errcode = '22023', message = 'UOM_INVALID_ACTIVE_CONVERSION';
  end if;
end;
$$;

create or replace function public.resolve_product_uom_factor(
  p_tenant_id uuid,
  p_product_id uuid,
  p_input_unit text
) returns numeric
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stock_unit text;
  v_factor numeric;
  v_matches int;
begin
  if p_tenant_id is null or p_product_id is null or nullif(trim(p_input_unit), '') is null then
    raise exception using errcode = '22023', message = 'UOM_INPUT_REQUIRED';
  end if;

  select p.unit into v_stock_unit
  from public.products p
  where p.id = p_product_id
    and p.tenant_id = p_tenant_id
    and coalesce(p.is_active, true);

  if v_stock_unit is null then
    raise exception using errcode = '22023', message = 'UOM_PRODUCT_NOT_FOUND';
  end if;

  if lower(trim(p_input_unit)) = lower(trim(v_stock_unit)) then
    return 1;
  end if;

  select count(*), min(factor)
    into v_matches, v_factor
  from (
    select c.factor
    from public.uom_conversions c
    where c.tenant_id = p_tenant_id
      and c.product_id = p_product_id
      and c.is_active
      and lower(trim(c.from_unit)) = lower(trim(p_input_unit))
      and lower(trim(c.to_unit)) = lower(trim(v_stock_unit))
    union all
    select 1 / c.factor
    from public.uom_conversions c
    where c.tenant_id = p_tenant_id
      and c.product_id = p_product_id
      and c.is_active
      and c.factor > 0
      and lower(trim(c.to_unit)) = lower(trim(p_input_unit))
      and lower(trim(c.from_unit)) = lower(trim(v_stock_unit))
  ) q;

  if v_matches = 0 then
    raise exception using errcode = '22023', message = 'UOM_CONVERSION_NOT_FOUND';
  end if;
  if v_matches > 1 or v_factor is null or v_factor < 0.000001 then
    raise exception using errcode = '22023', message = 'UOM_CONVERSION_AMBIGUOUS';
  end if;

  return v_factor;
end;
$$;

revoke all on function public.resolve_product_uom_factor(uuid, uuid, text) from public;
grant execute on function public.resolve_product_uom_factor(uuid, uuid, text) to authenticated;

create or replace function public.replace_product_uom_conversions_atomic(
  p_product_id uuid,
  p_stock_unit text,
  p_conversions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_stock_unit text;
  v_old_stock_unit text;
  v_item jsonb;
  v_from_unit text;
  v_to_unit text;
  v_related_unit text;
  v_factor numeric;
  v_seen_related_units text[] := array[]::text[];
  v_old_data jsonb;
  v_new_data jsonb;
  v_count int := 0;
begin
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);

  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.edit') then
    raise exception using errcode = '42501', message = 'PRODUCT_UOM_PERMISSION_DENIED';
  end if;
  if p_product_id is null
     or p_conversions is null
     or jsonb_typeof(p_conversions) <> 'array' then
    raise exception using errcode = '22023', message = 'PRODUCT_UOM_INPUT_INVALID';
  end if;
  if jsonb_array_length(p_conversions) > 20 then
    raise exception using errcode = '22023', message = 'PRODUCT_UOM_TOO_MANY_CONVERSIONS';
  end if;

  if nullif(trim(p_stock_unit), '') is null then
    raise exception using errcode = '22023', message = 'PRODUCT_STOCK_UNIT_REQUIRED';
  end if;

  select p.unit into v_stock_unit
  from public.products p
  where p.id = p_product_id
    and p.tenant_id = v_tenant_id
    and coalesce(p.is_active, true)
  for update;

  if v_stock_unit is null or nullif(trim(v_stock_unit), '') is null then
    raise exception using errcode = '22023', message = 'PRODUCT_UOM_PRODUCT_NOT_FOUND';
  end if;
  v_old_stock_unit := trim(v_stock_unit);

  if lower(trim(p_stock_unit)) <> lower(trim(v_stock_unit))
     and (
       exists (select 1 from public.stock_movements sm where sm.product_id = p_product_id)
       or exists (select 1 from public.branch_stock bs where bs.product_id = p_product_id and bs.quantity <> 0)
       or exists (select 1 from public.purchase_order_items poi where poi.product_id = p_product_id)
       or exists (select 1 from public.invoice_items ii where ii.product_id = p_product_id)
       or exists (select 1 from public.bom_items bi where bi.material_id = p_product_id)
     ) then
    raise exception using
      errcode = '55000',
      message = 'PRODUCT_STOCK_UNIT_LOCKED_BY_HISTORY';
  end if;

  update public.products
  set unit = trim(p_stock_unit),
      purchase_unit = trim(p_stock_unit),
      stock_unit = trim(p_stock_unit),
      sell_unit = trim(p_stock_unit)
  where id = p_product_id and tenant_id = v_tenant_id;
  v_stock_unit := trim(p_stock_unit);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'from_unit', c.from_unit,
        'to_unit', c.to_unit,
        'factor', c.factor
      ) order by lower(c.from_unit), lower(c.to_unit)
    ),
    '[]'::jsonb
  ) into v_old_data
  from public.uom_conversions c
  where c.tenant_id = v_tenant_id
    and c.product_id = p_product_id
    and c.is_active;

  -- Validate the complete requested set before changing any row. Every row
  -- must connect directly to the stock unit; inferred conversion chains are
  -- deliberately rejected because they are unsafe for accounting documents.
  for v_item in select value from jsonb_array_elements(p_conversions)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'PRODUCT_UOM_ROW_INVALID';
    end if;
    begin
      v_from_unit := trim(v_item->>'from_unit');
      v_to_unit := trim(v_item->>'to_unit');
      v_factor := (v_item->>'factor')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'PRODUCT_UOM_ROW_INVALID';
    end;

    if nullif(v_from_unit, '') is null
       or nullif(v_to_unit, '') is null
       or v_factor is null
       or v_factor < 0.0001
       or v_factor > 1000000000
       or lower(v_from_unit) = lower(v_to_unit) then
      raise exception using errcode = '22023', message = 'PRODUCT_UOM_ROW_INVALID';
    end if;

    if lower(v_from_unit) = lower(trim(v_stock_unit)) then
      v_related_unit := lower(v_to_unit);
    elsif lower(v_to_unit) = lower(trim(v_stock_unit)) then
      v_related_unit := lower(v_from_unit);
    else
      raise exception using errcode = '22023', message = 'PRODUCT_UOM_MUST_CONNECT_TO_STOCK_UNIT';
    end if;

    if v_related_unit = any(v_seen_related_units) then
      raise exception using errcode = '22023', message = 'PRODUCT_UOM_DUPLICATE_RELATED_UNIT';
    end if;
    v_seen_related_units := array_append(v_seen_related_units, v_related_unit);
  end loop;

  update public.uom_conversions c
  set is_active = false
  where c.tenant_id = v_tenant_id
    and c.product_id = p_product_id
    and c.is_active;

  for v_item in select value from jsonb_array_elements(p_conversions)
  loop
    v_from_unit := trim(v_item->>'from_unit');
    v_to_unit := trim(v_item->>'to_unit');
    v_factor := (v_item->>'factor')::numeric;

    insert into public.uom_conversions (
      tenant_id, product_id, from_unit, to_unit, factor, is_active
    ) values (
      v_tenant_id, p_product_id, v_from_unit, v_to_unit, v_factor, true
    );
    v_count := v_count + 1;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'from_unit', c.from_unit,
        'to_unit', c.to_unit,
        'factor', c.factor
      ) order by lower(c.from_unit), lower(c.to_unit)
    ),
    '[]'::jsonb
  ) into v_new_data
  from public.uom_conversions c
  where c.tenant_id = v_tenant_id
    and c.product_id = p_product_id
    and c.is_active;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'product_uom_conversions_replaced',
    'product',
    p_product_id,
    jsonb_build_object('stock_unit', v_old_stock_unit, 'conversions', v_old_data),
    jsonb_build_object('stock_unit', v_stock_unit, 'conversions', v_new_data)
  );

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'stock_unit', v_stock_unit,
    'conversion_count', v_count
  );
end;
$$;

revoke all on function public.replace_product_uom_conversions_atomic(uuid, text, jsonb)
  from public, anon;
grant execute on function public.replace_product_uom_conversions_atomic(uuid, text, jsonb)
  to authenticated;

-- Conversion configuration is writable only through the audited RPC above.
-- Reads remain available to authenticated users under the table's RLS.
revoke insert, update, delete on table public.uom_conversions
  from authenticated, anon;

create or replace function public.save_purchase_order_with_uom_atomic(
  p_purchase_order_id uuid, p_requested_code text, p_branch_id uuid,
  p_supplier_id uuid, p_note text, p_shipping_cost numeric,
  p_other_cost numeric, p_order_discount numeric, p_paid_amount numeric,
  p_payment_method text, p_mark_ordered boolean, p_receive_now boolean,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_item jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_input_quantity numeric;
  v_input_price numeric;
  v_input_unit text;
  v_factor numeric;
  v_normalized_quantity numeric;
  v_normalized_price numeric;
  v_result jsonb;
  v_order_id uuid;
begin
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    group by x->>'product_id' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_DUPLICATE_PRODUCT';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_input_quantity := (v_item->>'quantity')::numeric;
      v_input_price := (v_item->>'unit_price')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEM_FORMAT_INVALID';
    end;
    if v_input_quantity <= 0 or v_input_price < 0 then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEM_AMOUNT_INVALID';
    end if;
    select coalesce(nullif(trim(v_item->>'unit'), ''), p.unit)
      into v_input_unit
    from public.products p
    where p.id = v_product_id and p.tenant_id = v_tenant_id
      and coalesce(p.is_active, true);
    if v_input_unit is null then
      raise exception using errcode = '22023', message = 'PRODUCT_NOT_FOUND';
    end if;
    v_factor := public.resolve_product_uom_factor(v_tenant_id, v_product_id, v_input_unit);
    v_normalized_quantity := round(v_input_quantity * v_factor, 4);
    if v_normalized_quantity <= 0 then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NORMALIZED_QUANTITY_INVALID';
    end if;
    -- Preserve the supplier-document line value exactly after quantity rounding.
    v_normalized_price := (v_input_quantity * v_input_price) / v_normalized_quantity;
    v_normalized_items := v_normalized_items ||
      jsonb_set(
        jsonb_set(v_item, '{quantity}', to_jsonb(v_normalized_quantity)),
        '{unit_price}', to_jsonb(v_normalized_price)
      );
  end loop;

  v_result := public.save_purchase_order_atomic(
    p_purchase_order_id, p_requested_code, p_branch_id, p_supplier_id,
    p_note, p_shipping_cost, p_other_cost, p_order_discount, p_paid_amount,
    p_payment_method, p_mark_ordered, p_receive_now, v_normalized_items
  );
  v_order_id := (v_result->>'purchase_order_id')::uuid;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_input_quantity := (v_item->>'quantity')::numeric;
    v_input_price := (v_item->>'unit_price')::numeric;
    select coalesce(nullif(trim(v_item->>'unit'), ''), p.unit)
      into v_input_unit
    from public.products p
    where p.id = v_product_id and p.tenant_id = v_tenant_id;
    v_factor := public.resolve_product_uom_factor(v_tenant_id, v_product_id, v_input_unit);
    update public.purchase_order_items poi
    set transaction_quantity = v_input_quantity,
        transaction_unit = v_input_unit,
        transaction_unit_price = v_input_price,
        conversion_factor = v_factor
    where poi.purchase_order_id = v_order_id and poi.product_id = v_product_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'PURCHASE_ORDER_SNAPSHOT_FAILED';
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.save_purchase_order_with_uom_atomic(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric,
  text, boolean, boolean, jsonb
) from public;
grant execute on function public.save_purchase_order_with_uom_atomic(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric,
  text, boolean, boolean, jsonb
) to authenticated;

create or replace function public.update_purchase_order_prices_with_uom(
  p_order_id uuid,
  p_items jsonb,
  p_supplier_id uuid default null,
  p_supplier_name text default null,
  p_note text default null,
  p_shipping_cost numeric default null,
  p_other_cost numeric default null,
  p_order_discount numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_item jsonb;
  v_row record;
  v_transaction_price numeric;
  v_stock_price numeric;
  v_normalized_items jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  select po.branch_id into v_branch_id
  from public.purchase_orders po
  where po.id = p_order_id and po.tenant_id = v_tenant_id;
  if v_branch_id is null or not public.user_has_branch_access(v_actor, v_branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_PRICE_ITEMS';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select poi.id, poi.quantity, poi.unit_price,
           coalesce(poi.transaction_quantity, poi.quantity) as transaction_quantity
      into v_row
    from public.purchase_order_items poi
    join public.purchase_orders po
      on po.id = poi.purchase_order_id
     and po.tenant_id = v_tenant_id
    where poi.id = (v_item->>'id')::uuid
      and poi.purchase_order_id = p_order_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEM_NOT_FOUND';
    end if;

    v_transaction_price := coalesce((v_item->>'unit_price')::numeric, v_row.unit_price);
    if v_transaction_price < 0 or v_row.quantity <= 0 or v_row.transaction_quantity <= 0 then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEM_AMOUNT_INVALID';
    end if;
    -- The legacy price RPC expects price per canonical stock unit.
    v_stock_price := (v_row.transaction_quantity * v_transaction_price) / v_row.quantity;
    v_normalized_items := v_normalized_items ||
      jsonb_set(v_item, '{unit_price}', to_jsonb(v_stock_price));
  end loop;

  v_result := public.update_purchase_order_prices(
    p_order_id, v_normalized_items, p_supplier_id, p_supplier_name, p_note,
    p_shipping_cost, p_other_cost, p_order_discount
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item ? 'unit_price' and v_item->>'unit_price' is not null then
      update public.purchase_order_items
      set transaction_unit_price = (v_item->>'unit_price')::numeric
      where id = (v_item->>'id')::uuid and purchase_order_id = p_order_id;
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.update_purchase_order_prices_with_uom(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
) from public;
grant execute on function public.update_purchase_order_prices_with_uom(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
) to authenticated;

create or replace function public.receive_purchase_items_with_uom_atomic(
  p_order_id uuid,
  p_lines jsonb default null,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_transaction_qty numeric;
  v_factor numeric;
  v_normalized_lines jsonb := '[]'::jsonb;
begin
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception using errcode = '42501', message = 'ACTOR_SPOOF_BLOCKED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  select po.branch_id into v_branch_id
  from public.purchase_orders po
  where po.id = p_order_id and po.tenant_id = v_tenant_id;
  if v_branch_id is null or not public.user_has_branch_access(v_actor, v_branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  -- Null retains the existing receive-all behavior in canonical stock units.
  if p_lines is null then
    return public.receive_purchase_items_atomic(p_order_id, null, null);
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'RECEIVE_LINES_INVALID';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_item_id := (v_line->>'item_id')::uuid;
      v_transaction_qty := (v_line->>'receive_qty')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'RECEIVE_LINE_FORMAT_INVALID';
    end;
    if v_transaction_qty <= 0 then
      raise exception using errcode = '22023', message = 'RECEIVE_QUANTITY_INVALID';
    end if;

    select coalesce(poi.conversion_factor, 1)
      into v_factor
    from public.purchase_order_items poi
    where poi.id = v_item_id and poi.purchase_order_id = p_order_id;
    if not found or v_factor <= 0 then
      raise exception using errcode = '22023', message = 'RECEIVE_ITEM_NOT_FOUND';
    end if;

    v_normalized_lines := v_normalized_lines || jsonb_build_object(
      'item_id', v_item_id,
      'receive_qty', round(v_transaction_qty * v_factor, 4)
    );
  end loop;

  return public.receive_purchase_items_atomic(
    p_order_id, v_normalized_lines, null
  );
end;
$$;

revoke all on function public.receive_purchase_items_with_uom_atomic(
  uuid, jsonb, uuid
) from public;
grant execute on function public.receive_purchase_items_with_uom_atomic(
  uuid, jsonb, uuid
) to authenticated;

create or replace function public.normalize_bom_item_uom_00320()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_bom_tenant_id uuid;
  v_stock_unit text;
  v_input_quantity numeric;
  v_input_unit text;
  v_factor numeric;
begin
  select p.tenant_id, p.unit
    into v_tenant_id, v_stock_unit
  from public.products p
  where p.id = new.material_id;

  if v_tenant_id is null then
    raise exception using errcode = '22023', message = 'BOM_MATERIAL_NOT_FOUND';
  end if;
  select b.tenant_id into v_bom_tenant_id
  from public.bom b where b.id = new.bom_id;
  if v_bom_tenant_id is null or v_bom_tenant_id <> v_tenant_id then
    raise exception using errcode = '42501', message = 'BOM_MATERIAL_TENANT_MISMATCH';
  end if;

  if tg_op = 'UPDATE'
     and new.input_quantity is not distinct from old.input_quantity
     and new.input_unit is not distinct from old.input_unit
     and (new.quantity is distinct from old.quantity or new.unit is distinct from old.unit) then
    v_input_quantity := new.quantity;
    v_input_unit := coalesce(nullif(trim(new.unit), ''), v_stock_unit);
  else
    v_input_quantity := coalesce(new.input_quantity, new.quantity);
    v_input_unit := coalesce(nullif(trim(new.input_unit), ''), new.unit, v_stock_unit);
  end if;
  if v_input_quantity is null or v_input_quantity <= 0 then
    raise exception using errcode = '22023', message = 'BOM_QUANTITY_INVALID';
  end if;

  v_factor := public.resolve_product_uom_factor(v_tenant_id, new.material_id, v_input_unit);
  new.input_quantity := v_input_quantity;
  new.input_unit := v_input_unit;
  new.conversion_factor := v_factor;
  new.quantity := round(v_input_quantity * v_factor, 4);
  new.unit := v_stock_unit;

  if new.quantity <= 0 then
    raise exception using errcode = '22023', message = 'BOM_NORMALIZED_QUANTITY_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_bom_item_uom_00320 on public.bom_items;
create trigger trg_normalize_bom_item_uom_00320
before insert or update of material_id, quantity, unit, input_quantity, input_unit
on public.bom_items
for each row execute function public.normalize_bom_item_uom_00320();

revoke all on function public.normalize_bom_item_uom_00320() from public;

commit;

select
  to_regprocedure('public.resolve_product_uom_factor(uuid,uuid,text)') is not null as uom_factor_rpc_ok,
  to_regprocedure(
    'public.replace_product_uom_conversions_atomic(uuid,text,jsonb)'
  ) is not null as uom_config_rpc_ok,
  to_regprocedure(
    'public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
  ) is not null as purchase_uom_rpc_ok,
  to_regprocedure(
    'public.update_purchase_order_prices_with_uom(uuid,jsonb,uuid,text,text,numeric,numeric,numeric)'
  ) is not null as purchase_price_uom_rpc_ok,
  to_regprocedure(
    'public.receive_purchase_items_with_uom_atomic(uuid,jsonb,uuid)'
  ) is not null as purchase_receive_uom_rpc_ok,
  exists (
    select 1 from pg_trigger
    where tgname = 'trg_normalize_bom_item_uom_00320' and not tgisinternal
  ) as bom_uom_guard_ok;
