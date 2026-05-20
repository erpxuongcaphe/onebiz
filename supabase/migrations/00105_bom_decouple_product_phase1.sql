-- ============================================================
-- 00105: BOM decouple product — Phase 1 (additive, không break)
--
-- CEO 20/05/2026: Đổi sang model "BOM tồn tại độc lập, SKU trỏ về BOM
-- qua Mã BOM". User workflow:
--   1. Tạo BOM trước (qua Excel hoặc form) — chưa cần SKU
--   2. Tạo SKU sau, gắn Mã BOM trong info SKU
--   3. POS bán SKU → đọc bom_code → tìm BOM → trừ NVL
--
-- PHASE 1 (migration này) — additive only:
--   - ADD products.bom_code text nullable
--   - Backfill từ existing BOM (đảm bảo POS không break)
--   - OVERRIDE function get_active_bom_for_branch để ưu tiên đọc bom_code
--     từ products, fallback về cách cũ (bom.product_id)
--
-- KHÔNG đụng:
--   - bom.product_id (vẫn NOT NULL) → existing BOMs giữ nguyên
--   - RPC consume_bom_for_sale (không touch trực tiếp)
--   - RPC pos_complete_checkout_atomic / fnb_complete_payment_atomic
--   - Tất cả services BOM hiện tại vẫn work
--
-- PHASE 2 (sẽ làm sau khi verify Phase 1 ổn):
--   - Relax bom.product_id NOT NULL → cho phép BOM standalone
--   - Excel BOM import không cần Mã SKU
--   - 1 BOM share nhiều SKU qua bom_code reference
-- ============================================================

-- 1. Thêm cột products.bom_code
alter table public.products
  add column if not exists bom_code text;

comment on column public.products.bom_code is
  'CEO 20/05/2026: SKU trỏ về BOM qua code (vd "BOM-CFS-001"). NULL = SKU không dùng BOM. Cho phép share 1 BOM cho nhiều SKU. Khác với cột has_bom: bom_code lưu thông tin link cụ thể, has_bom chỉ là boolean flag.';

-- 2. Index để lookup BOM theo code nhanh
create index if not exists idx_products_bom_code
  on public.products(tenant_id, bom_code)
  where bom_code is not null;

-- 3. Backfill từ existing BOM data
-- Logic: với mỗi SP có has_bom=true → tìm BOM active global của SP đó
-- (ưu tiên global vì sau khi decouple, branch override sẽ qua bom_code + branch_id)
update public.products p
set bom_code = b.code
from public.bom b
where b.product_id = p.id
  and b.tenant_id = p.tenant_id
  and b.is_active = true
  and b.branch_id is null  -- ưu tiên global BOM
  and b.code is not null    -- skip nếu BOM cũ chưa có code
  and p.bom_code is null    -- chưa set bom_code
  and p.has_bom = true;

-- 4. Backfill phụ: SP nào chỉ có BOM theo chi nhánh (không có global)
-- → vẫn copy code của BOM đầu tiên active
update public.products p
set bom_code = (
  select b.code
  from public.bom b
  where b.product_id = p.id
    and b.tenant_id = p.tenant_id
    and b.is_active = true
    and b.code is not null
  order by b.branch_id nulls first, b.created_at asc
  limit 1
)
where p.has_bom = true
  and p.bom_code is null;

-- 5. Override get_active_bom_for_branch:
-- Logic mới: ưu tiên đọc products.bom_code → lookup BOM theo code.
-- Fallback: cách cũ (bom.product_id = SKU.id) để backward compat.
--
-- Đây là helper CRITICAL — POS checkout + FnB payment đều gọi hàm này
-- để xác định BOM cần consume. KHÔNG đổi signature.
create or replace function public.get_active_bom_for_branch(
  p_product_id uuid,
  p_branch_id uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
  v_bom_code text;
  v_tenant_id uuid;
begin
  -- Đọc bom_code + tenant_id của SKU
  select bom_code, tenant_id into v_bom_code, v_tenant_id
  from public.products
  where id = p_product_id;

  -- PATH MỚI: nếu SKU có bom_code → lookup BOM theo code
  if v_bom_code is not null then
    -- Ưu tiên BOM theo branch (override)
    select id into v_bom_id
    from public.bom
    where tenant_id = v_tenant_id
      and code = v_bom_code
      and branch_id = p_branch_id
      and is_active = true
    order by version desc nulls last
    limit 1;

    if v_bom_id is not null then
      return v_bom_id;
    end if;

    -- Fallback: BOM global (cùng code, branch_id null)
    select id into v_bom_id
    from public.bom
    where tenant_id = v_tenant_id
      and code = v_bom_code
      and branch_id is null
      and is_active = true
    order by version desc nulls last
    limit 1;

    if v_bom_id is not null then
      return v_bom_id;
    end if;
    -- Lưu ý: nếu SKU có bom_code nhưng KHÔNG tìm thấy BOM nào
    --        → KHÔNG fallback về cách cũ (vì user đã chỉ định bom_code,
    --          nếu lookup fail thì để return null, frontend báo lỗi rõ).
    return null;
  end if;

  -- PATH CŨ (backward compat): SKU chưa có bom_code → tìm BOM theo product_id
  -- Bước 1: BOM riêng cho branch
  select id into v_bom_id
  from public.bom
  where product_id = p_product_id
    and branch_id = p_branch_id
    and is_active = true
  order by version desc nulls last
  limit 1;

  if v_bom_id is not null then
    return v_bom_id;
  end if;

  -- Bước 2: BOM global
  select id into v_bom_id
  from public.bom
  where product_id = p_product_id
    and branch_id is null
    and is_active = true
  order by version desc nulls last
  limit 1;

  return v_bom_id; -- có thể null
end;
$$;

comment on function public.get_active_bom_for_branch is
  'CEO 20/05/2026 (Phase 1): Đọc products.bom_code ưu tiên. Fallback bom.product_id cho backward compat. Sau Phase 2, path cũ sẽ bị remove khi bom.product_id NULLABLE.';

-- 6. Index hỗ trợ lookup BOM theo code (new path)
create index if not exists idx_bom_code_branch_active
  on public.bom(tenant_id, code, branch_id)
  where is_active = true;

-- 7. Notify supabase reload schema cache
notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY queries (chạy thủ công sau migration để check):
--
-- 1. Số SP có has_bom=true nhưng chưa có bom_code:
--    SELECT COUNT(*) FROM products WHERE has_bom = true AND bom_code IS NULL;
--    → kỳ vọng = 0 nếu backfill ok (mọi SP đã link đều có bom_code)
--
-- 2. SP có bom_code nhưng BOM không tồn tại (orphan reference):
--    SELECT p.code, p.bom_code
--    FROM products p
--    WHERE p.bom_code IS NOT NULL
--      AND NOT EXISTS (
--        SELECT 1 FROM bom b
--        WHERE b.tenant_id = p.tenant_id
--          AND b.code = p.bom_code
--          AND b.is_active = true
--      );
--    → kỳ vọng empty
--
-- 3. Test get_active_bom_for_branch trả về đúng BOM cho 1 SKU đã có BOM:
--    SELECT public.get_active_bom_for_branch('<sku-id>'::uuid, '<branch-id>'::uuid);
--    → trả về bom_id không null
-- ============================================================
