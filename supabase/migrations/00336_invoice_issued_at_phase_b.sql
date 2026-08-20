-- ============================================================================
-- 00336 — NGÀY HOÁ ĐƠN Pha B: trigger giờ máy chủ + RPC v4/v6 — 20/08/2026
--
-- ĐÃ CHẠY PRODUCTION qua bộ vận hành SQL-CAN-CHAY/00335-PHA-B-* (20/08/2026).
-- File này là BẢN SAO để dựng môi trường mới và để kiểm tra hợp đồng RPC
-- (test recent-production-contract-audit) thấy được v4/v6.
--
-- Yêu cầu: chạy SAU 00335 (cột issued_at + checkout_client_at + ngay_chung_tu).
--
-- ⚠️ CỐ Ý KHÔNG có trong file này:
--   • Khối GUARD md5 — vân tay của riêng production, môi trường mới sẽ khác.
--   • Khối SEED quyền invoices.adjust_issued_at — dùng role_id của tenant
--     production nên chỉ nằm ở SQL-CAN-CHAY. Môi trường/tenant mới tự cấp
--     quyền này qua màn Phân quyền.
--
-- Thiết kế: v4/v6 BỌC NGOÀI v3/v5 (không chép logic tiền/kho). v4 dùng
-- advisory lock theo (tenant, phiên) + cờ `idempotent` của v3 để retry không
-- ghi đè ngày; v6 khoá dòng hoá đơn bằng SELECT ... FOR UPDATE.
-- Idempotent: chạy lặp an toàn.
-- ============================================================================

begin;

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices' and column_name='issued_at'
  ) then
    raise exception 'GUARD_00336: chưa có cột issued_at — chạy 00335 trước';
  end if;
end $guard$;

-- ── Khối 1. Trigger PHA B: phát hành = giờ máy chủ ────────────────────────
create or replace function public.trg_invoices_issued_at_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
-- 00335_PHA_B — issued_at = now() lúc phát hành (nháp cũ bán hôm nay ra ngày
-- hôm nay). Chỉ chạy khi PHÁT HÀNH, không chạy trên mọi UPDATE.
declare
  v_bypass boolean :=
    coalesce(current_setting('app.issued_at_bypass', true), '') = '1';
begin
  if not v_bypass then
    if tg_op = 'INSERT' and new.issued_at is not null then
      raise exception using errcode = '42501',
        message = 'ISSUED_AT_KHOA: không được ghi issued_at trực tiếp — dùng RPC v4/v6';
    end if;
    if tg_op = 'UPDATE' and new.issued_at is distinct from old.issued_at then
      raise exception using errcode = '42501',
        message = 'ISSUED_AT_KHOA: không được sửa issued_at trực tiếp — dùng RPC v4/v6';
    end if;
  end if;

  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and new.issued_at is null then
    new.issued_at := now();
  end if;

  return new;
end;
$$;

-- ── Khối 2. pos_complete_checkout_atomic_v4 — bọc v3 ──────────────────────
create or replace function public.pos_complete_checkout_atomic_v4(
  p_branch_id uuid,
  p_issued_at timestamptz,           -- NULL = mặc định máy chủ. Khác NULL = CHỈNH TAY.
  p_issued_reason text,              -- bắt buộc khi p_issued_at khác NULL
  p_checkout_client_at timestamptz,  -- tham khảo (offline), KHÔNG dùng kế toán
  p_customer_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'cash',
  p_payment_breakdown jsonb default null,
  p_paid numeric default 0,
  p_note text default null,
  p_source text default 'pos',
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_loyalty_points integer default 0,
  p_discount_source text default null,
  p_order_discount numeric default 0,
  p_discount_otp_id uuid default null,
  p_discount_reason text default null,
  p_shipping_fee numeric default 0,
  p_order_vat_rate numeric default 0,
  p_client_session_id text default null,
  p_allow_bom_shortage boolean default false,
  p_amount_tendered numeric default null,
  p_customer_credit numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- ISSUED_AT_00335
declare
  v_actor        uuid := auth.uid();
  v_tenant       uuid;
  v_now          timestamptz := now();
  -- Asia/Ho_Chi_Minh: hệ chưa có cấu hình timezone (preflight A08 rỗng);
  -- doanh nghiệp vận hành 100% tại Việt Nam.
  v_vn_today     date := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  v_vn_issued    date;
  v_truoc_id     uuid;
  v_result       jsonb;
  v_invoice_id   uuid;
  v_inv          record;
  v_la_retry     boolean := false;
  v_rows         int;
  v_issued_final timestamptz;
begin
  -- (6) Danh tính + tenant chốt phía máy chủ
  if v_actor is null then
    raise exception using errcode = '42501', message = 'ISSUED_AT_AUTH_REQUIRED';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ISSUED_AT_TENANT_UNKNOWN';
  end if;

  -- (2) MỌI p_issued_at khác NULL = CHỈNH TAY → quyền + lý do + trong tháng,
  -- KHÔNG có ngoại lệ "offline" tin chuỗi client gửi.
  if p_issued_at is not null then
    if not public.user_has_permission(v_actor, 'invoices.adjust_issued_at') then
      raise exception using errcode = '42501',
        message = 'ISSUED_AT_KHONG_CO_QUYEN: cần quyền invoices.adjust_issued_at để chỉnh ngày giờ hoá đơn';
    end if;
    if p_issued_reason is null or btrim(p_issued_reason) = '' then
      raise exception using errcode = '22023',
        message = 'ISSUED_AT_THIEU_LY_DO: chỉnh ngày giờ hoá đơn bắt buộc nhập lý do';
    end if;
    if p_issued_at > v_now + interval '5 minutes' then
      raise exception using errcode = '22007',
        message = 'ISSUED_AT_TUONG_LAI: không được quá hiện tại 5 phút';
    end if;
    v_vn_issued := (p_issued_at at time zone 'Asia/Ho_Chi_Minh')::date;
    if date_trunc('month', v_vn_issued) <> date_trunc('month', v_vn_today) then
      raise exception using errcode = '22007',
        message = 'ISSUED_AT_NGOAI_THANG: chỉ được chỉnh trong tháng hiện tại';
    end if;
  end if;

  -- (1) RACE: khoá theo (tenant, phiên) NGAY TRƯỚC bước kiểm retry. Hai yêu
  -- cầu cùng phiên bị xếp hàng — cái sau chỉ chạy tiếp khi cái trước xong
  -- transaction, nên chắc chắn thấy hoá đơn completed của cái trước.
  if p_client_session_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant::text || '|' || p_client_session_id, 0)
    );

    select i.id into v_truoc_id
    from public.invoices i
    where i.tenant_id = v_tenant
      and i.client_session_id = p_client_session_id
      and i.status = 'completed'
      and i.deleted_at is null
    limit 1;
  end if;

  -- Nghiệp vụ chính: bản v3 đang chạy, KHÔNG chép logic tiền/kho.
  v_result := public.pos_complete_checkout_atomic_v3(
    p_branch_id, p_customer_id, p_items, p_payment_method, p_payment_breakdown,
    p_paid, p_note, p_source, p_shift_id, p_promotion_id, p_coupon_code,
    p_loyalty_points, p_discount_source, p_order_discount, p_discount_otp_id,
    p_discount_reason, p_shipping_fee, p_order_vat_rate, p_client_session_id,
    p_allow_bom_shortage, p_amount_tendered, p_customer_credit
  );
  v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
  if v_invoice_id is null then
    raise exception using errcode = 'P0001',
      message = 'ISSUED_AT_KHONG_CO_INVOICE_ID: v3 không trả invoice_id';
  end if;

  -- (1) Hai bằng chứng độc lập cho "đây KHÔNG phải lần phát hành đầu":
  --   a. cờ 'idempotent' do CHÍNH v3 trả về khi nó trả lại hoá đơn cũ;
  --   b. bước kiểm trước đó đã thấy hoá đơn completed cùng phiên.
  v_la_retry := coalesce((v_result->>'idempotent')::boolean, false)
                or (v_truoc_id is not null and v_truoc_id = v_invoice_id);

  -- (3)(6) Đọc hoá đơn thực — khoá tenant, kiểm trạng thái và quyền chi nhánh
  select i.issued_at, i.branch_id, i.status, i.checkout_client_at
  into v_inv
  from public.invoices i
  where i.id = v_invoice_id and i.tenant_id = v_tenant;
  if not found then
    raise exception using errcode = '42501',
      message = 'ISSUED_AT_SAI_TENANT: hoá đơn không thuộc tenant hiện tại';
  end if;
  if v_inv.status <> 'completed' then
    raise exception using errcode = 'P0001',
      message = 'ISSUED_AT_CHUA_COMPLETED: hoá đơn chưa hoàn thành sau checkout';
  end if;
  if not public.user_has_branch_access(v_actor, v_inv.branch_id) then
    raise exception using errcode = '42501',
      message = 'ISSUED_AT_SAI_CHI_NHANH: không có quyền chi nhánh của hoá đơn';
  end if;

  -- (2) Ghi CHỈ ở lần phát hành ĐẦU TIÊN. Retry: giữ nguyên, không audit lại.
  if not v_la_retry and (p_issued_at is not null or p_checkout_client_at is not null) then
    perform set_config('app.issued_at_bypass', '1', true);
    update public.invoices
    set issued_at          = coalesce(p_issued_at, issued_at),
        checkout_client_at = coalesce(p_checkout_client_at, checkout_client_at)
    where id = v_invoice_id
      and tenant_id = v_tenant
      and status = 'completed';
    get diagnostics v_rows = row_count;
    perform set_config('app.issued_at_bypass', '', true);
    if v_rows = 0 then
      raise exception using errcode = 'P0001',
        message = 'ISSUED_AT_UPDATE_0_DONG: không ghi được ngày hoá đơn';
    end if;

    -- (7) Audit MỌI lần chỉnh tay (kể cả cùng ngày); old = giá trị THỰC trước
    -- khi đổi. Cùng transaction — audit lỗi thì cả thao tác rollback.
    if p_issued_at is not null then
      insert into public.audit_log
        (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
      values
        (v_tenant, v_actor, 'adjust_issued_at', 'invoice', v_invoice_id,
         jsonb_build_object('issued_at', v_inv.issued_at),
         jsonb_build_object('issued_at', p_issued_at,
                            'ly_do', p_issued_reason,
                            'checkout_client_at', p_checkout_client_at,
                            'nguon', 'pos_complete_checkout_atomic_v4'));
    end if;
  end if;

  -- (3) Trả GIÁ TRỊ ĐÃ LƯU THẬT SỰ
  select i.issued_at into v_issued_final
  from public.invoices i
  where i.id = v_invoice_id and i.tenant_id = v_tenant;

  return v_result || jsonb_build_object(
    'issued_at', v_issued_final,
    'issued_at_retry', v_la_retry
  );
end;
$$;

revoke all on function public.pos_complete_checkout_atomic_v4(uuid,timestamptz,text,timestamptz,uuid,jsonb,text,jsonb,numeric,text,text,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,text,boolean,numeric,numeric) from public, anon;
grant execute on function public.pos_complete_checkout_atomic_v4(uuid,timestamptz,text,timestamptz,uuid,jsonb,text,jsonb,numeric,text,text,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,text,boolean,numeric,numeric) to authenticated;

-- ── Khối 3. complete_draft_atomic_v6 — bọc v5 ─────────────────────────────
-- LƯU Ý: complete_draft_atomic_v4 là hàm CÓ SẴN của hệ (v5 gọi nó) — v6 KHÔNG
-- đụng tới, chỉ bọc NGOÀI v5.
create or replace function public.complete_draft_atomic_v6(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_method text,
  p_paid numeric,
  p_issued_at timestamptz,
  p_issued_reason text,
  p_checkout_client_at timestamptz,
  p_payment_breakdown jsonb default null,
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_loyalty_points integer default 0,
  p_discount_source text default null,
  p_order_discount numeric default 0,
  p_discount_otp_id uuid default null,
  p_discount_reason text default null,
  p_shipping_fee numeric default 0,
  p_order_vat_rate numeric default 0,
  p_allow_bom_shortage boolean default false,
  p_amount_tendered numeric default null,
  p_customer_credit numeric default 0,
  p_client_session_id text default null,
  p_expected_revision bigint default null,
  p_expected_total numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- ISSUED_AT_00335
declare
  v_actor        uuid := auth.uid();
  v_tenant       uuid;
  v_now          timestamptz := now();
  v_vn_today     date := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  v_vn_issued    date;
  v_truoc        record;
  v_result       jsonb;
  v_inv          record;
  v_la_retry     boolean := false;
  v_rows         int;
  v_issued_final timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'ISSUED_AT_AUTH_REQUIRED';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ISSUED_AT_TENANT_UNKNOWN';
  end if;

  if p_issued_at is not null then
    if not public.user_has_permission(v_actor, 'invoices.adjust_issued_at') then
      raise exception using errcode = '42501',
        message = 'ISSUED_AT_KHONG_CO_QUYEN: cần quyền invoices.adjust_issued_at để chỉnh ngày giờ hoá đơn';
    end if;
    if p_issued_reason is null or btrim(p_issued_reason) = '' then
      raise exception using errcode = '22023',
        message = 'ISSUED_AT_THIEU_LY_DO: chỉnh ngày giờ hoá đơn bắt buộc nhập lý do';
    end if;
    if p_issued_at > v_now + interval '5 minutes' then
      raise exception using errcode = '22007',
        message = 'ISSUED_AT_TUONG_LAI: không được quá hiện tại 5 phút';
    end if;
    v_vn_issued := (p_issued_at at time zone 'Asia/Ho_Chi_Minh')::date;
    if date_trunc('month', v_vn_issued) <> date_trunc('month', v_vn_today) then
      raise exception using errcode = '22007',
        message = 'ISSUED_AT_NGOAI_THANG: chỉ được chỉnh trong tháng hiện tại';
    end if;
  end if;

  -- (1) RACE: khoá DÒNG hoá đơn (cùng loại khoá v5 dùng bên trong) trước khi
  -- kiểm retry → hai yêu cầu cùng hoá đơn xếp hàng, không cùng thấy "draft".
  select i.status, i.branch_id into v_truoc
  from public.invoices i
  where i.id = p_invoice_id and i.tenant_id = v_tenant and i.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'ISSUED_AT_SAI_TENANT: hoá đơn không thuộc tenant hiện tại';
  end if;
  if not public.user_has_branch_access(v_actor, v_truoc.branch_id) then
    raise exception using errcode = '42501',
      message = 'ISSUED_AT_SAI_CHI_NHANH: không có quyền chi nhánh của hoá đơn';
  end if;
  v_la_retry := (v_truoc.status = 'completed');

  v_result := public.complete_draft_atomic_v5(
    p_invoice_id, p_customer_id, p_items, p_method, p_paid, p_payment_breakdown,
    p_shift_id, p_promotion_id, p_coupon_code, p_loyalty_points, p_discount_source,
    p_order_discount, p_discount_otp_id, p_discount_reason, p_shipping_fee,
    p_order_vat_rate, p_allow_bom_shortage, p_amount_tendered, p_customer_credit,
    p_client_session_id, p_expected_revision, p_expected_total
  );

  select i.issued_at, i.status into v_inv
  from public.invoices i
  where i.id = p_invoice_id and i.tenant_id = v_tenant;
  if not found then
    raise exception using errcode = '42501',
      message = 'ISSUED_AT_SAI_TENANT: hoá đơn biến mất sau hoàn tất — bất thường';
  end if;
  if v_inv.status <> 'completed' then
    raise exception using errcode = 'P0001',
      message = 'ISSUED_AT_CHUA_COMPLETED: hoá đơn chưa hoàn thành sau xử lý';
  end if;

  if not v_la_retry and (p_issued_at is not null or p_checkout_client_at is not null) then
    perform set_config('app.issued_at_bypass', '1', true);
    update public.invoices
    set issued_at          = coalesce(p_issued_at, issued_at),
        checkout_client_at = coalesce(p_checkout_client_at, checkout_client_at)
    where id = p_invoice_id
      and tenant_id = v_tenant
      and status = 'completed';
    get diagnostics v_rows = row_count;
    perform set_config('app.issued_at_bypass', '', true);
    if v_rows = 0 then
      raise exception using errcode = 'P0001',
        message = 'ISSUED_AT_UPDATE_0_DONG: không ghi được ngày hoá đơn';
    end if;

    if p_issued_at is not null then
      insert into public.audit_log
        (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
      values
        (v_tenant, v_actor, 'adjust_issued_at', 'invoice', p_invoice_id,
         jsonb_build_object('issued_at', v_inv.issued_at),
         jsonb_build_object('issued_at', p_issued_at,
                            'ly_do', p_issued_reason,
                            'checkout_client_at', p_checkout_client_at,
                            'nguon', 'complete_draft_atomic_v6'));
    end if;
  end if;

  select i.issued_at into v_issued_final
  from public.invoices i
  where i.id = p_invoice_id and i.tenant_id = v_tenant;

  return v_result || jsonb_build_object(
    'issued_at', v_issued_final,
    'issued_at_retry', v_la_retry
  );
end;
$$;

revoke all on function public.complete_draft_atomic_v6(uuid,uuid,jsonb,text,numeric,timestamptz,text,timestamptz,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric,text,bigint,numeric) from public, anon;
grant execute on function public.complete_draft_atomic_v6(uuid,uuid,jsonb,text,numeric,timestamptz,text,timestamptz,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric,text,bigint,numeric) to authenticated;

commit;

notify pgrst, 'reload schema';
