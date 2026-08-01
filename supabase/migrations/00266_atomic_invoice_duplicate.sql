-- ============================================================
-- 00266: Atomic invoice duplication into a new sales-order draft
-- ============================================================
-- Function definition only. Existing invoices, stock, cash and debt are untouched.

create or replace function public.duplicate_invoice_to_order_atomic(
  p_source_invoice_id uuid,
  p_target_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_source record;
  v_order_id uuid;
  v_code text;
  v_item_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'orders.create') then
    raise exception using errcode = '42501', message = 'ORDER_DUPLICATE_DENIED';
  end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_target_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_target_branch_id) then
    raise exception using errcode = '42501', message = 'ORDER_BRANCH_DENIED';
  end if;

  select i.* into v_source
    from public.invoices i
   where i.id = p_source_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null;
  if not found then
    raise exception using errcode = '22023', message = 'SOURCE_INVOICE_NOT_FOUND';
  end if;

  select count(*)::integer into v_item_count
    from public.invoice_items ii
   where ii.invoice_id = v_source.id;
  if v_item_count = 0 then
    raise exception using errcode = '22023', message = 'SOURCE_INVOICE_HAS_NO_ITEMS';
  end if;

  v_code := public.next_code(v_tenant_id, 'order');
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status, source,
    subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
    payment_method, note, created_by, auto_saved
  ) values (
    v_tenant_id, p_target_branch_id, v_code,
    v_source.customer_id, v_source.customer_name, 'draft', 'order',
    coalesce(v_source.subtotal, 0), coalesce(v_source.discount_amount, 0),
    coalesce(v_source.tax_amount, 0), coalesce(v_source.delivery_fee, 0),
    coalesce(v_source.total, 0), 0, coalesce(v_source.total, 0),
    coalesce(v_source.payment_method, 'cash'), v_source.note, v_actor, false
  ) returning id into v_order_id;

  insert into public.invoice_items (
    invoice_id, product_id, product_name, unit, quantity, unit_price,
    discount, vat_rate, vat_amount, total, returned_qty, unit_cost, note, variant_id
  )
  select
    v_order_id, ii.product_id, ii.product_name, ii.unit, ii.quantity, ii.unit_price,
    coalesce(ii.discount, 0), coalesce(ii.vat_rate, 0), coalesce(ii.vat_amount, 0),
    ii.total, 0, null, ii.note, ii.variant_id
  from public.invoice_items ii
  where ii.invoice_id = v_source.id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'invoice_duplicated_to_order', 'sales_order', v_order_id,
    jsonb_build_object(
      'source_invoice_id', v_source.id,
      'source_invoice_code', v_source.code,
      'target_order_code', v_code,
      'target_branch_id', p_target_branch_id,
      'item_count', v_item_count,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'invoice_id', v_order_id,
    'invoice_code', v_code,
    'source_invoice_id', v_source.id,
    'item_count', v_item_count
  );
end;
$$;

revoke all on function public.duplicate_invoice_to_order_atomic(uuid, uuid)
  from public, anon;
grant execute on function public.duplicate_invoice_to_order_atomic(uuid, uuid)
  to authenticated;

comment on function public.duplicate_invoice_to_order_atomic(uuid, uuid) is
  'Atomically duplicates one tenant invoice into a new order draft without stock or cash effects.';

select to_regprocedure(
  'public.duplicate_invoice_to_order_atomic(uuid,uuid)'
) is not null as duplicate_invoice_to_order_atomic_ok;
