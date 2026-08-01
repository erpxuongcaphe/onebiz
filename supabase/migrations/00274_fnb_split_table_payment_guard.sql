-- ============================================================
-- 00274: Keep an F&B table occupied while split bills remain unpaid
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.fnb_complete_payment_atomic(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_discount_amount numeric,
  p_note text,
  p_created_by uuid,
  p_shift_id uuid default null,
  p_tip_amount numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_result jsonb;
  v_invoice_id uuid;
  v_next_order_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if coalesce(p_discount_amount, 0) > 0
     and not public.user_has_permission(v_actor, 'pos_fnb.discount') then
    raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
  end if;

  select ko.id, ko.tenant_id, ko.branch_id, ko.invoice_id, ko.status, ko.table_id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_order.invoice_id is not null then
    raise exception 'KITCHEN_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id = p_customer_id
       and c.tenant_id = v_tenant_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_order.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_USER_BRANCH' using errcode = 'P0001';
  end if;

  v_result := public._fnb_complete_payment_impl_00230(
    p_kitchen_order_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    p_payment_breakdown,
    p_paid,
    p_discount_amount,
    p_note,
    v_actor,
    p_shift_id,
    p_tip_amount
  );

  -- The legacy payment helper releases the table immediately. For a split
  -- bill, keep it occupied while another unpaid part still exists.
  if v_order.table_id is not null then
    select ko.id
      into v_next_order_id
      from public.kitchen_orders ko
     where ko.tenant_id = v_tenant_id
       and ko.table_id = v_order.table_id
       and ko.id <> v_order.id
       and ko.invoice_id is null
       and ko.status not in ('completed', 'cancelled')
     order by ko.created_at, ko.id
     limit 1
     for update;

    if v_next_order_id is not null then
      update public.restaurant_tables
         set status = 'occupied',
             current_order_id = v_next_order_id,
             updated_at = now()
       where id = v_order.table_id
         and tenant_id = v_tenant_id;
    end if;
  end if;

  begin
    v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
  exception when others then
    v_invoice_id := null;
  end;
  if v_invoice_id is null then
    raise exception 'INVALID_PAYMENT_RESULT' using errcode = 'P0001';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'complete_payment',
    'invoice',
    v_invoice_id,
    jsonb_build_object(
      'source', 'fnb',
      'kitchen_order_id', v_order.id,
      'branch_id', v_order.branch_id,
      'discount_amount', coalesce(p_discount_amount, 0),
      'tip_amount', coalesce(p_tip_amount, 0),
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

revoke all on function public.fnb_complete_payment_atomic(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) from public, anon;

grant execute on function public.fnb_complete_payment_atomic(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) to authenticated;

comment on function public.fnb_complete_payment_atomic(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) is 'Completes F&B payment and keeps the table occupied when another split bill remains unpaid.';

select
  to_regprocedure(
    'public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
  ) is not null as fnb_payment_split_table_guard_ok;
