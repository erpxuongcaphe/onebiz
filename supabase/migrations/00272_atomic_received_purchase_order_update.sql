-- ============================================================
-- 00272: Atomic update for a received purchase order
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.update_received_purchase_order_atomic(
  p_purchase_order_id uuid,
  p_requested_paid numeric,
  p_note text,
  p_payment_method text default 'cash'
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
  v_requested_paid numeric := coalesce(p_requested_paid, 0);
  v_payment_delta numeric;
  v_payment_result jsonb;
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

  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select po.id, po.code, po.branch_id, po.status, po.total,
         coalesce(po.paid, 0) as paid, coalesce(po.note, '') as note
    into v_order
    from public.purchase_orders po
   where po.id = p_purchase_order_id
     and po.tenant_id = v_tenant_id
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;
  if v_order.status not in ('partial', 'completed') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_RECEIVED';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_requested_paid < v_order.paid then
    raise exception using errcode = '22023', message = 'PAID_AMOUNT_CANNOT_DECREASE';
  end if;
  if v_requested_paid > coalesce(v_order.total, 0) then
    raise exception using errcode = '22023', message = 'PAYMENT_EXCEEDS_TOTAL';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception using errcode = '22023', message = 'NOTE_TOO_LONG';
  end if;

  v_payment_delta := v_requested_paid - v_order.paid;
  if v_payment_delta > 0 then
    v_payment_result := public.record_purchase_payment(
      v_order.id,
      v_payment_delta,
      p_payment_method,
      'Thanh toan bo sung phieu nhap ' || v_order.code,
      v_order.branch_id,
      null
    );
  end if;

  update public.purchase_orders
     set note = nullif(trim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = v_order.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'purchase_order_received_update',
    'purchase_order',
    v_order.id,
    jsonb_build_object('paid', v_order.paid, 'note', nullif(v_order.note, '')),
    jsonb_build_object(
      'paid', v_requested_paid,
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'payment_delta', v_payment_delta,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'purchase_order_id', v_order.id,
    'code', v_order.code,
    'status', v_order.status,
    'paid', v_requested_paid,
    'debt', coalesce(v_order.total, 0) - v_requested_paid,
    'payment_result', v_payment_result
  );
end;
$$;

revoke all on function public.update_received_purchase_order_atomic(
  uuid, numeric, text, text
) from public, anon;

grant execute on function public.update_received_purchase_order_atomic(
  uuid, numeric, text, text
) to authenticated;

comment on function public.update_received_purchase_order_atomic(
  uuid, numeric, text, text
) is 'Atomically records any added supplier payment and updates a received purchase order note.';

select to_regprocedure(
  'public.update_received_purchase_order_atomic(uuid,numeric,text,text)'
) is not null as update_received_purchase_order_atomic_ok;
