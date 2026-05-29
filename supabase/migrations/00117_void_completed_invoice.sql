-- ============================================================
-- 00117: Hủy + HOÀN TÁC hóa đơn ĐÃ HOÀN THÀNH (giữ bản ghi)
-- (CEO 29/05/2026)
--
-- Trước đây cancelInvoice chỉ cho hủy draft/confirmed (flip status).
-- Hóa đơn 'completed' bị khóa vì cần đảo ngược toàn bộ side-effect.
-- Migration này thêm RPC atomic đảo ngược ĐÚNG những gì checkout đã ghi:
--
--   Forward (pos_complete_checkout_atomic / fnb_complete_payment_atomic):
--     SKU/topping  : stock_movements 'out' (ref 'invoice')
--                    + increment_product_stock(-) + upsert_branch_stock(-)
--                    + allocate_lots_fifo (product_lots/-) + lot_allocations(+)
--     NVL theo BOM : stock_movements 'out' (ref 'bom_consume')
--                    + upsert_branch_stock(-)  ← KHÔNG đụng products.stock
--     Tiền         : cash_transactions 'receipt' (ref 'invoice')
--     Công nợ      : invoices.debt = total - paid  ← KHÔNG đụng customers.debt
--     Điểm (loyalty): earn/redeem ledger ngoài RPC (client-side, best-effort)
--
--   Reversal (hàm dưới) mirror CHÍNH XÁC bất đối xứng trên:
--     - SKU/topping → +products.stock và +branch_stock
--     - NVL BOM     → CHỈ +branch_stock
--     - Lô          → +product_lots.current_qty, hồi 'consumed'→'active',
--                     ghi lot_allocations âm để net = 0 (giữ audit)
--     - Tiền        → ghi cash 'payment' bù (Phiếu chi hoàn tiền)
--     - Công nợ     → zero invoices.debt (KHÔNG đụng customers.debt)
--     - Điểm        → đảo net điểm của HĐ (best-effort, không chặn nếu lỗi)
--     - invoices    → status='cancelled' + cancelled_at/by + cancel_reason
--
-- An toàn dữ liệu:
--   - Toàn bộ trong 1 transaction (atomic).
--   - Idempotent: chỉ chạy khi status='completed'; sau đó 'cancelled' →
--     gọi lại sẽ bị chặn (không hoàn tác 2 lần).
--   - GIỮ nguyên invoice + invoice_items + movement gốc (audit trail).
--   - Movement bù dùng reference_type='invoice_void' để report phân biệt.
-- ============================================================

-- 1. Cột audit cho việc hủy (non-destructive, idempotent)
alter table public.invoices
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text;

-- 2. RPC atomic
create or replace function public.void_completed_invoice_atomic(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_actor uuid,
  p_reason text default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv record;
  r record;
  v_cash_code text;
  v_loyalty_net integer := 0;
  v_loyalty_balance integer;
  v_reversed_stock int := 0;
  v_reversed_cash numeric := 0;
  v_restored_lots int := 0;
begin
  -- ─── 0. Cross-tenant guard (defense-in-depth, RPC là SECURITY DEFINER) ───
  if p_tenant_id is null or p_tenant_id <> public.get_user_tenant_id() then
    raise exception 'VOID: tenant mismatch';
  end if;

  -- ─── 1. Load + lock invoice; guard status (idempotency) ───
  select * into v_inv
  from public.invoices
  where id = p_invoice_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'VOID: không tìm thấy hóa đơn trong tenant này';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'VOID: hóa đơn % đã được hủy trước đó', v_inv.code;
  end if;
  if v_inv.status <> 'completed' then
    raise exception 'VOID: chỉ hoàn tác hóa đơn đã hoàn thành (hiện tại: %)', v_inv.status;
  end if;

  -- ─── 2. Hoàn kho theo stock_movements gốc của HĐ ───
  -- SKU/topping (ref 'invoice')  → +products.stock + +branch_stock
  -- NVL BOM     (ref 'bom_consume') → CHỈ +branch_stock (mirror forward)
  for r in
    select id, branch_id, product_id, quantity, reference_type
    from public.stock_movements
    where tenant_id = p_tenant_id
      and reference_id = p_invoice_id
      and type = 'out'
      and reference_type in ('invoice', 'bom_consume')
  loop
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, r.branch_id, r.product_id, 'in', r.quantity,
      'invoice_void', p_invoice_id,
      'Hoàn kho hủy HĐ ' || v_inv.code, p_actor
    );

    if r.reference_type = 'invoice' then
      perform public.increment_product_stock(r.product_id, r.quantity);
    end if;
    perform public.upsert_branch_stock(p_tenant_id, r.branch_id, r.product_id, r.quantity);
    v_reversed_stock := v_reversed_stock + 1;
  end loop;

  -- ─── 3. Hồi lô FIFO đã xuất cho HĐ ───
  for r in
    select id, lot_id, quantity
    from public.lot_allocations
    where tenant_id = p_tenant_id
      and source_type = 'invoice'
      and source_id = p_invoice_id
      and quantity > 0
  loop
    update public.product_lots
    set current_qty = current_qty + r.quantity,
        status = case when status = 'consumed' then 'active' else status end,
        updated_at = now()
    where id = r.lot_id;

    -- Ghi allocation âm để tổng phân bổ về 0 (giữ dòng dương gốc cho audit)
    insert into public.lot_allocations (
      tenant_id, lot_id, source_type, source_id, quantity, allocated_by
    ) values (
      p_tenant_id, r.lot_id, 'invoice', p_invoice_id, -r.quantity, p_actor
    );
    v_restored_lots := v_restored_lots + 1;
  end loop;

  -- ─── 4. Hoàn tiền: ghi cash 'payment' bù cho từng receipt của HĐ ───
  for r in
    select branch_id, amount, payment_method, counterparty
    from public.cash_transactions
    where tenant_id = p_tenant_id
      and reference_id = p_invoice_id
      and reference_type = 'invoice'
      and type = 'receipt'
  loop
    v_cash_code := public.next_code(p_tenant_id, 'cash_payment');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PC' || extract(epoch from now())::bigint::text;
    end if;
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, payment_method, reference_type, reference_id,
      note, created_by, shift_id
    ) values (
      p_tenant_id, r.branch_id, v_cash_code, 'payment', 'Hoàn tiền hủy đơn', r.amount,
      r.counterparty,
      case when r.payment_method in ('cash','transfer','card') then r.payment_method else 'cash' end,
      'invoice_void', p_invoice_id,
      'Hoàn tiền hủy HĐ ' || v_inv.code, p_actor, p_shift_id
    );
    v_reversed_cash := v_reversed_cash + r.amount;
  end loop;

  -- ─── 5. Đảo điểm loyalty của HĐ (best-effort — chỉ số mềm, không chặn) ───
  begin
    if v_inv.customer_id is not null then
      select coalesce(sum(points), 0) into v_loyalty_net
      from public.loyalty_transactions
      where tenant_id = p_tenant_id
        and reference_type = 'invoice'
        and reference_id = p_invoice_id;

      if v_loyalty_net <> 0 then
        update public.customers
        set loyalty_points = greatest(0, loyalty_points - v_loyalty_net)
        where id = v_inv.customer_id and tenant_id = p_tenant_id
        returning loyalty_points into v_loyalty_balance;

        insert into public.loyalty_transactions (
          tenant_id, customer_id, type, points, balance_after,
          reference_type, reference_id, note, created_by
        ) values (
          p_tenant_id, v_inv.customer_id, 'adjust', -v_loyalty_net,
          coalesce(v_loyalty_balance, 0),
          'invoice_void', p_invoice_id,
          'Hoàn điểm do hủy HĐ ' || v_inv.code, p_actor
        );
      end if;
    end if;
  exception when others then
    -- nuốt lỗi loyalty: không để chặn hoàn tác kho/tiền
    null;
  end;

  -- ─── 6. Flip invoice → cancelled, zero debt, đóng dấu audit ───
  update public.invoices
  set status = 'cancelled',
      debt = 0,
      cancelled_at = now(),
      cancelled_by = p_actor,
      cancel_reason = nullif(p_reason, ''),
      updated_at = now()
  where id = p_invoice_id;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_code', v_inv.code,
    'reversed_stock_movements', v_reversed_stock,
    'restored_lots', v_restored_lots,
    'reversed_cash', v_reversed_cash,
    'loyalty_net_reversed', v_loyalty_net
  );
end;
$$;

grant execute on function public.void_completed_invoice_atomic(uuid, uuid, uuid, text, uuid) to authenticated;

comment on function public.void_completed_invoice_atomic is
  'Hủy + hoàn tác hóa đơn completed: đảo kho/lô/tiền/điểm, zero debt, status=cancelled, giữ bản ghi + audit. Atomic. CEO 29/05/2026.';

notify pgrst, 'reload schema';
