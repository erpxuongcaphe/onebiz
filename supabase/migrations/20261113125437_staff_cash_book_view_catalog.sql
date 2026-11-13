-- The branch editor is exposed only after cash readers, report projections and
-- the stale-client safety check are installed. No staff assignments change.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare missing text; body text;
begin
 if to_regprocedure('public._staff_my_cash_book_view(uuid)') is null
  or to_regprocedure('public._staff_cash_direct_allowed_branches()') is null
  or to_regprocedure('public.get_cash_flow_category_summary(date,date,uuid)') is null
  or to_regprocedure('public.get_cash_book_list_workspace(integer,integer,text,text,text[],text[],text[],text[],date,date,numeric,numeric,uuid)') is null
  or to_regprocedure('public.get_money_account_workspace(uuid,date,date)') is null
  or to_regprocedure('public.get_party_cash_history_sources(text,uuid,uuid,integer,integer,jsonb)') is null then
  raise exception 'STAFF_CASH_BOOK_VIEW_READERS_MISSING';
 end if;
 body:=pg_get_functiondef('public._staff_cash_direct_allowed_branches()'::regprocedure);
 if position('onebiz-cash-scope/1' in body)=0
  or position('user_branch_permission_overrides' in body)=0 then
  raise exception 'STAFF_CASH_BOOK_STALE_CLIENT_GUARD_MISSING';
 end if;
 body:=pg_get_functiondef('public.get_cash_book_list_workspace(integer,integer,text,text,text[],text[],text[],text[],date,date,numeric,numeric,uuid)'::regprocedure);
 if position('_staff_my_cash_book_view' in body)=0 then raise exception 'STAFF_CASH_BOOK_WORKSPACE_SCOPE_MISSING';end if;
 if not exists(select 1 from pg_policies p where p.schemaname='public'
  and p.tablename='cash_transactions' and p.policyname='staff_cash_direct_read_scope'
  and p.cmd='SELECT' and p.permissive='RESTRICTIVE') then
  raise exception 'STAFF_CASH_BOOK_DIRECT_POLICY_MISSING';
 end if;
 select string_agg(x.tbl||'.'||x.pol,', ' order by x.tbl) into missing
 from (values ('cash_amendments','cash_amendment_read'),('money_accounts','money_account_read'),
  ('party_advance_refunds','party_advance_refund_read')) x(tbl,pol)
 where not exists(select 1 from pg_policies p where p.schemaname='public'
  and p.tablename=x.tbl and p.policyname=x.pol and p.cmd='SELECT'
  and position('_staff_my_cash_book_view' in p.qual)>0);
 if missing is not null then raise exception 'STAFF_CASH_BOOK_RELATED_POLICIES_MISSING: %',missing;end if;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('finance.view_cash_book',1);
commit;
