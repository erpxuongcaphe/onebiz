-- ============================================================
-- 00159 — RPC complete_production_atomic: gộp consume + complete NGUYÊN TỬ
-- ============================================================
-- CEO 06/07/2026: gốc rễ sự cố SX000011 — dialog hoàn thành lệnh SX gọi 2 RPC
-- RỜI NHAU (consume_production_materials rồi complete_production_order) trên 2
-- giao dịch độc lập. Nếu bước 2 lỗi, bước 1 (đã trừ NVL) KHÔNG rollback; bấm
-- lại → trừ NVL lần nữa (guard status cho phép 'planned' chạy lại). Đó là lý do
-- sữa bị trừ 3 lần ở SX000011.
--
-- FIX: 1 RPC bọc CẢ HAI bước trong CÙNG 1 giao dịch. Lỗi bất kỳ đâu → rollback
-- toàn bộ (kể cả phần đã trừ NVL). KHÔNG BAO GIỜ còn cảnh "trừ NVL mà không ra
-- thành phẩm". Thêm:
--   - SELECT ... FOR UPDATE khoá dòng lệnh → chống 2 lần bấm/2 tab chạy song song.
--   - Chặn hoàn thành lại (status='completed').
--   - Idempotency guard: nếu lệnh đã có movement trừ NVL tồn đọng (từ đường cũ
--     không nguyên tử) → CHẶN, buộc đối soát trước (tránh trừ kép). Với đường mới
--     atomic, consume lỗi đã tự rollback nên bình thường không có movement thừa.
--
-- KHÔNG đổi logic trừ/nhập kho của 2 hàm con — chỉ bọc giao dịch.
-- 2 hàm con giữ nguyên để migration đối soát (00152/00158-style) vẫn dùng được.
-- ============================================================

create or replace function public.complete_production_atomic(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_status text;
  v_out_count int;
  v_lot_id uuid;
begin
  -- Khoá dòng lệnh — chống 2 lần bấm / 2 phiên chạy song song cùng lệnh
  select status into v_status
    from public.production_orders
    where id = p_production_order_id
    for update;
  if not found then
    raise exception 'Lệnh sản xuất không tồn tại';
  end if;

  if v_status = 'completed' then
    raise exception 'Lệnh sản xuất đã hoàn thành rồi — không thể hoàn thành lại';
  end if;

  -- Idempotency/an toàn: chặn khi lệnh còn movement trừ NVL tồn đọng (đường cũ).
  -- Với atomic thì consume lỗi đã rollback nên count=0; nếu >0 = data cần đối soát.
  select count(*) into v_out_count
    from public.stock_movements
    where reference_id = p_production_order_id
      and reference_type = 'production_order'
      and type = 'out';
  if v_out_count > 0 then
    raise exception
      'Lệnh này đã có % dòng trừ NVL tồn đọng (từ lần hoàn thành lỗi trước). Cần đối soát kho trước khi hoàn thành để tránh trừ NVL trùng.',
      v_out_count;
  end if;

  -- 1 GIAO DỊCH: trừ NVL rồi nhập thành phẩm. Lỗi bất kỳ đâu → rollback CẢ HAI.
  perform public.consume_production_materials(p_production_order_id);
  v_lot_id := public.complete_production_order(
    p_production_order_id,
    p_completed_qty,
    p_lot_number,
    p_manufactured_date,
    p_expiry_date
  );

  return v_lot_id;
end;
$$;

grant execute on function public.complete_production_atomic(uuid, numeric, text, date, date) to authenticated;

comment on function public.complete_production_atomic is
  'CEO 06/07/2026: gộp consume_production_materials + complete_production_order trong 1 giao dịch (nguyên tử) + khoá dòng lệnh + chặn hoàn thành lại + chặn re-consume. Dialog hoàn thành lệnh SX dùng hàm này thay vì gọi 2 RPC rời.';

notify pgrst, 'reload schema';
