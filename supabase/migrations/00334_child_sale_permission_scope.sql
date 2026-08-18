-- ============================================================================
-- 00334 — BỔ SUNG cho 00331 đã chạy trên prod: QUYỀN NGHIỆP VỤ + CHI NHÁNH
--
-- Bản 00331 chạy prod 17/08/2026 thiếu (CEO chỉ ra 18/08): mọi authenticated
-- user cùng công ty gọi thẳng RPC tạo đơn con được. Bổ sung 2 lớp:
--   1. Quyền nghiệp vụ: pos_retail.checkout HOẶC orders.create — một RPC
--      phục vụ hai cửa (POS + màn quản lý đơn), có một trong hai là đủ.
--      (Ma trận 00115: checkout và save_draft seed cùng vai trò — không có
--      vai trò nào lọt khe giữa hai quyền POS.)
--   2. Phạm vi chi nhánh: user_has_branch_access với branch_id của ĐƠN GỐC
--      (chuẩn 00265; helper 00050 = owner / branch_id khớp / user_branches).
--   3. "Không tồn tại" và "khác công ty" gộp thành MỘT lỗi mờ 42501 — không
--      cho dò id chéo công ty.
--
-- Hậu kiểm bắt buộc: thân hàm có đủ 2 gate; authenticated giữ EXECUTE;
-- anon/PUBLIC không có. Không đổi dữ liệu. create or replace cùng chữ ký —
-- chạy lặp an toàn. Cuối tệp tự nhả cache schema của lớp API.
-- ============================================================================

-- ── RPC tạo đơn bán con (create or replace, cùng chữ ký) ──
create or replace function public.create_child_sale_from_order(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_tenant_id  uuid;
  v_parent     record;
  v_child_id   uuid;
  v_child_code text;
  v_session_id uuid := gen_random_uuid();
  v_item_count int;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and p.is_active
  limit 1;
  if v_tenant_id is null then
    raise exception using errcode = '42501',
      message = 'Tai khoan chua gan cong ty hoac da bi khoa';
  end if;

  -- Quyền nghiệp vụ: một RPC phục vụ HAI cửa — thu ngân POS (pos_retail.
  -- checkout) và người xử lý đơn đặt hàng (orders.create). Có MỘT trong hai
  -- là đủ; không có cả hai thì chặn.
  if not (public.user_has_permission(v_actor, 'pos_retail.checkout')
       or public.user_has_permission(v_actor, 'orders.create')) then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen tao don ban (can quyen thanh toan POS hoac tao don dat hang).';
  end if;

  -- Đơn gốc: khóa CHIA SẺ (for share) — chặn xóa/hủy chen ngang nhưng nhiều
  -- tab tạo đơn con CÙNG LÚC vẫn chạy song song được, không xếp hàng.
  select i.id, i.tenant_id, i.branch_id, i.code, i.customer_id, i.customer_name,
         i.subtotal, i.discount_amount, i.tax_amount, i.delivery_fee, i.total,
         i.payment_method, i.note, i.status, i.source, i.deleted_at
    into v_parent
    from public.invoices i
   where i.id = p_order_id
     and i.tenant_id = v_tenant_id
   for share;

  if not found then
    -- Gộp "không tồn tại" và "khác công ty" vào MỘT lỗi mờ — không cho phân
    -- biệt để dò id chéo công ty.
    raise exception using errcode = '42501',
      message = 'Khong tim thay don dat hang hoac ban khong co quyen truy cap.';
  end if;
  if v_parent.source <> 'order' then
    raise exception using errcode = '22023',
      message = 'Chi tao duoc don ban con tu DON DAT HANG (source=order).';
  end if;
  if v_parent.deleted_at is not null then
    raise exception using errcode = '22023',
      message = 'Don dat hang da bi xoa - khong tao don ban con duoc.';
  end if;
  if v_parent.status = 'cancelled' then
    raise exception using errcode = '22023',
      message = 'Don dat hang da huy - khong tao don ban con duoc.';
  end if;

  -- Phạm vi chi nhánh (chuẩn 00265): owner qua được nhờ helper 00050; role
  -- khác PHẢI được gán chi nhánh của đơn.
  if not public.user_has_branch_access(v_actor, v_parent.branch_id) then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen thao tac tai chi nhanh cua don nay.';
  end if;

  -- Bộ cột Y HỆT nháp POS chuẩn (00264) + source_order_id. Mã dãy NH chung
  -- với nháp thường; draft_revision để default 0 cho guard 00292/00293.
  -- auto_saved=false BẮT BUỘC: nháp auto_saved bị cleanup_expired_auto_drafts
  -- dọn định kỳ (bài học mất đơn 00173).
  v_child_code := public.next_code(v_tenant_id, 'pos_draft');
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
    payment_method, note, source, created_by, client_session_id, auto_saved,
    source_order_id
  ) values (
    v_tenant_id, v_parent.branch_id, v_child_code, v_parent.customer_id,
    v_parent.customer_name, 'draft',
    v_parent.subtotal, v_parent.discount_amount, v_parent.tax_amount,
    v_parent.delivery_fee, v_parent.total, 0, v_parent.total,
    coalesce(v_parent.payment_method, 'cash'), v_parent.note, 'pos',
    v_actor, v_session_id, false,
    v_parent.id
  ) returning id into v_child_id;

  -- Chép mặt hàng theo đơn gốc (thu ngân sửa thoải mái sau khi nạp vào POS).
  -- returned_qty KHÔNG chép — đơn bán mới chưa có trả hàng.
  insert into public.invoice_items (
    invoice_id, product_id, product_name, quantity, unit,
    unit_price, unit_cost, discount, total, note,
    vat_rate, vat_amount, variant_id
  )
  select v_child_id, ii.product_id, ii.product_name, ii.quantity, ii.unit,
         ii.unit_price, ii.unit_cost, ii.discount, ii.total, ii.note,
         ii.vat_rate, ii.vat_amount, ii.variant_id
    from public.invoice_items ii
   where ii.invoice_id = v_parent.id;
  get diagnostics v_item_count = row_count;

  return jsonb_build_object(
    'child_id', v_child_id,
    'child_code', v_child_code,
    'client_session_id', v_session_id::text,
    'draft_revision', 0,
    'item_count', v_item_count,
    'source_order_id', v_parent.id,
    'source_order_code', v_parent.code
  );
end $$;

-- ── 3. Quyền ──
revoke all on function public.create_child_sale_from_order(uuid) from public, anon;
grant execute on function public.create_child_sale_from_order(uuid) to authenticated;

comment on function public.create_child_sale_from_order(uuid) is
  '00331+00334: tao don ban con tu don dat hang goc. Gate: pos_retail.checkout HOAC orders.create + user_has_branch_access voi chi nhanh don goc. KHONG dung don goc. Khong gioi han so don con.';

-- ── 4. Hậu kiểm ngay trong migration ──
do $$
declare
  v_n int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'source_order_id'
  ) then
    raise exception '00334 that bai: chua co cot source_order_id';
  end if;

  if to_regprocedure('public.create_child_sale_from_order(uuid)') is null then
    raise exception '00334 that bai: chua co RPC create_child_sale_from_order';
  end if;

  -- Thân hàm KHÔNG được UPDATE/DELETE invoices — đơn gốc bất khả xâm phạm.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_child_sale_from_order'
    and (pg_get_functiondef(p.oid) ~* 'update\s+public\.invoices'
      or pg_get_functiondef(p.oid) ~* 'delete\s+from\s+public\.invoices');
  if v_n <> 0 then
    raise exception '00334 that bai: RPC dang sua/xoa invoices - cam';
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_child_sale_from_order'
    and pg_get_functiondef(p.oid) ~* 'pos_retail\.checkout'
    and pg_get_functiondef(p.oid) ~* 'orders\.create'
    and pg_get_functiondef(p.oid) ~* 'user_has_branch_access';
  if v_n <> 1 then
    raise exception '00334 that bai: thieu gate quyen nghiep vu hoac pham vi chi nhanh';
  end if;

  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'create_child_sale_from_order'
    and grantee = 'anon';
  if v_n <> 0 then
    raise exception '00334 that bai: anon van goi duoc RPC';
  end if;


  -- authenticated PHẢI còn EXECUTE; PUBLIC không được có.
  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'create_child_sale_from_order'
    and grantee = 'authenticated' and privilege_type = 'EXECUTE';
  if v_n < 1 then
    raise exception '00334 that bai: authenticated mat quyen EXECUTE';
  end if;
  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'create_child_sale_from_order'
    and grantee = 'PUBLIC';
  if v_n <> 0 then
    raise exception '00334 that bai: PUBLIC van goi duoc';
  end if;
  raise notice '00334: OK - cot source_order_id + RPC tao don con da san sang';
end $$;

-- ── Nhả cache schema của lớp API ──
notify pgrst, 'reload schema';
