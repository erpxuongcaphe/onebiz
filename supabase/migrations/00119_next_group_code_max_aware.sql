-- ============================================================
-- 00119 — next_group_code: catch up từ MAX existing code
-- ============================================================
-- CEO 01/06/2026: lỗi khi tạo SKU mới
--   "[createProduct] duplicate key value violates unique constraint
--    'products_tenant_id_code_key' (code: 23505)"
--
-- Nguyên nhân:
--   Sau khi import 286 SKU + 269 NVL từ phần mềm cũ vào tenant, table
--   `group_code_sequences` KHÔNG có row tương ứng → counter vẫn 0. Lần
--   tạo SP mới gọi `next_group_code('SKU','CPH')` → counter→1 → mã đề
--   xuất `SKU-CPH-001`. Nhưng products đã có sẵn `SKU-CPH-001` → INSERT
--   trúng constraint unique (tenant_id, code).
--
-- Fix:
--   2 RPC (next_group_code + peek_next_group_code) phải tra MAX số đuôi
--   của `products.code` matching pattern `{PREFIX}-{GROUP}-[0-9]+` cho
--   tenant đó, và dùng GREATEST(counter + 1, max_existing + 1) làm số
--   tiếp theo. Counter atomic vẫn giữ; chỉ thêm bước catch-up.
--
-- Tác dụng phụ tích cực:
--   - Hỗ trợ data từ phần mềm khác (Fabi/KiotViet) import bất kỳ lúc nào.
--   - Không cần migration script đồng bộ counter — RPC tự xử lý on-demand.
--   - Backward compat: nếu products trống → max=0 → counter logic như cũ.
--
-- Test sau migration:
--   SELECT public.peek_next_group_code(
--     '148e8ac5-b891-4de3-9055-cfa41f39ddb0', 'SKU', 'CPH');
--   → phải trả về số sau MAX existing SKU-CPH-* hiện có, KHÔNG phải 001.
-- ============================================================

create or replace function public.next_group_code(
  p_tenant_id uuid,
  p_prefix text,
  p_group_code text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_next int;
  v_padding int;
  v_effective_group text;
  v_existing_max int;
  v_pattern text;
begin
  -- Dedupe prefix (giữ nguyên logic 00110).
  if upper(p_group_code) like upper(p_prefix) || '-%' then
    v_effective_group := substring(p_group_code from char_length(p_prefix) + 2);
  else
    v_effective_group := p_group_code;
  end if;

  -- Catch-up: tìm MAX số đuôi của products.code matching `{PREFIX}-{GROUP}-NNN`
  -- trong tenant này. Nếu chưa có → 0.
  v_pattern := '^' || p_prefix || '-' || v_effective_group || '-([0-9]+)$';
  select coalesce(max((regexp_match(code, v_pattern))[1]::int), 0)
    into v_existing_max
  from public.products
  where tenant_id = p_tenant_id
    and code ~ v_pattern;

  -- Upsert counter — dùng GREATEST để bắt kịp data có sẵn (vd sau import).
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding)
  values (p_tenant_id, p_prefix, v_effective_group, greatest(1, v_existing_max + 1), 3)
  on conflict (tenant_id, prefix, group_code)
  do update set current_number = greatest(
    group_code_sequences.current_number + 1,
    v_existing_max + 1
  )
  returning current_number, padding into v_next, v_padding;

  return p_prefix || '-' || v_effective_group || '-' || lpad(v_next::text, v_padding, '0');
end;
$$;

comment on function public.next_group_code is
  'CEO 01/06/2026 (Migration 00119): sinh mã {PREFIX}-{GROUP}-{NNN} với dedupe prefix + catch-up từ MAX existing products.code. Hỗ trợ data import từ phần mềm cũ không qua RPC.';

-- ============================================================
-- peek_next_group_code() — cũng catch-up MAX
-- ============================================================

create or replace function public.peek_next_group_code(
  p_tenant_id uuid,
  p_prefix text,
  p_group_code text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current int;
  v_padding int;
  v_effective_group text;
  v_existing_max int;
  v_pattern text;
  v_next int;
begin
  if upper(p_group_code) like upper(p_prefix) || '-%' then
    v_effective_group := substring(p_group_code from char_length(p_prefix) + 2);
  else
    v_effective_group := p_group_code;
  end if;

  -- Counter hiện tại (nếu chưa có → 0).
  select current_number, padding
  into v_current, v_padding
  from public.group_code_sequences
  where tenant_id = p_tenant_id
    and prefix = p_prefix
    and group_code = v_effective_group;

  if not found then
    v_current := 0;
    v_padding := 3;
  end if;

  -- MAX existing trong products.
  v_pattern := '^' || p_prefix || '-' || v_effective_group || '-([0-9]+)$';
  select coalesce(max((regexp_match(code, v_pattern))[1]::int), 0)
    into v_existing_max
  from public.products
  where tenant_id = p_tenant_id
    and code ~ v_pattern;

  -- Preview = GREATEST của 2 nguồn.
  v_next := greatest(v_current + 1, v_existing_max + 1);

  return p_prefix || '-' || v_effective_group || '-' || lpad(v_next::text, v_padding, '0');
end;
$$;

comment on function public.peek_next_group_code is
  'CEO 01/06/2026 (Migration 00119): preview mã tiếp theo với dedupe prefix + catch-up MAX existing. KHÔNG increment counter.';

grant execute on function public.next_group_code(uuid, text, text) to authenticated;
grant execute on function public.peek_next_group_code(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
