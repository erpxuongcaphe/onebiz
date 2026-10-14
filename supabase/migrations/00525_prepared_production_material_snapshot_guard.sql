-- Validate prepared ingredients before stock posting; no historical data is rewritten.
begin;
CREATE OR REPLACE FUNCTION public._complete_production_auth_impl_00283(p_production_order_id uuid, p_completed_qty numeric, p_lot_number text DEFAULT NULL::text, p_manufactured_date date DEFAULT CURRENT_DATE, p_expiry_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_actor uuid := auth.uid();
 v_profile record;
 v_order record;
 v_out_count integer;
 v_lot_id uuid;
begin
 if v_actor is null then
 raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
 end if;
 select p.id, p.tenant_id, p.role
 into v_profile
 from public.profiles p
 where p.id = v_actor and coalesce(p.is_active, true);
 if not found then
 raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
 end if;
 if v_profile.role <> 'owner'
 and not public.user_has_permission(v_actor, 'production.complete_order') then
 raise exception using errcode = '42501', message = 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
 end if;

 select po.*
 into v_order
 from public.production_orders po
 where po.id = p_production_order_id
 and po.tenant_id = v_profile.tenant_id
 for update;
 if not found then
 raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
 end if;
 if not public.user_has_branch_access(v_actor, v_order.branch_id) then
 raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
 end if;
 if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check') then
 raise exception using errcode = '22023', message = 'PRODUCTION_COMPLETE_STATUS_INVALID';
 end if;
 if p_completed_qty is null
 or p_completed_qty <= 0
 or p_completed_qty::text in ('NaN', 'Infinity', '-Infinity')
 or (p_completed_qty > v_order.planned_qty and not exists (
   select 1 from public.products product where product.id = v_order.product_id
   and product.tenant_id = v_order.tenant_id and product.is_fnb_stock_item
 )) then
 raise exception using errcode = '22023', message = 'COMPLETED_QUANTITY_INVALID';
 end if;
 if p_expiry_date is not null
 and p_manufactured_date is not null
 and p_expiry_date < p_manufactured_date then
 raise exception using errcode = '22023', message = 'PRODUCTION_EXPIRY_DATE_INVALID';
 end if;

 -- Reject incomplete prepared ingredient snapshots before either stock posting.
 if exists (
   select 1 from public.products product where product.id = v_order.product_id
   and product.tenant_id = v_order.tenant_id and product.is_fnb_stock_item
 ) then
   perform 1 from public.production_order_materials material
     where material.production_order_id = v_order.id for update;
   if not exists (select 1 from public.production_order_materials material
     where material.production_order_id = v_order.id) then
     raise exception using errcode = '22023', message = 'FNB_PRODUCTION_MATERIALS_REQUIRED';
   end if;
   if exists (select 1 from public.production_order_materials material
     where material.production_order_id = v_order.id and (
       material.planned_qty is null or material.planned_qty <= 0
       or material.planned_qty::text in ('NaN', 'Infinity', '-Infinity')
       or not exists (select 1 from public.products ingredient
         where ingredient.id = material.product_id and ingredient.tenant_id = v_order.tenant_id)
     )) then
     raise exception using errcode = '22023', message = 'FNB_PRODUCTION_MATERIALS_INVALID';
   end if;
 end if;

 select count(*)
 into v_out_count
 from public.stock_movements sm
 where sm.tenant_id = v_profile.tenant_id
 and sm.reference_id = v_order.id
 and sm.reference_type = 'production_order'
 and sm.type = 'out';
 if v_out_count > 0 then
 raise exception using errcode = '22023', message = 'PRODUCTION_STOCK_RECONCILIATION_REQUIRED';
 end if;

 perform public.consume_production_materials(v_order.id);
 v_lot_id := public.complete_production_order(
 v_order.id,
 p_completed_qty,
 nullif(trim(coalesce(p_lot_number, '')), ''),
 coalesce(p_manufactured_date, current_date),
 p_expiry_date
 );

 insert into public.audit_log (
 tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
 ) values (
 v_profile.tenant_id,
 v_actor,
 'complete',
 'production_order',
 v_order.id,
 jsonb_build_object('status', v_order.status),
 jsonb_build_object(
 'status', 'completed',
 'completed_qty', p_completed_qty,
 'lot_id', v_lot_id,
 'atomic', true
 )
 );

 return v_lot_id;
end;
$function$;
create or replace function public.complete_production_atomic(
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

 -- Reject incomplete prepared ingredient snapshots before either stock posting.
 if coalesce(v_order.is_fnb_stock_item, false) then
   perform 1 from public.production_order_materials material
     where material.production_order_id = p_production_order_id for update;
   if not exists (select 1 from public.production_order_materials material
     where material.production_order_id = p_production_order_id) then
     raise exception using errcode = '22023', message = 'FNB_PRODUCTION_MATERIALS_REQUIRED';
   end if;
   if exists (select 1 from public.production_order_materials material
     where material.production_order_id = p_production_order_id and (
       material.planned_qty is null or material.planned_qty <= 0
       or material.planned_qty::text in ('NaN', 'Infinity', '-Infinity')
       or not exists (select 1 from public.products ingredient
         where ingredient.id = material.product_id and ingredient.tenant_id = v_order.tenant_id)
     )) then
     raise exception using errcode = '22023', message = 'FNB_PRODUCTION_MATERIALS_INVALID';
   end if;
 end if;


  if coalesce(v_order.is_fnb_stock_item, false)
     and public._fnb_branch_cost_tracking_enabled_00390(v_order.tenant_id, v_order.branch_id) then
    if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check')
       or p_completed_qty is null or p_completed_qty <= 0
       or p_completed_qty::text in ('NaN', 'Infinity', '-Infinity') then
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
notify pgrst, 'reload schema';
commit;
