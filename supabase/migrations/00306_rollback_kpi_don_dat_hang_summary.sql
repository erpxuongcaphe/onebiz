-- Rollback for 00306. Drops only the read-only summary function.
drop function if exists public.get_sales_order_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, uuid,
  timestamptz, timestamptz, text, text, text, text, numeric, numeric
);

drop function if exists public.get_sales_order_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, uuid,
  timestamptz, timestamptz, text
);

notify pgrst, 'reload schema';

select
  to_regprocedure(
    'public.get_sales_order_list_summary(uuid,timestamp with time zone,timestamp with time zone,text[],text,text,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,numeric,numeric)'
  ) is null as rollback_ok;
