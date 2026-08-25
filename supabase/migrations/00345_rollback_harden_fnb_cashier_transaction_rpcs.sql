-- ============================================================================
-- HOAN TAC 00345 — Chi dung khi 00345 da cai va can lui ngay.
-- Khong xoa/sua hoa don, don bep, ton kho, so lo, so quy hay nhat ky.
-- Tra ba public RPC ve dung ban 00329/00343/00066 ngay truoc 00345.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)') is null
     or to_regprocedure('public._fnb_void_invoice_impl_00329(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00345_ROLLBACK_INTERNAL_RPC_MISSING';
  end if;
end;
$$;

drop function if exists public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid);
drop function if exists public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid);
drop function if exists public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text);

alter function public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)
  rename to fnb_cancel_unpaid_order_atomic;
alter function public._fnb_void_invoice_impl_00329(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)
  rename to fnb_void_invoice_atomic;
alter function public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)
  rename to fnb_complete_payment_atomic_v3;

revoke all on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) from public, anon;
revoke all on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text) from public, anon;
grant execute on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) to authenticated;
grant execute on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text) to authenticated;

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)',
    'public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
  ] loop
    if to_regprocedure(v_sig) is null
       or not has_function_privilege('authenticated', v_sig, 'EXECUTE')
       or has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception using errcode = 'P0001', message = 'FNB_00345_ROLLBACK_POSTFLIGHT_FAILED', detail = v_sig;
    end if;
  end loop;
end;
$$;

commit;
notify pgrst, 'reload schema';
