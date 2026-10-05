-- Keep COD amount, locks and settlement logic; use Vietnam cash book days.
-- Enforce the existing branch-access policy before any invoice/cash write.
begin;
create or replace function public.settle_cod_atomic(
  p_partner_id uuid,
  p_items jsonb,               -- [{"shipment_id":"…","partner_fee":15000}, …]
  p_payment_method text,
  p_note text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_tenant uuid;
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_item record;
  v_ship record;
  v_invoice record;
  v_settlement_id uuid := gen_random_uuid();
  v_code text;
  v_partner_name text;
  v_branch_id uuid;
  v_total_cod numeric := 0;
  v_total_fee numeric := 0;
  v_pay numeric;
  v_cash_code text;
  v_fee_cash_id uuid;
  v_receipts int := 0;
begin
  -- ── Xác thực + quyền: đúng khuôn 00242 ──
  v_actor := case when v_is_service_role then p_user_id else auth.uid() end;
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not v_is_service_role
     and p_user_id is not null
     and p_user_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_actor_tenant
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  -- ai thu nợ được thì đối soát được — không đẻ mã quyền mới
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_SHIPMENTS_SELECTED' using errcode = 'P0001';
  end if;

  if p_partner_id is not null then
    select name into v_partner_name
      from public.delivery_partners
     where id = p_partner_id and tenant_id = v_actor_tenant;
    if not found then
      raise exception 'PARTNER_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    v_partner_name := 'Chua gan doi tac';
  end if;

  v_code := public.next_code(v_actor_tenant, 'shipping_settlement');

  -- Tạo phiếu TRƯỚC (số 0) để vận đơn trỏ FK vào được; chốt tổng ở cuối.
  insert into public.shipping_settlements (
    id, tenant_id, code, partner_id, payment_method, note, created_by
  ) values (
    v_settlement_id, v_actor_tenant, v_code, p_partner_id,
    p_payment_method, nullif(trim(coalesce(p_note, '')), ''), v_actor
  );

  for v_item in
    select (e->>'shipment_id')::uuid as shipment_id,
           greatest(coalesce((e->>'partner_fee')::numeric, 0), 0) as partner_fee
      from jsonb_array_elements(p_items) e
  loop
    select s.* into v_ship
      from public.shipping_orders s
     where s.id = v_item.shipment_id and s.tenant_id = v_actor_tenant
     for update;
    if not found then
      raise exception 'SHIPMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_ship.status <> 'delivered' then
      raise exception 'SHIPMENT_NOT_DELIVERED|%', v_ship.code using errcode = 'P0001';
    end if;
    if v_ship.settlement_id is not null then
      raise exception 'SHIPMENT_ALREADY_SETTLED|%', v_ship.code using errcode = 'P0001';
    end if;
    if v_ship.partner_id is distinct from p_partner_id then
      raise exception 'SHIPMENT_PARTNER_MISMATCH|%', v_ship.code using errcode = 'P0001';
    end if;

    v_total_fee := v_total_fee + v_item.partner_fee;

    -- ── Thu COD vào hóa đơn — nhân bản khối record_invoice_payment ──
    select i.id, i.branch_id, i.code, i.customer_id, i.customer_name,
           i.paid, i.debt, i.status
      into v_invoice
      from public.invoices i
     where i.id = v_ship.invoice_id and i.tenant_id = v_actor_tenant
     for update;
    if not found then
      raise exception 'INVOICE_NOT_FOUND|%', v_ship.code using errcode = 'P0001';
    end if;
    if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
      raise exception 'BRANCH_ACCESS_DENIED' using errcode = '42501';
    end if;
    -- kỷ luật 00213: KHÔNG thu tiền trên chứng từ chưa hoàn tất
    if v_invoice.status <> 'completed' then
      raise exception 'INVOICE_NOT_COMPLETED|%', v_invoice.code using errcode = 'P0001';
    end if;
    if v_branch_id is null then
      v_branch_id := v_invoice.branch_id;
    end if;

    -- thu tối đa phần nợ còn lại (nếu đã thu nợ tay trước thì không thu trùng)
    v_pay := least(coalesce(v_ship.cod_amount, 0), greatest(coalesce(v_invoice.debt, 0), 0));
    if v_pay > 0 then
      v_cash_code := public.next_cash_code(v_actor_tenant, 'receipt');
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount, counterparty,
        payment_method, reference_type, reference_id, customer_id,
        note, created_by, status, transaction_date
      ) values (
        v_actor_tenant, v_invoice.branch_id, v_cash_code, 'receipt',
        'customer_payment', v_pay, v_invoice.customer_name,
        p_payment_method, 'invoice', v_invoice.id, v_invoice.customer_id,
        'Thu COD ' || v_ship.code || ' - doi soat ' || v_code,
        v_actor, 'completed', ((now() at time zone 'Asia/Ho_Chi_Minh')::date)
      );

      update public.invoices
         set paid = coalesce(paid, 0) + v_pay,
             debt = coalesce(debt, 0) - v_pay,
             updated_at = now()
       where id = v_invoice.id and tenant_id = v_actor_tenant;

      v_total_cod := v_total_cod + v_pay;
      v_receipts := v_receipts + 1;
    end if;

    update public.shipping_orders
       set settlement_id = v_settlement_id,
           cod_collected_at = now(),
           partner_fee = v_item.partner_fee,
           updated_at = now()
     where id = v_ship.id and tenant_id = v_actor_tenant;
  end loop;

  -- ── 1 phiếu chi gộp phí trả đối tác ──
  if v_total_fee > 0 then
    v_cash_code := public.next_cash_code(v_actor_tenant, 'payment');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount, counterparty,
      payment_method, reference_type, reference_id,
      note, created_by, status, transaction_date
    ) values (
      v_actor_tenant, v_branch_id, v_cash_code, 'payment',
      'delivery_partner_fee', v_total_fee, v_partner_name,
      p_payment_method, 'shipping_settlement', v_settlement_id,
      'Phi giao hang - doi soat ' || v_code,
      v_actor, 'completed', ((now() at time zone 'Asia/Ho_Chi_Minh')::date)
    )
    returning id into v_fee_cash_id;
  end if;

  update public.shipping_settlements
     set branch_id = v_branch_id,
         total_cod = v_total_cod,
         total_partner_fee = v_total_fee,
         net_amount = v_total_cod - v_total_fee,
         fee_cash_tx_id = v_fee_cash_id
   where id = v_settlement_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_tenant, v_actor, 'settle', 'shipping_settlement', v_settlement_id,
    jsonb_build_object(
      'code', v_code, 'partner_id', p_partner_id,
      'total_cod', v_total_cod, 'total_partner_fee', v_total_fee,
      'net_amount', v_total_cod - v_total_fee, 'receipts', v_receipts
    )
  );

  return jsonb_build_object(
    'settlement_id', v_settlement_id,
    'code', v_code,
    'total_cod', v_total_cod,
    'total_partner_fee', v_total_fee,
    'net_amount', v_total_cod - v_total_fee,
    'receipts', v_receipts
  );
end;
$$;
notify pgrst, 'reload schema';
commit;
