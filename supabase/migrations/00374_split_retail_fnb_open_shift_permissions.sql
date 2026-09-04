-- ============================================================================
-- 00374 - Tach cong mo ca Retail va FnB.
--
-- 00370 da gan guard FnB vao open_shift_atomic dung chung, khien POS Retail
-- cung bi doi pos_fnb.checkout. Giu mot loi tao ca nguyen tu 00298, nhung moi
-- kenh co mot wrapper va permission dung nghiep vu.
-- ============================================================================

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
  if not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'RETAIL_OPEN_SHIFT_DENIED';
  end if;
  return public._open_shift_checkout_impl_00298(p_branch_id, p_starting_cash);
end;
$$;

create or replace function public.fnb_open_shift_atomic(
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
revoke all on function public.fnb_open_shift_atomic(uuid,numeric)
  from public, anon;
grant execute on function public.open_shift_atomic(uuid,numeric)
  to authenticated;
grant execute on function public.fnb_open_shift_atomic(uuid,numeric)
  to authenticated;

comment on function public.open_shift_atomic(uuid,numeric) is
  '00374: cong mo ca POS Retail, yeu cau pos_retail.checkout.';
comment on function public.fnb_open_shift_atomic(uuid,numeric) is
  '00374: cong mo ca POS FnB, yeu cau pos_fnb.checkout.';

do $$
declare
  v_retail_def text;
  v_fnb_def text;
begin
  select pg_get_functiondef('public.open_shift_atomic(uuid,numeric)'::regprocedure)
    into v_retail_def;
  select pg_get_functiondef('public.fnb_open_shift_atomic(uuid,numeric)'::regprocedure)
    into v_fnb_def;

  if position('pos_retail.checkout' in v_retail_def) = 0
     or position('pos_fnb.checkout' in v_retail_def) > 0 then
    raise exception '00374 that bai: guard mo ca Retail khong dung';
  end if;
  if position('pos_fnb.checkout' in v_fnb_def) = 0
     or position('pos_retail.checkout' in v_fnb_def) > 0 then
    raise exception '00374 that bai: guard mo ca FnB khong dung';
  end if;
  if exists (
    select 1
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = '_open_shift_checkout_impl_00298'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  ) then
    raise exception '00374 that bai: ham loi mo ca van goi truc tiep duoc';
  end if;
end $$;

select
  'K1_RETAIL_VA_FNB_DA_TACH_CONG_MO_CA' as muc,
  'DIEU_KIEN' as loai,
  true as dat,
  jsonb_build_object(
    'retail', 'open_shift_atomic + pos_retail.checkout',
    'fnb', 'fnb_open_shift_atomic + pos_fnb.checkout',
    'loi_dung_chung', '_open_shift_checkout_impl_00298'
  ) as chi_tiet;

notify pgrst, 'reload schema';
