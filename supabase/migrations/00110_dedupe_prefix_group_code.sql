-- ============================================================
-- 00110: Dedupe prefix khi sinh mã SP (CEO 22/05/2026)
-- ============================================================
-- CEO clarify: "mã nhóm là gì cũng được, chỉ cần không tự động thêm mã
-- nhóm vào mã sản phẩm thêm lần 2 nữa nếu trong cấu trúc mã đã có rồi"
--
-- Vấn đề trước: nextGroupCode('NVL', 'SKU-TEST') → 'NVL-SKU-TEST-001'
--   - User tạo nhóm tên "SKU - Test" → mã nhóm "SKU-TEST"
--   - RPC luôn concat prefix → ra "NVL-SKU-TEST-001" (đẹp về cấu trúc
--     {PREFIX}-{GROUP}-{NNN}, NHƯNG nhìn rối vì có 2 prefix)
--
-- Giải pháp: nếu group_code ĐÃ bắt đầu bằng `{prefix}-` thì KHÔNG concat
-- prefix lần nữa.
--   - nextGroupCode('SKU', 'SKU-TEST')   → 'SKU-TEST-001'   (dedupe)
--   - nextGroupCode('NVL', 'SKU-TEST')   → 'NVL-SKU-TEST-001' (chéo nhau,
--     vd user dùng "SKU-TEST" làm mã nhóm NVL — vẫn để vì kỹ thuật khác prefix)
--   - nextGroupCode('NVL', 'CAFE')       → 'NVL-CAFE-001'  (case bình thường)
--   - nextGroupCode('NVL', 'NVL-BAO')    → 'NVL-BAO-001'   (dedupe)
--
-- KHÔNG migrate mã cũ — pattern mới chỉ ảnh hưởng SP tạo từ giờ trở đi.

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
begin
  -- Dedupe: nếu group_code đã startsWith `{prefix}-` thì cắt prefix khỏi
  -- group_code để counter atomic vẫn theo (tenant, prefix, group_code gốc).
  -- Logic concat sau dùng `effective_group` đã làm sạch.
  if upper(p_group_code) like upper(p_prefix) || '-%' then
    v_effective_group := substring(p_group_code from char_length(p_prefix) + 2);
  else
    v_effective_group := p_group_code;
  end if;

  -- Upsert counter theo (tenant, prefix, effective_group). LƯU Ý: nếu user
  -- vừa nhập "CAFE" vừa nhập "NVL-CAFE" làm mã nhóm cho cùng prefix NVL →
  -- sau khi dedupe đều thành "CAFE" → cùng counter (đúng ý CEO, tránh nhánh
  -- riêng bị conflict).
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding)
  values (p_tenant_id, p_prefix, v_effective_group, 1, 3)
  on conflict (tenant_id, prefix, group_code)
  do update set current_number = group_code_sequences.current_number + 1
  returning current_number, padding into v_next, v_padding;

  return p_prefix || '-' || v_effective_group || '-' || lpad(v_next::text, v_padding, '0');
end;
$$;

comment on function public.next_group_code is
  'CEO 22/05/2026: Sinh mã {PREFIX}-{GROUP}-{NNN} với dedupe prefix — nếu group_code đã bắt đầu bằng "{prefix}-" thì không concat lần nữa.';

-- ============================================================
-- peek_next_group_code() — cũng cần dedupe để FE preview đúng
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
begin
  if upper(p_group_code) like upper(p_prefix) || '-%' then
    v_effective_group := substring(p_group_code from char_length(p_prefix) + 2);
  else
    v_effective_group := p_group_code;
  end if;

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

  return p_prefix || '-' || v_effective_group || '-' || lpad((v_current + 1)::text, v_padding, '0');
end;
$$;

comment on function public.peek_next_group_code is
  'CEO 22/05/2026: Preview mã tiếp theo với dedupe prefix. KHÔNG increment counter.';

grant execute on function public.next_group_code(uuid, text, text) to authenticated;
grant execute on function public.peek_next_group_code(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
