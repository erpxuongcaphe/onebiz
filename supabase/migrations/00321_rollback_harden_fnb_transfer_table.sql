-- 00321 rollback: fail closed by disabling the transfer RPC.
-- It intentionally does not restore the legacy function that trusted tenant_id
-- from the client. Existing orders and tables are not changed.

revoke all on function public.fnb_transfer_table_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
drop function if exists public.fnb_transfer_table_atomic(uuid, uuid, uuid, uuid);

select
  to_regprocedure('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)') is null
    as fnb_transfer_table_disabled_ok;
