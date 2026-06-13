-- ============================================================
-- 00143: RPC apply_coupon_atomic — atomic consume coupon + insert usage
-- (CEO BATCH 2.6 Tier 3 S-5, 13/06/2026)
--
-- VẤN ĐỀ:
--   - validate_coupon (00005) chỉ READ, không tăng used_count.
--   - Service coupons.ts chỉ có validateCoupon + getCouponUsages (READ).
--   - Không có code path nào INSERT vào coupon_usages khi cashier dùng.
--   - Hệ quả: coupon `LASTONE` với max_uses=1 dùng được VÔ HẠN lần
--     (validateCoupon thấy used_count=0 < 1 = always valid).
--
-- GIẢI PHÁP:
--   RPC PG atomic UPDATE ... WHERE check + INSERT coupon_usages. Nếu max
--   đã đạt → UPDATE 0 row → RPC raise EXCEPTION 'COUPON_EXHAUSTED'.
--
--   2 cashier race → PG row-lock ở UPDATE → 1 cái thắng + 1 cái fail rõ ràng.
--
-- CONSUMER:
--   Service applyCouponAtomic(code, invoice_id, customer_id?, discount).
--   Gọi từ POS handleComplete sau khi posCheckout / completeDraftOrder
--   success — best-effort try/catch để KHÔNG block thanh toán nếu RPC fail
--   (vd network, race lost). Log warn để dev biết coupon mất.
-- ============================================================

create or replace function public.apply_coupon_atomic(
  p_code text,
  p_invoice_id uuid,
  p_customer_id uuid default null,
  p_discount_amount numeric default 0,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_coupon_id uuid;
  v_new_used integer;
  v_max_uses integer;
  v_customer_uses integer;
  v_max_per_customer integer;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );
  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  -- Atomic consume: UPDATE + WHERE check + RETURNING. Nếu max_uses đạt
  -- → 0 row → not found.
  update public.coupons
  set used_count = used_count + 1,
      updated_at = now()
  where tenant_id = v_tenant_id
    and code = p_code
    and is_active = true
    and (start_date is null or now() >= start_date)
    and (end_date is null or now() <= end_date)
    and (max_uses is null or used_count < max_uses)
  returning id, used_count, max_uses, max_uses_per_customer
  into v_coupon_id, v_new_used, v_max_uses, v_max_per_customer;

  if not found then
    raise exception 'COUPON_EXHAUSTED'
      using detail = 'Coupon ' || p_code || ' không khả dụng (hết lượt / hết hạn / sai code).';
  end if;

  -- Check max_uses_per_customer SAU khi đã consume (rollback nếu vượt).
  -- Best-effort: nếu KH null hoặc max_per_customer null → skip.
  if p_customer_id is not null and v_max_per_customer is not null then
    select count(*) into v_customer_uses
    from public.coupon_usages
    where coupon_id = v_coupon_id and customer_id = p_customer_id;

    if v_customer_uses >= v_max_per_customer then
      -- Rollback consume
      update public.coupons
      set used_count = used_count - 1
      where id = v_coupon_id;
      raise exception 'COUPON_PER_CUSTOMER_EXCEEDED'
        using detail = 'KH đã dùng tối đa ' || v_max_per_customer || ' lần coupon này.';
    end if;
  end if;

  -- Ghi usage
  insert into public.coupon_usages (
    coupon_id, invoice_id, customer_id, discount_amount, used_at
  ) values (
    v_coupon_id, p_invoice_id, p_customer_id, coalesce(p_discount_amount, 0), now()
  );

  return jsonb_build_object(
    'ok', true,
    'coupon_id', v_coupon_id,
    'used_count', v_new_used,
    'max_uses', v_max_uses
  );
end;
$$;

comment on function public.apply_coupon_atomic(text, uuid, uuid, numeric, uuid) is
  'Atomic consume coupon (S-5 13/06/2026): UPDATE used_count + INSERT coupon_usages '
  'trong 1 transaction. Chống race khi 2 cashier dùng cùng coupon LASTONE max_uses=1.';

grant execute on function public.apply_coupon_atomic(text, uuid, uuid, numeric, uuid) to authenticated;
