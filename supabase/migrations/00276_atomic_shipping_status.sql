-- ============================================================
-- 00276: Atomic shipping-order status transition
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.update_shipping_order_status_atomic(
  p_shipping_order_id uuid,
  p_next_status text,
  p_note text default null
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
  v_updated record;
  v_required_permission text;
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

  select so.id, so.tenant_id, so.invoice_id, so.status, so.code, i.branch_id
    into v_order
    from public.shipping_orders so
    join public.invoices i
      on i.id = so.invoice_id
     and i.tenant_id = so.tenant_id
   where so.id = p_shipping_order_id
     and so.tenant_id = v_tenant_id
   for update of so;
  if not found then
    raise exception using errcode = '22023', message = 'SHIPPING_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  v_required_permission := case
    when p_next_status = 'cancelled' then 'orders.cancel'
    else 'orders.create'
  end;
  if not public.user_has_permission(v_actor, v_required_permission) then
    raise exception using errcode = '42501', message = 'SHIPPING_STATUS_PERMISSION_REQUIRED';
  end if;

  if not (
    (v_order.status = 'pending' and p_next_status in ('picked_up', 'cancelled'))
    or (v_order.status = 'picked_up' and p_next_status in ('in_transit', 'returned'))
    or (v_order.status = 'in_transit' and p_next_status in ('delivered', 'returned'))
  ) then
    raise exception using errcode = '22023', message = 'SHIPPING_STATUS_TRANSITION_INVALID';
  end if;
  if length(coalesce(p_note, '')) > 1000 then
    raise exception using errcode = '22023', message = 'SHIPPING_NOTE_TOO_LONG';
  end if;

  update public.shipping_orders so
     set status = p_next_status,
         updated_at = now()
   where so.id = v_order.id
     and so.tenant_id = v_tenant_id
     and so.status = v_order.status
  returning so.* into v_updated;
  if not found then
    raise exception using errcode = '40001', message = 'SHIPPING_STATUS_CONCURRENT_CHANGE';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'update_status',
    'shipping_order',
    v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object(
      'status', p_next_status,
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'branch_id', v_order.branch_id,
      'atomic', true
    )
  );

  return to_jsonb(v_updated) || jsonb_build_object(
    'invoices', jsonb_build_object(
      'code', (select i.code from public.invoices i where i.id = v_order.invoice_id)
    ),
    'delivery_partners', case
      when v_updated.partner_id is null then null
      else jsonb_build_object(
        'name', (select dp.name from public.delivery_partners dp where dp.id = v_updated.partner_id)
      )
    end
  );
end;
$$;

revoke all on function public.update_shipping_order_status_atomic(uuid, text, text)
  from public, anon;
grant execute on function public.update_shipping_order_status_atomic(uuid, text, text)
  to authenticated;

select to_regprocedure(
  'public.update_shipping_order_status_atomic(uuid,text,text)'
) is not null as update_shipping_order_status_atomic_ok;
