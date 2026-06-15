-- ============================================================
-- DRY-RUN luồng TRẢ HÀNG (BATCH 3R) — chạy trong Supabase SQL Editor.
--
-- MỤC ĐÍCH: kiểm tra THỰC TẾ rằng restore_bom_for_return + increment_returned_qty
-- chạy đúng trên DATA THẬT, NHƯNG TỰ ĐỘNG ROLLBACK — KHÔNG lưu bất kỳ thay đổi nào.
--
-- CƠ CHẾ AN TOÀN: toàn bộ chạy trong 1 DO block (1 transaction). Dòng cuối cố ý
-- `raise exception` → Postgres rollback TẤT CẢ. Các dòng `raise notice` in ra
-- tồn TRƯỚC/SAU để anh thấy RPC cộng NVL đúng, rồi mọi thứ bị huỷ.
--
-- KẾT QUẢ MONG ĐỢI: ở tab "Messages/Notices" thấy tồn NVL SAU = TRƯỚC + đúng
-- lượng theo BOM, và cuối cùng báo lỗi cố ý "DRY-RUN HOÀN TẤT" (đó là dấu hiệu
-- rollback thành công, KHÔNG phải lỗi thật).
-- ============================================================
do $$
declare
  v_tenant uuid;
  v_user   uuid;
  v_branch uuid;
  v_branch_name text;
  v_sku    uuid;
  v_sku_name text;
  v_bom    uuid;
  v_row    record;
  v_res    jsonb;
  v_ii     uuid;
  v_ii_before numeric;
  v_ii_after  numeric;
begin
  -- 1. Tenant production = tenant có nhiều BOM nhất.
  select tenant_id into v_tenant
  from public.bom group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice 'Không có BOM nào trong DB → không mô phỏng được.';
    raise exception 'DRY-RUN-ABORT (no bom)';
  end if;

  select id into v_user from public.profiles where tenant_id = v_tenant limit 1;

  -- 2. Tìm 1 SKU has_bom + chi nhánh mà get_active_bom_for_branch resolve được.
  for v_row in
    select p.id as sku, p.name as sku_name, b.id as branch, b.name as branch_name
    from public.products p
    cross join public.branches b
    where p.tenant_id = v_tenant and p.has_bom = true and b.tenant_id = v_tenant
    order by p.name
    limit 300
  loop
    v_bom := public.get_active_bom_for_branch(v_row.sku, v_row.branch);
    if v_bom is not null then
      v_sku := v_row.sku; v_sku_name := v_row.sku_name;
      v_branch := v_row.branch; v_branch_name := v_row.branch_name;
      exit;
    end if;
  end loop;

  if v_sku is null then
    raise notice 'Không tìm thấy SKU has_bom có BOM active.';
    raise exception 'DRY-RUN-ABORT (no active bom)';
  end if;

  raise notice '════ SKU: %  @  % ════', v_sku_name, v_branch_name;

  -- 3. Tồn NVL TRƯỚC khi trả.
  raise notice '── Tồn NVL TRƯỚC khi trả 1 đơn vị:';
  for v_row in
    select pm.name, pm.stock
    from public.bom_items bi join public.products pm on pm.id = bi.material_id
    where bi.bom_id = v_bom and bi.material_id <> v_sku
  loop
    raise notice '     %  =  %', v_row.name, v_row.stock;
  end loop;

  -- 4. CHẠY RPC hồi NVL (refund qty = 1).
  v_res := public.restore_bom_for_return(
    v_tenant, v_branch, v_sku, 1, gen_random_uuid(), v_user, 'DRY-RUN'
  );
  raise notice '── restore_bom_for_return trả về: %', v_res;

  -- 5. Tồn NVL SAU (đã cộng — sẽ rollback).
  raise notice '── Tồn NVL SAU (đã cộng, sẽ bị rollback):';
  for v_row in
    select pm.name, pm.stock
    from public.bom_items bi join public.products pm on pm.id = bi.material_id
    where bi.bom_id = v_bom and bi.material_id <> v_sku
  loop
    raise notice '     %  =  %', v_row.name, v_row.stock;
  end loop;

  -- 6. Test increment_returned_qty trên 1 invoice_item thật.
  select ii.id, coalesce(ii.returned_qty, 0)
    into v_ii, v_ii_before
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  where i.tenant_id = v_tenant
  limit 1;

  if v_ii is not null then
    perform public.increment_returned_qty(v_ii, 1);
    select returned_qty into v_ii_after from public.invoice_items where id = v_ii;
    raise notice '── increment_returned_qty: % → % (chống trả vượt; sẽ rollback)',
      v_ii_before, v_ii_after;
  end if;

  -- 7. ROLLBACK cố ý — huỷ mọi thay đổi ở trên.
  raise exception 'DRY-RUN HOÀN TẤT ✔ — đã rollback, KHÔNG lưu gì. (Lỗi này là CỐ Ý.)';
end $$;
