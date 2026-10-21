-- Extend the existing atomic merge to multiple unpaid dine-in/takeaway bills.
-- Definition only: no real bills are merged by installing this migration.
begin;
set local lock_timeout='3s';
create or replace function public.merge_kitchen_orders_atomic(p_target_order_id uuid, p_source_order_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_target record;
  v_source record;
  v_source_count integer;
  v_distinct_count integer;
  v_moved_items integer := 0;
  v_moved_batches integer := 0;
  v_source_discount numeric := 0;
  v_released_tables uuid[] := array[]::uuid[];
  v_source_numbers text[] := array[]::text[];
  v_all_order_ids uuid[];
  v_all_table_ids uuid[];
  v_row_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'FNB_MERGE_AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'FNB_MERGE_ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.manage_tables') then
    raise exception using errcode = '42501', message = 'FNB_MERGE_PERMISSION_REQUIRED';
  end if;
  if p_target_order_id is null
     or p_source_order_ids is null
     or coalesce(cardinality(p_source_order_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'FNB_MERGE_SELECTION_REQUIRED';
  end if;
  if p_target_order_id = any(p_source_order_ids) then
    raise exception using errcode = '22023', message = 'FNB_MERGE_TARGET_IN_SOURCES';
  end if;

  select count(distinct source_id)
    into v_distinct_count
    from unnest(p_source_order_ids) selected(source_id);
  if v_distinct_count <> cardinality(p_source_order_ids) then
    raise exception using errcode = '22023', message = 'FNB_MERGE_DUPLICATE_SOURCE';
  end if;

  if cardinality(p_source_order_ids)>49 then
    raise exception using errcode='22023',message='FNB_MERGE_TOO_MANY_ORDERS';
  end if;

  v_all_order_ids := array_prepend(p_target_order_id, p_source_order_ids);

  -- Lock every order in a stable order to prevent concurrent merge/payment.
  perform ko.id
    from public.kitchen_orders ko
   where ko.tenant_id = v_tenant_id
     and ko.id = any(v_all_order_ids)
   order by ko.id
   for update;

  select ko.*
    into v_target
    from public.kitchen_orders ko
   where ko.tenant_id = v_tenant_id
     and ko.id = p_target_order_id;
  if not found then
    raise exception using errcode = '22023', message = 'FNB_MERGE_TARGET_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_target.branch_id) then
    raise exception using errcode = '42501', message = 'FNB_MERGE_BRANCH_DENIED';
  end if;
  if coalesce(v_target.order_type,'') not in ('dine_in','takeaway')
     or (v_target.order_type='dine_in' and v_target.table_id is null)
     or (v_target.order_type='takeaway' and v_target.table_id is not null)
     or v_target.invoice_id is not null or v_target.merged_into_id is not null
     or coalesce(v_target.status,'') not in ('pending','preparing','ready','served')
     or coalesce(v_target.delivery_fee,0)<>0 or coalesce(v_target.platform_commission,0)<>0
     or coalesce(v_target.platform_commission_percent,0)<>0 then
    raise exception using errcode = '22023', message = 'FNB_MERGE_TARGET_NOT_ELIGIBLE';
  end if;

  select count(*), coalesce(sum(greatest(coalesce(ko.discount_amount, 0), 0)), 0)
    into v_source_count, v_source_discount
    from public.kitchen_orders ko
   where ko.tenant_id = v_tenant_id
     and ko.id = any(p_source_order_ids)
     and ko.branch_id = v_target.branch_id
     and ko.order_type in ('dine_in','takeaway')
     and ((ko.order_type='dine_in' and ko.table_id is not null) or (ko.order_type='takeaway' and ko.table_id is null))
     and ko.merged_into_id is null
     and coalesce(ko.delivery_fee,0)=0 and coalesce(ko.platform_commission,0)=0 and coalesce(ko.platform_commission_percent,0)=0
     and ko.invoice_id is null
     and ko.status in ('pending','preparing','ready','served');
  if v_source_count <> cardinality(p_source_order_ids) then
    raise exception using errcode = '22023', message = 'FNB_MERGE_SOURCE_NOT_ELIGIBLE';
  end if;

  select array_agg(distinct ko.table_id)
    into v_all_table_ids
    from public.kitchen_orders ko
   where ko.tenant_id = v_tenant_id
     and ko.id = any(v_all_order_ids);

  -- Lock all involved tables after the orders, also in stable order.
  perform rt.id
    from public.restaurant_tables rt
   where rt.tenant_id = v_tenant_id
     and rt.id = any(v_all_table_ids)
   order by rt.id
   for update;

  if v_target.table_id is not null and not exists (
    select 1
      from public.restaurant_tables rt
     where rt.id = v_target.table_id
       and rt.tenant_id = v_tenant_id
       and rt.branch_id = v_target.branch_id
       and coalesce(rt.is_active, true)
       and rt.status = 'occupied'

  ) then
    raise exception using errcode = '40001', message = 'FNB_MERGE_TARGET_TABLE_STALE';
  end if;

  for v_source in
    select ko.*
      from public.kitchen_orders ko
     where ko.tenant_id = v_tenant_id
       and ko.id = any(p_source_order_ids)
     order by ko.id
  loop
    v_source_numbers := array_append(v_source_numbers, v_source.order_number);
    if nullif(btrim(v_source.note),'') is not null then
      update public.kitchen_orders set note=concat_ws(E'\n',nullif(note,''),'['||v_source.order_number||'] '||v_source.note) where id=v_target.id and tenant_id=v_tenant_id;
    end if;

    if v_source.table_id is not null and not exists (
      select 1
        from public.restaurant_tables rt
       where rt.id = v_source.table_id
         and rt.tenant_id = v_tenant_id
         and rt.branch_id = v_target.branch_id
         and coalesce(rt.is_active, true)
         and rt.status = 'occupied'
    ) then
      raise exception using errcode = '40001', message = 'FNB_MERGE_SOURCE_TABLE_STALE';
    end if;

    update public.kitchen_order_items
       set kitchen_order_id = v_target.id
     where kitchen_order_id = v_source.id;
    get diagnostics v_row_count = row_count;
    if v_row_count < 1 then
      raise exception using errcode = '22023', message = 'FNB_MERGE_SOURCE_EMPTY';
    end if;
    v_moved_items := v_moved_items + v_row_count;

    update public.fnb_kitchen_item_batches
       set kitchen_order_id = v_target.id
     where tenant_id = v_tenant_id
       and kitchen_order_id = v_source.id;
    get diagnostics v_row_count = row_count;
    v_moved_batches := v_moved_batches + v_row_count;

    update public.kitchen_orders
       set status = 'cancelled',
           merged_into_id = v_target.id,
           updated_at = now()
     where id = v_source.id
       and tenant_id = v_tenant_id;

    if v_source.table_id is not null and v_source.table_id is distinct from v_target.table_id then
      update public.restaurant_tables rt
         set status=case when exists(select 1 from public.kitchen_orders remaining where remaining.tenant_id=v_tenant_id and remaining.table_id=rt.id and remaining.invoice_id is null and remaining.merged_into_id is null and remaining.status in ('pending','preparing','ready','served')) then 'occupied' else 'available' end,
             current_order_id=(select remaining.id from public.kitchen_orders remaining where remaining.tenant_id=v_tenant_id and remaining.table_id=rt.id and remaining.invoice_id is null and remaining.merged_into_id is null and remaining.status in ('pending','preparing','ready','served') order by (remaining.id=rt.current_order_id) desc,remaining.id limit 1),updated_at=now()
       where rt.id=v_source.table_id and rt.tenant_id=v_tenant_id and rt.branch_id=v_target.branch_id;
      get diagnostics v_row_count=row_count;
      if v_row_count<>1 then raise exception using errcode='PT409',message='FNB_MERGE_SOURCE_TABLE_STALE'; end if;
      v_released_tables:=array_append(v_released_tables,v_source.table_id);
    end if;
  end loop;

  update public.restaurant_tables set status='occupied',current_order_id=v_target.id,updated_at=now() where id=v_target.table_id and tenant_id=v_tenant_id;
  update public.kitchen_orders
     set discount_amount = greatest(coalesce(discount_amount, 0), 0) + v_source_discount,
         discount_reason = case
           when v_source_discount > 0
             then coalesce(nullif(discount_reason, ''), 'G???p chi???t kh???u t??? ????n kh??c')
           else discount_reason
         end,
         updated_at = now()
   where id = v_target.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_merge_orders',
    'kitchen_order',
    v_target.id,
    jsonb_build_object(
      'target_order_number', v_target.order_number,
      'source_order_ids', to_jsonb(p_source_order_ids),
      'source_order_numbers', to_jsonb(v_source_numbers),
      'moved_items', v_moved_items,
      'moved_batches', v_moved_batches,
      'added_discount_amount', v_source_discount,
      'released_table_ids', to_jsonb(v_released_tables),
      'atomic', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'target_order_id', v_target.id,
    'source_order_ids', to_jsonb(p_source_order_ids),
    'moved_items', v_moved_items,
    'released_table_ids', to_jsonb(v_released_tables),
    'discount_amount', greatest(coalesce(v_target.discount_amount, 0), 0) + v_source_discount
  );
end;
$$;
revoke all on function public.merge_kitchen_orders_atomic(uuid,uuid[]) from public,anon;
grant execute on function public.merge_kitchen_orders_atomic(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
