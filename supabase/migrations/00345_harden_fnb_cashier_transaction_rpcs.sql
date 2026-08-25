-- ============================================================================
-- 00345 — Khoá lớp giao dịch thu ngân F&B trước go-live
--
-- Bọc ba RPC đang chạy, không sao chép thân hàm tiền/kho:
--   1. Huỷ bill chưa thanh toán: đúng người, đúng chi nhánh, đúng ca nếu gửi ca.
--   2. Huỷ bill đã thanh toán: actor không giả mạo, hoá đơn khớp đơn bếp, đúng CN.
--   3. Thanh toán: bắt buộc ca đang mở của chính thu ngân cho lần thanh toán đầu.
--
-- Bảo toàn 00329: lớp void nội bộ vẫn gọi wrapper FIFO đã đối soát sổ lô.
-- Không cập nhật dữ liệu nghiệp vụ đang có.
-- ============================================================================

begin;

do $$
declare
  v_sig text;
  v_actual_md5 text;
begin
  foreach v_sig in array array[
    'public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)',
    'public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception using errcode = 'P0001', message = 'FNB_00345_REQUIRED_RPC_MISSING', detail = v_sig;
    end if;
  end loop;

  if to_regprocedure('public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)') is not null
     or to_regprocedure('public._fnb_void_invoice_impl_00329(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is not null
     or to_regprocedure('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)') is not null then
    raise exception using errcode = 'P0001', message = 'FNB_00345_INTERNAL_NAME_ALREADY_EXISTS';
  end if;

  select md5(pg_get_functiondef(to_regprocedure('public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)')))
    into v_actual_md5;
  if v_actual_md5 <> '98c111067f26bb274f56c541dd6d509a' then
    raise exception using errcode = 'P0001', message = 'FNB_00345_CANCEL_FINGERPRINT_CHANGED', detail = v_actual_md5;
  end if;

  select md5(pg_get_functiondef(to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)')))
    into v_actual_md5;
  if v_actual_md5 <> '7425690d872c1c7648258f8ebb1d220a' then
    raise exception using errcode = 'P0001', message = 'FNB_00345_VOID_FINGERPRINT_CHANGED', detail = v_actual_md5;
  end if;

  select md5(pg_get_functiondef(to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')))
    into v_actual_md5;
  if v_actual_md5 <> 'd6b2f919f9e5e63a231aae7ed7096452' then
    raise exception using errcode = 'P0001', message = 'FNB_00345_PAYMENT_FINGERPRINT_CHANGED', detail = v_actual_md5;
  end if;

  if to_regprocedure('public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00345_FIFO_VOID_PREREQUISITE_MISSING';
  end if;

  if exists (
    select 1
      from pg_proc p
     where p.oid in (
       to_regprocedure('public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)'),
       to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'),
       to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')
     )
       and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres')
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_00345_RPC_SECURITY_PREREQUISITE_CHANGED';
  end if;
end;
$$;

alter function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)
  rename to _fnb_cancel_unpaid_order_impl_00066;
alter function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)
  rename to _fnb_void_invoice_impl_00329;
alter function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)
  rename to _fnb_complete_payment_impl_00343;

create or replace function public.fnb_cancel_unpaid_order_atomic(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  select ko.id, ko.tenant_id, ko.branch_id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_order_id and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'KITCHEN_ORDER_NOT_FOUND';
  end if;

  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'FNB_CANCEL_BRANCH_ACCESS_DENIED';
  end if;

  if p_shift_id is not null and not exists (
    select 1
      from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_order.tenant_id
       and s.branch_id = v_order.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception using errcode = '42501', message = 'FNB_CANCEL_SHIFT_NOT_OPEN_FOR_USER_BRANCH';
  end if;

  return public._fnb_cancel_unpaid_order_impl_00066(
    p_order_id, p_reason_code, p_reason_note, p_shift_id, p_otp_id
  );
end;
$$;

create or replace function public.fnb_void_invoice_atomic(
  p_invoice_id uuid,
  p_kitchen_order_id uuid,
  p_void_reason text,
  p_voided_by uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
  v_order record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if p_tenant_id is distinct from v_tenant_id then
    raise exception using errcode = '42501', message = 'FNB_VOID_TENANT_MISMATCH';
  end if;
  if p_voided_by is distinct from v_actor then
    raise exception using errcode = '42501', message = 'FNB_VOID_ACTOR_MISMATCH';
  end if;

  select i.id, i.tenant_id, i.branch_id
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_VOID_INVOICE_NOT_FOUND';
  end if;
  if p_branch_id is distinct from v_invoice.branch_id then
    raise exception using errcode = '42501', message = 'FNB_VOID_BRANCH_MISMATCH';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'FNB_VOID_BRANCH_ACCESS_DENIED';
  end if;

  select ko.id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id
     and ko.tenant_id = v_tenant_id
     and ko.branch_id = v_invoice.branch_id
     and ko.invoice_id = v_invoice.id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_VOID_ORDER_INVOICE_MISMATCH';
  end if;

  if p_shift_id is not null and not exists (
    select 1
      from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_invoice.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception using errcode = '42501', message = 'FNB_VOID_SHIFT_NOT_OPEN_FOR_USER_BRANCH';
  end if;

  return public._fnb_void_invoice_impl_00329(
    p_invoice_id, p_kitchen_order_id, p_void_reason, p_voided_by,
    p_tenant_id, p_branch_id, p_shift_id, p_otp_id
  );
end;
$$;

create or replace function public.fnb_complete_payment_atomic_v3(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_allow_debt boolean,
  p_manual_discount_amount numeric default 0,
  p_manual_discount_otp_id uuid default null,
  p_manual_discount_reason text default null,
  p_note text default null,
  p_shift_id uuid default null,
  p_tip_amount numeric default 0,
  p_promotion_id uuid default null,
  p_coupon_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  select ko.id, ko.tenant_id, ko.branch_id, ko.invoice_id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'KITCHEN_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  -- Retry trả lại hóa đơn đã có, không sinh thêm tiền/kho và không đòi ca mới.
  if v_order.invoice_id is not null then
    return public._fnb_complete_payment_impl_00343(
      p_kitchen_order_id, p_customer_id, p_customer_name, p_payment_method,
      p_payment_breakdown, p_paid, p_allow_debt, p_manual_discount_amount,
      p_manual_discount_otp_id, p_manual_discount_reason, p_note, p_shift_id,
      p_tip_amount, p_promotion_id, p_coupon_code
    );
  end if;

  if p_shift_id is null then
    raise exception using errcode = '42501', message = 'FNB_PAYMENT_OPEN_SHIFT_REQUIRED';
  end if;
  if not exists (
    select 1
      from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_order.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception using errcode = '42501', message = 'FNB_PAYMENT_SHIFT_NOT_OPEN_FOR_USER_BRANCH';
  end if;

  return public._fnb_complete_payment_impl_00343(
    p_kitchen_order_id, p_customer_id, p_customer_name, p_payment_method,
    p_payment_breakdown, p_paid, p_allow_debt, p_manual_discount_amount,
    p_manual_discount_otp_id, p_manual_discount_reason, p_note, p_shift_id,
    p_tip_amount, p_promotion_id, p_coupon_code
  );
end;
$$;

revoke all on function public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public._fnb_void_invoice_impl_00329(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)
  from public, anon, authenticated;

revoke all on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) from public, anon;
revoke all on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text) from public, anon;
grant execute on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) to authenticated;
grant execute on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text) to authenticated;

comment on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) is
  '00345: wrapper thu ngan F&B. Khoa chi nhanh va ca cua nguoi thao tac truoc khi goi nghiep vu huy bill chua thanh toan.';
comment on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) is
  '00345: wrapper thu ngan F&B. Khoa actor, tenant, chi nhanh va lien ket hoa don-don bep; giu nguyen wrapper FIFO 00329.';
comment on function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text) is
  '00345: wrapper thu ngan F&B. Lan thanh toan dau bat buoc ca dang mo cua dung thu ngan/dung chi nhanh; retry van idempotent.';

do $$
declare
  v_sig text;
  v_def text;
  v_count integer;
begin
  foreach v_sig in array array[
    'public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)',
    'public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception using errcode = 'P0001', message = 'FNB_00345_WRAPPER_MISSING', detail = v_sig;
    end if;
    -- Quyền hiệu lực của anon đã bao gồm mọi grant từ PUBLIC.
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE')
       or has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception using errcode = 'P0001', message = 'FNB_00345_WRAPPER_GRANT_INVALID', detail = v_sig;
    end if;
  end loop;

  select pg_get_functiondef(to_regprocedure('public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)')) into v_def;
  if v_def not like '%user_has_branch_access%'
     or v_def not like '%_fnb_cancel_unpaid_order_impl_00066%'
     or v_def not like '%FNB_CANCEL_SHIFT_NOT_OPEN_FOR_USER_BRANCH%' then
    raise exception using errcode = 'P0001', message = 'FNB_00345_CANCEL_WRAPPER_INCOMPLETE';
  end if;

  select pg_get_functiondef(to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)')) into v_def;
  if v_def not like '%FNB_VOID_ACTOR_MISMATCH%'
     or v_def not like '%FNB_VOID_ORDER_INVOICE_MISMATCH%'
     or v_def not like '%_fnb_void_invoice_impl_00329%' then
    raise exception using errcode = 'P0001', message = 'FNB_00345_VOID_WRAPPER_INCOMPLETE';
  end if;

  select pg_get_functiondef(to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')) into v_def;
  if v_def not like '%FNB_PAYMENT_OPEN_SHIFT_REQUIRED%'
     or v_def not like '%_fnb_complete_payment_impl_00343%'
     or v_def not like '%v_order.invoice_id is not null%' then
    raise exception using errcode = 'P0001', message = 'FNB_00345_PAYMENT_WRAPPER_INCOMPLETE';
  end if;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       '_fnb_cancel_unpaid_order_impl_00066',
       '_fnb_void_invoice_impl_00329',
       '_fnb_complete_payment_impl_00343'
     )
     and (
          has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE')
     );
  if v_count <> 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00345_INTERNAL_RPC_EXPOSED';
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';
