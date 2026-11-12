begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Authorize only the current caller. A null branch is an initial list check;
-- individual rows are checked separately before pagination and totals.
create function public._staff_my_cash_book_view(p_branch uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case when p_branch is null
    then public._staff_permission_any_branch(auth.uid(), 'finance.view_cash_book')
    else public._staff_permission_at_scope(auth.uid(), 'finance.view_cash_book', p_branch)
  end
$$;
revoke all on function public._staff_my_cash_book_view(uuid) from public, anon;
grant execute on function public._staff_my_cash_book_view(uuid) to authenticated;

do $migration$
declare
  item record;
  source text;
  patched text;
begin
  for item in select * from (values
    ('get_cash_book_list_workspace', 'public.user_has_permission(v_actor, ''finance.view_cash_book'')',
      'p_branch_id', 'where ct.tenant_id = v_tenant',
      'where ct.tenant_id = v_tenant and public._staff_my_cash_book_view(ct.branch_id)'),
    ('get_party_cash_history_sources', 'public.user_has_permission(auth.uid(),''finance.view_cash_book'')',
      'p_branch_id', 'where c.tenant_id=v_tenant and public.user_has_branch_access(auth.uid(),c.branch_id)',
      'where c.tenant_id=v_tenant and public._staff_my_cash_book_view(c.branch_id) and public.user_has_branch_access(auth.uid(),c.branch_id)'),
    ('get_cash_amendment_history', 'public.user_has_permission(auth.uid(),''finance.view_cash_book'')',
      'b', null, null),
    ('get_money_account_workspace', 'public.user_has_permission(auth.uid(),''finance.view_cash_book'')',
      'p_branch_id', null, null),
    ('get_party_debt_movements', 'public.user_has_permission(auth.uid(),''finance.view_cash_book'')',
      'p_branch_id', null, null),
    ('get_cash_journal_operation_templates_v1', 'public.user_has_permission(auth.uid(), ''finance.view_cash_book'')',
      'p_branch_id', null, null)
  ) as readers(name, permission_anchor, branch_expression, row_anchor, row_replacement) loop
    if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=item.name) <> 1 then
      raise exception 'STAFF_CASH_READER_AMBIGUOUS: %', item.name;
    end if;
    select pg_get_functiondef(oid) into source from pg_proc
      where pronamespace='public'::regnamespace and proname=item.name;
    if position(item.permission_anchor in source) = 0
      or (item.row_anchor is not null and position(item.row_anchor in source) = 0) then
      raise exception 'STAFF_CASH_READER_CHANGED: %', item.name;
    end if;
    patched := replace(source, item.permission_anchor,
      format('public._staff_my_cash_book_view(%s)', item.branch_expression));
    if item.row_anchor is not null then
      patched := replace(patched, item.row_anchor, item.row_replacement);
    end if;
    execute patched;
  end loop;
end
$migration$;

-- Leave finance.view_cash_book unavailable as a branch exception until all
-- cash readers and direct table access have been covered and verified.
commit;
