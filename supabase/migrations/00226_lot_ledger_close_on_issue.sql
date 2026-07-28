-- ============================================================
-- 00226 — Sổ lô: đóng lô khi xuất + nắn số cũ cho khớp tồn thật
-- ============================================================
-- HIỆN TRẠNG (trang Toàn vẹn kho, phép kiểm #3): 100 mã có sổ lô lệch tồn.
-- Nặng nhất NVL-CPH-001: tồn 31.135 nhưng sổ lô ghi 543.205.
--
-- GỐC: sổ lô chỉ được CỘNG khi nhập, không bao giờ được TRỪ khi xuất.
--   • Nhập hàng / sản xuất  → mở lô  (328 + 19 lô)
--   • Bán hàng qua công thức → trừ tồn NVL nhưng KHÔNG đóng lô
--   • Điều chỉnh tồn / xuất huỷ / xuất dùng nội bộ / kiểm kho → cũng không
-- Bằng chứng: 345/347 lô còn nguyên đúng bằng lúc nhập.
-- (POS bán SKU trực tiếp thì CÓ đóng lô — nhưng mô hình hiện tại bán SKU ở
--  Kho Tổng rồi nổ công thức về NVL, mà nhánh công thức lại thiếu.)
--
-- LƯU Ý: tồn kho THẬT không hề sai — phép kiểm #1 và #2 đều bằng 0. Chỉ sổ
-- lô (sổ phụ phục vụ hạn dùng + truy xuất nguồn gốc) lệch.
--
-- MIGRATION NÀY LÀM 3 VIỆC:
--   1) consume_bom_for_sale         → đóng lô FIFO khi trừ NVL (kể cả topping)
--   2) apply_manual_stock_movement  → đóng lô FIFO khi xuất tay
--   3) Nắn 347 lô hiện có về khớp tồn thật, có sao lưu trước khi sửa
--
-- AN TOÀN: hai lời gọi trừ lô đều bọc exception — lỗi sổ lô KHÔNG làm hỏng
-- việc bán hàng hay xuất kho. Phần nắn số sao lưu nguyên bảng cũ trước.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- VIỆC 1 — Bán qua công thức thì đóng lô
-- (bản sống 00147, chỉ thêm 2 lời gọi allocate_lots_fifo)
-- ────────────────────────────────────────────────────────────
create or replace function public.consume_bom_for_sale(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_invoice_id uuid,
  p_created_by uuid,
  p_invoice_code text default null,
  p_modifier_selections jsonb default null,
  p_skip_bom_consume boolean default false,
  p_variant_id uuid default null  -- CEO 16/06/2026 — công thức theo size
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
  v_bom record;
  v_item record;
  v_consumed jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_consume_qty numeric;
  v_available numeric;
  v_allow_negative boolean;
  v_note text;
  v_modifier_scale numeric;
  v_sel jsonb;
  v_opt jsonb;
  v_linked_id uuid;
  v_topping_qty numeric;
  v_topping_name text;
begin
  if p_tenant_id is null or p_branch_id is null or p_sku_id is null then
    raise exception 'consume_bom_for_sale: tenant_id, branch_id, sku_id are required';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'consume_bom_for_sale: qty must be > 0';
  end if;

  -- ─── 1. Lookup BOM (chỉ khi không skip) — TRUYỀN p_variant_id ───
  if not p_skip_bom_consume then
    v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id, p_variant_id);
  else
    v_bom_id := null;  -- skip BOM consume hoàn toàn
  end if;

  -- ─── 2. Get setting allow_negative_stock ───
  v_allow_negative := coalesce(
    (public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,
    true
  );

  -- ─── 3. BOM consume (nếu có BOM + không skip) ───
  if v_bom_id is not null then
    select b.id, b.name, b.code into v_bom
    from public.bom b
    where b.id = v_bom_id;

    v_note := format(
      'Tiêu hao NVL theo BOM [%s] — HĐ %s',
      coalesce(v_bom.code, v_bom.name, 'BOM'),
      coalesce(p_invoice_code, p_invoice_id::text)
    );

    for v_item in
      select
        bi.material_id,
        bi.unit,
        bi.quantity,
        coalesce(bi.waste_percent, 0) as waste_percent,
        bi.modifier_scale_target,
        p.code as material_code,
        p.name as material_name
      from public.bom_items bi
        left join public.products p on p.id = bi.material_id
      where bi.bom_id = v_bom_id
      order by bi.sort_order, bi.id
    loop
      -- GUARD: BOM tự-tham-chiếu (material trùng chính SKU) → bỏ qua.
      if v_item.material_id = p_sku_id then
        continue;
      end if;

      -- ─── Apply modifier scale nếu BOM item có modifier_scale_target ───
      v_modifier_scale := 1;
      if v_item.modifier_scale_target is not null
         and p_modifier_selections is not null
         and jsonb_typeof(p_modifier_selections) = 'array' then
        for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
          if (v_sel->>'groupId')::uuid = v_item.modifier_scale_target then
            for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
              if v_opt->>'scaleFactor' is not null
                 and v_opt->>'scaleFactor' <> 'null' then
                v_modifier_scale := least(
                  v_modifier_scale,
                  coalesce((v_opt->>'scaleFactor')::numeric, 1)
                );
              end if;
            end loop;
            exit;
          end if;
        end loop;
      end if;

      v_consume_qty := round(
        (v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale)::numeric,
        4
      );

      if v_consume_qty <= 0 then
        continue;
      end if;

      select coalesce(sum(quantity), 0) into v_available
      from public.branch_stock
      where product_id = v_item.material_id
        and branch_id = p_branch_id
        and variant_id is null;

      if v_available < v_consume_qty then
        if not v_allow_negative then
          raise exception 'NVL_INSUFFICIENT: NVL "%" tại chi nhánh thiếu — còn %, cần % (cho %s × %s)',
            coalesce(v_item.material_name, v_item.material_code, v_item.material_id::text),
            v_available, v_consume_qty,
            p_qty, coalesce(v_bom.name, 'BOM');
        else
          v_warnings := v_warnings || jsonb_build_object(
            'material_id', v_item.material_id,
            'material_code', v_item.material_code,
            'material_name', v_item.material_name,
            'available', v_available,
            'required', v_consume_qty,
            'modifier_scale', v_modifier_scale,
            'reason', format(
              'NVL "%s" còn %s nhưng cần %s — tồn kho sẽ âm',
              coalesce(v_item.material_name, v_item.material_code), v_available, v_consume_qty
            )
          );
        end if;
      end if;

      perform public.upsert_branch_stock(
        p_tenant_id, p_branch_id, v_item.material_id, -v_consume_qty
      );
      perform public.increment_product_stock(v_item.material_id, -v_consume_qty);

      -- 00226: trừ lô FIFO cho NVL (trước nay bán qua công thức KHÔNG đóng lô
      -- → sổ lô chỉ cộng khi nhập, thành ra lệch 100 mã). Bọc exception để
      -- lỗi sổ lô không làm hỏng việc bán hàng.
      begin
        perform public.allocate_lots_fifo(
          p_tenant_id, v_item.material_id, p_branch_id, v_consume_qty,
          'invoice', p_invoice_id
        );
      exception when others then null;
      end;

      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_item.material_id, 'out', v_consume_qty,
        'bom_consume', p_invoice_id,
        v_note || format(' [%s × %s × scale %s]',
          p_qty, coalesce(v_item.material_name, 'NVL'), v_modifier_scale),
        p_created_by
      );

      v_consumed := v_consumed || jsonb_build_object(
        'material_id', v_item.material_id,
        'material_code', v_item.material_code,
        'material_name', v_item.material_name,
        'qty', v_consume_qty,
        'unit', v_item.unit,
        'modifier_scale', v_modifier_scale
      );
    end loop;
  end if;  -- end if v_bom_id is not null

  -- ─── 4. Trừ tồn topping NVL theo linkedProductId (LUÔN CHẠY) ───
  if p_modifier_selections is not null
     and jsonb_typeof(p_modifier_selections) = 'array' then
    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
        if v_opt->>'linkedProductId' is not null
           and v_opt->>'linkedProductId' <> ''
           and v_opt->>'linkedProductId' <> 'null' then
          v_linked_id := (v_opt->>'linkedProductId')::uuid;
          v_topping_name := coalesce(v_opt->>'label', 'Topping');
          v_topping_qty := p_qty;

          select coalesce(sum(quantity), 0) into v_available
          from public.branch_stock
          where product_id = v_linked_id
            and branch_id = p_branch_id
            and variant_id is null;

          if v_available < v_topping_qty then
            if not v_allow_negative then
              raise exception 'NVL_INSUFFICIENT: Topping "%" tại chi nhánh thiếu — còn %, cần %',
                v_topping_name, v_available, v_topping_qty;
            else
              v_warnings := v_warnings || jsonb_build_object(
                'material_id', v_linked_id,
                'material_name', v_topping_name,
                'available', v_available,
                'required', v_topping_qty,
                'reason', format('Topping NVL "%s" còn %s nhưng cần %s', v_topping_name, v_available, v_topping_qty)
              );
            end if;
          end if;

          perform public.upsert_branch_stock(
            p_tenant_id, p_branch_id, v_linked_id, -v_topping_qty
          );
          perform public.increment_product_stock(v_linked_id, -v_topping_qty);

        -- 00226: trừ lô FIFO cho topping NVL
        begin
          perform public.allocate_lots_fifo(
            p_tenant_id, v_linked_id, p_branch_id, v_topping_qty,
            'invoice', p_invoice_id
          );
        exception when others then null;
        end;

          insert into public.stock_movements (
            tenant_id, branch_id, product_id, type, quantity,
            reference_type, reference_id, note, created_by
          ) values (
            p_tenant_id, p_branch_id, v_linked_id, 'out', v_topping_qty,
            'modifier_topping', p_invoice_id,
            format('Topping %s × %s — HĐ %s', v_topping_name, v_topping_qty,
              coalesce(p_invoice_code, p_invoice_id::text)),
            p_created_by
          );

          v_consumed := v_consumed || jsonb_build_object(
            'material_id', v_linked_id,
            'material_name', v_topping_name,
            'qty', v_topping_qty,
            'kind', 'modifier_topping'
          );
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'bom_id', v_bom_id,
    'bom_name', coalesce(v_bom.name, null),
    'consumed', v_consumed,
    'warnings', v_warnings,
    'allow_negative', v_allow_negative,
    'skipped_bom', p_skip_bom_consume
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- VIỆC 2 — Xuất kho tay thì đóng lô
-- (bản sống 00166, chỉ thêm 1 lời gọi khi delta âm)
-- ────────────────────────────────────────────────────────────
create or replace function public.apply_manual_stock_movement_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_type text;
  v_quantity numeric;
  v_reference_type text;
  v_reference_id uuid;
  v_note text;
  v_delta numeric;
  v_count int := 0;
  v_role text;  -- 00166 (Cách B): chặn tác động tồn trực tiếp lên fnb_menu_item
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Stock movement requires at least one item';
  end if;

  if not exists (
    select 1 from public.branches
    where id = p_branch_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Branch % does not belong to tenant %', p_branch_id, p_tenant_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_type := nullif(v_item->>'type', '');
    v_quantity := coalesce((v_item->>'quantity')::numeric, 0);
    v_reference_type := nullif(v_item->>'reference_type', '');
    v_reference_id := nullif(v_item->>'reference_id', '')::uuid;
    v_note := nullif(v_item->>'note', '');

    if v_product_id is null or v_type not in ('in', 'out', 'adjust') or v_quantity <= 0 then
      raise exception 'Invalid stock movement item: %', v_item;
    end if;

    if not exists (
      select 1 from public.products
      where id = v_product_id and tenant_id = p_tenant_id
    ) then
      raise exception 'Product % does not belong to tenant %', v_product_id, p_tenant_id;
    end if;

    -- CEO 07/07/2026 (Cách B): CHẶN tác động tồn TRỰC TIẾP lên món F&B (fnb_menu_item).
    -- Món menu không giữ tồn → nhập/xuất/điều chỉnh/kiểm kho không được đụng mã món.
    -- Escape có chủ đích cho đảo lỗi legacy: đặt "allow_menu": true trong item JSON.
    if coalesce((v_item->>'allow_menu')::boolean, false) is not true then
      select inventory_role into v_role from public.products where id = v_product_id;
      if v_role = 'fnb_menu_item' then
        raise exception 'MENU_NO_DIRECT_STOCK: Món F&B không giữ tồn trực tiếp (sản phẩm %). Tồn của món đi qua công thức, không nhập/xuất/kiểm kho thẳng.', v_product_id
          using errcode = 'P0001';
      end if;
    end if;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_product_id, v_type, v_quantity,
      v_reference_type, v_reference_id, v_note, p_created_by
    );

    v_delta := case
      when v_type = 'in' then v_quantity
      when v_type = 'out' then -v_quantity
      else 0
    end;

    if v_delta <> 0 then
      perform public.increment_product_stock(v_product_id, v_delta);
      perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_product_id, v_delta);

      -- 00226: đồng bộ sổ lô. Xuất (delta<0) thì đóng lô theo FIFO. Nhập tay
      -- (delta>0) KHÔNG tự mở lô mới — lô chỉ được sinh từ phiếu nhập hoặc
      -- lệnh sản xuất, mở ở đây sẽ đẻ lô không rõ nguồn gốc.
      if v_delta < 0 then
        begin
          perform public.allocate_lots_fifo(
            p_tenant_id, v_product_id, p_branch_id, -v_delta,
            coalesce(v_reference_type, 'manual_adjust'), v_reference_id
          );
        exception when others then null;
        end;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'items', v_count);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- VIỆC 3 — Nắn 347 lô cũ cho khớp tồn thật
-- ────────────────────────────────────────────────────────────
-- Cách nắn: với mỗi (sản phẩm × chi nhánh), lấy phần lô ghi DƯ so với tồn
-- thật rồi trừ dần từ lô CŨ NHẤT (đúng tinh thần FIFO — hàng cũ ra trước).
-- Lô nào bị trừ hết thì đánh dấu consumed.
--
-- Sao lưu trước: bảng product_lots_backup_00226 giữ nguyên trạng thái cũ,
-- muốn khôi phục thì update ngược từ bảng này.

create table if not exists public.product_lots_backup_00226 as
  select id, current_qty, status, now() as backed_up_at
  from public.product_lots;

do $nan$
declare
  r record;
  v_du numeric;
  v_lo record;
  v_tru numeric;
begin
  for r in
    select l.tenant_id, l.product_id, l.branch_id,
           sum(l.current_qty) as tong_lo,
           coalesce(max(bs.quantity), 0) as ton_that
    from public.product_lots l
    left join public.branch_stock bs
      on bs.product_id = l.product_id
     and bs.branch_id = l.branch_id
     and bs.variant_id is null
    where l.status <> 'cancelled'
    group by l.tenant_id, l.product_id, l.branch_id
    having sum(l.current_qty) > coalesce(max(bs.quantity), 0) + 0.01
  loop
    v_du := r.tong_lo - r.ton_that;

    for v_lo in
      select id, current_qty
      from public.product_lots
      where product_id = r.product_id
        and branch_id  = r.branch_id
        and status <> 'cancelled'
        and current_qty > 0
      order by received_date nulls last, created_at
    loop
      exit when v_du <= 0.01;
      v_tru := least(v_lo.current_qty, v_du);
      update public.product_lots
      set current_qty = current_qty - v_tru,
          status = case when current_qty - v_tru <= 0.01 then 'consumed' else status end,
          updated_at = now()
      where id = v_lo.id;
      v_du := v_du - v_tru;
    end loop;
  end loop;
end;
$nan$;

-- ============================================================
-- VERIFY — chạy sau khi áp
-- ============================================================
-- 1) Không còn mã nào lô lệch tồn (phải ra 0 dòng):
-- select p.code, sum(l.current_qty) as tong_lo, max(bs.quantity) as ton_that
-- from public.product_lots l
-- join public.products p on p.id = l.product_id
-- left join public.branch_stock bs on bs.product_id = l.product_id
--   and bs.branch_id = l.branch_id and bs.variant_id is null
-- where l.status <> 'cancelled'
-- group by p.code, l.product_id, l.branch_id
-- having abs(sum(l.current_qty) - coalesce(max(bs.quantity), 0)) > 0.01;
--
-- 2) Hai hàm đã có lời gọi đóng lô:
-- select pg_get_functiondef(public.consume_bom_for_sale::regproc)
--        like %allocate_lots_fifo% as bom_da_dong_lo;
--
-- 3) Muốn khôi phục lô về như cũ:
-- update public.product_lots l set current_qty = b.current_qty, status = b.status
-- from public.product_lots_backup_00226 b where b.id = l.id;
