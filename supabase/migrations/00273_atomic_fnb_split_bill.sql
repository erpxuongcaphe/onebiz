-- ============================================================
-- 00273: Atomic F&B split bill
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.split_kitchen_order_atomic(
  p_order_id uuid,
  p_mode text,
  p_item_ids uuid[] default null,
  p_number_of_ways integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_total_items integer;
  v_selected_items integer;
  v_distinct_items integer;
  v_matching_items integer;
  v_ways integer;
  v_child_index integer;
  v_existing_children integer;
  v_child_id uuid;
  v_child_number text;
  v_move_ids uuid[];
  v_moved integer;
  v_parent_left integer;
  v_total_gross numeric;
  v_child_gross numeric;
  v_original_discount numeric;
  v_child_discount numeric;
  v_allocated_discount numeric := 0;
  v_parent_discount numeric;
  v_children jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.split_bill') then
    raise exception using errcode = '42501', message = 'SPLIT_BILL_PERMISSION_REQUIRED';
  end if;

  select ko.*
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'KITCHEN_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_order.invoice_id is not null or v_order.status in ('completed', 'cancelled') then
    raise exception using errcode = '22023', message = 'KITCHEN_ORDER_NOT_SPLITTABLE';
  end if;
  if v_order.order_type = 'delivery' then
    raise exception using errcode = '22023', message = 'DELIVERY_ORDER_CANNOT_SPLIT';
  end if;

  perform 1
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id
   order by koi.id
   for update;

  select count(*), coalesce(sum(koi.quantity * koi.unit_price), 0)
    into v_total_items, v_total_gross
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id;
  if v_total_items < 2 then
    raise exception using errcode = '22023', message = 'NOT_ENOUGH_ITEMS_TO_SPLIT';
  end if;

  v_original_discount := greatest(coalesce(v_order.discount_amount, 0), 0);
  if v_original_discount > v_total_gross then
    raise exception using errcode = '22023', message = 'ORDER_DISCOUNT_INVALID';
  end if;

  select count(*)
    into v_existing_children
    from public.kitchen_orders ko
   where ko.parent_order_id = v_order.id
     and ko.tenant_id = v_tenant_id;

  if p_mode = 'items' then
    v_selected_items := coalesce(cardinality(p_item_ids), 0);
    if v_selected_items = 0 or v_selected_items >= v_total_items then
      raise exception using errcode = '22023', message = 'SPLIT_ITEM_SELECTION_INVALID';
    end if;
    select count(distinct item_id)
      into v_distinct_items
      from unnest(p_item_ids) as selected(item_id);
    if v_distinct_items <> v_selected_items then
      raise exception using errcode = '22023', message = 'SPLIT_ITEM_DUPLICATE';
    end if;
    select count(*)
      into v_matching_items
      from public.kitchen_order_items koi
     where koi.kitchen_order_id = v_order.id
       and koi.id = any(p_item_ids);
    if v_matching_items <> v_selected_items then
      raise exception using errcode = '22023', message = 'SPLIT_ITEM_NOT_IN_ORDER';
    end if;
    v_ways := 2;
  elsif p_mode = 'equal' then
    v_ways := coalesce(p_number_of_ways, 0);
    if v_ways < 2 or v_ways > 10 or v_total_items < v_ways then
      raise exception using errcode = '22023', message = 'SPLIT_WAYS_INVALID';
    end if;
  else
    raise exception using errcode = '22023', message = 'SPLIT_MODE_INVALID';
  end if;

  for v_child_index in 1..(v_ways - 1) loop
    if p_mode = 'items' then
      v_move_ids := p_item_ids;
    else
      select array_agg(ranked.id order by ranked.row_no)
        into v_move_ids
        from (
          select koi.id, row_number() over (order by koi.id) as row_no
          from public.kitchen_order_items koi
          where koi.kitchen_order_id = v_order.id
        ) ranked
       where mod((ranked.row_no - 1)::integer, v_ways) = v_child_index;
    end if;

    if coalesce(cardinality(v_move_ids), 0) = 0 then
      raise exception using errcode = '22023', message = 'SPLIT_CHILD_EMPTY';
    end if;

    select coalesce(sum(koi.quantity * koi.unit_price), 0)
      into v_child_gross
      from public.kitchen_order_items koi
     where koi.kitchen_order_id = v_order.id
       and koi.id = any(v_move_ids);

    v_child_discount := case
      when v_original_discount > 0 and v_total_gross > 0
        then round(v_original_discount * v_child_gross / v_total_gross, 2)
      else 0
    end;
    v_allocated_discount := v_allocated_discount + v_child_discount;
    v_child_number := v_order.order_number || '-' ||
      case
        when v_existing_children + v_child_index + 1 <= 26
          then chr(64 + v_existing_children + v_child_index + 1)
        else 'P' || (v_existing_children + v_child_index + 1)::text
      end;

    insert into public.kitchen_orders (
      tenant_id, branch_id, table_id, order_number, order_type, status,
      note, created_by, parent_order_id, discount_amount, discount_reason
    ) values (
      v_order.tenant_id,
      v_order.branch_id,
      v_order.table_id,
      v_child_number,
      v_order.order_type,
      v_order.status,
      'Tach tu ' || v_order.order_number,
      v_actor,
      v_order.id,
      v_child_discount,
      case when v_child_discount > 0 then 'Phan bo khi tach bill' else null end
    )
    returning id into v_child_id;

    update public.kitchen_order_items
       set kitchen_order_id = v_child_id
     where kitchen_order_id = v_order.id
       and id = any(v_move_ids);
    get diagnostics v_moved = row_count;
    if v_moved <> cardinality(v_move_ids) then
      raise exception using errcode = '40001', message = 'SPLIT_CONCURRENT_CHANGE';
    end if;

    v_children := v_children || jsonb_build_array(jsonb_build_object(
      'order_id', v_child_id,
      'order_number', v_child_number,
      'item_count', v_moved,
      'discount_amount', v_child_discount
    ));
  end loop;

  select count(*)
    into v_parent_left
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id;
  if v_parent_left < 1 then
    raise exception using errcode = '40001', message = 'SPLIT_PARENT_EMPTY';
  end if;

  v_parent_discount := greatest(v_original_discount - v_allocated_discount, 0);
  update public.kitchen_orders
     set discount_amount = v_parent_discount,
         discount_reason = case
           when v_parent_discount > 0 then coalesce(v_order.discount_reason, 'Phan bo khi tach bill')
           else null
         end,
         updated_at = now()
   where id = v_order.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_split_bill',
    'kitchen_order',
    v_order.id,
    jsonb_build_object(
      'mode', p_mode,
      'number_of_ways', v_ways,
      'parent_items_left', v_parent_left,
      'parent_discount_amount', v_parent_discount,
      'children', v_children,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'parent_order_id', v_order.id,
    'parent_items_left', v_parent_left,
    'parent_discount_amount', v_parent_discount,
    'children', v_children
  );
end;
$$;

revoke all on function public.split_kitchen_order_atomic(
  uuid, text, uuid[], integer
) from public, anon;

grant execute on function public.split_kitchen_order_atomic(
  uuid, text, uuid[], integer
) to authenticated;

comment on function public.split_kitchen_order_atomic(
  uuid, text, uuid[], integer
) is 'Atomically splits an unpaid F&B kitchen order and proportionally allocates its discount.';

select to_regprocedure(
  'public.split_kitchen_order_atomic(uuid,text,uuid[],integer)'
) is not null as split_kitchen_order_atomic_ok;
