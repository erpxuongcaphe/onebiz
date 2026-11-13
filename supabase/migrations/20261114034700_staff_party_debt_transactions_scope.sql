-- Apply existing debt permissions at the transaction's branch. Preserve all
-- existing cash-book, transaction, membership, idempotency and posting checks.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare item record; source text; patched text; count_matches integer;
begin
 for item in select * from (values
  ('public.settle_party_documents_atomic(uuid,jsonb)','104657f944838755cc42be6b80b86e58',
   'public.user_has_permission(auth.uid(),case when mode=''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end)',
   'public._staff_permission_at_scope(auth.uid(),case when mode=''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end,b)'),
  ('public.refund_party_advance(uuid,jsonb)','9975d5ef34bb4c5b9f7baa251e4d53e5',
   'public.user_has_permission(auth.uid(),case m when ''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end)',
   'public._staff_permission_at_scope(auth.uid(),case m when ''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end,b)'),
  ('public.cancel_party_advance_refund(uuid,text)','797dbdf55eac45cb384325e4ca2ccc34',
   'public.user_has_permission(auth.uid(),case r.mode when ''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end)',
   'public._staff_permission_at_scope(auth.uid(),case r.mode when ''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end,r.branch_id)'),
  ('public.get_party_advance_ledger_00553(text,uuid,uuid)','ce1d374019c37a6c36378ab7f3fb6436',
   'public.user_has_permission(auth.uid(),case when p_mode=''supplier'' then ''suppliers.view_debt'' else ''customers.view_debt'' end)',
   'public._staff_permission_any_branch(auth.uid(),case when p_mode=''supplier'' then ''suppliers.view_debt'' else ''customers.view_debt'' end)')
 ) x(sig,hash,needle,replacement) loop
  if to_regprocedure(item.sig) is null or not exists(select 1 from pg_proc where oid=to_regprocedure(item.sig)
    and prosecdef and md5(replace(prosrc,chr(13),''))=item.hash) then raise exception 'PARTY_DEBT_TRANSACTION_BASELINE_CHANGED: %',item.sig;end if;
  source:=pg_get_functiondef(to_regprocedure(item.sig));
  count_matches:=(length(source)-length(replace(source,item.needle,'')))/length(item.needle);
  if count_matches<>1 then raise exception 'PARTY_DEBT_TRANSACTION_ANCHOR_CHANGED: % (%)',item.sig,count_matches;end if;
  patched:=replace(source,item.needle,item.replacement);
  if item.sig='public.get_party_advance_ledger_00553(text,uuid,uuid)' then
   item.needle:='and public._staff_my_cash_book_view(a.branch_id);';
   if position(item.needle in patched)=0 then raise exception 'PARTY_ADVANCE_LEDGER_BRANCH_ANCHOR_CHANGED';end if;
   patched:=replace(patched,item.needle,'and public._staff_my_cash_book_view(a.branch_id) and public._staff_permission_at_scope(auth.uid(),case when p_mode=''supplier'' then ''suppliers.view_debt'' else ''customers.view_debt'' end,a.branch_id);');
  end if;
  execute patched;
 end loop;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.get_party_cash_history_detail_00553(text,uuid,uuid,integer,integer,jsonb)')
   and prosecdef and md5(replace(prosrc,chr(13),''))='1fac053061d544e798ef2637941acecf') then raise exception 'PARTY_CASH_DETAIL_BASELINE_CHANGED';end if;
 source:=pg_get_functiondef('public.get_party_cash_history_detail_00553(text,uuid,uuid,integer,integer,jsonb)'::regprocedure);
 count_matches:=(length(source)-length(replace(source,'when can_debt then','')))/length('when can_debt then');
 if count_matches<>3 then raise exception 'PARTY_CASH_DETAIL_ANCHOR_CHANGED: %',count_matches;end if;
 patched:=replace(source,'when can_debt then','when public._staff_permission_at_scope(auth.uid(),case when p_mode=''supplier'' then ''suppliers.view_debt'' else ''customers.view_debt'' end,c.branch_id) then');
 execute patched;
end$$;
commit;
