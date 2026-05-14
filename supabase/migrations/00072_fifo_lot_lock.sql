-- ============================================================
-- 00072: Lock FIFO lot allocation để chống race condition (CEO 13/05/2026)
--
-- Vấn đề phát hiện audit:
--   allocate_lots_fifo có pattern READ-THEN-WRITE trên product_lots:
--     1. SELECT id, current_qty FROM product_lots WHERE current_qty > 0
--     2. v_take := least(r.current_qty, v_remaining);
--     3. UPDATE product_lots SET current_qty = current_qty - v_take
--   → 2 transaction cùng lúc bán cùng SP có thể read snapshot stale →
--     underflow lot quantity.
--
-- Fix: thêm `FOR UPDATE SKIP LOCKED` vào SELECT. Mỗi transaction lock row
-- lúc đọc, transaction khác tự skip sang lot kế tiếp → không double-allocate.
--
-- Lưu ý:
--   - SKIP LOCKED phù hợp POS concurrent (không chờ, đi tiếp).
--   - Nếu hết lot active → trả empty allocation (giống behavior cũ).
--   - branch_stock / products.stock updates là atomic single-row UPDATE
--     (không phải read-then-write) → KHÔNG cần FOR UPDATE.
--   - Migration 00065 retrofit search_path → fn này đã có set search_path
--     từ trước (00007 nguyên thuỷ chưa, 00065 đã ALTER).
-- ============================================================

create or replace function public.allocate_lots_fifo(
  p_tenant_id uuid,
  p_product_id uuid,
  p_branch_id uuid,
  p_quantity numeric,
  p_source_type text,
  p_source_id uuid,
  p_allocated_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_remaining numeric := p_quantity;
  v_allocated jsonb := '[]'::jsonb;
  r record;
  v_take numeric;
begin
  -- FIFO: sort by expiry_date ASC (sớm nhất trước), then received_date ASC.
  -- THÊM `for update skip locked` (CEO 13/05): chống race khi 2 đơn FnB
  -- cùng lúc allocate cùng SP. Transaction sau tự bỏ qua lot đã lock,
  -- nhảy sang lot kế tiếp.
  for r in
    select id, lot_number, current_qty, expiry_date, manufactured_date
    from public.product_lots
    where tenant_id = p_tenant_id
      and product_id = p_product_id
      and branch_id = p_branch_id
      and status = 'active'
      and current_qty > 0
    order by
      expiry_date asc nulls last,
      received_date asc,
      created_at asc
    for update skip locked
  loop
    exit when v_remaining <= 0;

    v_take := least(r.current_qty, v_remaining);

    -- Trừ current_qty
    update public.product_lots
    set current_qty = current_qty - v_take,
        status = case when current_qty - v_take <= 0 then 'consumed' else status end,
        updated_at = now()
    where id = r.id;

    -- Ghi lot_allocation
    insert into public.lot_allocations (
      tenant_id, lot_id, source_type, source_id, quantity, allocated_by
    ) values (
      p_tenant_id, r.id, p_source_type, p_source_id, v_take, p_allocated_by
    );

    v_remaining := v_remaining - v_take;

    v_allocated := v_allocated || jsonb_build_object(
      'lot_id', r.id,
      'lot_number', r.lot_number,
      'quantity', v_take,
      'expiry_date', r.expiry_date,
      'manufactured_date', r.manufactured_date
    );
  end loop;

  return jsonb_build_object(
    'allocated', v_allocated,
    'remaining', v_remaining,
    'total_requested', p_quantity
  );
end;
$$;

comment on function public.allocate_lots_fifo is
  'FIFO lot allocation cho stock-out. CEO 13/05: thêm FOR UPDATE SKIP LOCKED chống race khi 2 transaction cùng lúc allocate cùng SP/lot.';

notify pgrst, 'reload schema';
