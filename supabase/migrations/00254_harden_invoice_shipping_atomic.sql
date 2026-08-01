-- ============================================================
-- 00254: Atomic invoice delivery fee + shipment creation
--
-- No existing business row is changed when this migration is applied.
-- Future mutations update invoice totals, debt, shipment and audit together.
-- ============================================================

create or replace function public.attach_invoice_shipment_atomic(
  p_invoice_id uuid,
  p_delivery_fee numeric,
  p_receiver_name text default null,
  p_receiver_phone text default null,
  p_receiver_address text default null,
  p_partner_id uuid default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_invoice record;
  v_existing record;
  v_shipment_id uuid;
  v_shipment_code text;
  v_old_fee numeric;
  v_new_total numeric;
  v_new_debt numeric;
  v_name text := nullif(trim(coalesce(p_receiver_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_receiver_phone, '')), '');
  v_address text := nullif(trim(coalesce(p_receiver_address, '')), '');
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not (
    public.user_has_permission(v_actor, 'orders.create')
    or public.user_has_permission(v_actor, 'pos_retail.checkout')
  ) then
    raise exception using errcode = '42501', message = 'SHIPMENT_PERMISSION_DENIED';
  end if;
  if coalesce(p_delivery_fee, 0) < 0 then
    raise exception using errcode = '22023', message = 'SHIPMENT_FEE_INVALID';
  end if;

  select i.*
  into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.tenant_id = v_tenant_id
    and i.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'INVOICE_CANCELLED';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  if p_partner_id is not null and not exists (
    select 1
    from public.delivery_partners dp
    where dp.id = p_partner_id
      and dp.tenant_id = v_tenant_id
      and dp.is_active = true
  ) then
    raise exception using errcode = '22023', message = 'DELIVERY_PARTNER_INVALID';
  end if;

  v_old_fee := coalesce(v_invoice.delivery_fee, 0);
  v_new_total := greatest(0, coalesce(v_invoice.total, 0) - v_old_fee)
    + coalesce(p_delivery_fee, 0);
  v_new_debt := greatest(0, v_new_total - coalesce(v_invoice.paid, 0));

  update public.invoices
  set delivery_fee = coalesce(p_delivery_fee, 0),
      total = v_new_total,
      debt = v_new_debt
  where id = p_invoice_id
    and tenant_id = v_tenant_id;

  -- Fee-only reconciliation is valid for a pickup order without receiver data.
  if v_name is null or v_phone is null or v_address is null then
    if v_name is not null or v_phone is not null or v_address is not null then
      raise exception using errcode = '22023', message = 'SHIPMENT_RECEIVER_INCOMPLETE';
    end if;
    select so.*
    into v_existing
    from public.shipping_orders so
    where so.tenant_id = v_tenant_id
      and so.invoice_id = p_invoice_id
      and so.status not in ('cancelled', 'returned')
    order by so.created_at desc
    limit 1;
    if found then
      if coalesce(v_existing.shipping_fee, 0) <> coalesce(p_delivery_fee, 0) then
        raise exception using errcode = '23505', message = 'ACTIVE_SHIPMENT_EXISTS';
      end if;
      return jsonb_build_object(
        'shipment_id', v_existing.id,
        'shipment_code', v_existing.code,
        'delivery_fee', coalesce(p_delivery_fee, 0),
        'total', v_new_total,
        'debt', v_new_debt,
        'idempotent', true
      );
    end if;
    return jsonb_build_object(
      'shipment_id', null,
      'shipment_code', null,
      'delivery_fee', coalesce(p_delivery_fee, 0),
      'total', v_new_total,
      'debt', v_new_debt
    );
  end if;

  select so.*
  into v_existing
  from public.shipping_orders so
  where so.tenant_id = v_tenant_id
    and so.invoice_id = p_invoice_id
    and so.status not in ('cancelled', 'returned')
  order by so.created_at desc
  limit 1;

  if found then
    if coalesce(v_existing.shipping_fee, 0) = coalesce(p_delivery_fee, 0)
       and v_existing.receiver_name = v_name
       and v_existing.receiver_phone = v_phone
       and v_existing.receiver_address = v_address
       and v_existing.partner_id is not distinct from p_partner_id then
      return jsonb_build_object(
        'shipment_id', v_existing.id,
        'shipment_code', v_existing.code,
        'delivery_fee', coalesce(p_delivery_fee, 0),
        'total', v_new_total,
        'debt', v_new_debt,
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'ACTIVE_SHIPMENT_EXISTS';
  end if;

  v_shipment_code := public.next_code(v_tenant_id, 'shipping_order');
  insert into public.shipping_orders (
    tenant_id,
    invoice_id,
    partner_id,
    code,
    status,
    shipping_fee,
    cod_amount,
    receiver_name,
    receiver_phone,
    receiver_address,
    note
  ) values (
    v_tenant_id,
    p_invoice_id,
    p_partner_id,
    v_shipment_code,
    'pending',
    coalesce(p_delivery_fee, 0),
    v_new_debt,
    v_name,
    v_phone,
    v_address,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_shipment_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'attach_shipment',
    'invoice',
    p_invoice_id,
    jsonb_build_object(
      'delivery_fee', v_old_fee,
      'total', v_invoice.total,
      'debt', v_invoice.debt
    ),
    jsonb_build_object(
      'delivery_fee', coalesce(p_delivery_fee, 0),
      'total', v_new_total,
      'debt', v_new_debt,
      'shipment_id', v_shipment_id,
      'shipment_code', v_shipment_code
    )
  );

  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'shipment_code', v_shipment_code,
    'delivery_fee', coalesce(p_delivery_fee, 0),
    'total', v_new_total,
    'debt', v_new_debt,
    'idempotent', false
  );
end;
$$;

revoke all on function public.attach_invoice_shipment_atomic(
  uuid, numeric, text, text, text, uuid, text
) from public, anon;
grant execute on function public.attach_invoice_shipment_atomic(
  uuid, numeric, text, text, text, uuid, text
) to authenticated;

notify pgrst, 'reload schema';

-- Read-only verification:
-- select to_regprocedure(
--   'public.attach_invoice_shipment_atomic(uuid,numeric,text,text,text,uuid,text)'
-- ) is not null as shipping_rpc_ok;
