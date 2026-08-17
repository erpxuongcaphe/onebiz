-- ============================================================================
-- 00331 — Đơn bán con từ đơn đặt hàng: quan hệ MỘT-NHIỀU + RPC tạo đơn con
--
-- HIỆN TRẠNG (đọc mã + schema prod 17/08/2026):
--   • POS "Xử lý đặt hàng" nạp THẲNG đơn gốc vào giỏ (pos/page.tsx:253
--     applyDraftToActiveTab → state.loadDraft(detail) với detail.id = đơn gốc).
--   • Thanh toán (complete_draft_atomic_v5) UPDATE chính bản ghi đang mở
--     → đơn đặt hàng gốc BIẾN THÀNH hóa đơn, không giữ lại để đối chiếu.
--   • fulfilled_by_id (00188) là 1 cột uuid → chỉ trỏ được MỘT hóa đơn.
--   • 2 tab mở cùng đơn dùng chung client_session_id → lưu sau đè lưu trước.
--
-- 00331 làm (THÊM MỚI, không sửa hành vi cũ):
--   1. Cột invoices.source_order_id — đơn bán con trỏ về đơn đặt hàng gốc.
--      Quan hệ một-nhiều: một đơn gốc → không giới hạn đơn con.
--   2. RPC create_child_sale_from_order — TẠO BẢN GHI MỚI (id mới, mã NH mới,
--      client_session_id mới, chép mặt hàng) và KHÔNG đụng một byte nào của
--      đơn gốc. Không update, không đổi status, không ghi fulfilled_by_id.
--
-- CHỦ ĐÍCH KHÔNG chặn (CEO chốt 17/08):
--   • KHÔNG giới hạn số đơn con.
--   • KHÔNG so số lượng bán với số lượng đặt (bán vượt là nghiệp vụ bình thường).
--   • KHÔNG chặn khi đơn gốc đã có fulfilled_by_id hay đã "hoàn tất xử lý"
--     — thực tế phát sinh thì tạo thêm.
--   Chỉ chặn: đơn gốc không tồn tại / sai công ty / không phải đơn đặt hàng
--   (source <> 'order') / đã hủy / đã xóa mềm.
--
-- Tương thích ngược: cột nullable, dữ liệu cũ không có source_order_id chạy y
-- như trước; fulfilled_by_id giữ nguyên, không nắn dữ liệu lịch sử.
-- Chạy lặp an toàn. Rollback: 00331_rollback_child_sales_source_order.sql
-- ============================================================================

-- ── 1. Cột quan hệ một-nhiều ──
alter table public.invoices
  add column if not exists source_order_id uuid references public.invoices(id);

comment on column public.invoices.source_order_id is
  '00331: don ban con tro ve don dat hang goc (source=order). Mot don goc -> nhieu don con. Null = hoa don thuong.';

-- Chỉ mục một phía (đa số hóa đơn không phải đơn con) để đối chiếu nhanh.
create index if not exists idx_invoices_source_order_id
  on public.invoices (source_order_id)
  where source_order_id is not null;

-- ── 2. RPC tạo đơn bán con ──
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
    raise exception using errcode = 'P0002',
      message = 'Khong tim thay don dat hang hoac don khong thuoc cong ty nay.';
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
  '00331: tao don ban con (nhap POS moi, ma NH moi, session moi, chep mat hang) tu don dat hang goc. KHONG dung don goc. Khong gioi han so don con.';

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
    raise exception '00331 that bai: chua co cot source_order_id';
  end if;

  if to_regprocedure('public.create_child_sale_from_order(uuid)') is null then
    raise exception '00331 that bai: chua co RPC create_child_sale_from_order';
  end if;

  -- Thân hàm KHÔNG được UPDATE/DELETE invoices — đơn gốc bất khả xâm phạm.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_child_sale_from_order'
    and (pg_get_functiondef(p.oid) ~* 'update\s+public\.invoices'
      or pg_get_functiondef(p.oid) ~* 'delete\s+from\s+public\.invoices');
  if v_n <> 0 then
    raise exception '00331 that bai: RPC dang sua/xoa invoices - cam';
  end if;

  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'create_child_sale_from_order'
    and grantee = 'anon';
  if v_n <> 0 then
    raise exception '00331 that bai: anon van goi duoc RPC';
  end if;

  raise notice '00331: OK - cot source_order_id + RPC tao don con da san sang';
end $$;
