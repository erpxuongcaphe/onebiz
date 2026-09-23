-- Future F&B prepared batches use the branch's cost at completion, not at
-- production-order creation. Retail production and historical rows are untouched.
do $$
begin
  if to_regprocedure('public._complete_production_cost_impl_00392(uuid,numeric,text,date,date)') is null then
    alter function public.complete_production_atomic(uuid,numeric,text,date,date)
      rename to _complete_production_cost_impl_00392;
  end if;
end;
$$;

revoke all on function public._complete_production_cost_impl_00392(uuid,numeric,text,date,date)
  from public, anon, authenticated;

create function public.complete_production_atomic(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_material record;
  v_costed_qty numeric;
  v_physical_qty numeric;
  v_unit_cost numeric;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select tenant_id, role into v_profile
    from public.profiles
   where id = v_actor and coalesce(is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.complete_order') then
    raise exception using errcode = '42501', message = 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  select po.tenant_id, po.branch_id, po.status, po.planned_qty,
         p.is_fnb_stock_item
    into v_order
    from public.production_orders po
    join public.products p on p.id = po.product_id and p.tenant_id = po.tenant_id
   where po.id = p_production_order_id and po.tenant_id = v_profile.tenant_id
   for update of po;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;

  if coalesce(v_order.is_fnb_stock_item, false)
     and public._fnb_branch_cost_tracking_enabled_00390(v_order.tenant_id, v_order.branch_id) then
    if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check')
       or p_completed_qty is null or p_completed_qty <= 0
       or p_completed_qty > v_order.planned_qty then
      raise exception using errcode = '22023', message = 'PRODUCTION_COMPLETE_STATUS_OR_QTY_INVALID';
    end if;

    for v_material in
      select pom.id, pom.product_id, coalesce(pom.actual_qty, pom.planned_qty) as quantity
        from public.production_order_materials pom
       where pom.production_order_id = p_production_order_id
       order by pom.product_id, pom.id
       for update
    loop
      select coalesce(bs.quantity, 0) into v_physical_qty
        from public.branch_stock bs
       where bs.tenant_id = v_order.tenant_id and bs.branch_id = v_order.branch_id
         and bs.product_id = v_material.product_id and bs.variant_id is null
       for update;
      select b.costed_quantity, b.unit_cost
        into v_costed_qty, v_unit_cost
        from public.fnb_branch_product_cost_balances b
       where b.tenant_id = v_order.tenant_id and b.branch_id = v_order.branch_id
         and b.product_id = v_material.product_id
       for update;
      if v_costed_qty is null or v_physical_qty is null
         or abs(v_costed_qty - v_physical_qty) > 0.0001
         or v_costed_qty + 0.0001 < v_material.quantity then
        raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_REQUIRED';
      end if;
      update public.production_order_materials
         set unit_cost = v_unit_cost
       where id = v_material.id;
    end loop;
  end if;

  return public._complete_production_cost_impl_00392(
    p_production_order_id, p_completed_qty, p_lot_number,
    p_manufactured_date, p_expiry_date
  );
end;
$$;

alter function public.complete_production_atomic(uuid,numeric,text,date,date) owner to postgres;
revoke all on function public.complete_production_atomic(uuid,numeric,text,date,date)
  from public, anon;
grant execute on function public.complete_production_atomic(uuid,numeric,text,date,date)
  to authenticated;
