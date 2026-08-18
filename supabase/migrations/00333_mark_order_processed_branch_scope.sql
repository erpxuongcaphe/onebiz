-- ============================================================================
-- 00333 — BỔ SUNG cho 00332 đã chạy trên prod: kiểm PHẠM VI CHI NHÁNH
--
-- Bản 00332 chạy trên prod 18/08/2026 thiếu 2 lớp (CEO chỉ ra):
--   1. Người gọi phải có quyền tại CHI NHÁNH của đơn (user_has_branch_access
--      — đúng chuẩn 00265; owner qua được nhờ helper; role khác PHẢI được gán chi nhánh).
--   2. Hoá đơn con gắn vào phải ĐÚNG CHI NHÁNH của đơn gốc (00331 chép
--      branch_id của gốc sang con, nên cùng-chi-nhánh là bất biến hệ thống).
--
-- 4 tình huống phải đúng sau khi chạy:
--   · Owner (role=owner)       → thao tác được mọi đơn (helper trả true)
--   · Nhân viên ĐÚNG chi nhánh → thao tác được
--   · Nhân viên KHÁC chi nhánh → chặn 42501 kèm thông báo tiếng Việt
--   · UUID khác công ty        → "Khong tim thay don dat hang" (lọc tenant)
--
-- create or replace cùng chữ ký — chạy lặp an toàn, không đổi quyền đã cấp.
-- Cuối tệp tự nhả cache schema của lớp API.
-- ============================================================================

create or replace function public.mark_order_processed(
  p_order_id uuid,
  p_invoice_id uuid default null  -- null = MỞ LẠI (gỡ gắn)
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_tenant uuid;
  v_don    record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  select p.tenant_id into v_tenant from public.profiles p
  where p.id = v_actor and p.is_active limit 1;
  if v_tenant is null then
    raise exception using errcode = '42501',
      message = 'Tai khoan chua gan cong ty hoac da bi khoa';
  end if;

  if not public.user_has_permission(v_actor, 'orders.create') then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen xu ly don dat hang.';
  end if;

  select i.id, i.source, i.deleted_at, i.branch_id into v_don
  from public.invoices i
  where i.id = p_order_id and i.tenant_id = v_tenant
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Khong tim thay don dat hang.';
  end if;
  if v_don.source <> 'order' then
    raise exception using errcode = '22023',
      message = 'Chi ap dung cho DON DAT HANG (source=order).';
  end if;
  if v_don.deleted_at is not null then
    raise exception using errcode = '22023',
      message = 'Don da bi xoa.';
  end if;

  -- Phạm vi chi nhánh (chuẩn 00265): nhân viên chỉ thao tác đơn thuộc chi
  -- nhánh mình được gán; owner qua được nhờ user_has_branch_access (00050: owner / branch_id khớp / user_branches).
  if not public.user_has_branch_access(v_actor, v_don.branch_id) then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen thao tac tai chi nhanh cua don nay.';
  end if;

  -- Hoàn tất: hoá đơn gắn vào phải cùng công ty và là ĐƠN CON của chính đơn
  -- này (source_order_id khớp) — không gắn bừa hoá đơn lạ.
  if p_invoice_id is not null and not exists (
    select 1 from public.invoices c
    where c.id = p_invoice_id
      and c.tenant_id = v_tenant
      and c.source_order_id = p_order_id
      and c.branch_id = v_don.branch_id
      and c.deleted_at is null
  ) then
    raise exception using errcode = '22023',
      message = 'Hoa don gan vao phai la don ban con cua chinh don nay.';
  end if;

  -- GHI ĐÚNG MỘT CỘT. Không status, không tiền, không gì khác.
  update public.invoices
  set fulfilled_by_id = p_invoice_id
  where id = p_order_id and tenant_id = v_tenant;

  return jsonb_build_object(
    'order_id', p_order_id,
    'fulfilled_by_id', p_invoice_id,
    'trang_thai', case when p_invoice_id is null then 'da_mo_lai' else 'da_hoan_tat' end
  );
end $$;

revoke all on function public.mark_order_processed(uuid, uuid) from public, anon;
grant execute on function public.mark_order_processed(uuid, uuid) to authenticated;

comment on function public.mark_order_processed(uuid, uuid) is
  '00332: hoan tat / mo lai xu ly don dat hang. Chi ghi fulfilled_by_id (co che 00188), khong doi status/tien. Quyen orders.create.';

-- ── Hậu kiểm ──
do $$
declare v_n int;
begin
  if to_regprocedure('public.mark_order_processed(uuid,uuid)') is null then
    raise exception '00332 that bai: thieu RPC';
  end if;
  -- Thân hàm chỉ được set MỘT cột fulfilled_by_id, cấm đụng status/total/paid.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mark_order_processed'
    and pg_get_functiondef(p.oid) ~* 'set fulfilled_by_id = p_invoice_id'
    and pg_get_functiondef(p.oid) ~* 'user_has_branch_access'
    and pg_get_functiondef(p.oid) ~* 'c\.branch_id = v_don\.branch_id'
    and pg_get_functiondef(p.oid) !~* 'set[^;]*status\s*='
    and pg_get_functiondef(p.oid) !~* 'set[^;]*total\s*='
    and pg_get_functiondef(p.oid) !~* 'set[^;]*paid\s*=';
  if v_n <> 1 then
    raise exception '00332 that bai: than ham ghi qua pham vi cho phep';
  end if;
  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema='public' and routine_name='mark_order_processed'
    and grantee='anon';
  if v_n <> 0 then
    raise exception '00332 that bai: anon van goi duoc';
  end if;
  raise notice '00332: OK - hoan tat / mo lai xu ly don dat hang da san sang';
end $$;

-- ── Nhả cache schema của lớp API ngay trong migration (khỏi chạy tay) ──
notify pgrst, 'reload schema';
