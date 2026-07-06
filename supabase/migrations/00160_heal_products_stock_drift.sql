-- ============================================================
-- 00160 — Heal drift products.stock = SUM(branch_stock) (diện rộng, CÓ ĐIỀU KIỆN)
-- ============================================================
-- CEO 06/07/2026: sau vụ Yaourt, rà TOÀN BỘ 560 SP của tenant:
--   - 478 SP khớp cả 3 sổ (products.stock = Σbranch_stock = ledger) — sạch.
--   - 81 SP drift: products.stock CAO KHỐNG so với Σbranch_stock, nhưng
--     Σbranch_stock = ledger (thẻ kho) → 2 nguồn sự thật đồng thuận.
--     Bệnh cũ: các đường trừ kho trước 00135 chỉ trừ branch_stock mà không trừ
--     products.stock (thiếu increment_product_stock). Drift lớn nhất: cà phê
--     hạt NVL-CPH-001 (+78.600g), NVL-CPH-002 (+73.460g).
--   - 1 SP sữa đặc NVL-SUA-002: ledger lệch branch 0.01 (làm tròn) — vẫn heal
--     vì trong ngưỡng 0.02.
--
-- BÀI HỌC 00135 (không lặp lại): KHÔNG reconcile 1 chiều mù quáng. Migration
-- này CHỈ heal SP thỏa TẤT CẢ điều kiện (tự kiểm trong SQL, không hardcode
-- danh sách — idempotent, chạy lại an toàn, tự bắt drift mới phát sinh):
--   1. Có ≥1 dòng branch_stock VÀ ≥1 stock_movement (loại trừ SP data mồ côi).
--   2. KHÔNG có dòng branch_stock theo variant (tránh nhập nhằng cách đếm).
--   3. |ledger − Σbranch_stock| ≤ 0.02 (2 nguồn sự thật đồng thuận, chừa
--      làm tròn) — lệch hơn = mixed state → BỎ QUA, liệt kê ở NOTICE.
--   4. |products.stock − Σbranch_stock| > 0.005 (thực sự có drift).
-- → set products.stock = Σbranch_stock. KHÔNG ghi stock_movements (đây là
-- đồng bộ số tổng phi-vật-lý, thẻ kho không đổi — giống 00158 ③).
-- ============================================================

do $$
declare
  v_tenant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  r record;
  v_healed int := 0;
  v_skipped int := 0;
begin
  for r in
    select
      p.id, p.code, p.name, p.stock as products_stock,
      coalesce(bs.branch_sum, 0)  as branch_sum,
      coalesce(bs.row_count, 0)   as bs_rows,
      coalesce(bs.variant_rows, 0) as variant_rows,
      coalesce(mv.ledger_net, 0)  as ledger_net,
      coalesce(mv.mv_count, 0)    as mv_rows
    from public.products p
    left join lateral (
      select sum(b.quantity) as branch_sum,
             count(*) as row_count,
             count(*) filter (where b.variant_id is not null) as variant_rows
      from public.branch_stock b
      where b.product_id = p.id
    ) bs on true
    left join lateral (
      -- Review 06/07: 'adjust'/'transfer' KHÔNG có hướng (00056: adjust ghi sổ
      -- nhưng delta tồn = 0) → tính 0, KHÔNG cộng dương như bản đầu.
      select sum(case when m.type = 'in' then m.quantity
                      when m.type = 'out' then -m.quantity
                      else 0 end) as ledger_net,
             count(*) as mv_count
      from public.stock_movements m
      where m.tenant_id = v_tenant  -- ăn index (tenant_id, product_id), khỏi seq-scan
        and m.product_id = p.id
    ) mv on true
    where p.tenant_id = v_tenant
      and coalesce(bs.row_count, 0) > 0
      and coalesce(mv.mv_count, 0) > 0
      and abs(coalesce(p.stock, 0) - coalesce(bs.branch_sum, 0)) > 0.005
  loop
    if r.variant_rows > 0 then
      v_skipped := v_skipped + 1;
      raise notice '00160 SKIP % (%): có variant rows — xử riêng', r.code, r.name;
      continue;
    end if;
    if abs(r.ledger_net - r.branch_sum) > 0.02 then
      v_skipped := v_skipped + 1;
      raise notice '00160 SKIP % (%): ledger(%) ≠ branch(%) — mixed state, xử riêng',
        r.code, r.name, r.ledger_net, r.branch_sum;
      continue;
    end if;

    -- Review 06/07 — CHỐNG RACE với POS đang bán: KHÔNG ghi giá trị chụp từ
    -- snapshot cursor (có thể cũ vài chục giây); tính lại Σbranch_stock NGAY
    -- trong câu UPDATE (READ COMMITTED: mỗi statement thấy snapshot mới, và
    -- row-lock làm increment_product_stock đến sau chờ rồi cộng delta lên số
    -- đã heal). Vẫn nên chạy ngoài giờ bán cho chắc.
    update public.products p2
      set stock = (
            select coalesce(sum(b.quantity), 0)
            from public.branch_stock b
            where b.product_id = p2.id
          ),
          updated_at = now()
      where p2.id = r.id;
    v_healed := v_healed + 1;
    raise notice '00160 HEAL %: products.stock % → ~% (drift snapshot %)',
      r.code, r.products_stock, r.branch_sum, round((r.products_stock - r.branch_sum)::numeric, 4);
  end loop;

  raise notice '00160 XONG: healed=%, skipped(mixed/variant)=%', v_healed, v_skipped;
end $$;

-- ============================================================
-- VERIFY sau khi áp — kỳ vọng: chỉ còn đúng các SP bị SKIP (đọc NOTICE:
-- variant/mixed-state) hoặc SP không có movement; với scan hiện tại (81+1
-- đều đủ điều kiện, 0 skip) thì kỳ vọng 0 dòng:
--   select p.code, p.name, p.stock,
--          (select coalesce(sum(b.quantity),0) from public.branch_stock b
--            where b.product_id = p.id) as branch_sum
--   from public.products p
--   where p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
--     and exists (select 1 from public.branch_stock b where b.product_id = p.id)
--     and abs(coalesce(p.stock,0) - (select coalesce(sum(b.quantity),0)
--           from public.branch_stock b where b.product_id = p.id)) > 0.005;
--
-- LƯU Ý: heal đồng bộ SỔ SÁCH, không sửa hiện trạng vật lý. SP nào sau heal
-- ra tồn ÂM (vd NVL-CPH-001 = -1950g) tức là đã bán/dùng vượt ghi nhận —
-- xử bằng PHIẾU KIỂM KHO đếm thực tế, không sửa tay số.
-- ============================================================
