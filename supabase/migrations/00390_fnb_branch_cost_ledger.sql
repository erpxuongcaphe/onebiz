-- 00390: Branch-owned F&B cost ledger for stockable prepared items.
--
-- This migration is deliberately forward-only. It does not backfill, rewrite,
-- or derive a cost for historic Retail / warehouse / F&B stock movements.
-- Cost tracking starts only after an administrator has explicitly enabled the
-- existing F&B supply scope for a store. Any opening stock is an intentional,
-- audited accounting decision made by that branch, never a guess from Retail.

begin;

create table public.fnb_branch_product_cost_balances (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  costed_quantity numeric(18,4) not null default 0 check (costed_quantity >= 0),
  total_cost numeric(18,4) not null default 0 check (total_cost >= 0),
  unit_cost numeric(18,6) not null default 0 check (unit_cost >= 0),
  opening_cost_confirmed boolean not null default false,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, product_id)
);

create table public.fnb_branch_product_cost_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  direction text not null check (direction in ('in', 'out')),
  source_type text not null check (source_type in (
    'opening', 'purchase_receipt', 'internal_sale_receipt',
    'production_consume', 'production_complete', 'bom_consume',
    'invoice_void_restore'
  )),
  source_reference_type text not null,
  source_reference_id uuid not null,
  source_stock_movement_id uuid references public.stock_movements(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_cost numeric(18,6) not null check (unit_cost >= 0),
  total_cost numeric(18,4) not null check (total_cost >= 0),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index fnb_branch_product_cost_events_movement_uniq
  on public.fnb_branch_product_cost_events(source_stock_movement_id)
  where source_stock_movement_id is not null;
create index fnb_branch_product_cost_events_lookup_idx
  on public.fnb_branch_product_cost_events(tenant_id, branch_id, product_id, created_at desc);
create index fnb_branch_product_cost_events_reference_idx
  on public.fnb_branch_product_cost_events(tenant_id, source_reference_type, source_reference_id);

alter table public.fnb_branch_product_cost_balances enable row level security;
alter table public.fnb_branch_product_cost_events enable row level security;

create policy fnb_branch_product_cost_balances_read
  on public.fnb_branch_product_cost_balances for select to authenticated
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'products.view')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

create policy fnb_branch_product_cost_events_read
  on public.fnb_branch_product_cost_events for select to authenticated
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'products.view')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

revoke all on public.fnb_branch_product_cost_balances,
  public.fnb_branch_product_cost_events from public, anon, authenticated;
grant select on public.fnb_branch_product_cost_balances,
  public.fnb_branch_product_cost_events to authenticated;

create function public._fnb_branch_cost_tracking_enabled_00390(
  p_tenant_id uuid,
  p_branch_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.fnb_supply_branch_scopes s
     where s.tenant_id = p_tenant_id
       and s.branch_id = p_branch_id
       and s.enforcement_enabled
  );
$$;

create function public._post_fnb_branch_cost_in_00390(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_source_type text,
  p_source_reference_type text,
  p_source_reference_id uuid,
  p_source_stock_movement_id uuid default null,
  p_note text default null,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.fnb_branch_product_cost_balances%rowtype;
  v_total numeric(18,4);
  v_unit numeric(18,6);
begin
  if p_quantity is null or p_quantity <= 0 or p_unit_cost is null or p_unit_cost < 0 then
    raise exception using errcode = '22023', message = 'FNB_BRANCH_COST_INPUT_INVALID';
  end if;
  if p_source_stock_movement_id is not null and exists (
    select 1 from public.fnb_branch_product_cost_events e
     where e.source_stock_movement_id = p_source_stock_movement_id
  ) then
    return;
  end if;

  insert into public.fnb_branch_product_cost_balances(
    tenant_id, branch_id, product_id, updated_by
  ) values (p_tenant_id, p_branch_id, p_product_id, p_actor)
  on conflict (tenant_id, branch_id, product_id) do nothing;

  select * into v_balance
    from public.fnb_branch_product_cost_balances
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id
   for update;

  v_total := round(v_balance.total_cost + p_quantity * p_unit_cost, 4);
  v_unit := case when v_balance.costed_quantity + p_quantity = 0 then 0
                 else round(v_total / (v_balance.costed_quantity + p_quantity), 6) end;

  update public.fnb_branch_product_cost_balances
     set costed_quantity = costed_quantity + p_quantity,
         total_cost = v_total,
         unit_cost = v_unit,
         updated_by = p_actor,
         updated_at = now()
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id;

  insert into public.fnb_branch_product_cost_events(
    tenant_id, branch_id, product_id, direction, source_type,
    source_reference_type, source_reference_id, source_stock_movement_id,
    quantity, unit_cost, total_cost, note, created_by
  ) values (
    p_tenant_id, p_branch_id, p_product_id, 'in', p_source_type,
    p_source_reference_type, p_source_reference_id, p_source_stock_movement_id,
    p_quantity, p_unit_cost, round(p_quantity * p_unit_cost, 4), p_note, p_actor
  ) on conflict (source_stock_movement_id) where source_stock_movement_id is not null do nothing;
end;
$$;

create function public._post_fnb_branch_cost_out_00390(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_source_type text,
  p_source_reference_type text,
  p_source_reference_id uuid,
  p_source_stock_movement_id uuid default null,
  p_note text default null,
  p_actor uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.fnb_branch_product_cost_balances%rowtype;
  v_total numeric(18,4);
  v_unit numeric(18,6);
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'FNB_BRANCH_COST_INPUT_INVALID';
  end if;
  if p_source_stock_movement_id is not null then
    select e.unit_cost into v_unit
      from public.fnb_branch_product_cost_events e
     where e.source_stock_movement_id = p_source_stock_movement_id;
    if found then
      return v_unit;
    end if;
  end if;

  select * into v_balance
    from public.fnb_branch_product_cost_balances
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id
   for update;
  if not found or v_balance.costed_quantity + 0.0001 < p_quantity then
    raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_REQUIRED';
  end if;

  v_total := round(v_balance.unit_cost * p_quantity, 4);
  v_unit := case when v_balance.costed_quantity - p_quantity <= 0.0001 then 0
                 else round((v_balance.total_cost - v_total) /
                       (v_balance.costed_quantity - p_quantity), 6) end;

  update public.fnb_branch_product_cost_balances
     set costed_quantity = greatest(0, costed_quantity - p_quantity),
         total_cost = greatest(0, round(total_cost - v_total, 4)),
         unit_cost = v_unit,
         updated_by = p_actor,
         updated_at = now()
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id;

  insert into public.fnb_branch_product_cost_events(
    tenant_id, branch_id, product_id, direction, source_type,
    source_reference_type, source_reference_id, source_stock_movement_id,
    quantity, unit_cost, total_cost, note, created_by
  ) values (
    p_tenant_id, p_branch_id, p_product_id, 'out', p_source_type,
    p_source_reference_type, p_source_reference_id, p_source_stock_movement_id,
    p_quantity, v_balance.unit_cost, v_total, p_note, p_actor
  ) on conflict (source_stock_movement_id) where source_stock_movement_id is not null do nothing;

  return v_balance.unit_cost;
end;
$$;

-- Opening cost is intentionally explicit. The quantity must exactly match the
-- live branch quantity at the instant of confirmation, preventing an operator
-- from silently assigning a value to only part of unknown opening stock.
create function public.set_fnb_branch_opening_cost_00390(
  p_branch_id uuid,
  p_product_id uuid,
  p_unit_cost numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_qty numeric(18,4);
  v_event_id uuid;
begin
  select tenant_id into v_tenant from public.profiles
   where id = v_actor and coalesce(is_active, true);
  if v_actor is null or v_tenant is null
     or not (public.user_has_permission(v_actor, 'inventory.create_po')
             or exists (select 1 from public.profiles where id = v_actor and role = 'owner'))
     or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'FNB_BRANCH_COST_OPENING_DENIED';
  end if;
  if not public._fnb_branch_cost_tracking_enabled_00390(v_tenant, p_branch_id) then
    raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_SCOPE_DISABLED';
  end if;
  if p_unit_cost is null or p_unit_cost < 0
     or nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'FNB_BRANCH_COST_OPENING_INPUT_INVALID';
  end if;

  select coalesce(bs.quantity, 0) into v_qty
    from public.branch_stock bs
   where bs.tenant_id = v_tenant and bs.branch_id = p_branch_id
     and bs.product_id = p_product_id and bs.variant_id is null
   for update;
  v_qty := coalesce(v_qty, 0);
  if v_qty <= 0 then
    raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_OPENING_STOCK_REQUIRED';
  end if;
  if exists (
    select 1 from public.fnb_branch_product_cost_events e
     where e.tenant_id = v_tenant and e.branch_id = p_branch_id and e.product_id = p_product_id
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_OPENING_ALREADY_POSTED';
  end if;

  perform public._post_fnb_branch_cost_in_00390(
    v_tenant, p_branch_id, p_product_id, v_qty, p_unit_cost,
    'opening', 'opening_cost', p_product_id, null, trim(p_reason), v_actor
  );
  update public.fnb_branch_product_cost_balances
     set opening_cost_confirmed = true
   where tenant_id = v_tenant and branch_id = p_branch_id and product_id = p_product_id;
  select id into v_event_id from public.fnb_branch_product_cost_events
   where tenant_id = v_tenant and branch_id = p_branch_id and product_id = p_product_id
     and source_type = 'opening'
   order by created_at desc limit 1;

  insert into public.audit_log(tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (v_tenant, v_actor, 'fnb_branch_opening_cost', 'product', p_product_id,
    jsonb_build_object('branch_id', p_branch_id, 'quantity', v_qty,
      'unit_cost', p_unit_cost, 'reason', trim(p_reason), 'cost_event_id', v_event_id));

  return jsonb_build_object('quantity', v_qty, 'unit_cost', p_unit_cost, 'event_id', v_event_id);
end;
$$;

-- Capture only newly inserted movements. Retail and non-opted-in stores return
-- immediately, so their existing receipt and sale behaviour remains unchanged.
create function public._capture_fnb_branch_cost_stock_movement_00390()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_cost numeric(18,6);
  v_cogs numeric(18,4);
  v_product_is_prepared boolean;
  v_restore_total numeric(18,4);
  v_restore_qty numeric(18,4);
begin
  if not public._fnb_branch_cost_tracking_enabled_00390(new.tenant_id, new.branch_id) then
    return new;
  end if;

  if new.reference_type = 'purchase_order' and new.type = 'in' then
    select poi.unit_price into v_unit_cost
      from public.purchase_order_items poi
     where poi.purchase_order_id = new.reference_id and poi.product_id = new.product_id
     limit 1;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_RECEIPT_PRICE_REQUIRED';
    end if;
    perform public._post_fnb_branch_cost_in_00390(
      new.tenant_id, new.branch_id, new.product_id, new.quantity, v_unit_cost,
      'purchase_receipt', new.reference_type, new.reference_id, new.id, new.note, new.created_by
    );
  elsif new.reference_type = 'production_order' and new.type = 'out' then
    select p.is_fnb_stock_item into v_product_is_prepared
      from public.production_orders po join public.products p on p.id = po.product_id
     where po.id = new.reference_id and po.tenant_id = new.tenant_id;
    if coalesce(v_product_is_prepared, false) then
      perform public._post_fnb_branch_cost_out_00390(
        new.tenant_id, new.branch_id, new.product_id, new.quantity,
        'production_consume', new.reference_type, new.reference_id, new.id, new.note, new.created_by
      );
    end if;
  elsif new.reference_type = 'production_order' and new.type = 'in' then
    select p.is_fnb_stock_item, po.cogs_amount
      into v_product_is_prepared, v_cogs
      from public.production_orders po join public.products p on p.id = po.product_id
     where po.id = new.reference_id and po.tenant_id = new.tenant_id;
    if coalesce(v_product_is_prepared, false) then
      if new.quantity <= 0 then
        raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_PRODUCTION_QTY_REQUIRED';
      end if;
      perform public._post_fnb_branch_cost_in_00390(
        new.tenant_id, new.branch_id, new.product_id, new.quantity,
        round(coalesce(v_cogs, 0) / new.quantity, 6),
        'production_complete', new.reference_type, new.reference_id, new.id, new.note, new.created_by
      );
    end if;
  elsif new.reference_type = 'bom_consume' and new.type = 'out' then
    perform public._post_fnb_branch_cost_out_00390(
      new.tenant_id, new.branch_id, new.product_id, new.quantity,
      'bom_consume', new.reference_type, new.reference_id, new.id, new.note, new.created_by
    );
  elsif new.reference_type = 'invoice_void' and new.type = 'in' then
    select coalesce(sum(e.total_cost), 0), coalesce(sum(e.quantity), 0)
      into v_restore_total, v_restore_qty
      from public.fnb_branch_product_cost_events e
     where e.tenant_id = new.tenant_id and e.branch_id = new.branch_id
       and e.product_id = new.product_id and e.direction = 'out'
       and e.source_type = 'bom_consume' and e.source_reference_id = new.reference_id;
    if v_restore_qty > 0 then
      perform public._post_fnb_branch_cost_in_00390(
        new.tenant_id, new.branch_id, new.product_id, new.quantity,
        round(v_restore_total / v_restore_qty, 6),
        'invoice_void_restore', new.reference_type, new.reference_id,
        new.id, new.note, new.created_by
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_fnb_branch_cost_stock_movement_00390 on public.stock_movements;
create trigger capture_fnb_branch_cost_stock_movement_00390
  after insert on public.stock_movements
  for each row execute function public._capture_fnb_branch_cost_stock_movement_00390();

-- Internal-sale stock movement is written before internal_sale_items exists,
-- so capture its commercial cost after the established catalog-enforcing atomic
-- wrapper returns. The wrapper remains transactionally all-or-nothing.
do $$
begin
  if to_regprocedure('public._create_internal_sale_catalog_impl_00390(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)') is null then
    alter function public.create_internal_sale_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)
      rename to _create_internal_sale_catalog_impl_00390;
  end if;
end;
$$;
revoke all on function public._create_internal_sale_catalog_impl_00390(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
) from public, anon, authenticated;

create or replace function public.create_internal_sale_atomic(
  p_tenant_id uuid, p_from_branch_id uuid, p_to_branch_id uuid, p_created_by uuid,
  p_int_customer_id uuid, p_int_customer_name text, p_int_supplier_id uuid,
  p_int_supplier_name text, p_items jsonb, p_payment_method text default 'transfer',
  p_paid_full boolean default true, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_sale_id uuid;
  v_tenant uuid;
  v_item record;
begin
  v_result := public._create_internal_sale_catalog_impl_00390(
    p_tenant_id, p_from_branch_id, p_to_branch_id, p_created_by,
    p_int_customer_id, p_int_customer_name, p_int_supplier_id,
    p_int_supplier_name, p_items, p_payment_method, p_paid_full, p_note
  );
  v_sale_id := (v_result->>'internal_sale_id')::uuid;
  select tenant_id into v_tenant from public.internal_sales where id = v_sale_id;

  if public._fnb_branch_cost_tracking_enabled_00390(v_tenant, p_to_branch_id) then
    for v_item in
      select isi.product_id, sum(isi.quantity) as quantity,
             round(sum(isi.amount) / nullif(sum(isi.quantity), 0), 6) as unit_price
        from public.internal_sale_items isi
       where isi.internal_sale_id = v_sale_id
       group by isi.product_id
    loop
      perform public._post_fnb_branch_cost_in_00390(
        v_tenant, p_to_branch_id, v_item.product_id, v_item.quantity, v_item.unit_price,
        'internal_sale_receipt', 'internal_sale', v_sale_id, null,
        'Nhap noi bo theo don ' || coalesce(v_result->>'code', v_sale_id::text), p_created_by
      );
    end loop;
  end if;

  return v_result;
end;
$$;

-- Prepared batches use branch cost snapshots at creation. The established
-- production implementation still owns all stock and lot movements; this
-- wrapper only replaces the previously-global material unit cost for opted-in
-- F&B prepared output. A failed cost check rolls the new order back entirely.
do $$
begin
  if to_regprocedure('public._create_production_order_auth_impl_00390(jsonb)') is null then
    alter function public.create_production_order_atomic(jsonb)
      rename to _create_production_order_auth_impl_00390;
  end if;
end;
$$;
revoke all on function public._create_production_order_auth_impl_00390(jsonb)
  from public, anon, authenticated;

create function public.create_production_order_atomic(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_order record;
  v_material record;
  v_balance_qty numeric(18,4);
  v_physical_qty numeric(18,4);
begin
  v_result := public._create_production_order_auth_impl_00390(p_input);
  v_order_id := (v_result->>'id')::uuid;
  select po.tenant_id, po.branch_id, p.is_fnb_stock_item
    into v_order
    from public.production_orders po join public.products p on p.id = po.product_id
   where po.id = v_order_id
   for update;

  if not coalesce(v_order.is_fnb_stock_item, false)
     or not public._fnb_branch_cost_tracking_enabled_00390(v_order.tenant_id, v_order.branch_id) then
    return v_result;
  end if;

  for v_material in
    select pom.id, pom.product_id, pom.planned_qty, b.costed_quantity, b.unit_cost,
           coalesce(bs.quantity, 0) as physical_quantity
      from public.production_order_materials pom
      left join public.fnb_branch_product_cost_balances b
        on b.tenant_id = v_order.tenant_id and b.branch_id = v_order.branch_id
       and b.product_id = pom.product_id
      left join public.branch_stock bs
        on bs.tenant_id = v_order.tenant_id and bs.branch_id = v_order.branch_id
       and bs.product_id = pom.product_id and bs.variant_id is null
     where pom.production_order_id = v_order_id
     for update of pom
  loop
    v_balance_qty := coalesce(v_material.costed_quantity, 0);
    v_physical_qty := coalesce(v_material.physical_quantity, 0);
    if abs(v_balance_qty - v_physical_qty) > 0.0001
       or v_balance_qty + 0.0001 < v_material.planned_qty then
      raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_REQUIRED';
    end if;
    update public.production_order_materials
       set unit_cost = v_material.unit_cost
     where id = v_material.id;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.create_production_order_atomic(jsonb) from public, anon;
grant execute on function public.create_production_order_atomic(jsonb) to authenticated;

create function public.calculate_fnb_bom_branch_cost_00390(
  p_bom_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_total numeric(18,4) := 0;
  v_item record;
  v_items jsonb := '[]'::jsonb;
begin
  select tenant_id into v_tenant from public.profiles
   where id = v_actor and coalesce(is_active, true);
  if v_actor is null or v_tenant is null
     or not public.user_has_permission(v_actor, 'products.view')
     or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'FNB_BRANCH_COST_ACCESS_DENIED';
  end if;
  if not public._fnb_branch_cost_tracking_enabled_00390(v_tenant, p_branch_id) then
    raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_SCOPE_DISABLED';
  end if;

  for v_item in
    select p.id, p.code, p.name, bi.quantity, coalesce(bi.waste_percent, 0) as waste_percent,
           coalesce(cb.costed_quantity, 0) as costed_quantity,
           coalesce(cb.unit_cost, 0) as unit_cost,
           coalesce(bs.quantity, 0) as physical_quantity
      from public.bom bom
      join public.bom_items bi on bi.bom_id = bom.id
      join public.products p on p.id = bi.material_id and p.tenant_id = bom.tenant_id
      left join public.fnb_branch_product_cost_balances cb
        on cb.tenant_id = p.tenant_id and cb.branch_id = p_branch_id and cb.product_id = p.id
      left join public.branch_stock bs
        on bs.tenant_id = p.tenant_id and bs.branch_id = p_branch_id
       and bs.product_id = p.id and bs.variant_id is null
     where bom.id = p_bom_id and bom.tenant_id = v_tenant
     order by bi.sort_order, bi.id
  loop
    if abs(v_item.costed_quantity - v_item.physical_quantity) > 0.0001 then
      raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_REQUIRED',
        detail = coalesce(v_item.code, v_item.name);
    end if;
    v_total := v_total + v_item.quantity * (1 + v_item.waste_percent / 100) * v_item.unit_cost;
    v_items := v_items || jsonb_build_object(
      'material_id', v_item.id, 'code', v_item.code, 'name', v_item.name,
      'quantity', v_item.quantity, 'waste_percent', v_item.waste_percent,
      'branch_unit_cost', v_item.unit_cost,
      'line_cost', round(v_item.quantity * (1 + v_item.waste_percent / 100) * v_item.unit_cost, 4)
    );
  end loop;
  if jsonb_array_length(v_items) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_BOM_COST_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'bom_id', p_bom_id, 'branch_id', p_branch_id,
    'cost_source', 'fnb_branch_weighted_average', 'total_cost', round(v_total, 4), 'items', v_items
  );
end;
$$;

alter function public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid) owner to postgres;
alter function public._post_fnb_branch_cost_in_00390(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid,text,uuid) owner to postgres;
alter function public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid) owner to postgres;
alter function public._capture_fnb_branch_cost_stock_movement_00390() owner to postgres;
alter function public.create_internal_sale_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text) owner to postgres;
alter function public.create_production_order_atomic(jsonb) owner to postgres;
alter function public.set_fnb_branch_opening_cost_00390(uuid,uuid,numeric,text) owner to postgres;
alter function public.calculate_fnb_bom_branch_cost_00390(uuid,uuid) owner to postgres;
revoke all on function public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid),
  public._post_fnb_branch_cost_in_00390(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid,text,uuid),
  public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid),
  public._capture_fnb_branch_cost_stock_movement_00390()
  from public, anon, authenticated;
revoke all on function public.create_internal_sale_atomic(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
) from public, anon;
grant execute on function public.create_internal_sale_atomic(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
) to authenticated, service_role;
revoke all on function public.set_fnb_branch_opening_cost_00390(uuid,uuid,numeric,text),
  public.calculate_fnb_bom_branch_cost_00390(uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_fnb_branch_opening_cost_00390(uuid,uuid,numeric,text),
  public.calculate_fnb_bom_branch_cost_00390(uuid,uuid) to authenticated;

comment on table public.fnb_branch_product_cost_balances is
  '00390: Current weighted-average operational cost per F&B branch. Empty until an opted-in branch receives new stock or explicitly confirms an opening cost.';
comment on table public.fnb_branch_product_cost_events is
  '00390: Immutable, branch-owned F&B cost ledger. Historic Retail/Kho Tổng movements are never imported.';
comment on function public.calculate_fnb_bom_branch_cost_00390(uuid,uuid) is
  '00390: Resolves F&B BOM cost from the consuming branch ledger only. Never reads Retail sell_price or global products.cost_price.';

notify pgrst, 'reload schema';

commit;

-- Verification is read-only and intentionally expects no imported history.
select
  to_regclass('public.fnb_branch_product_cost_balances') is not null as branch_balance_table_ok,
  to_regclass('public.fnb_branch_product_cost_events') is not null as branch_event_table_ok,
  to_regprocedure('public.set_fnb_branch_opening_cost_00390(uuid,uuid,numeric,text)') is not null as opening_cost_rpc_ok,
  to_regprocedure('public.calculate_fnb_bom_branch_cost_00390(uuid,uuid)') is not null as branch_bom_cost_rpc_ok,
  to_regprocedure('public.create_production_order_atomic(jsonb)') is not null as production_rpc_ok;
