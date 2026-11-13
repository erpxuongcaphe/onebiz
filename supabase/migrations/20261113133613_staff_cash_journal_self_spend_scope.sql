-- Self-spend journal access may be granted or revoked per assigned branch.
-- The separate company-wide journal permission keeps its existing scope.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_my_journal_self_spend(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and p_branch is not null and (
  coalesce(public._staff_permission_at_scope(auth.uid(),'finance.view_cash_journal_self_spend',p_branch),false)
  or (coalesce(public.user_has_permission(auth.uid(),'finance.view_branch_self_spend_journal'),false)
   and not exists(select 1 from public.user_permission_overrides o where o.user_id=auth.uid()
    and o.permission_code='finance.view_cash_journal_self_spend' and o.override_type='revoke')
   and not exists(select 1 from public.user_branch_permission_overrides o where o.user_id=auth.uid()
    and o.branch_id=p_branch and o.permission_code='finance.view_cash_journal_self_spend')))
$$;
revoke all on function public._staff_my_journal_self_spend(uuid) from public,anon;
grant execute on function public._staff_my_journal_self_spend(uuid) to authenticated;
do $migration$
declare item record; source text;
 old_self constant text := 'coalesce(public.user_has_permission(v_actor, ''finance.view_cash_journal_self_spend''), false) or coalesce(public.user_has_permission(v_actor, ''finance.view_branch_self_spend_journal''), false)';
 old_branches constant text := 'and ((v_company and coalesce(public.user_has_permission(v_actor, ''reports.view_all_branches''), false)) or b.id in (select a.branch_id from public.get_user_accessible_branches(v_actor) a));';
begin
 for item in select * from (values
  ('public.cash_journal_list_v1(date,date,uuid,text,text,text,text,boolean,integer,boolean,text)'),
  ('public.cash_journal_list_v2(date,date,uuid,text,text,text,text,boolean,integer,boolean,text)')
 ) x(fn) loop
  source:=pg_get_functiondef(to_regprocedure(item.fn));
  if source is null or position(old_self in source)=0 or position(old_branches in source)=0 then raise exception 'STAFF_SELF_SPEND_JOURNAL_CHANGED: %',item.fn;end if;
  source:=replace(source,old_self,'exists(select 1 from public.branches sb where sb.tenant_id=v_tenant and public.user_has_branch_access(v_actor,sb.id) and public._staff_my_journal_self_spend(sb.id))');
  source:=replace(source,old_branches,'and ((v_company and coalesce(public.user_has_permission(v_actor, ''reports.view_all_branches''), false)) or b.id in (select a.branch_id from public.get_user_accessible_branches(v_actor) a)) and (v_company or public._staff_my_journal_self_spend(b.id));');
  execute source;
 end loop;
 source:=pg_get_functiondef('private.store_cash_custody_actor(uuid,date,boolean)'::regprocedure);
 if position('public.user_has_permission(v_actor, ''finance.view_cash_journal_self_spend'')' in source)=0 then raise exception 'STAFF_SELF_SPEND_CUSTODY_CHANGED';end if;
 source:=replace(source,'public.user_has_permission(v_actor, ''finance.view_cash_journal_self_spend'')','public._staff_my_journal_self_spend(p_branch_id)');
 execute source;
 source:=pg_get_functiondef('public.get_store_sales_day_collections(uuid,date)'::regprocedure);
 if position('public.user_has_permission(v_actor, ''finance.view_cash_journal_self_spend'')' in source)=0 then raise exception 'STAFF_SELF_SPEND_SALES_CHANGED';end if;
 source:=replace(source,'public.user_has_permission(v_actor, ''finance.view_cash_journal_self_spend'')','public._staff_my_journal_self_spend(p_branch_id)');
 execute source;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('finance.view_cash_journal_self_spend',1);
commit;
