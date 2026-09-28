-- Keep purchase receipts at opted-in F&B branches from changing the shared
-- Retail product cost. Branch cost is already posted by the 00390 ledger.
begin;
set local lock_timeout = '1s';

do $migration$
begin
  if to_regprocedure(
       'public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.apply_weighted_avg_cost(uuid,numeric,numeric,text,text,uuid)'
     ) is null
     or to_regprocedure(
       'public._revert_received_po_impl_00214(uuid,uuid,boolean)'
     ) is null then
    raise exception using
      errcode = 'P0001', message = 'FNB_00403_PREREQUISITE_MISSING';
  end if;
end;
$migration$;

create or replace function public.apply_weighted_avg_cost(
  p_product_id uuid,
  p_new_qty numeric,
  p_new_unit_price numeric,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_product record;
  v_purchase record;
  v_old_cost numeric(15, 4);
  v_old_stock numeric(15, 4);
  v_new_cost numeric(15, 4);
  v_actor uuid;
begin
  if p_new_qty is null or p_new_qty <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'INVALID_QTY');
  end if;
  if p_new_unit_price is null or p_new_unit_price <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'INVALID_UNIT_PRICE');
  end if;

  select id, tenant_id, code, name, cost_price, stock
    into v_product
    from public.products
   where id = p_product_id
   for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- An F&B store has its own auditable WAC ledger. Its purchase price must not
  -- overwrite the shared product cost used by Retail and other branches.
  if p_reason = 'purchase_receive'
     and p_reference_type = 'purchase_order'
     and p_reference_id is not null then
    select po.tenant_id, po.branch_id
      into v_purchase
      from public.purchase_orders po
     where po.id = p_reference_id;
    if found
       and v_purchase.tenant_id = v_product.tenant_id
       and public._fnb_branch_cost_tracking_enabled_00390(
         v_purchase.tenant_id, v_purchase.branch_id
       ) then
      return jsonb_build_object(
        'updated', false,
        'skipped', true,
        'reason', 'FNB_BRANCH_COST_LEDGER',
        'product_id', p_product_id,
        'cost_price', coalesce(v_product.cost_price, 0),
        'branch_id', v_purchase.branch_id
      );
    end if;
  end if;

  v_actor := coalesce(
    auth.uid(),
    (select id
       from public.profiles
      where tenant_id = v_product.tenant_id and role = 'owner'
      order by created_at
      limit 1)
  );
  v_old_cost := coalesce(v_product.cost_price, 0);
  v_old_stock := coalesce(v_product.stock, 0);

  if v_old_stock <= 0 or v_old_cost <= 0 then
    v_new_cost := p_new_unit_price;
  else
    v_new_cost := round(
      (v_old_stock * v_old_cost + p_new_qty * p_new_unit_price)
      / (v_old_stock + p_new_qty),
      4
    );
  end if;

  update public.products
     set cost_price = v_new_cost,
         updated_at = now()
   where id = p_product_id;

  if v_actor is not null then
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_product.tenant_id, v_actor, 'cost_price_update', 'product', p_product_id,
      jsonb_build_object('cost_price', v_old_cost, 'stock', v_old_stock),
      jsonb_build_object(
        'cost_price', v_new_cost,
        'qty_added', p_new_qty,
        'unit_price_in', p_new_unit_price,
        'reason', p_reason,
        'reference_type', p_reference_type,
        'reference_id', p_reference_id,
        'product_code', v_product.code,
        'product_name', v_product.name
      )
    );
  end if;

  return jsonb_build_object(
    'updated', true,
    'product_id', p_product_id,
    'old_cost', v_old_cost,
    'new_cost', v_new_cost,
    'old_stock', v_old_stock,
    'new_stock', v_old_stock + p_new_qty
  );
end;
$$;

do $rename$
begin
  if to_regprocedure(
       'public._revert_received_po_global_wac_impl_00403(uuid,uuid,boolean)'
     ) is null then
    alter function public._revert_received_po_impl_00214(uuid, uuid, boolean)
      rename to _revert_received_po_global_wac_impl_00403;
  end if;
end;
$rename$;

revoke all on function public._revert_received_po_global_wac_impl_00403(
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function public._revert_received_po_impl_00214(
  p_order_id uuid,
  p_user_id uuid,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase record;
  v_result jsonb;
  v_prices jsonb;
begin
  select po.tenant_id, po.branch_id
    into v_purchase
    from public.purchase_orders po
   where po.id = p_order_id
   for update;

  if not found
     or not public._fnb_branch_cost_tracking_enabled_00390(
       v_purchase.tenant_id, v_purchase.branch_id
     ) then
    return public._revert_received_po_global_wac_impl_00403(
      p_order_id, p_user_id, p_allow_negative
    );
  end if;

  perform 1
    from public.purchase_order_items i
   where i.purchase_order_id = p_order_id
   for update;
  select coalesce(jsonb_object_agg(i.id::text, i.unit_price), '{}'::jsonb)
    into v_prices
    from public.purchase_order_items i
   where i.purchase_order_id = p_order_id;

  -- The legacy implementation uses item prices only to reverse the shared
  -- product WAC. Temporarily zero them inside this transaction so stock, lots,
  -- invoices and the branch cost ledger still revert normally without touching
  -- Retail cost. Original item prices are restored before returning.
  update public.purchase_order_items
     set unit_price = 0
   where purchase_order_id = p_order_id;

  v_result := public._revert_received_po_global_wac_impl_00403(
    p_order_id, p_user_id, p_allow_negative
  );

  update public.purchase_order_items i
     set unit_price = price.value::numeric
    from jsonb_each_text(v_prices) price
   where i.id = price.key::uuid;

  return v_result || jsonb_build_object(
    'global_cost_preserved', true,
    'cost_source', 'fnb_branch_ledger'
  );
end;
$$;

revoke all on function public._revert_received_po_impl_00214(
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.apply_weighted_avg_cost(
  uuid, numeric, numeric, text, text, uuid
) to authenticated;

commit;

select
  to_regprocedure(
    'public.apply_weighted_avg_cost(uuid,numeric,numeric,text,text,uuid)'
  ) is not null as weighted_cost_guard_ok,
  to_regprocedure(
    'public._revert_received_po_impl_00214(uuid,uuid,boolean)'
  ) is not null as fnb_revert_wrapper_ok,
  to_regprocedure(
    'public._revert_received_po_global_wac_impl_00403(uuid,uuid,boolean)'
  ) is not null as retail_revert_impl_preserved;

notify pgrst, 'reload schema';
