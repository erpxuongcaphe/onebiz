-- ============================================================
-- 00109: Simple product code (CEO 21/05/2026)
-- ============================================================
-- CEO 21/05: "mã sản phẩm đang bị thêm mã danh mục phía đầu" →
-- bỏ groupCode khỏi mã auto-gen, giữ cấu trúc đơn giản {PREFIX}-{NNNN}.
--
-- TRƯỚC: NVL-BAO-022, SKU-CAFE-005, BOM-CAFE-005 (qua next_group_code)
-- SAU:   NVL-0001, SKU-0001, BOM-0001 (qua next_simple_code mới)
--
-- Quan trọng:
--   - KHÔNG migrate mã cũ (CEO confirm) — mã cũ "NVL-BAO-022" giữ nguyên
--   - Counter mới hoàn toàn độc lập (bảng code_sequences, padding 4)
--   - Mã cũ padding 3, mã mới padding 4 → KHÔNG xảy ra trùng
--   - next_group_code + peek_next_group_code cũ giữ lại cho backward-compat
--     (chỉ FE không gọi nữa, nhưng RPC còn tồn tại cho script cũ nếu có)

-- ============================================================
-- 1. next_simple_code() — sinh {PREFIX}-{NNNN} atomic
-- ============================================================
create or replace function public.next_simple_code(
  p_tenant_id uuid,
  p_prefix text   -- 'NVL' | 'SKU' | 'BOM' | 'NCC' | ...
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_next int;
  v_padding int := 4;
begin
  -- Upsert: increment hoặc tạo mới sequence theo (tenant, entity_type=prefix)
  insert into public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
  values (p_tenant_id, p_prefix, p_prefix, 1, v_padding)
  on conflict (tenant_id, entity_type)
  do update set current_number = code_sequences.current_number + 1
  returning current_number into v_next;

  return p_prefix || '-' || lpad(v_next::text, v_padding, '0');
end;
$$;

grant execute on function public.next_simple_code(uuid, text) to authenticated;

comment on function public.next_simple_code is
  'CEO 21/05/2026: Sinh mã đơn giản {PREFIX}-{NNNN} không kèm group_code. Dùng cho NVL/SKU/BOM mới.';

-- ============================================================
-- 2. peek_next_simple_code() — preview KHÔNG increment counter
-- ============================================================
-- Dùng cho UI dialog tạo SP: hiển thị mã thật ngay khi chọn loại (NVL/SKU)
-- mà chưa save. Không thay đổi counter → user có thể preview nhiều lần.

create or replace function public.peek_next_simple_code(
  p_tenant_id uuid,
  p_prefix text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current int;
  v_padding int := 4;
begin
  select current_number, padding
  into v_current, v_padding
  from public.code_sequences
  where tenant_id = p_tenant_id
    and entity_type = p_prefix;

  if not found then
    v_current := 0;  -- counter chưa có → next sẽ là 1
    v_padding := 4;
  end if;

  return p_prefix || '-' || lpad((v_current + 1)::text, v_padding, '0');
end;
$$;

grant execute on function public.peek_next_simple_code(uuid, text) to authenticated;

comment on function public.peek_next_simple_code is
  'CEO 21/05/2026: Preview mã đơn giản tiếp theo KHÔNG increment counter. Dùng cho FE preview.';

notify pgrst, 'reload schema';
