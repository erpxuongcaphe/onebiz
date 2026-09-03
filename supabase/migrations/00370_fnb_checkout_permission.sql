-- ============================================================================
-- 00370 - Tach quyen nhan mon/gui bep khoi quyen mo ca/thu tien FnB.
--
-- Phuc vu van dung POS de chon ban, nhan mon va gui bep. Chi Thu ngan,
-- Quan ly, Admin va Chu cua hang duoc mo ca va chot thanh toan.
-- ============================================================================

insert into public.role_permissions (role_id, permission_code)
select r.id, 'pos_fnb.checkout'
from public.roles r
where r.name in ('Chu cua hang', 'Chủ cửa hàng', 'Admin', 'Quan ly', 'Quản lý', 'Thu ngan F&B', 'Thu ngân F&B')
on conflict (role_id, permission_code) do nothing;

-- Giu nguyen nghiep vu thanh toan da duoc harden o 00345, boc them mot lop
-- quyen nho de khong sao chep lai logic tien, kho va hoa don.
do $$
begin
  if to_regprocedure('public._fnb_complete_payment_checkout_impl_00345(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)') is null then
    if to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)') is null then
      raise exception '00370 dung: khong tim thay fnb_complete_payment_atomic_v3 dung chu ky';
    end if;
    alter function public.fnb_complete_payment_atomic_v3(
      uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
    ) rename to _fnb_complete_payment_checkout_impl_00345;
  end if;
end $$;

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
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.checkout') then
    raise exception using errcode = '42501', message = 'FNB_CHECKOUT_DENIED';
  end if;

  return public._fnb_complete_payment_checkout_impl_00345(
    p_kitchen_order_id, p_customer_id, p_customer_name, p_payment_method,
    p_payment_breakdown, p_paid, p_allow_debt, p_manual_discount_amount,
    p_manual_discount_otp_id, p_manual_discount_reason, p_note, p_shift_id,
    p_tip_amount, p_promotion_id, p_coupon_code
  );
end;
$$;

revoke all on function public._fnb_complete_payment_checkout_impl_00345(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) from public, anon, authenticated;
revoke all on function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) from public, anon;
grant execute on function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) to authenticated;

-- Mo ca cung la nghiep vu thu ngan. Boc ham da on dinh o 00298.
do $$
begin
  if to_regprocedure('public._open_shift_checkout_impl_00298(uuid,numeric)') is null then
    if to_regprocedure('public.open_shift_atomic(uuid,numeric)') is null then
      raise exception '00370 dung: khong tim thay open_shift_atomic dung chu ky';
    end if;
    alter function public.open_shift_atomic(uuid,numeric)
      rename to _open_shift_checkout_impl_00298;
  end if;
end $$;

create or replace function public.open_shift_atomic(
  p_branch_id uuid,
  p_starting_cash numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'SHIFT_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.checkout') then
    raise exception using errcode = '42501', message = 'FNB_OPEN_SHIFT_DENIED';
  end if;
  return public._open_shift_checkout_impl_00298(p_branch_id, p_starting_cash);
end;
$$;

revoke all on function public._open_shift_checkout_impl_00298(uuid,numeric)
  from public, anon, authenticated;
revoke all on function public.open_shift_atomic(uuid,numeric)
  from public, anon;
grant execute on function public.open_shift_atomic(uuid,numeric)
  to authenticated;

comment on function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text) is
  '00370: chi user co pos_fnb.checkout moi duoc chot thanh toan FnB; nghiep vu goc giu o ham noi bo 00345.';
comment on function public.open_shift_atomic(uuid,numeric) is
  '00370: chi user co pos_fnb.checkout moi duoc mo ca thu ngan.';

do $$
declare
  v_payment_def text;
  v_shift_def text;
begin
  select pg_get_functiondef('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure)
    into v_payment_def;
  select pg_get_functiondef('public.open_shift_atomic(uuid,numeric)'::regprocedure)
    into v_shift_def;
  if position('pos_fnb.checkout' in v_payment_def) = 0
     or position('pos_fnb.checkout' in v_shift_def) = 0 then
    raise exception '00370 that bai: guard checkout chua duoc cai day du';
  end if;
  if exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('_fnb_complete_payment_checkout_impl_00345', '_open_shift_checkout_impl_00298')
      and grantee in ('PUBLIC','anon','authenticated')
  ) then
    raise exception '00370 that bai: ham noi bo van con quyen goi truc tiep';
  end if;
end $$;

notify pgrst, 'reload schema';
