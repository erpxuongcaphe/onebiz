-- ============================================================
-- 00232 — Dựng phiếu chi cho các khoản đã trả nhà cung cấp mà sổ quỹ bỏ sót
-- ============================================================
-- CEO quyết 29/07: "khoản nào chi không có phiếu thì em hãy xử lí phiếu cho nó đi"
--
-- BỐI CẢNH
-- Form phiếu nhập trước đây ghi thẳng số "đã trả" lên chính tờ phiếu mà KHÔNG
-- ghi dòng chi nào vào sổ quỹ. Tiền thật đã ra khỏi két, nhưng sổ quỹ không
-- biết. Đo ngày 29/07: 104 phiếu, 305.327.291đ, rải đều tháng 6 (54) và
-- tháng 7 (50).
--
-- Đường ghi mới (ensurePurchasePaymentRecorded, đã live) đã chặn chảy tiếp —
-- file này chỉ dọn phần cũ.
--
-- ⚠️ SỐ LIỆU SẼ ĐỔI SAU KHI CHẠY
-- Phiếu chi ghi theo NGÀY CỦA PHIẾU NHẬP (không phải hôm nay), để báo cáo
-- dòng tiền rơi đúng tháng phát sinh. Nghĩa là tổng chi tháng 6 và tháng 7
-- sẽ TĂNG thêm ~305 triệu so với báo cáo anh đang thấy. Đó là con số đúng —
-- khoản tiền này vốn đã ra khỏi két từ lúc đó, chỉ là sổ quỹ chưa ghi.
--
-- KHÔNG ĐỤNG: tồn kho, công nợ NCC, số "đã trả" trên phiếu nhập. Chỉ THÊM
-- dòng vào cash_transactions.
--
-- CHẠY LẠI ĐƯỢC: mỗi lần chỉ bù đúng phần còn thiếu; lần hai không tạo thêm.
-- ============================================================

do $$
declare
  r record;
  v_code text;
  v_dem int := 0;
  v_tong numeric := 0;
begin
  for r in
    select
      po.id,
      po.tenant_id,
      po.code,
      po.branch_id,
      po.supplier_id,
      po.supplier_name,
      po.created_by,
      po.created_at,
      po.paid::numeric as da_tra,
      coalesce((
        select sum(ct.amount)
        from public.cash_transactions ct
        where ct.tenant_id = po.tenant_id
          and ct.reference_type = 'purchase_order'
          and ct.reference_id = po.id
          and coalesce(ct.status, '') <> 'cancelled'
      ), 0)::numeric as da_ghi_so
    from public.purchase_orders po
    where po.paid > 0
      and coalesce(po.status, '') <> 'cancelled'
    order by po.created_at
  loop
    -- Chỉ bù đúng phần chênh. Phiếu nào sổ quỹ đã ghi đủ thì bỏ qua.
    continue when round(r.da_tra - r.da_ghi_so, 0) <= 0;

    v_code := public.next_cash_code(r.tenant_id, 'payment');

    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, supplier_id, payment_method,
      reference_type, reference_id, note,
      created_by, transaction_date, status
    ) values (
      r.tenant_id,
      r.branch_id,
      v_code,
      'payment',
      'Trả nhà cung cấp',
      round(r.da_tra - r.da_ghi_so, 0),
      r.supplier_name,
      r.supplier_id,
      'cash',                       -- không lưu lại hình thức trả của phiếu cũ
      'purchase_order',
      r.id,
      'Bù sổ quỹ — tiền đã trả khi nhập hàng phiếu ' || r.code
        || ' nhưng chưa có phiếu chi (00232)',
      r.created_by,
      r.created_at::date,           -- ĐÚNG ngày phát sinh, không phải hôm nay
      'completed'
    );

    v_dem := v_dem + 1;
    v_tong := v_tong + round(r.da_tra - r.da_ghi_so, 0);
  end loop;

  raise notice 'Đã dựng % phiếu chi, tổng % đ', v_dem, to_char(v_tong, 'FM999,999,999,999');
end $$;

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi xong
-- ============================================================
-- 1) Phải ra 0 dòng: phiếu nhập đã trả tiền mà sổ quỹ còn thiếu
-- select po.code, po.paid, coalesce(sum(ct.amount), 0) as da_ghi
--   from public.purchase_orders po
--   left join public.cash_transactions ct
--     on ct.reference_type = 'purchase_order'
--    and ct.reference_id = po.id
--    and coalesce(ct.status,'') <> 'cancelled'
--  where po.paid > 0 and coalesce(po.status,'') <> 'cancelled'
--  group by po.id, po.code, po.paid
-- having po.paid - coalesce(sum(ct.amount), 0) > 0;
--
-- 2) Xem các phiếu vừa dựng, gộp theo tháng
-- select to_char(transaction_date, 'YYYY-MM') as thang,
--        count(*) as so_phieu,
--        to_char(sum(amount), 'FM999,999,999,999') as tong
--   from public.cash_transactions
--  where note like '%(00232)%'
--  group by 1 order by 1;
--
-- HOÀN TÁC (nếu cần):
-- delete from public.cash_transactions where note like '%(00232)%';
