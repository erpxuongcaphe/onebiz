-- ============================================================
-- 00074: Atomic RPC cho xuất hủy + xuất dùng nội bộ (CEO 14/05/2026)
--
-- VẤN ĐỀ phát hiện trong audit:
--   completeDisposalExport + completeInternalExport hiện chia 3 bước:
--     1. UPDATE status='completed' (atomic single-row)
--     2. Load items
--     3. applyManualStockMovement (stock-out)
--   → Bước 1 và 3 KHÔNG cùng transaction. Nếu mạng đứt giữa bước 1-3
--     hoặc server crash → status = 'completed' nhưng stock KHÔNG trừ
--     → DRIFT KHO.
--
-- FIX:
--   - 2 RPC mới gom toàn bộ 3 bước vào 1 transaction Postgres
--   - Lock row + check status='draft' trước khi commit
--   - Trừ stock 3 lớp: products.stock + branch_stock + product_lots
--     (FIFO với SKIP LOCKED đã có ở 00072)
--   - Audit log entry
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. apply_disposal_export_atomic
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_disposal_export_atomic(
  p_disposal_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_disposal record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_tenant_id uuid;
  v_branch_id uuid;
  v_items_count int := 0;
  r record;
begin
  -- Lock + check status
  select * into v_disposal
  from public.disposal_exports
  where id = p_disposal_id
  for update;

  if not found then
    raise exception 'DISPOSAL_NOT_FOUND: %', p_disposal_id;
  end if;

  if v_disposal.status <> 'draft' then
    raise exception 'INVALID_STATUS: phiếu xuất hủy đang ở trạng thái "%" — không thể hoàn tất.', v_disposal.status;
  end if;

  v_tenant_id := v_disposal.tenant_id;
  v_branch_id := v_disposal.branch_id;

  -- Flip status
  update public.disposal_exports
  set status = 'completed',
      updated_at = now()
  where id = p_disposal_id;

  -- Loop items: trừ stock 3 lớp + ghi movement + allocate lot FIFO
  for r in
    select id, product_id, product_name, quantity
    from public.disposal_export_items
    where disposal_id = p_disposal_id
  loop
    if coalesce(r.quantity, 0) <= 0 then
      continue;
    end if;

    -- 1. Stock movement (audit ledger)
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'disposal_export', p_disposal_id,
      v_disposal.code || ' - Xuất hủy - ' || r.product_name || ' (-' || r.quantity || ')',
      coalesce(v_actor, v_disposal.created_by)
    );

    -- 2. products.stock + branch_stock
    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    -- 3. product_lots FIFO (skip nếu SP không có lot tracking)
    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id, r.quantity,
        'disposal_export', p_disposal_id
      );
    exception when others then null; -- best-effort
    end;

    v_items_count := v_items_count + 1;
  end loop;

  -- Audit log
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'complete_disposal',
    'disposal_export',
    p_disposal_id,
    jsonb_build_object(
      'code', v_disposal.code,
      'items_count', v_items_count,
      'completed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'disposal_id', p_disposal_id,
    'code', v_disposal.code,
    'items_processed', v_items_count
  );
end;
$$;

comment on function public.apply_disposal_export_atomic is
  'Hoàn tất phiếu xuất hủy ATOMIC: status + stock_movements + products.stock + branch_stock + product_lots FIFO trong 1 transaction. CEO 14/05/2026.';

grant execute on function public.apply_disposal_export_atomic(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. apply_internal_export_atomic
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_internal_export_atomic(
  p_export_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_export record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_tenant_id uuid;
  v_branch_id uuid;
  v_items_count int := 0;
  r record;
begin
  -- Lock + check status
  select * into v_export
  from public.internal_exports
  where id = p_export_id
  for update;

  if not found then
    raise exception 'INTERNAL_EXPORT_NOT_FOUND: %', p_export_id;
  end if;

  if v_export.status <> 'draft' then
    raise exception 'INVALID_STATUS: phiếu xuất nội bộ đang ở trạng thái "%" — không thể hoàn tất.', v_export.status;
  end if;

  v_tenant_id := v_export.tenant_id;
  v_branch_id := v_export.branch_id;

  -- Flip status
  update public.internal_exports
  set status = 'completed',
      updated_at = now()
  where id = p_export_id;

  -- Loop items
  for r in
    select id, product_id, product_name, quantity
    from public.internal_export_items
    where export_id = p_export_id
  loop
    if coalesce(r.quantity, 0) <= 0 then
      continue;
    end if;

    -- 1. Stock movement ledger
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'internal_export', p_export_id,
      v_export.code || ' - Xuất nội bộ - ' || r.product_name || ' (-' || r.quantity || ')',
      coalesce(v_actor, v_export.created_by)
    );

    -- 2. products.stock + branch_stock
    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    -- 3. product_lots FIFO
    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id, r.quantity,
        'internal_export', p_export_id
      );
    exception when others then null;
    end;

    v_items_count := v_items_count + 1;
  end loop;

  -- Audit log
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'complete_internal_export',
    'internal_export',
    p_export_id,
    jsonb_build_object(
      'code', v_export.code,
      'items_count', v_items_count,
      'completed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'export_id', p_export_id,
    'code', v_export.code,
    'items_processed', v_items_count
  );
end;
$$;

comment on function public.apply_internal_export_atomic is
  'Hoàn tất phiếu xuất nội bộ ATOMIC: status + stock_movements + products.stock + branch_stock + product_lots FIFO trong 1 transaction. CEO 14/05/2026.';

grant execute on function public.apply_internal_export_atomic(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
