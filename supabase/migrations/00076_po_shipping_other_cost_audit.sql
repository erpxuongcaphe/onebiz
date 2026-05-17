-- ============================================================
-- 00076: PO shipping_cost + other_cost separate columns + discount audit (CEO 16/05/2026)
--
-- VẤN ĐỀ Day 3:
--   1. Đơn nhập (PO): UI nhận shippingFee + otherCost nhưng DB chỉ lưu `total`
--      gộp → KT không truy vấn được "Tổng phí ship NCC tháng 5" hoặc phân
--      bổ COGS theo từng dòng phí.
--   2. Giảm giá manual (FnB + Retail) sau khi qua OTP duyệt chưa ghi audit_log
--      đầy đủ → CEO không truy vết được "ai giảm bao nhiêu cho hoá đơn nào".
--
-- FIX:
--   1. Thêm cột shipping_cost + other_cost vào purchase_orders (default 0)
--   2. Trigger audit_log discount_applied khi invoices.discount_amount > 0
--      và status flip sang completed → snapshot ai giảm, % giảm, lý do.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. purchase_orders: ship + other cost separate
-- ────────────────────────────────────────────────────────────────
alter table public.purchase_orders
  add column if not exists shipping_cost numeric(15, 2) not null default 0,
  add column if not exists other_cost numeric(15, 2) not null default 0;

comment on column public.purchase_orders.shipping_cost is
  'Chi phí vận chuyển NCC tính riêng. Cộng vào total. Báo cáo COGS phân bổ riêng theo dòng phí. CEO 16/05/2026.';
comment on column public.purchase_orders.other_cost is
  'Chi phí khác (bốc xếp, lưu kho, v.v.) — tách khỏi shipping để báo cáo chi tiết.';

-- ────────────────────────────────────────────────────────────────
-- 2. record_discount_audit RPC — ghi audit khi áp dụng discount
-- ────────────────────────────────────────────────────────────────
-- Dùng cho FnB + Retail discount override sau OTP duyệt.
-- Service layer gọi RPC sau khi apply discount thành công.
create or replace function public.record_discount_audit(
  p_invoice_id uuid,
  p_invoice_code text,
  p_invoice_total numeric,
  p_discount_amount numeric,
  p_discount_percent numeric,
  p_reason text,
  p_otp_id uuid default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_tenant_id uuid;
begin
  -- Pull tenant from invoice (defense-in-depth)
  select tenant_id into v_tenant_id
  from public.invoices
  where id = p_invoice_id;

  if v_tenant_id is null then
    raise exception 'INVOICE_NOT_FOUND: %', p_invoice_id;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'discount_applied',
    'invoice',
    p_invoice_id,
    jsonb_build_object(
      'invoice_code', p_invoice_code,
      'invoice_total', p_invoice_total,
      'discount_amount', p_discount_amount,
      'discount_percent', p_discount_percent,
      'reason', p_reason,
      'otp_id', p_otp_id,
      'applied_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'audit_recorded', true
  );
end;
$$;

comment on function public.record_discount_audit is
  'Ghi audit_log entry "discount_applied" khi cashier áp dụng giảm giá manual (đã qua OTP duyệt). CEO 16/05/2026.';

grant execute on function public.record_discount_audit(uuid, text, numeric, numeric, numeric, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
