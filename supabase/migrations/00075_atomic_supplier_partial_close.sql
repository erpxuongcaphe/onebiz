-- ============================================================
-- 00075: Atomic delete supplier + Partial close PO (CEO 16/05/2026)
--
-- VẤN ĐỀ phát hiện audit Day 2:
--   1. deleteSupplier hiện chỉ DELETE phẳng, không check FK
--      → có thể fail mid-flow nếu còn purchase_orders/products tham chiếu
--      → orphan supplier_name lưu trong invoice không reproduce được
--   2. Đơn nhập (PO) chỉ có 2 cách kết thúc:
--        a. Nhận đủ (status='completed')
--        b. Huỷ toàn bộ (status='cancelled')
--      → Thiếu "đóng đơn còn thiếu" — VD đặt 10 chai nhưng NCC giao 7,
--        muốn đóng PO ở trạng thái "đã nhận 7, thôi không nhận 3 còn lại"
--        mà KHÔNG mất audit 7 chai đã nhận.
--
-- FIX:
--   1. RPC delete_supplier_atomic — pre-check 3 bảng (purchase_orders,
--      products, supplier_returns) trước khi DELETE; báo lỗi user-friendly
--   2. Thêm cột purchase_orders.closed_short BOOLEAN + close_reason TEXT
--   3. RPC close_purchase_order_short — chuyển 'partial' → 'completed'
--      kèm closed_short=true + reason; ghi audit log
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. delete_supplier_atomic — guard FK + audit
-- ────────────────────────────────────────────────────────────────
create or replace function public.delete_supplier_atomic(
  p_supplier_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_supplier record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_po_count int := 0;
  v_product_count int := 0;
  v_return_count int := 0;
begin
  -- Lock row + load snapshot
  select * into v_supplier
  from public.suppliers
  where id = p_supplier_id
  for update;

  if not found then
    raise exception 'SUPPLIER_NOT_FOUND: %', p_supplier_id;
  end if;

  -- Check FK: purchase_orders
  select count(*) into v_po_count
  from public.purchase_orders
  where supplier_id = p_supplier_id;

  if v_po_count > 0 then
    raise exception 'SUPPLIER_HAS_PURCHASE_ORDERS: NCC "%" có % đơn nhập liên quan — không thể xoá. Vui lòng xoá/huỷ các đơn nhập trước.', v_supplier.name, v_po_count;
  end if;

  -- Check FK: products (default supplier)
  select count(*) into v_product_count
  from public.products
  where supplier_id = p_supplier_id;

  if v_product_count > 0 then
    raise exception 'SUPPLIER_HAS_PRODUCTS: NCC "%" đang là NCC mặc định của % sản phẩm — vui lòng đổi NCC cho các SP này trước.', v_supplier.name, v_product_count;
  end if;

  -- Check FK: supplier_returns
  select count(*) into v_return_count
  from public.supplier_returns
  where supplier_id = p_supplier_id;

  if v_return_count > 0 then
    raise exception 'SUPPLIER_HAS_RETURNS: NCC "%" có % phiếu trả hàng — không thể xoá.', v_supplier.name, v_return_count;
  end if;

  -- Audit log BEFORE delete
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data
  ) values (
    v_supplier.tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'delete',
    'supplier',
    p_supplier_id,
    jsonb_build_object(
      'code', v_supplier.code,
      'name', v_supplier.name,
      'phone', v_supplier.phone,
      'email', v_supplier.email,
      'tax_code', v_supplier.tax_code
    )
  );

  -- Delete
  delete from public.suppliers where id = p_supplier_id;

  return jsonb_build_object(
    'success', true,
    'supplier_id', p_supplier_id,
    'code', v_supplier.code,
    'name', v_supplier.name
  );
end;
$$;

comment on function public.delete_supplier_atomic is
  'Xoá NCC ATOMIC: pre-check 3 bảng FK (PO, products, returns) + audit snapshot + delete trong 1 transaction. CEO 16/05/2026.';

grant execute on function public.delete_supplier_atomic(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. Thêm cột closed_short + close_reason vào purchase_orders
-- ────────────────────────────────────────────────────────────────
alter table public.purchase_orders
  add column if not exists closed_short boolean not null default false,
  add column if not exists close_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid;

comment on column public.purchase_orders.closed_short is
  'TRUE = đã đóng đơn còn thiếu (status=completed với items chưa nhận đủ). FALSE = nhận đủ hoặc đang xử lý.';
comment on column public.purchase_orders.close_reason is
  'Lý do đóng đơn còn thiếu (bắt buộc khi closed_short=true). VD: "NCC hết hàng", "Đã đổi NCC khác".';

-- ────────────────────────────────────────────────────────────────
-- 3. close_purchase_order_short — đóng đơn còn thiếu
-- ────────────────────────────────────────────────────────────────
create or replace function public.close_purchase_order_short(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_received_count int := 0;
  v_remaining_count int := 0;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'INVALID_REASON: Lý do đóng đơn tối thiểu 5 ký tự.';
  end if;

  -- Lock + check status
  select * into v_order
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'PO_NOT_FOUND: %', p_order_id;
  end if;

  if v_order.status not in ('partial', 'ordered') then
    raise exception 'INVALID_STATUS: PO đang ở trạng thái "%" — chỉ có thể đóng đơn partial hoặc ordered.', v_order.status;
  end if;

  -- Đếm số items đã/chưa nhận đủ (informational)
  select
    count(*) filter (where coalesce(received_quantity, 0) >= quantity),
    count(*) filter (where coalesce(received_quantity, 0) < quantity)
  into v_received_count, v_remaining_count
  from public.purchase_order_items
  where order_id = p_order_id;

  -- Flip status
  update public.purchase_orders
  set status = 'completed',
      closed_short = true,
      close_reason = trim(p_reason),
      closed_at = now(),
      closed_by = v_actor,
      updated_at = now()
  where id = p_order_id;

  -- Audit log
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_order.tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'close_short',
    'purchase_order',
    p_order_id,
    jsonb_build_object(
      'code', v_order.code,
      'previous_status', v_order.status,
      'reason', trim(p_reason),
      'items_received_fully', v_received_count,
      'items_remaining', v_remaining_count,
      'closed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'code', v_order.code,
    'items_received_fully', v_received_count,
    'items_remaining', v_remaining_count
  );
end;
$$;

comment on function public.close_purchase_order_short is
  'Đóng đơn nhập còn thiếu: status partial/ordered → completed kèm closed_short=true + lý do. Audit log đầy đủ. CEO 16/05/2026.';

grant execute on function public.close_purchase_order_short(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
