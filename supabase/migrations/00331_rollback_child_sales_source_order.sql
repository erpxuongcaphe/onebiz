-- ============================================================================
-- ROLLBACK 00331 — gỡ RPC tạo đơn con + cột source_order_id
--
-- Chỉ chạy khi 00331 gây trục trặc thật và cần lui gấp.
-- AN TOÀN DỮ LIỆU: nếu ĐÃ CÓ đơn con (source_order_id khác null) thì KHÔNG
-- xóa cột — xóa là mất dấu vết đơn con thuộc đơn gốc nào. Khi đó chỉ gỡ RPC
-- (chặn tạo thêm), giữ nguyên dữ liệu, và migration sửa lỗi sẽ xử lý tiếp.
-- ============================================================================

drop function if exists public.create_child_sale_from_order(uuid);

do $$
declare
  v_dang_dung int;
begin
  select count(*) into v_dang_dung
  from public.invoices
  where source_order_id is not null;

  if v_dang_dung > 0 then
    raise notice 'Rollback 00331: GIU cot source_order_id vi dang co % don con — chi go RPC.', v_dang_dung;
    return;
  end if;

  drop index if exists public.idx_invoices_source_order_id;
  alter table public.invoices drop column if exists source_order_id;
  raise notice 'Rollback 00331: da go RPC + chi muc + cot (chua co du lieu nao dung).';
end $$;
