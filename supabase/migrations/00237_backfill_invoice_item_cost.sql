-- ============================================================
-- 00237 — Giá vốn dòng bán: ghi cho ĐÚNG, và lấp lại lịch sử
-- ============================================================
-- CHẠY SAU 00236 (cần hàm bom_unit_cost và giá vốn thẻ SP đã được nối).
--
-- ═══ LỖI 1 — trigger 00196 ghi số 0 thay vì "chưa biết" ═══
-- 00196 dựng trigger chốt giá vốn lúc bán, lấy từ products.cost_price.
-- Chính 00196 ghi rõ: "NULL nghĩa là chưa biết, báo cáo phải gắn nhãn ước
-- lượng". Nhưng vì SP có công thức đang để cost_price = 0 (chỗ đứt ở
-- 00236), trigger chép về số 0 — mà 0 KHÔNG phải "chưa biết", 0 là
-- "bán không tốn đồng nào". Báo cáo tin số 0 đó và tính lãi 100%.
--
-- Đo thật: 500/502 dòng bán từ 16/07 (ngày chạy 00196) đang mang giá vốn
-- đúng bằng 0. Chỉ 2 dòng có giá thật.
--
-- ═══ LỖI 2 — 1.531 dòng cũ trước 16/07 để trống ═══
-- 00196 cố ý không lấp lịch sử. Cộng lại: 2.031/2.033 dòng bán không có
-- giá vốn dùng được → lãi gộp đang bị báo THỪA khoảng 408 triệu.
--
-- ═══ CÁCH LẤP — ưu tiên nguồn chính xác nhất trước ═══
--   A. Giá nguyên liệu ĐÚNG THỜI ĐIỂM, đọc từ chính dòng sổ kho
--      bom_consume của hoá đơn đó (00206/00207 đã ghi giá vào sổ).
--      Chỉ dùng khi ĐỦ giá của MỌI nguyên liệu trong công thức —
--      thiếu một cái là tổng bị hụt, thà rơi xuống nguồn B.
--   B. Công thức × giá nguyên liệu hiện tại.
--   C. Giá vốn thẻ sản phẩm.
--   Không có nguồn nào → ĐỂ TRỐNG. Không bịa số.
--
-- Chạy thử trước trên dữ liệu thật (không ghi): A 1.158 dòng · B 872 ·
-- C 1 · trống 0. Đối chiếu A với B trên cùng 1.158 dòng: lệch trung bình
-- 2,3% → B là đường lùi đáng tin.
--
-- ═══ CHẶN SỐ VÔ LÝ ═══
-- 5 dòng tính ra giá vốn > 3× giá bán (Bò húc 293.000đ/lon giá bán
-- 12.708đ, Sting, Coca...). Đây là công thức khai theo THÙNG mà bán theo
-- LON — lỗi công thức, không phải lỗi giá. Ghi số đó vào còn sai hơn để
-- trống, nên BỎ QUA và in danh sách ra để sửa công thức.
--
-- ⚠️ CHỈ ghi cột unit_cost của dòng bán. Không đụng tiền, kho, công nợ.
-- ⚠️ Có bảng sao lưu, phục hồi được (câu lệnh ở cuối file).
-- ============================================================

-- ── 0. Chặn chạy sai thứ tự ──────────────────────────────────
do $$
begin
  if to_regprocedure('public.bom_unit_cost(uuid)') is null then
    raise exception '00237 cần 00236 chạy trước (thiếu hàm bom_unit_cost).';
  end if;
  if to_regprocedure('public.get_active_bom_for_branch(uuid,uuid,uuid)') is null then
    raise exception '00237 cần hàm get_active_bom_for_branch (00147).';
  end if;
end $$;

-- ── 1. Trigger chốt giá vốn lúc bán — không bao giờ ghi số 0 ──
create or replace function public.set_invoice_item_unit_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost   numeric;
  v_branch uuid;
  v_bom    uuid;
begin
  -- Đã có giá thật thì thôi
  if new.unit_cost is not null and new.unit_cost <> 0 then
    return new;
  end if;

  select p.cost_price into v_cost
    from public.products p
   where p.id = new.product_id;

  -- Thẻ SP không có giá → nổ công thức THEO ĐÚNG CHI NHÁNH bán,
  -- dùng chính hàm mà đường trừ kho đang dùng → giá vốn luôn khớp với
  -- nguyên liệu thực sự bị trừ.
  if coalesce(v_cost, 0) = 0 and new.invoice_id is not null then
    select i.branch_id into v_branch
      from public.invoices i
     where i.id = new.invoice_id;

    v_bom := public.get_active_bom_for_branch(new.product_id, v_branch, null);
    if v_bom is not null then
      v_cost := public.bom_unit_cost(v_bom);
    end if;
  end if;

  -- Không biết thì để TRỐNG — báo cáo sẽ gắn nhãn ước lượng,
  -- thay vì âm thầm coi như bán không tốn vốn.
  new.unit_cost := nullif(coalesce(v_cost, 0), 0);
  return new;
end;
$$;

comment on function public.set_invoice_item_unit_cost() is
  'Chốt giá vốn lúc bán (00237): thẻ SP → công thức theo chi nhánh → để trống. Không ghi 0.';

-- ── 2. Sao lưu trước khi lấp ─────────────────────────────────
create table if not exists public.invoice_items_cost_backup_00237 (
  invoice_item_id uuid primary key,
  unit_cost_cu    numeric(15,4),
  luu_luc         timestamptz not null default now()
);

comment on table public.invoice_items_cost_backup_00237 is
  'Sao lưu invoice_items.unit_cost trước khi 00237 lấp. Giữ để phục hồi được.';

insert into public.invoice_items_cost_backup_00237 (invoice_item_id, unit_cost_cu)
select ii.id, ii.unit_cost
  from public.invoice_items ii
 where (ii.unit_cost is null or ii.unit_cost = 0)
on conflict (invoice_item_id) do nothing;

-- ── 3. Lấp giá vốn ───────────────────────────────────────────
do $$
declare
  r          record;
  v_bom      uuid;
  v_gia      numeric;
  v_nguon    text;
  v_tong     numeric;
  v_thieu    boolean;
  v_yield    numeric;
  bi         record;
  v_gia_nvl  numeric;
  n_a int := 0; n_b int := 0; n_c int := 0; n_trong int := 0; n_bo int := 0;
  v_cogs     numeric := 0;
  v_ds_bo    text := '';
begin
  for r in
    select ii.id, ii.invoice_id, ii.product_id, ii.quantity, ii.unit_price,
           inv.branch_id, inv.status
      from public.invoice_items ii
      join public.invoices inv on inv.id = ii.invoice_id
     where (ii.unit_cost is null or ii.unit_cost = 0)
  loop
    v_gia := null;
    v_nguon := null;
    v_yield := 1;

    v_bom := public.get_active_bom_for_branch(r.product_id, r.branch_id, null);

    if v_bom is not null then
      select coalesce(b.yield_qty, 1) into v_yield from public.bom b where b.id = v_bom;
      v_yield := coalesce(v_yield, 1);

      -- ── Nguồn A: giá nguyên liệu đúng thời điểm, lấy từ sổ kho ──
      v_tong := 0;
      v_thieu := false;
      for bi in
        select bi2.material_id, bi2.quantity, coalesce(bi2.waste_percent, 0) as waste
          from public.bom_items bi2
         where bi2.bom_id = v_bom
      loop
        v_gia_nvl := null;
        select sm.unit_cost into v_gia_nvl
          from public.stock_movements sm
         where sm.reference_type = 'bom_consume'
           and sm.reference_id = r.invoice_id
           and sm.product_id = bi.material_id
           and sm.unit_cost is not null
           and sm.unit_cost > 0
         limit 1;

        if v_gia_nvl is null then
          v_thieu := true;
          exit;
        end if;
        v_tong := v_tong + v_gia_nvl * bi.quantity * (1 + bi.waste / 100);
      end loop;

      -- Công thức rỗng thì không coi là "đủ giá"
      if not exists (select 1 from public.bom_items where bom_id = v_bom) then
        v_thieu := true;
      end if;

      if not v_thieu and v_tong > 0 then
        v_gia := v_tong / nullif(v_yield, 0);
        v_nguon := 'A';
      else
        -- ── Nguồn B: công thức × giá nguyên liệu hiện tại ──
        v_gia := public.bom_unit_cost(v_bom);
        if coalesce(v_gia, 0) > 0 then
          v_nguon := 'B';
        else
          v_gia := null;
        end if;
      end if;
    end if;

    -- ── Nguồn C: giá vốn thẻ sản phẩm ──
    if v_gia is null then
      select p.cost_price into v_gia
        from public.products p where p.id = r.product_id;
      if coalesce(v_gia, 0) > 0 then v_nguon := 'C'; else v_gia := null; end if;
    end if;

    if v_gia is null then
      n_trong := n_trong + 1;
      continue;
    end if;

    -- ── Chặn số vô lý: công thức khai sai đơn vị (thùng vs lon) ──
    if coalesce(r.unit_price, 0) > 0 and v_gia > r.unit_price * 3 then
      n_bo := n_bo + 1;
      declare v_ma text;
      begin
        select coalesce(p.code, '?') into v_ma
          from public.products p where p.id = r.product_id;
        if length(v_ds_bo) < 300 and position(coalesce(v_ma, '?') in v_ds_bo) = 0 then
          v_ds_bo := v_ds_bo || coalesce(v_ma, '?') || ' ';
        end if;
      end;
      continue;
    end if;

    update public.invoice_items
       set unit_cost = round(v_gia, 4)
     where id = r.id;

    if v_nguon = 'A' then n_a := n_a + 1;
    elsif v_nguon = 'B' then n_b := n_b + 1;
    else n_c := n_c + 1; end if;

    if r.status = 'completed' then
      v_cogs := v_cogs + v_gia * coalesce(r.quantity, 0);
    end if;
  end loop;

  raise notice '00237: lấp giá vốn — A(đúng thời điểm) % · B(công thức) % · C(thẻ SP) %', n_a, n_b, n_c;
  raise notice '00237: để trống % dòng · bỏ qua vì giá vốn > 3× giá bán % dòng [%]', n_trong, n_bo, trim(v_ds_bo);
  raise notice '00237: giá vốn bổ sung vào hoá đơn hoàn thành: %', round(v_cogs);
  raise notice '00237: lãi gộp trên báo cáo sẽ GIẢM đúng bằng số này — trước đây bị báo thừa.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi áp
-- ============================================================
-- 1) Còn bao nhiêu dòng bán chưa có giá vốn:
-- select count(*) filter (where unit_cost is null)  as con_trong,
--        count(*) filter (where unit_cost = 0)      as con_bang_0,
--        count(*) filter (where unit_cost > 0)      as co_gia
--   from public.invoice_items;
--
-- 2) Lãi gộp theo tháng sau khi lấp:
-- select to_char(i.created_at, 'YYYY-MM') as thang,
--        sum(ii.total)                             as doanh_thu,
--        sum(ii.unit_cost * ii.quantity)           as gia_von,
--        round(100 * (1 - sum(ii.unit_cost * ii.quantity) / nullif(sum(ii.total),0)), 1) as lai_gop_pc
--   from public.invoice_items ii
--   join public.invoices i on i.id = ii.invoice_id
--  where i.status = 'completed'
--  group by 1 order by 1;
--
-- 3) Công thức khai sai đơn vị (giá vốn > 3× giá bán) — cần sửa công thức:
-- select p.code, p.name, round(public.bom_unit_cost(
--          public.get_active_bom_for_branch(ii.product_id, i.branch_id, null)), 0) as gia_von_cong_thuc,
--        ii.unit_price as gia_ban, count(*) as so_dong
--   from public.invoice_items ii
--   join public.invoices i on i.id = ii.invoice_id
--   join public.products p on p.id = ii.product_id
--  where ii.unit_cost is null and ii.unit_price > 0
--  group by 1,2,3,4 order by 5 desc;
--
-- ============================================================
-- PHỤC HỒI (nếu cần trả về nguyên trạng)
-- ============================================================
-- update public.invoice_items ii
--    set unit_cost = b.unit_cost_cu
--   from public.invoice_items_cost_backup_00237 b
--  where b.invoice_item_id = ii.id;
