begin;
-- Refunds move cash and reduce a deposit; they do not become an operating expense.
do $$ declare f record;source text;old text:='''supplier_payment''';begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('get_profit_and_loss_report','get_profit_and_loss_report_v2',
   'get_branch_profit_and_loss_report','get_branch_profit_and_loss_report_v2','get_consolidated_profit_and_loss_report') loop
  source:=pg_get_functiondef(f.oid);
  if strpos(source,old)>0 then execute replace(source,old,old||',''customer_advance_refund'',''supplier_advance_refund''');end if;
 end loop;
 if to_regprocedure('public.get_party_debt_movements(text,uuid,uuid,date,date,integer,integer)') is not null then
  source:=pg_get_functiondef('public.get_party_debt_movements(text,uuid,uuid,date,date,integer,integer)'::regprocedure);
  old:='''customer_advance'',''supplier_advance''';
  if (length(source)-length(replace(source,old,'')))/length(old)<>2 then raise exception 'ADVANCE_REFUND_MOVEMENT_DRIFT';end if;
  source:=replace(source,old,old||',''customer_advance_refund'',''supplier_advance_refund''');
  old:='and coalesce(a.idempotency_key,'''') not like ''cancel-customer-advance:%''';
  if strpos(source,old)=0 then raise exception 'ADVANCE_REFUND_MOVEMENT_ADJUSTMENT_DRIFT';end if;
  execute replace(source,old,old||' and coalesce(a.idempotency_key,'''') not like ''cancel-customer-advance-refund:%''');
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
