-- ============================================================
-- 00034 — Fix consume_production_materials STATUS GUARD
-- ============================================================
-- BUG: Dialog "Hoàn thành SX" call consume → complete tuần tự. Với workflow
-- chuẩn planned → material_check → in_production → quality_check → completed,
-- khi user bấm "Hoàn thành" ở trạng thái quality_check, consume fail vì guard
-- chỉ cho pending/material_check/in_production.
--
-- FIX: Thêm quality_check vào allowed list. Không phá tests vì đơn vẫn phải
-- đi qua in_production → quality_check qua state machine client-side.
--
-- Phụ: index stock_movements(reference_type, reference_id) để truy orphan
-- nhanh khi audit (hiện phải full scan 10k+ rows).
-- ============================================================

create or replace function public.consume_production_materials(
  p_production_order_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_order record;
  r record;
  v_unit_cost numeric(15,4);
  v_total_cogs numeric(15,2) := 0;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- STATUS GUARD: cho phép từ planned/material_check/in_production/quality_check.
  -- quality_check là bắt buộc — dialog Hoàn thành mở từ đây → consume +
  -- complete cùng transaction.
  if v_order.status not in ('pending', 'planned', 'material_check', 'in_production', 'quality_check') then
    raise exception 'Cannot consume materials: order status is "%", expected planned/material_check/in_production/quality_check', v_order.status;
  end if;

  for r in
    select
      pom.id as pom_id,
      pom.product_id,
      coalesce(pom.actual_qty, pom.planned_qty) as qty,
      pom.unit,
      pom.unit_cost as existing_unit_cost
    from public.production_order_materials pom
    where pom.production_order_id = p_production_order_id
  loop
    -- Snapshot unit_cost từ products.cost_price NẾU chưa set
    if r.existing_unit_cost is null then
      select cost_price into v_unit_cost
      from public.products
      where id = r.product_id;
      v_unit_cost := coalesce(v_unit_cost, 0);

      update public.production_order_materials
      set unit_cost = v_unit_cost
      where id = r.pom_id;
    else
      v_unit_cost := r.existing_unit_cost;
    end if;

    -- Cộng dồn vào total COGS
    v_total_cogs := v_total_cogs + (v_unit_cost * r.qty);

    -- Atomic stock decrement
    update public.products
    set stock = stock - r.qty
    where id = r.product_id;

    update public.branch_stock
    set quantity = quantity - r.qty, updated_at = now()
    where product_id = r.product_id and branch_id = v_order.branch_id
      and variant_id is null;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_order.tenant_id, v_order.branch_id, r.product_id, 'out', r.qty,
      'production_order', p_production_order_id,
      'SX: ' || v_order.code, v_order.created_by
    );
  end loop;

  update public.production_orders
  set cogs_amount = v_total_cogs,
      updated_at = now()
  where id = p_production_order_id;
end;
$$;

-- Index cho audit trail lookup nhanh theo reference (khi load AuditHistoryTab
-- hoặc kiểm orphan stock_movements). Partial index vì nhiều rows có
-- reference_type NULL.
create index if not exists idx_stock_moves_reference
  on public.stock_movements(reference_type, reference_id)
  where reference_type is not null;
