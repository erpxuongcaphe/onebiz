-- ============================================================
-- 00248: Harden supplier deletion and short-close purchase order
--
-- Function definitions only. No existing business rows are changed while this
-- migration is applied.
-- ============================================================

begin;

create or replace function public.delete_supplier_atomic(
  p_supplier_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_supplier record;
  v_po_count integer := 0;
  v_product_count integer := 0;
  v_return_count integer := 0;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_actor_id is not null and p_actor_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'suppliers.delete') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select s.* into v_supplier
    from public.suppliers s
   where s.id = p_supplier_id
     and s.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*) into v_po_count
    from public.purchase_orders po
   where po.supplier_id = p_supplier_id
     and po.tenant_id = v_tenant_id;
  if v_po_count > 0 then
    raise exception 'SUPPLIER_HAS_PURCHASE_ORDERS: supplier has % purchase orders', v_po_count
      using errcode = 'P0001';
  end if;

  select count(*) into v_product_count
    from public.products p
   where p.supplier_id = p_supplier_id
     and p.tenant_id = v_tenant_id;
  if v_product_count > 0 then
    raise exception 'SUPPLIER_HAS_PRODUCTS: supplier is assigned to % products', v_product_count
      using errcode = 'P0001';
  end if;

  select count(*) into v_return_count
    from public.supplier_returns sr
   where sr.supplier_id = p_supplier_id
     and sr.tenant_id = v_tenant_id;
  if v_return_count > 0 then
    raise exception 'SUPPLIER_HAS_RETURNS: supplier has % returns', v_return_count
      using errcode = 'P0001';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data
  ) values (
    v_tenant_id,
    v_actor,
    'delete',
    'supplier',
    p_supplier_id,
    jsonb_build_object(
      'code', v_supplier.code,
      'name', v_supplier.name,
      'phone', v_supplier.phone,
      'email', v_supplier.email,
      'tax_code', v_supplier.tax_code,
      'atomic', true
    )
  );

  delete from public.suppliers
   where id = p_supplier_id
     and tenant_id = v_tenant_id;

  return jsonb_build_object(
    'success', true,
    'supplier_id', p_supplier_id,
    'code', v_supplier.code,
    'name', v_supplier.name
  );
end;
$$;

create or replace function public.close_purchase_order_short(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_received_count integer := 0;
  v_remaining_count integer := 0;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_actor_id is not null and p_actor_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'INVALID_REASON' using errcode = 'P0001';
  end if;

  select po.* into v_order
    from public.purchase_orders po
   where po.id = p_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'PO_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_order.status not in ('partial', 'ordered') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  select
    count(*) filter (where coalesce(poi.received_quantity, 0) >= poi.quantity),
    count(*) filter (where coalesce(poi.received_quantity, 0) < poi.quantity)
    into v_received_count, v_remaining_count
    from public.purchase_order_items poi
   where poi.purchase_order_id = p_order_id;

  update public.purchase_orders
     set status = 'completed',
         closed_short = true,
         close_reason = trim(p_reason),
         closed_at = now(),
         closed_by = v_actor,
         updated_at = now()
   where id = p_order_id
     and tenant_id = v_tenant_id
     and status in ('partial', 'ordered');
  if not found then
    raise exception 'PO_STATUS_RACE_DETECTED' using errcode = 'P0001';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'close_short',
    'purchase_order',
    p_order_id,
    jsonb_build_object(
      'code', v_order.code,
      'previous_status', v_order.status,
      'reason', trim(p_reason),
      'items_received_fully', v_received_count,
      'items_remaining', v_remaining_count,
      'branch_id', v_order.branch_id,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'code', v_order.code,
    'items_received_fully', v_received_count,
    'items_remaining', v_remaining_count
  );
end;
$$;

revoke all on function public.delete_supplier_atomic(uuid, uuid)
  from public, anon;
grant execute on function public.delete_supplier_atomic(uuid, uuid)
  to authenticated;

revoke all on function public.close_purchase_order_short(uuid, text, uuid)
  from public, anon;
grant execute on function public.close_purchase_order_short(uuid, text, uuid)
  to authenticated;

commit;

-- Verification only. All booleans must be true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%ACTOR_SPOOF_BLOCKED%' as actor_spoof_blocked,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  case when p.proname = 'close_purchase_order_short'
    then p.prosrc like '%user_has_branch_access%'
    else true
  end as branch_check_ok,
  p.prosrc like '%insert into public.audit_log%' as audit_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('delete_supplier_atomic', 'close_purchase_order_short')
order by p.proname;
