-- ============================================================
-- 00073: Stock integrity hardening (CEO 13/05/2026)
--
-- Sau audit kỹ logic nhập/xuất kho phát hiện 2 vấn đề:
--   1. fnb_void_invoice_atomic (00055) revert branch_stock + products.stock
--      nhưng KHÔNG revert product_lots.current_qty + lot_allocations
--      → drift giữa SUM(product_lots) và branch_stock sau mỗi lần void.
--   2. Thiếu RPC reconciliation để CEO daily check drift giữa 3 bảng
--      (products.stock / branch_stock / stock_movements).
--
-- Migration này:
--   1. Patch fnb_void_invoice_atomic — revert lot allocations đúng cách
--   2. Thêm RPC verify_stock_invariants — check 3 invariant + return
--      list product nào drift, dùng cho dashboard + cron daily alert
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Patch fnb_void_invoice_atomic — revert lot
-- ────────────────────────────────────────────────────────────────
-- Logic mới:
--   Sau khi cộng lại branch_stock + products.stock cho item:
--     - Query lot_allocations theo (reference_type='invoice', reference_id=invoice_id, product_id)
--     - Với mỗi allocation: UPDATE product_lots.current_qty += allocated.quantity
--       + status='active' (nếu trước đó 'consumed')
--     - Soft delete lot_allocation: thêm cột `reverted_at` (hoặc ghi
--       allocation âm để audit trace dễ)
-- ────────────────────────────────────────────────────────────────

-- Thêm cột reverted_at vào lot_allocations để mark allocation đã đảo
alter table public.lot_allocations
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_reason text;

create index if not exists idx_lot_allocations_active
  on public.lot_allocations(source_type, source_id)
  where reverted_at is null;

create or replace function public.fnb_void_invoice_atomic(
  p_invoice_id uuid,
  p_kitchen_order_id uuid,
  p_void_reason text,
  p_voided_by uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice record;
  v_item record;
  v_alloc record;
  v_cash_code text;
  v_lots_reverted int := 0;
begin
  -- Lock invoice row trước
  select id, code, status, paid, shift_id into v_invoice
  from public.invoices
  where tenant_id = p_tenant_id
    and id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'Invoice % was already voided', v_invoice.code;
  end if;

  -- Flip status
  update public.invoices
  set status = 'cancelled',
      void_reason = p_void_reason,
      voided_at = now(),
      voided_by = p_voided_by
  where tenant_id = p_tenant_id
    and id = p_invoice_id;

  -- Loop items: revert stock + lot
  for v_item in
    select product_id, product_name, quantity
    from public.invoice_items
    where invoice_id = p_invoice_id
      and product_id is not null
  loop
    -- 1. Audit log reverse
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_item.product_id, 'in', v_item.quantity,
      'invoice_void', p_invoice_id,
      'Hoàn trả - hủy HĐ ' || v_invoice.code || ': ' || coalesce(p_void_reason, ''),
      p_voided_by
    );

    -- 2. Revert products.stock + branch_stock
    perform public.increment_product_stock(v_item.product_id, v_item.quantity);
    perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_item.product_id, v_item.quantity);

    -- 3. FIX 00073: Revert product_lots — đảo từng allocation đã ghi
    --    cho item này (reference invoice + product). Tránh drift giữa
    --    SUM(product_lots) và branch_stock.
    for v_alloc in
      select la.id, la.lot_id, la.quantity
      from public.lot_allocations la
      join public.product_lots pl on pl.id = la.lot_id
      where la.source_type = 'invoice'
        and la.source_id = p_invoice_id
        and la.reverted_at is null  -- chỉ revert allocation chưa từng đảo
        and pl.product_id = v_item.product_id
        and pl.tenant_id = p_tenant_id
      for update of la, pl  -- lock cả 2 row tránh race với allocate_lots_fifo
    loop
      -- Cộng lại current_qty + reactivate nếu trước đó consumed
      update public.product_lots
      set current_qty = current_qty + v_alloc.quantity,
          status = case
            when status = 'consumed' and current_qty + v_alloc.quantity > 0
              then 'active'
            else status
          end,
          updated_at = now()
      where id = v_alloc.lot_id;

      -- Mark allocation đã đảo (giữ row để audit)
      update public.lot_allocations
      set reverted_at = now(),
          reverted_reason = 'void_invoice:' || v_invoice.code
      where id = v_alloc.id;

      v_lots_reverted := v_lots_reverted + 1;
    end loop;
  end loop;

  -- Refund cash transaction nếu đã thanh toán
  if coalesce(v_invoice.paid, 0) > 0 then
    v_cash_code := public.next_code(p_tenant_id, 'cash_payment');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PC' || extract(epoch from now())::bigint::text;
    end if;

    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, payment_method, reference_type, reference_id,
      note, created_by, shift_id
    ) values (
      p_tenant_id, p_branch_id, v_cash_code, 'payment', 'Hoàn trả', v_invoice.paid,
      'Khách hàng', 'cash', 'invoice', p_invoice_id,
      'Hoàn tiền HĐ ' || v_invoice.code || ': ' || coalesce(p_void_reason, ''),
      p_voided_by, coalesce(p_shift_id, v_invoice.shift_id)
    );
  end if;

  -- Cancel kitchen order
  update public.kitchen_orders
  set status = 'cancelled', updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_kitchen_order_id;

  return jsonb_build_object(
    'success', true,
    'lots_reverted', v_lots_reverted
  );
end;
$$;

comment on function public.fnb_void_invoice_atomic is
  'Atomic F&B invoice void: cancel invoice, reverse stock + lot allocations, create refund cash transaction, cancel kitchen order. CEO 13/05/2026: thêm revert product_lots + mark lot_allocations.reverted_at chống drift.';

-- ────────────────────────────────────────────────────────────────
-- 2. RPC verify_stock_invariants — daily reconciliation check
-- ────────────────────────────────────────────────────────────────
-- 3 INVARIANT:
--   #1: products.stock = SUM(branch_stock.quantity)
--   #2: branch_stock.quantity = SUM(stock_movements.in - stock_movements.out)
--   #3: SUM(product_lots.current_qty) ≈ branch_stock.quantity (chỉ check
--       SP có lot tracking active)
--
-- Return: jsonb với 3 array violations + total_drift_amount
-- ────────────────────────────────────────────────────────────────
create or replace function public.verify_stock_invariants(
  p_tenant_id uuid default null,
  p_tolerance numeric default 0.01    -- sai lệch < 0.01 → ignore (rounding noise)
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_inv1 jsonb := '[]'::jsonb;
  v_inv2 jsonb := '[]'::jsonb;
  v_inv3 jsonb := '[]'::jsonb;
  v_inv1_count int := 0;
  v_inv2_count int := 0;
  v_inv3_count int := 0;
  r record;
begin
  -- Resolve tenant: ưu tiên param, fallback auth user
  if p_tenant_id is null then
    select tenant_id into v_tenant_id from public.profiles where id = auth.uid();
    if v_tenant_id is null then
      raise exception 'TENANT_REQUIRED: pass p_tenant_id hoặc đăng nhập';
    end if;
  else
    v_tenant_id := p_tenant_id;
    -- Security: chỉ owner mới được check tenant khác (defense-in-depth)
    if v_tenant_id <> (select tenant_id from public.profiles where id = auth.uid())
       and (select role from public.profiles where id = auth.uid()) <> 'owner' then
      raise exception 'PERMISSION_DENIED: chỉ owner mới được verify cross-tenant';
    end if;
  end if;

  -- ─── INVARIANT #1: products.stock = SUM(branch_stock) ───
  for r in
    select p.id, p.code, p.name, p.stock as product_stock,
           coalesce(bs.branch_total, 0) as branch_sum,
           p.stock - coalesce(bs.branch_total, 0) as drift
    from public.products p
    left join (
      select product_id, sum(quantity) as branch_total
      from public.branch_stock
      where tenant_id = v_tenant_id
      group by product_id
    ) bs on bs.product_id = p.id
    where p.tenant_id = v_tenant_id
      and abs(coalesce(p.stock, 0) - coalesce(bs.branch_total, 0)) > p_tolerance
    order by abs(p.stock - coalesce(bs.branch_total, 0)) desc
    limit 100
  loop
    v_inv1 := v_inv1 || jsonb_build_object(
      'product_id', r.id,
      'code', r.code,
      'name', r.name,
      'product_stock', r.product_stock,
      'branch_stock_sum', r.branch_sum,
      'drift', r.drift
    );
    v_inv1_count := v_inv1_count + 1;
  end loop;

  -- ─── INVARIANT #2: branch_stock = SUM(stock_movements: in - out) ───
  for r in
    select bs.branch_id, bs.product_id, bs.quantity as branch_qty,
           coalesce(sm.movement_net, 0) as movement_sum,
           p.code, p.name, b.name as branch_name,
           bs.quantity - coalesce(sm.movement_net, 0) as drift
    from public.branch_stock bs
    join public.products p on p.id = bs.product_id
    join public.branches b on b.id = bs.branch_id
    left join (
      select branch_id, product_id,
             sum(case when type = 'in' then quantity else -quantity end) as movement_net
      from public.stock_movements
      where tenant_id = v_tenant_id
      group by branch_id, product_id
    ) sm on sm.branch_id = bs.branch_id and sm.product_id = bs.product_id
    where bs.tenant_id = v_tenant_id
      and abs(coalesce(bs.quantity, 0) - coalesce(sm.movement_net, 0)) > p_tolerance
    order by abs(bs.quantity - coalesce(sm.movement_net, 0)) desc
    limit 100
  loop
    v_inv2 := v_inv2 || jsonb_build_object(
      'branch_id', r.branch_id,
      'branch_name', r.branch_name,
      'product_id', r.product_id,
      'product_code', r.code,
      'product_name', r.name,
      'branch_stock_qty', r.branch_qty,
      'stock_movements_net', r.movement_sum,
      'drift', r.drift
    );
    v_inv2_count := v_inv2_count + 1;
  end loop;

  -- ─── INVARIANT #3: SUM(product_lots) ≈ branch_stock (chỉ với SP có lot) ───
  for r in
    select bs.branch_id, bs.product_id, bs.quantity as branch_qty,
           coalesce(lt.lot_total, 0) as lot_sum,
           p.code, p.name, b.name as branch_name,
           bs.quantity - coalesce(lt.lot_total, 0) as drift
    from public.branch_stock bs
    join public.products p on p.id = bs.product_id
    join public.branches b on b.id = bs.branch_id
    inner join (
      -- chỉ SP có ít nhất 1 lot active → enforce invariant
      select branch_id, product_id, sum(current_qty) as lot_total
      from public.product_lots
      where tenant_id = v_tenant_id
        and status = 'active'
      group by branch_id, product_id
    ) lt on lt.branch_id = bs.branch_id and lt.product_id = bs.product_id
    where bs.tenant_id = v_tenant_id
      and abs(coalesce(bs.quantity, 0) - coalesce(lt.lot_total, 0)) > p_tolerance
    order by abs(bs.quantity - coalesce(lt.lot_total, 0)) desc
    limit 100
  loop
    v_inv3 := v_inv3 || jsonb_build_object(
      'branch_id', r.branch_id,
      'branch_name', r.branch_name,
      'product_id', r.product_id,
      'product_code', r.code,
      'product_name', r.name,
      'branch_stock_qty', r.branch_qty,
      'product_lots_sum', r.lot_sum,
      'drift', r.drift
    );
    v_inv3_count := v_inv3_count + 1;
  end loop;

  return jsonb_build_object(
    'verified_at', now(),
    'tenant_id', v_tenant_id,
    'tolerance', p_tolerance,
    'all_ok', (v_inv1_count + v_inv2_count + v_inv3_count) = 0,
    'invariant_1', jsonb_build_object(
      'description', 'products.stock = SUM(branch_stock.quantity)',
      'violations_count', v_inv1_count,
      'violations', v_inv1
    ),
    'invariant_2', jsonb_build_object(
      'description', 'branch_stock.quantity = SUM(stock_movements: in - out)',
      'violations_count', v_inv2_count,
      'violations', v_inv2
    ),
    'invariant_3', jsonb_build_object(
      'description', 'SUM(product_lots.current_qty active) ≈ branch_stock.quantity',
      'violations_count', v_inv3_count,
      'violations', v_inv3
    )
  );
end;
$$;

comment on function public.verify_stock_invariants is
  'Daily reconciliation check 3 invariant kho: products.stock = SUM(branch_stock), branch_stock = SUM(stock_movements), branch_stock ≈ SUM(product_lots). Return violations list + drift amount. CEO 13/05/2026.';

grant execute on function public.verify_stock_invariants(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
