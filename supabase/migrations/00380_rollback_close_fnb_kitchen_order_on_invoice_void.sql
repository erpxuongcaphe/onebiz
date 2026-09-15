begin;

drop function if exists public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
);

alter function public._void_completed_invoice_atomic_v2_impl_00250(
  uuid,text,text,uuid
) rename to void_completed_invoice_atomic_v2;

revoke all on function public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
) from public, anon;
grant execute on function public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
) to authenticated;

commit;
