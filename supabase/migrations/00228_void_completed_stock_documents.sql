-- ============================================================
-- 00228 — Cho huỷ phiếu XUẤT HUỶ / XUẤT DÙNG NỘI BỘ đã hoàn thành
-- ============================================================
-- HIỆN TRẠNG: hai loại phiếu này được tạo thẳng ở trạng thái 'completed'
-- (dialog finalize luôn, không qua nháp), nhưng hàm huỷ phía ứng dụng chỉ
-- nhận 'draft' → nút "Huỷ" là nút chết, bấm ra "Không thể hủy phiếu ở trạng
-- thái completed". Nhập nhầm thì chỉ chữa được bằng điều chỉnh tồn tay.
--
-- Prod đang có 5 phiếu xuất huỷ (DI000001–DI000005), tất cả 'completed' —
-- tức nghiệp vụ này CÓ dùng thật, không phải tính năng nằm không.
-- Xuất dùng nội bộ: 0 phiếu, vá trước cho đủ bộ.
--
-- CÁCH HOÀN KHO: đọc ngược **sổ cái stock_movements** của chính phiếu đó
-- (reference_id = id phiếu) rồi cộng trả lại đúng số đã xuất, kèm dòng bút
-- toán đối ứng để tra được. KHÔNG dựng lại từ bảng items — sổ cái mới là sự
-- thật; items có thể đã bị sửa, hoặc phiếu xuất một phần.
--
-- AN TOÀN: chạy trong 1 transaction; khoá phiếu bằng FOR UPDATE chống bấm
-- hai lần; phiếu đã 'cancelled' thì báo lỗi rõ chứ không cộng kho lần nữa.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) Huỷ phiếu XUẤT HUỶ đã hoàn thành
-- ────────────────────────────────────────────────────────────
create or replace function public.void_disposal_export_atomic(
  p_disposal_id uuid,
  p_created_by uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc record;
  v_mv record;
  v_restored numeric := 0;
  v_lines int := 0;
begin
  select * into v_doc
  from public.disposal_exports
  where id = p_disposal_id
  for update;

  if not found then
    raise exception 'DISPOSAL_NOT_FOUND: không tìm thấy phiếu xuất huỷ %', p_disposal_id;
  end if;

  if v_doc.status = 'cancelled' then
    raise exception 'ALREADY_CANCELLED: phiếu % đã huỷ trước đó', v_doc.code;
  end if;

  -- Hoàn kho theo đúng những gì đã ghi sổ cái
  for v_mv in
    select product_id, branch_id, quantity
    from public.stock_movements
    where reference_id = p_disposal_id
      and reference_type = 'disposal_export'
      and type = 'out'
  loop
    perform public.increment_product_stock(v_mv.product_id, v_mv.quantity);
    perform public.upsert_branch_stock(
      v_doc.tenant_id, v_mv.branch_id, v_mv.product_id, v_mv.quantity
    );

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_doc.tenant_id, v_mv.branch_id, v_mv.product_id, 'in', v_mv.quantity,
      'disposal_export_void', p_disposal_id,
      'Huỷ phiếu xuất huỷ ' || v_doc.code ||
        coalesce(' — ' || nullif(p_reason, ''), ''),
      p_created_by
    );

    v_restored := v_restored + v_mv.quantity;
    v_lines := v_lines + 1;
  end loop;

  update public.disposal_exports
  set status = 'cancelled',
      note = coalesce(note, '') ||
             case when p_reason is null or p_reason = '' then ''
                  else ' [Huỷ: ' || p_reason || ']' end,
      updated_at = now()
  where id = p_disposal_id;

  return jsonb_build_object(
    'success', true,
    'code', v_doc.code,
    'restored_lines', v_lines,
    'restored_qty', v_restored
  );
end;
$$;

comment on function public.void_disposal_export_atomic is
  'Huỷ phiếu xuất huỷ đã hoàn thành: hoàn kho theo sổ cái + đánh dấu cancelled (00228).';

-- ────────────────────────────────────────────────────────────
-- 2) Huỷ phiếu XUẤT DÙNG NỘI BỘ đã hoàn thành
-- ────────────────────────────────────────────────────────────
create or replace function public.void_internal_export_atomic(
  p_export_id uuid,
  p_created_by uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc record;
  v_mv record;
  v_restored numeric := 0;
  v_lines int := 0;
begin
  select * into v_doc
  from public.internal_exports
  where id = p_export_id
  for update;

  if not found then
    raise exception 'EXPORT_NOT_FOUND: không tìm thấy phiếu xuất nội bộ %', p_export_id;
  end if;

  if v_doc.status = 'cancelled' then
    raise exception 'ALREADY_CANCELLED: phiếu % đã huỷ trước đó', v_doc.code;
  end if;

  for v_mv in
    select product_id, branch_id, quantity
    from public.stock_movements
    where reference_id = p_export_id
      and reference_type = 'internal_export'
      and type = 'out'
  loop
    perform public.increment_product_stock(v_mv.product_id, v_mv.quantity);
    perform public.upsert_branch_stock(
      v_doc.tenant_id, v_mv.branch_id, v_mv.product_id, v_mv.quantity
    );

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_doc.tenant_id, v_mv.branch_id, v_mv.product_id, 'in', v_mv.quantity,
      'internal_export_void', p_export_id,
      'Huỷ phiếu xuất nội bộ ' || v_doc.code ||
        coalesce(' — ' || nullif(p_reason, ''), ''),
      p_created_by
    );

    v_restored := v_restored + v_mv.quantity;
    v_lines := v_lines + 1;
  end loop;

  update public.internal_exports
  set status = 'cancelled',
      note = coalesce(note, '') ||
             case when p_reason is null or p_reason = '' then ''
                  else ' [Huỷ: ' || p_reason || ']' end,
      updated_at = now()
  where id = p_export_id;

  return jsonb_build_object(
    'success', true,
    'code', v_doc.code,
    'restored_lines', v_lines,
    'restored_qty', v_restored
  );
end;
$$;

comment on function public.void_internal_export_atomic is
  'Huỷ phiếu xuất dùng nội bộ đã hoàn thành: hoàn kho theo sổ cái + đánh dấu cancelled (00228).';

grant execute on function public.void_disposal_export_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.void_internal_export_atomic(uuid, uuid, text) to authenticated;

-- ============================================================
-- VERIFY — chạy sau khi áp
-- ============================================================
-- 1) Hai hàm đã có (phải ra 2 dòng):
-- select proname from pg_proc
-- where proname in ('void_disposal_export_atomic','void_internal_export_atomic');
--
-- 2) KHÔNG chạy thử trên phiếu thật. Muốn thử thì tạo 1 phiếu xuất huỷ mới,
--    huỷ nó, rồi đối chiếu tồn của mã đó trước/sau phải bằng nhau.
