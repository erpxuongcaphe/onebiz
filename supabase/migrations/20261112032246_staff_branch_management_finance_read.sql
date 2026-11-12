begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public._staff_management_finance_view_actor(p_branch uuid)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare tenant uuid;
begin
  select tenant_id into tenant from public.profiles
    where id=auth.uid() and coalesce(is_active,true);
  if tenant is null or not coalesce(public._staff_my_cash_book_view(p_branch),false) then
    raise exception 'MANAGEMENT_FINANCE_DENIED' using errcode='42501';
  end if;
  return tenant;
end
$$;
revoke all on function public._staff_management_finance_view_actor(uuid) from public,anon,authenticated;

do $migration$
declare
  source text;
  actor_anchor constant text := 'public.management_finance_actor(''finance.view_cash_book'')';
  allocations_anchor constant text := 'not public.user_has_branch_access(auth.uid(),a.branch_id)';
  event_anchor constant text := 'where e.tenant_id=v_tenant and not exists';
begin
  source := pg_get_functiondef('public.get_management_finance_workspace(date,date,uuid,text,uuid,text,integer,integer,text,text,text)'::regprocedure);
  if position(actor_anchor in source)=0 or position(allocations_anchor in source)=0
    or position(event_anchor in source)=0 then
    raise exception 'STAFF_MANAGEMENT_FINANCE_READER_CHANGED';
  end if;
  source := replace(source, actor_anchor, 'public._staff_management_finance_view_actor(p_branch_id)');
  -- The report returns all allocations and settlements of each event.
  -- Keep an event only when all of its component branches can be viewed.
  source := replace(source, allocations_anchor,
    '(not public.user_has_branch_access(auth.uid(),a.branch_id) or not public._staff_cash_row_visible(a.branch_id))');
  source := replace(source, event_anchor,
    'where e.tenant_id=v_tenant and not exists(select 1 from public.management_finance_settlements s join public.cash_transactions c on c.id=s.cash_transaction_id where s.event_id=e.id and not public._staff_cash_row_visible(c.branch_id)) and not exists');
  execute source;

  -- Shared category labels contain no transaction amounts. The branch journal
  -- category list must still check the requested branch.
  source := pg_get_functiondef('public.get_management_finance_categories()'::regprocedure);
  if position(actor_anchor in source)=0 then raise exception 'STAFF_MANAGEMENT_CATEGORIES_CHANGED'; end if;
  execute replace(source,actor_anchor,'public._staff_management_finance_view_actor(null::uuid)');

  source := pg_get_functiondef('public.get_journal_finance_categories_v1(uuid)'::regprocedure);
  if position(actor_anchor in source)=0 then raise exception 'STAFF_JOURNAL_CATEGORIES_CHANGED'; end if;
  execute replace(source,actor_anchor,'public._staff_management_finance_view_actor(p_branch_id)');

  source := pg_get_functiondef('public.get_management_finance_cash_links(date,date,uuid,integer,integer)'::regprocedure);
  if position(actor_anchor in source)=0 or position(allocations_anchor in source)=0
    or position('where c.status=''completed''' in source)=0 then
    raise exception 'STAFF_MANAGEMENT_CASH_LINKS_CHANGED';
  end if;
  source := replace(source,actor_anchor,'public._staff_management_finance_view_actor(p_branch_id)');
  source := replace(source,allocations_anchor,
    '(not public.user_has_branch_access(auth.uid(),a.branch_id) or not public._staff_cash_row_visible(a.branch_id))');
  source := replace(source,'where c.status=''completed''',
    'where public._staff_cash_row_visible(c.branch_id) and c.status=''completed''');
  execute source;
end
$migration$;

commit;
