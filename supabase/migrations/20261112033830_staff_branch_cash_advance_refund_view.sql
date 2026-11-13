-- A refund also requires the cash-book view right for the same branch. The
-- create/void, debt, persisted-document and branch checks remain independent.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $migration$
declare item record; source text; anchor text := 'public.user_has_permission(auth.uid(),''finance.view_cash_book'')';
begin
  for item in select * from (values
    ('public.refund_party_advance(uuid,jsonb)','b'),
    ('public.cancel_party_advance_refund(uuid,text)','r.branch_id')
  ) as t(signature,branch_expression) loop
    source := pg_get_functiondef(item.signature::regprocedure);
    if (length(source)-length(replace(source,anchor,''))) / length(anchor) <> 1 then
      raise exception 'STAFF_CASH_REFUND_VIEW_CONSUMER_CHANGED: %',item.signature;
    end if;
    execute replace(source,anchor,format('public._staff_my_cash_book_view(%s)',item.branch_expression));
  end loop;
end $migration$;
commit;
