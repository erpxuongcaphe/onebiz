-- The advance ledger validates the requested branch through the cash-history
-- reader, but the all-branches result must filter every advance independently.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; patched text;
 anchor constant text := 'and public.user_has_branch_access(auth.uid(),a.branch_id)';
 scoped constant text := 'and public.user_has_branch_access(auth.uid(),a.branch_id) and public._staff_my_cash_book_view(a.branch_id)';
begin
 if to_regprocedure('public.get_party_advance_ledger_00553(text,uuid,uuid)') is null then
  raise exception 'STAFF_PARTY_ADVANCE_READER_MISSING';
 end if;
 source:=pg_get_functiondef('public.get_party_advance_ledger_00553(text,uuid,uuid)'::regprocedure);
 if position(scoped in source)>0 then return;end if;
 if position(anchor in source)=0 or
  (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_PARTY_ADVANCE_READER_CHANGED';
 end if;
 patched:=replace(source,anchor,scoped);
 execute patched;
end $migration$;
commit;
