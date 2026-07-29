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
-- ⚠️ SỬA LẠI SAU LẦN CHẠY ĐẦU THẤT BẠI
-- Bản đầu đoán "2 chỗ loại trừ nằm trong CÙNG một hàm (kỳ này + kỳ trước)"
-- nên guard đòi đúng 2 và dừng lại khi chỉ thấy 1. Guard đã làm đúng việc.
-- Thực tế 2 chỗ đó thuộc HAI HÀM KHÁC NHAU, mỗi hàm một chỗ:
--     get_profit_and_loss_report          → lãi/lỗ toàn công ty
--     get_branch_profit_and_loss_report   → lãi/lỗ từng chi nhánh
-- Cả hai đều thiếu, nên vá cả hai.
--
-- KHÔNG đụng một dòng dữ liệu nào — chỉ sửa cách báo cáo đọc.
-- ============================================================

do $$
declare
  v_ten   text;
  v_def   text;
  v_moi   text;
  v_dem   int;
  v_tong  int := 0;
begin
  foreach v_ten in array array[
    'get_profit_and_loss_report',
    'get_branch_profit_and_loss_report'
  ]
  loop
    select pg_get_functiondef(oid) into v_def
      from pg_proc
     where proname = v_ten
     limit 1;

    if v_def is null then
      raise exception 'Không tìm thấy hàm %', v_ten;
    end if;

    -- Đã vá rồi thì bỏ qua (chạy lại được)
    if v_def like '%Trả nhà cung cấp%' then
      raise notice '% — đã có sẵn, bỏ qua', v_ten;
      continue;
    end if;

    -- Mỗi hàm phải có ĐÚNG 1 chỗ loại trừ
    v_dem := (length(v_def) - length(replace(v_def, '''Trả hàng''', '')))
             / length('''Trả hàng''');
    if v_dem <> 1 then
      raise exception '% : mong 1 chỗ loại trừ, tìm thấy % — dừng để không vá nhầm',
        v_ten, v_dem;
    end if;

    v_moi := replace(
      v_def,
      '''Trả hàng''',
      '''Trả hàng'',' || chr(10) ||
      '          ''Trả nhà cung cấp'',' || chr(10) ||
      '          ''supplier_payment'''
    );

    execute v_moi;
    v_tong := v_tong + 1;
    raise notice 'Đã vá %', v_ten;
  end loop;

  raise notice 'Tổng cộng vá % hàm', v_tong;
end $$;

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi áp
-- ============================================================
-- 1) Cả HAI hàm phải nhận 2 loại mới (4 cột đều true):
-- select proname,
--        pg_get_functiondef(oid) like '%Trả nhà cung cấp%' as co_tra_ncc,
--        pg_get_functiondef(oid) like '%supplier_payment%' as co_supplier_payment
--   from pg_proc
--  where proname in ('get_profit_and_loss_report',
--                    'get_branch_profit_and_loss_report');
--
-- 2) Xem lại lợi nhuận tháng 7 — phải chuyển từ ÂM sang DƯƠNG:
--    mở Báo cáo → Tổng quan kinh doanh, chọn "Tháng này".
--
-- 3) Rà xem còn loại chi nào là "trả tiền mua hàng" mà chưa loại:
-- select category, count(*) as so_phieu,
--        to_char(sum(amount), 'FM999,999,999,999') as tong
--   from public.cash_transactions
--  where type = 'payment' and coalesce(status,'') <> 'cancelled'
--  group by category order by sum(amount) desc;
