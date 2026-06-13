-- ============================================================
-- 00142: allocate_lots_fifo — chặn bán lô đã hết HSD
-- (CEO BATCH 2.6 Tier 2 S-7, 13/06/2026)
--
-- VẤN ĐỀ PHÁP LÝ:
--   RPC allocate_lots_fifo (migration 00072) chỉ filter status='active'
--   AND current_qty > 0 → POP cả lot có expiry_date < today.
--   Bán SP hết hạn = vi phạm Luật ATTP Việt Nam (Đ.8 Luật ATTP 2010 +
--   Nghị định 15/2018). Có thể phạt 30-50tr + đình chỉ kinh doanh.
--
-- FIX:
--   Thêm filter `(expiry_date IS NULL OR expiry_date >= current_date)`
--   → FIFO skip lot hết hạn, alloc lot khác.
--   Lot hết hạn KHÔNG bị mất qty (giữ current_qty cho audit) nhưng
--   không được pop → cần job riêng flip status='expired' (sprint sau).
--
-- BACKWARD-COMPAT: SP không track expiry (expiry_date IS NULL) vẫn alloc
-- bình thường — chỉ chặn SP có expiry_date đã qua.
-- ============================================================

drop function if exists public.allocate_lots_fifo(uuid, uuid, uuid, numeric, text, uuid, uuid);

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
  v_today date := current_date;
begin
  -- FIFO: sort by expiry_date ASC (sớm nhất trước), then received_date ASC.
  -- S-7 13/06/2026: filter expiry_date >= today (chặn bán lô hết HSD).
  -- FOR UPDATE SKIP LOCKED chống race khi 2 đơn FnB cùng allocate cùng SP.
  for r in
    select id, lot_number, current_qty, expiry_date, manufactured_date
    from public.product_lots
    where tenant_id = p_tenant_id
      and product_id = p_product_id
      and branch_id = p_branch_id
      and status = 'active'
      and current_qty > 0
      and (expiry_date is null or expiry_date >= v_today)
    order by
      expiry_date asc nulls last,
      received_date asc,
      created_at asc
    for update skip locked
  loop
    exit when v_remaining <= 0;

    v_take := least(r.current_qty, v_remaining);

    update public.product_lots
    set current_qty = current_qty - v_take,
        status = case when current_qty - v_take <= 0 then 'consumed' else status end,
        updated_at = now()
    where id = r.id;

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

comment on function public.allocate_lots_fifo(uuid, uuid, uuid, numeric, text, uuid, uuid) is
  'FIFO lot allocation: oldest expiry first. S-7 fix (13/06/2026) chặn lot hết HSD '
  '(expiry_date < current_date) khỏi pop → tuân thủ Luật ATTP Việt Nam.';

grant execute on function public.allocate_lots_fifo(uuid, uuid, uuid, numeric, text, uuid, uuid) to authenticated;
