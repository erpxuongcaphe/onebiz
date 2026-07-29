-- ============================================================
-- 00235 — GẤP: tiền trả nhà cung cấp bị tính thành CHI PHÍ → lãi thành lỗ
-- ============================================================
-- CEO hỏi 29/07: "lợi nhuận không có liên quan đến nhập hàng, lợi nhuận là
-- doanh thu − chi phí mà?" — CEO ĐÚNG.
--
-- Nhập hàng KHÔNG phải chi phí. Bỏ tiền mua hàng về kho là ĐỔI TIỀN LẤY
-- HÀNG: tiền giảm, hàng tăng, tài sản không đổi. Chỉ khi BÁN số hàng đó ra
-- thì giá vốn của đúng phần đã bán mới thành chi phí (nguyên tắc phù hợp).
-- Giá vốn đã được tính riêng ở phần COGS.
--
-- LỖI
-- Danh sách loại khỏi chi phí vận hành có 'Nhập hàng', 'Mua hàng nội bộ',
-- 'Hoàn tiền hủy đơn', 'Hoàn tiền', 'Trả hàng' — nhưng THIẾU hai loại thực
-- tế đang dùng để trả tiền nhà cung cấp:
--     'Trả nhà cung cấp'   (đường trả nợ NCC + backfill 00232)
--     'supplier_payment'   (mã tiếng Anh còn sót từ đường cũ)
--
-- ĐO TRÊN DỮ LIỆU THẬT (tháng 7, Kho Tổng):
--     Trả nhà cung cấp   125.313.290đ   ← phần lớn do 00232 hôm nay
--     supplier_payment    53.094.428đ   ← lỗi CŨ, có từ trước
--     ─────────────────────────────
--     tính nhầm          178.407.718đ
--
-- Màn hình đang báo lợi nhuận −82.843.452đ. Cộng lại đúng:
--     −82.843.452 + 178.407.718 = +95.564.266đ  → thực ra LÃI.
--
-- ⚠️ 00232 (hôm nay) làm lỗi này lộ ra rõ, nhưng KHÔNG phải nguyên nhân gốc:
-- 'supplier_payment' 53 triệu đã bị tính sai từ trước. 00232 chỉ ghi vào sổ
-- quỹ những khoản tiền vốn đã chi thật — việc ghi đó là đúng, cái sai là
-- báo cáo xếp nhầm chúng vào chi phí vận hành.
--
-- SỬA: thêm 2 loại vào danh sách loại trừ, ở CẢ HAI chỗ trong RPC (kỳ hiện
-- tại và kỳ trước) để so sánh hai kỳ không bị lệch chuẩn.
-- KHÔNG đụng một dòng dữ liệu nào — chỉ sửa cách báo cáo đọc.
-- ============================================================

do $$
declare
  v_def text;
  v_moi text;
  v_dem int;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc
   where proname = 'get_profit_and_loss_report'
   limit 1;

  if v_def is null then
    raise exception 'Không tìm thấy hàm get_profit_and_loss_report';
  end if;

  -- Đếm số chỗ cần vá (phải là 2: kỳ này + kỳ trước)
  v_dem := (length(v_def) - length(replace(v_def, '''Trả hàng''', ''))) / length('''Trả hàng''');
  if v_dem <> 2 then
    raise exception 'Mong 2 chỗ loại trừ, tìm thấy % — dừng để không vá nhầm', v_dem;
  end if;

  -- Chèn 2 loại mới ngay trước 'Trả hàng' trong cả hai mảng
  v_moi := replace(
    v_def,
    '''Trả hàng''',
    '''Trả hàng'',' || chr(10) ||
    '          ''Trả nhà cung cấp'',' || chr(10) ||
    '          ''supplier_payment'''
  );

  execute v_moi;
  raise notice 'Đã vá % chỗ trong get_profit_and_loss_report', v_dem;
end $$;

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi áp
-- ============================================================
-- 1) Hàm đã nhận 2 loại mới (cả 2 phải true):
-- select
--   pg_get_functiondef(oid) like '%Trả nhà cung cấp%' as co_tra_ncc,
--   pg_get_functiondef(oid) like '%supplier_payment%' as co_supplier_payment
-- from pg_proc where proname = 'get_profit_and_loss_report';
--
-- 2) Xem lại lợi nhuận tháng 7 — phải chuyển từ ÂM sang DƯƠNG:
--    mở Báo cáo → Tổng quan kinh doanh, chọn "Tháng này".
--
-- 3) Rà xem còn loại chi nào là "trả tiền mua hàng" mà chưa loại:
-- select category, count(*), sum(amount)
--   from public.cash_transactions
--  where type = 'payment' and coalesce(status,'') <> 'cancelled'
--  group by category order by sum(amount) desc;
