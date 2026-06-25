-- ============================================================
-- 00153: Print Template Engine (Cài đặt In V3 — GĐ3)
-- ============================================================
-- CEO 25/06/2026: bỏ "1 cấu hình in chung", cho phép mỗi
--   (Mảng × Loại chứng từ × Chi nhánh) có MẪU IN riêng,
--   kế thừa Thương hiệu chung, ghi đè khi cần.
--
-- ADDITIVE / ZERO-REGRESSION:
--   - Chưa tạo mẫu nào → resolver fallback builder built-in (print-templates.ts).
--   - KHÔNG seed mẫu ở đây → luồng in cũ KHÔNG đổi cho tới khi user tạo mẫu riêng.
--
-- Plan đầy đủ: docs/PLAN-CAI-DAT-IN-V3.md
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Bảng print_templates
-- ────────────────────────────────────────────────────────────
create table if not exists public.print_templates (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'retail' | 'wholesale' | 'fnb' | 'backoffice'
  channel text not null,
  -- doc_type enum (14): sale_invoice, sales_order, sale_return, kitchen_ticket,
  --   purchase_order, goods_receipt, input_invoice, purchase_return,
  --   internal_sale, internal_export, inventory_check, disposal,
  --   production_order, cash_voucher
  doc_type text not null,
  -- NULL = mẫu mặc định cho MỌI chi nhánh của kênh; set = ghi đè riêng 1 chi nhánh
  branch_id uuid references public.branches(id) on delete cascade,
  name text not null,
  paper_size text not null default '80mm',     -- '58mm' | '80mm' | 'A5' | 'A4'
  config jsonb not null default '{}'::jsonb,    -- PrintTemplateConfig (xem plan)
  is_default boolean not null default true,     -- mẫu auto-chọn cho khóa này
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.print_templates is
  'Mẫu in V3 (CEO 25/06/2026): cấu hình render 1 doc_type cho 1 channel, optionally riêng 1 branch. Kế thừa Thương hiệu chung (tenants.settings.business_info + branches.print_brand). Additive — không có mẫu thì dùng builder built-in.';

-- Lookup nhanh khi resolve (channel, doc_type, branch)
create index if not exists idx_print_templates_lookup
  on public.print_templates (tenant_id, channel, doc_type, branch_id)
  where is_active = true;

-- 1 mẫu MẶC ĐỊNH duy nhất / (tenant, channel, doc_type, branch|global).
-- COALESCE NULL branch → zero-uuid để treat "global" như 1 giá trị.
-- Cho phép NHIỀU mẫu non-default cùng khóa (chọn lúc in — GĐ3).
create unique index if not exists idx_print_templates_default_unique
  on public.print_templates (
    tenant_id, channel, doc_type,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_default = true and is_active = true;

-- ────────────────────────────────────────────────────────────
-- 2. RLS (theo convention 00125 floor_plan)
-- ────────────────────────────────────────────────────────────
alter table public.print_templates enable row level security;

drop policy if exists "print_templates_tenant_isolation" on public.print_templates;
create policy "print_templates_tenant_isolation" on public.print_templates
  for all using (tenant_id = public.get_user_tenant_id());

-- updated_at trigger
drop trigger if exists set_updated_at_print_templates on public.print_templates;
create trigger set_updated_at_print_templates
  before update on public.print_templates
  for each row execute function public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. Thương hiệu chung — override per-branch
-- ────────────────────────────────────────────────────────────
-- NULL = kế thừa tenant brand (tenants.settings.business_info).
-- Shape: { logoUrl?, businessName?, taxCode?, address?, phone?, qrImageUrl?, bankInfo?, footer? }
alter table public.branches
  add column if not exists print_brand jsonb;

comment on column public.branches.print_brand is
  'Override Thương hiệu chung khi in cho riêng chi nhánh này (CEO 25/06/2026). NULL = kế thừa tenants.settings.business_info.';

-- ────────────────────────────────────────────────────────────
-- 4. Reload schema cache (PostgREST)
-- ────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY (chạy tay sau migration):
--   select count(*) from public.print_templates;                -- = 0 (chưa seed)
--   select column_name from information_schema.columns
--     where table_name='branches' and column_name='print_brand'; -- = print_brand
-- ============================================================
