-- ============================================================
-- 00158 — Đối soát & HOÀN THÀNH lệnh SX000011 (Yaourt) + heal drift sữa chua
-- ============================================================
-- CEO 06/07/2026: sáng nay bấm "Hoàn thành" SX000011 (SX 7 chai Yaourt) bị lỗi,
-- bấm lại 3 lần. Do dialog chạy 2 bước RỜI (consume NVL → complete) KHÔNG nguyên
-- tử: bước consume THÀNH CÔNG cả 3 lần (trừ NVL dư), bước complete lỗi cả 3 →
-- lệnh vẫn 'planned', 0 lô, completed_qty=0; 7 chai Yaourt thực tế ĐÃ LÀM nhưng
-- không được nhập kho. Cùng ngày HD001360 bán 7 chai khi thành phẩm còn 2 →
-- tồn thành phẩm NVL-SST-019 = -5.
--
-- SỰ THẬT (đã đối soát read-only, kiểm chứng đối kháng):
--   - NVL bị trừ 3 lần thay vì 1 (mỗi lần: sữa chua 3, sữa đặc 1, sữa tươi 1).
--   - Sổ thành phẩm NVL-SST-019 khớp tuyệt đối ledger=products=branch=-5 (không
--     lỗi ghi sổ; -5 là bán vượt thật).
--   - products.stock sữa chua NVL-SST-015 DRIFT: 15.12 vs sự-thật (ledger=branch)
--     0.99 → lệch 14.13. (sữa đặc cũng drift NHƯNG ledger≠branch 0.01 = state
--     hỗn hợp → KHÔNG heal ở đây, xử riêng — theo bài học 00135.)
--
-- XỬ LÝ (atomic — lỗi giữa chừng tự rollback toàn bộ; idempotent theo status):
--   ① HOÀN NVL trừ dư: mỗi NVL giữ 1 vòng hợp lệ (cho mẻ SX thật), hoàn lại
--      (n-1)/n phần đã trừ = 2/3. Ghi movement 'in' production_reconcile (cả
--      branch_stock LẪN products.stock — giữ đồng bộ 2 sổ).
--   ② HOÀN THÀNH SX000011 đúng 1 lần qua complete_production_order → tạo lô,
--      nhập 7 chai Yaourt (NVL-SST-019: -5 → +2), status='completed'.
--   ③ HEAL products.stock sữa chua = SUM(branch_stock) (CHỈ khi ledger=branch —
--      đã verify 0.99=0.99). Sữa đặc bỏ qua (mixed state) + NOTICE.
-- Idempotent: SX000011 đã completed → skip.
-- ============================================================

do $$
declare
  v_tenant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_po     uuid := '9c2b78d3-6db1-4778-8ee5-04d8042604da'; -- SX000011
  v_nvl    uuid := '468e83b5-2398-49ee-9702-e80f29ac701b'; -- NVL-SST-019 thành phẩm Yaourt
  v_sua    uuid := 'ba1c3afa-750a-4195-9909-663f46120968'; -- NVL-SST-015 sữa chua (heal an toàn)
  v_kho    uuid := '558adc8f-a629-4ae6-90a6-d13c2a83896c'; -- Kho Tổng
  v_owner  uuid;
  v_status text;
  r record;
  v_reverse numeric;
  v_lot uuid;
  v_ledger numeric;
  v_branch numeric;
  v_prod numeric;
begin
  select status into v_status from public.production_orders where id = v_po;
  if not found then
    raise exception '00158: không tìm thấy lệnh SX000011';
  end if;
  if v_status = 'completed' then
    raise notice '00158 SKIP: SX000011 đã completed trước đó';
    return;
  end if;

  select id into v_owner from public.profiles
   where tenant_id = v_tenant and role = 'owner' order by created_at limit 1;
  if v_owner is null then
    raise exception '00158: không tìm thấy owner của tenant';
  end if;

  -- ① HOÀN NVL TRỪ DƯ: giữ 1 vòng, hoàn (n-1)/n phần đã trừ cho từng NVL.
  for r in
    select product_id,
           sum(quantity) as total_out,
           count(*)      as n_rounds
    from public.stock_movements
    where reference_id = v_po
      and reference_type = 'production_order'
      and type = 'out'
    group by product_id
  loop
    if r.n_rounds <= 1 then
      continue; -- chỉ 1 vòng → không có gì để hoàn
    end if;
    v_reverse := round(r.total_out * (r.n_rounds - 1) / r.n_rounds, 4);
    if v_reverse <= 0 then
      continue;
    end if;

    -- hoàn cả 2 sổ để không tạo drift mới
    update public.products
      set stock = stock + v_reverse, updated_at = now()
      where id = r.product_id;
    update public.branch_stock
      set quantity = quantity + v_reverse, updated_at = now()
      where product_id = r.product_id and branch_id = v_kho and variant_id is null;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant, v_kho, r.product_id, 'in', v_reverse,
      'production_reconcile', v_po,
      'Đối soát SX000011: hoàn NVL bị trừ dư ' || (r.n_rounds - 1)::text
        || '/' || r.n_rounds::text || ' lần (lỗi hoàn thành SX không nguyên tử) — giữ 1 vòng cho mẻ SX thật',
      v_owner
    );
    raise notice '00158 ① hoàn % đơn vị NVL % (đã trừ % qua % lần)', v_reverse, r.product_id, r.total_out, r.n_rounds;
  end loop;

  -- ② HOÀN THÀNH SX000011 đúng 1 lần: nhập 7 chai Yaourt, tạo lô, set completed.
  --    (complete_production_order KHÔNG re-consume — chỉ nhập thành phẩm + lô + WAC.)
  v_lot := public.complete_production_order(
    v_po, 7,
    'SX000011-20260706',
    '2026-07-06'::date,
    null
  );
  raise notice '00158 ② SX000011 completed — lô % (7 chai Yaourt vào kho)', v_lot;

  -- ③ HEAL drift products.stock sữa chua (CHỈ khi ledger=branch — an toàn).
  select coalesce(sum(case when type='out' then -quantity else quantity end),0)
    into v_ledger from public.stock_movements where product_id = v_sua;
  select coalesce(sum(quantity),0) into v_branch
    from public.branch_stock where product_id = v_sua;
  select stock into v_prod from public.products where id = v_sua;

  if abs(v_ledger - v_branch) < 0.001 then
    update public.products set stock = v_branch, updated_at = now() where id = v_sua;
    raise notice '00158 ③ HEAL sữa chua products.stock: % → % (=branch=ledger)', v_prod, v_branch;
  else
    raise notice '00158 ③ BỎ QUA heal sữa chua: ledger(%) ≠ branch(%) — state hỗn hợp', v_ledger, v_branch;
  end if;

  raise notice '00158 XONG. Kiểm: Yaourt NVL-SST-019 kỳ vọng +2; sữa chua NVL-SST-015 kỳ vọng products=branch.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp:
--   select code, status, completed_qty, lot_number from public.production_orders where code='SX000011';
--     -- kỳ vọng completed / 7 / SX000011-20260706
--   select code, name, stock from public.products where code='NVL-SST-019';  -- kỳ vọng 2
--   select p.code, p.stock as products_stock,
--          (select sum(quantity) from public.branch_stock b where b.product_id=p.id) as branch_sum
--   from public.products p where p.code in ('NVL-SST-015','NVL-SUA-002','NVL-SUA-001');
--     -- sữa chua: products=branch (đã heal); sữa đặc: vẫn lệch (xử riêng); sữa tươi: khớp
--   select lot_number, current_qty, status from public.product_lots
--   where production_order_id='9c2b78d3-6db1-4778-8ee5-04d8042604da';  -- 1 lô, 7 chai
-- LƯU Ý CÒN LẠI (ngoài phạm vi migration này):
--   - Sữa đặc NVL-SUA-002 drift products.stock 220.72 + ledger≠branch 0.01 → cần
--     điều tra riêng (mixed state, không heal 1 chiều).
-- ============================================================
