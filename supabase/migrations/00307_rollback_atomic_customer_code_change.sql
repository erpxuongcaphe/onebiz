-- Rollback for 00307. Does not change customer data.

drop function if exists public.change_customer_code_atomic(uuid, text);

select
  to_regprocedure('public.change_customer_code_atomic(uuid,text)') is null
    as customer_code_rpc_removed;
