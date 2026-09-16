-- Emergency rollback for 00381.
-- Restores the prior implementation from the immutable 00244 source definition.
-- This changes no existing return, stock, cash, invoice, or customer balance.

begin;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public._create_sales_return_auth_impl_00244_pre_00381(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'SALES_RETURN_ROLLBACK_IMPLEMENTATION_NOT_FOUND';
  end if;
  v_definition := replace(
    v_definition,
    'public._create_sales_return_auth_impl_00244_pre_00381(',
    'public._create_sales_return_auth_impl_00244('
  );
  execute v_definition;
end;
$$;

revoke all on function public._create_sales_return_auth_impl_00244(
  uuid, jsonb, numeric, text, text, text, uuid
) from public, anon, authenticated;

drop function public._create_sales_return_auth_impl_00244_pre_00381(
  uuid, jsonb, numeric, text, text, text, uuid
);

commit;
