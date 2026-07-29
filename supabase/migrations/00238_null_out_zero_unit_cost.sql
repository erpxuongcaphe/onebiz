-- ============================================================
-- 00238 — dọn nốt số 0 mà 00237 bỏ sót (lỗi của bản 00237)
-- ============================================================
-- 00237 đặt ra nguyên tắc: KHÔNG bao giờ ghi giá vốn = 0, vì 0 nghĩa là
-- "bán không tốn đồng nào" còn ô trống mới nghĩa là "chưa biết" — báo cáo
-- xử lý hai thứ đó khác hẳn nhau (00198 dùng coalesce, gặp 0 là lấy luôn).
--
-- Nhưng vòng lặp lấp của 00237 có sơ hở: dòng nào KHÔNG lấp được thì
-- `continue` mà không đụng tới giá trị cũ. Dòng vốn đang là 0 nên giữ
-- nguyên số 0 — đúng cái thứ 00237 sinh ra để diệt.
--
-- Nghiệm thu sau khi chạy 00237 đo được: còn 4 dòng mang số 0.
-- Cả 4 đều là Bò húc / Sting Chai / Coca chai — nhóm bị chặn vì giá vốn
-- tính ra cao hơn 3 lần giá bán (xem ghi chú cuối file).
--
-- CHỈ đổi 0 → trống. Không tính toán, không đụng cột nào khác.
-- Bảng sao lưu invoice_items_cost_backup_00237 đã có sẵn 4 dòng này.
-- ============================================================

do $$
declare
  v_truoc int;
  v_sau   int;
  v_ds    text;
begin
  select count(*) into v_truoc from public.invoice_items where unit_cost = 0;

  select string_agg(distinct coalesce(p.code, '(đã xoá)'), ', ')
    into v_ds
    from public.invoice_items ii
    left join public.products p on p.id = ii.product_id
   where ii.unit_cost = 0;

  update public.invoice_items set unit_cost = null where unit_cost = 0;

  select count(*) into v_sau from public.invoice_items where unit_cost = 0;

  raise notice '00238: đổi % dòng giá vốn 0 → để trống. Mã hàng: %', v_truoc, coalesce(v_ds, '(không có)');

  if v_sau <> 0 then
    raise exception '00238 FAIL: vẫn còn % dòng mang số 0', v_sau;
  end if;
  raise notice '00238 OK: không còn dòng bán nào mang giá vốn = 0.';
end $$;

-- ============================================================
-- ĐỐI CHIẾU
-- ============================================================
-- select count(*) filter (where unit_cost is null) as de_trong,
--        count(*) filter (where unit_cost = 0)     as con_so_0,
--        count(*) filter (where unit_cost > 0)     as co_gia
--   from public.invoice_items;
--
-- ============================================================
-- GHI CHÚ — 8 dòng để trống này KHÔNG phải lỗi công thức
-- ============================================================
-- Kiểm lại thì công thức của 3 mã này ĐÚNG:
--   SKU-KHO-008 (ĐVT Thùng, bán 305.000) = 24 Lon × 12.208đ = 293.000  ✔
--   SKU-KHO-006 (ĐVT Thùng, bán 200.000) = 24 Chai × 7.667đ = 184.000  ✔
--   SKU-KHO-007 (ĐVT Thùng, bán 135.000) = 24 Chai × 5.083đ = 122.000  ✔
--
-- Sai là ở PHIẾU BÁN: nhân viên chọn mã THÙNG nhưng nhập số lượng và đơn
-- giá theo LON/CHAI — ví dụ HD001218 ghi "24 × 12.500" (ý là 24 lon)
-- thay vì "1 thùng × 305.000". Hoá đơn HD001312 có cả hai kiểu nhập nằm
-- cạnh nhau, thấy rõ:
--   dòng sai : SKU-KHO-007  24 × 5.625   = 135.000
--   dòng đúng: SKU-KHO-008   1 × 305.000 = 305.000
--
-- ⚠️ HỆ QUẢ ĐÃ XẢY RA VỚI KHO — cần CEO xác nhận ngoài đời:
-- HD001312 (24/06) trừ 576 Chai NVL-KHO-007 cho một đơn 135.000đ
-- (24 thùng × 24 chai). Nếu khách chỉ mua 24 chai thì kho đã bị trừ
-- thừa 552 chai. Không tự sửa — chờ CEO đếm thực tế.
--
-- Để giá vốn của 8 dòng này là TRỐNG là đúng: ghi 293.000đ cho một lon
-- bán 12.500đ sẽ làm lãi/lỗ sai nặng hơn cả để trống.
