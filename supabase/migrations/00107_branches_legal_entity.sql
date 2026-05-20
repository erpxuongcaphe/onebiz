-- ============================================================
-- 00107: Thông tin pháp nhân cho chi nhánh (CEO 20/05/2026)
--
-- CEO chuỗi cà phê có thể có nhiều pháp nhân:
--   - Công ty TNHH OneBiz (3 quán FnB)
--   - Hộ kinh doanh Quán Sài Gòn (1 chi nhánh kho)
--   - Doanh nghiệp tư nhân Xưởng Rang (1 xưởng)
--
-- Mỗi chi nhánh thuộc 1 pháp nhân — cần biết:
--   - Loại pháp nhân (công ty / hộ KD / DNTN / cá nhân)
--   - Tên pháp nhân (in hoá đơn)
--   - MST của pháp nhân (xuất hoá đơn VAT)
--   - Số đăng ký kinh doanh (ĐKKD) — optional
-- ============================================================

alter table public.branches
  add column if not exists legal_entity_type text,
  add column if not exists legal_entity_name text,
  add column if not exists legal_tax_code text,
  add column if not exists legal_registration_no text;

-- Check constraint: enum cho legal_entity_type
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branches_legal_entity_type_check'
  ) then
    alter table public.branches
      add constraint branches_legal_entity_type_check
      check (
        legal_entity_type is null
        or legal_entity_type in (
          'company',         -- Công ty (TNHH, CP, ...)
          'household',       -- Hộ kinh doanh
          'sole_proprietorship', -- Doanh nghiệp tư nhân
          'individual'       -- Cá nhân
        )
      );
  end if;
end $$;

-- Comments
comment on column public.branches.legal_entity_type is
  'CEO 20/05/2026: Loại pháp nhân của chi nhánh. company=Công ty (TNHH/CP), household=Hộ kinh doanh, sole_proprietorship=DNTN, individual=Cá nhân. NULL = chưa khai báo.';

comment on column public.branches.legal_entity_name is
  'Tên pháp nhân đầy đủ (vd "Công ty TNHH OneBiz", "Hộ kinh doanh Quán Sài Gòn"). In trên hoá đơn VAT.';

comment on column public.branches.legal_tax_code is
  'Mã số thuế của pháp nhân (10 số hoặc 10-3 chi nhánh). Không validate format (CEO 18/05: bỏ regex chặn).';

comment on column public.branches.legal_registration_no is
  'Số đăng ký kinh doanh / Giấy phép kinh doanh. Optional.';

-- Index để filter chi nhánh theo pháp nhân
create index if not exists idx_branches_legal_tax_code
  on public.branches(tenant_id, legal_tax_code)
  where legal_tax_code is not null;

-- Reload schema cache
notify pgrst, 'reload schema';
