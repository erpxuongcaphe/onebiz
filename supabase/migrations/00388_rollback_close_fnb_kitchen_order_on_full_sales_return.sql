begin;

drop function if exists public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
);

alter function public._create_sales_return_atomic_impl_00376(
  uuid,jsonb,numeric,text,text,text,uuid
) rename to create_sales_return_atomic;

revoke all on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) from public, anon;
grant execute on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) to authenticated;

commit;
